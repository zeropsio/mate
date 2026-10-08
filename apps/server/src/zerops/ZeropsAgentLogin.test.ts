import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import type {
  TerminalAttachInput,
  TerminalAttachStreamEvent,
  TerminalCloseInput,
  TerminalOpenInput,
  TerminalSessionSnapshot,
  TerminalWriteInput,
  ZeropsAgentId,
} from "@t3tools/contracts";
import { TerminalNotRunningError, ZeropsAgentLoginError } from "@t3tools/contracts";
import { latestSucceededSignIn } from "@t3tools/shared/zeropsAgentAuth";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import type { TerminalManager } from "../terminal/Manager.ts";
import * as ZeropsAgentLoginModule from "./ZeropsAgentLogin.ts";
import { makeSignInStore, memorySignInStore, type SignInRecords } from "./zeropsSignIns.ts";
import type { ZeropsAgentLoginByAgent, ZeropsAgentLoginOptions } from "./ZeropsAgentLogin.ts";
import { makeLoginHomes, type LoginHomes, type LoginHomesOptions } from "./zeropsLoginHomes.ts";
import { mateLoginEnvironment } from "./ZeropsLogins.ts";

type TerminalManagerService = Pick<
  TerminalManager["Service"],
  "open" | "write" | "attachStream" | "close"
>;

interface WriteRecord {
  readonly threadId: string;
  readonly terminalId: string;
  readonly data: string;
}

interface FakeTerminalManager {
  readonly service: TerminalManagerService;
  readonly writes: Ref.Ref<ReadonlyArray<WriteRecord>>;
  readonly writeWhere: (predicate: (write: WriteRecord) => boolean) => Effect.Effect<WriteRecord>;
  readonly closed: Ref.Ref<ReadonlyArray<CloseRecord>>;
  readonly opened: Ref.Ref<
    ReadonlyArray<{
      readonly threadId: string;
      readonly terminalId: string;
      readonly env?: Readonly<Record<string, string>>;
    }>
  >;
  /** Delivers one `output` chunk to whatever session is currently attached to (threadId, terminalId). A no-op if nothing is attached. */
  readonly emit: (threadId: string, terminalId: string, data: string) => Effect.Effect<void>;
  /** Delivers the terminal's `exited` event, the way the manager does when its process ends. */
  readonly exit: (
    threadId: string,
    terminalId: string,
    ended: { readonly exitCode: number | null; readonly exitSignal: number | null },
  ) => Effect.Effect<void>;
}

interface CloseRecord {
  readonly threadId: string;
  readonly terminalId: string;
  readonly deleteHistory: boolean;
}

const sessionKey = (threadId: string, terminalId: string): string => `${threadId}::${terminalId}`;

const fakeSnapshot = (input: {
  threadId: string;
  terminalId: string;
}): TerminalSessionSnapshot => ({
  threadId: input.threadId,
  terminalId: input.terminalId,
  cwd: "/var/www",
  worktreePath: null,
  status: "running",
  pid: 1,
  history: "",
  exitCode: null,
  exitSignal: null,
  label: "",
  updatedAt: "2026-08-29T00:00:00.000Z",
});

const makeFakeTerminalManager = (): Effect.Effect<FakeTerminalManager> =>
  Effect.gen(function* () {
    const writes = yield* Ref.make<ReadonlyArray<WriteRecord>>([]);
    const written = yield* Queue.unbounded<WriteRecord>();
    const closed = yield* Ref.make<ReadonlyArray<CloseRecord>>([]);
    const opened = yield* Ref.make<
      ReadonlyArray<{
        threadId: string;
        terminalId: string;
        env?: Readonly<Record<string, string>>;
      }>
    >([]);
    const listeners = new Map<string, (event: TerminalAttachStreamEvent) => Effect.Effect<void>>();

    const service: TerminalManagerService = {
      open: (input: TerminalOpenInput) =>
        Ref.update(opened, (all) => [
          ...all,
          {
            threadId: input.threadId,
            terminalId: input.terminalId,
            ...(input.env === undefined ? {} : { env: input.env }),
          },
        ]).pipe(Effect.as(fakeSnapshot(input))),
      write: (input: TerminalWriteInput) =>
        Ref.update(writes, (all) => [
          ...all,
          { threadId: input.threadId, terminalId: input.terminalId, data: input.data },
        ]).pipe(Effect.andThen(Queue.offer(written, input)), Effect.asVoid),
      attachStream: (
        input: TerminalAttachInput,
        listener: (event: TerminalAttachStreamEvent) => Effect.Effect<void>,
      ) =>
        Effect.sync(() => {
          listeners.set(sessionKey(input.threadId, input.terminalId), listener);
          return () => {
            listeners.delete(sessionKey(input.threadId, input.terminalId));
          };
        }),
      close: (input: TerminalCloseInput) =>
        Ref.update(closed, (all) => [
          ...all,
          {
            threadId: input.threadId,
            terminalId: input.terminalId ?? "",
            deleteHistory: input.deleteHistory === true,
          },
        ]).pipe(Effect.asVoid),
    };

    const emit = (threadId: string, terminalId: string, data: string): Effect.Effect<void> =>
      Effect.gen(function* () {
        const listener = listeners.get(sessionKey(threadId, terminalId));
        if (listener !== undefined) {
          yield* listener({ type: "output", threadId, terminalId, data });
        }
      });

    const exit: FakeTerminalManager["exit"] = (threadId, terminalId, ended) =>
      Effect.gen(function* () {
        const listener = listeners.get(sessionKey(threadId, terminalId));
        if (listener !== undefined) {
          yield* listener({ type: "exited", threadId, terminalId, ...ended });
        }
      });

    const writeWhere = (predicate: (write: WriteRecord) => boolean) =>
      Stream.runHead(Stream.fromQueue(written).pipe(Stream.filter(predicate))).pipe(
        Effect.map(Option.getOrThrow),
        Effect.timeout("5 seconds"),
        Effect.orDie,
      );
    return {
      service,
      writes,
      writeWhere,
      closed,
      opened,
      emit,
      exit,
    } satisfies FakeTerminalManager;
  });

interface FakeAuth {
  readonly recheckNow: (agentId: ZeropsAgentId) => Effect.Effect<void>;
  readonly calls: Ref.Ref<ReadonlyArray<ZeropsAgentId>>;
}

const makeFakeAuth = (): Effect.Effect<FakeAuth> =>
  Effect.gen(function* () {
    const calls = yield* Ref.make<ReadonlyArray<ZeropsAgentId>>([]);
    return {
      recheckNow: (agentId) => Ref.update(calls, (all) => [...all, agentId]),
      calls,
    } satisfies FakeAuth;
  });

/** Scratch homes that are only names: each sign-in's CLI runs with `/pending/<key>`, nothing on disk. */
const namedHomes: LoginHomes = {
  prepare: (target) =>
    Effect.succeed({
      ...target.env,
      ...mateLoginEnvironment({ agent: target.agentId, home: `/pending/${target.key}` }),
    }),
  commit: () => Effect.void,
  discard: () => Effect.void,
};

const makeFeed = (options: Omit<ZeropsAgentLoginOptions, "homes">) =>
  ZeropsAgentLoginModule.make({ ...options, homes: namedHomes });

const loginOf = (
  logins: ZeropsAgentLoginByAgent,
  agentId: ZeropsAgentId,
): ZeropsAgentLoginByAgent[ZeropsAgentId] => logins[agentId];

/** Waits for the first published `changes` value satisfying `predicate`. */
const changeWhere = (
  changes: Stream.Stream<ZeropsAgentLoginByAgent>,
  predicate: (logins: ZeropsAgentLoginByAgent) => boolean,
): Effect.Effect<ZeropsAgentLoginByAgent> =>
  Stream.runHead(Stream.filter(changes, predicate)).pipe(Effect.map(Option.getOrThrow));

