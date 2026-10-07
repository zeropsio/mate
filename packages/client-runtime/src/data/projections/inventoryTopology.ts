/** The project's topology join, including access and sampled resource coverage. */
import { projectTopology, type ZeropsTopologyView } from "../../zerops/topology.ts";
import type { ZeropsService } from "../../zerops/api.ts";
import type { ActivityProcess } from "../../zerops/activity/dto.ts";
import type { Projection } from "../store.ts";
import type { ProjectValue } from "../families/project.ts";
import { usageOwnerOf } from "../families/usage.ts";
import { projectServices, type ProjectServices } from "./services.ts";
import { projectUsage, type ProjectUsage } from "./usage.ts";
import { listedProject } from "./projects.ts";
import { projectProcesses } from "./processes.ts";
import { platformAccess, type PlatformAccessKey } from "./platformAccess.ts";
import { sameValue } from "./equal.ts";
export type ProjectTopologyLiveness = "live" | "recovering";

export interface ProjectTopologySnapshot {
  readonly view: ZeropsTopologyView | undefined;
  readonly liveness: ProjectTopologyLiveness | undefined;
  readonly lastReadAt: number | undefined;
  readonly error: string | undefined;
}

export const EMPTY_PROJECT_TOPOLOGY_SNAPSHOT: ProjectTopologySnapshot = {
  view: undefined,
  liveness: undefined,
  lastReadAt: undefined,
  error: undefined,
};

function projectTopologySnapshotFromRead(
  /** The project as the account's store lists it; `null` while it does not. */
  project: ProjectValue | null,
  topology: ProjectServices,
  /** What runs in the project now, as the account's store holds it (`projectProcesses`). */
  running: ReadonlyArray<ActivityProcess>,
  /** The project's resources, as the account's store holds them while the panel shows them. */
  usage: ProjectUsage,
): ProjectTopologySnapshot {
  const error =
    topology.unavailableReason === undefined ? usage.failure : "Zerops refused the services list.";
  const liveness: ProjectTopologyLiveness = topology.live ? "live" : "recovering";
  if (project === null || topology.services === undefined)
    return { view: undefined, liveness, lastReadAt: undefined, error };
  const services: ReadonlyArray<ZeropsService> = topology.services;
  const processes = running;
  const base = projectTopology(project, services, processes, undefined, usage.history);
  const rows = base.services.map((row) => {
    const used = usage.byService[row.serviceId];
    return used === undefined ? row : { ...row, usage: used };
  });
  return {
    view: { ...base, services: rows, usageRead: usage.read },
    liveness,
    lastReadAt: undefined,
    error,
  };
}

export const inventoryTopology: Projection<PlatformAccessKey, ProjectTopologySnapshot> = {
  name: "inventoryTopology",
  keyOf: (key) => JSON.stringify(key),
  derive: (read, key) => {
    if (platformAccess.derive(read, key).kind !== "allowed") return EMPTY_PROJECT_TOPOLOGY_SNAPSHOT;
    return projectTopologySnapshotFromRead(
      listedProject.derive(read, key),
      projectServices.derive(read, key),
      projectProcesses.derive(read, key).running,
      projectUsage.derive(read, {
        orgId: key.orgId,
        owner: usageOwnerOf(key.orgId, key.projectId),
      }),
    );
  },
  equals: sameValue,
};
