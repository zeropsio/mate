import { describe, expect, it } from "vite-plus/test";

import { liveZerops, ORG, processValue, zeropsVersion } from "../__fixtures__/account.ts";
import { historyScope, runningScope } from "../families/process.ts";
import { emptyAccount, linkKeys, type AccountState } from "../model.ts";
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
const history = historyScope(ORG, "p1");
const readHistory = (ids: ReadonlyArray<string>): ReadonlyArray<AccountInput> => [
  event(history, { kind: "demand", demanded: true }),
  event(history, { kind: "attempt" }),
  event(history, { kind: "handshake" }),
  { kind: "baseline-begin", scope: history, generation: 1 },
  {
    kind: "baseline-commit",
    scope: history,
    generation: 1,
    via: "zerops-read",
    members: ids,
    rows: ids.map((id) => ({
      family: "process",
      id,
      value: processValue({
        id,
        projectId: "p1",
        status: "FINISHED",
        created: `2026-10-0${ids.indexOf(id) + 1}T00:00:00Z`,
      }),
      revision: zeropsVersion(1),
    })),
  },
  event(history, { kind: "baseline-committed" }),
];

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
const outage = (state: AccountState) =>
  apply(state, [
    event(runningScope(ORG), { kind: "parent-lost" }),
    event(history, { kind: "parent-lost" }),
    event(linkKeys.zerops(ORG), {
      kind: "fault",
      jitter: 0,
      fault: { outcome: "transient", message: "socket closed" },
    }),
  ]);
const refused = (state: AccountState, outcome: string) =>
  apply(state, [
    event(linkKeys.zerops(ORG), {
      kind: "fault",
      jitter: 0,
      fault: { outcome, message: "refused" },
    }),
    event(runningScope(ORG), {
      kind: "fault",
      jitter: 0,
      fault: { outcome, message: "refused" },
    }),
  ]);
const ids = (state: AccountState) =>
  projectProcesses.derive(readsOfState(state), KEY).processes?.map((process) => process.id);

describe("projectProcesses", () => {
  it.each([
    {
      name: "before the organization's running work was first read",
      state: () => emptyAccount,
      expected: { processes: undefined, live: false, reconnecting: false, history: "unread" },
    },
    {
      name: "live: what runs and what ended this session, newest first",
      state: live,
      expected: { live: true, reconnecting: false, history: "unread" },
      ids: ["build", "ended"],
    },
    {
      name: "with its history read, older processes after",
      state: () => apply(live(), readHistory(["old-1", "old-2"])),
      expected: { live: true, history: "read" },
      ids: ["build", "ended", "old-2", "old-1"],
    },
    {
      name: "while its history is read",
      state: () => apply(live(), readHistory([]).slice(0, 3)),
      expected: { history: "reading" },
      ids: ["build", "ended"],
    },
    {
      name: "through an outage: everything kept, catching up",
      state: () => outage(apply(live(), readHistory(["old-1"]))),
      expected: { live: false, reconnecting: true, history: "reading" },
      ids: ["build", "ended", "old-1"],
    },
    {
      name: "once its history read is refused",
      state: () =>
        apply(live(), [
          ...readHistory([]).slice(0, 2),
          event(history, {
            kind: "fault",
            jitter: 0,
            fault: { outcome: "authoritative-denial", message: "HTTP 403" },
          }),
        ]),
      expected: { history: "failed", live: true },
      ids: ["build", "ended"],
    },
    {
      name: "refused for lack of access: kept, and said",
      state: () => refused(live(), "authoritative-denial"),
      expected: { live: false, reconnecting: false, unavailableReason: "forbidden" },
      ids: ["build", "ended"],
    },
    {
      name: "refused once the session could not be repaired",
      state: () => refused(live(), "definitive-refusal"),
      expected: { live: false, unavailableReason: "expired-session" },
      ids: ["build", "ended"],
    },
  ])("reads a project's processes $name", ({ state, expected, ids: expectedIds }) => {
    const read = projectProcesses.derive(readsOfState(state()), KEY);
    expect(read).toMatchObject(expected);
    if (expectedIds !== undefined) expect(ids(state())).toEqual(expectedIds);
  });
});

describe("runningWork", () => {
  it.each([
    { name: "unknown before the first read", state: () => emptyAccount, expected: "unknown" },
    { name: "on while a build runs", state: live, expected: "running" },
    {
      name: "out once it ended",
      state: () =>
        apply(live(), [pushed(processValue({ id: "build", projectId: "p1", status: "FINISHED" }))]),
      expected: "idle",
    },
    {
      name: "still on, catching up, through an outage",
      state: () => outage(live()),
      expected: "running",
    },
    {
      name: "out for running work that is no build or deploy",
      state: () =>
        apply(live(), [
          pushed(
            processValue({ id: "build", projectId: "p1", status: "FINISHED" }),
            processValue({ id: "restart", projectId: "p1", actionName: "stack.restart" }),
          ),
        ]),
      expected: "idle",
    },
  ])("is $name", ({ state, expected }) => {
    expect(runningWork.derive(readsOfState(state()), KEY).kind).toBe(expected);
  });

  it("says whether the organization's running work is live", () => {
    expect(runningWork.derive(readsOfState(live()), KEY).live).toBe(true);
    expect(runningWork.derive(readsOfState(outage(live())), KEY).live).toBe(false);
  });
});