it.effect("start opens a dedicated terminal, writes the login command, and reaches menu", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fakeTerminal = yield* makeFakeTerminalManager();
      const fakeAuth = yield* makeFakeAuth();
      const feed = yield* makeFeed({
        terminalManager: fakeTerminal.service,
        zeropsAgentAuth: fakeAuth,
        isZeropsEnvironment: true,
      });

      const result = yield* feed.start("claude-code", "thread-1", "user-test");
      assert.equal(result.terminalId, "agent-login-claude-code");

      const opened = yield* Ref.get(fakeTerminal.opened);
      // Its CLI signs in in a scratch home, never the one its credential lives in.
      assert.deepEqual(opened, [
        {
          threadId: "thread-1",
          terminalId: "agent-login-claude-code",
          env: { CLAUDE_CONFIG_DIR: "/pending/claude-code" },
        },
      ]);

      const writes = yield* Ref.get(fakeTerminal.writes);
      assert.equal(writes.length, 1);
      // The shell ends with the CLI, so the terminal's exit is the login's.
      assert.equal(writes[0]?.data, "claude /login; exit\r");

      const logins = yield* feed.latest;
      assert.equal(loginOf(logins, "claude-code")?.phase, "menu");
      assert.equal(loginOf(logins, "claude-code")?.terminalId, "agent-login-claude-code");
    }),
  ),
);

it.effect(
  "a second start for the same agent re-attaches instead of writing the command again",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fakeTerminal = yield* makeFakeTerminalManager();
        const fakeAuth = yield* makeFakeAuth();
        const feed = yield* makeFeed({
          terminalManager: fakeTerminal.service,
          zeropsAgentAuth: fakeAuth,
          isZeropsEnvironment: true,
        });

        const first = yield* feed.start("claude-code", "thread-1", "user-test");
        const second = yield* feed.start("claude-code", "thread-1", "user-test");
        assert.equal(second.terminalId, first.terminalId);

        const writes = yield* Ref.get(fakeTerminal.writes);
        assert.equal(writes.length, 1);
        const opened = yield* Ref.get(fakeTerminal.opened);
        assert.equal(opened.length, 1);
      }),
    ),
);

it.effect("an auth URL chunk moves the phase to awaiting-browser with the url", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fakeTerminal = yield* makeFakeTerminalManager();
      const fakeAuth = yield* makeFakeAuth();
      const feed = yield* makeFeed({
        terminalManager: fakeTerminal.service,
        zeropsAgentAuth: fakeAuth,
        isZeropsEnvironment: true,
      });

      yield* feed.start("claude-code", "thread-1", "user-test");
      const subscription = yield* feed.subscribe;

      yield* fakeTerminal.emit(
        "thread-1",
        "agent-login-claude-code",
        "Browser didn't open? Use the url below to sign in (c to copy)\nhttps://claude.com/cai/oauth/authorize?state=abc\n",
      );

      const published = yield* changeWhere(
        subscription.changes,
        (logins) => loginOf(logins, "claude-code")?.phase === "awaiting-browser",
      );
      assert.equal(
        loginOf(published, "claude-code")?.url,
        "https://claude.com/cai/oauth/authorize?state=abc",
      );
    }),
  ),
);

it.effect(
  "an unrecognized menu screen redrawn identically does not republish (S7 fix2 finding 2)",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fakeTerminal = yield* makeFakeTerminalManager();
        const fakeAuth = yield* makeFakeAuth();
        const feed = yield* makeFeed({
          terminalManager: fakeTerminal.service,
          zeropsAgentAuth: fakeAuth,
          isZeropsEnvironment: true,
        });

        yield* feed.start("claude-code", "thread-1", "user-test");
        const subscription = yield* feed.subscribe;
        const firstPublished = yield* Stream.runHead(subscription.changes).pipe(Effect.forkChild);

        const unrecognizedMenu =
          "Select login method:\n1. Claude account with subscription\n2. Anthropic Console account\n";
        // Five identical redraws of the same unrecognized menu screen (the
        // live-observed case: 15 identical `menu` chunks in 4.5s) must not
        // each republish — only the URL chunk below, the first REAL
        // transition, should reach the subscriber.
        for (let i = 0; i < 5; i += 1) {
          yield* fakeTerminal.emit("thread-1", "agent-login-claude-code", unrecognizedMenu);
        }
        yield* fakeTerminal.emit(
          "thread-1",
          "agent-login-claude-code",
          "Browser didn't open? Use the url below to sign in (c to copy)\nhttps://claude.com/cai/oauth/authorize?state=abc\n",
        );

        const published = yield* Fiber.join(firstPublished);
        assert.equal(
          published._tag === "Some" ? loginOf(published.value, "claude-code")?.phase : undefined,
          "awaiting-browser",
        );
      }),
    ),
);

it.effect("codex: url and device code together move to awaiting-browser with both", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fakeTerminal = yield* makeFakeTerminalManager();
      const fakeAuth = yield* makeFakeAuth();
      const feed = yield* makeFeed({
        terminalManager: fakeTerminal.service,
        zeropsAgentAuth: fakeAuth,
        isZeropsEnvironment: true,
      });

      yield* feed.start("codex", "thread-1", "user-test");
      const subscription = yield* feed.subscribe;

      yield* fakeTerminal.emit(
        "thread-1",
        "agent-login-codex",
        "https://auth.openai.com/codex/device\nEnter this one-time code: ABCD-12345\n",
      );

      const published = yield* changeWhere(
        subscription.changes,
        (logins) => loginOf(logins, "codex")?.phase === "awaiting-browser",
      );
      const codex = loginOf(published, "codex");
      assert.equal(codex?.url, "https://auth.openai.com/codex/device");
      assert.equal(codex?.code, "ABCD-12345");
    }),
  ),
);

it.effect(
  "success runs the auth feed's recheckNow, publishes succeeded, and frees the agent for a fresh start",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fakeTerminal = yield* makeFakeTerminalManager();
        const fakeAuth = yield* makeFakeAuth();
        const feed = yield* makeFeed({
          terminalManager: fakeTerminal.service,
          zeropsAgentAuth: fakeAuth,
          isZeropsEnvironment: true,
        });

        yield* feed.start("claude-code", "thread-1", "user-test");
        const subscription = yield* feed.subscribe;

        yield* fakeTerminal.emit(
          "thread-1",
          "agent-login-claude-code",
          "Login successful. Press Enter to continue…\n",
        );

        const published = yield* changeWhere(
          subscription.changes,
          (logins) => loginOf(logins, "claude-code")?.phase === "succeeded",
        );
        assert.equal(loginOf(published, "claude-code")?.phase, "succeeded");
        assert.deepEqual(yield* Ref.get(fakeAuth.calls), ["claude-code"]);

        // The session is no longer active — a fresh start opens a NEW terminal
        // session (a second `open` + a second write of the login command).
        yield* feed.start("claude-code", "thread-1", "user-test");
        const opened = yield* Ref.get(fakeTerminal.opened);
        assert.equal(opened.length, 2);
        const writes = yield* Ref.get(fakeTerminal.writes);
        assert.equal(writes.length, 2);
      }),
    ),
);

it.effect("cancel writes Ctrl-C, closes the terminal, and publishes cancelled", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fakeTerminal = yield* makeFakeTerminalManager();
      const fakeAuth = yield* makeFakeAuth();
      const feed = yield* makeFeed({
        terminalManager: fakeTerminal.service,
        zeropsAgentAuth: fakeAuth,
        isZeropsEnvironment: true,
      });

      yield* feed.start("claude-code", "thread-1", "user-test");
      yield* feed.cancel("claude-code");

      const writes = yield* Ref.get(fakeTerminal.writes);
      assert.equal(writes[writes.length - 1]?.data, "\x03");
      const closed = yield* Ref.get(fakeTerminal.closed);
      assert.deepEqual(closed, [
        // start's fresh-terminal close, then cancel's own.
        { threadId: "thread-1", terminalId: "agent-login-claude-code", deleteHistory: true },
        { threadId: "thread-1", terminalId: "agent-login-claude-code", deleteHistory: false },
      ]);

      const logins = yield* feed.latest;
      assert.equal(loginOf(logins, "claude-code")?.phase, "cancelled");
    }),
  ),
);

