/**
 * The in-transit bridge feeds the deployment store from the account's store: what a stop's chips
 * say of a build under way, and of a build that ended failed, is what the runtime's own process
 * read said.
 */
import { describe, expect, it } from "vite-plus/test";

import { liveZerops, ORG, processValue } from "../../data/__fixtures__/account.ts";
import { projectProcesses } from "../../data/projections/processes.ts";
import { runningScope } from "../../data/families/process.ts";
import type { AccountInput } from "../../data/reducer.ts";
import { readsOfState } from "../../data/store.ts";
import { emptyAccount, linkKeys, type AccountState } from "../../data/model.ts";
import { reduceAccount } from "../../data/reducer.ts";
import { process as processRef, project } from "../data/__fixtures__/index.ts";
import type { ServiceDeployInfo } from "../data/types.ts";
import { buildEnds, stopServices, type StopReads } from "../flow/deployment.ts";
import { processesRead, runningProcess } from "../flow/__fixtures__/processes.ts";
import { deployed, record, servicesRead } from "../flow/__fixtures__/services.ts";
import { processStatusOf, runningProcessesRead } from "./processBridge.ts";

const PROJECT = project("project-stage");
const NOW = 100_000;
const PUSHED: ServiceDeployInfo = {
  id: "app-version",
  status: "ACTIVE",
  source: "GIT",
  activatedAt: "2026-09-20T10:00:00Z",
  name: "v1.4.0",
  branch: "main",
  commit: null,
  tag: "v1.4.0",
  repository: null,
};
const SERVICES = servicesRead(
  [record("s1", "app", deployed(null)), record("s2", "web", deployed(PUSHED))],
  { project: PROJECT },
);
const BUILD = processValue({
  id: "build",
  projectId: PROJECT.projectId,
  actionName: "stack.build",
  serviceStackIds: ["build-helper", "s1"],
  appVersion: { id: "av-9", name: "v1.5.0" },
});

const apply = (state: AccountState, inputs: ReadonlyArray<AccountInput>) =>
  inputs.reduce((current, input) => reduceAccount(current, input).state, state);
const live = () => apply(emptyAccount, liveZerops({ running: [BUILD] }));
const pushed = (value: typeof BUILD, version: number): AccountInput => ({
  kind: "rows",
  scope: runningScope(ORG),
  generation: 1,
  method: "push",
  via: "zerops-realtime",
  rows: [{ family: "process", id: value.id, value, revision: { kind: "zerops", version } }],
});
const bridged = (state: AccountState) =>
  runningProcessesRead(
    PROJECT,
    projectProcesses.derive(readsOfState(state), { orgId: ORG, projectId: PROJECT.projectId }),
  );
const deployments = (processes: StopReads["processes"]) => {
  const read = stopServices(
    { services: SERVICES, processes, names: new Map(), refused: null, stated: new Map() },
    NOW,
  );
  return read.state === "known"
    ? read.value.map((stop) => [
        stop.hostname,
        stop.deployment.state === "known" ? stop.deployment.value.kind : stop.deployment.state,
      ])
    : read.state;
};

describe("runningProcessesRead — the deployment store's running processes, from the store", () => {
  it("says a build is under way exactly as the runtime's read did", () => {
    const runtime = processesRead(
      [
        runningProcess("build", {
          serviceIds: ["build-helper", "s1"],
          project: PROJECT,
          appVersion: { id: "av-9", name: "v1.5.0" },
        }),
      ],
      { project: PROJECT },
    );
    expect(deployments(bridged(live()))).toEqual(deployments(runtime));
    expect(deployments(bridged(live()))).toContainEqual(["app", "deploying"]);
  });

  it("knows nothing before the organization's running work was first read", () => {
    const connecting = bridged(emptyAccount);
    expect(connecting.observation.required[0]?.status).toBe("establishing");
    expect(deployments(connecting)).toEqual(
      deployments(
        processesRead([], {
          coverage: { kind: "none" },
          project: PROJECT,
          interest: connecting.observation.required[0]!,
        }),
      ),
    );
  });

  it("keeps what it read while the feed catches up, said to be failing", () => {
    const down = apply(live(), [
      { kind: "stream", key: runningScope(ORG), now: 0, event: { kind: "parent-lost" } },
      {
        kind: "stream",
        key: linkKeys.zerops(ORG),
        now: 0,
        event: { kind: "fault", jitter: 0, fault: { outcome: "transient", message: "closed" } },
      },
    ]);
    const read = bridged(down);
    expect(read.value).toHaveLength(1);
    expect(read.observation.required[0]?.status).toBe("failed");
  });
});

describe("processStatusOf — how a build the deployment store followed ended", () => {
  it("names a build Zerops ended failed, so the stop says its build failed", () => {
    const ended = apply(live(), [pushed({ ...BUILD, status: "FAILED" }, 2)]);
    const read = readsOfState(ended);
    const status = (ref: ReturnType<typeof processRef>) =>
      processStatusOf(read.fact("process", ref.processId));
    const followed = new Map([["s1", processRef("build", PROJECT)]]);
    const next = stopServices(
      {
        services: SERVICES,
        processes: bridged(ended),
        names: new Map(),
        refused: null,
        stated: new Map(),
      },
      NOW,
    );
    const { shown } = buildEnds(followed, next, bridged(ended), status);
    expect(
      shown.state === "known" && shown.value.find((stop) => stop.hostname === "app")?.deployment,
    ).toMatchObject({ value: { kind: "none", failedBuild: { processId: "build" } } });
  });
});
