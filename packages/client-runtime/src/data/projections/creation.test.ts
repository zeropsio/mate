import { AtomRegistry } from "effect/reactivity";
import { seedHqNavigation } from "../__fixtures__/hqNavigation.ts";
import { makeAccountStore } from "../store.ts";
import { describe, expect, it } from "vite-plus/test";

import { liveZerops, ORG, processValue, zeropsVersion } from "../__fixtures__/account.ts";
import { runningScope } from "../families/process.ts";
import { emptyAccount, type AccountState } from "../model.ts";
import { reduceAccount, type AccountInput } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import { latestProjectCreation, projectCreations } from "./creation.ts";

const apply = (state: AccountState, inputs: ReadonlyArray<AccountInput>) =>
  inputs.reduce((current, input) => reduceAccount(current, input).state, state);
let processRevision = 10;
const pushed = (...values: ReadonlyArray<ReturnType<typeof processValue>>): AccountInput => ({
  kind: "rows",
  scope: runningScope(ORG),
  generation: 1,
  method: "push",
  via: "zerops-realtime",
  rows: values.map((value) => ({
    family: "process",
    id: value.id,
    value,
    revision: zeropsVersion(processRevision++),
  })),
});
const create = (id: string, status: string, created: string, patch = {}) =>
  processValue({ id, projectId: "p1", status, actionName: "project.create", created, ...patch });

describe("projectCreations", () => {
  it.each<{
    readonly name: string;
    readonly processes: ReadonlyArray<ReturnType<typeof processValue>>;
    readonly creation: unknown;
  }>([
    { name: "no creation process read: none", processes: [], creation: undefined },
    {
      name: "its creation under way",
      processes: [create("c1", "RUNNING", "2026-10-01T00:00:00Z")],
      creation: { processId: "c1", status: "RUNNING", error: null },
    },
    {
      name: "a creation that failed, in the platform's words",
      processes: [
        create("c1", "FAILED", "2026-10-01T00:00:00Z", {
          error: { code: "internalServerError", message: "Internal server error" },
        }),
      ],
      creation: {
        processId: "c1",
        status: "FAILED",
        error: { code: "internalServerError", message: "Internal server error" },
      },
    },
    {
      name: "the newest creation of several, another action never",
      processes: [
        create("c1", "FAILED", "2026-10-01T00:00:00Z"),
        create("c2", "FINISHED", "2026-10-02T00:00:00Z"),
        processValue({
          id: "d1",
          projectId: "p1",
          actionName: "stack.deploy",
          created: "2026-10-03T00:00:00Z",
        }),
      ],
      creation: { processId: "c2", status: "FINISHED", error: null },
    },
  ])("$name", ({ processes, creation }) => {
    const state = apply(emptyAccount, [
      ...liveZerops({ running: [] }),
      ...(processes.length === 0 ? [] : [pushed(...processes)]),
    ]);
    expect(latestProjectCreation(readsOfState(state), "p1")).toEqual(creation);
  });
});

it.each(["birth", "mate"] as const)(
  "a fresh %s observer follows only the recorded import after the press is gone",
  (owner) => {
    const store = makeAccountStore(AtomRegistry.make());
    liveZerops({ running: [] }).forEach(store.dispatch);
    const seed = (importProcessId?: string) =>
      seedHqNavigation(store, ORG, {
        structure: {
          apps:
            owner === "birth"
              ? [
                  {
                    id: "app",
                    name: "App",
                    projects: [],
                    births: [
                      {
                        id: "birth",
                        face: "",
                        projectId: "p1",
                        ...(importProcessId === undefined ? {} : { importProcessId }),
                      },
                    ],
                  },
                ]
              : [],
          ungrouped:
            owner === "mate"
              ? [
                  {
                    projectId: "p1",
                    name: "Mate",
                    mate: {
                      face: "",
                      ...(importProcessId === undefined ? {} : { importProcessId }),
                    },
                  },
                ]
              : [],
        },
        presses: {},
      });
    const read = () =>
      projectCreations.derive(readsOfState(store.state()), { orgId: ORG, projectIds: ["p1"] });
    seed("original-import");
    store.dispatch(pushed(create("newer-create", "FAILED", "2026-10-02T00:00:00Z")));
    expect(read()).toEqual({});
    store.dispatch(
      pushed(
        processValue({
          id: "original-import",
          projectId: "p1",
          actionName: "stack.create",
          status: "RUNNING",
          created: "2026-10-01T00:00:00Z",
        }),
      ),
    );
    expect(read()).toEqual({
      p1: { processId: "original-import", status: "RUNNING", error: null },
    });
    store.dispatch(
      pushed(
        processValue({
          id: "original-import",
          projectId: "p1",
          actionName: "stack.create",
          status: "FINISHED",
          created: "2026-10-01T00:00:00Z",
        }),
      ),
    );
    expect(read()).toEqual({
      p1: { processId: "original-import", status: "FINISHED", error: null },
    });
    seed();
    expect(read()).toEqual({});
    expect(store.state().operations.size).toBe(0);
    store.close();
  },
);

it("an observer without a recorded import awaits evidence even before HQ answers", () => {
  const state = apply(emptyAccount, [
    ...liveZerops({ running: [] }),
    pushed(create("unrelated", "FAILED", "2026-10-02T00:00:00Z")),
  ]);
  expect(projectCreations.derive(readsOfState(state), { orgId: ORG, projectIds: ["p1"] })).toEqual(
    {},
  );
});
