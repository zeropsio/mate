import { EnvironmentId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import type { ZeropsProject } from "./api/project.ts";
import type { ZeropsService } from "./api/service.ts";
import { deriveZeropsCandidates } from "./candidates.ts";

const project: ZeropsProject = {
  id: "project-1",
  name: "kanban",
  status: "ACTIVE",
  clientId: "org-1",
  publicZone: "fte2334ab.prg1-zerops.zone",
  zeropsSubdomainHost: "24cb",
};

const service = (id: string, name: string, type: string): ZeropsService => ({
  id,
  name,
  status: "ACTIVE",
  subdomainAccess: true,
  ports: [{ port: 8080, httpSupport: true }],
  base: type,
});

// witness: packages/client-runtime/src/zerops/candidates.ts | const containers = services.filter(isZcpService); → const containers = services.filter((service) => service.name === "zcp");
it("ZV118: zcp is found by its service type, never by its name, and every zcp container is offered", () => {
  const candidates = deriveZeropsCandidates(
    project,
    [
      service("s1", "workspace", "zcp@1"),
      service("s2", "agent", "zcp@1"),
      service("s3", "zcp", "nodejs@22"),
    ],
    new Map<string, EnvironmentId>(),
  );
  expect(candidates.map((candidate) => candidate.service?.id)).toEqual(["s1", "s2"]);
});
