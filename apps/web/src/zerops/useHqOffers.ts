/**
 * HQ's offers as its structure last streamed them (`can`, `@t3tools/shared/hqOffers`), for the
 * organization in view: whether HQ answers now, each verb's state, and its words. Drawn, never
 * decided here.
 */
import { useAtomValue } from "@effect/atom-react";
import {
  hqMateOffers,
  hqOfferWords,
  type HqMateOfferStates,
} from "@t3tools/client-runtime/zerops/hq";
import { type HqOfferState, type HqOffers, hqOffer } from "@t3tools/shared/hqOffers";
import { useCallback, useMemo } from "react";

import { useClientSettings } from "../hooks/useSettings";
import { hqDown, hqDownSinceAtom, hqNavigationAtom, zeropsSessionAtom } from "../state/zerops";
import { formatShortTimestamp } from "../timestampFormat";

/**
 * The organization's structure as HQ last streamed it, whether HQ answers now, and how a verb's
 * state reads in words.
 */
export function useHqOffers() {
  const view = useAtomValue(hqNavigationAtom);
  const downSince = useAtomValue(hqDownSinceAtom);
  const organizationId = useAtomValue(zeropsSessionAtom)?.activeOrganization?.organizationId;
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  return useMemo(() => {
    const structure = view.orgId !== organizationId ? null : view.structure;
    const hq = { current: view.live, unavailableSince: hqDown(view) ? downSince : null };
    const at = (ms: number) => formatShortTimestamp(new Date(ms).toISOString(), timestampFormat);
    return {
      structure,
      hq,
      at,
      state: (can: HqOffers | undefined, verb: string) => hqOffer(can, verb, hq),
      words: (state: HqOfferState) => hqOfferWords(state, { at, rolesAnsweredAt: null }),
    };
  }, [downSince, organizationId, timestampFormat, view]);
}

/**
 * What HQ offers the reader of a project, by its id (`hqMateOffers`): of a Mate, following it,
 * its record, leaving its application and where it may go; of a project HQ holds nowhere, writing
 * its Mate's record. `undefined` while HQ's structure is not known.
 */
export function useMateOffers(): (projectId: string) => HqMateOfferStates | undefined {
  const { structure, hq } = useHqOffers();
  return useCallback(
    (projectId) => (structure === null ? undefined : hqMateOffers(structure, projectId, hq)),
    [hq, structure],
  );
}

/**
 * What HQ offers the reader of the organization (`create_app`, `rename_app`, `delete_app`), by verb;
 * unknown while HQ has not said, unavailable since it stopped answering.
 */
export function useOrgOffers(): (verb: string) => HqOfferState {
  const { structure, state } = useHqOffers();
  return useCallback((verb) => state(structure?.can, verb), [state, structure]);
}
