import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import type {
  ServerProviderAuthStatus,
  ZeropsAgentAuthSnapshot,
  ZeropsAgentId,
} from "@t3tools/contracts";

import { ZeropsCliFailed, ZeropsCliNotFound, type ZeropsCli } from "./ZeropsCli.ts";
import * as ZeropsAgentAuth from "./ZeropsAgentAuth.ts";
import type { WatcherHandle } from "./ZeropsAgentAuthWatcher.ts";
import type { MarkAgentOAuthResult } from "./zeropsAgentAuthParse.ts";

const ZEMBED_ENV_FILE_NAME = "zembed-env.json";

interface FakeCli {
  readonly cli: Pick<ZeropsCli["Service"], "markAgentOAuth">;
  readonly calls: Ref.Ref<ReadonlyArray<string>>;
}

/** A fake `markAgentOAuth` that records every call, in order, by agent id. */
const makeFakeCli = (
  answer: () => Effect.Effect<MarkAgentOAuthResult, ZeropsCliNotFound | ZeropsCliFailed>,
) =>
  Effect.gen(function* () {
    const calls = yield* Ref.make<ReadonlyArray<string>>([]);
    const cli: Pick<ZeropsCli["Service"], "markAgentOAuth"> = {
      markAgentOAuth: (agentId) =>
        Ref.update(calls, (all) => [...all, agentId]).pipe(Effect.andThen(answer())),
    };
    return { cli, calls } satisfies FakeCli;
  });

interface FakeProviderAuth {
  readonly refreshProviderAuth: (agentId: ZeropsAgentId) => Effect.Effect<ServerProviderAuthStatus>;
  readonly calls: Ref.Ref<ReadonlyArray<ZeropsAgentId>>;
}

/**
 * A fake targeted provider refresh: records every call, in order, by agent
 * id, and answers with whatever `answer` returns for that agent — the real
 * per-instance `refreshInstance` + `auth.status` lookup lives only in
 * `ZeropsAgentAuth.layer`.
 */
const makeFakeProviderAuth = (answer: (agentId: ZeropsAgentId) => ServerProviderAuthStatus) =>
  Effect.gen(function* () {
    const calls = yield* Ref.make<ReadonlyArray<ZeropsAgentId>>([]);
    const refreshProviderAuth = (agentId: ZeropsAgentId) =>
      Ref.update(calls, (all) => [...all, agentId]).pipe(Effect.as(answer(agentId)));
    return { refreshProviderAuth, calls } satisfies FakeProviderAuth;
  });

/**
 * A fake `watch` collaborator: no real OS file watcher, just a registry of
 * `onChange` callbacks keyed by target path that the test fires explicitly.
 * `make`'s own transition-detection, debounce, mark-oauth spawn, and
 * provider-check logic all run for real — only "does the OS notice a file
 * changed" is replaced, since that mechanism (`watchWithFallback`) has its
 * own, separate test using plain Node `fs.watch`
 * (`ZeropsAgentAuthWatcher.test.ts`).
 */
interface FakeWatch {
  readonly watch: (target: string, fallbackDir: string, onChange: () => void) => WatcherHandle;
  readonly trigger: (target: string) => void;
}

const makeFakeWatch = (): FakeWatch => {
  const handlers = new Map<string, () => void>();
  return {
    watch: (target, _fallbackDir, onChange) => {
      handlers.set(target, onChange);
      return {
        dispose: () => {
          handlers.delete(target);
        },
      };
    },
    trigger: (target) => {
      handlers.get(target)?.();
    },
  };
};

const makeEnv = () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const homeDir = yield* fs.makeTempDirectoryScoped({ prefix: "mate-agent-auth-home-" });
    const zembedDir = yield* fs.makeTempDirectoryScoped({ prefix: "mate-agent-auth-zembed-" });
    const envStorePath = path.join(zembedDir, ZEMBED_ENV_FILE_NAME);
    return { fs, path, homeDir, envStorePath };
  });

const writeCredential = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  homeDir: string,
  segments: ReadonlyArray<string>,
) =>
  Effect.gen(function* () {
    const target = path.join(homeDir, ...segments);
    yield* fs.makeDirectory(path.dirname(target), { recursive: true });
    yield* fs.writeFileString(target, "{}");
  });

