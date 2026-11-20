import { expect, it } from "@effect/vitest";
import { EnvironmentId, ThreadId, ZeropsAgentLoginError } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { AtomRegistry } from "effect/reactivity";
import type { EnvironmentRegistry } from "../../connection/registry.ts";
import { mateActions } from "../projections/mateActions.ts";
import { makeAccountStore, readsOfState } from "../store.ts";
import { makeMateActions } from "./executors/mateActions.ts";

const environmentId = EnvironmentId.make("mate");
function rig<E>(answer: Effect.Effect<unknown, E>) {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  const actions = makeMateActions({
    store,
    makeId: () => "request-1",
    revalidate: () => {},
    registry: { run: () => answer } as unknown as EnvironmentRegistry["Service"],
  });
  return {
    store,
    actions,
    read: () => mateActions.derive(readsOfState(store.state()), environmentId),
    close: () => {
      actions.close();
      store.close();
      registry.dispose();
    },
  };
}

// witness: packages/client-runtime/src/data/operations/executors/mateActions.ts | "threadId", "terminalId", "id", "_tag" → "threadId", "terminalId", "id", "_tag", "code"
it.effect("OP49: A refused agent login is kept without its authorization code", () =>
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

// witness: packages/client-runtime/src/data/operations/executors/mateActions.ts | close: () => { → close: () => { if (observing.size === 0) return;
it.effect("OP53: Closing the account fences an agent command answer already in flight", () =>
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
