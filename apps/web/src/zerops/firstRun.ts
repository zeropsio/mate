/**
 * An account's first run: signed in to an organization that holds no project for this person yet
 * — none listed, none on its way from a press or a New project this tab makes, none HQ lists. The
 * overview gives it the whole window (`FirstRunScreen`), and the menu, wherever else it stands
 * meanwhile, draws only what it can do there (`Sidebar`): one verdict, read by both.
 */
import { useAtomValue } from "@effect/atom-react";
import { shownHqListNavigationAtom } from "@t3tools/client-runtime/data";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import type { Shown } from "@t3tools/client-runtime/zerops/knowledge";
import { listsNoProject } from "@t3tools/client-runtime/zerops/projections";

import { useCreations } from "./creations";
import { useMatePresses } from "./matePress";
import { useZeropsCandidates } from "./useZeropsCandidates";
import { useZeropsSession } from "./ZeropsSessionProvider";

/** Whether the account lists no project yet, a creation on its way counting as one. */
export function hasNoZeropsProject(input: {
  readonly listing: Shown<ReadonlyArray<ZeropsCandidate>>;
  /**
   * A birth of this account (`zeropsBirths.ts`). The wizard navigates here the
   * moment the project exists, before the inventory lists it — painting the
   * invitation in that gap is the flash the roster then takes back.
   */
  readonly creationPending?: boolean;
}): boolean {
  if (input.creationPending === true) return false;
  return listsNoProject(input.listing);
}

/** Whether the organization on show is at its first run for this person. */
export function useAccountFirstRun(): boolean {
  const { status, organizationStatus, activeOrganization } = useZeropsSession();
  const { listing } = useZeropsCandidates();
  const presses = useMatePresses();
  const made = useCreations();
  // A project HQ holds with no Mate left in it is something: it is listed, never a first run.
  const hq = useAtomValue(shownHqListNavigationAtom);
  if (status !== "signed-in" || organizationStatus !== "selected" || activeOrganization === null)
    return false;
  const pending = [...presses, ...made].some(
    (birth) => birth.organizationId === activeOrganization.id,
  );
  return (
    hasNoZeropsProject({ listing, creationPending: pending }) &&
    (hq.structure?.apps.length ?? 0) === 0
  );
}