/**
 * Matches `path.join(homeDir, ...CRED_PROBE_SEGMENTS[agentId])` — since S7
 * follow-up F4, the credential watcher's target IS the credential file
 * itself (`ZeropsAgentAuth.ts`'s own `CRED_PROBE_SEGMENTS`), not its
 * containing `.claude` / `.codex` directory.
 */
const CRED_FILE_SEGMENTS: Readonly<Record<ZeropsAgentId, string>> = {
  "claude-code": ".claude/.credentials.json",
  codex: ".codex/auth.json",
};
const credWatchTarget = (homeDir: string, agentId: ZeropsAgentId): string =>
  `${homeDir}/${CRED_FILE_SEGMENTS[agentId]}`;

/**
 * Blocks the CURRENT fiber for the next published snapshot matching
 * `predicate` — deliberately NOT forked. Forking a second fiber to race
 * `Stream.runHead` against the watcher's own forked, debounce-driven
 * producer crashes this Effect build's scheduler (`self.addObserver is not
 * a function`, live-verified in isolation — two concurrently forked fibers,
 * one waking from a `Clock`-based `Stream.debounce` wait to perform a
 * `FileSystem`/registry op while the other awaits a `PubSub` read). Blocking
 * the test's own fiber directly sidesteps it entirely and is exactly as
 * deterministic: the watcher/provider-check fibers `make` starts internally
 * publish independently in the background regardless of whether this fiber
 * is racing them or waiting on them.
 *
 * The credential-presence flip and the provider-auth resolution are two
 * SEPARATE publishes (400ms watcher debounce, then a further ~1s coalesced
 * provider check) — most tests below wait for the second, later one.
 */
const changeWhere = (
  subscription: { readonly changes: Stream.Stream<ZeropsAgentAuthSnapshot> },
  predicate: (snapshot: ZeropsAgentAuthSnapshot) => boolean,
): Effect.Effect<ZeropsAgentAuthSnapshot> =>
  Stream.runHead(Stream.filter(subscription.changes, predicate)).pipe(
    Effect.map(Option.getOrThrow),
  );

const agentState = (
  snapshot: ZeropsAgentAuthSnapshot,
  agentId: ZeropsAgentId,
): ZeropsAgentAuthSnapshot["agents"][number] | undefined =>
  snapshot.agents.find((agent) => agent.agentId === agentId);

const claudeAuthResolved = (snapshot: ZeropsAgentAuthSnapshot): boolean =>
  agentState(snapshot, "claude-code")?.providerAuth !== "unknown";

it.layer(NodeServices.layer, { excludeTestServices: true })(
  "ZeropsAgentAuth — non-Zerops mode",
  (it) => {
    it.effect("reports available:false and starts no watchers", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { homeDir, envStorePath } = yield* makeEnv();
          const fake = yield* makeFakeCli(() =>
            Effect.fail(new ZeropsCliNotFound({ command: "zcp" })),
          );
          const fakeProviderAuth = yield* makeFakeProviderAuth(() => "unknown");
          const fakeWatch = makeFakeWatch();
          const feed = yield* ZeropsAgentAuth.make({
            cli: fake.cli,
            refreshProviderAuth: fakeProviderAuth.refreshProviderAuth,
            homeDir,
            envStorePath,
            isZeropsEnvironment: false,
            watch: fakeWatch.watch,
          });
          const snapshot = yield* feed.latest;
          assert.isFalse(snapshot.available);
          assert.deepEqual(snapshot.agents, []);
          assert.deepEqual(yield* Ref.get(fake.calls), []);
          assert.deepEqual(yield* Ref.get(fakeProviderAuth.calls), []);
        }),
      ),
    );
  },
);

