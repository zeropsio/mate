/**
 * The projects page's applications with nothing in them: one HQ holds with no project — what a New
 * project that stopped before its Mate leaves (`mate-rig-e2e-a`, 2026-10-02) — is drawn as its
 * project all the same (`deriveZeropsGroups`'s `apps`), offered *Add a Mate* for the Mate it was
 * made for. It cannot be removed yet: HQ has no way to delete an application (TICKETS).
 */
import type { ZeropsGroup } from "@t3tools/client-runtime/zerops";

import type { HqStructureView } from "~/state/zerops";

/** HQ's applications with no project, by id and name, in the organization in view. */
export function emptyApplications(
  view: HqStructureView | null,
  organizationId: string | undefined,
): ReadonlyArray<{ readonly id: string; readonly name: string }> {
  if (view === null || view.structure === null || view.organizationId !== organizationId) return [];
  return view.structure.apps
    .filter((app) => app.projects.length === 0)
    .map((app) => ({ id: app.id, name: app.name }));
}

/** Whether a group holds nothing, listed or coming: offered *Add a Mate* for its first, and no more. */
export function groupIsEmpty(group: Pick<ZeropsGroup, "environments" | "pending">): boolean {
  return group.environments.length === 0 && group.pending.length === 0;
}
