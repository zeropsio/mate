import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { ZeropsProject, ZeropsService } from "./api.ts";
import { deriveZeropsCandidates, groupZeropsCandidates, zeropsCodeBaseUrl } from "./candidates.ts";

const PROJECT: ZeropsProject = {
  id: "project-1",
  name: "kanban",
  status: "ACTIVE",
  clientId: "org-1",
  publicZone: "fte2334ab.prg1-zerops.zone",
  zeropsSubdomainHost: "24cb",
};

function service(overrides: Partial<ZeropsService> & { readonly id: string }): ZeropsService {
  return {
    name: "zcp",
    status: "ACTIVE",
    subdomainAccess: true,
    ports: [{ port: 8080, httpSupport: true }],
    serviceStackTypeInfo: { serviceStackTypeVersionName: "zcp@1" },
    ...overrides,
  };
}

const NO_CONNECTIONS = new Map<string, EnvironmentId>();

describe("zeropsCodeBaseUrl", () => {
  it("defers to the served prefix only for the container that serves this bundle", () => {
    const app = {
      origin: "https://zcp-current-8080.prg1.zerops.app",
      basePath: "/preview/z3",
    };

    expect(zeropsCodeBaseUrl(app.origin, app)).toBe(
      "https://zcp-current-8080.prg1.zerops.app/preview/z3",
    );
    expect(zeropsCodeBaseUrl("https://zcp-remote-8080.prg1.zerops.app", app)).toBe(
      "https://zcp-remote-8080.prg1.zerops.app/z3",
    );
  });
});