it.effect("cancel is a no-op when no session is active for that agent", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fakeTerminal = yield* makeFakeTerminalManager();
      const fakeAuth = yield* makeFakeAuth();
      const feed = yield* makeFeed({
        terminalManager: fakeTerminal.service,
        zeropsAgentAuth: fakeAuth,
        isZeropsEnvironment: true,
      });

      yield* feed.cancel("codex");

      assert.deepEqual(yield* Ref.get(fakeTerminal.writes), []);
      assert.deepEqual(yield* Ref.get(fakeTerminal.closed), []);
      const logins = yield* feed.latest;
      assert.equal(loginOf(logins, "codex"), undefined);
    }),
  ),
);

it.effect("outside a Zerops environment, start and cancel both fail as unavailable", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fakeTerminal = yield* makeFakeTerminalManager();
      const fakeAuth = yield* makeFakeAuth();
      const feed = yield* makeFeed({
        terminalManager: fakeTerminal.service,
        zeropsAgentAuth: fakeAuth,
        isZeropsEnvironment: false,
      });

      const startError = yield* Effect.flip(feed.start("claude-code", "thread-1", "user-test"));
      assert.instanceOf(startError, ZeropsAgentLoginError);
      const cancelError = yield* Effect.flip(feed.cancel("claude-code"));
      assert.instanceOf(cancelError, ZeropsAgentLoginError);
      const submitError = yield* Effect.flip(feed.submitCode("claude-code", "abc#def"));
      assert.equal(reasonOf(submitError), "unavailable");

      assert.deepEqual(yield* Ref.get(fakeTerminal.opened), []);
    }),
  ),
);

// Real wall-clock time (`excludeTestServices: true` opts out of the default
// virtual TestClock, matching `ZeropsAgentAuthIo.test.ts`'s own established
// pattern for anything depending on a real debounce/timer delay) — the
// stall timer's `Stream.debounce` needs an actual second to pass.
it.layer(NodeServices.layer, { excludeTestServices: true })(
  "ZeropsAgentLogin — stall timer",
  (it) => {
    it.effect(
      "presses Enter after a second of silence in an unrecognized menu screen",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const fakeTerminal = yield* makeFakeTerminalManager();
            const fakeAuth = yield* makeFakeAuth();
            const feed = yield* makeFeed({
              terminalManager: fakeTerminal.service,
              zeropsAgentAuth: fakeAuth,
              isZeropsEnvironment: true,
            });

            yield* feed.start("claude-code", "thread-1", "user-test");
            yield* fakeTerminal.emit(
              "thread-1",
              "agent-login-claude-code",
              "Select login method:\n1. Claude account with subscription\n2. Anthropic Console account\n",
            );

            yield* fakeTerminal.writeWhere((write) => write.data === "\r");

            const writes = yield* Ref.get(fakeTerminal.writes);
            // The login command itself, then the stall's own auto-Enter.
            assert.equal(writes.length, 2);
            assert.equal(writes[1]?.data, "\r");
          }),
        ),
      10_000,
    );
  },
);

// Who signed in is recorded as a tag on the Mate's project, written by the app
// as the person (D6, `ZeropsProjectSigners`): this container's own key cannot
// write tags, so the record cannot live on its disk. All this feed does on
// success is ask the auth feed to republish, which re-reads the tags.
it.effect("asks the auth feed to republish when a login succeeds", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fakeTerminal = yield* makeFakeTerminalManager();
      const fakeAuth = yield* makeFakeAuth();
      const feed = yield* makeFeed({
        terminalManager: fakeTerminal.service,
        zeropsAgentAuth: fakeAuth,
        isZeropsEnvironment: true,
      });

      yield* feed.start("claude-code", "thread-1", "zerops-user-a");
      const subscription = yield* feed.subscribe;

      yield* fakeTerminal.emit(
        "thread-1",
        "agent-login-claude-code",
        "Login successful. Press Enter to continue…\n",
      );

      yield* changeWhere(
        subscription.changes,
        (logins) => loginOf(logins, "claude-code")?.phase === "succeeded",
      );

      assert.deepEqual(yield* Ref.get(fakeAuth.calls), ["claude-code"]);
    }),
  ),
);

// Eva signed in; Jan's sign-in fails to start. Eva's success is still the latest one, and the
// gate goes by it: a start that failed leaves the login as it was, never wipes who signed in.
it.effect("a start that fails leaves the latest success standing", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fakeTerminal = yield* makeFakeTerminalManager();
      const fakeAuth = yield* makeFakeAuth();
      let openFails = false;
      const feed = yield* makeFeed({
        terminalManager: {
          ...fakeTerminal.service,
          open: (input) =>
            openFails
              ? Effect.fail(
                  new TerminalNotRunningError({
                    threadId: input.threadId,
                    terminalId: input.terminalId,
                  }),
                )
              : fakeTerminal.service.open(input),
        },
        zeropsAgentAuth: fakeAuth,
        isZeropsEnvironment: true,
      });

      yield* feed.start("claude-code", "thread-1", "zerops-user-eva");
      yield* fakeTerminal.emit(
        "thread-1",
        "agent-login-claude-code",
        "Login successful. Press Enter to continue…\n",
      );
      const evas = loginOf(yield* feed.latest, "claude-code");
      assert.equal(evas?.phase, "succeeded");

      openFails = true;
      yield* Effect.flip(feed.start("claude-code", "thread-1", "zerops-user-jan"));

      const after = loginOf(yield* feed.latest, "claude-code");
      assert.equal(latestSucceededSignIn(after)?.startedBy, evas?.startedBy);
      assert.isDefined(evas?.startedBy);
    }),
  ),
);

// Who signed a login in last is kept across restarts (`zeropsSignIns`): written with every
// success, a fresh one replacing it, and gone with the credential.
it.effect("keeps who signed in last, and lets it go with the credential", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fakeTerminal = yield* makeFakeTerminalManager();
      const store = yield* memorySignInStore({ codex: { by: "user-gone", at: 1 } });
      const held = yield* Queue.unbounded<ReadonlyArray<readonly [string, boolean]>>();
      const feed = yield* makeFeed({
        terminalManager: fakeTerminal.service,
        zeropsAgentAuth: yield* makeFakeAuth(),
        isZeropsEnvironment: true,
        signIns: store,
        credentialsHeld: Stream.fromQueue(held),
      });
      const settle = TestClock.adjust(Duration.millis(5));
      const gone = TestClock.adjust(ZeropsAgentLoginModule.CREDENTIAL_GONE_AFTER);
      const succeed = (subject: string) =>
        Effect.gen(function* () {
          yield* feed.start("claude-code", "thread-1", subject);
          yield* fakeTerminal.emit(
            "thread-1",
            "agent-login-claude-code",
            "Login successful. Press Enter to continue…\n",
          );
        });

      // A credential gone while the server was down: its kept sign-in goes from the first reading.
      yield* Queue.offer(held, [
        ["claude-code", false],
        ["codex", false],
      ]);
      yield* gone;
      assert.deepEqual(yield* store.load, {});

      // A sign-in's own first moments, the credential not there yet: nothing is let go.
      yield* succeed("zerops-user-eva");
      yield* Queue.offer(held, [["claude-code", false]]);
      yield* settle;
      const evas = (yield* store.load)["claude-code"]?.by;
      assert.isDefined(evas);

      yield* Queue.offer(held, [["claude-code", true]]);
      yield* succeed("zerops-user-jan");
      const jans = (yield* store.load)["claude-code"]?.by;
      assert.notEqual(jans, evas, "a fresh sign-in replaces the one before");

      // Signed out: the credential goes, and its sign-in with it.
      yield* Queue.offer(held, [["claude-code", false]]);
      yield* gone;
      assert.deepEqual(yield* store.load, {});
    }),
  ),
);

