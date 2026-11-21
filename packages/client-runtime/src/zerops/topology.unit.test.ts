import { expect, it } from "vite-plus/test";

import type { ZeropsProject } from "./api/project.ts";
import type { ZeropsService } from "./api/service.ts";
import { projectTopology } from "./topology.ts";

const project: ZeropsProject = { id: "p1", name: "weather", status: "ACTIVE" };

const service = (
  name: string,
  type: string,
  category: string,
  sent: Partial<ZeropsService> = {},
): ZeropsService => ({
  id: name,
  name,
  status: "ACTIVE",
  serviceStackTypeInfo: { serviceStackTypeCategory: category },
  base: type,
  ...sent,
});

// witness: packages/client-runtime/src/zerops/topology.ts | if (isZcpServiceType(typeVersion) || isPoolOrSandboxServiceType(typeVersion)) { → if (isZcpServiceType(typeVersion)) {
it("ZV129: System services are left out of a project's topology but zcp never is; pools and Box count as infrastructure", () => {
  const view = projectTopology(
    project,
    [
      service("core", "core@2", "SYSTEM", { isSystem: true }),
      service("zcp", "zcp@1", "USER"),
      service("apppool", "swarm@1", "USER"),
      service("box", "ubuntu/zbox@1", "STANDARD"),
      service("app", "nodejs@22", "USER"),
      service("db", "postgresql@16", "STANDARD"),
    ],
    [],
  );
  expect(view.services.map((row) => [row.hostname, row.group])).toEqual([
    ["zcp", "infrastructure"],
    ["apppool", "infrastructure"],
    ["box", "infrastructure"],
    ["app", "runtimes"],
    ["db", "data"],
  ]);
});
