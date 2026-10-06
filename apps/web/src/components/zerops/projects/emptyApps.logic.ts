/**
 * The projects page's applications with nothing in them: one HQ holds with no project — what a New
 * project that stopped before its Mate leaves (`mate-rig-e2e-a`, 2026-10-02) — is drawn as its
 * project all the same (`deriveZeropsGroups`'s `apps`), offered *Add a Mate* for the Mate it was
 * made for, and to whoever writes the structure *Delete* (`deleteOffered`).
 */
import type { ZeropsGroup } from "@t3tools/client-runtime/zerops";
import type { HqAppContents } from "@t3tools/client-runtime/zerops/hq";

import type { HqNavigationView } from "~/state/zerops";

/** HQ's applications needing a row without a listed project, including unfinished deletion. */
export function emptyApplications(
  view: HqNavigationView,
  organizationId: string | undefined,
): ReadonlyArray<{ readonly id: string; readonly name: string }> {
  if (view.structure === null || view.orgId !== organizationId) return [];
  return view.structure.apps
    .filter(
      (app) => app.projects.length === 0 || (app.contents?.deletingProjectIds.length ?? 0) > 0,
    )
    .map((app) => ({ id: app.id, name: app.name }));
}

/** Whether a group holds nothing, listed or coming: offered *Add a Mate* for its first, and no more. */
export function groupIsEmpty(group: Pick<ZeropsGroup, "environments" | "pending">): boolean {
  return group.environments.length === 0 && group.pending.length === 0;
}

/** Only HQ's current answer for this organization and application can establish emptiness. */
export function applicationContents(
  view: HqNavigationView,
  organizationId: string | undefined,
  appId: string,
): HqAppContents | undefined {
  if (view.orgId !== organizationId || !view.live) return undefined;
  return view.structure?.apps.find((app) => app.id === appId)?.contents;
}

/** An empty projected Mates cell still names the records HQ has not released. */
export function emptyMateLine(contents: HqAppContents | undefined): string {
  if (contents === undefined) return "Checking what HQ holds…";
  if (contents.deletingProjectIds.length > 0) return "Deletion is still in progress.";
  return contents.empty ? "No Mate yet" : "HQ still holds this project's records.";
}

/**
 * What HQ still holds of a project, on its row beside its name: a deletion under way, or records
 * held where no Mate is left. Nothing where HQ holds nothing, or has not answered for it.
 */
export function heldLine(mates: number, contents: HqAppContents | undefined): string | undefined {
  if (contents === undefined) return undefined;
  if (contents.deletingProjectIds.length > 0 || (mates === 0 && !contents.empty))
    return emptyMateLine(contents);
  return undefined;
}

/**
 * Whether a project's menu offers *Delete*: HQ says it holds nothing, no listed or coming member
 * disagrees, and the person writes the structure (`delete_app`).
 */
export function deleteOffered(
  group: Pick<ZeropsGroup, "environments" | "pending">,
  mayDelete: boolean,
  contents: HqAppContents | undefined,
): boolean {
  return mayDelete && groupIsEmpty(group) && contents?.empty === true;
}
