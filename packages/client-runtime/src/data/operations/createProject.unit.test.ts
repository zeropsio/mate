import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import {
  liveZerops,
  ORG,
  processValue,
  projectValue,
  zeropsVersion,
} from "../__fixtures__/account.ts";
import { accountOf, progressOf, zeropsOperations } from "../__fixtures__/operations.ts";
import { projectsScope } from "../families/project.ts";
import { runningScope } from "../families/process.ts";
import { operationResult } from "../model.ts";
import type { AccountStore } from "../store.ts";
import { ZeropsApiError } from "../../zerops/api.ts";
import { createProjectExecutor } from "./executors/createProject.ts";

const CREATE = {
  kind: "create-project",
  orgId: ORG,
  name: "shop-stage",
  tagList: ["app"],
} as const;

/** The organization's projects take one on: its membership, then its row. */
const projectAppears = (store: AccountStore, id: string, name: string) => {
  store.dispatch({
    kind: "membership",
    scope: projectsScope(ORG),
    generation: 1,
    delta: { add: [id], remove: [] },
  });
  store.dispatch({
    kind: "rows",
    scope: projectsScope(ORG),
    generation: 1,
    method: "push",
    via: "zerops-realtime",
    rows: [
      { family: "project", id, value: projectValue({ id, name }), revision: zeropsVersion(1) },
    ],
  });
};

// witness: packages/client-runtime/src/data/operations/executors/createProject.ts | !before.includes(id) → before.includes(id)
it.effect(
  "OP11: An uncertain project creation goes on with its one new project and never makes a second",
  () =>
    Effect.gen(function* () {
      const store = accountOf(liveZerops({ running: [], projects: [] }));
      const other = { id: "p1", name: "shop-stage" };
      const listings = [[other], [other, { id: "p9", name: "shop-stage" }]];
      const writes: unknown[] = [];
      const operations = zeropsOperations(
        store,
        createProjectExecutor({
          listed: () => null,
          listClientProjects: async () => listings.shift()!,
          createProject: async (input) => {
            writes.push(input);
            throw new ZeropsApiError("No answer.", "uncertain");
          },
        }),
      );
      yield* operations.submit(CREATE);
      expect(writes).toEqual([{ clientId: ORG, name: "shop-stage", tagList: ["app"] }]);
      expect(operationResult(store.state().operations.get("r1"), "create-project")).toEqual({
        projectId: "p9",
      });
      expect(progressOf(store)).toEqual({ stage: "accepted", operationId: "p9" });
      projectAppears(store, "p9", "shop-stage");
      expect(progressOf(store)).toEqual({ stage: "reflected", operationId: "p9" });
      store.dispatch({
        kind: "rows",
        scope: runningScope(ORG),
        generation: 1,
        method: "push",
        via: "zerops-realtime",
        rows: [
          {
            family: "process",
            id: "proc-create",
            value: processValue({
              id: "proc-create",
              projectId: "p9",
              status: "FINISHED",
              actionName: "project.create",
            }),
            revision: zeropsVersion(2),
          },
        ],
      });
      expect(progressOf(store)).toEqual({ stage: "done", operationId: "p9", outcome: "succeeded" });
      expect(writes).toHaveLength(1);
    }),
);
