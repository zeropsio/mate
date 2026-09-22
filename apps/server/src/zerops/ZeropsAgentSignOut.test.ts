import { assert, describe, it } from "@effect/vitest";
import type {
  OrchestrationThreadShell,
  ThreadId,
  ZeropsAgentAuthSnapshot,
} from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Ref from "effect/Ref";
import * as TestClock from "effect/testing/TestClock";

import { ZeropsAgentFlagError } from "./ZeropsAgentFlag.ts";
import {
  make,
  threadsToStopForAgent,
  waitUntilNotLive,
  type ZeropsAgentSignOutOptions,
} from "./ZeropsAgentSignOut.ts";

const TOKEN_AUTHORIZED_SNAPSHOT: ZeropsAgentAuthSnapshot = {
  available: true,
  agents: [
    {
      agentId: "claude-code",
      credPresent: true,
      flagOAuth: false,
      flagToken: true,
      providerAuth: "authenticated",
      state: "authorized-token",
    },
    {
      agentId: "codex",
      credPresent: false,
      flagOAuth: false,
      flagToken: false,
      providerAuth: "unknown",
      state: "not-authorized",
    },
  ],
};

const OAUTH_SNAPSHOT: ZeropsAgentAuthSnapshot = {
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
    {
      agentId: "codex",
      credPresent: false,
      flagOAuth: false,
      flagToken: false,
      providerAuth: "unknown",
      state: "not-authorized",
    },
  ],
};

interface Calls {
  readonly cancel: Ref.Ref<ReadonlyArray<string>>;
  readonly stopAgentSessions: Ref.Ref<ReadonlyArray<string>>;
  readonly runLogout: Ref.Ref<ReadonlyArray<string>>;
  readonly credentialExists: Ref.Ref<ReadonlyArray<string>>;
  readonly removeCredential: Ref.Ref<ReadonlyArray<string>>;
  readonly clearSignedIn: Ref.Ref<ReadonlyArray<string>>;
  readonly recheckNow: Ref.Ref<ReadonlyArray<string>>;
  readonly invalidatePendingMark: Ref.Ref<ReadonlyArray<string>>;
  /** One shared, ordered log every step below appends its own label to — the call-order assertion reads this. */
  readonly order: Ref.Ref<ReadonlyArray<string>>;
}

const makeHarness = (input: {
  readonly snapshot?: ZeropsAgentAuthSnapshot;
  readonly cancelFails?: boolean;
  readonly stopAgentSessionsFails?: boolean;
  readonly logoutSucceeds?: boolean;
  readonly credentialStillExists?: boolean;
  readonly clearSignedInFails?: boolean;
}) =>
  Effect.gen(function* () {
    const calls: Calls = {
      cancel: yield* Ref.make<ReadonlyArray<string>>([]),
      stopAgentSessions: yield* Ref.make<ReadonlyArray<string>>([]),
      runLogout: yield* Ref.make<ReadonlyArray<string>>([]),
      credentialExists: yield* Ref.make<ReadonlyArray<string>>([]),
      removeCredential: yield* Ref.make<ReadonlyArray<string>>([]),
      clearSignedIn: yield* Ref.make<ReadonlyArray<string>>([]),
      recheckNow: yield* Ref.make<ReadonlyArray<string>>([]),
      invalidatePendingMark: yield* Ref.make<ReadonlyArray<string>>([]),
      order: yield* Ref.make<ReadonlyArray<string>>([]),
    };
    const record = (ref: Ref.Ref<ReadonlyArray<string>>, agentId: string, label: string) =>
      Ref.update(ref, (all) => [...all, agentId]).pipe(
        Effect.andThen(Ref.update(calls.order, (all) => [...all, label])),
      );

    const options: ZeropsAgentSignOutOptions = {
      zeropsAgentAuth: {
        latest: Effect.succeed(input.snapshot ?? OAUTH_SNAPSHOT),
        recheckNow: (agentId) => record(calls.recheckNow, agentId, "recheckNow"),
        invalidatePendingMark: (agentId) =>
          record(calls.invalidatePendingMark, agentId, "invalidatePendingMark"),
      },
      zeropsAgentLogin: {
        cancel: (agentId) =>
          record(calls.cancel, agentId, "cancel").pipe(
            Effect.andThen(
              input.cancelFails
                ? Effect.fail({ _tag: "TerminalError", message: "boom" } as never)
                : Effect.void,
            ),
          ),
      },
      zeropsAgentFlag: {
        clearSignedIn: (agentId) =>
          record(calls.clearSignedIn, agentId, "clearSignedIn").pipe(
            Effect.andThen(
              input.clearSignedInFails
                ? Effect.fail(new ZeropsAgentFlagError({ reason: "down" }))
                : Effect.void,
            ),
          ),
      },
      runLogout: (agentId) =>
        record(calls.runLogout, agentId, "runLogout").pipe(
          Effect.as({ success: input.logoutSucceeds ?? true }),
        ),
      credentialExists: (agentId) =>
        record(calls.credentialExists, agentId, "credentialExists").pipe(
          Effect.as(input.credentialStillExists ?? false),
        ),
      removeCredential: (agentId) =>
        record(calls.removeCredential, agentId, "removeCredential").pipe(Effect.asVoid),
      isZeropsEnvironment: true,
    };
    const service = yield* make(options);
    const stopAgentSessions = () =>
      record(calls.stopAgentSessions, "claude-code", "stopAgentSessions").pipe(
        Effect.andThen(
          input.stopAgentSessionsFails
            ? Effect.die(new Error("stop dispatch failed"))
            : Effect.void,
        ),
      );
    return { service, calls, stopAgentSessions };
  });

