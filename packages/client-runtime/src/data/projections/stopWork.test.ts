import { describe, expect, it } from "vite-plus/test";

import {
  liveZerops,
  ORG,
  processValue,
  versionValue,
  zeropsVersion,
} from "../__fixtures__/account.ts";
import { historyScope, runningScope } from "../families/process.ts";
import { activeScope } from "../families/version.ts";
import { emptyAccount, linkKeys, type AccountState } from "../model.ts";
import { reduceAccount, type AccountInput } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import { stopWork, type StopWorkKey } from "./stopWork.ts";

const apply = (state: AccountState, inputs: ReadonlyArray<AccountInput>) =>
  inputs.reduce((current, input) => reduceAccount(current, input).state, state);
const event = (key: string, streamEvent: object): AccountInput =>
  ({ kind: "stream", key, now: 0, event: streamEvent }) as AccountInput;

const KEY: StopWorkKey = {
  orgId: ORG,
  projectId: "p1",
  services: [
    { serviceId: "app", versionId: "v-new" },
    { serviceId: "api", versionId: null },
  ],
};
const derive = (state: AccountState, key: StopWorkKey = KEY) =>
  stopWork.derive(readsOfState(state), key);

const build = (
  id: string,
  patch: Partial<ReturnType<typeof processValue>> = {},
): ReturnType<typeof processValue> =>
  processValue({
    id,
    projectId: "p1",
    actionName: "stack.build",
    serviceStackIds: ["helper", "app"],
    ...patch,
  });