describe("deriveZeropsCandidates", () => {
  it("finds a zcp container by service type, whatever its hostname is", () => {
    const candidates = deriveZeropsCandidates(
      PROJECT,
      [service({ id: "s1", name: "workspace" })],
      NO_CONNECTIONS,
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.group).toBe("ready");
    expect(candidates[0]?.service?.name).toBe("workspace");
    expect(candidates[0]?.containerOrigin).toBe("https://workspace-24cb-8080.prg1.zerops.app");
  });

  it("does not mistake a service merely named zcp for a container", () => {
    const candidates = deriveZeropsCandidates(
      PROJECT,
      [
        service({
          id: "s1",
          name: "zcp",
          serviceStackTypeInfo: { serviceStackTypeVersionName: "nodejs@22" },
        }),
      ],
      NO_CONNECTIONS,
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.group).toBe("unavailable");
    expect(candidates[0]?.reason).toMatch(/no Zerops Code container/i);
    expect(candidates[0]?.service).toBeUndefined();
  });

  it("offers every zcp container in a project, not one per project", () => {
    const candidates = deriveZeropsCandidates(
      PROJECT,
      [
        service({ id: "s1", name: "zcp" }),
        service({ id: "s2", name: "zcp2" }),
        service({
          id: "s3",
          name: "api",
          serviceStackTypeInfo: { serviceStackTypeVersionName: "nodejs@22" },
        }),
      ],
      NO_CONNECTIONS,
    );

    expect(candidates.map((candidate) => candidate.service?.id)).toEqual(["s1", "s2"]);
    expect(candidates.every((candidate) => candidate.group === "ready")).toBe(true);
    expect(new Set(candidates.map((candidate) => candidate.key)).size).toBe(2);
  });

  it("reports a project still being created as provisioning, not unavailable", () => {
    const candidates = deriveZeropsCandidates(
      { ...PROJECT, status: "CREATING" },
      [service({ id: "s1" })],
      NO_CONNECTIONS,
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.group).toBe("provisioning");
    expect(candidates[0]?.reason).toBe("project is being created");
  });

  it("reports a project in any other non-active status as unavailable, naming it", () => {
    const candidates = deriveZeropsCandidates(
      { ...PROJECT, status: "SUSPENDED" },
      [service({ id: "s1" })],
      NO_CONNECTIONS,
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.group).toBe("unavailable");
    expect(candidates[0]?.reason).toBe("project is SUSPENDED");
  });

  it("reports a container that is not active as unavailable, naming its status", () => {
    const candidates = deriveZeropsCandidates(
      PROJECT,
      [service({ id: "s1", status: "STOPPED" })],
      NO_CONNECTIONS,
    );

    expect(candidates[0]?.group).toBe("unavailable");
    expect(candidates[0]?.reason).toBe("container is STOPPED");
    // The service is still named, so the UI can offer to start it.
    expect(candidates[0]?.service?.id).toBe("s1");
  });

  it("reports a container that is starting as provisioning, naming its status", () => {
    for (const status of ["NEW", "CREATING", "STARTING", "RESTARTING", "UPGRADING"]) {
      const candidates = deriveZeropsCandidates(
        PROJECT,
        [service({ id: "s1", status })],
        NO_CONNECTIONS,
      );

      expect(candidates[0]?.group).toBe("provisioning");
      expect(candidates[0]?.reason).toBe(`container is starting (${status})`);
      expect(candidates[0]?.service?.id).toBe("s1");
    }
  });

  it("names the specific reason a container has no reachable origin", () => {
    const noSubdomain = deriveZeropsCandidates(
      PROJECT,
      [service({ id: "s1", subdomainAccess: false })],
      NO_CONNECTIONS,
    );
    expect(noSubdomain[0]?.group).toBe("unavailable");
    expect(noSubdomain[0]?.reason).toMatch(/public access/i);

    const noPort = deriveZeropsCandidates(
      PROJECT,
      [service({ id: "s1", ports: [{ port: 3773 }] })],
      NO_CONNECTIONS,
    );
    expect(noPort[0]?.group).toBe("unavailable");
    expect(noPort[0]?.reason).toMatch(/8080/);

    const noZone = deriveZeropsCandidates(
      { ...PROJECT, publicZone: "not-a-zone" },
      [service({ id: "s1" })],
      NO_CONNECTIONS,
    );
    expect(noZone[0]?.group).toBe("unavailable");
    expect(noZone[0]?.reason).toMatch(/subdomain/i);
  });

  it("marks a container already registered as an environment as connected", () => {
    const environmentId = EnvironmentId.make("env-1");
    const connected = new Map([["https://zcp-24cb-8080.prg1.zerops.app", environmentId]]);

    const candidates = deriveZeropsCandidates(PROJECT, [service({ id: "s1" })], connected);

    expect(candidates[0]?.group).toBe("connected");
    expect(candidates[0]?.environmentId).toBe(environmentId);
  });

  it("says so when a project's services could not be read, instead of claiming there is no container", () => {
    const candidates = deriveZeropsCandidates(PROJECT, null, NO_CONNECTIONS);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.group).toBe("unavailable");
    expect(candidates[0]?.reason).toMatch(/could not be read/i);
  });
});

describe("groupZeropsCandidates", () => {
  it("buckets candidates by group and keeps their order inside each bucket", () => {
    const environmentId = EnvironmentId.make("env-1");
    const connected = new Map([["https://zcp-24cb-8080.prg1.zerops.app", environmentId]]);
    const candidates = [
      ...deriveZeropsCandidates(
        PROJECT,
        [
          service({ id: "s1" }),
          service({ id: "s2", name: "zcp2" }),
          service({ id: "s3", name: "zcp3", status: "STOPPED" }),
          service({ id: "s4", name: "zcp4", status: "STARTING" }),
        ],
        connected,
      ),
      ...deriveZeropsCandidates(
        { ...PROJECT, id: "project-2", status: "STOPPED" },
        null,
        connected,
      ),
      ...deriveZeropsCandidates(
        { ...PROJECT, id: "project-3", status: "CREATING" },
        null,
        connected,
      ),
    ];

    const grouped = groupZeropsCandidates(candidates);

    expect(grouped.connected.map((candidate) => candidate.service?.id)).toEqual(["s1"]);
    expect(grouped.ready.map((candidate) => candidate.service?.id)).toEqual(["s2"]);
    expect(
      grouped.provisioning.map((candidate) => candidate.service?.id ?? candidate.project.id),
    ).toEqual(["s4", "project-3"]);
    expect(grouped.unavailable.map((candidate) => candidate.project.id)).toEqual([
      "project-1",
      "project-2",
    ]);
  });
});
