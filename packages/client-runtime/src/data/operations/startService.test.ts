import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { liveZerops, ORG, processValue, zeropsVersion } from "../__fixtures__/account.ts";
import { accountOf, progressOf, zeropsOperations } from "../__fixtures__/operations.ts";
import { runningScope } from "../families/process.ts";
import type { AccountStore } from "../store.ts";
import { ZeropsApiError } from "../../zerops/api.ts";
import { startServiceExecutor } from "./executors/serviceWrites.ts";

const START = { kind: "start-service", orgId: ORG, projectId: "p1", serviceId: "s1" } as const;

const account = () =>
  accountOf(liveZerops({ running: [], services: [{ id: "s1", projectId: "p1" }] }));

const processRow = (
  store: AccountStore,
  id: string,
  status: string,
  version: number,
  serviceId = "s1",
) =>
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
        value: processValue({
          id,
          projectId: "p1",
          status,
          actionName: "stack.start",
          serviceStackIds: [serviceId],
        }),
        revision: zeropsVersion(version),
      },
    ],
  });

function operationsOf(store: AccountStore, answer: () => Promise<{ processId?: string }>) {
  const calls: string[] = [];
  const submit = startServiceExecutor({
    startService: (serviceId) => {
      calls.push(serviceId);
      return answer() as Promise<{ readonly processId: string | undefined }>;
    },
  });
  return { operations: zeropsOperations(store, submit), calls };
}

describe("start-service", () => {
  it.effect("is followed by its start process to that process's end", () =>
    Effect.gen(function* () {
      for (const [status, expected] of [
        ["FINISHED", { stage: "done", operationId: "proc-start", outcome: "succeeded" }],
        [
          "FAILED",
          {
            stage: "done",
            operationId: "proc-start",
            outcome: "failed",
            reason: "The start ended FAILED.",
          },
        ],
      ] as const) {
        const store = account();
        const { operations } = operationsOf(store, async () => ({ processId: "proc-start" }));
        yield* operations.submit(START);
        expect(progressOf(store)).toEqual({ stage: "accepted", operationId: "proc-start" });
        processRow(store, "proc-start", "RUNNING", 1);
        expect(progressOf(store)).toEqual({ stage: "reflected", operationId: "proc-start" });
        processRow(store, "proc-start", status, 2);
        expect(progressOf(store)).toEqual(expected);
      }
    }),
  );

  it.effect("ends with Zerops's answer where it names no process", () =>
    Effect.gen(function* () {
      const store = account();
      const { operations } = operationsOf(store, async () => ({}));
      yield* operations.submit(START);
      expect(progressOf(store)).toEqual({ stage: "done", operationId: "s1", outcome: "succeeded" });
    }),
  );

  it.effect(
    "adopts after a lost answer only a start running for its service, never sent again",
    () =>
      Effect.gen(function* () {
        const store = account();
        const { operations, calls } = operationsOf(store, () =>
          Promise.reject(new ZeropsApiError("No answer.", "network")),
        );
        yield* operations.submit(START);
        processRow(store, "proc-other", "RUNNING", 1, "s2");
        yield* operations.retry("r1");
        expect(progressOf(store)).toEqual({ stage: "uncertain", next: "ask-owner-again" });
        processRow(store, "proc-start", "RUNNING", 1);
        yield* operations.retry("r1");
        expect(progressOf(store)).toEqual({ stage: "reflected", operationId: "proc-start" });
        expect(calls).toEqual(["s1"]);
      }),
  );

  it.effect("a refusal says what Zerops said", () =>
    Effect.gen(function* () {
      const store = account();
      const { operations } = operationsOf(store, () =>
        Promise.reject(new ZeropsApiError("Service is not stopped.", "invalid-input", 400)),
      );
      yield* operations.submit(START);
      expect(progressOf(store)).toEqual({ stage: "refused", reason: "Service is not stopped." });
    }),
  );
});
