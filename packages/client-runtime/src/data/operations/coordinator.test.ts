import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";
import { AtomRegistry } from "effect/unstable/reactivity";

import { liveZerops, ORG, processValue } from "../__fixtures__/account.ts";
import { runningScope } from "../families/process.ts";
import type { OperationIntent, OperationReceipt } from "../model.ts";
import { operationProgressOf } from "../projections/operation.ts";
import {
  makeAccountStore,
  readsOfState,
  type AccountStore,
  type ProjectionReads,
} from "../store.ts";
import { makeOperations, type OperationExecutor } from "./coordinator.ts";
import type { RegisteredOperationKind } from "./kind.ts";
import { OPERATION_KINDS } from "./kinds.ts";

/** A test-only kind HQ executes: a move, reflected once Zerops shows its deploy process. */
const move: RegisteredOperationKind = {
  kind: "test-move",
  executor: "hq",
  reflected: (read: ProjectionReads, _intent, receipt: OperationReceipt) =>
    receipt.handles.some((handle) => read.fact("process", handle).kind === "known"),
};
const kinds = [...OPERATION_KINDS, move];
const MOVE = { kind: "test-move", projectId: "p1" } as unknown as OperationIntent;

/** HQ as the operation's owner: it applies each request id once, and may lose its answer. */
function fixtureOwner(options: {
  readonly loseAnswers: number;
  readonly loseRequests?: number;
  readonly unreachable?: () => boolean;
  /** Sends refused at the door (`503`): never taken. */
  readonly unavailable?: number;
}) {
  let unavailable = options.unavailable ?? 0;
  const held = new Map<string, OperationReceipt>();
  let answersToLose = options.loseAnswers;
  let requestsToLose = options.loseRequests ?? 0;
  const effects: string[] = [];
  const submitted: string[] = [];
  const executor: OperationExecutor = {
    submit: (requestId) =>
      Effect.suspend((): ReturnType<OperationExecutor["submit"]> => {
        submitted.push(requestId);
        if (unavailable > 0) {
          unavailable -= 1;
          return Effect.fail({ outcome: "transient", message: "HTTP 503" } as const);
        }
        if (requestsToLose > 0) {
          requestsToLose -= 1;
          return Effect.fail({ outcome: "uncertain-acceptance", message: "No answer." } as const);
        }
        if (!held.has(requestId)) {
          effects.push(requestId);
          held.set(requestId, {
            requestId,
            operationId: `op-${held.size + 1}`,
            executor: "hq",
            affected: [{ family: "process", id: `proc-${held.size + 1}` }],
            handles: [`proc-${held.size + 1}`],
            acceptance: { kind: "accepted" },
            outcome: { kind: "pending" },
          });
        }
        if (answersToLose > 0) {
          answersToLose -= 1;
          return Effect.fail({ outcome: "uncertain-acceptance", message: "No answer." } as const);
        }
        return Effect.succeed(held.get(requestId)!);
      }),
    lookup: (requestId) =>
      options.unreachable?.()
        ? Effect.fail({ outcome: "transient", message: "HQ could not be reached." } as const)
        : Effect.sync(() => held.get(requestId) ?? null),
  };
  return { executor, effects, held, submitted };
}

const ids = () => {
  let next = 0;
  return () => `request-${(next += 1)}`;
};

function account(): AccountStore {
  const store = makeAccountStore(AtomRegistry.make());
  liveZerops({ running: [] }).forEach(store.dispatch);
  return store;
}

const progress = (store: AccountStore, requestId: string) =>
  operationProgressOf(kinds).derive(readsOfState(store.state()), requestId);

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

