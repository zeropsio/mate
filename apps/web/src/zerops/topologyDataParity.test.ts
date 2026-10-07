import type { ZeropsService } from "@t3tools/client-runtime/zerops";
import { projectTopology } from "@t3tools/client-runtime/zerops/topology";
import {
  derivePublicRoutes,
  derivePublicRouteOffers,
  summarizeEnvironmentServices,
} from "@t3tools/client-runtime/zerops";
import { describe, expect, it } from "vite-plus/test";

import { project } from "./__fixtures__/platformData";
import { inventoryTopology } from "@t3tools/client-runtime/data";
import { AtomRegistry } from "effect/unstable/reactivity";
import { mountRoster } from "@t3tools/client-runtime/zerops/testing";

const owner = project();
const projectDto = {
  id: owner.projectId,
  clientId: owner.organization.organizationId,
  name: "Original topology",
  status: "ACTIVE",
  publicZone: "fte2334ab.prg1-zerops.zone",
  zeropsSubdomainHost: "project",
  tagList: ["custom", "mate:agent:Pia"],
  description: "Preserve user description",
  mode: "LIGHT",
};
const services: ReadonlyArray<ZeropsService> = [
  {
    id: "core",
    name: "core",
    status: "ACTIVE",
    isSystem: true,
    subdomainAccess: true,
    ports: [{ port: 8080, scheme: "http", protocol: "TCP" }],
    serviceStackTypeInfo: {
      serviceStackTypeVersionName: "core@2",
      serviceStackTypeCategory: "SYSTEM",
    },
  },
  {
    id: "zcp",
    name: "zcp",
    status: "ACTIVE",
    isSystem: false,
    subdomainAccess: true,
    ports: [{ port: 8080, scheme: "http", protocol: "TCP" }],
    serviceStackTypeInfo: {
      serviceStackTypeVersionName: "zcp@1",
      serviceStackTypeCategory: "USER",
    },
  },
  {
    id: "app",
    name: "weatherapp",
    status: "ACTIVE",
    isSystem: false,
    versionNumber: "v22.22.3",
    created: "2026-09-01T09:00:00Z",
    lastUpdate: "2026-09-08T09:00:00Z",
    serviceStackTypeInfo: {
      serviceStackTypeVersionName: "nodejs@22",
      serviceStackTypeName: "Node.js 22",
      serviceStackTypeCategory: "USER",
    },
    subdomainAccess: true,
    ports: [{ port: 3000, protocol: "TCP", scheme: "http", httpSupport: true }],
    activeAppVersion: {
      source: "GIT",
      created: "2026-09-07T09:00:00Z",
      lastUpdate: "2026-09-08T09:00:00Z",
      name: "Weather",
      gitlabIntegration: {
        branchName: "main",
        commit: "abc123",
        repositoryFullName: "team/weather",
      },
    },
    currentAutoscaling: {
      verticalAutoscaling: {
        minResource: { cpuCoreCount: 1, memoryGBytes: 0.25, diskGBytes: 1 },
        maxResource: { cpuCoreCount: 4, memoryGBytes: 4, diskGBytes: 10 },
        cpuMode: "SHARED",
      },
      horizontalAutoscaling: { minContainerCount: 1, maxContainerCount: 2 },
    },
  },
];

function fixture() {
  let rows = services.map((row) => ({ ...row, projectId: owner.projectId }));
  const listed = () => ({ services: rows, live: true, reconnecting: false });
  const pushed = (row: Partial<ZeropsService> & { readonly id: string }) => {
    rows = rows.map((held) => (held.id === row.id ? { ...held, ...row } : held));
  };
  const snapshot = () => {
    const registry = AtomRegistry.make();
    const store = mountRoster(registry, owner.organization.organizationId, [projectDto], {
      services: rows,
    });
    const result = registry.get(
      store.data.project(inventoryTopology, {
        orgId: owner.organization.organizationId,
        projectId: owner.projectId,
        viewer: {
          id: owner.organization.organizationId,
          name: "Org",
          membershipId: "member",
          roleCode: "ADMIN",
        },
      }),
    ).view!;
    registry.dispose();
    return result;
  };
  return { snapshot, listed, pushed };
}

describe("original topology behavior through the central data pipeline", () => {
  it("preserves project tags and presentation plus public routes, offers and environment summaries", () => {
    const f = fixture();
    const readDtos = () => f.listed().services;
    const dtos = readDtos();
    expect(derivePublicRoutes(projectDto, dtos)).toHaveLength(1);
    expect(derivePublicRoutes(projectDto, dtos)).toEqual(derivePublicRoutes(projectDto, services));
    expect(derivePublicRouteOffers(dtos)).toEqual(derivePublicRouteOffers(services));
    expect(summarizeEnvironmentServices(dtos)).toEqual(summarizeEnvironmentServices(services));
    for (const { id } of services) f.pushed({ id, subdomainAccess: false });
    expect(derivePublicRoutes(projectDto, readDtos())).toEqual([]);
    expect(derivePublicRouteOffers(readDtos())).toEqual([
      { service: "weatherapp", serviceId: "app", port: 3000 },
    ]);
  });
  it("hides system services even after a row update, without hiding zcp", () => {
    const f = fixture();
    f.pushed({ id: "core", name: "core", status: "ACTIVE" });
    expect(
      f
        .snapshot()
        .services.map((row) => row.serviceId)
        .toSorted(),
    ).toEqual(["app", "zcp"]);
  });

  it("preserves runtime version, deploy activation, routes and autoscaling", () => {
    const f = fixture();
    expect(f.snapshot().services.find((row) => row.serviceId === "app")).toEqual(
      projectTopology(projectDto, services, []).services.find((row) => row.serviceId === "app"),
    );
  });
});
