/**
 * An account's first run: signed in to an organization that holds no Mate for this person yet —
 * no project listed but those only Platform holds, none on its way from a press or a New project
 * this tab makes, none HQ lists. The overview gives it the whole window (`FirstRunScreen`), and the
 * menu, wherever else it stands meanwhile, draws only what it can do there (`Sidebar`): one
 * verdict, read by both.
 */
import { useAtomValue } from "@effect/atom-react";
import { shownHqListNavigationAtom } from "@t3tools/client-runtime/data";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import type { Shown } from "@t3tools/client-runtime/zerops/knowledge";
import { listsNoProject } from "@t3tools/client-runtime/zerops/projections";

import { useCreations } from "./creations";
import { useMatePresses } from "./matePress";
import { hqPlacementKnownAtom, isPlatformProject } from "./platformProjects";
import { useZeropsCandidates } from "./useZeropsCandidates";
import { useZeropsSession } from "./ZeropsSessionProvider";

/** Whether the account lists no project of Mate's yet, a creation on its way counting as one. */
export function hasNoZeropsProject(input: {
  readonly listing: Shown<ReadonlyArray<ZeropsCandidate>>;
  /**
   * HQ's placements are read (`hqPlacementKnownAtom`). A project only Platform holds is no Mate
   * (`isPlatformProject`), so a person with only those is at their first run too (the owner,
   * 2026-11-20: "just do first run when there isnt any mate"); until HQ's word is read, none is.
   */
  readonly placementKnown: boolean;
  /**
   * A birth of this account (`zeropsBirths.ts`). The wizard navigates here the
   * moment the project exists, before the inventory lists it — painting the
   * invitation in that gap is the flash the roster then takes back.
   */
  readonly creationPending?: boolean;
}): boolean {
  if (input.creationPending === true) return false;
  const { placementKnown } = input;
  return listsNoProject(input.listing, (candidate) =>
    isPlatformProject(candidate.project, { placementKnown, active: false }),
  );
}

/** Whether the organization on show is at its first run for this person. */
export function useAccountFirstRun(): boolean {
  const { status, organizationStatus, activeOrganization } = useZeropsSession();
  const { listing } = useZeropsCandidates();
  const presses = useMatePresses();
  const made = useCreations();
  // A project HQ holds with no Mate left in it is something: it is listed, never a first run.
  const hq = useAtomValue(shownHqListNavigationAtom);
  const placementKnown = useAtomValue(hqPlacementKnownAtom);
  if (status !== "signed-in" || organizationStatus !== "selected" || activeOrganization === null)
    return false;
  const pending = [...presses, ...made].some(
    (birth) => birth.organizationId === activeOrganization.id,
  );
  return (
    hasNoZeropsProject({ listing, creationPending: pending, placementKnown }) &&
    (hq.structure?.apps.length ?? 0) === 0
  );
}
