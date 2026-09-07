import type { ZeropsProject } from "@t3tools/client-runtime/zerops";

/** A failed organization read retains only that scope's last verified list.
 * Successful scopes still establish removals, even while a different scope is offline. */
export function reconcileInventoryProjects(
  previous: ReadonlyArray<ZeropsProject>,
  current: ReadonlyArray<ZeropsProject>,
  failedOrganizationIds: ReadonlySet<string>,
): ReadonlyArray<ZeropsProject> {
  const currentIds = new Set(current.map((project) => project.id));
  return [
    ...current,
    ...previous.filter(
      (project) =>
        project.clientId !== undefined &&
        failedOrganizationIds.has(project.clientId) &&
        !currentIds.has(project.id),
    ),
  ];
}
