import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";

import { liveZerops, ORG, processValue } from "../__fixtures__/account.ts";
import { accountOf } from "../__fixtures__/operations.ts";
import { runningScope } from "../families/process.ts";
import type { OperationIntent, OperationReceipt } from "../model.ts";
import { operationProgressOf } from "../projections/operation.ts";
import { readsOfState, type AccountStore } from "../store.ts";
import { makeOperations, type OperationExecutor } from "./coordinator.ts";
import type { RegisteredOperationKind } from "./kind.ts";

const move: RegisteredOperationKind = {
  kind: "test-move",
  executor: "hq",
  reflected: (read, _intent, receipt) =>
    receipt.handles.some((handle) => read.fact("process", handle).kind === "known"),
};
const restart: RegisteredOperationKind = {
  kind: "restart-service",
  executor: "zerops",
  reflected: move.reflected,
  effectHandles: (read) => [...read.index("running", "p1")],
};
const kinds = [move, restart];
const MOVE = { kind: "test-move", projectId: "p1" } as unknown as OperationIntent;
const RESTART = {
  kind: "restart-service",
  serviceId: "s1",
  projectId: "p1",
} as unknown as OperationIntent;
const account = () => accountOf(liveZerops({ running: [] }));
const progressOf = operationProgressOf(kinds);
const progress = (store: AccountStore, requestId: string) =>
  progressOf.derive(readsOfState(store.state()), requestId);

const receipt = (requestId: string): OperationReceipt => ({
  requestId,
  operationId: "op-1",
  executor: "hq",
  affected: [{ family: "process", id: "proc-1" }],
  handles: ["proc-1"],
  acceptance: { kind: "accepted" },
  outcome: { kind: "pending" },
});

function fixtureOwner(options: { loseAnswers?: number; unavailable?: number } = {}) {
  const held = new Map<string, OperationReceipt>();
  const submitted: string[] = [];
  let unavailable = options.unavailable ?? 0;
  let lost = options.loseAnswers ?? 0;
  const executor: OperationExecutor = {
    submit: (id) =>
      Effect.suspend((): ReturnType<OperationExecutor["submit"]> => {
        submitted.push(id);
        if (unavailable > 0) {
          unavailable--;
          return Effect.fail({ outcome: "transient", message: "HTTP 503" });
        }
        held.set(id, receipt(id));
        if (lost > 0) {
          lost--;
          return Effect.fail({ outcome: "uncertain-acceptance", message: "No answer." });
        }
        return Effect.succeed(held.get(id)!);
      }),
    lookup: (id) => Effect.succeed(held.get(id) ?? null),
  };
  return { held, submitted, executor };
}

function operationsFor(
  store: AccountStore,
  executors: Parameters<typeof makeOperations>[0]["executors"],
) {
  let next = 0;
  return makeOperations({ store, kinds, executors, makeId: () => `request-${++next}` });
}

/** Zerops shows the redeploy's process, as its stream would say it. */
const reflect = (store: AccountStore) =>
  store.dispatch({
    kind: "rows",
    scope: runningScope(ORG),
    generation: 1,
    method: "push",
    via: "zerops-realtime",
    rows: [
      {
        family: "process",
        id: "proc-1",
        value: processValue({ id: "proc-1", projectId: "p1" }),
        revision: { kind: "zerops", version: 1 },
      },
    ],
  });

const processRow = (store: AccountStore, id: string, status: string, version: number) =>
  store.dispatch({
    kind: "rows",
    scope: runningScope(ORG),
    generation: 1,
    method: "push",
    via: "zerops-realtime",
    rows: [
      {
        family: "process",
        id,
        value: processValue({ id, projectId: "p1", status, actionName: "stack.restart" }),
        revision: { kind: "zerops", version },
      },
    ],
  });

// witness: packages/client-runtime/src/data/operations/coordinator.ts | held.receipt === null && held.submission === "unsent" → held.receipt === null
it.effect("OP1: A second retry press while its answer is pending sends no second write", () =>
  Effect.gen(function* () {
    const store = account();
    const owner = fixtureOwner({ unavailable: 1 });
    const started = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    const executor: OperationExecutor = {
      ...owner.executor,
      submit: (id, intent) =>
        Effect.gen(function* () {
          const answer = yield* owner.executor.submit(id, intent);
          if (yield* Deferred.succeed(started, undefined)) yield* Deferred.await(release);
          return answer;
        }),
    };
    const operations = operationsFor(store, { hq: executor });
    yield* operations.submit(MOVE, "original");
    const pending = yield* Effect.forkChild(operations.submit(MOVE, "original"));
    yield* Deferred.await(started);
    expect(progress(store, "original").stage).toBe("submitting");
    yield* operations.submit(MOVE, "original");
    yield* Deferred.succeed(release, undefined);
    yield* Fiber.join(pending);
    expect(owner.submitted).toEqual(["original", "original"]);
  }),
);