const pushedProcesses = (
  ...values: ReadonlyArray<ReturnType<typeof processValue>>
): AccountInput => ({
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

const pushedVersions = (
  ...values: ReadonlyArray<Parameters<typeof versionValue>[0]>
): AccountInput => ({
  kind: "rows",
  scope: activeScope(ORG),
  generation: 1,
  method: "push",
  via: "zerops-realtime",
  rows: values.map((value, index) => ({
    family: "version",
    id: value.id,
    value: versionValue(value),
    revision: zeropsVersion(10 + index),
  })),
});

const live = (running: Parameters<typeof liveZerops>[0]["running"] = []) =>
  apply(emptyAccount, [
    ...liveZerops({
      running,
      active: [{ id: "v-old", serviceId: "app", source: "NONE" }],
    }),
  ]);

describe("stopWork", () => {
  it("lists the project's running builds with the version each one builds", () => {
    const work = derive(
      live([
        build("b1", { appVersion: { id: "v-next", name: "abc123", status: "BUILDING" } }),
        { id: "deploy", projectId: "p1", actionName: "stack.deploy" },
        { id: "elsewhere", projectId: "p2", actionName: "stack.build" },
      ]),
    );
    expect(work.builds).toEqual([
      {
        processId: "b1",
        serviceIds: ["helper", "app"],
        appVersionId: "v-next",
        name: "abc123",
        created: "2026-10-05T18:49:08Z",
      },
    ]);
    expect(work.complete).toBe(true);
    expect(work.source).toEqual({ kind: "observing" });
  });

  it("keeps the name every build of the project gave its version, ended or running", () => {
    const work = derive(
      apply(live(), [
        pushedProcesses(
          build("b1", {
            status: "FINISHED",
            appVersion: { id: "v-new", name: "abc123", status: "ACTIVE" },
          }),
          build("b2", { appVersion: { id: "v-next", name: "def456", status: "BUILDING" } }),
        ),
      ]),
    );
    expect(work.names).toEqual({ "v-new": "abc123", "v-next": "def456" });
  });

  it.each([
    { name: "failed", status: "FAILED", ended: { processId: "b2", status: "FAILED" } },
    { name: "canceled", status: "CANCELED", ended: { processId: "b2", status: "CANCELED" } },
    { name: "finished", status: "FINISHED", ended: { processId: "b2", status: "FINISHED" } },
    { name: "still running", status: "RUNNING", ended: undefined },
  ])("says how the newest build seen of a service ended: $name", ({ status, ended }) => {
    const work = derive(
      apply(live(), [
        pushedProcesses(
          build("b1", { status: "FINISHED", created: "2026-10-05T10:00:00Z" }),
          build("b2", { status, created: "2026-10-05T11:00:00Z" }),
        ),
      ]),
    );
    expect(work.lastBuilds["app"]).toEqual(ended);
  });

  it("says how a build seen running ended though its end came in a history read after an outage", () => {
    const history = historyScope(ORG, "p1");
    const ended = apply(live([build("b1", { serviceStackIds: ["app"] })]), [
      // The socket breaks while it builds; the next baseline no longer lists it.
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
      // Opening the stop reads its history, which brings the end.
      event(history, { kind: "demand", demanded: true }),
      event(history, { kind: "attempt" }),
      { kind: "baseline-begin", scope: history, generation: 1 },
      {
        kind: "baseline-commit",
        scope: history,
        generation: 1,
        via: "zerops-read",
        members: ["b1"],
        rows: [
          {
            family: "process",
            id: "b1",
            value: build("b1", { serviceStackIds: ["app"], status: "FAILED" }),
            revision: zeropsVersion(9),
          },
        ],
      },
    ]);
    expect(derive(ended).lastBuilds["app"]).toEqual({ processId: "b1", status: "FAILED" });
  });

  it("says nothing of a build only a history read showed: it was never seen running", () => {
    const history = historyScope(ORG, "p1");
    const read = apply(live(), [
      event(history, { kind: "demand", demanded: true }),
      event(history, { kind: "attempt" }),
      { kind: "baseline-begin", scope: history, generation: 1 },
      {
        kind: "baseline-commit",
        scope: history,
        generation: 1,
        via: "zerops-read",
        members: ["old"],
        rows: [
          {
            family: "process",
            id: "old",
            value: build("old", { status: "FAILED" }),
            revision: zeropsVersion(1),
          },
        ],
      },
    ]);
    expect(derive(read).lastBuilds["app"]).toBeUndefined();
  });

  it("states each asked version the store holds, and the version it holds active per service", () => {
    const before = derive(live());
    expect(before.versions["v-new"]).toBeUndefined();
    expect(before.active["app"]).toMatchObject({ id: "v-old", source: "NONE" });
    expect(before.active["api"]).toBeUndefined();

    const replaced = derive(
      apply(live(), [
        pushedVersions(
          { id: "v-old", serviceId: "app", status: "BACKUP", source: "NONE" },
          { id: "v-new", serviceId: "app", source: "GIT" },
        ),
      ]),
    );
    expect(replaced.versions["v-new"]).toMatchObject({ source: "GIT" });
    expect(replaced.active["app"]).toMatchObject({ id: "v-new" });
  });

  it("publishes again when only a version the stop runs changes", () => {
    const before = derive(live());
    const after = derive(
      apply(live(), [pushedVersions({ id: "v-new", serviceId: "app", source: "GIT" })]),
    );
    expect(stopWork.equals(before, after)).toBe(false);
  });

  it("is reading, and not complete, before the running work's first baseline", () => {
    const connecting = apply(emptyAccount, [
      event(linkKeys.zerops(ORG), { kind: "demand", demanded: true }),
      event(runningScope(ORG), { kind: "demand", demanded: true }),
      event(activeScope(ORG), { kind: "demand", demanded: true }),
    ]);
    expect(derive(connecting)).toMatchObject({ complete: false, source: { kind: "establishing" } });
  });

  it("keeps what it read through an outage and says it is catching up", () => {
    const down = apply(live([build("b1")]), [
      event(runningScope(ORG), { kind: "parent-lost" }),
      event(activeScope(ORG), { kind: "parent-lost" }),
      event(linkKeys.zerops(ORG), {
        kind: "fault",
        jitter: 0,
        fault: { outcome: "transient", message: "socket closed" },
      }),
    ]);
    const work = derive(down);
    expect(work.source).toEqual({ kind: "catching-up" });
    expect(work.builds.map((entry) => entry.processId)).toEqual(["b1"]);
    expect(work.active["app"]).toMatchObject({ id: "v-old" });
  });

  it.each([
    { outcome: "authoritative-denial", reason: "forbidden" },
    { outcome: "definitive-refusal", reason: "expired-session" },
  ])("says why when the active versions were refused: $outcome", ({ outcome, reason }) => {
    const refused = apply(live(), [
      event(activeScope(ORG), { kind: "fault", jitter: 0, fault: { outcome, message: "no" } }),
    ]);
    expect(derive(refused).source).toEqual({ kind: "refused", reason });
  });
});
