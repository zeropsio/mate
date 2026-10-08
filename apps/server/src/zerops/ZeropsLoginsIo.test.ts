import * as NodeServices from "@effect/platform-node/NodeServices";
import { handledQueue } from "@t3tools/shared/testing/handledQueue";
import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";
import * as Stream from "effect/Stream";

import type {
  ProviderInstanceConfig,
  ServerProviderAuthStatus,
  ZeropsLogin,
} from "@t3tools/contracts";

import type { WatcherHandle } from "./ZeropsAgentAuthWatcher.ts";
import * as ZeropsAgentLoginModule from "./ZeropsAgentLogin.ts";
import * as ZeropsLogins from "./ZeropsLogins.ts";
import { memorySignInStore } from "./zeropsSignIns.ts";

type Instances = Readonly<Record<string, ProviderInstanceConfig>>;

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

/** The settings' provider instances: what the service reads, writes and hears change. */
const makeSettings = (initial: Instances) =>
  Effect.gen(function* () {
    const current = yield* Ref.make<Instances>(initial);
    const changes = yield* PubSub.unbounded<Instances>();
    return {
      current,
      /** A change made elsewhere — the settings screen, another client. */
      replace: (next: Instances) =>
        Ref.set(current, next).pipe(Effect.andThen(PubSub.publish(changes, next))),
      options: {
        readInstances: Ref.get(current),
        instanceChanges: Stream.fromPubSub(changes),
        writeInstances: (next: Instances) =>
          Ref.set(current, next).pipe(Effect.andThen(PubSub.publish(changes, next)), Effect.asVoid),
      },
    };
  });

/** Watchers by target; the test fires them. */
const makeFakeWatch = () => {
  const handlers = new Map<string, () => void>();
  return {
    watch: (target: string, _fallback: string, onChange: () => void): WatcherHandle => {
      handlers.set(target, onChange);
      return {
        dispose: () => {
          handlers.delete(target);
        },
      };
    },
    trigger: (target: string) => handlers.get(target)?.(),
    watching: () => [...handlers.keys()],
  };
};

/** The session that adds a login: Eva's, as the door names her. */
const SESSION = "zerops-user:u-eva";

const makeHarness = (input: {
  readonly initial?: Instances;
  readonly verified?: ServerProviderAuthStatus;
  readonly signers?: Readonly<Record<string, string>>;
  readonly isZeropsEnvironment?: boolean;
}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const homeDir = yield* fs.makeTempDirectoryScoped({ prefix: "mate-logins-home-" });
    const settings = yield* makeSettings(input.initial ?? {});
    const verifies = yield* Ref.make<ReadonlyArray<string>>([]);
    const reconciled = yield* Ref.make<ReadonlyArray<string>>([]);
    const reconciliation = yield* Queue.unbounded<string>();
    const fakeWatch = makeFakeWatch();
    const signIns = yield* memorySignInStore(
      Object.fromEntries(
        Object.entries(input.signers ?? {}).map(([key, by]) => [key, { by, at: 1 }]),
      ),
    );
    const logins = yield* ZeropsLogins.make({
      ...settings.options,
      isZeropsEnvironment: input.isZeropsEnvironment ?? true,
      homeDir,
      verify: (login) =>
        Ref.update(verifies, (all) => [...all, login.id]).pipe(
          Effect.as({
            status: input.verified ?? "authenticated",
            checkedAt: 0,
            ...(input.verified === "unknown"
              ? { reason: "The login check returned an unrecognized answer." }
              : {}),
          }),
        ),
      reconcile: (id, verified) =>
        Ref.update(reconciled, (all) => [...all, `${id}:${verified}`]).pipe(
          Effect.andThen(Queue.offer(reconciliation, `${id}:${verified}`)),
          Effect.asVoid,
        ),
      signIns,
      readSigners: signIns.load.pipe(
        Effect.map((records) =>
          Object.fromEntries(Object.entries(records).map(([key, record]) => [key, record.by])),
        ),
      ),
      watch: fakeWatch.watch,
      checkDebounce: Duration.millis(10),
    });
    return {
      fs,
      homeDir,
      settings,
      verifies,
      reconciled,
      reconciliation,
      fakeWatch,
      logins,
      signIns,
    };
  });

