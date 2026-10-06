import { describe, expect, it } from "vite-plus/test";

import { liveZerops, ORG, processValue, zeropsVersion } from "../__fixtures__/account.ts";
import { runningScope } from "../families/process.ts";
import { emptyAccount, linkKeys, type AccountState } from "../model.ts";
import { reduceAccount, type AccountInput } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import { hqBirthProcess, hqBirthServices, hqBirthZone } from "./hqBirth.ts";

const apply = (state: AccountState, inputs: ReadonlyArray<AccountInput>) =>
  inputs.reduce((current, input) => reduceAccount(current, input).state, state);
const paused: AccountInput = {
  kind: "stream",
  key: linkKeys.zerops(ORG),
  now: 0,
  event: { kind: "demand", demanded: false },
};
const KEY = { orgId: ORG, projectId: "hq" };
const UP = [
  { id: "s-db", projectId: "hq", name: "db" },
  { id: "s-vol", projectId: "hq", name: "vol" },
  { id: "s-backup", projectId: "hq", name: "backup" },
  { id: "s-hq", projectId: "hq", name: "hq" },
];
const ended = (process: Parameters<typeof processValue>[0]): AccountInput => ({
  kind: "rows",
  scope: runningScope(ORG),
  generation: 1,
  method: "push",
  via: "zerops-realtime",
  rows: [
    { family: "process", id: process.id, value: processValue(process), revision: zeropsVersion(2) },
  ],
});
const account = (
  input: Partial<Parameters<typeof liveZerops>[0]>,
  more: ReadonlyArray<AccountInput> = [],
) =>
  readsOfState(
    apply(emptyAccount, [
      ...liveZerops({ running: [], projects: [{ id: "hq" }], ...input }),
      ...more,
    ]),
  );

describe("hqBirthServices", () => {
  it.each([
    [
      "its services still coming up",
      account({ services: [{ ...UP[0]!, status: "CREATING" }, ...UP.slice(1)] }),
      { kind: "waiting" },
    ],
    [
      "every one active and nothing of its project running",
      account({ services: UP }),
      {
        kind: "up",
        serviceId: "s-hq",
        serviceIds: { db: "s-db", vol: "s-vol", backup: "s-backup", hq: "s-hq" },
      },
    ],
    [
      "every one active while an import still runs",
      account({ services: UP, running: [{ id: "imp", projectId: "hq", status: "RUNNING" }] }),
      { kind: "waiting" },
    ],
    [
      "a service failed",
      account({ services: [...UP.slice(0, 3), { ...UP[3]!, status: "FAILED" }] }),
      {
        kind: "stopped",
        reason:
          "HQ's hq service is FAILED. Inspect its import process in Zerops, then press Again.",
      },
    ],
    [
      "its creation failed",
      account({ services: [] }, [
        ended({
          id: "create",
          projectId: "hq",
          status: "FAILED",
          actionName: "project.create",
          error: { code: "x", message: "No room" },
        }),
      ]),
      {
        kind: "stopped",
        reason: "No room. Inspect its creation process in Zerops, then press Again.",
      },
    ],
    [
      "a service import failed",
      account({ services: [] }, [
        ended({ id: "imp", projectId: "hq", status: "CANCELED", actionName: "stack.create" }),
      ]),
      {
        kind: "stopped",
        reason:
          "HQ's service import is CANCELED. Inspect process imp in Zerops, fix the cause, then press Again.",
      },
    ],
    ["its organization's link paused", account({ services: [] }, [paused]), { kind: "unobserved" }],
  ])("%s", (_name, read, expected) => {
    expect(hqBirthServices.derive(read, KEY)).toEqual(expected);
  });
});

describe("hqBirthZone", () => {
  it.each([
    ["no domain yet", account({}), { kind: "waiting" }],
    [
      "its domain",
      account({ projects: [{ id: "hq", publicZone: "hq.example" }] }),
      { kind: "zone", zone: "hq.example" },
    ],
    ["its organization's link paused", account({}, [paused]), { kind: "unobserved" }],
  ])("%s", (_name, read, expected) => {
    expect(hqBirthZone.derive(read, KEY)).toEqual(expected);
  });
});

describe("hqBirthProcess", () => {
  const PROCESS = { ...KEY, processId: "deploy" };
  it.each([
    ["not seen yet", account({}), { kind: "waiting" }],
    [
      "running",
      account({ running: [{ id: "deploy", projectId: "hq", status: "RUNNING" }] }),
      { kind: "waiting" },
    ],
    [
      "ended",
      account({}, [ended({ id: "deploy", projectId: "hq", status: "FAILED" })]),
      { kind: "ended", status: "FAILED" },
    ],
    ["its organization's link paused", account({}, [paused]), { kind: "unobserved" }],
  ])("%s", (_name, read, expected) => {
    expect(hqBirthProcess.derive(read, PROCESS)).toEqual(expected);
  });
});
