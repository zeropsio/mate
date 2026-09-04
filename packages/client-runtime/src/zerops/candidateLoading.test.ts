import type { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { ZeropsProject, ZeropsService } from "./api.ts";
import {
  loadOrganizationProjects,
  loadZeropsCandidates,
  type ZeropsCandidateClient,
} from "./candidateLoading.ts";

const NO_CONNECTIONS = new Map<string, EnvironmentId>();

function activeProject(id: string): ZeropsProject {
  return {
    id,
    name: id,
    status: "ACTIVE",
    publicZone: "fte2334ab.prg1-zerops.zone",
    zeropsSubdomainHost: "24cb",
  };
}

function zcpService(id: string): ZeropsService {
  return {
    id,
    name: "zcp",
    status: "ACTIVE",
    subdomainAccess: true,
    ports: [{ port: 8080, httpSupport: true }],
    serviceStackTypeInfo: { serviceStackTypeVersionName: "zcp@1" },
  };
}

describe("loadZeropsCandidates", () => {
  it("loads candidates for one organization and for many with the same result shape", async () => {
    const projectsByOrg = new Map<string, ReadonlyArray<ZeropsProject>>([
      ["org-1", [activeProject("project-1")]],
      ["org-2", [activeProject("project-2")]],
    ]);
    const client: ZeropsCandidateClient = {
      listAccessibleClientProjects: async (organizationId) =>
        projectsByOrg.get(organizationId) ?? [],
      listProjectServices: async (projectId) => [zcpService(`${projectId}-service`)],
    };

    const single = await loadZeropsCandidates(client, {
      organizationIds: ["org-1"],
      connectedOrigins: NO_CONNECTIONS,
    });
    expect(single.candidates).toHaveLength(1);
    expect(single.candidates[0]).toMatchObject({ group: "ready" });
    expect(single.failures).toHaveLength(0);

    const many = await loadZeropsCandidates(client, {
      organizationIds: ["org-1", "org-2"],
      connectedOrigins: NO_CONNECTIONS,
    });
    expect(many.candidates).toHaveLength(2);
    expect(many.candidates.every((candidate) => candidate.group === "ready")).toBe(true);
    expect(many.failures).toHaveLength(0);
  });

  it("collects partial failures without dropping the successful projects", async () => {
    const client: ZeropsCandidateClient = {
      listAccessibleClientProjects: async (organizationId) => {
        if (organizationId === "org-b") throw new Error("forbidden");
        return [activeProject("project-a")];
      },
      listProjectServices: async (projectId) => [zcpService(`${projectId}-service`)],
    };

    const result = await loadZeropsCandidates(client, {
      organizationIds: ["org-a", "org-b"],
      connectedOrigins: NO_CONNECTIONS,
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({ project: { id: "project-a" } });
    expect(result.failures).toEqual([{ organizationId: "org-b", cause: expect.any(Error) }]);
  });

  it("caps concurrency at four", async () => {
    const releases: Array<() => void> = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const projects = Array.from({ length: 10 }, (_, index) => activeProject(`project-${index}`));
    const client: ZeropsCandidateClient = {
      listAccessibleClientProjects: async () => projects,
      listProjectServices: () =>
        new Promise<ReadonlyArray<ZeropsService>>((resolve) => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          releases.push(() => {
            inFlight -= 1;
            resolve([zcpService("service")]);
          });
        }),
    };

    const result = loadZeropsCandidates(client, {
      organizationIds: ["org-1"],
      connectedOrigins: NO_CONNECTIONS,
    });
    let settled = false;
    void result.then(() => {
      settled = true;
    });

    // Drain whatever is releasable one microtask at a time, so the shell
    // never sees more than the concurrency cap in flight at once.
    for (let tick = 0; !settled && tick < 10_000; tick += 1) {
      releases.shift()?.();
      await Promise.resolve();
    }

    await result;
    expect(maxInFlight).toBe(4);
  });
});

describe("loadOrganizationProjects", () => {
  it("keeps projects from healthy organizations when another organization fails", async () => {
    const load = async (organizationId: string) => {
      if (organizationId === "org-b") throw new Error("forbidden");
      return [activeProject("project-a")];
    };

    const result = await loadOrganizationProjects(["org-a", "org-b"], load);

    expect(result.projects.map((project) => project.id)).toEqual(["project-a"]);
    expect(result.failures).toHaveLength(1);
  });
});