// A credential's absence lets its kept sign-in go only once it lasts: a CLI that removes its
// credential before it writes the new one reads absent for a moment, and that moment must not
// leave the login nobody's.
it.effect.each(
  Array.from(
    [
      ["absent for one reading, then there again", [true, false, Duration.seconds(2), true], true],
      ["absent across two readings", [true, false, Duration.seconds(5), false], false],
      ["replaced by a rename, as Claude writes it: never absent", [true, true], true],
    ] as const,
    ([name, readings, kept]) => ({
      title: `a credential ${name}: its sign-in is ${kept ? "kept" : "let go"}`,
      readings,
      kept,
    }),
  ),
)("$title", ({ readings, kept }) =>
  Effect.scoped(
    Effect.gen(function* () {
      const store = yield* memorySignInStore({ "claude-code": { by: "user-eva", at: 1 } });
      const held = yield* Queue.unbounded<ReadonlyArray<readonly [string, boolean]>>();
      yield* makeFeed({
        terminalManager: (yield* makeFakeTerminalManager()).service,
        zeropsAgentAuth: yield* makeFakeAuth(),
        isZeropsEnvironment: true,
        signIns: store,
        credentialsHeld: Stream.fromQueue(held),
      });
      for (const reading of readings) {
        if (typeof reading === "boolean") {
          yield* Queue.offer(held, [["claude-code", reading]]);
          yield* TestClock.adjust(Duration.millis(5));
        } else {
          yield* TestClock.adjust(reading);
        }
      }
      yield* TestClock.adjust(ZeropsAgentLoginModule.CREDENTIAL_GONE_AFTER);

      assert.strictEqual((yield* store.load)["claude-code"]?.by === "user-eva", kept);
    }),
  ),
);

// A sign-in kept while the credential still reads absent is a fresh credential's: the wait on
// the absence before it never lets it go.
it.effect("a sign-in made while its credential reads absent outlives that absence", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fakeTerminal = yield* makeFakeTerminalManager();
      const store = yield* memorySignInStore();
      const held = yield* Queue.unbounded<ReadonlyArray<readonly [string, boolean]>>();
      const feed = yield* makeFeed({
        terminalManager: fakeTerminal.service,
        zeropsAgentAuth: yield* makeFakeAuth(),
        isZeropsEnvironment: true,
        signIns: store,
        credentialsHeld: Stream.fromQueue(held),
      });
      yield* Queue.offer(held, [["claude-code", false]]);
      yield* TestClock.adjust(Duration.seconds(2));
      yield* feed.start("claude-code", "thread-1", "zerops-user-eva");
      yield* fakeTerminal.emit(
        "thread-1",
        "agent-login-claude-code",
        "Login successful. Press Enter to continue…\n",
      );
      yield* TestClock.adjust(ZeropsAgentLoginModule.CREDENTIAL_GONE_AFTER);

      assert.isDefined((yield* store.load)["claude-code"]);
    }),
  ),
);

it.effect("starts over a kept sign-in no instant can hold, and keeps nobody for it", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fakeTerminal = yield* makeFakeTerminalManager();
      const feed = yield* makeFeed({
        terminalManager: fakeTerminal.service,
        zeropsAgentAuth: yield* makeFakeAuth(),
        isZeropsEnvironment: true,
        signIns: yield* memorySignInStore({
          "claude-code": { by: "user-eva", at: 1e20 },
          codex: { by: "user-ada", at: Number.NaN },
        }),
      });
      const latest = yield* feed.latest;
      assert.isUndefined(loginOf(latest, "claude-code"));
      assert.isUndefined(loginOf(latest, "codex"));
    }),
  ),
);

// A login whose CLI ended without the walker seeing success or failure (it
// crashed, was killed, printed something unrecognized and quit) must not sit
// in `menu` or `awaiting-browser` for ever: the terminal's exit ends it.
it.effect("a login whose process ends before it finished is failed with how it ended", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fakeTerminal = yield* makeFakeTerminalManager();
      const fakeAuth = yield* makeFakeAuth();
      const feed = yield* makeFeed({
        terminalManager: fakeTerminal.service,
        zeropsAgentAuth: fakeAuth,
        isZeropsEnvironment: true,
      });

      yield* feed.start("codex", "thread-1", "user-test");
      assert.equal(loginOf(yield* feed.latest, "codex")?.phase, "menu");

      yield* fakeTerminal.exit("thread-1", "agent-login-codex", { exitCode: 1, exitSignal: null });

      const login = loginOf(yield* feed.latest, "codex");
      assert.equal(login?.phase, "failed");
      assert.equal(
        login?.message,
        "The sign-in ended before it finished (exit code 1). Start it again.",
      );
      assert.deepEqual(yield* Ref.get(fakeAuth.calls), []);

      // Over: a new start opens a fresh terminal rather than re-attaching.
      yield* feed.start("codex", "thread-1", "user-test");
      assert.equal((yield* Ref.get(fakeTerminal.opened)).length, 2);
      assert.equal(loginOf(yield* feed.latest, "codex")?.phase, "menu");
    }),
  ),
);

it.effect("a login ended by a signal says so", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fakeTerminal = yield* makeFakeTerminalManager();
      const fakeAuth = yield* makeFakeAuth();
      const feed = yield* makeFeed({
        terminalManager: fakeTerminal.service,
        zeropsAgentAuth: fakeAuth,
        isZeropsEnvironment: true,
      });

      yield* feed.start("claude-code", "thread-1", "user-test");
      yield* fakeTerminal.exit("thread-1", "agent-login-claude-code", {
        exitCode: null,
        exitSignal: 9,
      });

      assert.equal(
        loginOf(yield* feed.latest, "claude-code")?.message,
        "The sign-in ended before it finished (signal 9). Start it again.",
      );
    }),
  ),
);

it.effect("an exit after the login succeeded changes nothing", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fakeTerminal = yield* makeFakeTerminalManager();
      const fakeAuth = yield* makeFakeAuth();
      const feed = yield* makeFeed({
        terminalManager: fakeTerminal.service,
        zeropsAgentAuth: fakeAuth,
        isZeropsEnvironment: true,
      });

      yield* feed.start("claude-code", "thread-1", "user-test");
      yield* fakeTerminal.emit(
        "thread-1",
        "agent-login-claude-code",
        "Login successful. Press Enter to continue…\n",
      );
      yield* fakeTerminal.exit("thread-1", "agent-login-claude-code", {
        exitCode: 0,
        exitSignal: null,
      });

      const evas = loginOf(yield* feed.latest, "claude-code");
      assert.equal(evas?.phase, "succeeded");
    }),
  ),
);

const isLoginError = Schema.is(ZeropsAgentLoginError);
const reasonOf = (error: unknown): string =>
  isLoginError(error) ? error.reason : "not a login error";

const CLAUDE_URL_SCREEN =
  "Browser didn't open? Use the url below to sign in (c to copy)\nhttps://claude.com/cai/oauth/authorize?state=abc\nPaste code here if prompted > ";

/** A Claude login at its code prompt: started, and the URL screen seen. */
const claudeAtCodePrompt = Effect.gen(function* () {
  const fakeTerminal = yield* makeFakeTerminalManager();
  const fakeAuth = yield* makeFakeAuth();
  const feed = yield* makeFeed({
    terminalManager: fakeTerminal.service,
    zeropsAgentAuth: fakeAuth,
    isZeropsEnvironment: true,
  });
  yield* feed.start("claude-code", "thread-1", "zerops-user:user-1");
  yield* fakeTerminal.emit("thread-1", "agent-login-claude-code", CLAUDE_URL_SCREEN);
  assert.equal(loginOf(yield* feed.latest, "claude-code")?.phase, "awaiting-browser");
  return { fakeTerminal, fakeAuth, feed };
});

it.effect(
  "start begins in a fresh terminal: the previous attempt's is closed with its history",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fakeTerminal = yield* makeFakeTerminalManager();
        const fakeAuth = yield* makeFakeAuth();
        const feed = yield* makeFeed({
          terminalManager: fakeTerminal.service,
          zeropsAgentAuth: fakeAuth,
          isZeropsEnvironment: true,
        });

        yield* feed.start("claude-code", "thread-1", "user-test");

        assert.deepEqual(yield* Ref.get(fakeTerminal.closed), [
          { threadId: "thread-1", terminalId: "agent-login-claude-code", deleteHistory: true },
        ]);
      }),
    ),
);