// witness: packages/client-runtime/src/data/operations/coordinator.ts | !sameValue(held.intent, intent) → held.intent.kind !== intent.kind
it.effect("OP2: A request id cannot be reused to act on another Mate", () =>
  Effect.gen(function* () {
    const store = account();
    const owner = fixtureOwner();
    const operations = operationsFor(store, { hq: owner.executor });
    yield* operations.submit(MOVE, "original");
    const result = yield* Effect.exit(
      operations.submit({ ...MOVE, projectId: "another" } as OperationIntent, "original"),
    );
    expect(result._tag).toBe("Failure");
    expect(owner.submitted).toEqual(["original"]);
    expect(store.state().operations.get("original")?.intent).toEqual(MOVE);
  }),
);

// witness: packages/client-runtime/src/data/operations/coordinator.ts | onSuccess: (answer) => admit(answer, requestId), → onSuccess: (answer) => admit("outcome" in answer ? { ...answer, handles: [answer.operationId] } : answer, requestId),
it.effect(
  "OP3: An accepted operation is reflected and then done only when its owner says it ended, never by a clock",
  () =>
    Effect.gen(function* () {
      const store = account();
      const owner = fixtureOwner();
      const operations = operationsFor(store, { hq: owner.executor });

      const requestId = yield* operations.submit(MOVE);
      expect(progress(store, requestId)).toEqual({ stage: "accepted", operationId: "op-1" });

      reflect(store);
      expect(progress(store, requestId)).toEqual({ stage: "reflected", operationId: "op-1" });

      yield* TestClock.adjust("3 hours");
      expect(progress(store, requestId).stage).toBe("reflected");

      store.dispatch({
        kind: "operation-receipt",
        receipt: {
          ...owner.held.get(requestId)!,
          outcome: { kind: "succeeded", evidence: "hq:op-1" },
        },
      });
      expect(progress(store, requestId)).toEqual({
        stage: "done",
        operationId: "op-1",
        outcome: "succeeded",
      });
    }),
);

// witness: packages/client-runtime/src/data/operations/coordinator.ts | executor.lookup(requestId, intent) → executor.lookup(options.makeId(), intent)
it.effect(
  "OP4: After a lost answer an operation asks its owner by the original request id and sends nothing twice",
  () =>
    Effect.gen(function* () {
      const store = account();
      const owner = fixtureOwner({ loseAnswers: 1 });
      const operations = operationsFor(store, { hq: owner.executor });

      const requestId = yield* operations.submit(MOVE);
      expect(owner.submitted).toEqual([requestId]);
      expect(progress(store, requestId).stage).toBe("accepted");
    }),
);

// witness: packages/client-runtime/src/data/operations/coordinator.ts | other !== requestId && !ended(read, held) → other !== requestId && ended(read, held)
it.effect(
  "OP5: After a lost answer a Zerops operation adopts only one new process that no other operation holds; a process that ran before the send, or two new ones, adopt nothing",
  () =>
    Effect.gen(function* () {
      const observe = (before: string[], after: string[], claimed: string[]) =>
        Effect.gen(function* () {
          const store = account();
          const submitted: string[] = [];
          const operations = operationsFor(store, {
            zerops: {
              submit: (id) => {
                submitted.push(id);
                return Effect.fail({ outcome: "uncertain-acceptance", message: "No answer." });
              },
              lookupHandle: () =>
                Effect.fail({ outcome: "transient", message: "Zerops could not be reached." }),
            },
          });
          for (const id of before) processRow(store, id, "RUNNING", 1);
          for (const handle of claimed)
            yield* operations.resume(`held-${handle}`, RESTART, [handle]);
          const requestId = yield* operations.submit(RESTART);
          for (const id of after) if (!before.includes(id)) processRow(store, id, "RUNNING", 1);
          yield* operations.retry(requestId);
          expect(submitted).toEqual([requestId]);
          return progress(store, requestId);
        });
      expect(yield* observe(["proc-old"], ["proc-old"], [])).toEqual({
        stage: "uncertain",
        next: "ask-owner-again",
      });
      expect(yield* observe([], ["proc-2", "proc-1"], ["proc-2"])).toEqual({
        stage: "reflected",
        operationId: "proc-1",
      });
      expect(yield* observe([], ["proc-1", "proc-3"], [])).toEqual({
        stage: "uncertain",
        next: "ask-owner-again",
      });
    }),
);
