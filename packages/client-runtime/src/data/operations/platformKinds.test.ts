/**
 * Operations whose owner is Zerops or a Mate: no request ids to look up, a handle in the receipt,
 * and an end the owner's own facts say. A test-only kind restarts a service through Zerops.
 */
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";
import { AtomRegistry } from "effect/unstable/reactivity";

import { liveZerops } from "../__fixtures__/account.ts";
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

const ORG = "org";
const RESTART = {
  kind: "restart-service",
  serviceId: "s1",
  projectId: "p1",
} as unknown as OperationIntent;

/** Restarting a service: Zerops answers with the restart's process; the process says the end. */
const restartService = {
  kind: "restart-service",
  executor: "zerops",
  reflected: (read: ProjectionReads, _intent: unknown, receipt: OperationReceipt) =>
    receipt.handles.some((handle) => read.fact("process", handle).kind === "known"),
  settledBy: (read: ProjectionReads, _intent: unknown, receipt: OperationReceipt) => {
    const process = read.fact("process", receipt.handles[0] ?? "");
    if (process.kind !== "known") return null;
    if (process.value.status === "FINISHED") return { kind: "succeeded" };
    if (process.value.status === "FAILED" || process.value.status === "CANCELLED")
      return { kind: "failed", reason: `The restart process ended ${process.value.status}.` };
    return null;
  },
  acceptedBy: (read: ProjectionReads) => {
    const running = [...read.index("running", "p1")];
    return running.length === 0 ? null : { operationId: running[0]!, handles: running };
  },
} as unknown as RegisteredOperationKind;

const kinds = [...OPERATION_KINDS, restartService];
const progressOf = operationProgressOf(kinds);
const progress = (store: AccountStore, requestId: string) =>
  progressOf.derive(readsOfState(store.state()), requestId);

const receiptOf = (requestId: string): OperationReceipt => ({
  requestId,
  operationId: "proc-1",
  executor: "zerops",
  affected: [{ family: "process", id: "proc-1" }],
  handles: ["proc-1"],
  acceptance: { kind: "accepted" },
  outcome: { kind: "pending" },
});

function account(): AccountStore {
  const store = makeAccountStore(AtomRegistry.make());
  liveZerops({ running: [] }).forEach(store.dispatch);
  return store;
}

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
        value: { id, projectId: "p1", status, actionName: "stack.restart" },
        revision: { kind: "zerops", version },
      },
    ],
  });

function zerops(options: { readonly loseAnswer: boolean }) {
  const submitted: string[] = [];
  const executor: OperationExecutor = {
    submit: (requestId) =>
      Effect.suspend((): ReturnType<OperationExecutor["submit"]> => {
        submitted.push(requestId);
        return options.loseAnswer
          ? Effect.fail({ outcome: "uncertain-acceptance", message: "No answer." })
          : Effect.succeed(receiptOf(requestId));
      }),
    lookupHandle: (handle) =>
      Effect.sync(() => (handle === "proc-1" ? receiptOf("request-1") : null)),
  };
  return { executor, submitted };
}

const ids = () => {
  let next = 0;
  return () => `request-${(next += 1)}`;
};

describe("an operation Zerops executes", () => {
  it.effect("is reflected by its receipt's process and ended by that process's row", () =>
    Effect.gen(function* () {
      for (const [status, outcome] of [
        ["FINISHED", { stage: "done", operationId: "proc-1", outcome: "succeeded" }],
        [
          "FAILED",
          {
            stage: "done",
            operationId: "proc-1",
            outcome: "failed",
            reason: "The restart process ended FAILED.",
          },
        ],
      ] as const) {
        const store = account();
        const owner = zerops({ loseAnswer: false });
        const operations = makeOperations({
          store,
          kinds,
          executors: { zerops: owner.executor },
          makeId: ids(),
        });
        const requestId = yield* operations.submit(RESTART);
        expect(progress(store, requestId)).toEqual({ stage: "accepted", operationId: "proc-1" });

        processRow(store, "proc-1", "RUNNING", 1);
        expect(progress(store, requestId)).toEqual({ stage: "reflected", operationId: "proc-1" });
        yield* TestClock.adjust("2 hours");
        expect(progress(store, requestId).stage).toBe("reflected");

        processRow(store, "proc-1", status, 2);
        expect(progress(store, requestId)).toEqual(outcome);
      }
    }),
  );

  it.effect("resolves a lost answer by the owner's facts, and never sends it again", () =>
    Effect.gen(function* () {
      const store = account();
      const owner = zerops({ loseAnswer: true });
      const operations = makeOperations({
        store,
        kinds,
        executors: { zerops: owner.executor },
        makeId: ids(),
      });

      // The facts do not show the restart yet: uncertain, with checking again as the next step.
      const requestId = yield* operations.submit(RESTART);
      expect(progress(store, requestId)).toEqual({ stage: "uncertain", next: "ask-owner-again" });

      // They do now: the person's retry checks them and finds the restart's process.
      processRow(store, "proc-1", "RUNNING", 1);
      yield* operations.retry(requestId);
      expect(progress(store, requestId)).toEqual({ stage: "reflected", operationId: "proc-1" });
      expect(owner.submitted).toEqual([requestId]);
    }),
  );

  it.effect("resumes after a restart by the handle it was accepted with", () =>
    Effect.gen(function* () {
      const store = account();
      const owner = zerops({ loseAnswer: false });
      yield* makeOperations({
        store,
        kinds,
        executors: { zerops: owner.executor },
        makeId: ids(),
      }).resume("request-1", RESTART, ["proc-1"]);
      expect(owner.submitted).toEqual([]);
      expect(progress(store, "request-1")).toEqual({ stage: "accepted", operationId: "proc-1" });
    }),
  );
});
