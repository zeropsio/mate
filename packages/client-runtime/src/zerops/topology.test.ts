import { describe, expect, it } from "@effect/vitest";

import type { ActivityProcess } from "./activity/dto.ts";
import type { ZeropsProject, ZeropsService } from "./api.ts";
import { projectTopology, zcpServiceIdFor } from "./topology.ts";
import processFixture from "./__fixtures__/z3-eval.process.json" with { type: "json" };
import serviceStackFixture from "./__fixtures__/z3-eval.service-stack.json" with { type: "json" };

/**
 * `GET /project/{id}/service-stack` and `GET /project/{id}/process` for the
 * `z3-eval` project, captured 2026-09-04 (`docs/internals/zerops/verified.md`
 * "platform websocket from a browser origin"). Every `userData`/`userDataList`
 * array was emptied at capture time — those carry env values and the
 * projection never reads them.
 */
const realServices = serviceStackFixture.list as unknown as ReadonlyArray<ZeropsService>;
const realProcesses = processFixture.list as unknown as ReadonlyArray<ActivityProcess>;

const project: ZeropsProject = { id: "nTV3oMB2SS634ImDJnQckg", name: "z3-eval", status: "ACTIVE" };

const WEATHERDASH_ID = "EmWgeZ4rTiK0Ajpm8iH83A";

const service = (
  overrides: Partial<ZeropsService> & { id: string; name: string },
): ZeropsService => ({
  status: "ACTIVE",
  isSystem: false,
  ...overrides,
});

describe("projectTopology — grouping", () => {
  it("groups a captured project into runtime, data and infrastructure", () => {
    const view = projectTopology(project, realServices, []);

    const byGroup = (group: string) =>
      view.services.filter((service) => service.group === group).map((service) => service.hostname);

    expect(byGroup("runtimes")).toEqual(["z3web", "weatherdash", "s3git1", "s3git2"]);
    expect(byGroup("data")).toEqual(["db"]);
    expect(byGroup("infrastructure")).toEqual(["zcp"]);
  });

  /** The project's own control-plane row is never something a user manages. */
  it("drops the isSystem core service entirely", () => {
    const view = projectTopology(project, realServices, []);

    expect(view.services.some((service) => service.hostname === "core")).toBe(false);
    expect(view.services).toHaveLength(6);
  });
});

describe("projectTopology — transient", () => {
  it("is not transient when settled and no process names it", () => {
    const view = projectTopology(project, realServices, realProcesses);

    expect(view.services.find((service) => service.hostname === "weatherdash")?.transient).toBe(
      false,
    );
  });

  it("marks a service transient while a process names it, even though its own status is settled", () => {
    const runningRestart: ActivityProcess = {
      id: "proc-live",
      projectId: project.id,
      serviceStackIds: [WEATHERDASH_ID],
      status: "RUNNING",
      actionName: "stack.restart",
      created: "2026-09-04T12:00:00Z",
    };

    const view = projectTopology(project, realServices, [runningRestart]);

    expect(view.services.find((service) => service.hostname === "weatherdash")?.transient).toBe(
      true,
    );
  });

  it("does not treat a finished process as still in flight", () => {
    // Every process in the captured fixture is FINISHED.
    const view = projectTopology(project, realServices, realProcesses);

    expect(view.services.every((service) => !service.transient)).toBe(true);
  });

  it("is transient on its own unsettled status even with no process at all", () => {
    const creating: ZeropsService = { ...realServices[0]!, status: "CREATING" };

    const view = projectTopology(project, [creating], []);

    expect(view.services[0]?.transient).toBe(true);
  });
});

describe("projectTopology — subdomain origin", () => {
  const subdomainProject: ZeropsProject = {
    ...project,
    publicZone: "fte2334ab.prg1-zerops.zone",
    zeropsSubdomainHost: "26a7",
  };

  it("composes the subdomain origin only for subdomain-enabled http ports", () => {
    const view = projectTopology(subdomainProject, realServices, []);
    const byHostname = new Map(view.services.map((service) => [service.hostname, service]));

    // Port 80 (weatherdash) carries no port segment; a non-default port (zcp,
    // 8080) keeps it — measured against z3-eval, see `servicePortOrigin`.
    expect(byHostname.get("weatherdash")?.subdomainUrl).toBe(
      "https://weatherdash-26a7.prg1.zerops.app",
    );
    expect(byHostname.get("zcp")?.subdomainUrl).toBe("https://zcp-26a7-8080.prg1.zerops.app");
  });

  it("has no subdomain origin for a service without subdomain access", () => {
    const view = projectTopology(subdomainProject, realServices, []);
    const byHostname = new Map(view.services.map((service) => [service.hostname, service]));

    // `db` exposes a port but subdomainAccess is off; `s3git1`/`s3git2` have no ports at all.
    expect(byHostname.get("db")?.subdomainUrl).toBeUndefined();
    expect(byHostname.get("s3git1")?.subdomainUrl).toBeUndefined();
  });

  it("has no subdomain origin at all when the project carries no public subdomain", () => {
    const view = projectTopology(project, realServices, []);

    expect(view.services.every((service) => service.subdomainUrl === undefined)).toBe(true);
  });
});

