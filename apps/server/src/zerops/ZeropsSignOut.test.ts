import { assert, describe, it } from "@effect/vitest";
import {
  type OrchestrationThreadShell,
  ThreadId,
  type ZeropsAgentAuthSnapshot,
} from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Ref from "effect/Ref";
import * as TestClock from "effect/testing/TestClock";

import { ZeropsAgentFlagError } from "./ZeropsAgentFlag.ts";
import type { MateLogin } from "./ZeropsLogins.ts";
import {
  make,
  type SignOutTarget,
  stopSessionsOnEngine,
  stopSessionsVia,
  threadsToStop,
  waitUntilNotLive,
  type ZeropsSignOutOptions,
} from "./ZeropsSignOut.ts";

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
  readonly stopSessions: Ref.Ref<ReadonlyArray<string>>;
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
  readonly stopSessionsFails?: boolean;
  readonly logoutSucceeds?: boolean;
  readonly credentialStillExists?: boolean;
  readonly clearSignedInFails?: boolean;
}) =>
  Effect.gen(function* () {
    const calls: Calls = {
      cancel: yield* Ref.make<ReadonlyArray<string>>([]),
      stopSessions: yield* Ref.make<ReadonlyArray<string>>([]),
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

    const options: ZeropsSignOutOptions = {
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
      zeropsLogins: NO_LOGINS,
      stopSessions: (target) =>
        record(calls.stopSessions, keyOf(target), "stopSessions").pipe(
          Effect.andThen(
            input.stopSessionsFails ? Effect.die(new Error("stop dispatch failed")) : Effect.void,
          ),
        ),
      runLogout: (login) =>
        record(calls.runLogout, login.agent, "runLogout").pipe(
          Effect.as({ success: input.logoutSucceeds ?? true }),
        ),
      // An agent's own credential is named by its agent here, so a call names whose it was.
      agentCredentialPath: (agentId) => agentId,
      credentialExists: (path) =>
        record(calls.credentialExists, path, "credentialExists").pipe(
          Effect.as(input.credentialStillExists ?? false),
        ),
      removeCredential: (path) =>
        record(calls.removeCredential, path, "removeCredential").pipe(Effect.asVoid),
      isZeropsEnvironment: true,
    };
    const service = yield* make(options);
    return { service, calls };
  });

/** A target's key, as the signers record it. */
const keyOf = (target: SignOutTarget) => ("agentId" in target ? target.agentId : target.loginId);

/** No login beyond the defaults. */
const NO_LOGINS: ZeropsSignOutOptions["zeropsLogins"] = {
  resolve: () => Effect.succeed(undefined as MateLogin | undefined),
  recheckNow: () => Effect.void,
  forget: () => Effect.void,
};

describe("ZeropsSignOut, an agent's own login", () => {
  it.effect("fails with unavailable outside a Zerops environment, calling nothing", () =>
    Effect.gen(function* () {
      const called = yield* Ref.make(false);
      const stopSessionsCalled = yield* Ref.make(false);
      const service = yield* make({
        zeropsAgentAuth: {
          latest: Ref.set(called, true).pipe(Effect.as(OAUTH_SNAPSHOT)),
          recheckNow: () => Effect.void,
          invalidatePendingMark: () => Effect.void,
        },
        zeropsAgentLogin: { cancel: () => Effect.void },
        zeropsAgentFlag: { clearSignedIn: () => Effect.void },
        zeropsLogins: NO_LOGINS,
        stopSessions: () => Ref.set(stopSessionsCalled, true),
        runLogout: () => Effect.succeed({ success: true }),
        agentCredentialPath: (agentId) => agentId,
        credentialExists: () => Effect.succeed(false),
        removeCredential: () => Effect.void,
        isZeropsEnvironment: false,
      });
      const error = yield* Effect.flip(service.signOut({ agentId: "claude-code" }));
      assert.strictEqual(error.reason, "unavailable");
      assert.isFalse(yield* Ref.get(called));
      assert.isFalse(yield* Ref.get(stopSessionsCalled));
    }),
  );

  it.effect("refuses a token-authorized agent and calls nothing else", () =>
    Effect.gen(function* () {
      const { service, calls } = yield* makeHarness({
        snapshot: TOKEN_AUTHORIZED_SNAPSHOT,
      });
      const error = yield* Effect.flip(service.signOut({ agentId: "claude-code" }));
      assert.strictEqual(error.reason, "token-authorized");
      assert.deepStrictEqual(yield* Ref.get(calls.cancel), []);
      assert.deepStrictEqual(yield* Ref.get(calls.stopSessions), []);
      assert.deepStrictEqual(yield* Ref.get(calls.runLogout), []);
      assert.deepStrictEqual(yield* Ref.get(calls.clearSignedIn), []);
      assert.deepStrictEqual(yield* Ref.get(calls.recheckNow), []);
      assert.deepStrictEqual(yield* Ref.get(calls.invalidatePendingMark), []);
    }),
  );

  it.effect("runs the full sequence for an oauth-authorized agent", () =>
    Effect.gen(function* () {
      const { service, calls } = yield* makeHarness({});
      yield* service.signOut({ agentId: "claude-code" });
      assert.deepStrictEqual(yield* Ref.get(calls.cancel), ["claude-code"]);
      assert.deepStrictEqual(yield* Ref.get(calls.stopSessions), ["claude-code"]);
      assert.deepStrictEqual(yield* Ref.get(calls.runLogout), ["claude-code"]);
      assert.deepStrictEqual(yield* Ref.get(calls.clearSignedIn), ["claude-code"]);
      assert.deepStrictEqual(yield* Ref.get(calls.recheckNow), ["claude-code"]);
    }),
  );

  it.effect(
    "calls every step in order: cancel, stop sessions, logout, invalidate the pending mark, clear the flag, recheck",
    () =>
      Effect.gen(function* () {
        const { service, calls } = yield* makeHarness({
          logoutSucceeds: true,
          credentialStillExists: true,
        });
        yield* service.signOut({ agentId: "claude-code" });
        assert.deepStrictEqual(yield* Ref.get(calls.order), [
          "cancel",
          "stopSessions",
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
      const { service, calls } = yield* makeHarness({
        logoutSucceeds: true,
        credentialStillExists: false,
      });
      yield* service.signOut({ agentId: "claude-code" });
      assert.deepStrictEqual(yield* Ref.get(calls.credentialExists), ["claude-code"]);
      assert.deepStrictEqual(yield* Ref.get(calls.removeCredential), []);
    }),
  );

  it.effect("removes the credential file when logout succeeded but it is still there", () =>
    Effect.gen(function* () {
      const { service, calls } = yield* makeHarness({
        logoutSucceeds: true,
        credentialStillExists: true,
      });
      yield* service.signOut({ agentId: "claude-code" });
      assert.deepStrictEqual(yield* Ref.get(calls.removeCredential), ["claude-code"]);
    }),
  );

  it.effect(
    "removes the credential file when logout failed, without checking existence first",
    () =>
      Effect.gen(function* () {
        const { service, calls } = yield* makeHarness({
          logoutSucceeds: false,
        });
        yield* service.signOut({ agentId: "claude-code" });
        assert.deepStrictEqual(yield* Ref.get(calls.credentialExists), []);
        assert.deepStrictEqual(yield* Ref.get(calls.removeCredential), ["claude-code"]);
      }),
  );

  it.effect("is best-effort: a failing cancel does not stop the rest of the sequence", () =>
    Effect.gen(function* () {
      const { service, calls } = yield* makeHarness({ cancelFails: true });
      yield* service.signOut({ agentId: "claude-code" });
      assert.deepStrictEqual(yield* Ref.get(calls.cancel), ["claude-code"]);
      assert.deepStrictEqual(yield* Ref.get(calls.stopSessions), ["claude-code"]);
      assert.deepStrictEqual(yield* Ref.get(calls.clearSignedIn), ["claude-code"]);
      assert.deepStrictEqual(yield* Ref.get(calls.recheckNow), ["claude-code"]);
    }),
  );

  it.effect("is best-effort: a failing session stop does not stop the rest of the sequence", () =>
    Effect.gen(function* () {
      const { service, calls } = yield* makeHarness({
        stopSessionsFails: true,
      });
      yield* service.signOut({ agentId: "claude-code" });
      assert.deepStrictEqual(yield* Ref.get(calls.stopSessions), ["claude-code"]);
      assert.deepStrictEqual(yield* Ref.get(calls.runLogout), ["claude-code"]);
      assert.deepStrictEqual(yield* Ref.get(calls.clearSignedIn), ["claude-code"]);
      assert.deepStrictEqual(yield* Ref.get(calls.recheckNow), ["claude-code"]);
    }),
  );

  it.effect("is best-effort: a failing clearSignedIn still reaches recheckNow", () =>
    Effect.gen(function* () {
      const { service, calls } = yield* makeHarness({
        clearSignedInFails: true,
      });
      yield* service.signOut({ agentId: "claude-code" });
      assert.deepStrictEqual(yield* Ref.get(calls.clearSignedIn), ["claude-code"]);
      assert.deepStrictEqual(yield* Ref.get(calls.recheckNow), ["claude-code"]);
    }),
  );
});

// ---------------------------------------------------------------------------
// threadsToStop — pure "which threads" selection
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

describe("threadsToStop, an agent's own login", () => {
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
        threadsToStop(threads, { agentId: "claude-code" }),
        expected ? [THREAD_ID_1] : [],
      );
    });
  }

  it("leaves a thread with no session at all", () => {
    const threads = [shell({ id: THREAD_ID_1, session: null })];
    assert.deepStrictEqual(threadsToStop(threads, { agentId: "claude-code" }), []);
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
    assert.deepStrictEqual(threadsToStop(threads, { agentId: "claude-code" }), [THREAD_ID_1]);
    assert.deepStrictEqual(threadsToStop(threads, { agentId: "codex" }), [THREAD_ID_2]);
  });

  it("selects every live thread for the agent, not just the first", () => {
    const threads = [
      shell({ id: THREAD_ID_1 }),
      shell({ id: THREAD_ID_2 }),
      shell({ id: THREAD_ID_3, modelSelection: { instanceId: "codex", model: "x" } as never }),
    ];
    assert.deepStrictEqual(threadsToStop(threads, { agentId: "claude-code" }), [
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
    assert.deepStrictEqual(threadsToStop(threads, { agentId: "claude-code" }), [THREAD_ID_1]);
    assert.deepStrictEqual(threadsToStop(threads, { agentId: "codex" }), []);
  });

  it("falls back to the thread's model selection when the session carries no providerInstanceId", () => {
    const threads = [shell({ id: THREAD_ID_1 })];
    assert.deepStrictEqual(threadsToStop(threads, { agentId: "claude-code" }), [THREAD_ID_1]);
  });

  it("selects nothing from an empty thread list", () => {
    assert.deepStrictEqual(threadsToStop([], { agentId: "claude-code" }), []);
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

const WORK: MateLogin = {
  id: "claudeAgent-work",
  agent: "claude-code",
  kind: "subscription",
  label: "work",
  home: "/home/zerops/.mate/logins/claudeAgent-work",
  keyStored: false,
};

const KEY: MateLogin = {
  id: "claudeAgent-api-key",
  agent: "claude-code",
  kind: "apiKey",
  label: "",
  home: "/home/zerops/.mate/logins/claudeAgent-api-key",
  keyStored: true,
};

const loginHarness = (input: { readonly logout?: boolean; readonly credentialLeft?: boolean }) =>
  Effect.gen(function* () {
    const order = yield* Ref.make<ReadonlyArray<string>>([]);
    const step = (label: string) => Ref.update(order, (all) => [...all, label]);
    const service = yield* make({
      isZeropsEnvironment: true,
      zeropsAgentAuth: {
        latest: Effect.succeed(OAUTH_SNAPSHOT),
        recheckNow: () => Effect.void,
        invalidatePendingMark: () => Effect.void,
      },
      zeropsAgentFlag: { clearSignedIn: () => Effect.void },
      agentCredentialPath: (agentId) => agentId,
      stopSessions: () => step("stop"),
      zeropsLogins: {
        resolve: (id) => Effect.succeed([WORK, KEY].find((login) => login.id === id)),
        recheckNow: (id) => step(`recheck:${id}`),
        forget: (id) => step(`forget:${id}`),
      },
      zeropsAgentLogin: {
        cancel: (agentId, loginId) => step(`cancel:${agentId}:${loginId}`),
      },
      runLogout: (login) =>
        step(`logout:${login.home}`).pipe(Effect.as({ success: input.logout ?? true })),
      credentialExists: (path) =>
        step(`exists:${path}`).pipe(Effect.as(input.credentialLeft ?? false)),
      removeCredential: (path) => step(`remove:${path}`),
    });
    return { order, service };
  });

describe("ZeropsSignOut, a login beyond the defaults", () => {
  it.effect("signs a login out: its walker, its sessions, its CLI, then its own check", () =>
    Effect.gen(function* () {
      const { order, service } = yield* loginHarness({});
      yield* service.signOut({ loginId: WORK.id });
      assert.deepStrictEqual(yield* Ref.get(order), [
        `cancel:claude-code:${WORK.id}`,
        "stop",
        `logout:${WORK.home}`,
        `exists:${WORK.home}/.credentials.json`,
        `recheck:${WORK.id}`,
      ]);
    }),
  );

  it.effect("removes the credential itself when the CLI's logout leaves it or fails", () =>
    Effect.gen(function* () {
      for (const input of [{ credentialLeft: true }, { logout: false }]) {
        const { order, service } = yield* loginHarness(input);
        yield* service.signOut({ loginId: WORK.id });
        assert.include([...(yield* Ref.get(order))], `remove:${WORK.home}/.credentials.json`);
      }
    }),
  );

  it.effect("refuses to sign out an API key — it is removed, not signed out", () =>
    Effect.gen(function* () {
      const { order, service } = yield* loginHarness({});
      const refused = yield* Effect.flip(service.signOut({ loginId: KEY.id }));
      assert.strictEqual(refused.reason, "invalid-login");
      assert.deepStrictEqual(yield* Ref.get(order), []);
    }),
  );

  it.effect("removes a login: signed out first, then forgotten", () =>
    Effect.gen(function* () {
      const { order, service } = yield* loginHarness({});
      yield* service.remove(WORK.id);
      assert.deepStrictEqual((yield* Ref.get(order)).at(-1), `forget:${WORK.id}`);
      assert.include([...(yield* Ref.get(order))], `logout:${WORK.home}`);
    }),
  );

  it.effect("removes an API key without a CLI to ask", () =>
    Effect.gen(function* () {
      const { order, service } = yield* loginHarness({});
      yield* service.remove(KEY.id);
      assert.deepStrictEqual(yield* Ref.get(order), ["stop", `forget:${KEY.id}`]);
    }),
  );

  it.effect("refuses a login it does not know, and a default one", () =>
    Effect.gen(function* () {
      const { service } = yield* loginHarness({});
      assert.strictEqual(
        (yield* Effect.flip(service.signOut({ loginId: "codex-gone" }))).reason,
        "unknown-login",
      );
      assert.strictEqual(
        (yield* Effect.flip(service.remove("claudeAgent"))).reason,
        "default-login",
      );
    }),
  );
});

describe("threadsToStop, a login beyond the defaults", () => {
  const thread = (
    id: string,
    instanceId: string,
    session: { readonly providerInstanceId?: string; readonly status: string } | null,
  ) =>
    ({
      id: ThreadId.make(id),
      modelSelection: { instanceId, model: "m" },
      session,
    }) as unknown as OrchestrationThreadShell;

  it("stops the live sessions running on that login, and no other", () => {
    assert.deepStrictEqual(
      threadsToStop(
        [
          thread("a", "claudeAgent-work", {
            providerInstanceId: "claudeAgent-work",
            status: "running",
          }),
          thread("b", "claudeAgent", { providerInstanceId: "claudeAgent", status: "running" }),
          thread("c", "claudeAgent-work", {
            providerInstanceId: "claudeAgent-work",
            status: "stopped",
          }),
          thread("d", "claudeAgent-work", null),
          // Repointed at the default while its session still runs on the login.
          thread("e", "claudeAgent", { providerInstanceId: "claudeAgent-work", status: "ready" }),
        ],
        { loginId: "claudeAgent-work" },
      ),
      ["a", "e"].map((id) => ThreadId.make(id)),
    );
  });
});

describe("stopSessionsVia", () => {
  const live = (id: string, instanceId: string) =>
    ({
      id: ThreadId.make(id),
      modelSelection: { instanceId, model: "m" },
      session: { providerInstanceId: instanceId, status: "running" },
    }) as unknown as OrchestrationThreadShell;

  // Step (c) over orchestration: a stop is dispatched for every live session on the login, and
  // each is waited on until it reads stopped; one stop that fails holds up none after it.
  it.effect("stops every live session on the login, each waited on, past one that fails", () =>
    Effect.gen(function* () {
      const stopped = yield* Ref.make<ReadonlyArray<string>>([]);
      const asked = yield* Ref.make<ReadonlyArray<string>>([]);
      const polled = yield* Ref.make<ReadonlyArray<string>>([]);
      const stop = stopSessionsVia({
        threads: Effect.succeed([
          live("a", "claudeAgent"),
          live("b", "claudeAgent-work"),
          live("c", "claudeAgent"),
          live("d", "claudeAgent"),
        ]),
        isLive: (threadId) =>
          Ref.update(polled, (all) => [...all, threadId]).pipe(
            Effect.andThen(Effect.map(Ref.get(stopped), (all) => !all.includes(threadId))),
          ),
        stop: (threadId) =>
          Ref.update(asked, (all) => [...all, threadId]).pipe(
            Effect.andThen(
              threadId === "c"
                ? Effect.die(new Error("dispatch refused"))
                : Ref.update(stopped, (all) => [...all, threadId]),
            ),
          ),
      });
      yield* stop({ agentId: "claude-code" });
      assert.deepStrictEqual(yield* Ref.get(asked), ["a", "c", "d"]);
      assert.deepStrictEqual(yield* Ref.get(stopped), ["a", "d"]);
      assert.deepStrictEqual(yield* Ref.get(polled), ["a", "d"]);
    }),
  );
});

describe("stopSessionsOnEngine, when the Mate engine owns the conversation", () => {
  it.effect.each([
    [
      "an agent's own login stops the sessions on each instance it is spelled as",
      { agentId: "claude-code" },
      ["claudeAgent", "claude-code"],
    ],
    ["Codex's own login stops the sessions on its instance", { agentId: "codex" }, ["codex"]],
    [
      "a login beyond the defaults stops the sessions on that login's instance",
      { loginId: "claudeAgent-work" },
      ["claudeAgent-work"],
    ],
  ] as const satisfies ReadonlyArray<readonly [string, SignOutTarget, ReadonlyArray<string>]>)(
    "%s",
    ([, target, expected]) =>
      Effect.gen(function* () {
        const calls: Array<{ instanceIds: ReadonlyArray<string>; cause: string }> = [];
        yield* stopSessionsOnEngine({
          stopSessionsOn: (instanceIds, cause) =>
            Effect.sync(() => void calls.push({ instanceIds, cause })),
        })(target);
        assert.deepStrictEqual(calls, [{ instanceIds: expected, cause: "sign-out" }]);
      }),
  );
});
