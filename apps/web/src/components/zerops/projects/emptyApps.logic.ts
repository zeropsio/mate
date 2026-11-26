/** The registry's empty applications, empty groups and the Overview Delete offer. */
import type { CanonicalGroup } from "@t3tools/client-runtime/zerops";
import type { HqStructure } from "@t3tools/client-runtime/zerops/hq";
import type { HqOfferState } from "@t3tools/shared/hqOffers";

import type { HqNavigationView } from "~/state/zerops";

import { groupWithoutMate, projectDeleteOffered } from "@t3tools/client-runtime/zerops";

/** HQ's applications needing a row without a listed project, including unfinished deletion. */
export function emptyApplications(
  view: Pick<HqNavigationView, "orgId"> & {
    readonly structure: {
      readonly apps: ReadonlyArray<
        Pick<HqStructure["apps"][number], "id" | "name" | "projects" | "contents">
      >;
    } | null;
  },
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
export function groupIsEmpty(
  group: Pick<CanonicalGroup, "pending"> & { readonly environments: ReadonlyArray<unknown> },
): boolean {
  return group.environments.length === 0 && group.pending.length === 0;
}

/** Overview draws the menu's Delete while HQ's offer is still unknown, but cannot press it. */
export function projectDeleteOnOverview(
  group: Parameters<typeof groupWithoutMate>[0],
  offer: HqOfferState["kind"],
): "pressable" | "waits" | undefined {
  if (
    !projectDeleteOffered({ withoutMate: groupWithoutMate(group), mayDelete: offer !== "refused" })
  )
    return undefined;
  return offer === "allowed" ? "pressable" : "waits";
}