it.layer(NodeServices.layer, { excludeTestServices: true })(
  "ZeropsAgentAuth — credential watcher",
  (it) => {
    it.effect(
      "spawns mark-oauth claude-code once the targeted provider check confirms authenticated",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const { fs, path, homeDir, envStorePath } = yield* makeEnv();
            const fake = yield* makeFakeCli(() =>
              Effect.succeed({
                key: "ZCP_AGENT_OAUTH_CLAUDE_CODE",
                changed: true,
                migrated: false,
              }),
            );
            const fakeProviderAuth = yield* makeFakeProviderAuth(() => "authenticated");
            const fakeWatch = makeFakeWatch();

            const feed = yield* ZeropsAgentAuth.make({
              cli: fake.cli,
              refreshProviderAuth: fakeProviderAuth.refreshProviderAuth,
              homeDir,
              envStorePath,
              isZeropsEnvironment: true,
              watch: fakeWatch.watch,
            });

            const before = yield* feed.latest;
            assert.equal(agentState(before, "claude-code")?.state, "not-authorized");
            assert.equal(agentState(before, "claude-code")?.providerAuth, "unknown");

            const subscription = yield* feed.subscribe;

            yield* writeCredential(fs, path, homeDir, [".claude", ".credentials.json"]);
            fakeWatch.trigger(credWatchTarget(homeDir, "claude-code"));
            const published = yield* changeWhere(subscription, claudeAuthResolved);

            const claude = agentState(published, "claude-code");
            assert.equal(claude?.credPresent, true);
            assert.equal(claude?.providerAuth, "authenticated");
            assert.equal(claude?.state, "local-only");

            assert.deepEqual(yield* Ref.get(fake.calls), ["claude-code"]);
            assert.deepEqual(yield* Ref.get(fakeProviderAuth.calls), ["claude-code"]);
          }),
        ),
    );

    it.effect(
      "a credential removal (logout) requests its own targeted check and flips providerAuth to unauthenticated (S7 fix2 F1)",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const { fs, path, homeDir, envStorePath } = yield* makeEnv();
            const fake = yield* makeFakeCli(() =>
              Effect.succeed({
                key: "ZCP_AGENT_OAUTH_CLAUDE_CODE",
                changed: true,
                migrated: false,
              }),
            );
            // The first check (credential present) reads authenticated; the
            // SECOND check (after removal) must actually run — a fake that
            // always answers the same way either way could not tell a real
            // fix from the old bug (no second check at all).
            const answers = yield* Ref.make<ReadonlyArray<ServerProviderAuthStatus>>([
              "authenticated",
              "unauthenticated",
            ]);
            const calls = yield* Ref.make<ReadonlyArray<ZeropsAgentId>>([]);
            const refreshProviderAuth = (agentId: ZeropsAgentId) =>
              Effect.gen(function* () {
                yield* Ref.update(calls, (all) => [...all, agentId]);
                const [next, ...rest] = yield* Ref.get(answers);
                yield* Ref.set(answers, rest);
                return next ?? "unauthenticated";
              });
            const fakeWatch = makeFakeWatch();

            const feed = yield* ZeropsAgentAuth.make({
              cli: fake.cli,
              refreshProviderAuth,
              homeDir,
              envStorePath,
              isZeropsEnvironment: true,
              watch: fakeWatch.watch,
            });

            const subscription = yield* feed.subscribe;
            const target = credWatchTarget(homeDir, "claude-code");
            const credentialPath = path.join(homeDir, ".claude", ".credentials.json");

            yield* writeCredential(fs, path, homeDir, [".claude", ".credentials.json"]);
            fakeWatch.trigger(target);
            const authenticated = yield* changeWhere(subscription, claudeAuthResolved);
            assert.equal(agentState(authenticated, "claude-code")?.providerAuth, "authenticated");

            yield* fs.remove(credentialPath);
            fakeWatch.trigger(target);
            const afterRemoval = yield* changeWhere(
              subscription,
              (snapshot) => agentState(snapshot, "claude-code")?.providerAuth === "unauthenticated",
            );

            const claude = agentState(afterRemoval, "claude-code");
            assert.equal(claude?.credPresent, false);
            assert.equal(claude?.providerAuth, "unauthenticated");
            assert.deepEqual(yield* Ref.get(calls), ["claude-code", "claude-code"]);
            // The removal's own check reads unauthenticated, so it is never
            // eligible to spawn mark-oauth — only the first (authenticated)
            // check was.
            assert.deepEqual(yield* Ref.get(fake.calls), ["claude-code"]);
          }),
        ),
    );

    it.effect(
      "does not spawn mark-oauth when the credential appears but the provider is not authenticated",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const { fs, path, homeDir, envStorePath } = yield* makeEnv();
            const fake = yield* makeFakeCli(() =>
              Effect.succeed({
                key: "ZCP_AGENT_OAUTH_CLAUDE_CODE",
                changed: true,
                migrated: false,
              }),
            );
            const fakeProviderAuth = yield* makeFakeProviderAuth(() => "unauthenticated");
            const fakeWatch = makeFakeWatch();

            const feed = yield* ZeropsAgentAuth.make({
              cli: fake.cli,
              refreshProviderAuth: fakeProviderAuth.refreshProviderAuth,
              homeDir,
              envStorePath,
              isZeropsEnvironment: true,
              watch: fakeWatch.watch,
            });

            const subscription = yield* feed.subscribe;
            yield* writeCredential(fs, path, homeDir, [".claude", ".credentials.json"]);
            fakeWatch.trigger(credWatchTarget(homeDir, "claude-code"));
            const published = yield* changeWhere(subscription, claudeAuthResolved);

            const claude = agentState(published, "claude-code");
            assert.equal(claude?.credPresent, true);
            assert.equal(claude?.providerAuth, "unauthenticated");
            // credPresent alone never gates the spawn — only an authenticated
            // provider check does.
            assert.deepEqual(yield* Ref.get(fake.calls), []);
          }),
        ),
    );

    it.effect(
      "does not re-spawn mark-oauth on a second confirmed-authenticated check for the same agent",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const { fs, path, homeDir, envStorePath } = yield* makeEnv();
            const fake = yield* makeFakeCli(() =>
              Effect.succeed({
                key: "ZCP_AGENT_OAUTH_CLAUDE_CODE",
                changed: true,
                migrated: false,
              }),
            );
            const fakeProviderAuth = yield* makeFakeProviderAuth(() => "authenticated");
            const fakeWatch = makeFakeWatch();

            const feed = yield* ZeropsAgentAuth.make({
              cli: fake.cli,
              refreshProviderAuth: fakeProviderAuth.refreshProviderAuth,
              homeDir,
              envStorePath,
              isZeropsEnvironment: true,
              watch: fakeWatch.watch,
            });

            const subscription = yield* feed.subscribe;
            yield* writeCredential(fs, path, homeDir, [".claude", ".credentials.json"]);
            fakeWatch.trigger(credWatchTarget(homeDir, "claude-code"));
            yield* changeWhere(subscription, claudeAuthResolved);
            assert.deepEqual(yield* Ref.get(fake.calls), ["claude-code"]);

            // A second, independent event for the same (still-present, still
            // authenticated) credential — e.g. the token file got rewritten.
            // It still triggers its own coalesced provider check (a
            // SEPARATE call, past the first one's debounce window
            // altogether), but `markedOAuth` keeps it from spawning again.
            fakeWatch.trigger(credWatchTarget(homeDir, "claude-code"));
            yield* Effect.sleep("1600 millis");

            assert.deepEqual(yield* Ref.get(fake.calls), ["claude-code"]);
            assert.deepEqual(yield* Ref.get(fakeProviderAuth.calls), [
              "claude-code",
              "claude-code",
            ]);
          }),
        ),
    );

    it.effect(
      "coalesces a burst of fs events into one targeted provider refresh",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const { fs, path, homeDir, envStorePath } = yield* makeEnv();
            const fake = yield* makeFakeCli(() =>
              Effect.succeed({
                key: "ZCP_AGENT_OAUTH_CLAUDE_CODE",
                changed: true,
                migrated: false,
              }),
            );
            const fakeProviderAuth = yield* makeFakeProviderAuth(() => "authenticated");
            const fakeWatch = makeFakeWatch();

            const feed = yield* ZeropsAgentAuth.make({
              cli: fake.cli,
              refreshProviderAuth: fakeProviderAuth.refreshProviderAuth,
              homeDir,
              envStorePath,
              isZeropsEnvironment: true,
              watch: fakeWatch.watch,
            });

            const subscription = yield* feed.subscribe;
            yield* writeCredential(fs, path, homeDir, [".claude", ".credentials.json"]);
            const target = credWatchTarget(homeDir, "claude-code");
            // A burst of 5 events, each one on its own past the credential
            // watcher's own 400ms debounce so each independently requests a
            // provider check — but all within the provider check's 1s
            // coalesce window, so only ONE check should actually run.
            for (let i = 0; i < 5; i += 1) {
              fakeWatch.trigger(target);
              yield* Effect.sleep("450 millis");
            }

            const published = yield* changeWhere(subscription, claudeAuthResolved);
            assert.equal(agentState(published, "claude-code")?.providerAuth, "authenticated");
            assert.deepEqual(yield* Ref.get(fakeProviderAuth.calls), ["claude-code"]);
            assert.deepEqual(yield* Ref.get(fake.calls), ["claude-code"]);
          }),
        ),
      10_000,
    );

    it.effect("spawns mark-oauth codex for the codex credential path", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { fs, path, homeDir, envStorePath } = yield* makeEnv();
          const fake = yield* makeFakeCli(() =>
            Effect.succeed({ key: "ZCP_AGENT_OAUTH_CODEX", changed: true, migrated: false }),
          );
          const fakeProviderAuth = yield* makeFakeProviderAuth(() => "authenticated");
          const fakeWatch = makeFakeWatch();

          const feed = yield* ZeropsAgentAuth.make({
            cli: fake.cli,
            refreshProviderAuth: fakeProviderAuth.refreshProviderAuth,
            homeDir,
            envStorePath,
            isZeropsEnvironment: true,
            watch: fakeWatch.watch,
          });

          const subscription = yield* feed.subscribe;
          yield* writeCredential(fs, path, homeDir, [".codex", "auth.json"]);
          fakeWatch.trigger(credWatchTarget(homeDir, "codex"));
          yield* changeWhere(
            subscription,
            (snapshot) => agentState(snapshot, "codex")?.providerAuth !== "unknown",
          );

          assert.deepEqual(yield* Ref.get(fake.calls), ["codex"]);
        }),
      ),
    );

    it.effect(
      "tolerates a missing ~/.codex directory at start (watchWithFallback attaches it once created — own test)",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const { homeDir, envStorePath } = yield* makeEnv();
            // homeDir exists; .codex does not — neither does .claude. `make`
            // must start cleanly and report credPresent:false for both, never
            // touching a real watcher (the fallback/re-attach mechanism itself
            // is ZeropsAgentAuthWatcher.test.ts's job).
            const fake = yield* makeFakeCli(() =>
              Effect.succeed({ key: "ZCP_AGENT_OAUTH_CODEX", changed: true, migrated: false }),
            );
            const fakeProviderAuth = yield* makeFakeProviderAuth(() => "unknown");
            const fakeWatch = makeFakeWatch();

            const feed = yield* ZeropsAgentAuth.make({
              cli: fake.cli,
              refreshProviderAuth: fakeProviderAuth.refreshProviderAuth,
              homeDir,
              envStorePath,
              isZeropsEnvironment: true,
              watch: fakeWatch.watch,
            });

            const initial = yield* feed.latest;
            assert.equal(agentState(initial, "codex")?.credPresent, false);
            assert.equal(agentState(initial, "claude-code")?.credPresent, false);
            // Nothing exists yet, so no provider check was requested either.
            assert.deepEqual(yield* Ref.get(fakeProviderAuth.calls), []);
          }),
        ),
    );

    it.effect("stops spawning once zcp is reported not found, but states keep flowing", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { fs, path, homeDir, envStorePath } = yield* makeEnv();
          const fake = yield* makeFakeCli(() =>
            Effect.fail(new ZeropsCliNotFound({ command: "zcp" })),
          );
          const fakeProviderAuth = yield* makeFakeProviderAuth(() => "authenticated");
          const fakeWatch = makeFakeWatch();

          const feed = yield* ZeropsAgentAuth.make({
            cli: fake.cli,
            refreshProviderAuth: fakeProviderAuth.refreshProviderAuth,
            homeDir,
            envStorePath,
            isZeropsEnvironment: true,
            watch: fakeWatch.watch,
          });

          const subscription = yield* feed.subscribe;
          yield* writeCredential(fs, path, homeDir, [".claude", ".credentials.json"]);
          fakeWatch.trigger(credWatchTarget(homeDir, "claude-code"));
          yield* changeWhere(subscription, claudeAuthResolved);
          assert.deepEqual(yield* Ref.get(fake.calls), ["claude-code"]);

          // codex appearing afterwards must still resolve providerAuth (states
          // keep flowing) but must not spawn a second time — zcp was marked
          // absent for good after the first attempt.
          yield* writeCredential(fs, path, homeDir, [".codex", "auth.json"]);
          fakeWatch.trigger(credWatchTarget(homeDir, "codex"));
          const published = yield* changeWhere(
            subscription,
            (snapshot) => agentState(snapshot, "codex")?.providerAuth !== "unknown",
          );

          assert.equal(agentState(published, "codex")?.credPresent, true);
          assert.equal(agentState(published, "codex")?.providerAuth, "authenticated");
          assert.deepEqual(yield* Ref.get(fake.calls), ["claude-code"]);
        }),
      ),
    );
  },
);