describe("ZeropsAgentSignOut", () => {
  it.effect("fails with unavailable outside a Zerops environment, calling nothing", () =>
    Effect.gen(function* () {
      const called = yield* Ref.make(false);
      const stopAgentSessionsCalled = yield* Ref.make(false);
      const service = yield* make({
        zeropsAgentAuth: {
          latest: Ref.set(called, true).pipe(Effect.as(OAUTH_SNAPSHOT)),
          recheckNow: () => Effect.void,
          invalidatePendingMark: () => Effect.void,
        },
        zeropsAgentLogin: { cancel: () => Effect.void },
        zeropsAgentFlag: { clearSignedIn: () => Effect.void },
        runLogout: () => Effect.succeed({ success: true }),
        credentialExists: () => Effect.succeed(false),
        removeCredential: () => Effect.void,
        isZeropsEnvironment: false,
      });
      const error = yield* Effect.flip(
        service.signOut("claude-code", () => Ref.set(stopAgentSessionsCalled, true)),
      );
      assert.strictEqual(error.reason, "unavailable");
      assert.isFalse(yield* Ref.get(called));
      assert.isFalse(yield* Ref.get(stopAgentSessionsCalled));
    }),
  );

  it.effect("refuses a token-authorized agent and calls nothing else", () =>
    Effect.gen(function* () {
      const { service, calls, stopAgentSessions } = yield* makeHarness({
        snapshot: TOKEN_AUTHORIZED_SNAPSHOT,
      });
      const error = yield* Effect.flip(service.signOut("claude-code", stopAgentSessions));
      assert.strictEqual(error.reason, "token-authorized");
      assert.deepStrictEqual(yield* Ref.get(calls.cancel), []);
      assert.deepStrictEqual(yield* Ref.get(calls.stopAgentSessions), []);
      assert.deepStrictEqual(yield* Ref.get(calls.runLogout), []);
      assert.deepStrictEqual(yield* Ref.get(calls.clearSignedIn), []);
      assert.deepStrictEqual(yield* Ref.get(calls.recheckNow), []);
      assert.deepStrictEqual(yield* Ref.get(calls.invalidatePendingMark), []);
    }),
  );

  it.effect("runs the full sequence for an oauth-authorized agent", () =>
    Effect.gen(function* () {
      const { service, calls, stopAgentSessions } = yield* makeHarness({});
      yield* service.signOut("claude-code", stopAgentSessions);
      assert.deepStrictEqual(yield* Ref.get(calls.cancel), ["claude-code"]);
      assert.deepStrictEqual(yield* Ref.get(calls.stopAgentSessions), ["claude-code"]);
      assert.deepStrictEqual(yield* Ref.get(calls.runLogout), ["claude-code"]);
      assert.deepStrictEqual(yield* Ref.get(calls.clearSignedIn), ["claude-code"]);
      assert.deepStrictEqual(yield* Ref.get(calls.recheckNow), ["claude-code"]);
    }),
  );

  it.effect(
    "calls every step in order: cancel, stop sessions, logout, invalidate the pending mark, clear the flag, recheck",
    () =>
      Effect.gen(function* () {
        const { service, calls, stopAgentSessions } = yield* makeHarness({
          logoutSucceeds: true,
          credentialStillExists: true,
        });
        yield* service.signOut("claude-code", stopAgentSessions);
        assert.deepStrictEqual(yield* Ref.get(calls.order), [
          "cancel",
          "stopAgentSessions",
          "runLogout",
          "credentialExists",
          "removeCredential",
          "invalidatePendingMark",
          "clearSignedIn",
          "recheckNow",
        ]);
      }),
  );

  it.effect("skips removeCredential when logout succeeded and the credential is already gone", () =>
    Effect.gen(function* () {
      const { service, calls, stopAgentSessions } = yield* makeHarness({
        logoutSucceeds: true,
        credentialStillExists: false,
      });
      yield* service.signOut("claude-code", stopAgentSessions);
      assert.deepStrictEqual(yield* Ref.get(calls.credentialExists), ["claude-code"]);
      assert.deepStrictEqual(yield* Ref.get(calls.removeCredential), []);
    }),
  );

  it.effect("removes the credential file when logout succeeded but it is still there", () =>
    Effect.gen(function* () {
      const { service, calls, stopAgentSessions } = yield* makeHarness({
        logoutSucceeds: true,
        credentialStillExists: true,
      });
      yield* service.signOut("claude-code", stopAgentSessions);
      assert.deepStrictEqual(yield* Ref.get(calls.removeCredential), ["claude-code"]);
    }),
  );

  it.effect(
    "removes the credential file when logout failed, without checking existence first",
    () =>
      Effect.gen(function* () {
        const { service, calls, stopAgentSessions } = yield* makeHarness({
          logoutSucceeds: false,
        });
        yield* service.signOut("claude-code", stopAgentSessions);
        assert.deepStrictEqual(yield* Ref.get(calls.credentialExists), []);
        assert.deepStrictEqual(yield* Ref.get(calls.removeCredential), ["claude-code"]);
      }),
  );

  it.effect("is best-effort: a failing cancel does not stop the rest of the sequence", () =>
    Effect.gen(function* () {
      const { service, calls, stopAgentSessions } = yield* makeHarness({ cancelFails: true });
      yield* service.signOut("claude-code", stopAgentSessions);
      assert.deepStrictEqual(yield* Ref.get(calls.cancel), ["claude-code"]);
      assert.deepStrictEqual(yield* Ref.get(calls.stopAgentSessions), ["claude-code"]);
      assert.deepStrictEqual(yield* Ref.get(calls.clearSignedIn), ["claude-code"]);
      assert.deepStrictEqual(yield* Ref.get(calls.recheckNow), ["claude-code"]);
    }),
  );

  it.effect(
    "is best-effort: a failing stopAgentSessions does not stop the rest of the sequence",
    () =>
      Effect.gen(function* () {
        const { service, calls, stopAgentSessions } = yield* makeHarness({
          stopAgentSessionsFails: true,
        });
        yield* service.signOut("claude-code", stopAgentSessions);
        assert.deepStrictEqual(yield* Ref.get(calls.stopAgentSessions), ["claude-code"]);
        assert.deepStrictEqual(yield* Ref.get(calls.runLogout), ["claude-code"]);
        assert.deepStrictEqual(yield* Ref.get(calls.clearSignedIn), ["claude-code"]);
        assert.deepStrictEqual(yield* Ref.get(calls.recheckNow), ["claude-code"]);
      }),
  );

  it.effect("is best-effort: a failing clearSignedIn still reaches recheckNow", () =>
    Effect.gen(function* () {
      const { service, calls, stopAgentSessions } = yield* makeHarness({
        clearSignedInFails: true,
      });
      yield* service.signOut("claude-code", stopAgentSessions);
      assert.deepStrictEqual(yield* Ref.get(calls.clearSignedIn), ["claude-code"]);
      assert.deepStrictEqual(yield* Ref.get(calls.recheckNow), ["claude-code"]);
    }),
  );
});