it.effect("the login carries the Zerops user id of whoever started it", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { feed } = yield* claudeAtCodePrompt;
      assert.equal(loginOf(yield* feed.latest, "claude-code")?.startedBy, "user-1");
    }),
  ),
);

it.effect(
  "submitCode types the code, then Enter in a later write, and moves to verifying-code",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { fakeTerminal, feed } = yield* claudeAtCodePrompt;
        const before = (yield* Ref.get(fakeTerminal.writes)).length;

        const submit = yield* feed.submitCode("claude-code", "abc123#state").pipe(Effect.forkChild);
        yield* TestClock.adjust("100 millis");
        yield* Fiber.join(submit);

        const writes = (yield* Ref.get(fakeTerminal.writes)).slice(before);
        assert.deepEqual(
          writes.map((write) => write.data),
          ["abc123#state", "\r"],
        );
        assert.equal(writes[0]?.terminalId, "agent-login-claude-code");
        const login = loginOf(yield* feed.latest, "claude-code");
        assert.equal(login?.phase, "verifying-code");
        assert.equal(login?.startedBy, "user-1");
      }),
    ),
);

it.effect("after a submitted code, the CLI's success line ends the login as succeeded", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { fakeTerminal, fakeAuth, feed } = yield* claudeAtCodePrompt;
      const submit = yield* feed.submitCode("claude-code", "abc123#state").pipe(Effect.forkChild);
      yield* TestClock.adjust("100 millis");
      yield* Fiber.join(submit);

      yield* fakeTerminal.emit(
        "thread-1",
        "agent-login-claude-code",
        "Login successful. Press Enter to continue\n",
      );

      const evas = loginOf(yield* feed.latest, "claude-code");
      assert.equal(evas?.phase, "succeeded");
      assert.deepEqual(yield* Ref.get(fakeAuth.calls), ["claude-code"]);
    }),
  ),
);

it.effect(
  "a wrong code fails the login with the CLI's recorded error (Claude 2.1.278, 2026-09-22)",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { fakeTerminal, feed } = yield* claudeAtCodePrompt;
        const submit = yield* feed.submitCode("claude-code", "wrong#code").pipe(Effect.forkChild);
        yield* TestClock.adjust("100 millis");
        yield* Fiber.join(submit);

        yield* fakeTerminal.emit(
          "thread-1",
          "agent-login-claude-code",
          "*******ode\nOAuth error: Request failed with status code 400\nPress Enter to retry.\n",
        );

        const login = loginOf(yield* feed.latest, "claude-code");
        assert.equal(login?.phase, "failed");
        assert.isDefined(login?.message);
      }),
    ),
);

it.effect("the code never reaches the published login state", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { feed } = yield* claudeAtCodePrompt;
      const submit = yield* feed
        .submitCode("claude-code", "secret-code-value#state")
        .pipe(Effect.forkChild);
      yield* TestClock.adjust("100 millis");
      yield* Fiber.join(submit);

      const published = Object.values(yield* feed.latest).flatMap((login) =>
        login === undefined ? [] : Object.values(login).map(String),
      );
      assert.isFalse(published.some((value) => value.includes("secret-code-value")));
    }),
  ),
);

it.effect("submitCode is refused when no login waits for a code", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fakeTerminal = yield* makeFakeTerminalManager();
      const fakeAuth = yield* makeFakeAuth();
      const feed = yield* makeFeed({
        terminalManager: fakeTerminal.service,
        zeropsAgentAuth: fakeAuth,
        isZeropsEnvironment: true,
      });

      // No session at all.
      const none = yield* Effect.flip(feed.submitCode("claude-code", "abc#def"));
      assert.equal(reasonOf(none), "not-awaiting-code");

      // A session still in its menu, before any prompt.
      yield* feed.start("claude-code", "thread-1", "user-test");
      const early = yield* Effect.flip(feed.submitCode("claude-code", "abc#def"));
      assert.equal(reasonOf(early), "not-awaiting-code");

      // Codex's device flow never takes a code back.
      yield* feed.start("codex", "thread-1", "user-test");
      yield* fakeTerminal.emit(
        "thread-1",
        "agent-login-codex",
        "Open this link\nhttps://auth.openai.com/codex/device\nEnter this one-time code\nABCD-EFGHI\n",
      );
      const codex = yield* Effect.flip(feed.submitCode("codex", "abc#def"));
      assert.equal(reasonOf(codex), "not-awaiting-code");

      const writes = yield* Ref.get(fakeTerminal.writes);
      assert.isFalse(writes.some((write) => write.data.includes("abc#def")));
    }),
  ),
);

// Crew mode's *Runs on*: a login beyond the two defaults signs in through the
// same walker, in its own terminal, with its own scratch home in the environment.
const WORK = {
  id: "claudeAgent-work",
  env: { CLAUDE_CONFIG_DIR: "/home/zerops/.mate/logins/claudeAgent-work" },
};

const makeWithLogins = Effect.gen(function* () {
  const fakeTerminal = yield* makeFakeTerminalManager();
  const fakeAuth = yield* makeFakeAuth();
  const loginChecks = yield* Ref.make<ReadonlyArray<string>>([]);
  const feed = yield* makeFeed({
    terminalManager: fakeTerminal.service,
    zeropsAgentAuth: fakeAuth,
    zeropsLogins: { recheckNow: (id) => Ref.update(loginChecks, (all) => [...all, id]) },
    isZeropsEnvironment: true,
  });
  return { fakeTerminal, fakeAuth, loginChecks, feed };
});

it.effect(
  "another login signs in in its own terminal, with its own scratch home in the environment",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { fakeTerminal, feed } = yield* makeWithLogins;

        const result = yield* feed.start("claude-code", "thread-1", "user-test", WORK);

        assert.equal(result.terminalId, "agent-login-claudeAgent-work");
        assert.deepEqual(yield* Ref.get(fakeTerminal.opened), [
          {
            threadId: "thread-1",
            terminalId: "agent-login-claudeAgent-work",
            env: { CLAUDE_CONFIG_DIR: "/pending/claudeAgent-work" },
          },
        ]);
        assert.equal((yield* Ref.get(fakeTerminal.writes))[0]?.data, "claude /login; exit\r");
        const logins = yield* feed.latest;
        assert.equal(logins[WORK.id]?.phase, "menu");
        assert.isUndefined(logins["claude-code"]);
      }),
    ),
);

it.effect("another login's success asks that login's own check, never its agent's", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { fakeTerminal, fakeAuth, loginChecks, feed } = yield* makeWithLogins;
      yield* feed.start("claude-code", "thread-1", "user-test", WORK);

      yield* fakeTerminal.emit(
        "thread-1",
        "agent-login-claudeAgent-work",
        "Login successful. Press Enter to continue…\n",
      );

      assert.equal((yield* feed.latest)[WORK.id]?.phase, "succeeded");
      assert.deepEqual(yield* Ref.get(loginChecks), [WORK.id]);
      assert.deepEqual(yield* Ref.get(fakeAuth.calls), []);
    }),
  ),
);

it.effect("an agent's default login and another of its logins sign in side by side", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { fakeTerminal, feed } = yield* makeWithLogins;
      yield* feed.start("claude-code", "thread-1", "user-test");
      yield* feed.start("claude-code", "thread-1", "user-test", WORK);
      assert.lengthOf(yield* Ref.get(fakeTerminal.opened), 2);

      yield* feed.cancel("claude-code", WORK.id);

      const logins = yield* feed.latest;
      assert.equal(logins[WORK.id]?.phase, "cancelled");
      assert.equal(logins["claude-code"]?.phase, "menu");
    }),
  ),
);

