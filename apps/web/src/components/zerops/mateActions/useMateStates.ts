/**
 * The one assembler of a Mate's facts (`mateState`) from what the account holds: its listing row,
 * its container's level, its arrival (a shared birth's coming carries it) or press, this tab's delete, HQ's placement and offers, and the
 * person's role and visibility. The menu and the Mate's page read each Mate's state through it.
 */
import { useAtomValue } from "@effect/atom-react";
import { shownMateVisibilitiesAtom } from "@t3tools/client-runtime/data";
import { resolveMateProjectRole } from "@t3tools/client-runtime/zerops/mateAccess";
import {
  mateArrivalOf,
  mateState,
  type MateContainerLevel,
  type MateState,
} from "@t3tools/client-runtime/zerops/mateState";
import { heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import { handsOverMates } from "@t3tools/shared/zeropsRoles";
import { useCallback, useMemo } from "react";

import { useDeletingMates } from "~/zerops/deletingMates";
import { useMatePresses } from "~/zerops/matePress";
import { hqPlacementKnownAtom } from "~/zerops/platformProjects";
import { useMateOffers } from "~/zerops/useHqOffers";
import { useMateComingOf } from "~/zerops/useMenuMateReadings";
import {
  useZeropsDetailCandidates,
  type ZeropsCandidatePresentation,
} from "~/zerops/useZeropsCandidates";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";

/** Each Mate's state, from its container levels by target key (`useZeropsContainers().levels`). */
export function useMateStates(
  levels: ReadonlyMap<string, MateContainerLevel>,
): (candidate: ZeropsCandidatePresentation) => MateState {
  const { activeOrganization, user } = useZeropsSession();
  const { listing } = useZeropsDetailCandidates();
  const candidates = useMemo(() => heldCandidates(listing).rows, [listing]);
  const comingOf = useMateComingOf(candidates);
  const presses = useMatePresses();
  const deleting = useDeletingMates();
  const placementKnown = useAtomValue(hqPlacementKnownAtom);
  const offersOf = useMateOffers();
  // Each Mate's visibility for the person, as the account reads it from live Zerops data
  // (`mateVisibility`); one not judged yet is absent.
  const visibilities = useAtomValue(
    shownMateVisibilitiesAtom(candidates.map((candidate) => candidate.project.id).join(",")),
  );
  const viewer = useMemo(
    () =>
      activeOrganization === null || user === null
        ? null
        : {
            id: activeOrganization.id,
            membershipId: activeOrganization.membershipId,
            roleCode: activeOrganization.roleCode,
            canCreateProjects: activeOrganization.canCreateProjects,
          },
    [activeOrganization, user],
  );
  return useCallback(
    (candidate) => {
      const projectId = candidate.project.id;
      return mateState({
        candidate,
        level: levels.get(candidate.key),
        arrival: mateArrivalOf(comingOf(candidate)),
        pressed: presses.some((press) => press.projectId === projectId),
        deleteAsked: deleting.has(projectId),
        placementKnown,
        viewer:
          viewer === null
            ? null
            : {
                role: resolveMateProjectRole({ project: candidate.project, viewer }),
                visibility: visibilities[projectId],
                offers: offersOf(projectId),
                handsOver: handsOverMates(viewer),
              },
      });
    },
    [comingOf, deleting, levels, offersOf, placementKnown, presses, viewer, visibilities],
  );
}
