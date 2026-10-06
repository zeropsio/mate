import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { liveZerops, ORG, projectValue, zeropsVersion } from "../__fixtures__/account.ts";
import { accountOf, progressOf, zeropsOperations } from "../__fixtures__/operations.ts";
import { projectsScope } from "../families/project.ts";
import type { AccountStore } from "../store.ts";
import { ZeropsApiError } from "../../zerops/api.ts";
import { renameProjectExecutor } from "./executors/projectWrites.ts";

const RENAME = {
  kind: "rename-project",
  orgId: ORG,
  projectId: "p1",
  name: "shop · Ada",
  from: "shop · Bob",
} as const;

const account = () =>
  accountOf(liveZerops({ running: [], projects: [{ id: "p1", name: "shop · Bob" }] }));

const named = (store: AccountStore, name: string) =>
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
        value: projectValue({ id: "p1", name }),
        revision: zeropsVersion(2),
      },
    ],
  });

/** The tag writer's own refusal: the project was renamed since the rename was planned. */
const renamedSince = {
  _tag: "ZeropsDataAdapterError",
  kind: "rejected",
  message: "This project was renamed since. Nothing was changed.",
  retryable: false,
  accountRevocationEvidence: false,
};

function operationsOf(store: AccountStore, answer: () => Promise<unknown>) {
  const calls: unknown[] = [];
  const submit = renameProjectExecutor({
    rename: (projectId, name, options) => {
      calls.push([projectId, name, options?.from]);
      return answer() as never;
    },
  });
  return { operations: zeropsOperations(store, submit), calls };
}

describe("rename-project", () => {
  it.effect("ends as Zerops answers it, only from the name it was planned from", () =>
    Effect.gen(function* () {
      for (const [answer, nameAfter, expected] of [
        [() => Promise.resolve(), null, { stage: "done", operationId: "p1", outcome: "succeeded" }],
        [
          () => Promise.reject(renamedSince),
          null,
          { stage: "refused", reason: "This project was renamed since. Nothing was changed." },
        ],
        [
          () => Promise.reject(new ZeropsApiError("Not allowed.", "forbidden", 403)),
          null,
          { stage: "refused", reason: "Not allowed." },
        ],
        [
          () => Promise.reject(new ZeropsApiError("No answer.", "network")),
          "shop · Bob",
          { stage: "uncertain", next: "ask-owner-again" },
        ],
        [
          () => Promise.reject(new ZeropsApiError("No answer.", "network")),
          "shop · Ada",
          { stage: "done", operationId: "p1", outcome: "succeeded" },
        ],
      ] as const) {
        const store = account();
        const { operations, calls } = operationsOf(store, answer);
        yield* operations.submit(RENAME);
        if (nameAfter !== null) {
          named(store, nameAfter);
          yield* operations.retry("r1");
        }
        expect(progressOf(store)).toEqual(expected);
        expect(calls).toEqual([["p1", "shop · Ada", "shop · Bob"]]);
      }
    }),
  );
});
