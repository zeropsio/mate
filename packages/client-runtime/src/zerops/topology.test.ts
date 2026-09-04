import { describe, expect, it } from "@effect/vitest";

import type { ActivityProcess } from "./activity/dto.ts";
import type { ZeropsProject, ZeropsService } from "./api.ts";
import { projectTopology } from "./topology.ts";
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
