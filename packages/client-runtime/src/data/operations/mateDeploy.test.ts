import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { liveZerops, ORG, processValue, zeropsVersion } from "../__fixtures__/account.ts";
import { accountOf, progressOf, zeropsOperations } from "../__fixtures__/operations.ts";
import { runningScope } from "../families/process.ts";
import { mateDeployExecutor } from "./executors/mateDeploy.ts";

const DEPLOY = { kind: "mate-deploy", orgId: ORG, projectId: "p1", serviceId: "s1" } as const;

describe("mate-deploy", () => {
  it.effect.each(["FINISHED", "FAILED", "CANCELED"])(
    "a Mate deployment shows its observed process result: %s",
    (status) =>
      Effect.gen(function* () {
        const store = accountOf(
          liveZerops({ running: [], services: [{ id: "s1", projectId: "p1" }] }),
        );
        const called: string[] = [];
        const operations = zeropsOperations(
          store,
          mateDeployExecutor({
            deployMate: async (id) => {
              called.push(id);
              return { processId: "deploy" };
            },
          }),
        );
        yield* operations.submit(DEPLOY);
        expect(called).toEqual(["s1"]);
        expect(progressOf(store)).toEqual({ stage: "accepted", operationId: "deploy" });
        for (const [observed, version] of [
          ["RUNNING", 1],
          [status, 2],
        ] as const) {
          store.dispatch({
            kind: "rows",
            scope: runningScope(ORG),
            generation: 1,
            method: "push",
            via: "zerops-realtime",
            rows: [
              {
                family: "process",
                id: "deploy",
                value: processValue({
                  id: "deploy",
                  projectId: "p1",
                  actionName: "stack.deploy",
                  serviceStackIds: ["s1"],
                  status: observed,
                }),
                revision: zeropsVersion(version),
              },
            ],
          });
          expect(progressOf(store)).toEqual(
            observed === "RUNNING"
              ? { stage: "reflected", operationId: "deploy" }
              : observed === "FINISHED"
                ? { stage: "done", operationId: "deploy", outcome: "succeeded" }
                : {
                    stage: "done",
                    operationId: "deploy",
                    outcome: "failed",
                    reason: `The deployment ended ${status}.`,
                  },
          );
        }
      }),
  );
});