it.effect("submitCode with a login id types into that login's terminal", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { fakeTerminal, feed } = yield* makeWithLogins;
      yield* feed.start("claude-code", "thread-1", "user-test", WORK);
      yield* fakeTerminal.emit("thread-1", "agent-login-claudeAgent-work", CLAUDE_URL_SCREEN);
      const before = (yield* Ref.get(fakeTerminal.writes)).length;

      const submit = yield* feed
        .submitCode("claude-code", "abc123#state", WORK.id)
        .pipe(Effect.forkChild);
      yield* TestClock.adjust("100 millis");
      yield* Fiber.join(submit);

      const writes = (yield* Ref.get(fakeTerminal.writes)).slice(before);
      assert.deepEqual(
        writes.map((write) => [write.terminalId, write.data]),
        [
          ["agent-login-claudeAgent-work", "abc123#state"],
          ["agent-login-claudeAgent-work", "\r"],
        ],
      );
    }),
  ),
);

// The one snapshot `subscribeZeropsAgentAuth` sends: the agent rows as before,
// and every login — each with its own walker state, never another's.
it.effect("combines the agent rows, every login, and each login's own walker state", () =>
  Effect.gen(function* () {
    const walking = {
      phase: "menu",
      terminalId: "agent-login-claudeAgent-work",
      startedAt: yield* DateTime.now,
    } as const;
    const combined = ZeropsAgentLoginModule.combineAgentAuth(
      {
        available: true,
        agents: [
          {
            agentId: "claude-code",
            credPresent: true,
            flagOAuth: true,
            flagToken: false,
            providerAuth: "authenticated",
            state: "authorized",
          },
        ],
      },
      [
        {
          id: "claudeAgent-work",
          agent: "claude-code",
          label: "work",
          kind: "subscription",
          default: false,
          state: "not-authorized",
          token: false,
        },
      ],
      { "claude-code": undefined, "claudeAgent-work": walking },
    );

    assert.isUndefined(combined.agents[0]?.login);
    assert.deepEqual(
      combined.logins?.map((login) => [login.id, login.login?.phase]),
      [
        ["claudeAgent", undefined],
        ["claudeAgent-work", "menu"],
      ],
    );
  }),
);

// Every attempt carries the latest one that succeeded before it, so a later attempt cancelled or
// failed before the first one's record landed leaves who signed in known.
it("an attempt after a success carries it; a success carries none", () => {
  const at = (iso: string) => DateTime.makeUnsafe(iso);
  const eva = {
    phase: "succeeded",
    terminalId: "t",
    startedAt: at("2026-09-30T21:38:00.000Z"),
    startedBy: "eva",
  } as const;
  const jan = {
    phase: "starting",
    terminalId: "t",
    startedAt: at("2026-09-30T21:38:20.000Z"),
    startedBy: "jan",
  } as const;
  const started = ZeropsAgentLoginModule.withLatestSuccess(eva, jan);
  assert.deepStrictEqual(started.lastSucceeded, {
    startedAt: eva.startedAt,
    startedBy: "eva",
  });
  const cancelled = ZeropsAgentLoginModule.withLatestSuccess(started, {
    ...jan,
    phase: "cancelled",
  });
  assert.deepStrictEqual(cancelled.lastSucceeded, started.lastSucceeded);
  const janSucceeded = ZeropsAgentLoginModule.withLatestSuccess(cancelled, {
    ...jan,
    phase: "succeeded",
  });
  assert.isUndefined(janSucceeded.lastSucceeded);
  assert.isUndefined(ZeropsAgentLoginModule.withLatestSuccess(undefined, jan).lastSucceeded);
});

// A sign-in against real homes: its CLI signs in in a scratch home, and only a success moves what
// it wrote into the home the login works with.
interface RealLogin {
  readonly name: string;
  readonly agentId: ZeropsAgentId;
  /** Absent: the agent's default login. */
  readonly login?: (home: string) => ZeropsAgentLoginModule.LoginTarget;
  /** The credential the login works with. */
  readonly credential: (home: string) => string;
  /** The credential's name in any of the agent's homes. */
  readonly file: string;
  readonly variable: "CLAUDE_CONFIG_DIR" | "CODEX_HOME";
  readonly success: string;
}

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeJson = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
);

/** The JSON object a file holds. */
const readJson = (file: string) =>
  FileSystem.FileSystem.pipe(
    Effect.flatMap((fs) => fs.readFileString(file)),
    Effect.flatMap(decodeJson),
  );

const CLAUDE_SUCCESS = "Login successful. Press Enter to continue…\n";
const CODEX_SUCCESS = "Successfully logged in\n";

const REAL_LOGINS: ReadonlyArray<RealLogin> = [
  {
    name: "Claude's default login",
    agentId: "claude-code",
    credential: (home) => `${home}/.claude/.credentials.json`,
    file: ".credentials.json",
    variable: "CLAUDE_CONFIG_DIR",
    success: CLAUDE_SUCCESS,
  },
  {
    name: "another Claude login",
    agentId: "claude-code",
    login: (home) => ({
      id: "claudeAgent-work",
      env: { CLAUDE_CONFIG_DIR: `${home}/.mate/logins/claudeAgent-work` },
    }),
    credential: (home) => `${home}/.mate/logins/claudeAgent-work/.credentials.json`,
    file: ".credentials.json",
    variable: "CLAUDE_CONFIG_DIR",
    success: CLAUDE_SUCCESS,
  },
  {
    name: "Codex's default login",
    agentId: "codex",
    credential: (home) => `${home}/.codex/auth.json`,
    file: "auth.json",
    variable: "CODEX_HOME",
    success: CODEX_SUCCESS,
  },
  {
    name: "another Codex login",
    agentId: "codex",
    login: (home) => ({
      id: "codexAgent-work",
      env: { CODEX_HOME: `${home}/.mate/logins/codexAgent-work` },
    }),
    credential: (home) => `${home}/.mate/logins/codexAgent-work/auth.json`,
    file: "auth.json",
    variable: "CODEX_HOME",
    success: CODEX_SUCCESS,
  },
];

/**
 * A home whose login holds the credential `"old"`, with what zcp and the agents keep beside it:
 * Claude's global config with zcp's MCP server and the signed-in account, Codex's config and a
 * session.
 */
const seedHome = (row: RealLogin) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const home = yield* fs.makeTempDirectoryScoped({ prefix: "mate-login-homes-" });
    const credential = row.credential(home);
    yield* fs.makeDirectory(credential.slice(0, credential.lastIndexOf("/")), { recursive: true });
    yield* fs.writeFileString(credential, "old");
    const config = encodeJson({
      hasCompletedOnboarding: true,
      mcpServers: { zcp: { command: "zcp" } },
      oauthAccount: { emailAddress: "old@example.com" },
    });
    yield* fs.writeFileString(`${home}/.claude.json`, config);
    const claudeHome = row.login?.(home).env["CLAUDE_CONFIG_DIR"];
    if (claudeHome !== undefined) yield* fs.writeFileString(`${claudeHome}/.claude.json`, config);
    yield* fs.makeDirectory(`${home}/.codex/sessions`, { recursive: true });
    yield* fs.writeFileString(`${home}/.codex/config.toml`, "[mcp_servers.zcp]\n");
    yield* fs.writeFileString(`${home}/.codex/sessions/one.jsonl`, "{}\n");
    return home;
  });

const JAN = "zerops-user:user-jan";

/** A server over `home`: its scratch homes are real, its terminals and checks fakes. */
interface RealFeedOptions extends LoginHomesOptions {
  /** Who signed each login in before this server. */
  readonly signedIn?: SignInRecords;
}

