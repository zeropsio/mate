/**
 * Operations whose owner is Zerops or a Mate: no request ids to look up, a handle in the receipt,
 * and an end the owner's own facts say. A test-only kind restarts a service through Zerops.
 */
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";
import { AtomRegistry } from "effect/reactivity";

import { liveZerops, processValue } from "../__fixtures__/account.ts";
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
  /** The processes that would show a restart of the project's service: those running in it. */
  effectHandles: (read: ProjectionReads) => [...read.index("running", "p1")],
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
        value: processValue({ id, projectId: "p1", status, actionName: "stack.restart" }),
        revision: { kind: "zerops", version },
      },
    ],
  });

function zerops(options: { readonly loseAnswer: boolean; readonly unreachable?: () => boolean }) {
  const submitted: string[] = [];
  const executor: OperationExecutor = {
    submit: (requestId) =>
      Effect.suspend((): ReturnType<OperationExecutor["submit"]> => {
        submitted.push(requestId);
        return options.loseAnswer
          ? Effect.fail({ outcome: "uncertain-acceptance", message: "No answer." })
          : Effect.succeed(receiptOf(requestId));
      }),
    // Zerops answers for its process, knowing nothing of the request id that started it.
    lookupHandle: (handle) =>
      options.unreachable?.()
        ? Effect.fail({ outcome: "transient", message: "Zerops could not be reached." })
        : Effect.sync(() => (handle === "proc-1" ? receiptOf(handle) : null)),
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
      }).resume("request-7", RESTART, ["proc-1"]);
      expect(owner.submitted).toEqual([]);
      expect(progress(store, "request-7")).toEqual({ stage: "accepted", operationId: "proc-1" });
    }),
  );

  it.effect("asks again by the handle it resumed with, never adopting another process", () =>
    Effect.gen(function* () {
      const store = account();
      let unreachable = true;
      const owner = zerops({ loseAnswer: false, unreachable: () => unreachable });
      const operations = makeOperations({
        store,
        kinds,
        executors: { zerops: owner.executor },
        makeId: ids(),
      });
      yield* operations.resume("request-7", RESTART, ["proc-1"]);
      expect(progress(store, "request-7")).toEqual({ stage: "uncertain", next: "ask-owner-again" });

      // Someone else's process runs in the project meanwhile; the retry still asks by the handle.
      processRow(store, "proc-other", "RUNNING", 1);
      unreachable = false;
      yield* operations.retry("request-7");
      expect(progress(store, "request-7")).toEqual({ stage: "accepted", operationId: "proc-1" });
    }),
  );

  it.effect.each<{
    readonly name: string;
    readonly before: ReadonlyArray<string>;
    readonly after: ReadonlyArray<string>;
    readonly claimed: ReadonlyArray<string>;
    readonly adopted: string | null;
  }>([
    {
      name: "a process that already ran before the send",
      before: ["proc-old"],
      after: ["proc-old"],
      claimed: [],
      adopted: null,
    },
    {
      name: "a process another operation holds",
      before: [],
      after: ["proc-2", "proc-1"],
      claimed: ["proc-2"],
      adopted: "proc-1",
    },
    {
      name: "two new processes, either of which may be someone else's",
      before: [],
      after: ["proc-1", "proc-3"],
      claimed: [],
      adopted: null,
    },
  ])("adopts after a lost answer only one new, unclaimed process: $name", (example) =>
    Effect.gen(function* () {
      const store = account();
      const owner = zerops({ loseAnswer: true, unreachable: () => true });
      const operations = makeOperations({
        store,
        kinds,
        executors: { zerops: owner.executor },
        makeId: ids(),
      });
      example.before.forEach((id) => processRow(store, id, "RUNNING", 1));
      for (const handle of example.claimed)
        yield* operations.resume(`held-${handle}`, RESTART, [handle]);

      const requestId = yield* operations.submit(RESTART);
      example.after
        .filter((id) => !example.before.includes(id))
        .forEach((id) => processRow(store, id, "RUNNING", 1));
      yield* operations.retry(requestId);

      expect(progress(store, requestId)).toEqual(
        example.adopted === null
          ? { stage: "uncertain", next: "ask-owner-again" }
          : { stage: "reflected", operationId: example.adopted },
      );
      expect(owner.submitted).toEqual([requestId]);
    }),
  );

  it.effect("is done when its process ended, even after its observation ran out", () =>
    Effect.gen(function* () {
      const store = account();
      const owner = zerops({ loseAnswer: false });
      const requestId = yield* makeOperations({
        store,
        kinds,
        executors: { zerops: owner.executor },
        makeId: ids(),
      }).submit(RESTART);
      store.dispatch({
        kind: "operation-exhausted",
        requestId,
        unobservable: { nextActor: "Zerops" },
      });
      expect(progress(store, requestId)).toEqual({
        stage: "unresolved",
        operationId: "proc-1",
        nextActor: "Zerops",
      });

      processRow(store, "proc-1", "FINISHED", 2);
      expect(progress(store, requestId)).toEqual({
        stage: "done",
        operationId: "proc-1",
        outcome: "succeeded",
      });
    }),
  );

  it.effect("is unresolved only when its owner says it can no longer observe it", () =>
    Effect.gen(function* () {
      const store = account();
      const executor: OperationExecutor = {
        submit: () => Effect.fail({ outcome: "uncertain-acceptance", message: "No answer." }),
        lookupHandle: () => Effect.succeed({ unobservable: { nextActor: "Zerops support" } }),
      };
      const operations = makeOperations({
        store,
        kinds,
        executors: { zerops: executor },
        makeId: ids(),
      });
      yield* operations.resume("request-7", RESTART, ["proc-gone"]);
      expect(progress(store, "request-7")).toEqual({
        stage: "unresolved",
        operationId: null,
        nextActor: "Zerops support",
      });
    }),
  );

  it.effect("ends unresolved with a named next action when its own send says so", () =>
    Effect.gen(function* () {
      const store = account();
      const sent: string[] = [];
      const executor: OperationExecutor = {
        // The stop ran; its end can no longer be observed, so the start is never sent blindly.
        submit: (requestId) =>
          Effect.sync(() => {
            sent.push(requestId);
            return {
              unobservable: {
                nextActor: "you",
                nextAction: "Start the Mate",
                handles: ["stop-1"],
              },
            };
          }),
      };
      const operations = makeOperations({
        store,
        kinds,
        executors: { zerops: executor },
        makeId: ids(),
      });
      const requestId = yield* operations.submit(RESTART);
      expect(progress(store, requestId)).toEqual({
        stage: "unresolved",
        operationId: null,
        nextActor: "you",
        nextAction: "Start the Mate",
      });
      expect(store.state().operations.get(requestId)?.handles).toEqual(["stop-1"]);
      yield* operations.retry(requestId);
      expect(sent).toEqual([requestId]);
    }),
  );
});
