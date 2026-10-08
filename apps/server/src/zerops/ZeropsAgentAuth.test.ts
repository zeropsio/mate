import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it as itEffect } from "@effect/vitest";
import type { ZeropsAgentAuthSnapshot, ZeropsAgentId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { describe, expect, it } from "vite-plus/test";
import { classifyZeropsAgentAuth } from "@t3tools/shared/zeropsAgentAuth";

import { buildSnapshot, computeAgentAuthState, make, toZembedEnv } from "./ZeropsAgentAuth.ts";
import type { WatcherHandle } from "./ZeropsAgentAuthWatcher.ts";
import { ZeropsAgentFlagError } from "./ZeropsAgentFlag.ts";

// The §3 W-STATE matrix (docs/spec-welcome-mode.md), pinned verbatim against
// `vscode-bootstrap-welcome.js`'s `computeAgentState`. `credVerifiable` is
// dropped here: both agents this feed reports on (claude-code, codex) always
// have a verified probe, so every row already fully determines the result
// from flagToken/flagOAuth/credPresent alone — exactly as the welcome.js
// source comment says.
describe("computeAgentAuthState", () => {
  it.each([
    { flagOAuth: false, flagToken: false, credPresent: false, expected: "not-authorized" },
    { flagOAuth: false, flagToken: false, credPresent: true, expected: "local-only" },
    { flagOAuth: true, flagToken: false, credPresent: true, expected: "authorized" },
    { flagOAuth: true, flagToken: false, credPresent: false, expected: "reconnect" },
    { flagOAuth: false, flagToken: true, credPresent: false, expected: "authorized-token" },
    { flagOAuth: false, flagToken: true, credPresent: true, expected: "authorized-token" },
    // flagToken wins even when flagOAuth is also set, matching welcome.js's
    // `if (flagToken) return "authorized-token"` short-circuit before flagOAuth.
    { flagOAuth: true, flagToken: true, credPresent: false, expected: "authorized-token" },
  ])("flagOAuth=$flagOAuth flagToken=$flagToken credPresent=$credPresent -> $expected", (row) => {
    expect(computeAgentAuthState(row)).toBe(row.expected);
  });
});

const UNKNOWN_PROVIDER_AUTH = { "claude-code": "unknown", codex: "unknown" } as const;

describe("buildSnapshot", () => {
  it("reads both agents' flags from the env store by suffix, and carries providerAuth through unchanged", () => {
    const snapshot = buildSnapshot(
      { ZCP_AGENT_OAUTH_CLAUDE_CODE: "true", ZCP_AGENT_TOKEN_CODEX: "sometoken" },
      { "claude-code": true, codex: false },
      { "claude-code": "authenticated", codex: "unauthenticated" },
    );
    expect(snapshot.available).toBe(true);
    expect(snapshot.agents).toEqual([
      {
        agentId: "claude-code",
        credPresent: true,
        flagOAuth: true,
        flagToken: false,
        providerAuth: "authenticated",
        state: "authorized",
      },
      {
        agentId: "codex",
        credPresent: false,
        flagOAuth: false,
        flagToken: true,
        providerAuth: "unauthenticated",
        state: "authorized-token",
      },
    ]);
  });

  it("treats a missing env store as no flags set", () => {
    const snapshot = buildSnapshot(
      undefined,
      { "claude-code": false, codex: true },
      UNKNOWN_PROVIDER_AUTH,
    );
    expect(snapshot.agents.find((agent) => agent.agentId === "claude-code")?.state).toBe(
      "not-authorized",
    );
    expect(snapshot.agents.find((agent) => agent.agentId === "codex")?.state).toBe("local-only");
  });

  it('only treats the exact string "true" as the OAuth flag being set', () => {
    const snapshot = buildSnapshot(
      { ZCP_AGENT_OAUTH_CLAUDE_CODE: "false" },
      { "claude-code": false, codex: false },
      UNKNOWN_PROVIDER_AUTH,
    );
    expect(snapshot.agents.find((agent) => agent.agentId === "claude-code")?.flagOAuth).toBe(false);
  });

  it("defaults providerAuth to unknown before any provider check has run", () => {
    const snapshot = buildSnapshot(
      undefined,
      { "claude-code": false, codex: false },
      UNKNOWN_PROVIDER_AUTH,
    );
    expect(snapshot.agents.every((agent) => agent.providerAuth === "unknown")).toBe(true);
  });
});

// Spec §0, MA-7: the env store is the platform's whole service env, secrets
// included. The reader keeps the two agent-flag prefixes and nothing else, so
// no other value of that file ever sits in this module's memory.
describe("toZembedEnv", () => {
  it("keeps only the agent flag keys; a store carrying ZCP_API_KEY and VSCODE_PASSWORD yields neither", () => {
    expect(
      toZembedEnv({
        ZCP_AGENT_OAUTH_CLAUDE: "true",
        ZCP_AGENT_TOKEN_CODEX: "tok",
        ZCP_API_KEY: "secret",
        VSCODE_PASSWORD: "pw",
        hostname: "zcp",
        ZCP_AGENT_OAUTH_NUMERIC: 1,
      }),
    ).toEqual({ ZCP_AGENT_OAUTH_CLAUDE: "true", ZCP_AGENT_TOKEN_CODEX: "tok" });
  });

  it.each([null, [], "x", 1, undefined])("reads a non-object document (%s) as no store", (doc) => {
    expect(toZembedEnv(doc)).toBeUndefined();
  });
});

describe("buildSnapshot provenance", () => {
  const providerAuth = { "claude-code": "authenticated", codex: "unknown" } as const;
  const at = Option.getOrThrow(DateTime.make(1_788_600_000_000));

  it("carries the recorded authorizer onto the agent that has a credential", () => {
    const snapshot = buildSnapshot(
      { ZCP_AGENT_OAUTH_CLAUDE_CODE: "true" },
      { "claude-code": true, codex: false },
      providerAuth,
      { "claude-code": { subject: "zerops-user-a", at } },
    );

    const claude = snapshot.agents.find((agent) => agent.agentId === "claude-code");
    expect(claude?.authorizedBy?.subject).toBe("zerops-user-a");
  });

  it("omits it for an agent whose credential is gone — a record for nothing names nobody", () => {
    const snapshot = buildSnapshot(
      undefined,
      { "claude-code": false, codex: false },
      providerAuth,
      { "claude-code": { subject: "zerops-user-a", at } },
    );

    expect(snapshot.agents.find((agent) => agent.agentId === "claude-code")?.authorizedBy).toBe(
      undefined,
    );
  });

  it("omits it when nothing was ever recorded, which is the pre-existing behaviour", () => {
    const snapshot = buildSnapshot(undefined, { "claude-code": true, codex: true }, providerAuth);

    expect(snapshot.agents.every((agent) => agent.authorizedBy === undefined)).toBe(true);
  });
});

// The walker keeps a sign-in before it asks for the re-check (`ZeropsAgentLogin`): the publish
// that re-check makes names the person who signed in, with nothing left to wait for.
describe("the signer", () => {
  const agentState = (snapshot: ZeropsAgentAuthSnapshot, agentId: ZeropsAgentId) =>
    snapshot.agents.find((agent) => agent.agentId === agentId);

  /** Blocks the current fiber (never forked, see ZeropsAgentAuthIo.test.ts) for the next matching publish. */
  const changeWhere = (
    subscription: { readonly changes: Stream.Stream<ZeropsAgentAuthSnapshot> },
    predicate: (snapshot: ZeropsAgentAuthSnapshot) => boolean,
  ) =>
    Stream.runHead(Stream.filter(subscription.changes, predicate)).pipe(
      Effect.map(Option.getOrThrow),
    );

  const noWatch = (
    _target: string,
    _fallbackDir: string,
    _onChange: () => void,
  ): WatcherHandle => ({
    dispose: () => {},
  });

  /**
   * A feed over a home directory whose Claude credential already exists, with a `readSigners`
   * fake over `signers`. The initial provider check the present credential requests is drained
   * first.
   */
  const makeFeed = (initial: Readonly<Partial<Record<ZeropsAgentId, string>>>) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const homeDir = yield* fs.makeTempDirectoryScoped({ prefix: "mate-agent-auth-signers-" });
      const credential = path.join(homeDir, ".claude", ".credentials.json");
      yield* fs.makeDirectory(path.dirname(credential), { recursive: true });
      yield* fs.writeFileString(credential, "{}");

      const signers = yield* Ref.make(initial);
      const feed = yield* make({
        agentFlag: {
          markSignedIn: () => Effect.fail(new ZeropsAgentFlagError({ reason: "not used" })),
        },
        refreshProviderAuth: () =>
          Effect.succeed({ status: "unauthenticated" as const, checkedAt: 0 }),
        homeDir,
        envStorePath: path.join(homeDir, "zembed-env.json"),
        readSigners: Ref.get(signers),
        isZeropsEnvironment: true,
        watch: noWatch,
      });
      const subscription = yield* feed.subscribe;
      yield* TestClock.adjust(Duration.seconds(2));
      yield* changeWhere(
        subscription,
        (snapshot) => agentState(snapshot, "claude-code")?.providerAuth === "unauthenticated",
      );
      return { feed, subscription, signers };
    });

  itEffect.layer(NodeServices.layer)("ended attempts stay ended", (it) => {
    it.effect.each(
      Array.from(["unknown", "authenticated"] as const, (status) => ({
        title: `${status}: a day passing makes no attempt; the operator makes one`,
        status,
      })),
    )("$title", ({ status }) =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const homeDir = yield* fs.makeTempDirectoryScoped({ prefix: "mate-auth-once-" });
          yield* fs.makeDirectory(path.join(homeDir, ".codex"));
          yield* fs.writeFileString(path.join(homeDir, ".codex", "auth.json"), "{}");
          const probes = yield* Ref.make(0);
          const writes = yield* Ref.make(0);
          const feed = yield* make({
            homeDir,
            envStorePath: path.join(homeDir, "env.json"),
            isZeropsEnvironment: true,
            watch: noWatch,
            refreshProviderAuth: () =>
              Ref.update(probes, (n) => n + 1).pipe(
                Effect.as({
                  status,
                  checkedAt: 1,
                  ...(status === "unknown" ? { reason: "Couldn't verify" } : {}),
                }),
              ),
            agentFlag: {
              markSignedIn: () =>
                Ref.update(writes, (n) => n + 1).pipe(
                  Effect.andThen(Effect.fail(new ZeropsAgentFlagError({ reason: "Unavailable" }))),
                ),
            },
          });
          const subscription = yield* feed.subscribe;
          yield* TestClock.adjust("2 seconds");
          yield* changeWhere(
            subscription,
            (snapshot) => agentState(snapshot, "codex")?.verification?.status === status,
          );
          assert.equal(yield* Ref.get(probes), 1);
          assert.equal(yield* Ref.get(writes), status === "authenticated" ? 1 : 0);
          yield* TestClock.adjust("1 day");
          assert.equal(yield* Ref.get(probes), 1);
          assert.equal(yield* Ref.get(writes), status === "authenticated" ? 1 : 0);
          yield* feed.recheckNow("codex");
          yield* TestClock.adjust("2 seconds");
          yield* changeWhere(
            subscription,
            (snapshot) =>
              agentState(snapshot, "codex")?.verification?.generation === 2 &&
              agentState(snapshot, "codex")?.verification?.status === status,
          );
          assert.equal(yield* Ref.get(probes), 2);
          assert.equal(yield* Ref.get(writes), status === "authenticated" ? 2 : 0);
        }),
      ),
    );
  });

  itEffect.layer(NodeServices.layer)("ZeropsAgentAuth signer", (it) => {
    it.effect("is published with the re-check that follows a sign-in made here", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { feed, subscription, signers } = yield* makeFeed({ "claude-code": "user-b" });
          assert.equal(
            agentState(subscription.latest, "claude-code")?.authorizedBy?.subject,
            "user-b",
          );

          yield* Ref.set(signers, { "claude-code": "user-a" });
          yield* feed.recheckNow("claude-code");
          const published = yield* changeWhere(
            subscription,
            (snapshot) => agentState(snapshot, "claude-code")?.authorizedBy?.subject === "user-a",
          );

          assert.equal(agentState(published, "claude-code")?.authorizedBy?.subject, "user-a");
          // A subscriber arriving now (a reload) starts from the same snapshot.
          assert.equal(
            agentState(yield* feed.latest, "claude-code")?.authorizedBy?.subject,
            "user-a",
          );
        }),
      ),
    );
  });
});

