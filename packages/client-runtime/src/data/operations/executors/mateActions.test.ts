import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId, ThreadId, ZeropsAgentLoginError } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { AtomRegistry } from "effect/unstable/reactivity";
import type { EnvironmentRegistry } from "../../../connection/registry.ts";
import { EnvironmentRpcUnavailableError } from "../../../rpc/client.ts";
import { mateActions } from "../../projections/mateActions.ts";
import { makeAccountStore, readsOfState } from "../../store.ts";
import { makeMateActions } from "./mateActions.ts";
const environmentId = EnvironmentId.make("mate");
const rig = <E>(answer: Effect.Effect<unknown, E>) => {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  let calls = 0;
  let ordinal = 0;
  const revalidated: string[] = [];
  const actions = makeMateActions({
    store,
    makeId: () => `request-${++ordinal}`,
    revalidate: (action) => {
      revalidated.push(action);
    },
    registry: {
      run: () =>
        Effect.suspend(() => {
          expect(store.state().operations.size).toBe(ordinal);
          calls++;
          return answer;
        }),
    } as unknown as EnvironmentRegistry["Service"],
  });
  return {
    store,
    actions,
    calls: () => calls,
    revalidated,
    read: () => mateActions.derive(readsOfState(store.state()), environmentId),
    close: () => {
      actions.close();
      store.close();
      registry.dispose();
    },
  };
};
describe("Mate action receipts", () => {
  it.effect("retains the login terminal after its initiating surface is gone", () =>
    Effect.gen(function* () {
      const r = rig(Effect.succeed({ terminalId: "login-terminal" }));
      yield* r.actions.execute("agentLoginStart", environmentId, {
        agentId: "codex",
        threadId: ThreadId.make("thread"),
      });
      expect(r.read()).toMatchObject([
        { action: "agentLoginStart", pending: false, error: null, terminalId: "login-terminal" },
      ]);
      r.close();
    }),
  );
  it.effect("retains a refused login without retaining its authorization code", () =>
    Effect.gen(function* () {
      const r = rig(
        Effect.fail(
          new ZeropsAgentLoginError({ reason: "invalid-login", detail: "Login was refused." }),
        ),
      );
      yield* Effect.exit(
        r.actions.execute("agentLoginSubmitCode", environmentId, {
          agentId: "claude-code",
          code: "private-code",
        }),
      );
      expect(r.read()).toMatchObject([{ pending: false, error: "Login was refused." }]);
      expect(r.store.state().operations.get("request-1")?.intent).toEqual({
        kind: "mate-action",
        environmentId,
        action: "agentLoginSubmitCode",
        target: { agentId: "claude-code" },
      });
      expect(r.read()[0]?.target).toEqual({ agentId: "claude-code" });
      r.close();
    }),
  );
  it.effect("a lost answer stays unresolved with a next action and never resends", () =>
    Effect.gen(function* () {
      const r = rig(Effect.die("socket closed"));
      yield* Effect.exit(r.actions.execute("agentSignOut", environmentId, { agentId: "codex" }));
      expect(r.read()).toMatchObject([
        { pending: false, error: "Check the Mate before trying this action again." },
      ]);
      expect(r.calls()).toBe(1);
      r.close();
    }),
  );
  it.effect("a command that never reached a Mate says it was not sent", () =>
    Effect.gen(function* () {
      const r = rig(
        Effect.fail(
          new EnvironmentRpcUnavailableError({ environmentId, message: "Mate is disconnected." }),
        ),
      );
      yield* Effect.exit(r.actions.execute("agentSignOut", environmentId, { agentId: "codex" }));
      expect(r.store.state().operations.get("request-1")?.submission).toBe("unsent");
      expect(r.read()).toMatchObject([{ pending: false, error: "Mate is disconnected." }]);
      r.close();
    }),
  );
  it.effect("account closure fences an answer already in flight", () =>
    Effect.gen(function* () {
      const answer = yield* Deferred.make<{ terminalId: string }>();
      const started = yield* Deferred.make<void>();
      const r = rig(Effect.andThen(Deferred.succeed(started, undefined), Deferred.await(answer)));
      const running = yield* Effect.forkChild(
        r.actions.execute("agentLoginStart", environmentId, {
          agentId: "codex",
          threadId: ThreadId.make("thread"),
        }),
      );
      yield* Deferred.await(started);
      expect(r.read()).toMatchObject([{ pending: true }]);
      r.actions.close();
      const prior = r.store.state();
      yield* Deferred.succeed(answer, { terminalId: "late-terminal" });
      yield* Fiber.await(running);
      expect(r.store.state()).toBe(prior);
      r.close();
    }),
  );
  it.effect("checking agent auth revalidates the read without recording a write", () =>
    Effect.gen(function* () {
      const r = rig(Effect.void);
      yield* r.actions.check(environmentId, { agentId: "codex" });
      expect(r.store.state().operations.size).toBe(0);
      expect(r.revalidated).toEqual(["agentAuthCheck"]);
      r.close();
    }),
  );
  it.effect("an auth check cannot revalidate after its account has closed", () =>
    Effect.gen(function* () {
      const answer = yield* Deferred.make<void>();
      const started = yield* Deferred.make<void>();
      const r = rig(Effect.andThen(Deferred.succeed(started, undefined), Deferred.await(answer)));
      const running = yield* Effect.forkChild(
        Effect.result(r.actions.check(environmentId, { agentId: "codex" })),
      );
      yield* Deferred.await(started);
      r.actions.close();
      yield* Deferred.succeed(answer, undefined);
      expect(yield* Fiber.join(running)).toMatchObject({
        _tag: "Failure",
        failure: { message: "This account has closed." },
      });
      expect(r.revalidated).toEqual([]);
      r.close();
    }),
  );
});
