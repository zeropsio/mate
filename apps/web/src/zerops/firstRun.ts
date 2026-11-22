/**
 * An account's first run: signed in to an organization that holds no Mate for this person yet —
 * HQ lists nothing of it for them (`menuTree`'s `listsNothing`) and none is on its way from a press
 * or a New project this tab makes. The overview gives it the whole window (`FirstRunScreen`), and
 * the menu, wherever else it stands meanwhile, draws only what it can do there (`Sidebar`): one
 * verdict, read by both, moving at the same HQ frame as the menu's rows.
 */
import { useAtomValue } from "@effect/atom-react";
import { listsNoProject } from "@t3tools/client-runtime/zerops/projections";

import { useCreations } from "./creations";
import { useMatePresses } from "./matePress";
import { menuTreeAtom } from "./menuRows";
import { useZeropsCandidates } from "./useZeropsCandidates";
import { useZeropsSession } from "./ZeropsSessionProvider";

/** Whether the organization on show is at its first run for this person. */
export function useAccountFirstRun(): boolean {
  const { status, organizationStatus, activeOrganization } = useZeropsSession();
  const { listing } = useZeropsCandidates();
  const presses = useMatePresses();
  const made = useCreations();
  const menu = useAtomValue(menuTreeAtom);
  if (status !== "signed-in" || organizationStatus !== "selected" || activeOrganization === null)
    return false;
  // A birth of this account (`zeropsBirths.ts`): the wizard navigates here the moment the project
  // exists, before HQ lists it — painting the invitation in that gap is the flash HQ then takes back.
  if ([...presses, ...made].some((birth) => birth.organizationId === activeOrganization.id))
    return false;
  switch (menu.state) {
    case "known":
      return menu.listsNothing;
    // The first run paints at HQ's first answer, as the menu does.
    case "loading":
      return false;
    // Where HQ refuses or stays away, the menu lists the organization's projects as Zerops does.
    case "refused":
    case "unreachable":
      return listsNoProject(listing);
  }
}
