/** The visible inventory from retained platform facts, with access applied at the read. */
import type { ZeropsOrganization } from "../../zerops/api.ts";
import { organizationProjects } from "./projects.ts";
import { platformAccess } from "./platformAccess.ts";
import { sameValue } from "./equal.ts";
import type { Projection } from "../store.ts";
import { linkKeys } from "../model.ts";
import { projectsScope } from "../families/project.ts";
import type { ProjectValue } from "../families/project.ts";
import { streamTrouble } from "../streamMachine.ts";
export interface PlatformInventory {
  readonly projects: ReadonlyArray<ProjectValue>;
  readonly denied: ReadonlyArray<string>;
  readonly deleted: ReadonlyArray<string>;
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
    const deleted = new Set<string>();
    for (const projectId of read.members(projectsScope(orgId)).excluded) {
      const access = platformAccess.derive(read, { orgId, viewer, projectId });
      if (access.kind === "denied" || access.kind === "deleted") denied.add(projectId);
      if (access.kind === "deleted") deleted.add(projectId);
    }
    const projects = roster.projects.filter((project) => {
      const access = platformAccess.derive(read, { orgId, viewer, projectId: project.id });
      if (access.kind === "denied" || access.kind === "deleted") {
        denied.add(project.id);
        if (access.kind === "deleted") deleted.add(project.id);
        return false;
      }
      return access.kind === "allowed";
    });
    // A failed attempt inside its grace — a first try's, a reconnect's — is a blink, unsaid.
    const troubles = new Set(
      [read.stream(linkKeys.zerops(orgId)), read.stream(projectsScope(orgId))].map(streamTrouble),
    );
    return {
      projects,
      denied: [...denied],
      deleted: [...deleted],
      read: roster.read,
      live: roster.live,
      failure: roster.unavailableReason === undefined ? null : "Zerops isn't answering.",
      trouble:
        roster.unavailableReason !== undefined || troubles.has("stopped")
          ? "refused"
          : troubles.has("retrying")
            ? "retrying"
            : null,
    };
  },
  equals: sameValue,
};
