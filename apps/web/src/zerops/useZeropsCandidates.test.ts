import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { ZeropsProject, ZeropsService } from "@t3tools/client-runtime/zerops";
import { deriveZeropsCandidates } from "@t3tools/client-runtime/zerops/candidates";

import { authenticatedZeropsOrigins } from "./useZeropsCandidates";

const PROJECT: ZeropsProject = {
  id: "project-1",
  name: "kanban",
  status: "ACTIVE",
  publicZone: "fte2334ab.prg1-zerops.zone",
  zeropsSubdomainHost: "24cb",
};

const SERVICE: ZeropsService = {
  id: "service-1",
  name: "zcp",
  status: "ACTIVE",
  subdomainAccess: true,
  ports: [{ port: 8080, httpSupport: true }],
  serviceStackTypeInfo: { serviceStackTypeVersionName: "zcp@1" },
};

describe("authenticatedZeropsOrigins", () => {
  it("does not group a registered same-origin environment as connected until it authenticates", () => {
    const environmentId = EnvironmentId.make("environment-1");
    const registeredButRejected = authenticatedZeropsOrigins([
      {
        environmentId,
        displayUrl: "https://zcp-24cb-8080.prg1.zerops.app/z3",
        connection: { phase: "error" },
      },
    ]);

    expect(deriveZeropsCandidates(PROJECT, [SERVICE], registeredButRejected)[0]).toMatchObject({
      group: "ready",
      containerOrigin: "https://zcp-24cb-8080.prg1.zerops.app",
    });

    const authenticated = authenticatedZeropsOrigins([
      {
        environmentId,
        displayUrl: "https://zcp-24cb-8080.prg1.zerops.app/z3",
        connection: { phase: "connected" },
      },
    ]);

    expect(deriveZeropsCandidates(PROJECT, [SERVICE], authenticated)[0]).toMatchObject({
      group: "connected",
      environmentId,
    });
  });
});
