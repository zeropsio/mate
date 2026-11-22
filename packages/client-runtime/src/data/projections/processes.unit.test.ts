import { expect, it } from "vite-plus/test";

import { addressWatchedProjects } from "../../zerops/account/addressWatch.ts";
import {
  addressFactsOf,
  projectCandidates,
  subdomainEnableIn,
} from "../../zerops/projections/candidates.ts";
import { liveZerops, ORG, processValue, zeropsVersion } from "../__fixtures__/account.ts";
import { historyScope, runningScope } from "../families/process.ts";
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

// witness: packages/client-runtime/src/data/projections/processes.ts | return !stream.demanded && stream.fault === null && coverage !== "unknown" → return !stream.demanded && stream.fault === null && coverage === "unknown"
it("PJ111: A project's process history let go after its read stays read, so the watch for a container's address does not take it back and read it again on every answer; one let go before it answered stays unread", () => {
  const scope = historyScope(ORG, "p1");
  const demanded = apply(live(), [
    event(scope, { kind: "demand", demanded: true }),
    event(scope, { kind: "attempt" }),
    event(scope, { kind: "handshake" }),
  ]);
  const letGo: AccountInput = { kind: "release", scopes: [scope], now: 0 };
  const answered = apply(demanded, [
    { kind: "baseline-begin", scope, generation: 1 },
    {
      kind: "baseline-commit",
      scope,
      generation: 1,
      via: "zerops-read",
      members: ["build"],
      rows: [
        {
          family: "process",
          id: "build",
          value: processValue({
            id: "build",
            projectId: "p1",
            status: "FINISHED",
            actionName: "stack.build",
            serviceStackIds: ["s1"],
          }),
          revision: zeropsVersion(3),
        },
      ],
    },
    event(scope, { kind: "baseline-committed" }),
    letGo,
  ]);
  // A Mate's container this window watched in its first build, now ACTIVE with its address off:
  // its history says no enable runs, so nothing is on its way and no watch holds the project.
  const watched = (state: AccountState) =>
    addressWatchedProjects({
      rows: projectCandidates(
        { id: "p1", name: "p1", status: "ACTIVE" },
        () => ({
          state: "known",
          value: [{ id: "s1", name: "zcp", status: "ACTIVE", base: "zcp@1" }],
          asOf: { ordinal: 0, atMs: 0 },
          coverage: "complete",
          freshness: { kind: "live" },
        }),
        addressFactsOf(new Map([["s1", { addressed: false, building: true }]]), 0, (_, serviceId) =>
          subdomainEnableIn(projectProcesses.derive(readsOfState(state), KEY), serviceId),
        ),
      ),
      shown: new Set(),
      inOrganization: () => true,
    });
  expect(projectProcesses.derive(readsOfState(answered), KEY).history).toBe("read");
  expect([...watched(answered)]).toEqual([]);
  expect(projectProcesses.derive(readsOfState(apply(demanded, [letGo])), KEY).history).toBe(
    "unread",
  );
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