describe("projectTopology — project", () => {
  it("carries the project id, name and status through", () => {
    const view = projectTopology(project, [], []);

    expect(view.project).toEqual({ id: project.id, name: project.name, status: "ACTIVE" });
  });
});

describe("zcpServiceIdFor", () => {
  it("names the infrastructure zcp service and nothing else", () => {
    const view = projectTopology(project, realServices, []);

    expect(zcpServiceIdFor(view)).toBe("gt7tJZjDSk2zyH5XvNeAQQ");

    // A runtime service happens to be named "zcp" (a user rename) — the
    // helper reads the type prefix, never the hostname, so a decoy must not
    // be picked.
    const decoy: ZeropsService = {
      ...realServices[0]!,
      id: "decoy-id",
      name: "zcp",
      serviceStackTypeInfo: {
        serviceStackTypeVersionName: "nodejs@22",
        serviceStackTypeCategory: "USER",
      },
    };
    const decoyView = projectTopology(project, [decoy], []);

    expect(zcpServiceIdFor(decoyView)).toBeUndefined();
  });
});

describe("projectTopology — what the list read already knows about a service", () => {
  const byHostname = () => {
    const view = projectTopology(project, realServices, []);
    return new Map(view.services.map((service) => [service.hostname, service]));
  };

  it("carries the type's display name, the exact version and the timestamps", () => {
    const z3web = byHostname().get("z3web");

    expect(z3web?.typeName).toBe("Static");
    expect(z3web?.version).toBe("v1.0.0");
    expect(z3web?.createdAt).toBe("2026-08-31T09:06:10Z");
    expect(z3web?.updatedAt).toBe("2026-09-01T08:30:35Z");
    expect(byHostname().get("db")?.typeName).toBe("MariaDB");
    expect(byHostname().get("db")?.version).toBe("v10.6.16");
  });

  it("names the managed service's mode and leaves a runtime's absent", () => {
    expect(byHostname().get("db")?.mode).toBe("NON_HA");
    expect(byHostname().get("z3web")).not.toHaveProperty("mode");
  });

  it("carries the running deploy with its source and activation time", () => {
    expect(byHostname().get("z3web")?.deploy).toEqual({
      source: "CLI",
      activatedAt: "2026-09-01T08:30:34Z",
    });
    expect(byHostname().get("zcp")?.deploy?.source).toBe("GIT");
  });

  it("has no deploy for a managed service, nor for a runtime that was never deployed", () => {
    expect(byHostname().get("db")).not.toHaveProperty("deploy");
    // `s3git1` carries an ACTIVE app version whose source is NONE.
    expect(byHostname().get("s3git1")).not.toHaveProperty("deploy");
  });

  it("reads a git deploy's branch, commit and repository off the integration", () => {
    const view = projectTopology(
      project,
      [
        {
          id: "svc-git",
          name: "api",
          status: "ACTIVE",
          activeAppVersion: {
            source: "GITHUB",
            lastUpdate: "2026-09-05T10:00:00Z",
            githubIntegration: {
              eventType: "BRANCH",
              branchName: "main",
              commit: "abc1234def",
              repositoryFullName: "acme/api",
            },
          },
        },
      ],
      [],
    );

    expect(view.services[0]?.deploy).toEqual({
      source: "GITHUB",
      activatedAt: "2026-09-05T10:00:00Z",
      branch: "main",
      commit: "abc1234def",
      repository: "acme/api",
    });
  });
});

