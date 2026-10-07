/** Current container status and latest lifecycle evidence for the open web Mate. */
import type { ActivityProcess } from "../../zerops/activity/dto.ts";
import type { Projection } from "../store.ts";
import { usageOwnerOf, usageScope } from "../families/usage.ts";
import { sameValue } from "./equal.ts";
import { projectProcesses, type ProjectKey } from "./processes.ts";
import { projectStanding, type ProjectStanding } from "./projects.ts";

export interface MateRecovery {
  readonly standing: ProjectStanding;
  readonly status: string | undefined;
  readonly process: ActivityProcess | undefined;
  readonly diskFull?: boolean;
}
export const mateRecovery: Projection<
  ProjectKey & { readonly serviceId: string | undefined },
  MateRecovery
> = {
  name: "mateRecovery",
  keyOf: ({ orgId, projectId, serviceId }) => `${orgId}/${projectId}/${serviceId ?? ""}`,
  derive: (read, key) => {
    const standing = projectStanding.derive(read, key);
    if (standing.kind === "denied" || standing.kind === "deleted")
      return { standing, status: undefined, process: undefined };
    const service = key.serviceId === undefined ? undefined : read.fact("service", key.serviceId);
    const processes = projectProcesses.derive(read, key).processes;
    const process = processes?.find(
      (process) =>
        key.serviceId !== undefined &&
        process.serviceStackIds.includes(key.serviceId) &&
        ["stack.restart", "stack.start", "stack.stop", "stack.deploy", "stack.create"].includes(
          process.actionName,
        ),
    );
    const usage = usageScope(key.orgId, usageOwnerOf(key.orgId, key.projectId));
    const diskFull = read.members(usage).ids.some((id) => {
      const fact = read.fact("usage", id);
      if (fact.kind !== "known" || fact.value.serviceId !== key.serviceId) return false;
      const disk = fact.value.diskGBytes;
      return disk !== null && disk.limit > 0 && disk.used >= disk.limit;
    });
    return {
      standing,
      status:
        standing.kind === "listed" && standing.project.status === "STOPPED"
          ? "STOPPED"
          : service?.kind === "known"
            ? service.value.status
            : undefined,
      process,
      diskFull,
    };
  },
  equals: sameValue,
};
