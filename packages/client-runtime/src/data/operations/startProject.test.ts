import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { liveZerops, ORG, projectValue, zeropsVersion } from "../__fixtures__/account.ts";
import { accountOf, progressOf, zeropsOperations } from "../__fixtures__/operations.ts";
import { projectsScope } from "../families/project.ts";
import type { AccountStore } from "../store.ts";
import { ZeropsApiError } from "../../zerops/api.ts";
import { startProjectExecutor } from "./executors/projectWrites.ts";

const START = { kind: "start-project", orgId: ORG, projectId: "p1" } as const;

const account = () =>
  accountOf(liveZerops({ running: [], projects: [{ id: "p1", status: "STOPPED" }] }));

const active = (store: AccountStore) =>
  store.dispatch({
    kind: "rows",
    scope: projectsScope(ORG),
    generation: 1,
    method: "push",
    via: "zerops-realtime",
    rows: [
      {
        family: "project",
        id: "p1",
        value: projectValue({ id: "p1", status: "ACTIVE" }),
        revision: zeropsVersion(2),
      },
    ],
  });

function operationsOf(store: AccountStore, answer: () => Promise<void>) {
  const calls: string[] = [];
  const submit = startProjectExecutor({
    startProject: (projectId) => {
      calls.push(projectId);
      return answer();
    },
  });
  return { operations: zeropsOperations(store, submit), calls };
}

describe("start-project", () => {
  it.effect(
    "ends as Zerops answers it; a lost answer is adopted only once the project is active",
    () =>
      Effect.gen(function* () {
        for (const [answer, activeAfter, expected] of [
          [
            () => Promise.resolve(),
            false,
            { stage: "done", operationId: "p1", outcome: "succeeded" },
          ],
          [
            () => Promise.reject(new ZeropsApiError("Not allowed.", "forbidden", 403)),
            false,
            { stage: "refused", reason: "Not allowed." },
          ],
          [
            () => Promise.reject(new ZeropsApiError("No answer.", "network")),
            false,
            { stage: "uncertain", next: "ask-owner-again" },
          ],
          [
            () => Promise.reject(new ZeropsApiError("No answer.", "network")),
            true,
            { stage: "done", operationId: "p1", outcome: "succeeded" },
          ],
        ] as const) {
          const store = account();
          const { operations, calls } = operationsOf(store, answer);
          yield* operations.submit(START);
          if (activeAfter) {
            active(store);
            yield* operations.retry("r1");
          }
          expect(progressOf(store)).toEqual(expected);
          expect(calls).toEqual(["p1"]);
        }
      }),
  );
});
