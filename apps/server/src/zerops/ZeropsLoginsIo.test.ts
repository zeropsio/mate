import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
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

const makeHarness = (input: {
  readonly initial?: Instances;
  readonly verified?: ServerProviderAuthStatus;
  readonly signers?: Readonly<Record<string, string>>;
  readonly isZeropsEnvironment?: boolean;
  /**
   * Reads the tags as `ZeropsProjectSigners` does: `readSigners` answers its cached read, and
   * `readSignersFresh` reads `answer` now and caches it.
   */
  readonly cached?: boolean;
}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const homeDir = yield* fs.makeTempDirectoryScoped({ prefix: "mate-logins-home-" });
    const settings = yield* makeSettings(input.initial ?? {});
    const verifies = yield* Ref.make<ReadonlyArray<string>>([]);
    const reconciled = yield* Ref.make<ReadonlyArray<string>>([]);
    const fakeWatch = makeFakeWatch();
    const answer = yield* Ref.make<Readonly<Record<string, string>>>(input.signers ?? {});
    const cache = yield* Ref.make<Readonly<Record<string, string>>>(input.signers ?? {});
    const logins = yield* ZeropsLogins.make({
      ...settings.options,
      isZeropsEnvironment: input.isZeropsEnvironment ?? true,
      homeDir,
      verify: (login) =>
        Ref.update(verifies, (all) => [...all, login.id]).pipe(
          Effect.as(input.verified ?? "authenticated"),
        ),
      reconcile: (id, verified) => Ref.update(reconciled, (all) => [...all, `${id}:${verified}`]),
      readSigners: input.cached === true ? Ref.get(cache) : Effect.succeed(input.signers ?? {}),
      ...(input.cached === true
        ? {
            readSignersFresh: Ref.get(answer).pipe(Effect.tap((read) => Ref.set(cache, read))),
            signerRecordPoll: Duration.millis(10),
          }
        : {}),
      watch: fakeWatch.watch,
      checkDebounce: Duration.millis(10),
    });
    return { fs, homeDir, settings, verifies, reconciled, fakeWatch, logins, answer };
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
        const { id } = yield* logins.add({
          agent: "claude-code",
          kind: "subscription",
          label: "work",
        });

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

        const account = yield* logins.add({
          agent: "claude-code",
          kind: "subscription",
          label: "work",
        });
        const key = yield* logins.add({
          agent: "claude-code",
          kind: "apiKey",
          label: "",
          apiKey: "sk-ant-1",
        });
        const codex = yield* logins.add({ agent: "codex", kind: "subscription", label: "home" });

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
        const { fs, homeDir, verifies, reconciled, fakeWatch, logins } = yield* makeHarness({
          // The default Claude login is Jan's; this one is Eva's.
          signers: { "claude-code": "u-jan", "claudeAgent-work": "u-eva" },
        });
        const { id } = yield* logins.add({
          agent: "claude-code",
          kind: "subscription",
          label: "work",
        });
        const subscription = yield* logins.subscribe;

        yield* fs.writeFileString(`${homeDir}/.mate/logins/${id}/.credentials.json`, "{}");
        fakeWatch.trigger(`${homeDir}/.mate/logins/${id}/.credentials.json`);
        const signedIn = yield* listWhere(subscription, (rows) => rows[0]?.state === "authorized");

        assert.strictEqual(signedIn[0]?.signedInBy, "u-eva");
        assert.includeMembers([...(yield* Ref.get(verifies))], [id]);
        // After the publish: the row flips first, the picker's re-probe follows.
        yield* Effect.sleep(Duration.millis(20));
        assert.include([...(yield* Ref.get(reconciled))], `${id}:authenticated`);
      }),
    ),
  );

  // Eva signs in over Jan's record: the cached read names Jan after Eva's record landed, and
  // nothing else would republish. The sign-in made here reads afresh until it names Eva.
  it.effect("publishes the record of a sign-in made here as soon as it lands", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { fs, homeDir, fakeWatch, logins, answer } = yield* makeHarness({
          signers: { "claudeAgent-work": "u-jan" },
          cached: true,
        });
        const { id } = yield* logins.add({
          agent: "claude-code",
          kind: "subscription",
          label: "work",
        });
        const subscription = yield* logins.subscribe;
        yield* fs.writeFileString(`${homeDir}/.mate/logins/${id}/.credentials.json`, "{}");
        fakeWatch.trigger(`${homeDir}/.mate/logins/${id}/.credentials.json`);
        yield* listWhere(subscription, (rows) => rows[0]?.signedInBy === "u-jan");

        yield* logins.recheckNow(id, "u-eva");
        yield* Ref.set(answer, { [id]: "u-eva" });
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
        const { id } = yield* before.logins.add({
          agent: "claude-code",
          kind: "subscription",
          label: "work",
        });
        yield* before.fs.writeFileString(
          `${before.homeDir}/.mate/logins/${id}/.credentials.json`,
          "{}",
        );

        const store = yield* memorySignInStore({ [id]: { by: "u-eva", at: 1 } });
        const restarted = yield* ZeropsLogins.make({
          ...before.settings.options,
          isZeropsEnvironment: true,
          homeDir: before.homeDir,
          verify: () => Effect.succeed("authenticated" as const),
          watch: makeFakeWatch().watch,
          checkDebounce: Duration.millis(10),
        });
        yield* ZeropsAgentLoginModule.make({
          terminalManager: {} as Parameters<
            typeof ZeropsAgentLoginModule.make
          >[0]["terminalManager"],
          zeropsAgentAuth: { recheckNow: () => Effect.void },
          isZeropsEnvironment: true,
          signIns: store,
          credentialsHeld: ZeropsAgentLoginModule.credentialsHeldOf(
            { latest: Effect.succeed({ available: false, agents: [] }), changes: Stream.empty },
            restarted,
          ),
        });
        yield* Effect.sleep(Duration.millis(5));
        assert.deepStrictEqual((yield* store.load)[id]?.by, "u-eva", "before the first check");
        const subscription = yield* restarted.subscribe;
        yield* listWhere(subscription, (rows) => rows[0]?.state === "authorized");
        yield* Effect.sleep(Duration.millis(20));
        assert.deepStrictEqual((yield* store.load)[id]?.by, "u-eva", "after it");
      }),
    ),
  );

  it.effect("lets a login's signer go once its first check finds no credential", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { logins } = yield* makeHarness({});
        const { id } = yield* logins.add({
          agent: "claude-code",
          kind: "subscription",
          label: "x",
        });
        const store = yield* memorySignInStore({ [id]: { by: "u-eva", at: 1 } });
        yield* ZeropsAgentLoginModule.make({
          terminalManager: {} as Parameters<
            typeof ZeropsAgentLoginModule.make
          >[0]["terminalManager"],
          zeropsAgentAuth: { recheckNow: () => Effect.void },
          isZeropsEnvironment: true,
          signIns: store,
          credentialsHeld: ZeropsAgentLoginModule.credentialsHeldOf(
            { latest: Effect.succeed({ available: false, agents: [] }), changes: Stream.empty },
            logins,
          ),
        });
        yield* logins.recheckNow(id);
        yield* Effect.sleep(Duration.millis(50));
        assert.isUndefined((yield* store.load)[id]);
      }),
    ),
  );

  it.effect("lists an API key signed in the moment it is stored, and asks no CLI", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { settings, verifies, logins } = yield* makeHarness({
          signers: { "claudeAgent-api-key": "u-eva" },
        });
        const { id } = yield* logins.add({
          agent: "claude-code",
          kind: "apiKey",
          label: "",
          apiKey: "sk-ant-1",
        });

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
        yield* Effect.sleep(Duration.millis(50));
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
          const refused = yield* Effect.flip(logins.add(input));
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
        const { id } = yield* logins.add({ agent: "codex", kind: "subscription", label: "home" });
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
        const { id } = yield* logins.add({ agent: "codex", kind: "subscription", label: "home" });
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
          logins.add({ agent: "codex", kind: "subscription", label: "home" }),
        );
        assert.strictEqual(refused.reason, "unavailable");
      }),
    ),
  );
});
