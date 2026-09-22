import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it as itEffect } from "@effect/vitest";
import type { ZeropsAgentAuthSnapshot, ZeropsAgentId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { describe, expect, it } from "vite-plus/test";

import {
  SIGNER_RECHECK_INTERVAL,
  buildSnapshot,
  computeAgentAuthState,
  make,
  toZembedEnv,
} from "./ZeropsAgentAuth.ts";
import type { WatcherHandle } from "./ZeropsAgentAuthWatcher.ts";
import { ZeropsAgentFlagError } from "./ZeropsAgentFlag.ts";
import { SIGNERS_CACHE_TTL } from "./ZeropsProjectSigners.ts";

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

// The record is written by the client AFTER the login lands (the tag on the
// project, `useZeropsAgentSignerRecord`), so the publish the credential event
// triggers reads the signers before the record exists. Nothing else republishes
// on its own, so the feed re-reads for an agent still waiting on a signer, and
// only for one.
describe("signer catch-up", () => {
  it("re-reads just past the signers cache, so the read is never the cached miss", () => {
    expect(Duration.toMillis(SIGNER_RECHECK_INTERVAL)).toBeGreaterThan(
      Duration.toMillis(SIGNERS_CACHE_TTL),
    );
  });

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
   * A feed over a home directory whose Claude credential already exists, with
   * a `readSigners` fake that answers whatever `answer` holds and counts its
   * calls. The initial provider check the present credential requests is
   * drained first, so the reads that follow are the tick's alone.
   */
  const makeFeed = (input: {
    readonly signers: Readonly<Partial<Record<ZeropsAgentId, string>>>;
    /** The env store's document, as the file holds it. */
    readonly env?: string;
  }) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const homeDir = yield* fs.makeTempDirectoryScoped({ prefix: "mate-agent-auth-signers-" });
      const envStorePath = path.join(homeDir, "zembed-env.json");
      if (input.env !== undefined) {
        yield* fs.writeFileString(envStorePath, input.env);
      }
      const credential = path.join(homeDir, ".claude", ".credentials.json");
      yield* fs.makeDirectory(path.dirname(credential), { recursive: true });
      yield* fs.writeFileString(credential, "{}");

      const answer = yield* Ref.make(input.signers);
      const calls = yield* Ref.make(0);
      const feed = yield* make({
        agentFlag: {
          markSignedIn: () => Effect.fail(new ZeropsAgentFlagError({ reason: "not used" })),
        },
        refreshProviderAuth: () => Effect.succeed("unauthenticated" as const),
        homeDir,
        envStorePath,
        readSigners: Ref.update(calls, (n) => n + 1).pipe(Effect.andThen(Ref.get(answer))),
        isZeropsEnvironment: true,
        watch: noWatch,
      });
      const subscription = yield* feed.subscribe;
      yield* TestClock.adjust(Duration.seconds(2));
      yield* changeWhere(
        subscription,
        (snapshot) => agentState(snapshot, "claude-code")?.providerAuth === "unauthenticated",
      );
      return { feed, subscription, answer, calls };
    });

  itEffect.layer(NodeServices.layer)("ZeropsAgentAuth signer catch-up", (it) => {
    it.effect("publishes the signer recorded after the login once the interval passes", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { feed, subscription, answer } = yield* makeFeed({ signers: {} });
          assert.equal(agentState(subscription.latest, "claude-code")?.credPresent, true);
          assert.equal(agentState(subscription.latest, "claude-code")?.authorizedBy, undefined);

          yield* Ref.set(answer, { "claude-code": "user-a" });
          yield* TestClock.adjust(SIGNER_RECHECK_INTERVAL);
          const published = yield* changeWhere(
            subscription,
            (snapshot) => agentState(snapshot, "claude-code")?.authorizedBy !== undefined,
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

    it.effect("reads nothing when every credentialed agent already has its signer", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { subscription, calls } = yield* makeFeed({
            signers: { "claude-code": "user-a" },
          });
          assert.equal(
            agentState(subscription.latest, "claude-code")?.authorizedBy?.subject,
            "user-a",
          );
          const before = yield* Ref.get(calls);

          yield* TestClock.adjust(Duration.times(SIGNER_RECHECK_INTERVAL, 2));

          assert.equal(yield* Ref.get(calls), before);
        }),
      ),
    );

    it.effect("reads nothing for a token-authorized agent, whose key belongs to the project", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { subscription, calls } = yield* makeFeed({
            signers: {},
            env: '{"ZCP_AGENT_TOKEN_CLAUDE_CODE":"sk-project"}',
          });
          assert.equal(agentState(subscription.latest, "claude-code")?.state, "authorized-token");
          const before = yield* Ref.get(calls);

          yield* TestClock.adjust(Duration.times(SIGNER_RECHECK_INTERVAL, 2));

          assert.equal(yield* Ref.get(calls), before);
        }),
      ),
    );
  });
});
