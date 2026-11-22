/**
 * An account's first run: signed in to an organization that holds no Mate for this person yet —
 * HQ lists nothing of it for them (`menuTree`'s `listsNothing`) and none is on its way from a press
 * or a New project this tab makes. The overview gives it the whole window (`FirstRunScreen`), and
 * the menu, wherever else it stands meanwhile, draws only what it can do there (`Sidebar`): one
 * verdict, read by both, moving at the same HQ frame as the menu's rows.
 */
import { useAtomValue } from "@effect/atom-react";
import type { MenuTree } from "@t3tools/client-runtime/data";
import { listsNoProject } from "@t3tools/client-runtime/zerops/projections";

import { useCreations } from "./creations";
import { useMatePresses } from "./matePress";
import { menuTreeAtom } from "./menuRows";
import { useZeropsCandidates } from "./useZeropsCandidates";
import { useZeropsSession } from "./ZeropsSessionProvider";

/** Whether the organization on show is at its first run for this person, from its inputs. */
export function accountFirstRun(input: {
  /** Where HQ's word stands, and whether it lists nothing for the person. */
  readonly menu: Pick<MenuTree, "state" | "listsNothing">;
  /** Zerops' listing of the organization is complete and holds no project (`listsNoProject`). */
  readonly listingSaysNone: boolean;
  /** A birth this tab started in the organization is on its way (a press, a New project). */
  readonly creating: boolean;
  /** The first-run screen stands for the organization now. */
  readonly standing: boolean;
}): boolean {
  // A birth of this tab: the first-run screen that pressed it carries it to the first Mate's page.
  // Anywhere else it is no first run: the wizard navigates the moment the project exists, before HQ
  // lists it, and painting the invitation in that gap is the flash HQ then takes back.
  if (input.creating) return input.standing;
  // Otherwise HQ's word alone decides, so a first run HQ takes back (access given back, a Mate
  // made elsewhere) leaves at that frame, whatever stood before.
  switch (input.menu.state) {
    case "known":
      return input.menu.listsNothing;
    // The first run paints at HQ's first answer, as the menu does.
    case "loading":
      return false;
    // Where HQ refuses or stays away, the menu lists the organization's projects as Zerops does.
    case "refused":
    case "unreachable":
      return input.listingSaysNone;
  }
}

/**
 * Whether the organization on show is at its first run for this person (`accountFirstRun`);
 * `standing`: the first-run screen stands for it now.
 */
export function useAccountFirstRun(standing = false): boolean {
  const { status, organizationStatus, activeOrganization } = useZeropsSession();
  const { listing } = useZeropsCandidates();
  const presses = useMatePresses();
  const made = useCreations();
  const menu = useAtomValue(menuTreeAtom);
  if (status !== "signed-in" || organizationStatus !== "selected" || activeOrganization === null)
    return false;
  return accountFirstRun({
    menu,
    listingSaysNone: listsNoProject(listing),
    creating: [...presses, ...made].some((birth) => birth.organizationId === activeOrganization.id),
    standing,
  });
}