const realFeed = (home: string, { signedIn, ...options }: RealFeedOptions = {}) =>
  Effect.gen(function* () {
    const fakeTerminal = yield* makeFakeTerminalManager();
    const fakeAuth = yield* makeFakeAuth();
    const loginChecks = yield* Ref.make<ReadonlyArray<string>>([]);
    const signIns = yield* memorySignInStore(signedIn);
    const fs = yield* FileSystem.FileSystem;
    const pending = yield* Deferred.make<void>();
    let committing = false;
    const homes = yield* makeLoginHomes(home, options).pipe(
      Effect.provideService(FileSystem.FileSystem, {
        ...fs,
        exists: (path) =>
          fs
            .exists(path)
            .pipe(
              Effect.tap((present) =>
                committing && !present ? Deferred.succeed(pending, undefined) : Effect.void,
              ),
            ),
      }),
    );
    const feed = yield* ZeropsAgentLoginModule.make({
      terminalManager: fakeTerminal.service,
      zeropsAgentAuth: fakeAuth,
      zeropsLogins: { recheckNow: (id) => Ref.update(loginChecks, (all) => [...all, id]) },
      isZeropsEnvironment: true,
      homes: {
        ...homes,
        commit: (target) =>
          Effect.suspend(() => {
            committing = true;
            return homes.commit(target).pipe(
              Effect.ensuring(
                Effect.sync(() => {
                  committing = false;
                }),
              ),
            );
          }),
      },
      signIns,
    });
    return {
      fakeTerminal,
      fakeAuth,
      loginChecks,
      signIns,
      feed,
      waitingCredential: Deferred.await(pending).pipe(Effect.timeout("5 seconds"), Effect.orDie),
    };
  });

/** Claude's global config for `row`: the default login's beside `~/.claude`, any other's in its home. */
const claudeConfigOf = (row: RealLogin, home: string): string => {
  const dir = row.login?.(home).env["CLAUDE_CONFIG_DIR"];
  return dir === undefined ? `${home}/.claude.json` : `${dir}/.claude.json`;
};

/** Starts `row`'s sign-in on a server over `home` and answers the scratch home its CLI runs in. */
const startReal = (row: RealLogin, home: string, options?: RealFeedOptions) =>
  Effect.gen(function* () {
    const server = yield* realFeed(home, options);
    const login = row.login?.(home);
    const key = login?.id ?? row.agentId;
    yield* server.feed.start(row.agentId, "thread-1", JAN, login);
    const scratch = (yield* Ref.get(server.fakeTerminal.opened))[0]?.env?.[row.variable];
    if (scratch === undefined)
      return yield* Effect.die("the sign-in opened without a scratch home");
    return { ...server, login, key, scratch };
  });