// ---------------------------------------------------------------------------
// threadsToStopForAgent — pure "which threads" selection
// ---------------------------------------------------------------------------

const THREAD_ID_1 = "th_0000000000000000000001" as ThreadId;
const THREAD_ID_2 = "th_0000000000000000000002" as ThreadId;
const THREAD_ID_3 = "th_0000000000000000000003" as ThreadId;

const shell = (
  over: Partial<Pick<OrchestrationThreadShell, "id" | "modelSelection" | "session">>,
): Pick<OrchestrationThreadShell, "id" | "modelSelection" | "session"> => ({
  id: THREAD_ID_1,
  modelSelection: { instanceId: "claudeAgent", model: "claude" } as never,
  session: {
    threadId: THREAD_ID_1,
    status: "running",
    providerName: "claudeAgent",
    runtimeMode: "agent",
    activeTurnId: null,
    lastError: null,
    updatedAt: "2026-09-22T00:00:00.000Z",
  } as never,
  ...over,
});

describe("threadsToStopForAgent", () => {
  for (const [name, status, expected] of [
    ["idle", "idle", true],
    ["starting", "starting", true],
    ["running", "running", true],
    ["ready", "ready", true],
    ["interrupted", "interrupted", true],
    ["stopped", "stopped", false],
    ["error", "error", true],
  ] as const) {
    it(`${expected ? "stops" : "leaves"} a thread whose session status is ${name}`, () => {
      const threads = [
        shell({ id: THREAD_ID_1, session: { ...shell({}).session, status } as never }),
      ];
      assert.deepStrictEqual(
        threadsToStopForAgent(threads, "claude-code"),
        expected ? [THREAD_ID_1] : [],
      );
    });
  }

  it("leaves a thread with no session at all", () => {
    const threads = [shell({ id: THREAD_ID_1, session: null })];
    assert.deepStrictEqual(threadsToStopForAgent(threads, "claude-code"), []);
  });

  it("only selects threads whose provider instance maps to the requested agent", () => {
    const threads = [
      shell({
        id: THREAD_ID_1,
        modelSelection: { instanceId: "claudeAgent", model: "x" } as never,
      }),
      shell({ id: THREAD_ID_2, modelSelection: { instanceId: "codex", model: "x" } as never }),
      shell({
        id: THREAD_ID_3,
        modelSelection: { instanceId: "some-other-driver", model: "x" } as never,
      }),
    ];
    assert.deepStrictEqual(threadsToStopForAgent(threads, "claude-code"), [THREAD_ID_1]);
    assert.deepStrictEqual(threadsToStopForAgent(threads, "codex"), [THREAD_ID_2]);
  });

  it("selects every live thread for the agent, not just the first", () => {
    const threads = [
      shell({ id: THREAD_ID_1 }),
      shell({ id: THREAD_ID_2 }),
      shell({ id: THREAD_ID_3, modelSelection: { instanceId: "codex", model: "x" } as never }),
    ];
    assert.deepStrictEqual(threadsToStopForAgent(threads, "claude-code"), [
      THREAD_ID_1,
      THREAD_ID_2,
    ]);
  });

  it("keys on the live session's own provider instance, not the thread's current model selection", () => {
    // A thread can switch which agent it's pointed at while a session from
    // the PREVIOUS provider instance is still live — the live session is
    // what must stop, not whatever the thread is now configured to use.
    const threads = [
      shell({
        id: THREAD_ID_1,
        modelSelection: { instanceId: "codex", model: "x" } as never,
        session: { ...shell({}).session, providerInstanceId: "claudeAgent" } as never,
      }),
    ];
    assert.deepStrictEqual(threadsToStopForAgent(threads, "claude-code"), [THREAD_ID_1]);
    assert.deepStrictEqual(threadsToStopForAgent(threads, "codex"), []);
  });

  it("falls back to the thread's model selection when the session carries no providerInstanceId", () => {
    const threads = [shell({ id: THREAD_ID_1 })];
    assert.deepStrictEqual(threadsToStopForAgent(threads, "claude-code"), [THREAD_ID_1]);
  });

  it("selects nothing from an empty thread list", () => {
    assert.deepStrictEqual(threadsToStopForAgent([], "claude-code"), []);
  });
});

