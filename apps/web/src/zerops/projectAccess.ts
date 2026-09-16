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
import {
  ZeropsApiError,
  type ZeropsApiClient,
  type ZeropsOrganization,
  type ZeropsProject,
} from "@t3tools/client-runtime/zerops";
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

function projectAccess(
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

/** Access verification reads are admission evidence only; platform records are
 * published exclusively by ZeropsDataRuntime. */
export async function verifyOperableProjects(
  client: Pick<ZeropsApiClient, "listAccessibleClientProjects" | "fetchProject">,
  membership: ZeropsOrganization,
  previouslyVerified: ReadonlyArray<Pick<ZeropsProject, "id" | "clientId">> = [],
): Promise<ReadonlyArray<OperableProjectAccess>> {
  const listed = await client.listAccessibleClientProjects(membership.id);
  const targets = [
    ...new Map(
      [
        ...listed,
        ...previouslyVerified.filter((project) => project.clientId === membership.id),
      ].map((project) => [project.id, project]),
    ).values(),
  ];
  const projects: Array<OperableProjectAccess | null> = new Array(targets.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, targets.length) }, async () => {
      while (cursor < targets.length) {
        const index = cursor++;
        try {
          const project = await client.fetchProject(targets[index]!.id);
          projects[index] = projectAccess(project, membership);
        } catch (cause) {
          if (
            !(cause instanceof ZeropsApiError) ||
            !["forbidden", "not-found"].includes(cause.kind)
          )
            throw cause;
          projects[index] = null;
        }
      }
    }),
  );
  return projects.filter((project): project is OperableProjectAccess => project !== null);
}
