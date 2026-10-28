import { describe, expect, it } from "vite-plus/test";

import { liveZerops, ORG, processValue, zeropsVersion } from "../__fixtures__/account.ts";
import { runningScope } from "../families/process.ts";
import { emptyAccount, type AccountState } from "../model.ts";
import { reduceAccount, type AccountInput } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import { projectCreations } from "./creation.ts";

const apply = (state: AccountState, inputs: ReadonlyArray<AccountInput>) =>
  inputs.reduce((current, input) => reduceAccount(current, input).state, state);
const pushed = (...values: ReadonlyArray<ReturnType<typeof processValue>>): AccountInput => ({
  kind: "rows",
  scope: runningScope(ORG),
  generation: 1,
  method: "push",
  via: "zerops-realtime",
  rows: values.map((value, index) => ({
    family: "process",
    id: value.id,
    value,
    revision: zeropsVersion(10 + index),
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
    expect(
      projectCreations.derive(readsOfState(state), { orgId: ORG, projectIds: ["p1"] }),
    ).toEqual(creation === undefined ? {} : { p1: creation });
  });
});
