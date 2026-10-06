import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { liveZerops, ORG, projectValue, zeropsVersion } from "../__fixtures__/account.ts";
import { accountOf, progressOf, zeropsOperations } from "../__fixtures__/operations.ts";
import { projectsScope } from "../families/project.ts";
import type { AccountStore } from "../store.ts";
import { ZeropsApiError } from "../../zerops/api.ts";
import { updateProjectTagsExecutor } from "./executors/projectWrites.ts";

const DECLARE = {
  kind: "update-project-tags",
  orgId: ORG,
  projectId: "p1",
  patch: { kind: "mate" },
} as const;

const account = () => accountOf(liveZerops({ running: [], projects: [{ id: "p1", tagList: [] }] }));

const tagged = (store: AccountStore, tagList: ReadonlyArray<string>) =>
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
        value: projectValue({ id: "p1", tagList }),
        revision: zeropsVersion(2),
      },
    ],
  });

function operationsOf(store: AccountStore, answer: () => Promise<unknown>) {
  const calls: unknown[] = [];
  const submit = updateProjectTagsExecutor({
    write: (projectId, patch) => {
      calls.push([projectId, patch]);
      return answer() as never;
    },
  });
  return { operations: zeropsOperations(store, submit), calls };
}

describe("update-project-tags", () => {
  it.effect("ends as Zerops answers it; a lost answer is adopted once the project carries it", () =>
    Effect.gen(function* () {
      for (const [answer, tagsAfter, expected] of [
        [() => Promise.resolve(), null, { stage: "done", operationId: "p1", outcome: "succeeded" }],
        [
          () =>
            Promise.reject({
              _tag: "ZeropsDataAdapterError",
              kind: "rejected",
              message: "This project's tags changed after the write. Try again.",
            }),
          null,
          { stage: "refused", reason: "This project's tags changed after the write. Try again." },
        ],
        [
          () => Promise.reject(new ZeropsApiError("No answer.", "network")),
          ["other"],
          { stage: "uncertain", next: "ask-owner-again" },
        ],
        [
          () => Promise.reject(new ZeropsApiError("No answer.", "network")),
          ["mate"],
          { stage: "done", operationId: "p1", outcome: "succeeded" },
        ],
      ] as const) {
        const store = account();
        const { operations, calls } = operationsOf(store, answer);
        yield* operations.submit(DECLARE);
        if (tagsAfter !== null) {
          tagged(store, tagsAfter);
          yield* operations.retry("r1");
        }
        expect(progressOf(store)).toEqual(expected);
        expect(calls).toEqual([["p1", { kind: "mate" }]]);
      }
    }),
  );
});