/** Blocks this fiber for the next published list matching `predicate` (see `ZeropsAgentAuthIo.test.ts` on why it is not forked). */
const listWhere = (
  subscription: { readonly changes: Stream.Stream<ReadonlyArray<ZeropsLogin>> },
  predicate: (logins: ReadonlyArray<ZeropsLogin>) => boolean,
) =>
  Stream.runHead(Stream.filter(subscription.changes, predicate)).pipe(
    Effect.map(Option.getOrThrow),
  );

it.layer(NodeServices.layer, { excludeTestServices: true })("ZeropsLogins", (it) => {
  it.effect("adds a second account as an instance with its own home, not signed in yet", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { fs, homeDir, settings, logins } = yield* makeHarness({});
        const { id } = yield* logins.add(
          {
            agent: "claude-code",
            kind: "subscription",
            label: "work",
          },
          SESSION,
        );

        assert.strictEqual(id, "claudeAgent-work");
        const written = (yield* Ref.get(settings.current))[id];
        assert.deepStrictEqual(written?.config, { homePath: `${homeDir}/.mate/logins/${id}` });
        assert.isTrue(yield* fs.exists(`${homeDir}/.mate/logins/${id}`));
        assert.strictEqual((yield* logins.resolve(id))?.agent, "claude-code");
        assert.deepStrictEqual(
          (yield* logins.latest).map((login) => [login.id, login.state]),
          [[id, "not-authorized"]],
        );
      }),
    ),
  );

  it.effect("seeds a new Claude login's home with zcp's MCP server and a finished onboarding", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { fs, homeDir, logins } = yield* makeHarness({});
        const zerops = { command: "zcp", args: ["serve"] };
        yield* fs.writeFileString(
          `${homeDir}/.claude.json`,
          encodeJson({
            hasCompletedOnboarding: true,
            theme: "dark",
            mcpServers: { zerops },
            oauthAccount: { emailAddress: "jan@example.com" },
          }),
        );

        const account = yield* logins.add(
          {
            agent: "claude-code",
            kind: "subscription",
            label: "work",
          },
          SESSION,
        );
        const key = yield* logins.add(
          {
            agent: "claude-code",
            kind: "apiKey",
            label: "",
            apiKey: "sk-ant-1",
          },
          SESSION,
        );
        const codex = yield* logins.add(
          { agent: "codex", kind: "subscription", label: "home" },
          SESSION,
        );

        for (const { id } of [account, key]) {
          const path = `${homeDir}/.mate/logins/${id}/.claude.json`;
          assert.deepStrictEqual(decodeJson(yield* fs.readFileString(path)), {
            hasCompletedOnboarding: true,
            theme: "dark",
            mcpServers: { zerops },
          });
          // It may carry an MCP server's own environment: the login's alone.
          assert.strictEqual((yield* fs.stat(path)).mode & 0o777, 0o600);
        }
        assert.isFalse(yield* fs.exists(`${homeDir}/.mate/logins/${codex.id}/.claude.json`));
      }),
    ),
  );

  it.effect("checks a login's own CLI when its credential appears, and names its own signer", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { fs, homeDir, verifies, reconciled, reconciliation, fakeWatch, logins } =
          yield* makeHarness({
            // The default Claude login is Jan's; this one is Eva's.
            signers: { "claude-code": "u-jan", "claudeAgent-work": "u-eva" },
          });
        const { id } = yield* logins.add(
          {
            agent: "claude-code",
            kind: "subscription",
            label: "work",
          },
          SESSION,
        );
        const subscription = yield* logins.subscribe;

        yield* fs.writeFileString(`${homeDir}/.mate/logins/${id}/.credentials.json`, "{}");
        fakeWatch.trigger(`${homeDir}/.mate/logins/${id}/.credentials.json`);
        const signedIn = yield* listWhere(subscription, (rows) => rows[0]?.state === "authorized");

        assert.strictEqual(signedIn[0]?.signedInBy, "u-eva");
        assert.includeMembers([...(yield* Ref.get(verifies))], [id]);
        // After the publish: the row flips first, the picker's re-probe follows.
        assert.strictEqual(
          yield* Queue.take(reconciliation).pipe(Effect.timeout("5 seconds"), Effect.orDie),
          `${id}:authenticated`,
        );
        assert.include([...(yield* Ref.get(reconciled))], `${id}:authenticated`);
      }),
    ),
  );

  // Eva signs in over Jan: the walker keeps her sign-in, then asks for the re-check whose
  // publish names her.
  it.effect("an extra login ends an inconclusive check, and Check again asks once", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { fs, homeDir, logins, fakeWatch, verifies } = yield* makeHarness({
          verified: "unknown",
        });
        const subscription = yield* logins.subscribe;
        const { id } = yield* logins.add(
          { agent: "codex", kind: "subscription", label: "work" },
          SESSION,
        );
        const target = `${homeDir}/.mate/logins/${id}/auth.json`;
        yield* fs.writeFileString(target, "{}");
        fakeWatch.trigger(target);
        const ended = yield* listWhere(subscription, (rows) =>
          rows.some((row) => row.id === id && row.verification?.status === "unknown"),
        );
        assert.strictEqual(
          ended.find((row) => row.id === id)?.verification?.reason,
          "The login check returned an unrecognized answer.",
        );
        assert.deepEqual(yield* Ref.get(verifies), [id]);
        yield* logins.recheckNow(id);
        yield* listWhere(subscription, (rows) =>
          rows.some(
            (row) =>
              row.id === id &&
              row.verification?.generation ===
                (ended.find((entry) => entry.id === id)?.verification?.generation ?? 0) + 1 &&
              row.verification.status === "unknown",
          ),
        );
        assert.deepEqual(yield* Ref.get(verifies), [id, id]);
      }),
    ),
  );

  it.effect("names who signed in here with the re-check that follows the sign-in", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { fs, homeDir, fakeWatch, logins, signIns } = yield* makeHarness({
          signers: { "claudeAgent-work": "u-jan" },
        });
        const { id } = yield* logins.add(
          {
            agent: "claude-code",
            kind: "subscription",
            label: "work",
          },
          SESSION,
        );
        const subscription = yield* logins.subscribe;
        yield* fs.writeFileString(`${homeDir}/.mate/logins/${id}/.credentials.json`, "{}");
        fakeWatch.trigger(`${homeDir}/.mate/logins/${id}/.credentials.json`);
        yield* listWhere(subscription, (rows) => rows[0]?.signedInBy === "u-jan");

        yield* signIns.save(id, { by: "u-eva", at: 2 });
        yield* logins.recheckNow(id);
        const landed = yield* listWhere(subscription, (rows) => rows[0]?.signedInBy === "u-eva");

        assert.strictEqual(landed[0]?.signedInBy, "u-eva");
      }),
    ),
  );

  // A restart: the rows are listed before each login's first check answers, and read "not
  // signed in" meanwhile. Who signed a login in is let go only on an answer, never on that.
  it.effect("keeps a login's signer across a restart, before and after its first check", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const before = yield* makeHarness({});
        const { id } = yield* before.logins.add(
          {
            agent: "claude-code",
            kind: "subscription",
            label: "work",
          },
          SESSION,
        );
        yield* before.fs.writeFileString(
          `${before.homeDir}/.mate/logins/${id}/.credentials.json`,
          "{}",
        );

        const store = yield* memorySignInStore({ [id]: { by: "u-eva", at: 1 } });
        const restarted = yield* ZeropsLogins.make({
          ...before.settings.options,
          isZeropsEnvironment: true,
          homeDir: before.homeDir,
          verify: () => Effect.succeed({ status: "authenticated" as const, checkedAt: 0 }),
          watch: makeFakeWatch().watch,
          checkDebounce: Duration.millis(10),
        });
        yield* ZeropsAgentLoginModule.make({
          terminalManager: {} as Parameters<
            typeof ZeropsAgentLoginModule.make
          >[0]["terminalManager"],
          zeropsAgentAuth: { recheckNow: () => Effect.void },
          isZeropsEnvironment: true,
          homes: {} as Parameters<typeof ZeropsAgentLoginModule.make>[0]["homes"],
          signIns: store,
          credentialsHeld: ZeropsAgentLoginModule.credentialsHeldOf(
            { latest: Effect.succeed({ available: false, agents: [] }), changes: Stream.empty },
            restarted,
          ),
        });
        assert.deepStrictEqual((yield* store.load)[id]?.by, "u-eva", "before the first check");
        const subscription = yield* restarted.subscribe;
        yield* listWhere(subscription, (rows) => rows[0]?.state === "authorized");
        assert.deepStrictEqual((yield* store.load)[id]?.by, "u-eva", "after it");
      }),
    ),
  );

  it.effect("lets a login's signer go once its first check finds no credential", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { logins } = yield* makeHarness({});
        const { id } = yield* logins.add(
          {
            agent: "claude-code",
            kind: "subscription",
            label: "x",
          },
          SESSION,
        );
        const store = yield* memorySignInStore({ [id]: { by: "u-eva", at: 1 } });
        const cleared = yield* Deferred.make<void>();
        yield* ZeropsAgentLoginModule.make({
          terminalManager: {} as Parameters<
            typeof ZeropsAgentLoginModule.make
          >[0]["terminalManager"],
          zeropsAgentAuth: { recheckNow: () => Effect.void },
          isZeropsEnvironment: true,
          homes: {} as Parameters<typeof ZeropsAgentLoginModule.make>[0]["homes"],
          signIns: {
            ...store,
            clear: (key) =>
              store
                .clear(key)
                .pipe(
                  Effect.tap(() =>
                    key === id ? Deferred.succeed(cleared, undefined) : Effect.void,
                  ),
                ),
          },
          credentialsHeld: ZeropsAgentLoginModule.credentialsHeldOf(
            { latest: Effect.succeed({ available: false, agents: [] }), changes: Stream.empty },
            logins,
          ),
          credentialGoneAfter: Duration.millis(10),
        });
        yield* logins.recheckNow(id);
        yield* Deferred.await(cleared).pipe(Effect.timeout("5 seconds"), Effect.orDie);
        assert.isUndefined((yield* store.load)[id]);
      }),
    ),
  );

  // An API key has no sign-in to walk: whoever stores it signs it in, as the server saw them.
  it.effect("lists an API key signed in by whoever stored it, and asks no CLI", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { settings, verifies, logins, signIns } = yield* makeHarness({});
        const checked = yield* Stream.runHead(logins.credentials).pipe(
          Effect.timeout("5 seconds"),
          Effect.orDie,
          Effect.forkChild({ startImmediately: true }),
        );
        const { id } = yield* logins.add(
          { agent: "claude-code", kind: "apiKey", label: "", apiKey: "sk-ant-1" },
          SESSION,
        );
        assert.strictEqual((yield* signIns.load)[id]?.by, "u-eva");

        assert.deepStrictEqual((yield* Ref.get(settings.current))[id]?.environment, [
          { name: "ANTHROPIC_API_KEY", value: "sk-ant-1", sensitive: true },
        ]);
        const [row] = yield* logins.latest;
        assert.deepStrictEqual(
          [row?.kind, row?.state, row?.signedInBy],
          ["apiKey", "authorized", "u-eva"],
        );
        // The key never rides the feed.
        assert.notInclude(Object.values(row ?? {}).map(String), "sk-ant-1");
        assert.deepStrictEqual(Option.getOrThrow(yield* Fiber.join(checked)), [[id, true]]);
        assert.deepStrictEqual(yield* Ref.get(verifies), []);
      }),
    ),
  );

  it.effect("refuses a key for Codex and a key-less API key login", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { logins } = yield* makeHarness({});
        for (const input of [
          { agent: "codex", kind: "apiKey", label: "", apiKey: "k" },
          { agent: "claude-code", kind: "apiKey", label: "" },
          { agent: "codex", kind: "subscription", label: "", apiKey: "k" },
        ] as const) {
          const refused = yield* Effect.flip(logins.add(input, SESSION));
          assert.strictEqual(refused.reason, "invalid-login");
        }
        assert.deepStrictEqual(yield* logins.latest, []);
      }),
    ),
  );

  it.effect("forgets a login: its instance, its home, its row", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { fs, homeDir, settings, fakeWatch, logins } = yield* makeHarness({});
        const { id } = yield* logins.add(
          { agent: "codex", kind: "subscription", label: "home" },
          SESSION,
        );
        assert.lengthOf(fakeWatch.watching(), 1);

        yield* logins.forget(id);

        assert.deepStrictEqual(yield* Ref.get(settings.current), {});
        assert.isFalse(yield* fs.exists(`${homeDir}/.mate/logins/${id}`));
        assert.deepStrictEqual(yield* logins.latest, []);
        assert.deepStrictEqual(fakeWatch.watching(), []);
        assert.strictEqual((yield* Effect.flip(logins.forget(id))).reason, "unknown-login");
      }),
    ),
  );

  it.effect("follows a login removed in the settings elsewhere", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { settings, logins } = yield* makeHarness({});
        const { id } = yield* logins.add(
          { agent: "codex", kind: "subscription", label: "home" },
          SESSION,
        );
        const subscription = yield* logins.subscribe;

        yield* settings.replace({});

        yield* listWhere(subscription, (rows) => rows.length === 0);
        assert.isUndefined(yield* logins.resolve(id));
      }),
    ),
  );

  it.effect("keeps no logins outside a Zerops project", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { logins } = yield* makeHarness({ isZeropsEnvironment: false });
        assert.deepStrictEqual(yield* logins.latest, []);
        const refused = yield* Effect.flip(
          logins.add({ agent: "codex", kind: "subscription", label: "home" }, SESSION),
        );
        assert.strictEqual(refused.reason, "unavailable");
      }),
    ),
  );
});

