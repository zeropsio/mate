import { describe, expect, it } from "vite-plus/test";

import { project, service } from "../data/__fixtures__/index.ts";
import {
  projectKeyOf,
  type CollectionRead,
  type LeaseAdmissionError,
  type ProcessRecord,
  type ProjectRef,
  type ServiceDeployInfo,
  type ServiceRecord,
} from "../data/types.ts";
import type { Shown } from "../knowledge/known.ts";
import type { StopService } from "./deployment.ts";
import { processesRead, runningProcess } from "./__fixtures__/processes.ts";
import { deployed, record, servicesRead } from "./__fixtures__/services.ts";
import { makeDeploymentStore } from "./deploymentStore.ts";

const NOW = 100_000;
const STAGE = project("project-stage");
const PRODUCTION = project("project-production");

/** The data runtime's listings, which the test changes and publishes. */
function listings() {
  const reads = new Map<string, CollectionRead<ServiceRecord>>();
  const processReads = new Map<string, CollectionRead<ProcessRecord>>();
  const watchers = new Map<string, Set<() => void>>();
  const refusals = new Map<string, (reason: LeaseAdmissionError["reason"]) => void>();
  const timers: Array<{ readonly delayMs: number; readonly fire: () => void; armed: boolean }> = [];
  let follows = 0;
  const changed = (ref: ProjectRef) => {
    for (const listener of watchers.get(projectKeyOf(ref)) ?? []) listener();
  };
  return {
    ports: {
      services: (ref: ProjectRef) =>
        reads.get(projectKeyOf(ref)) ??
        servicesRead([], { coverage: { kind: "none" }, project: ref }),
      processes: (ref: ProjectRef) =>
        processReads.get(projectKeyOf(ref)) ??
        processesRead([], { coverage: { kind: "none" }, project: ref }),
      follow: (
        ref: ProjectRef,
        listener: () => void,
        refused: (reason: LeaseAdmissionError["reason"]) => void,
      ) => {
        follows += 1;
        const key = projectKeyOf(ref);
        const set = watchers.get(key) ?? new Set();
        watchers.set(key, set.add(listener));
        refusals.set(key, refused);
        return () => void set.delete(listener);
      },
      nowMs: () => NOW,
      random: () => 0.5,
      setTimer: (delayMs: number, fire: () => void) => {
        const timer = { delayMs, fire, armed: true };
        timers.push(timer);
        return () => {
          timer.armed = false;
        };
      },
    },
    publish: (ref: ProjectRef, read: CollectionRead<ServiceRecord>) => {
      reads.set(projectKeyOf(ref), read);
      changed(ref);
    },
    publishProcesses: (ref: ProjectRef, read: CollectionRead<ProcessRecord>) => {
      processReads.set(projectKeyOf(ref), read);
      changed(ref);
    },
    /** The platform takes no demand for the project's running processes. */
    refuse: (ref: ProjectRef, reason: LeaseAdmissionError["reason"]) =>
      refusals.get(projectKeyOf(ref))?.(reason),
    watching: () => [...watchers.values()].reduce((count, set) => count + set.size, 0),
    /** How often a stop's demand was taken. */
    follows: () => follows,
    /** The armed timers' delays. */
    armed: () => timers.filter(({ armed }) => armed).map(({ delayMs }) => delayMs),
    /** Fires every armed timer. */
    fire: () => {
      for (const timer of timers.filter(({ armed }) => armed)) {
        timer.armed = false;
        timer.fire();
      }
    },
  };
}

const SHA = "3f9c1b2000000000000000000000000000000000";

/** A runtime's version before its first deploy: `NONE` runs nothing. */
const NEVER_DEPLOYED: ServiceDeployInfo = {
  id: "version-1",
  status: "ACTIVE",
  source: "NONE",
  activatedAt: "2026-09-23T09:00:00Z",
  name: null,
  branch: null,
  commit: null,
  tag: null,
  repository: null,
};

/** The one runtime service `app` of the stop, with what the platform says of its deployment. */
const stage = (deploy: ServiceDeployInfo | null) =>
  servicesRead([record("app-id", "app", deployed(deploy), { project: STAGE })], {
    project: STAGE,
  });