// `Effect.retry`'s `{schedule, times, while}` composition — including nested
// inside a debounce-driven, forkScoped watcher fiber — is proven correct in
// isolation (offline repro, not committed here). An end-to-end
// ZeropsCliFailed-retries-then-succeeds case is deliberately NOT covered by
// an automated test in this file: it was live-observed to silently give up
// after one attempt (skipping the retry delay) specifically when run
// THROUGH this suite's shared `it.layer` harness, a narrow interaction this
// Effect build's Clock/scheduler has with a SECOND Clock-consuming wait
// inside a fiber already woken from `Stream.debounce`'s own wait — not
// reproducible with the retry mechanism standalone. Left as a gap for the
// S7-3 live check against the real `zcp` binary (a real Clock, no debounce
// interference) rather than chasing the test-harness interaction further.

it.layer(NodeServices.layer, { excludeTestServices: true })(
  "ZeropsAgentAuth — env store watcher",
  (it) => {
    it.effect(
      "flips flagOAuth and refreshes providerAuth (never mark-oauth) when an oauth flag appears in the zembed store",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const { fs, homeDir, envStorePath } = yield* makeEnv();
            yield* fs.writeFileString(envStorePath, "{}");
            const fake = yield* makeFakeCli(() =>
              Effect.succeed({
                key: "ZCP_AGENT_OAUTH_CLAUDE_CODE",
                changed: true,
                migrated: false,
              }),
            );
            const fakeProviderAuth = yield* makeFakeProviderAuth(() => "authenticated");
            const fakeWatch = makeFakeWatch();

            const feed = yield* ZeropsAgentAuth.make({
              cli: fake.cli,
              refreshProviderAuth: fakeProviderAuth.refreshProviderAuth,
              homeDir,
              envStorePath,
              isZeropsEnvironment: true,
              watch: fakeWatch.watch,
            });

            const before = yield* feed.latest;
            assert.equal(agentState(before, "claude-code")?.state, "not-authorized");

            const subscription = yield* feed.subscribe;
            yield* fs.writeFileString(envStorePath, '{"ZCP_AGENT_OAUTH_CLAUDE_CODE":"true"}');
            fakeWatch.trigger(envStorePath);
            const published = yield* changeWhere(subscription, claudeAuthResolved);

            const claude = agentState(published, "claude-code");
            assert.equal(claude?.flagOAuth, true);
            assert.equal(claude?.providerAuth, "authenticated");
            // No credential file was ever written in this test: flagOAuth
            // true + credPresent false is the matrix's "reconnect" row.
            assert.equal(claude?.state, "reconnect");
            // The env-store path requests a targeted provider check to keep
            // providerAuth current, but never spawns mark-oauth itself — only
            // a credential-driven check does that.
            assert.deepEqual(yield* Ref.get(fake.calls), []);
            assert.deepEqual(yield* Ref.get(fakeProviderAuth.calls), ["claude-code"]);
          }),
        ),
    );
  },
);

