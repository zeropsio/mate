import { assert, describe, it } from "@effect/vitest";
import { type OrchestrationThreadShell, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";

import type { MateLogin } from "./ZeropsLogins.ts";
import { make as makeOffboarding } from "./ZeropsOffboarding.ts";
import { make as makeSignOut, stopSessionsVia } from "./ZeropsSignOut.ts";

const EVA = "eva-user-id";
const JAN = "jan-user-id";

const WORK: MateLogin = {
  id: "claudeAgent-work",
  agent: "claude-code",
  kind: "subscription",
  label: "work",
  home: "/home/zerops/.mate/logins/claudeAgent-work",
  keyStored: false,
};

const live = (id: string, instanceId: string) =>
  ({
    id: ThreadId.make(id),
    modelSelection: { instanceId, model: "m" },
    session: { providerInstanceId: instanceId, status: "running" },
  }) as unknown as OrchestrationThreadShell;

/**
 * Offboarding over the real sign-out: Eva signed in Claude Code's own login and the `work` login,
 * Jan Codex; a live session runs on each of Eva's. `access` is what `hasProjectAccess` answers.
 */
const offboarding = (access: Readonly<Record<string, boolean | undefined>>) =>
  Effect.gen(function* () {
    const stopped = yield* Ref.make<ReadonlyArray<string>>([]);
    const steps = yield* Ref.make<ReadonlyArray<string>>([]);
    const step = (label: string) => Ref.update(steps, (all) => [...all, label]);
    const signOut = yield* makeSignOut({
      isZeropsEnvironment: true,
      zeropsAgentAuth: {
        latest: Effect.succeed({ available: true, agents: [] }),
        recheckNow: (agentId) => step(`recheck:${agentId}`),
        invalidatePendingMark: () => Effect.void,
      },
      zeropsAgentLogin: { cancel: (agentId, loginId) => step(`cancel:${loginId ?? agentId}`) },
      zeropsAgentFlag: { clearSignedIn: (agentId) => step(`flag:${agentId}`) },
      zeropsLogins: {
        resolve: (id) => Effect.succeed(id === WORK.id ? WORK : undefined),
        recheckNow: (id) => step(`recheck:${id}`),
        forget: () => Effect.void,
      },
      stopSessions: stopSessionsVia({
        threads: Effect.succeed([live("eva-claude", "claudeAgent"), live("eva-work", WORK.id)]),
        isLive: (threadId) => Effect.map(Ref.get(stopped), (all) => !all.includes(threadId)),
        stop: (threadId) => Ref.update(stopped, (all) => [...all, threadId]),
      }),
      runLogout: (login) =>
        step(`logout:${login.home ?? login.agent}`).pipe(Effect.as({ success: true })),
      agentCredentialPath: (agentId) => `/home/zerops/${agentId}`,
      credentialExists: () => Effect.succeed(false),
      removeCredential: () => Effect.void,
    });
    const service = yield* makeOffboarding({
      signers: Effect.succeed({ "claude-code": EVA, [WORK.id]: EVA, codex: JAN }),
      hasProjectAccess: (userId) => Effect.succeed(access[userId]),
      signOut: signOut.signOut,
    });
    return { service, stopped, steps };
  });

// X4: a person this project no longer opens for is signed out of every login they signed in — an
// agent's own and any beyond — by the same sign-out a person asks for: their live sessions
// stopped, their logins logged out.
describe("ZeropsOffboarding", () => {
  it.effect("signs every login of a person who lost access out, their sessions stopped", () =>
    Effect.gen(function* () {
      const { service, stopped, steps } = yield* offboarding({ [EVA]: false, [JAN]: true });
      assert.strictEqual(yield* service.checkNow, 2);
      assert.deepStrictEqual(yield* Ref.get(stopped), ["eva-claude", "eva-work"]);
      const done = yield* Ref.get(steps);
      for (const expected of [
        "cancel:claude-code",
        "logout:claude-code",
        "flag:claude-code",
        `cancel:${WORK.id}`,
        `logout:${WORK.home}`,
        `recheck:${WORK.id}`,
      ]) {
        assert.include([...done], expected);
      }
      assert.isFalse(
        done.some((label) => label.includes("codex")),
        "Jan's Codex was signed out",
      );
    }),
  );

  // Only a read that says so signs anybody out: one that cannot be read keeps everyone in.
  for (const [name, access] of [
    ["still has access", { [EVA]: true, [JAN]: true }],
    ["cannot be read", {}],
  ] as const) {
    it.effect(`signs nobody out while every signer ${name}`, () =>
      Effect.gen(function* () {
        const { service, stopped, steps } = yield* offboarding(access);
        assert.strictEqual(yield* service.checkNow, 0);
        assert.deepStrictEqual(yield* Ref.get(stopped), []);
        assert.deepStrictEqual(yield* Ref.get(steps), []);
      }),
    );
  }
});