// A live clock: a success waits for its credential while real file reads run.
it.layer(NodeServices.layer, { excludeTestServices: true })(
  "ZeropsAgentLogin — scratch homes",
  (it) => {
    it.effect("a cancel while a success waits for its credential stays cancelled", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const row = REAL_LOGINS[0]!;
          const home = yield* seedHome(row);
          const { fakeTerminal, feed, key, waitingCredential } = yield* startReal(row, home, {
            credentialWait: Duration.millis(500),
          });

          const success = yield* fakeTerminal
            .emit("thread-1", ZeropsAgentLoginModule.loginTerminalId(key), row.success)
            .pipe(Effect.forkChild);
          yield* waitingCredential;
          yield* feed.cancel(row.agentId);
          yield* Fiber.join(success);

          assert.equal((yield* feed.latest)[key]?.phase, "cancelled");
          assert.equal(yield* fs.readFileString(row.credential(home)), "old");
        }),
      ),
    );

    it.effect("a sign-in whose terminal never opens leaves no scratch home", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const home = yield* seedHome(REAL_LOGINS[0]!);
          const fakeTerminal = yield* makeFakeTerminalManager();
          const feed = yield* ZeropsAgentLoginModule.make({
            terminalManager: {
              ...fakeTerminal.service,
              open: (input) =>
                Effect.fail(
                  new TerminalNotRunningError({
                    threadId: input.threadId,
                    terminalId: input.terminalId,
                  }),
                ),
            },
            zeropsAgentAuth: yield* makeFakeAuth(),
            isZeropsEnvironment: true,
            homes: yield* makeLoginHomes(home),
          });

          yield* Effect.flip(feed.start("claude-code", "thread-1", JAN));

          assert.isFalse(yield* fs.exists(`${home}/.mate/pending/claude-code`));
          assert.equal(yield* fs.readFileString(`${home}/.claude/.credentials.json`), "old");
        }),
      ),
    );

    it.effect.each(
      Array.from(REAL_LOGINS, (row) => ({
        title: `a cancelled sign-in keeps ${row.name}'s credential`,
        row,
      })),
    )("$title", ({ row }) =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const home = yield* seedHome(row);
          const { feed, login, key, scratch } = yield* startReal(row, home);
          assert.equal(scratch, `${home}/.mate/pending/${key}`);

          // The CLI signs in afresh, then the person gives up.
          yield* fs.writeFileString(`${scratch}/${row.file}`, "new");
          yield* feed.cancel(row.agentId, login?.id);

          assert.equal(yield* fs.readFileString(row.credential(home)), "old");
          assert.isFalse(yield* fs.exists(`${home}/.mate/pending/${key}`));
          // A scratch Codex home links into `~/.codex`; dropping it drops only the links.
          assert.equal(
            yield* fs.readFileString(`${home}/.codex/config.toml`),
            "[mcp_servers.zcp]\n",
          );
          assert.isTrue(yield* fs.exists(`${home}/.codex/sessions/one.jsonl`));
        }),
      ),
    );
    it.effect.each(
      Array.from(REAL_LOGINS, (row) => ({
        title: `a succeeded sign-in replaces ${row.name}'s credential, with its signer and flag`,
        row,
      })),
    )("$title", ({ row }) =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const home = yield* seedHome(row);
          const { fakeTerminal, fakeAuth, loginChecks, signIns, feed, key, scratch } =
            yield* startReal(row, home);

          yield* fs.writeFileString(`${scratch}/${row.file}`, "new");
          yield* fakeTerminal.emit(
            "thread-1",
            ZeropsAgentLoginModule.loginTerminalId(key),
            row.success,
          );

          assert.equal((yield* feed.latest)[key]?.phase, "succeeded");
          assert.equal(yield* fs.readFileString(row.credential(home)), "new");
          assert.equal((yield* signIns.load)[key]?.by, "user-jan");
          // The flag is the default login's check to write; another login's check is its own.
          assert.deepEqual(
            yield* Ref.get(fakeAuth.calls),
            key === row.agentId ? [row.agentId] : [],
          );
          assert.deepEqual(yield* Ref.get(loginChecks), key === row.agentId ? [] : [key]);
          // No CLI is left running in a scratch home that is gone.
          assert.deepInclude(yield* Ref.get(fakeTerminal.closed), {
            threadId: "thread-1",
            terminalId: ZeropsAgentLoginModule.loginTerminalId(key),
            deleteHistory: false,
          });
          assert.isFalse(yield* fs.exists(`${home}/.mate/pending/${key}`));
          assert.isTrue(yield* fs.exists(`${home}/.codex/sessions/one.jsonl`));
        }),
      ),
    );
    it.effect.each(
      Array.from(REAL_LOGINS, (row) => ({
        title: `a colleague's sign-in leaves ${row.name} theirs until it succeeds`,
        row,
      })),
    )("$title", ({ row }) =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const home = yield* seedHome(row);
          const key = row.login?.(home).id ?? row.agentId;
          const eva = { by: "user-eva", at: 1 };
          const { fakeTerminal, feed, login, signIns, scratch } = yield* startReal(row, home, {
            signedIn: { [key]: eva },
          });

          // Jan's attempt runs; Eva's login works on, its credential and its signer alike.
          yield* fs.writeFileString(`${scratch}/${row.file}`, "jan");
          assert.equal(yield* fs.readFileString(row.credential(home)), "old");
          assert.deepEqual(yield* signIns.load, { [key]: eva });

          yield* feed.cancel(row.agentId, login?.id);
          assert.equal(yield* fs.readFileString(row.credential(home)), "old");
          assert.deepEqual(yield* signIns.load, { [key]: eva });

          yield* feed.start(row.agentId, "thread-1", JAN, login);
          yield* fs.writeFileString(`${scratch}/${row.file}`, "jan");
          yield* fakeTerminal.emit(
            "thread-1",
            ZeropsAgentLoginModule.loginTerminalId(key),
            row.success,
          );
          assert.equal(yield* fs.readFileString(row.credential(home)), "jan");
          assert.equal((yield* signIns.load)[key]?.by, "user-jan");
        }),
      ),
    );
    it.effect.each(
      Array.from(REAL_LOGINS, (row) => ({
        title: `a sign-in whose CLI ends before it finished keeps ${row.name}'s credential`,
        row,
      })),
    )("$title", ({ row }) =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const home = yield* seedHome(row);
          const { fakeTerminal, feed, key, scratch, waitingCredential } = yield* startReal(
            row,
            home,
          );
          yield* fs.writeFileString(`${scratch}/${row.file}`, "new");

          yield* fakeTerminal.exit("thread-1", ZeropsAgentLoginModule.loginTerminalId(key), {
            exitCode: 1,
            exitSignal: null,
          });

          assert.equal((yield* feed.latest)[key]?.phase, "failed");
          assert.equal(yield* fs.readFileString(row.credential(home)), "old");
          assert.isFalse(yield* fs.exists(`${home}/.mate/pending/${key}`));
        }),
      ),
    );
    it.effect.each(
      Array.from(REAL_LOGINS, (row) => ({
        title: `a restart mid-sign-in keeps ${row.name}'s credential and clears its scratch home`,
        row,
      })),
    )("$title", ({ row }) =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const home = yield* seedHome(row);
          const { login, key, scratch } = yield* startReal(row, home);
          yield* fs.writeFileString(`${scratch}/${row.file}`, "new");

          // The server goes down mid-sign-in: the next one starts with no attempt of its own.
          const next = yield* realFeed(home);
          assert.isFalse(yield* fs.exists(`${home}/.mate/pending/${key}`));
          assert.equal(yield* fs.readFileString(row.credential(home)), "old");

          // Whatever the abandoned CLI still wrote never reaches the next attempt.
          yield* fs.makeDirectory(scratch, { recursive: true });
          yield* fs.writeFileString(`${scratch}/${row.file}`, "stray");
          yield* next.feed.start(row.agentId, "thread-1", JAN, login);
          assert.isFalse(yield* fs.exists(`${scratch}/${row.file}`));
          assert.equal(yield* fs.readFileString(row.credential(home)), "old");
        }),
      ),
    );
    it.effect.each(
      Array.from(REAL_LOGINS, (row) => ({
        title: `a credential written after its success line still signs ${row.name} in`,
        row,
      })),
    )("$title", ({ row }) =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const home = yield* seedHome(row);
          const { fakeTerminal, feed, key, scratch, waitingCredential } = yield* startReal(
            row,
            home,
          );

          const success = yield* fakeTerminal
            .emit("thread-1", ZeropsAgentLoginModule.loginTerminalId(key), row.success)
            .pipe(Effect.forkChild);
          yield* waitingCredential;
          yield* fs.writeFileString(`${scratch}/${row.file}`, "new");
          yield* Fiber.join(success);

          assert.equal((yield* feed.latest)[key]?.phase, "succeeded");
          assert.equal(yield* fs.readFileString(row.credential(home)), "new");
        }),
      ),
    );
    it.effect.each(
      Array.from(REAL_LOGINS, (row) => ({
        title: `a success that left no credential fails and keeps ${row.name}'s`,
        row,
      })),
    )("$title", ({ row }) =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const home = yield* seedHome(row);
          const { fakeTerminal, fakeAuth, loginChecks, signIns, feed, key, waitingCredential } =
            yield* startReal(row, home, { credentialWait: Duration.millis(500) });

          const success = yield* fakeTerminal
            .emit("thread-1", ZeropsAgentLoginModule.loginTerminalId(key), row.success)
            .pipe(Effect.forkChild);
          yield* waitingCredential;
          // Waiting yet for the credential to land.
          assert.notEqual((yield* feed.latest)[key]?.phase, "failed");
          yield* Fiber.join(success);

          const login = (yield* feed.latest)[key];
          assert.equal(login?.phase, "failed");
          assert.equal(
            login?.message,
            "The sign-in finished without leaving a credential. Start it again.",
          );
          assert.equal(yield* fs.readFileString(row.credential(home)), "old");
          assert.deepEqual(yield* signIns.load, {});
          assert.deepEqual(yield* Ref.get(fakeAuth.calls), []);
          assert.deepEqual(yield* Ref.get(loginChecks), []);
          assert.isFalse(yield* fs.exists(`${home}/.mate/pending/${key}`));
        }),
      ),
    );

    it.effect.each(
      Array.from(
        REAL_LOGINS.filter((login) => login.agentId === "claude-code"),
        (row) => ({
          title: `a succeeded sign-in brings its account into ${row.name}'s config, keeping the rest`,
          row,
        }),
      ),
    )("$title", ({ row }) =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const home = yield* seedHome(row);
          const { fakeTerminal, key, scratch } = yield* startReal(row, home);

          // Claude keeps the account it signed in with in its global config.
          const seeded = yield* readJson(`${scratch}/.claude.json`);
          const signedIn = { ...seeded, oauthAccount: { emailAddress: "new@example.com" } };
          yield* fs.writeFileString(`${scratch}/.claude.json`, encodeJson(signedIn));
          yield* fs.writeFileString(`${scratch}/${row.file}`, "new");
          yield* fakeTerminal.emit(
            "thread-1",
            ZeropsAgentLoginModule.loginTerminalId(key),
            row.success,
          );

          assert.deepEqual(yield* readJson(claudeConfigOf(row, home)), {
            hasCompletedOnboarding: true,
            mcpServers: { zcp: { command: "zcp" } },
            oauthAccount: { emailAddress: "new@example.com" },
          });
          if (row.login !== undefined) {
            // The default login's account stays its own.
            assert.deepInclude(yield* readJson(`${home}/.claude.json`), {
              oauthAccount: { emailAddress: "old@example.com" },
            });
          }
        }),
      ),
    );
    it.effect.each(
      Array.from(
        REAL_LOGINS.filter((login) => login.agentId === "claude-code"),
        (row) => ({
          title: `a sign-in's scratch home starts from ${row.name}'s config, without its account`,
          row,
        }),
      ),
    )("$title", ({ row }) =>
      Effect.scoped(
        Effect.gen(function* () {
          const home = yield* seedHome(row);
          const { scratch } = yield* startReal(row, home);

          assert.deepEqual(yield* readJson(`${scratch}/.claude.json`), {
            hasCompletedOnboarding: true,
            mcpServers: { zcp: { command: "zcp" } },
          });
        }),
      ),
    );
  },
);

it.effect.each(
  Array.from(["claude-code", "codex"] as const, (agentId) => ({
    title: `${agentId}: a signer write failure is visible and a fresh manual sign-in recovers`,
    agentId,
  })),
)("$title", ({ agentId }) =>
  Effect.scoped(
    Effect.gen(function* () {
      const terminal = yield* makeFakeTerminalManager();
      const auth = yield* makeFakeAuth();
      let writable = false;
      const store = yield* makeSignInStore({
        read: Effect.succeed(undefined),
        write: () => Effect.sync(() => writable),
        remove: Effect.succeed(true),
      });
      const feed = yield* makeFeed({
        terminalManager: terminal.service,
        zeropsAgentAuth: auth,
        isZeropsEnvironment: true,
        signIns: store,
      });
      const succeed = Effect.gen(function* () {
        yield* feed.start(agentId, "thread-1", "user-eva");
        yield* terminal.emit(
          "thread-1",
          ZeropsAgentLoginModule.loginTerminalId(agentId),
          agentId === "claude-code"
            ? "Login successful. Press Enter to continue…\n"
            : CODEX_SUCCESS,
        );
      });
      yield* succeed;
      assert.equal((yield* feed.latest)[agentId]?.phase, "failed");
      assert.match((yield* feed.latest)[agentId]?.message ?? "", /could not be recorded/);
      assert.deepEqual(yield* store.load, {});
      writable = true;
      yield* succeed;
      assert.equal((yield* feed.latest)[agentId]?.phase, "succeeded");
      assert.equal((yield* store.load)[agentId]?.by, "user-eva");
    }),
  ),
);