it.layer(NodeServices.layer, { excludeTestServices: true })(
  "ZeropsAgentAuth — markedOAuth latch reset (S7 follow-up F2)",
  (it) => {
    it.effect(
      "re-marks after the platform OAuth flag disappears and a later check reads authenticated again",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const { fs, path, homeDir, envStorePath } = yield* makeEnv();
            yield* fs.writeFileString(envStorePath, '{"ZCP_AGENT_OAUTH_CLAUDE_CODE":"true"}');
            const fake = yield* makeFakeCli(() =>
              Effect.succeed({
                key: "ZCP_AGENT_OAUTH_CLAUDE_CODE",
                changed: true,
                migrated: false,
              }),
            );
            const fakeProviderAuth = yield* makeFakeProviderAuth(() => "authenticated");
            const fakeWatch = makeFakeWatch();

            const feed = yield* ZeropsAgentAuth.make({
              cli: fake.cli,
              refreshProviderAuth: fakeProviderAuth.refreshProviderAuth,
              homeDir,
              envStorePath,
              isZeropsEnvironment: true,
              watch: fakeWatch.watch,
            });

            const subscription = yield* feed.subscribe;

            // First sign-in: credential appears, provider check reads
            // authenticated, mark-oauth spawns once.
            yield* writeCredential(fs, path, homeDir, [".claude", ".credentials.json"]);
            fakeWatch.trigger(credWatchTarget(homeDir, "claude-code"));
            yield* changeWhere(subscription, claudeAuthResolved);
            assert.deepEqual(yield* Ref.get(fake.calls), ["claude-code"]);

            // The platform flag disappears (a GUI revoke) without this
            // process restarting. The latch must reset so the NEXT verified
            // credential re-marks.
            yield* fs.writeFileString(envStorePath, "{}");
            fakeWatch.trigger(envStorePath);
            // The env-store transition alone (oauth flag true -> absent) is
            // neither an "appeared" nor a "disappeared-then-reappeared"
            // credential/token event, so it never requests its own provider
            // check — wait on the credential file's still-fresh mtime
            // instead by re-triggering it below, which does.

            // The credential file is still present (never removed) and the
            // provider still answers authenticated — mirrors a revoke
            // followed by a fresh re-login while the local file itself
            // never round-trips through absence.
            fakeWatch.trigger(credWatchTarget(homeDir, "claude-code"));
            yield* Effect.sleep("1600 millis");

            assert.deepEqual(yield* Ref.get(fake.calls), ["claude-code", "claude-code"]);
          }),
        ),
      10_000,
    );
  },
);