// A turn that failed because its agent is not signed in re-asks the agent's
// own CLI at once, instead of the card saying "Authorized" until the next
// credential event. The platform flag still decides: the state stays what the
// flag says, and the re-probe only refines it (`needs-reauth`).
describe("a turn's authentication failure", () => {
  const agentState = (snapshot: ZeropsAgentAuthSnapshot, agentId: ZeropsAgentId) =>
    snapshot.agents.find((agent) => agent.agentId === agentId);

  const noWatch = (): WatcherHandle => ({ dispose: () => {} });

  /** Blocks the current fiber for the next matching publish. */
  const changeWhere = (
    subscription: { readonly changes: Stream.Stream<ZeropsAgentAuthSnapshot> },
    predicate: (snapshot: ZeropsAgentAuthSnapshot) => boolean,
  ) =>
    Stream.runHead(Stream.filter(subscription.changes, predicate)).pipe(
      Effect.map(Option.getOrThrow),
    );

  itEffect.layer(NodeServices.layer)("ZeropsAgentAuth turn auth failures", (it) => {
    it.effect("re-probes the agent, and the flag still decides", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const homeDir = yield* fs.makeTempDirectoryScoped({ prefix: "mate-agent-auth-turn-" });
          const envStorePath = path.join(homeDir, "zembed-env.json");
          yield* fs.writeFileString(envStorePath, '{"ZCP_AGENT_OAUTH_CLAUDE_CODE":"true"}');
          const credential = path.join(homeDir, ".claude", ".credentials.json");
          yield* fs.makeDirectory(path.dirname(credential), { recursive: true });
          yield* fs.writeFileString(credential, "{}");

          const answer = yield* Ref.make<"authenticated" | "unauthenticated">("authenticated");
          const probes = yield* Ref.make(0);
          const failures = yield* Queue.unbounded<ZeropsAgentId>();
          const feed = yield* make({
            // The flag is already set; the startup check's write finds it so.
            agentFlag: {
              markSignedIn: () =>
                Effect.succeed({
                  key: "ZCP_AGENT_OAUTH_CLAUDE_CODE",
                  changed: false,
                  migrated: false,
                }),
            },
            refreshProviderAuth: () =>
              Ref.update(probes, (n) => n + 1).pipe(
                Effect.andThen(Ref.get(answer)),
                Effect.map((status) => ({ status, checkedAt: 0 })),
              ),
            homeDir,
            envStorePath,
            isZeropsEnvironment: true,
            watch: noWatch,
            turnAuthFailures: Stream.fromQueue(failures),
          });
          const subscription = yield* feed.subscribe;
          yield* TestClock.adjust(Duration.seconds(2));
          yield* changeWhere(
            subscription,
            (snapshot) => agentState(snapshot, "claude-code")?.providerAuth === "authenticated",
          );
          const before = yield* Ref.get(probes);

          // The login expired; the next turn fails on it.
          yield* Ref.set(answer, "unauthenticated");
          yield* Queue.offer(failures, "claude-code");
          yield* TestClock.adjust(Duration.seconds(2));
          const published = yield* changeWhere(
            subscription,
            (snapshot) => agentState(snapshot, "claude-code")?.providerAuth === "unauthenticated",
          );

          assert.equal(yield* Ref.get(probes), before + 1);
          const claude = agentState(published, "claude-code")!;
          assert.equal(claude.providerAuth, "unauthenticated");
          assert.equal(claude.state, "authorized");
          assert.deepStrictEqual(classifyZeropsAgentAuth(claude), { kind: "needs-reauth" });
        }),
      ),
    );
  });
});
