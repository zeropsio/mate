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
import { ZeropsAgentLoginError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import type { TerminalManager } from "../terminal/Manager.ts";
import * as ZeropsAgentLoginModule from "./ZeropsAgentLogin.ts";
import type { ZeropsAgentLoginByAgent } from "./ZeropsAgentLogin.ts";

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
  readonly closed: Ref.Ref<
    ReadonlyArray<{ readonly threadId: string; readonly terminalId: string }>
  >;
  readonly opened: Ref.Ref<
    ReadonlyArray<{ readonly threadId: string; readonly terminalId: string }>
  >;
  /** Delivers one `output` chunk to whatever session is currently attached to (threadId, terminalId). A no-op if nothing is attached. */
  readonly emit: (threadId: string, terminalId: string, data: string) => Effect.Effect<void>;
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
    const closed = yield* Ref.make<ReadonlyArray<{ threadId: string; terminalId: string }>>([]);
    const opened = yield* Ref.make<ReadonlyArray<{ threadId: string; terminalId: string }>>([]);
    const listeners = new Map<string, (event: TerminalAttachStreamEvent) => Effect.Effect<void>>();

    const service: TerminalManagerService = {
      open: (input: TerminalOpenInput) =>
        Ref.update(opened, (all) => [
          ...all,
          { threadId: input.threadId, terminalId: input.terminalId },
        ]).pipe(Effect.as(fakeSnapshot(input))),
      write: (input: TerminalWriteInput) =>
        Ref.update(writes, (all) => [
          ...all,
          { threadId: input.threadId, terminalId: input.terminalId, data: input.data },
        ]).pipe(Effect.asVoid),
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
          { threadId: input.threadId, terminalId: input.terminalId ?? "" },
        ]).pipe(Effect.asVoid),
    };

    const emit = (threadId: string, terminalId: string, data: string): Effect.Effect<void> =>
      Effect.gen(function* () {
        const listener = listeners.get(sessionKey(threadId, terminalId));
        if (listener !== undefined) {
          yield* listener({ type: "output", threadId, terminalId, data });
        }
      });

    return { service, writes, closed, opened, emit } satisfies FakeTerminalManager;
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
      const feed = yield* ZeropsAgentLoginModule.make({
        terminalManager: fakeTerminal.service,
        zeropsAgentAuth: fakeAuth,
        isZeropsEnvironment: true,
      });

      const result = yield* feed.start("claude-code", "thread-1", "user-test");
      assert.equal(result.terminalId, "agent-login-claude-code");

      const opened = yield* Ref.get(fakeTerminal.opened);
      assert.deepEqual(opened, [{ threadId: "thread-1", terminalId: "agent-login-claude-code" }]);

      const writes = yield* Ref.get(fakeTerminal.writes);
      assert.equal(writes.length, 1);
      assert.equal(writes[0]?.data, "claude /login\r");

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
        const feed = yield* ZeropsAgentLoginModule.make({
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
      const feed = yield* ZeropsAgentLoginModule.make({
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
        const feed = yield* ZeropsAgentLoginModule.make({
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
      const feed = yield* ZeropsAgentLoginModule.make({
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
        const feed = yield* ZeropsAgentLoginModule.make({
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
      const feed = yield* ZeropsAgentLoginModule.make({
        terminalManager: fakeTerminal.service,
        zeropsAgentAuth: fakeAuth,
        isZeropsEnvironment: true,
      });

      yield* feed.start("claude-code", "thread-1", "user-test");
      yield* feed.cancel("claude-code");

      const writes = yield* Ref.get(fakeTerminal.writes);
      assert.equal(writes[writes.length - 1]?.data, "\x03");
      const closed = yield* Ref.get(fakeTerminal.closed);
      assert.deepEqual(closed, [{ threadId: "thread-1", terminalId: "agent-login-claude-code" }]);

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
      const feed = yield* ZeropsAgentLoginModule.make({
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
      const feed = yield* ZeropsAgentLoginModule.make({
        terminalManager: fakeTerminal.service,
        zeropsAgentAuth: fakeAuth,
        isZeropsEnvironment: false,
      });

      const startError = yield* Effect.flip(feed.start("claude-code", "thread-1", "user-test"));
      assert.instanceOf(startError, ZeropsAgentLoginError);
      const cancelError = yield* Effect.flip(feed.cancel("claude-code"));
      assert.instanceOf(cancelError, ZeropsAgentLoginError);

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
            const feed = yield* ZeropsAgentLoginModule.make({
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

            yield* Effect.sleep("1600 millis");

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

it.effect("records the authorizer from the session subject when a login succeeds", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fakeTerminal = yield* makeFakeTerminalManager();
      const fakeAuth = yield* makeFakeAuth();
      const recorded = yield* Ref.make<ReadonlyArray<readonly [ZeropsAgentId, string]>>([]);
      const feed = yield* ZeropsAgentLoginModule.make({
        terminalManager: fakeTerminal.service,
        zeropsAgentAuth: fakeAuth,
        isZeropsEnvironment: true,
        recordAuthorizer: (agentId, subject) =>
          Ref.update(recorded, (all) => [...all, [agentId, subject] as const]),
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

      assert.deepEqual(yield* Ref.get(recorded), [["claude-code", "zerops-user-a"]]);
    }),
  ),
);

it.effect("records nothing while a login is merely in progress", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fakeTerminal = yield* makeFakeTerminalManager();
      const fakeAuth = yield* makeFakeAuth();
      const recorded = yield* Ref.make<ReadonlyArray<readonly [ZeropsAgentId, string]>>([]);
      const feed = yield* ZeropsAgentLoginModule.make({
        terminalManager: fakeTerminal.service,
        zeropsAgentAuth: fakeAuth,
        isZeropsEnvironment: true,
        recordAuthorizer: (agentId, subject) =>
          Ref.update(recorded, (all) => [...all, [agentId, subject] as const]),
      });

      yield* feed.start("claude-code", "thread-1", "zerops-user-a");
      yield* fakeTerminal.emit(
        "thread-1",
        "agent-login-claude-code",
        "Visit https://claude.ai/oauth/authorize?code=1 to continue\n",
      );

      // Provenance is a claim about a completed sign-in; an abandoned attempt
      // must not leave one behind.
      assert.deepEqual(yield* Ref.get(recorded), []);
    }),
  ),
);
