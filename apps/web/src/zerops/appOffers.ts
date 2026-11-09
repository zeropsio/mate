/**
 * What the reader of an application is offered (`can`, `@t3tools/shared/hqOffers`), decided from
 * their live Zerops roles: releasing its production. Drawn, never decided here; HQ decides the
 * write again at the press. Before the roles are read, none is offered.
 */
import type { ReleaseGate } from "@t3tools/client-runtime/zerops";
import { hqOfferWords } from "@t3tools/client-runtime/zerops/hq";
import { hqOffer, type HqOfferState, type HqOffers } from "@t3tools/shared/hqOffers";

/** How an offer reads: its state from a `can` record, and its words. */
export interface OfferReading {
  readonly state: (can: HqOffers | undefined, verb: string) => HqOfferState;
  readonly words: (state: HqOfferState) => string | undefined;
}

export const OFFER_READING: OfferReading = { state: hqOffer, words: hqOfferWords };

/**
 * Whether HQ offers releasing the application's production, its refusal — or that it has not
 * said — in words; `undefined` for an application HQ has not named.
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
