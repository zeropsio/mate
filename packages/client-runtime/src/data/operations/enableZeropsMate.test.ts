import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { liveZerops, ORG, processValue, zeropsVersion } from "../__fixtures__/account.ts";
import { accountOf, progressOf, zeropsOperations } from "../__fixtures__/operations.ts";
import { runningScope } from "../families/process.ts";
import type { AccountStore } from "../store.ts";
import { ZeropsApiError } from "../../zerops/api.ts";
import { enableZeropsMateExecutor } from "./executors/serviceWrites.ts";

const ENABLE = {
  kind: "enable-zerops-mate",
  orgId: ORG,
  projectId: "p1",
  serviceId: "s1",
} as const;

const account = () =>
  accountOf(liveZerops({ running: [], services: [{ id: "s1", projectId: "p1" }] }));

const restartRow = (store: AccountStore, status: string, version: number) =>
  store.dispatch({
    kind: "rows",
    scope: runningScope(ORG),
    generation: 1,
    method: "push",
    via: "zerops-realtime",
    rows: [
      {
        family: "process",
        id: "proc-restart",
        value: processValue({
          id: "proc-restart",
          projectId: "p1",
          status,
          actionName: "stack.restart",
          serviceStackIds: ["s1"],
        }),
        revision: zeropsVersion(version),
      },
    ],
  });

function operationsOf(
  store: AccountStore,
  answers: {
    readonly flag?: () => Promise<void>;
    readonly restart?: () => Promise<{ readonly processId: string | undefined }>;
  },
) {
  const calls: string[] = [];
  const submit = enableZeropsMateExecutor({
    writeMateFlag: (serviceId) => {
      calls.push(`flag ${serviceId}`);
      return answers.flag?.() ?? Promise.resolve();
    },
    restartService: (serviceId) => {
      calls.push(`restart ${serviceId}`);
      return answers.restart?.() ?? Promise.resolve({ processId: "proc-restart" });
    },
  });
  return { operations: zeropsOperations(store, submit), calls };
}

describe("enable-zerops-mate", () => {
  it.effect("writes the flag, restarts, and ends with the restart's process", () =>
    Effect.gen(function* () {
      for (const [status, expected] of [
        ["FINISHED", { stage: "done", operationId: "proc-restart", outcome: "succeeded" }],
        [
          "FAILED",
          {
            stage: "done",
            operationId: "proc-restart",
            outcome: "failed",
            reason: "The restart ended FAILED.",
          },
        ],
      ] as const) {
        const store = account();
        const { operations, calls } = operationsOf(store, {});
        yield* operations.submit(ENABLE);
        expect(calls).toEqual(["flag s1", "restart s1"]);
        expect(progressOf(store)).toEqual({ stage: "accepted", operationId: "proc-restart" });
        restartRow(store, "RUNNING", 1);
        expect(progressOf(store)).toEqual({ stage: "reflected", operationId: "proc-restart" });
        restartRow(store, status, 2);
        expect(progressOf(store)).toEqual(expected);
      }
    }),
  );

  it.effect("a flag Zerops refused restarts nothing", () =>
    Effect.gen(function* () {
      const store = account();
      const { operations, calls } = operationsOf(store, {
        flag: () => Promise.reject(new ZeropsApiError("Not allowed.", "forbidden", 403)),
      });
      yield* operations.submit(ENABLE);
      expect(calls).toEqual(["flag s1"]);
      expect(progressOf(store)).toEqual({ stage: "refused", reason: "Not allowed." });
    }),
  );

  it.effect("a restart not taken after the flag landed ends unresolved, restarting next", () =>
    Effect.gen(function* () {
      const store = account();
      const { operations, calls } = operationsOf(store, {
        restart: () => Promise.reject(new ZeropsApiError("Service is busy.", "invalid-input", 400)),
      });
      yield* operations.submit(ENABLE);
      expect(calls).toEqual(["flag s1", "restart s1"]);
      expect(progressOf(store)).toEqual({
        stage: "unresolved",
        operationId: null,
        nextActor: "person",
        nextAction: "Restart the Mate",
      });
    }),
  );

  it.effect("a restart whose answer was lost stays uncertain, never sent again", () =>
    Effect.gen(function* () {
      const store = account();
      const { operations, calls } = operationsOf(store, {
        restart: () => Promise.reject(new ZeropsApiError("No answer.", "network")),
      });
      yield* operations.submit(ENABLE);
      yield* operations.retry("r1");
      expect(progressOf(store)).toEqual({ stage: "uncertain", next: "ask-owner-again" });
      expect(calls).toEqual(["flag s1", "restart s1"]);
    }),
  );
});
