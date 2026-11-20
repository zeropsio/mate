import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
import { AtomRegistry } from "effect/reactivity";
import { liveZerops, ORG } from "../__fixtures__/account.ts";
import { progressOf, zeropsOperations } from "../__fixtures__/operations.ts";
import { linkKeys } from "../model.ts";
import { runningScope } from "../families/process.ts";
import { makeAccountStore, type AccountStore } from "../store.ts";
import { mateRestartOwner } from "./executors/mateRestart.ts";

const REVIVE = {
  kind: "mate-restart",
  orgId: ORG,
  projectId: "p1",
  serviceId: "s1",
  way: "stop-then-start",
} as const;

function restart() {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  liveZerops({ running: [] }).forEach(store.dispatch);
  const calls: string[] = [];
  const stopped = Promise.withResolvers<void>();
  const owner = mateRestartOwner({
    store,
    registry,
    holdHistory: () => () => {},
    platform: {
      restartService: async (id) => {
        calls.push(`restart ${id}`);
        return { processId: "proc-restart" };
      },
      stopService: async (id) => {
        calls.push(`stop ${id}`);
        stopped.resolve();
        return { processId: "proc-stop" };
      },
      startService: async (id) => {
        calls.push(`start ${id}`);
        return { processId: "proc-start" };
      },
    },
  });
  const operations = zeropsOperations(store, owner.submit);
  return { store, calls, stopSent: stopped.promise, operations };
}

const stopRow = (store: AccountStore, status: string, version: number) =>
  store.dispatch({
    kind: "rows",
    scope: runningScope(ORG),
    generation: 1,
    method: "push",
    via: "zerops-realtime",
    rows: [
      {
        family: "process",
        id: "proc-stop",
        value: {
          id: "proc-stop",
          projectId: "p1",
          serviceStackIds: ["s1"],
          status,
          actionName: "stack.stop",
          created: "2026-10-06T00:00:00Z",
        },
        revision: { kind: "zerops", version },
      },
    ],
  });

// witness: packages/client-runtime/src/data/operations/mateRestart.ts | return "ended"; → return "unobservable";
it.effect(
  "OP8: A Mate's restart starts a failed container only once its stop's process has ended, never by a clock",
  () =>
    Effect.gen(function* () {
      const { store, calls, stopSent, operations } = restart();
      const fiber = yield* Effect.forkChild(operations.submit(REVIVE));
      yield* Effect.promise(() => stopSent);
      expect(calls).toEqual(["stop s1"]);

      stopRow(store, "RUNNING", 1);
      yield* TestClock.adjust("10 minutes");
      expect(calls).toEqual(["stop s1"]);
      expect(progressOf(store)).toEqual({ stage: "submitting" });

      stopRow(store, "FAILED", 2);
      yield* Fiber.join(fiber);
      expect(calls).toEqual(["stop s1", "start s1"]);
      expect(progressOf(store)).toEqual({ stage: "accepted", operationId: "proc-start" });
    }),
);

// witness: packages/client-runtime/src/data/operations/mateRestart.ts | ? "unobservable" → ? "ended"
it.effect(
  "OP9: A Mate's restart whose stop can no longer be observed ends unresolved and never starts the Mate",
  () =>
    Effect.gen(function* () {
      for (const event of [
        { kind: "demand", demanded: false },
        { kind: "fault", fault: { outcome: "definitive-refusal", message: "x" }, jitter: 0 },
      ] as const) {
        const { store, calls, stopSent, operations } = restart();
        const fiber = yield* Effect.forkChild(operations.submit(REVIVE));
        yield* Effect.promise(() => stopSent);
        stopRow(store, "RUNNING", 1);
        store.dispatch({ kind: "stream", key: linkKeys.zerops(ORG), event, now: 0 });
        yield* Fiber.join(fiber);
        expect(calls).toEqual(["stop s1"]);
        expect(progressOf(store)).toEqual({
          stage: "unresolved",
          operationId: null,
          nextActor: "person",
          nextAction: "Start the Mate",
        });
        expect(store.state().operations.get("r1")?.handles).toEqual(["proc-stop"]);
      }
    }),
);
