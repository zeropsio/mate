import { describe, expect, it } from "vite-plus/test";

import { project, service } from "../data/__fixtures__/index.ts";
import {
  projectKeyOf,
  type CollectionRead,
  type LeaseAdmissionError,
  type ProcessRecord,
  type ProcessRef,
  type ProcessStatus,
  type ProjectRef,
  type ServiceDeployInfo,
  type ServiceRecord,
  type ServiceRef,
} from "../data/types.ts";
import type { ZeropsServiceDeployedVersion } from "../data/deployedVersion.ts";
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
  /** Each process's status as the account's store holds it, by process id. */
  const statuses = new Map<string, ProcessStatus>();
  let follows = 0;
  /** What the account's store states of each service's version, by service id. */
  const versions = new Map<string, Shown<ZeropsServiceDeployedVersion>>();
  /** Every service the store asked about. */
  const asked: string[] = [];
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
      deployedVersion: (ref: ServiceRef): Shown<ZeropsServiceDeployedVersion> => {
        asked.push(ref.serviceId);
        return versions.get(ref.serviceId) ?? { state: "unread", waitingFor: null };
      },
      buildStatus: (ref: ProcessRef) => statuses.get(ref.processId),
      nowMs: () => NOW,
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
    /** Every service whose version the store asked the account's store about. */
    asked: () => asked,
    /** The account's store now states this of the stage's `app`, and says it changed. */
    answer: (shown: Shown<ZeropsServiceDeployedVersion>) => {
      versions.set("app-id", shown);
      changed(STAGE);
    },
    /** How often a stop's demand was taken. */
    follows: () => follows,
    /** The stage's build `processId` ended `status`: it leaves the running processes. */
    end: (processId: string, status: ProcessStatus | undefined) => {
      if (status !== undefined) statuses.set(processId, status);
      processReads.set(projectKeyOf(STAGE), processesRead([], { project: STAGE }));
      changed(STAGE);
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

/** What a direct read of the service answered. */
const stated = (value: ZeropsServiceDeployedVersion): Shown<ZeropsServiceDeployedVersion> => ({
  state: "known",
  value,
  asOf: { ordinal: 9, atMs: NOW },
  coverage: "complete",
  freshness: { kind: "live" },
});

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

    expect(heard).toEqual(["project-stage", "project-stage"]);
    const stop = store.stop(STAGE);
    expect(stop.state === "known" ? stop.value.map(({ hostname }) => hostname) : []).toEqual([
      "app",
    ]);
    // The same object until the listing changes.
    expect(store.stop(STAGE)).toBe(stop);
  });

  it("publishes a stop as it is first demanded: its listings may already be read", () => {
    const platform = listings();
    platform.publish(STAGE, app(STAGE));
    const store = makeDeploymentStore(platform.ports);
    const heard: Array<string> = [];
    store.subscribe((ref) => heard.push(ref.projectId));

    store.demand(STAGE);
    store.demand(STAGE);

    expect(heard).toEqual(["project-stage"]);
    expect(store.stop(STAGE).state).toBe("known");
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

  // A build is followed by its Zerops process to the end Zerops gives it: no clock, no grace.
  describe("a build followed by its process to its end", () => {
    const followed = () => {
      const platform = listings();
      const store = makeDeploymentStore(platform.ports);
      store.demand(STAGE);
      platform.publish(STAGE, stage(NEVER_DEPLOYED));
      platform.publishProcesses(STAGE, building({ id: "version-2", name: SHA }));
      expect(deploymentOf(store.stop(STAGE), "app")).toMatchObject({
        value: { kind: "deploying" },
      });
      return { platform, store };
    };

    it.each([
      {
        name: "Zerops ended it FAILED with nothing running: it failed, in Zerops' words",
        status: "FAILED" as const,
        value: {
          kind: "none",
          failedBuild: { processId: "build-0", reason: "Zerops reports its build failed" },
        },
      },
      {
        name: "Zerops ended it CANCELED with nothing running: it failed, in Zerops' words",
        status: "CANCELED" as const,
        value: {
          kind: "none",
          failedBuild: { processId: "build-0", reason: "Zerops reports its build was canceled" },
        },
      },
      {
        name: "Zerops ended it FINISHED, its version not here yet: nothing failed",
        status: "FINISHED" as const,
        value: { kind: "none" },
      },
      {
        name: "its end not said yet, the listing read without it: nothing failed",
        status: undefined,
        value: { kind: "none" },
      },
    ])("$name", ({ status, value }) => {
      const { platform, store } = followed();
      platform.end("build-0", status);
      expect(deploymentOf(store.stop(STAGE), "app")).toEqual(
        expect.objectContaining({ state: "known", value }),
      );
    });

    it("a failed build is forgotten once a version runs", () => {
      const { platform, store } = followed();
      platform.end("build-0", "FAILED");
      platform.publishProcesses(STAGE, building({ id: "version-3", name: SHA }));
      platform.end("build-0", "FINISHED");
      platform.publish(STAGE, stage({ ...NEVER_DEPLOYED, id: "version-3", source: null }));
      expect(deploymentOf(store.stop(STAGE), "app")).toMatchObject({ value: { kind: "running" } });
    });

    it("a version active before its build's end: running, whatever the build's end says", () => {
      const { platform, store } = followed();
      platform.publish(STAGE, stage({ ...NEVER_DEPLOYED, id: "version-2", source: null }));
      platform.end("build-0", "FINISHED");
      expect(deploymentOf(store.stop(STAGE), "app")).toMatchObject({ value: { kind: "running" } });
    });
  });

  it("a never-built runtime's none says nothing of a build", () => {
    const platform = listings();
    const store = makeDeploymentStore(platform.ports);
    store.demand(STAGE);
    platform.publishProcesses(STAGE, building());
    platform.publish(STAGE, stage(NEVER_DEPLOYED));
    expect(deploymentOf(store.stop(STAGE), "app")).toEqual(
      expect.objectContaining({ value: { kind: "none" } }),
    );
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

  it("a new active version seen only by push is named by what the account's store states of it", () => {
    const platform = listings();
    const store = makeDeploymentStore(platform.ports);
    store.demand(STAGE);
    platform.publishProcesses(STAGE, building());
    platform.publish(STAGE, stage({ ...NEVER_DEPLOYED, source: "GIT", name: "v1.0.0" }));
    expect(platform.asked()).toEqual([]);

    // No build of it was seen: the push names only the new version's id (A14).
    platform.publish(STAGE, stage({ ...NEVER_DEPLOYED, id: "version-2", source: null }));
    expect(platform.asked()).toContain("app-id");
    // A version no build named — a roll back — is checked again, never shown as the old one.
    expect(deploymentOf(store.stop(STAGE), "app")?.state).toBe("unread");

    platform.answer(stated({ activeId: "version-2", source: "GIT", name: `${SHA} v1.1.0 ada` }));

    expect(deploymentOf(store.stop(STAGE), "app")).toMatchObject({
      state: "known",
      value: { kind: "running", version: { sha: SHA, name: "v1.1.0", label: "v1.1.0" } },
    });
  });

  describe("what the account's store states of a pushed version (A14)", () => {
    const cases: ReadonlyArray<{
      readonly name: string;
      readonly answer: Shown<ZeropsServiceDeployedVersion>;
      readonly deployment: object;
    }> = [
      {
        name: "a version the service does not name runs, unnamed",
        answer: stated({ activeId: "version-2", source: "GIT", name: null }),
        deployment: { state: "known", value: { kind: "running", version: { label: undefined } } },
      },
      {
        name: "a never-deployed runtime's NONE version runs nothing",
        answer: stated({ activeId: "version-2", source: "NONE", name: null }),
        deployment: { state: "known", value: { kind: "none" } },
      },
      {
        name: "a statement of another version names nothing",
        answer: stated({ activeId: "version-1", source: "GIT", name: SHA }),
        deployment: { state: "unread" },
      },
      {
        name: "a stream that failed says so",
        answer: {
          state: "failed",
          failure: { kind: "transport", detail: "Zerops did not answer." },
          atMs: NOW,
          attempt: 1,
          retryAtMs: NOW + 2_000,
        },
        deployment: { state: "failed", retryAtMs: NOW + 2_000 },
      },
      {
        name: "a list still under way holds the line",
        answer: { state: "reading", sinceMs: NOW, attempt: 1 },
        deployment: { state: "unread" },
      },
    ];

    it.each(cases)("$name", ({ answer, deployment }) => {
      const platform = listings();
      const store = makeDeploymentStore(platform.ports);
      store.demand(STAGE);
      platform.publishProcesses(STAGE, building());
      platform.publish(STAGE, stage({ ...NEVER_DEPLOYED, id: "version-2", source: null }));

      platform.answer(answer);

      expect(deploymentOf(store.stop(STAGE), "app")).toMatchObject(deployment);
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

  it("a re-check keeps the last answer: the import's no-code version never reads Checking again", () => {
    const platform = listings();
    const store = makeDeploymentStore(platform.ports);
    store.demand(STAGE);
    platform.publishProcesses(STAGE, building());
    platform.publish(STAGE, stage(NEVER_DEPLOYED));
    expect(deploymentOf(store.stop(STAGE), "app")).toMatchObject({ value: { kind: "none" } });

    // The import's own deploy activates a version the push names only by its id (A14).
    platform.publish(STAGE, stage({ ...NEVER_DEPLOYED, id: "version-2", source: null }));
    expect(deploymentOf(store.stop(STAGE), "app")).toMatchObject({
      state: "known",
      value: { kind: "none" },
      freshness: { kind: "revalidating", sinceMs: NOW },
    });

    platform.answer(stated({ activeId: "version-2", source: "NONE", name: null }));
    expect(deploymentOf(store.stop(STAGE), "app")).toMatchObject({
      state: "known",
      value: { kind: "none" },
      freshness: { kind: "live" },
    });
  });

  it("a re-check of the whole listing keeps the services it showed", () => {
    const platform = listings();
    const store = makeDeploymentStore(platform.ports);
    store.demand(STAGE);
    platform.publishProcesses(STAGE, building());
    platform.publish(STAGE, stage(NEVER_DEPLOYED));

    // The listing is read again: its coverage is not stated until it lands.
    platform.publish(
      STAGE,
      servicesRead([record("app-id", "app", deployed(NEVER_DEPLOYED), { project: STAGE })], {
        project: STAGE,
        coverage: { kind: "none" },
      }),
    );

    expect(store.stop(STAGE)).toMatchObject({
      state: "known",
      freshness: { kind: "revalidating", sinceMs: NOW },
    });
    expect(deploymentOf(store.stop(STAGE), "app")).toMatchObject({ value: { kind: "none" } });
  });

  it("a refused demand stays failed until a manual Again, without scheduling recovery", () => {
    const platform = listings();
    const store = makeDeploymentStore(platform.ports);
    store.demand(STAGE);
    platform.refuse(STAGE, "account-capacity");
    expect(store.stop(STAGE)).toMatchObject({ state: "failed", retryAtMs: null });
    expect(platform.follows()).toBe(1);
    store.again(STAGE);
    expect(platform.follows()).toBe(2);
    platform.publish(STAGE, stage(NEVER_DEPLOYED));
    platform.publishProcesses(STAGE, building());
    expect(deploymentOf(store.stop(STAGE), "app")).toMatchObject({
      state: "known",
      value: { kind: "none" },
    });
  });

  it("a stop let go stops asking for the demand the platform refused", () => {
    const platform = listings();
    const store = makeDeploymentStore(platform.ports);
    const release = store.demand(STAGE);
    platform.refuse(STAGE, "account-capacity");

    release();

    expect(platform.watching()).toBe(0);
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

it("shares a stop across summary and detail, releasing detail work when its last detail closes", () => {
  const rig = listings();
  const scopes: string[] = [];
  const store = makeDeploymentStore({
    ...rig.ports,
    follow: (ref, changed, refused, scope) => {
      scopes.push(scope);
      return rig.ports.follow(ref, changed, refused);
    },
  });
  const row = store.demand(STAGE);
  const chip = store.demand(STAGE);
  expect(scopes).toEqual(["summary"]);
  const detail = store.demand(STAGE, "detail");
  const otherDetail = store.demand(STAGE, "detail");
  expect(scopes).toEqual(["summary", "detail"]);
  detail();
  expect(scopes).toEqual(["summary", "detail"]);
  otherDetail();
  expect(scopes).toEqual(["summary", "detail", "summary"]);
  row();
  chip();
  expect(rig.watching()).toBe(0);
});
