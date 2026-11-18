import { expect, it } from "vite-plus/test";

import { liveZerops, ORG, processValue, zeropsVersion } from "../__fixtures__/account.ts";
import { runningScope } from "../families/process.ts";
import { emptyAccount, type AccountState } from "../model.ts";
import { reduceAccount, type AccountInput } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import { projectProcesses, runningWork } from "./processes.ts";

const KEY = { orgId: ORG, projectId: "p1" };
const apply = (state: AccountState, inputs: ReadonlyArray<AccountInput>) =>
  inputs.reduce((current, input) => reduceAccount(current, input).state, state);
const event = (key: string, streamEvent: object): AccountInput =>
  ({ kind: "stream", key, now: 0, event: streamEvent }) as AccountInput;
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
const live = () =>
  apply(emptyAccount, [
    ...liveZerops({
      running: [{ id: "build", projectId: "p1", created: "2026-10-09T00:00:00Z" }],
    }),
    pushed(
      processValue({
        id: "ended",
        projectId: "p1",
        status: "FINISHED",
        created: "2026-10-08T00:00:00Z",
      }),
      processValue({ id: "elsewhere", projectId: "p2" }),
    ),
  ]);

// witness: packages/client-runtime/src/data/projections/processes.ts | (process) => !runsStill(process.status) || running.has(process.id), → (process) => !runsStill(process.status) || retained.includes(process),
it("PJ18: A process that stopped running without its end ever being pushed is not shown as still running", () => {
  // A rotation, an outage, a laptop asleep: the running scope's next baseline lists it no more.
  const ended = apply(live(), [
    event(runningScope(ORG), { kind: "parent-lost" }),
    event(runningScope(ORG), { kind: "attempt" }),
    { kind: "baseline-begin", scope: runningScope(ORG), generation: 2 },
    {
      kind: "baseline-commit",
      scope: runningScope(ORG),
      generation: 2,
      via: "zerops-realtime",
      members: [],
      rows: [],
    },
  ]);
  expect(
    projectProcesses.derive(readsOfState(ended), KEY).processes?.map((process) => process.id),
  ).toEqual(["ended"]);
});

// witness: packages/client-runtime/src/data/projections/processes.ts | return fact.kind === "known" && BUILDS_AND_DEPLOYS.has(fact.value.actionName); → return fact.kind === "known";
it("PJ19: The menu's build indicator is on only while a build or deploy runs, never for other running work, and is unknown before the first read", () => {
  const indicator = (state: AccountState) => runningWork.derive(readsOfState(state), KEY).kind;
  expect(indicator(emptyAccount)).toBe("unknown");
  expect(indicator(live())).toBe("running");
  expect(
    indicator(
      apply(live(), [
        pushed(
          processValue({ id: "build", projectId: "p1", status: "FINISHED" }),
          processValue({ id: "restart", projectId: "p1", actionName: "stack.restart" }),
        ),
      ]),
    ),
  ).toBe("idle");
});