it.layer(NodeServices.layer, { excludeTestServices: true })(
  "ZeropsAgentAuth — recheckNow (S7 follow-up F8)",
  (it) => {
    it.effect(
      "requests the same mark-oauth-eligible coalesced check a credential event would",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const { homeDir, envStorePath } = yield* makeEnv();
            const fake = yield* makeFakeCli(() =>
              Effect.succeed({
                key: "ZCP_AGENT_OAUTH_CLAUDE_CODE",
                changed: true,
                migrated: false,
              }),
            );
            const fakeProviderAuth = yield* makeFakeProviderAuth(() => "authenticated");
            const fakeWatch = makeFakeWatch();

            const feed = yield* ZeropsAgentAuth.make({
              cli: fake.cli,
              refreshProviderAuth: fakeProviderAuth.refreshProviderAuth,
              homeDir,
              envStorePath,
              isZeropsEnvironment: true,
              watch: fakeWatch.watch,
            });

            const subscription = yield* feed.subscribe;
            // No credential file was ever written and no watcher fired —
            // recheckNow alone drives the whole coalesced-check ->
            // mark-oauth pipeline.
            yield* feed.recheckNow("claude-code");
            const published = yield* changeWhere(subscription, claudeAuthResolved);

            assert.equal(agentState(published, "claude-code")?.providerAuth, "authenticated");
            assert.deepEqual(yield* Ref.get(fake.calls), ["claude-code"]);
          }),
        ),
    );

    it.effect("is a no-op when the feed is off (not a Zerops environment)", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { homeDir, envStorePath } = yield* makeEnv();
          const fake = yield* makeFakeCli(() =>
            Effect.fail(new ZeropsCliNotFound({ command: "zcp" })),
          );
          const fakeProviderAuth = yield* makeFakeProviderAuth(() => "authenticated");
          const fakeWatch = makeFakeWatch();

          const feed = yield* ZeropsAgentAuth.make({
            cli: fake.cli,
            refreshProviderAuth: fakeProviderAuth.refreshProviderAuth,
            homeDir,
            envStorePath,
            isZeropsEnvironment: false,
            watch: fakeWatch.watch,
          });

          yield* feed.recheckNow("claude-code");
          yield* Effect.sleep("100 millis");
          assert.deepEqual(yield* Ref.get(fake.calls), []);
          assert.deepEqual(yield* Ref.get(fakeProviderAuth.calls), []);
        }),
      ),
    );
  },
);
