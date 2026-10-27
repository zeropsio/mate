/**
 * What HQ offers the reader of an application (`can`, `@t3tools/shared/hqOffers`) as its navigation
 * says it: releasing its production. Drawn, never decided here: HQ
 * decides each over the very target its write is enforced with, and again at the press. While HQ
 * does not answer, each is unavailable since then; before HQ has said, none is offered.
 */
import { useAtomValue } from "@effect/atom-react";
import type { ReleaseGate } from "@t3tools/client-runtime/zerops";
import { hqOfferWords } from "@t3tools/client-runtime/zerops/hq";
import { hqOffer, type HqOfferState, type HqOffers } from "@t3tools/shared/hqOffers";
import { useMemo } from "react";

import { useClientSettings } from "../hooks/useSettings";
import { hqDown, hqDownSinceAtom, hqNavigationAtom } from "../state/zerops";
import { formatShortTimestamp } from "../timestampFormat";

/** How an offer reads now: its state from a `can` record, and its words. */
export interface OfferReading {
  readonly state: (can: HqOffers | undefined, verb: string) => HqOfferState;
  readonly words: (state: HqOfferState) => string | undefined;
}

/** How HQ's offers read now: whether HQ answers, and since when it does not. */
export function useOfferReading(): OfferReading {
  const view = useAtomValue(hqNavigationAtom);
  const downSince = useAtomValue(hqDownSinceAtom);
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  return useMemo(() => {
    const hq = { current: view.live, unavailableSince: hqDown(view) ? downSince : null };
    const at = (ms: number) => formatShortTimestamp(new Date(ms).toISOString(), timestampFormat);
    return {
      state: (can, verb) => hqOffer(can, verb, hq),
      words: (state) => hqOfferWords(state, { at, rolesAnsweredAt: null }),
    };
  }, [downSince, timestampFormat, view]);
}

/**
 * Whether HQ offers releasing the application's production, its refusal — that it has not said, or
 * since when it does not answer — in words; `undefined` for an application HQ has not named.
 */
export function releaseGateOf(
  reading: OfferReading,
  can: HqOffers | undefined,
): ReleaseGate | undefined {
  if (can === undefined) return undefined;
  const offer = reading.state(can, "release");
  return offer.kind === "allowed"
    ? { allowed: true }
    : {
        allowed: false,
        reason: reading.words(offer) ?? "",
        ...(offer.kind === "refused" ? { refusedBy: "hq" as const } : {}),
      };
}
