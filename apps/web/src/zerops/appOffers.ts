/**
 * What the reader of an application is offered (`can`, `@t3tools/shared/hqOffers`), decided from
 * their live Zerops roles: releasing its production. Drawn, never decided here; HQ decides the
 * write again at the press. Before the roles are read, none is offered.
 */
import type { ReleaseGate } from "@t3tools/client-runtime/zerops";
import { hqOfferWords } from "@t3tools/client-runtime/zerops/hq";
import { hqOffer, type HqOffers } from "@t3tools/shared/hqOffers";

/**
 * Whether HQ offers releasing the application's production, its refusal — or that it has not
 * said — in words; `undefined` for an application HQ has not named.
 */
export function releaseGateOf(can: HqOffers | undefined): ReleaseGate | undefined {
  if (can === undefined) return undefined;
  const offer = hqOffer(can, "release");
  return offer.kind === "allowed"
    ? { allowed: true }
    : {
        allowed: false,
        reason: hqOfferWords(offer) ?? "",
        ...(offer.kind === "refused" ? { refusedBy: "hq" as const } : {}),
      };
}