/** The stop's processes: `builds` lists the running builds of `app`. */
const building = (...builds: ReadonlyArray<{ readonly id: string; readonly name: string }>) =>
  processesRead(
    builds.map((appVersion, index) =>
      runningProcess(`build-${index}`, {
        serviceIds: ["build-helper", "app-id"],
        appVersion: { ...appVersion, status: "BUILDING" },
        project: STAGE,
      }),
    ),
    { project: STAGE },
  );

const deploymentOf = (stop: Shown<ReadonlyArray<StopService>>, hostname: string) =>
  stop.state === "known"
    ? stop.value.find((entry) => entry.hostname === hostname)?.deployment
    : undefined;

const app = (ref: ProjectRef) =>
  servicesRead([record(`${ref.projectId}-app`, "app", deployed(null), { project: ref })], {
    project: ref,
  });

describe("the deployment store (DESIGN §2.D D6)", () => {
  it("publishes a demanded stop as the platform's listing of it changes", () => {
    const platform = listings();
    const store = makeDeploymentStore(platform.ports);
    const heard: Array<string> = [];
    store.subscribe((ref) => heard.push(ref.projectId));

    expect(store.stop(STAGE).state).toBe("unread");
    store.demand(STAGE);
    platform.publish(STAGE, app(STAGE));

    expect(heard).toEqual(["project-stage"]);
    const stop = store.stop(STAGE);
    expect(stop.state === "known" ? stop.value.map(({ hostname }) => hostname) : []).toEqual([
      "app",
    ]);
    // The same object until the listing changes.
    expect(store.stop(STAGE)).toBe(stop);
  });

  it("shows only what a view demands, and hears nothing once the last demand is released", () => {
    const platform = listings();
    const store = makeDeploymentStore(platform.ports);
    platform.publish(PRODUCTION, app(PRODUCTION));

    expect(store.stop(PRODUCTION).state).toBe("unread");
    const release = store.demand(PRODUCTION);
    expect(store.stop(PRODUCTION).state).toBe("known");
    expect(store.shows(service("project-production-app", PRODUCTION))).toBe(true);
    expect(store.shows(service("project-stage-app", STAGE))).toBe(false);

    release();
    expect(platform.watching()).toBe(0);
    expect(store.stop(PRODUCTION).state).toBe("unread");
  });

  it("a deployment invalidation publishes that service's stop again, and only it", () => {
    const platform = listings();
    const store = makeDeploymentStore(platform.ports);
    store.demand(STAGE);
    store.demand(PRODUCTION);
    platform.publish(STAGE, app(STAGE));
    platform.publish(PRODUCTION, app(PRODUCTION));
    const heard: Array<string> = [];
    store.subscribe((ref) => heard.push(ref.projectId));

    store.invalidate({ topic: "deployment", service: service("project-stage-app", STAGE) });

    expect(heard).toEqual(["project-stage"]);
  });

  it("a deploy in progress reads deploying(sha), never nothing deployed", () => {
    const platform = listings();
    const store = makeDeploymentStore(platform.ports);
    store.demand(STAGE);
    // The runtime's first deploy: the service still carries its NONE version while it builds.
    platform.publish(STAGE, stage(NEVER_DEPLOYED));
    platform.publishProcesses(STAGE, building({ id: "version-2", name: SHA }));

    expect(deploymentOf(store.stop(STAGE), "app")).toMatchObject({
      state: "known",
      value: { kind: "deploying", version: { sha: SHA, commit: "3f9c1b2" } },
    });
  });

  it("the build process's name becomes the running deployment's name when its version activates", () => {
    const platform = listings();
    const store = makeDeploymentStore(platform.ports);
    store.demand(STAGE);
    platform.publish(STAGE, stage({ ...NEVER_DEPLOYED, source: "GIT", name: "v1.0.0" }));
    platform.publishProcesses(STAGE, building({ id: "version-2", name: SHA }));
    // The build ends; the service's next frame names only the new version's id (A11, A14).
    platform.publishProcesses(STAGE, building());
    platform.publish(
      STAGE,
      stage({
        ...NEVER_DEPLOYED,
        id: "version-2",
        source: null,
        activatedAt: "2026-09-23T10:01:00Z",
      }),
    );

    expect(deploymentOf(store.stop(STAGE), "app")).toMatchObject({
      state: "known",
      value: {
        kind: "running",
        activatedAt: "2026-09-23T10:01:00Z",
        version: { sha: SHA, commit: "3f9c1b2", label: "3f9c1b2" },
      },
    });
  });

  it("a never-deployed runtime stays Nothing deployed", () => {
    const platform = listings();
    const store = makeDeploymentStore(platform.ports);
    store.demand(STAGE);
    platform.publish(STAGE, stage(NEVER_DEPLOYED));
    // Until the processes are read, a build for it may be running unseen.
    expect(deploymentOf(store.stop(STAGE), "app")?.state).toBe("unread");

    platform.publishProcesses(
      STAGE,
      processesRead(
        [
          runningProcess("other-build", {
            serviceIds: ["api-id"],
            appVersion: { id: "api-version", name: SHA },
            project: STAGE,
          }),
          runningProcess("restart", { actionName: "stack.restart", serviceIds: ["app-id"] }),
        ],
        { project: STAGE },
      ),
    );

    expect(deploymentOf(store.stop(STAGE), "app")).toMatchObject({
      state: "known",
      value: { kind: "none" },
    });
  });

  it("a refused process demand fails the none it could not prove until it is taken again", () => {
    const platform = listings();
    const store = makeDeploymentStore(platform.ports);
    const release = store.demand(STAGE);
    const heard: Array<string> = [];
    store.subscribe((ref) => heard.push(ref.projectId));
    platform.publish(STAGE, stage(NEVER_DEPLOYED));

    platform.refuse(STAGE, "account-capacity");

    expect(heard).toEqual([STAGE.projectId, STAGE.projectId]);
    expect(deploymentOf(store.stop(STAGE), "app")).toMatchObject({
      state: "failed",
      failure: { kind: "refused", code: "account-capacity" },
      attempt: 1,
      retryAtMs: NOW + 2_000,
    });
    // Refused again, the next ask waits a rung longer (§4.0).
    platform.fire();
    platform.refuse(STAGE, "account-capacity");
    expect(platform.armed()).toEqual([4_000]);
    expect(deploymentOf(store.stop(STAGE), "app")).toMatchObject({
      state: "failed",
      attempt: 2,
      retryAtMs: NOW + 4_000,
    });

    // Taken this time: the stop reads its processes, and proves its none.
    platform.fire();
    expect(platform.follows()).toBe(3);
    expect(deploymentOf(store.stop(STAGE), "app")?.state).toBe("unread");
    platform.publishProcesses(STAGE, building());
    expect(deploymentOf(store.stop(STAGE), "app")).toMatchObject({
      state: "known",
      value: { kind: "none" },
    });

    release();
    expect(platform.armed()).toEqual([]);
  });

  it("a stop let go stops asking for the demand the platform refused", () => {
    const platform = listings();
    const store = makeDeploymentStore(platform.ports);
    const release = store.demand(STAGE);
    platform.refuse(STAGE, "account-capacity");

    release();

    expect(platform.armed()).toEqual([]);
  });

  it("a process demand refused as it is taken fails the none too", () => {
    const platform = listings();
    platform.publish(STAGE, stage(NEVER_DEPLOYED));
    const store = makeDeploymentStore({
      ...platform.ports,
      follow: (_ref, _changed, refused) => {
        refused("account-mismatch");
        return () => undefined;
      },
    });

    store.demand(STAGE);

    expect(deploymentOf(store.stop(STAGE), "app")).toMatchObject({
      state: "failed",
      failure: { kind: "refused", code: "account-mismatch" },
      retryAtMs: null,
    });
    // A demand for another account is never admitted: nothing asks again.
    expect(platform.armed()).toEqual([]);
  });

  it("a disposed store watches nothing and publishes nothing", () => {
    const platform = listings();
    const store = makeDeploymentStore(platform.ports);
    store.demand(STAGE);
    const heard: Array<string> = [];
    store.subscribe((ref) => heard.push(ref.projectId));

    store.dispose();
    platform.publish(STAGE, app(STAGE));

    expect(platform.watching()).toBe(0);
    expect(heard).toEqual([]);
    expect(store.stop(STAGE).state).toBe("unread");
    store.demand(STAGE);
    expect(platform.watching()).toBe(0);
  });
});