describe("makeOperations", () => {
  it.effect("goes accepted → reflected → done, the end said by its owner, never by a clock", () =>
    Effect.gen(function* () {
      const store = account();
      const owner = fixtureOwner({ loseAnswers: 0 });
      const operations = makeOperations({
        store,
        kinds,
        executors: { hq: owner.executor },
        makeId: ids(),
      });

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

  it.effect("asks the owner by the original id after a lost answer and sends nothing twice", () =>
    Effect.gen(function* () {
      const store = account();
      const owner = fixtureOwner({ loseAnswers: 1 });
      const operations = makeOperations({
        store,
        kinds,
        executors: { hq: owner.executor },
        makeId: ids(),
      });

      const requestId = yield* operations.submit(MOVE);
      expect(owner.submitted).toEqual([requestId]);
      expect(owner.effects).toEqual([requestId]);
      expect(progress(store, requestId).stage).toBe("accepted");
    }),
  );

  it.effect("sends again, under the same id, only to an owner that never took it", () =>
    Effect.gen(function* () {
      const store = account();
      const owner = fixtureOwner({ loseAnswers: 0, loseRequests: 1 });
      const operations = makeOperations({
        store,
        kinds,
        executors: { hq: owner.executor },
        makeId: ids(),
      });

      const requestId = yield* operations.submit(MOVE);
      expect(owner.submitted).toEqual([requestId, requestId]);
      expect(owner.effects).toEqual([requestId]);
      expect(progress(store, requestId).stage).toBe("accepted");
    }),
  );

  it.effect(
    "stays uncertain while the owner cannot be asked, and a restart resumes by the id",
    () =>
      Effect.gen(function* () {
        let unreachable = true;
        const owner = fixtureOwner({ loseAnswers: 1, unreachable: () => unreachable });
        const before = account();
        const requestId = yield* makeOperations({
          store: before,
          kinds,
          executors: { hq: owner.executor },
          makeId: ids(),
        }).submit(MOVE);
        expect(progress(before, requestId)).toEqual({
          stage: "uncertain",
          next: "ask-owner-again",
        });
        expect(owner.submitted).toEqual([requestId]);

        // The tab restarts: its memory is gone, the request id is what it resumes by.
        unreachable = false;
        const after = account();
        yield* makeOperations({
          store: after,
          kinds,
          executors: { hq: owner.executor },
          makeId: ids(),
        }).resume(requestId, MOVE);
        expect(owner.submitted).toEqual([requestId]);
        expect(owner.effects).toEqual([requestId]);
        expect(progress(after, requestId)).toEqual({ stage: "accepted", operationId: "op-1" });
      }),
  );

  it.effect("shows a send the owner never took as unsent, and sends it again under its id", () =>
    Effect.gen(function* () {
      const store = account();
      const owner = fixtureOwner({ loseAnswers: 0, unavailable: 1 });
      const operations = makeOperations({
        store,
        kinds,
        executors: { hq: owner.executor },
        makeId: ids(),
      });

      const requestId = yield* operations.submit(MOVE);
      expect(progress(store, requestId)).toEqual({
        stage: "unsent",
        next: "send-again",
        reason: "HTTP 503",
      });
      expect(owner.effects).toEqual([]);

      yield* operations.retry(requestId);
      expect(owner.submitted).toEqual([requestId, requestId]);
      expect(owner.effects).toEqual([requestId]);
      expect(progress(store, requestId).stage).toBe("accepted");
    }),
  );

  it.effect("asks the owner again, never sends, when the person retries an uncertain one", () =>
    Effect.gen(function* () {
      let unreachable = true;
      const owner = fixtureOwner({ loseAnswers: 1, unreachable: () => unreachable });
      const store = account();
      const operations = makeOperations({
        store,
        kinds,
        executors: { hq: owner.executor },
        makeId: ids(),
      });
      const requestId = yield* operations.submit(MOVE);

      unreachable = false;
      yield* operations.retry(requestId);
      expect(owner.submitted).toEqual([requestId]);
      expect(progress(store, requestId).stage).toBe("accepted");
    }),
  );

  it.effect("shows a request lost twice, which the owner never took, as unsent", () =>
    Effect.gen(function* () {
      const store = account();
      const owner = fixtureOwner({ loseAnswers: 0, loseRequests: 2 });
      const operations = makeOperations({
        store,
        kinds,
        executors: { hq: owner.executor },
        makeId: ids(),
      });

      const requestId = yield* operations.submit(MOVE);
      expect(owner.submitted).toEqual([requestId, requestId]);
      expect(owner.effects).toEqual([]);
      expect(progress(store, requestId)).toEqual({ stage: "unsent", next: "send-again" });
    }),
  );

  it("ends an observation that ran out as unresolved, naming who acts next, never as failed", () => {
    const store = account();
    store.dispatch({ kind: "operation-recorded", requestId: "request-1", intent: MOVE });
    store.dispatch({
      kind: "operation-exhausted",
      requestId: "request-1",
      unobservable: { nextActor: "HQ" },
    });
    expect(progress(store, "request-1")).toEqual({
      stage: "unresolved",
      operationId: null,
      nextActor: "HQ",
    });
  });
});
