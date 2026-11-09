/**
 * The offers of the organization in view as its structure holds them (`can`,
 * `@t3tools/shared/hqOffers`), decided from the person's live Zerops roles
 * (`@t3tools/shared/zeropsOffers`): each verb's state, and its words.
 * Drawn, never decided here.
 */
import { useAtomValue } from "@effect/atom-react";
import { hqMateOffers, type HqMateOfferStates } from "@t3tools/client-runtime/zerops/hq";
import { type HqOfferState, hqOffer } from "@t3tools/shared/hqOffers";
import { useCallback } from "react";

import { hqNavigationAtom, zeropsSessionAtom } from "../state/zerops";

/** The organization in view's structure as HQ last streamed it, whose `can` records the offers are. */
export function useHqStructure() {
  const view = useAtomValue(hqNavigationAtom);
  const organizationId = useAtomValue(zeropsSessionAtom)?.activeOrganization?.organizationId;
  return view.orgId !== organizationId ? null : view.structure;
}

/**
 * What HQ offers the reader of a project, by its id (`hqMateOffers`): of a Mate, following it,
 * its record, leaving its application and where it may go; of a project HQ holds nowhere, writing
 * its Mate's record. `undefined` while HQ's structure is not known.
 */
export function useMateOffers(): (projectId: string) => HqMateOfferStates | undefined {
  const structure = useHqStructure();
  return useCallback(
    (projectId) => (structure === null ? undefined : hqMateOffers(structure, projectId)),
    [structure],
  );
}

/**
 * What HQ offers the reader of the organization (`create_app`, `rename_app`, `delete_app`), by verb;
 * unknown while HQ has not said.
 */
export function useOrgOffers(): (verb: string) => HqOfferState {
  const structure = useHqStructure();
  return useCallback((verb) => hqOffer(structure?.can, verb), [structure]);
}

export function useAddMateOffer(): (groupId: string) => HqOfferState {
  const structure = useHqStructure();
  return useCallback(
    (groupId) => hqOffer(structure?.apps.find((app) => app.id === groupId)?.can, "add_mate"),
    [structure],
  );
}
