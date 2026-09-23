/**
 * Which of the account's projects this client will admit, and on what terms.
 *
 * Two answers, not one (D5). A project the viewer is `BASIC_USER` or above on
 * is **open**: they connect to it, and the data runtime lets them write.
 * A project they are `READ_ONLY` on is **listed**: it stays in the tree with
 * its name and its owner, and the row says in place that it is not theirs to
 * open. Only `NO_ACCESS` drops out, because that Mate is not theirs to know
 * about at all.
 *
 * Listing what cannot be opened is the whole point: hiding it left a colleague
 * unable to tell a Mate they were not allowed into from one that did not
 * exist, and unable to name the thing they wanted access to.
 *
 * The rule itself is `mateAccess.ts` → `@t3tools/shared/zeropsRoles`, the same
 * function the Mate's door runs before it refuses.
 */
import type { ZeropsOrganization, ZeropsProject } from "@t3tools/client-runtime/zerops";
import {
  resolveMateVisibility,
  type RoleMateVisibility,
} from "@t3tools/client-runtime/zerops/mateAccess";

export function projectVisibility(
  project: ZeropsProject,
  membership: ZeropsOrganization,
): RoleMateVisibility {
  return resolveMateVisibility({
    project,
    viewer: {
      id: membership.id,
      membershipId: membership.membershipId,
      roleCode: membership.roleCode,
      canCreateProjects: membership.canCreateProjects,
    },
  });
}

export function canOperateProject(project: ZeropsProject, membership: ZeropsOrganization): boolean {
  return projectVisibility(project, membership) === "open";
}

export type OperableProjectRole = "OWNER" | "ADMIN" | "BASIC_USER" | "READ_ONLY";

export interface OperableProjectAccess {
  readonly project: ZeropsProject;
  readonly role: OperableProjectRole;
  /**
   * `open` — connect to it and write in it. `listed` — it is in the tree, its
   * row says whose it is, and nothing here may be changed.
   */
  readonly visibility: Exclude<RoleMateVisibility, "hidden">;
}

/** One project's read, classified against the viewer's membership; `null` when it is hidden. */
export function operableProjectAccess(
  project: ZeropsProject,
  membership: ZeropsOrganization,
): OperableProjectAccess | null {
  const visibility = projectVisibility(project, membership);
  if (visibility === "hidden") return null;
  const role =
    project.userRoles?.find((entry) => entry.clientUserId === membership.membershipId)?.roleCode ??
    membership.roleCode;
  if (visibility === "listed") return { project, role: "READ_ONLY", visibility };
  return role === "OWNER" || role === "ADMIN" || role === "BASIC_USER"
    ? { project, role, visibility }
    : null;
}
