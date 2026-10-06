import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/unstable/reactivity";

import {
  liveZerops,
  ORG,
  processValue,
  projectValue,
  zeropsVersion,
} from "../__fixtures__/account.ts";
import { projectsScope } from "../families/project.ts";
import { runningScope } from "../families/process.ts";
import { operationResult } from "../model.ts";
import { operationProgress } from "../projections/operation.ts";
import { makeAccountStore, readsOfState, type AccountStore } from "../store.ts";
import { ZeropsApiError } from "../../zerops/api.ts";
import { makeOperations } from "./coordinator.ts";
import { createProjectExecutor } from "./executors/createProject.ts";

const CREATE = {
  kind: "create-project",
  orgId: ORG,
  name: "shop-stage",
  tagList: ["app"],
} as const;

function account(projects: ReadonlyArray<{ readonly id: string; readonly name?: string }> = []) {
  const store = makeAccountStore(AtomRegistry.make());
  liveZerops({ running: [], projects }).forEach(store.dispatch);
  return store;
}

const creationRow = (
  store: AccountStore,
  status: string,
  patch: Partial<Parameters<typeof processValue>[0]> = {},
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
        id: "proc-create",
        value: processValue({
          id: "proc-create",
          projectId: "p9",
          status,
          actionName: "project.create",
          ...patch,
        }),
        revision: zeropsVersion(status === "RUNNING" ? 1 : 2),
      },
    ],
  });

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

/** The organization's projects as Zerops lists them, read before the send and after a lost answer. */
type Listing = ReadonlyArray<{ readonly id: string; readonly name: string }>;

function operationsOf(
  store: AccountStore,
  answer: () => Promise<{ readonly id: string }>,
  listings: ReadonlyArray<Listing> = [[], []],
) {
  const calls: unknown[] = [];
  const reads = [...listings];
  const submit = createProjectExecutor({
    createProject: (input) => {
      calls.push(input);
      return answer();
    },
    listClientProjects: async () => {
      calls.push("list");
      const listing = reads.shift();
      if (listing === undefined) throw new Error("Zerops could not be reached.");
      return listing;
    },
  });
  const operations = makeOperations({
    store,
    executors: {
      zerops: {
        submit: (requestId, intent) =>
          intent.kind === "create-project" ? submit(requestId, intent) : Effect.die("no"),
      },
    },
    makeId: () => "r1",
  });
  return { operations, calls };
}

const progress = (store: AccountStore) =>
  operationProgress.derive(readsOfState(store.state()), "r1");

describe("create-project", () => {
  it.effect("answers with the project Zerops made, and its project.create process ends it", () =>
    Effect.gen(function* () {
      for (const [status, patch, outcome] of [
        ["FINISHED", {}, { stage: "done", operationId: "p9", outcome: "succeeded" }],
        [
          "FAILED",
          { error: { code: "projectNameTaken", message: "The name is taken." } },
          { stage: "done", operationId: "p9", outcome: "failed", reason: "The name is taken." },
        ],
        [
          "CANCELED",
          {},
          {
            stage: "done",
            operationId: "p9",
            outcome: "failed",
            reason: "Zerops reported the project's creation as CANCELED.",
          },
        ],
      ] as const) {
        const store = account();
        const { operations, calls } = operationsOf(store, async () => ({ id: "p9" }));
        yield* operations.submit(CREATE);
        expect(calls).toEqual(["list", { clientId: ORG, name: "shop-stage", tagList: ["app"] }]);
        expect(operationResult(store.state().operations.get("r1"), "create-project")).toEqual({
          projectId: "p9",
        });
        expect(progress(store)).toEqual({ stage: "accepted", operationId: "p9" });
        creationRow(store, "RUNNING");
        expect(progress(store)).toEqual({ stage: "accepted", operationId: "p9" });
        creationRow(store, status, patch);
        expect(progress(store)).toEqual(outcome);
      }
    }),
  );

  it.effect("names the location it was asked for", () =>
    Effect.gen(function* () {
      const store = account();
      const { operations, calls } = operationsOf(store, async () => ({ id: "p9" }));
      yield* operations.submit({ ...CREATE, location: "prg1" });
      expect(calls).toEqual([
        "list",
        { clientId: ORG, name: "shop-stage", tagList: ["app"], location: "prg1" },
      ]);
    }),
  );

  it.effect("is reflected once the organization's projects hold it", () =>
    Effect.gen(function* () {
      const store = account();
      const { operations } = operationsOf(store, async () => ({ id: "p9" }));
      yield* operations.submit(CREATE);
      projectAppears(store, "p9", "shop-stage");
      expect(progress(store)).toEqual({ stage: "reflected", operationId: "p9" });
    }),
  );

  const lost = async (): Promise<{ readonly id: string }> => {
    throw new ZeropsApiError("No answer.", "uncertain");
  };
  const OTHER = { id: "p1", name: "shop-stage" };

  it.effect(
    "a lost answer adopts the one project of its name Zerops lists now and did not before",
    () =>
      Effect.gen(function* () {
        const store = account();
        const { operations, calls } = operationsOf(store, lost, [
          [OTHER],
          [OTHER, { id: "p9", name: "shop-stage" }],
        ]);
        yield* operations.submit(CREATE);
        expect(calls.filter((call) => call !== "list")).toHaveLength(1);
        expect(progress(store)).toEqual({ stage: "accepted", operationId: "p9" });
        expect(operationResult(store.state().operations.get("r1"), "create-project")).toEqual({
          projectId: "p9",
        });
      }),
  );

  it.effect.each([
    ["no new project of its name", [[OTHER], [OTHER]]],
    [
      "two new projects of its name",
      [[OTHER], [OTHER, { id: "p8", name: "shop-stage" }, { id: "p9", name: "shop-stage" }]],
    ],
    ["a listing that could not be read again", [[OTHER]]],
  ] as const)("a lost answer with %s stays uncertain, never sent again", ([, listings]) =>
    Effect.gen(function* () {
      const store = account();
      const { operations, calls } = operationsOf(store, lost, listings);
      yield* operations.submit(CREATE);
      expect(calls.filter((call) => call !== "list")).toHaveLength(1);
      expect(progress(store)).toEqual({ stage: "uncertain", next: "ask-owner-again" });
    }),
  );

  it.effect("a refusal keeps what Zerops said and no result", () =>
    Effect.gen(function* () {
      const store = account();
      const { operations } = operationsOf(store, async () => {
        throw new ZeropsApiError("Not allowed.", "forbidden", 403);
      });
      yield* operations.submit(CREATE);
      expect(progress(store)).toMatchObject({ stage: "refused" });
      expect(operationResult(store.state().operations.get("r1"), "create-project")).toBeUndefined();
    }),
  );
});