// ---------------------------------------------------------------------------
// waitUntilNotLive — poll-until-stopped with a bounded timeout
// ---------------------------------------------------------------------------

describe("waitUntilNotLive", () => {
  it.effect("resolves as soon as isLive turns false, without waiting for the timeout", () =>
    Effect.gen(function* () {
      const remainingLivePolls = yield* Ref.make(2);
      const pollCount = yield* Ref.make(0);
      const isLive = Ref.updateAndGet(pollCount, (n) => n + 1).pipe(
        Effect.andThen(Ref.getAndUpdate(remainingLivePolls, (n) => Math.max(n - 1, 0))),
        Effect.map((n) => n > 0),
      );
      const fiber = yield* Effect.forkChild(
        waitUntilNotLive(isLive, {
          pollInterval: Duration.millis(100),
          timeout: Duration.seconds(10),
        }),
      );
      // First poll (live), sleep, second poll (live), sleep, third poll (not live) -> returns.
      yield* TestClock.adjust(Duration.millis(100));
      yield* TestClock.adjust(Duration.millis(100));
      yield* Fiber.join(fiber);
      assert.strictEqual(yield* Ref.get(pollCount), 3);
    }),
  );

  it.effect("gives up once the timeout elapses, even if isLive never turns false", () =>
    Effect.gen(function* () {
      const pollCount = yield* Ref.make(0);
      const isLive = Ref.update(pollCount, (n) => n + 1).pipe(Effect.as(true));
      const fiber = yield* Effect.forkChild(
        waitUntilNotLive(isLive, {
          pollInterval: Duration.millis(100),
          timeout: Duration.seconds(1),
        }),
      );
      yield* TestClock.adjust(Duration.seconds(2));
      // Never throws — a timeout is swallowed, not propagated.
      yield* Fiber.join(fiber);
      assert.isTrue((yield* Ref.get(pollCount)) > 0);
    }),
  );
});
