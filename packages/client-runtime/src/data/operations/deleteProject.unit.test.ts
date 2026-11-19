import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { liveZerops, ORG, processValue } from "../__fixtures__/account.ts";
import { accountOf, progressOf, zeropsOperations } from "../__fixtures__/operations.ts";
import { runningScope } from "../families/process.ts";
import { deleteProjectExecutor } from "./executors/deleteProject.ts";

const DELETE = { kind: "delete-project", orgId: ORG, projectId: "p1" } as const;

// witness: packages/client-runtime/src/data/operations/deleteProject.ts | read.fact("project", intent.projectId) → read.fact("project", receipt.operationId)
it.effect(
  "OP10: A project deletion succeeds on its project's proven deletion when its process's end went unseen",
  () =>
    Effect.gen(function* () {
      const store = accountOf(liveZerops({ running: [], projects: [{ id: "p1" }] }));
      const operations = zeropsOperations(
        store,
        deleteProjectExecutor({
          deleteProject: async () => ({ processId: "proc-del" }),
        }),
      );
      yield* operations.submit(DELETE);
      store.dispatch({
        kind: "rows",
        scope: runningScope(ORG),
        generation: 1,
        method: "push",
        via: "zerops-realtime",
        rows: [
          {
            family: "process",
            id: "proc-del",
            value: processValue({
              id: "proc-del",
              projectId: "p1",
              status: "RUNNING",
              actionName: "project.delete",
            }),
            revision: { kind: "zerops", version: 1 },
          },
        ],
      });
      // The process ends while the account is away; the project then leaves the roster, proven gone.
      store.dispatch({
        kind: "proven-deletion",
        family: "project",
        id: "p1",
        evidence: "GET /project/p1 answered 404",
      });
      expect(progressOf(store)).toEqual({
        stage: "done",
        operationId: "proc-del",
        outcome: "succeeded",
      });
    }),
);