describe("projectTopology — public routes", () => {
  const subdomainProject: ZeropsProject = {
    ...project,
    publicZone: "fte2334ab.prg1-zerops.zone",
    zeropsSubdomainHost: "26a7",
  };

  it("lists every subdomain-enabled http port as a route, host without its scheme", () => {
    const view = projectTopology(
      subdomainProject,
      [
        service({
          id: "svc-web",
          name: "web",
          subdomainAccess: true,
          ports: [
            { port: 80, scheme: "http" },
            { port: 3000, scheme: "http" },
            { port: 5432, scheme: "tcp" },
          ],
        }),
      ],
      [],
    );

    expect(view.services[0]?.routes).toEqual([
      { port: 80, url: "https://web-26a7.prg1.zerops.app", host: "web-26a7.prg1.zerops.app" },
      {
        port: 3000,
        url: "https://web-26a7-3000.prg1.zerops.app",
        host: "web-26a7-3000.prg1.zerops.app",
      },
    ]);
    expect(view.services[0]?.subdomainUrl).toBe("https://web-26a7.prg1.zerops.app");
  });

  it("has no routes for a service without subdomain access", () => {
    const view = projectTopology(subdomainProject, realServices, []);

    expect(view.services.find((entry) => entry.hostname === "db")?.routes).toEqual([]);
  });
});

/**
 * `POST /current-stats/group-by-search` grouped by container for
 * `acme-docs-dev`, captured 2026-09-06: the zcp container and the core
 * service's, with the ids the project's service list carries.
 */
const liveStats = [
  {
    serviceStackId: "svc-core",
    containerId: "LVu1pkB8R2ayMzJ3yBMYsA",
    cpu: { limit: 0, used: 0 },
    vCpu: { limit: 1, used: 0.036 },
    ramGBytes: { limit: 0.375, used: 0.164 },
    diskGBytes: { limit: 1, used: 0.002 },
  },
  {
    serviceStackId: "svc-zcp",
    containerId: "Uy8sS5dCS2K3uBeU97yQCg",
    cpu: { limit: 0, used: 0 },
    vCpu: { limit: 2, used: 0.076 },
    ramGBytes: { limit: 2.625, used: 0.512 },
    diskGBytes: { limit: 2, used: 0.161 },
  },
];

describe("projectTopology — live usage", () => {
  const zcp = service({
    id: "svc-zcp",
    name: "zcp",
    serviceStackTypeInfo: {
      serviceStackTypeVersionName: "zcp@1",
      serviceStackTypeCategory: "USER",
    },
  });
  const app = service({
    id: "svc-app",
    name: "app",
    serviceStackTypeInfo: {
      serviceStackTypeVersionName: "ubuntu/nodejs@22",
      serviceStackTypeCategory: "USER",
    },
  });

  it("attaches a service's container allocation, and says the read has answered", () => {
    const view = projectTopology(project, [zcp, app], [], liveStats);

    expect(view.usageRead).toBe(true);
    expect(view.services.find((entry) => entry.hostname === "zcp")?.usage).toEqual({
      containers: 1,
      cores: { used: 0.076, limit: 2 },
      memoryGb: { used: 0.512, limit: 2.625 },
      diskGb: { used: 0.161, limit: 2 },
    });
  });

  it("leaves usage absent for a service with no container, once the read has answered", () => {
    const view = projectTopology(project, [zcp, app], [], liveStats);

    expect(view.services.find((entry) => entry.hostname === "app")).not.toHaveProperty("usage");
  });

  it("says the read has not answered when no stats were given", () => {
    const view = projectTopology(project, [zcp], []);

    expect(view.usageRead).toBe(false);
    expect(view.services[0]).not.toHaveProperty("usage");
  });

  it("sums a highly available service over its containers and counts them", () => {
    const container = (id: string) => ({
      serviceStackId: "svc-db",
      containerId: id,
      cpu: { limit: 0, used: 0 },
      vCpu: { limit: 1, used: 0.1 },
      ramGBytes: { limit: 0.5, used: 0.2 },
      diskGBytes: { limit: 1, used: 0.3 },
    });
    const view = projectTopology(
      project,
      [service({ id: "svc-db", name: "db" })],
      [],
      [container("c1"), container("c2"), container("c3")],
    );

    expect(view.services[0]?.usage).toEqual({
      containers: 3,
      cores: { used: 0.30000000000000004, limit: 3 },
      memoryGb: { used: 0.6000000000000001, limit: 1.5 },
      diskGb: { used: 0.8999999999999999, limit: 3 },
    });
  });

  it("counts dedicated cores alongside shared ones", () => {
    const view = projectTopology(
      project,
      [service({ id: "svc-app", name: "app" })],
      [],
      [
        {
          serviceStackId: "svc-app",
          cpu: { limit: 2, used: 1.5 },
          vCpu: { limit: 0, used: 0 },
          ramGBytes: { limit: 1, used: 0.5 },
          diskGBytes: { limit: 1, used: 0.5 },
        },
      ],
    );

    expect(view.services[0]?.usage?.cores).toEqual({ used: 1.5, limit: 2 });
  });
});

