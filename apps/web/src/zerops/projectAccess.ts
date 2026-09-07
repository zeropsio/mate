import {
  ZeropsApiError,
  type ZeropsApiClient,
  type ZeropsOrganization,
  type ZeropsProject,
} from "@t3tools/client-runtime/zerops";

export function canOperateProject(project: ZeropsProject, membership: ZeropsOrganization): boolean {
  if (project.clientId !== membership.id) return false;
  if (project.userRoles?.length && !membership.membershipId) return false;
  const role =
    project.userRoles?.find((entry) => entry.clientUserId === membership.membershipId)?.roleCode ??
    membership.roleCode;
  return role === "OWNER" || role === "ADMIN" || role === "BASIC_USER";
}

/** Verify per-project overrides and handle deletion/access loss between list
 * and detail. A transient detail failure invalidates the read, not the project. */
export async function loadOperableProjects(
  client: Pick<ZeropsApiClient, "listAccessibleClientProjects" | "fetchProject">,
  membership: ZeropsOrganization,
): Promise<ReadonlyArray<ZeropsProject>> {
  const listed = await client.listAccessibleClientProjects(membership.id);
  const projects: Array<ZeropsProject | null> = new Array(listed.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, listed.length) }, async () => {
      while (cursor < listed.length) {
        const index = cursor++;
        try {
          const project = await client.fetchProject(listed[index]!.id);
          projects[index] = canOperateProject(project, membership) ? project : null;
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
  return projects.filter((project): project is ZeropsProject => project !== null);
}
