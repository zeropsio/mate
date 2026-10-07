/** The visible inventory from retained platform facts, with access applied at the read. */
import type { ZeropsOrganization } from "../../zerops/api.ts";
import { organizationProjects } from "./projects.ts";
import { platformAccess } from "./platformAccess.ts";
import { sameValue } from "./equal.ts";
import type { Projection } from "../store.ts";
import { linkKeys } from "../model.ts";
import { projectsScope } from "../families/project.ts";
import type { ProjectValue } from "../families/project.ts";
export interface PlatformInventory {
  readonly projects: ReadonlyArray<ProjectValue>;
  readonly denied: ReadonlyArray<string>;
  readonly read: "unread" | "reading" | "read";
  readonly live: boolean;
  readonly failure: string | null;
  readonly trouble: "retrying" | "refused" | null;
}
export const platformInventory: Projection<
  { readonly orgId: string; readonly viewer: ZeropsOrganization | undefined },
  PlatformInventory
> = {
  name: "platformInventory",
  keyOf: (key) => JSON.stringify(key),
  derive: (read, { orgId, viewer }) => {
    const roster = organizationProjects.derive(read, orgId);
    const denied = new Set<string>();
    for (const projectId of read.members(projectsScope(orgId)).excluded) {
      const access = platformAccess.derive(read, { orgId, viewer, projectId });
      if (access.kind === "denied" || access.kind === "deleted") denied.add(projectId);
    }
    const projects = roster.projects.filter((project) => {
      const access = platformAccess.derive(read, { orgId, viewer, projectId: project.id });
      if (access.kind === "denied" || access.kind === "deleted") {
        denied.add(project.id);
        return false;
      }
      return access.kind === "allowed";
    });
    const link = read.stream(linkKeys.zerops(orgId));
    const scope = read.stream(projectsScope(orgId));
    const failedRecovery =
      (link.failures > 0 && link.phase !== "live") ||
      (scope.failures > 0 && scope.phase !== "live");
    return {
      projects,
      denied: [...denied],
      read: roster.read,
      live: roster.live,
      failure: roster.unavailableReason === undefined ? null : "Zerops isn't answering.",
      trouble:
        roster.unavailableReason !== undefined ? "refused" : failedRecovery ? "retrying" : null,
    };
  },
  equals: sameValue,
};