/**
 * `POST /stats-history/group-by-search` grouped by stack, hourly, for
 * `scratch-playground`, captured 2026-09-06: the first and last of a zcp's
 * 24 buckets.
 */
const historyItems = [
  {
    from: "2026-09-05T01:00:00+02:00",
    till: "2026-09-05T01:59:59+02:00",
    serviceStackId: "svc-zcp",
    containerCount: 0,
    cpuLimit: 0,
    cpuUsed: 0,
    vCpuLimit: 0,
    vCpuUsed: 0,
    ramLimit: 0,
    ramUsed: 0,
    diskLimit: 0,
    diskUsed: 0,
  },
  {
    from: "2026-09-06T00:00:00+02:00",
    till: "2026-09-06T00:59:59+02:00",
    serviceStackId: "svc-zcp",
    containerCount: 1,
    cpuLimit: 0,
    cpuUsed: 0,
    vCpuLimit: 2,
    vCpuUsed: 0.062,
    ramLimit: 2.75,
    ramUsed: 0.512,
    diskLimit: 2,
    diskUsed: 0.167,
  },
];

describe("projectTopology — history", () => {
  const zcp = service({ id: "svc-zcp", name: "zcp" });
  const app = service({ id: "svc-app", name: "app" });

  it("attaches a service's buckets oldest first, cores summed over shared and dedicated", () => {
    const view = projectTopology(project, [zcp, app], [], [], historyItems);

    expect(view.services.find((entry) => entry.hostname === "zcp")?.history).toEqual([
      {
        at: "2026-09-05T01:00:00+02:00",
        containers: 0,
        cores: { used: 0, limit: 0 },
        memoryGb: { used: 0, limit: 0 },
        diskGb: { used: 0, limit: 0 },
      },
      {
        at: "2026-09-06T00:00:00+02:00",
        containers: 1,
        cores: { used: 0.062, limit: 2 },
        memoryGb: { used: 0.512, limit: 2.75 },
        diskGb: { used: 0.167, limit: 2 },
      },
    ]);
    expect(view.services.find((entry) => entry.hostname === "app")).not.toHaveProperty("history");
  });

  it("has no history at all until the read answers", () => {
    const view = projectTopology(project, [zcp], [], []);

    expect(view.services[0]).not.toHaveProperty("history");
  });
});

describe("projectTopology — the autoscaling envelope", () => {
  const scaled = service({
    id: "svc-app",
    name: "app",
    currentAutoscaling: {
      verticalAutoscaling: {
        maxResource: { cpuCoreCount: 3, memoryGBytes: 6, diskGBytes: 100 },
        minResource: { cpuCoreCount: 1, memoryGBytes: 0.125, diskGBytes: 1 },
        cpuMode: "SHARED",
        startCpuCoreCount: 2,
      },
      horizontalAutoscaling: { maxContainerCount: 3, minContainerCount: 1 },
    },
  });

  it("carries the effective envelope, each range with both ends", () => {
    const view = projectTopology(project, [scaled], []);

    expect(view.services[0]?.scaling).toEqual({
      containers: { min: 1, max: 3 },
      cores: { min: 1, max: 3 },
      memoryGb: { min: 0.125, max: 6 },
      diskGb: { min: 1, max: 100 },
      cpuMode: "SHARED",
    });
  });

  it("leaves out a range the platform states with a null end, and the whole envelope when there is none", () => {
    const single = service({
      id: "svc-db",
      name: "db",
      currentAutoscaling: {
        verticalAutoscaling: {
          maxResource: { cpuCoreCount: 3, memoryGBytes: 6, diskGBytes: 100 },
          minResource: { cpuCoreCount: 1, memoryGBytes: 1, diskGBytes: 1 },
          cpuMode: "SHARED",
        },
        horizontalAutoscaling: { maxContainerCount: null, minContainerCount: null },
      },
    });
    const core = service({
      id: "svc-core",
      name: "core",
      currentAutoscaling: { verticalAutoscaling: null, horizontalAutoscaling: null },
    });
    const view = projectTopology(project, [single, core, service({ id: "svc-x", name: "x" })], []);

    expect(view.services[0]?.scaling).toEqual({
      cores: { min: 1, max: 3 },
      memoryGb: { min: 1, max: 6 },
      diskGb: { min: 1, max: 100 },
      cpuMode: "SHARED",
    });
    expect(view.services[1]).not.toHaveProperty("scaling");
    expect(view.services[2]).not.toHaveProperty("scaling");
  });
});
