/**
 * What the person may do with an application's changes, by HQ's rule over the facts the client
 * holds (`changeOffers`): the session's membership, the projects the inventory lists with their
 * grants — a stage's counts as much as a Mate's — and the projects HQ places in the application.
 * One function for every application, so a screen listing several asks it per row.
 */
import { useAtomValue } from "@effect/atom-react";
import {
  changeOffers,
  changeMergePermission,
  mayOffer,
  offerAsker,
  releasePermission,
  type ReleaseGate,
} from "@t3tools/client-runtime/zerops";
import { hqRefusalWords } from "@t3tools/client-runtime/zerops/hq";
import { useCallback, useContext, useMemo } from "react";

import { hqPlacementsAtom } from "../state/zerops";
import { InventoryContext } from "./inventoryContext";
import { sessionOfferViewer } from "./offerViewer";
import { useZeropsSessionOptional } from "./sessionContext";

export type ZeropsChangeOffers = ReturnType<typeof changeOffers> & {
  readonly reason?: string;
  readonly again?: (() => void) | undefined;
};

/**
 * An application's offers by its id; `undefined` while HQ has not said where it places the
 * projects. Listed identities retain the organization role; held grants authorize while services load.
 */
export type ZeropsChangeOffersOf = (appId: string) => ZeropsChangeOffers | undefined;

/** Who asks, by the session's membership and the projects the inventory lists; `undefined` before. */
type OfferProject = {
  readonly id: string;
  readonly userRoles?:
    | ReadonlyArray<{ readonly clientUserId: string; readonly roleCode: string }>
    | undefined;
};
const NO_PROJECTS: ReadonlyArray<OfferProject> = [];

function useOfferAsker(verified: ReadonlyArray<OfferProject> = NO_PROJECTS) {
  const session = useZeropsSessionOptional();
  const inventory = useContext(InventoryContext);
  const user = session?.user;
  const organization = session?.activeOrganization ?? null;
  const projects =
    inventory === null || inventory.account?.kind === "withheld" ? undefined : inventory.projects;
  return useMemo(
    () =>
      projects === undefined
        ? undefined
        : offerAsker(sessionOfferViewer(user, organization), [
            ...new Map([...projects, ...verified].map((project) => [project.id, project])).values(),
          ]),
    [organization, projects, user, verified],
  );
}

export function useChangeOffers(
  verified: ReadonlyArray<OfferProject> = NO_PROJECTS,
): ZeropsChangeOffersOf {
  const placements = useAtomValue(hqPlacementsAtom);
  const asker = useOfferAsker(verified);
  return useCallback(
    (appId) => {
      if (asker === undefined || placements === null) return undefined;
      const offers = changeOffers(asker, placements, appId);
      const decision = changeMergePermission(asker, placements, appId);
      return decision?.allowed === false
        ? { ...offers, reason: hqRefusalWords({ code: "forbidden", reason: decision.reason }) }
        : offers;
    },
    [asker, placements],
  );
}

/**
 * Whether HQ's rule lets the person keep a project's deploy key (`keep_deploy_token`), by the
 * project's id; `undefined` while the projects are not listed yet.
 */
export function useKeepDeployKeyOffer(): (projectId: string) => boolean | undefined {
  const asker = useOfferAsker();
  return useCallback(
    (projectId) =>
      asker === undefined ? undefined : mayOffer(asker, "keep_deploy_token", { projectId }),
    [asker],
  );
}

/**
 * Whether HQ's rule lets the person release an application's production (`releasePermission`),
 * its refusal in HQ's words, by the application's id; `undefined` while HQ has not said where it
 * places the projects, or the projects are not listed yet. HQ asks it again at the press.
 */
export function useReleasePermission(): (appId: string) => ReleaseGate | undefined {
  const placements = useAtomValue(hqPlacementsAtom);
  const asker = useOfferAsker();
  const inventory = useContext(InventoryContext);
  return useCallback(
    (appId) => {
      if (placements === null) return undefined;
      const decision = releasePermission(asker ?? null, placements, appId);
      if (decision === undefined || decision.allowed) return decision;
      const production = [...placements].find(
        ([, placement]) => placement.appId === appId && placement.kind === "production",
      );
      if (
        production !== undefined &&
        !inventory?.projects.some(
          (project) => project.id === production[0] && project.userRoles !== undefined,
        )
      )
        return { allowed: false, reason: "Production project access has not been verified." };
      return {
        allowed: false,
        reason: hqRefusalWords({ code: "forbidden", reason: decision.reason }),
      };
    },
    [asker, inventory?.projects, placements],
  );
}
