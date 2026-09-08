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

export interface OperableProjectAccess {
  readonly project: ZeropsProject;
  readonly role: "OWNER" | "ADMIN" | "BASIC_USER";
}

function operableRole(
  project: ZeropsProject,
  membership: ZeropsOrganization,
): OperableProjectAccess["role"] | null {
  if (!canOperateProject(project, membership)) return null;
  if (project.userRoles?.length && !membership.membershipId) return null;
  const role =
    project.userRoles?.find((entry) => entry.clientUserId === membership.membershipId)?.roleCode ??
    membership.roleCode;
  return role === "OWNER" || role === "ADMIN" || role === "BASIC_USER" ? role : null;
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
          const role = operableRole(project, membership);
          projects[index] = role === null ? null : { project, role };
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