it.layer(NodeServices.layer)("extra login attempts stay ended", (it) => {
  it.effect("time passing makes no check; a manual check makes one", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { fs, homeDir, logins, fakeWatch, verifies } = yield* makeHarness({
          verified: "unknown",
        });
        const subscription = yield* logins.subscribe;
        const { id } = yield* logins.add(
          { agent: "codex", kind: "subscription", label: "work" },
          SESSION,
        );
        const target = `${homeDir}/.mate/logins/${id}/auth.json`;
        yield* fs.writeFileString(target, "{}");
        fakeWatch.trigger(target);
        yield* TestClock.adjust("1 second");
        yield* listWhere(subscription, (rows) =>
          rows.some((row) => row.id === id && row.verification?.status === "unknown"),
        );
        assert.deepEqual(yield* Ref.get(verifies), [id]);
        yield* TestClock.adjust("1 day");
        assert.deepEqual(yield* Ref.get(verifies), [id]);
        yield* logins.recheckNow(id);
        yield* TestClock.adjust("1 second");
        yield* listWhere(subscription, (rows) =>
          rows.some((row) => row.id === id && row.verification?.status === "unknown"),
        );
        assert.deepEqual(yield* Ref.get(verifies), [id, id]);
      }),
    ),
  );
});

it.layer(NodeServices.layer)("credential watcher", (it) => {
  // Its stored key is an API key login's credential: the credential watch never lets its signer
  // go for want of a credential file it never has.
  it.effect("keeps an API key login's signer while its key is stored", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { logins, signIns } = yield* makeHarness({});
        const credentials = yield* handledQueue<ReadonlyArray<readonly [string, boolean]>>();
        const decisions = yield* Queue.unbounded<ReadonlyArray<readonly [string, boolean]>>();
        yield* ZeropsAgentLoginModule.credentialsHeldOf(
          { latest: Effect.succeed({ available: false, agents: [] }), changes: Stream.empty },
          logins,
        ).pipe(
          Stream.runForEach((rows) =>
            TestClock.withLive(credentials.publish(rows)).pipe(
              Effect.andThen(Queue.offer(decisions, rows)),
            ),
          ),
          Effect.forkChild({ startImmediately: true }),
        );
        yield* ZeropsAgentLoginModule.make({
          terminalManager: {} as Parameters<
            typeof ZeropsAgentLoginModule.make
          >[0]["terminalManager"],
          zeropsAgentAuth: { recheckNow: () => Effect.void },
          isZeropsEnvironment: true,
          homes: {} as Parameters<typeof ZeropsAgentLoginModule.make>[0]["homes"],
          signIns,
          credentialsHeld: credentials.events,
          credentialGoneAfter: Duration.millis(10),
        });
        const { id } = yield* logins.add(
          { agent: "claude-code", kind: "apiKey", label: "", apiKey: "sk-ant-1" },
          SESSION,
        );
        const checked = yield* Stream.runHead(
          Stream.fromQueue(decisions).pipe(
            Stream.filter((rows) => rows.some(([key]) => key === id)),
          ),
        ).pipe(
          Effect.timeout("5 seconds"),
          TestClock.withLive,
          Effect.orDie,
          Effect.forkChild({ startImmediately: true }),
        );
        yield* logins.recheckNow(id);
        // Run the login check's debounce, then wait until the credential consumer decided.
        yield* TestClock.adjust(Duration.millis(10));
        assert.deepStrictEqual(Option.getOrThrow(yield* Fiber.join(checked)), [[id, true]]);

        yield* TestClock.adjust(Duration.millis(10));
        assert.strictEqual((yield* signIns.load)[id]?.by, "u-eva");
      }),
    ),
  );
});
