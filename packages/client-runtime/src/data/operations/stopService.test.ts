import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { liveZerops, ORG, processValue, zeropsVersion } from "../__fixtures__/account.ts";
import { accountOf, progressOf, zeropsOperations } from "../__fixtures__/operations.ts";
import { runningScope } from "../families/process.ts";
import type { AccountStore } from "../store.ts";
import { ZeropsApiError } from "../../zerops/api.ts";
import { stopServiceExecutor } from "./executors/serviceWrites.ts";

const STOP = { kind: "stop-service", orgId: ORG, projectId: "p1", serviceId: "s1" } as const;

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
          actionName: "stack.stop",
          serviceStackIds: [serviceId],
        }),
        revision: zeropsVersion(version),
      },
    ],
  });

function operationsOf(store: AccountStore, answer: () => Promise<{ processId?: string }>) {
  const calls: string[] = [];
  const submit = stopServiceExecutor({
    stopService: (serviceId) => {
      calls.push(serviceId);
      return answer() as Promise<{ readonly processId: string | undefined }>;
    },
  });
  return { operations: zeropsOperations(store, submit), calls };
}

describe("stop-service", () => {
  it.effect("is followed by its stop process to that process's end", () =>
    Effect.gen(function* () {
      for (const [status, expected] of [
        ["FINISHED", { stage: "done", operationId: "proc-stop", outcome: "succeeded" }],
        [
          "FAILED",
          {
            stage: "done",
            operationId: "proc-stop",
            outcome: "failed",
            reason: "The stop ended FAILED.",
          },
        ],
      ] as const) {
        const store = account();
        const { operations } = operationsOf(store, async () => ({ processId: "proc-stop" }));
        yield* operations.submit(STOP);
        expect(progressOf(store)).toEqual({ stage: "accepted", operationId: "proc-stop" });
        processRow(store, "proc-stop", "RUNNING", 1);
        expect(progressOf(store)).toEqual({ stage: "reflected", operationId: "proc-stop" });
        processRow(store, "proc-stop", status, 2);
        expect(progressOf(store)).toEqual(expected);
      }
    }),
  );

  it.effect("ends with Zerops's answer where it names no process", () =>
    Effect.gen(function* () {
      const store = account();
      const { operations } = operationsOf(store, async () => ({}));
      yield* operations.submit(STOP);
      expect(progressOf(store)).toEqual({ stage: "done", operationId: "s1", outcome: "succeeded" });
    }),
  );

  it.effect(
    "adopts after a lost answer only a stop running for its service, never sent again",
    () =>
      Effect.gen(function* () {
        const store = account();
        const { operations, calls } = operationsOf(store, () =>
          Promise.reject(new ZeropsApiError("No answer.", "network")),
        );
        yield* operations.submit(STOP);
        processRow(store, "proc-other", "RUNNING", 1, "s2");
        yield* operations.retry("r1");
        expect(progressOf(store)).toEqual({ stage: "uncertain", next: "ask-owner-again" });
        processRow(store, "proc-stop", "RUNNING", 1);
        yield* operations.retry("r1");
        expect(progressOf(store)).toEqual({ stage: "reflected", operationId: "proc-stop" });
        expect(calls).toEqual(["s1"]);
      }),
  );

  it.effect("a refusal says what Zerops said", () =>
    Effect.gen(function* () {
      const store = account();
      const { operations } = operationsOf(store, () =>
        Promise.reject(new ZeropsApiError("Service is not running.", "invalid-input", 400)),
      );
      yield* operations.submit(STOP);
      expect(progressOf(store)).toEqual({ stage: "refused", reason: "Service is not running." });
    }),
  );
});
