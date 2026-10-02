/**
 * What the person may do with an application's changes, by HQ's rule over the facts the client
 * holds (`changeOffers`): the session's membership, the projects the inventory lists with their
 * grants — a stage's counts as much as a Mate's — and the projects HQ places in the application.
 * One function for every application, so a screen listing several asks it per row.
 */
import { useAtomValue } from "@effect/atom-react";
import { changeOffers, mayOffer, offerAsker } from "@t3tools/client-runtime/zerops";
import { useCallback, useContext, useMemo } from "react";

import { hqPlacementsAtom } from "../state/zerops";
import { InventoryContext } from "./inventoryContext";
import { sessionOfferViewer } from "./offerViewer";
import { useZeropsSessionOptional } from "./sessionContext";

export type ZeropsChangeOffers = ReturnType<typeof changeOffers>;

/**
 * An application's offers by its id; `undefined` while HQ has not said where it places the
 * projects, or the projects are not listed yet — a rule over facts not held yet would only guess.
 */
export type ZeropsChangeOffersOf = (appId: string) => ZeropsChangeOffers | undefined;

/** Who asks, by the session's membership and the projects the inventory lists; `undefined` before. */
function useOfferAsker() {
  const session = useZeropsSessionOptional();
  const inventory = useContext(InventoryContext);
  const user = session?.user;
  const organization = session?.activeOrganization ?? null;
  const projects = inventory === null || inventory.isLoading ? undefined : inventory.projects;
  return useMemo(
    () =>
      projects === undefined
        ? undefined
        : offerAsker(sessionOfferViewer(user, organization), projects),
    [organization, projects, user],
  );
}

export function useChangeOffers(): ZeropsChangeOffersOf {
  const placements = useAtomValue(hqPlacementsAtom);
  const asker = useOfferAsker();
  return useCallback(
    (appId) =>
      asker === undefined || placements === null
        ? undefined
        : changeOffers(asker, placements, appId),
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
