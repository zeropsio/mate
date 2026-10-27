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

const named = (store: AccountStore, name: string, version = 2) =>
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
        revision: zeropsVersion(version),
      },
    ],
  });

/** The tag writer's own refusal: the project was renamed since the rename was planned. */
const renamedSince = {
  _tag: "ZeropsProjectTagWriteError",
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
  it.effect.each([{ before: [] }, { before: ["p1"] }, { before: undefined }])(
    "reload adopts only an effect absent before the original send: $before",
    ({ before }) =>
      Effect.gen(function* () {
        const store = account();
        named(store, RENAME.name);
        const { operations, calls } = operationsOf(store, () =>
          Promise.reject(new Error("must not resend")),
        );
        yield* operations.resume("original", RENAME, [], before);
        expect(progressOf(store, "original").stage).toBe(
          before?.length === 0 ? "done" : "uncertain",
        );
        expect(calls).toEqual([]);
      }),
  );

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

  it.effect("adopts a later lost rename on a project an earlier one ended on", () =>
    Effect.gen(function* () {
      const store = account();
      let lose = false;
      const { operations } = operationsOf(store, () =>
        lose ? Promise.reject(new ZeropsApiError("No answer.", "network")) : Promise.resolve(),
      );
      yield* operations.submit(RENAME);
      named(store, "shop · Ada", 2);
      lose = true;
      yield* operations.submit({ ...RENAME, name: "shop · Eva", from: "shop · Ada" });
      named(store, "shop · Eva", 3);
      yield* operations.retry("r2");
      expect(progressOf(store, "r2")).toEqual({
        stage: "done",
        operationId: "p1",
        outcome: "succeeded",
      });
    }),
  );
});
