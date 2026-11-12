/**
 * What the reader of an application is offered (`can`, `@t3tools/shared/hqOffers`), decided from
 * their live Zerops roles: releasing its production. Drawn, never decided here; HQ decides the
 * write again at the press. Before the roles are read, none is offered.
 */
import type { ReleaseGate } from "@t3tools/client-runtime/zerops";
import { hqMergeOfferWords } from "@t3tools/client-runtime/zerops/hq";
import { hqOffer, type HqOffers } from "@t3tools/shared/hqOffers";

/** Who merges an application's changes where it limits that, and what each of them is called. */
export interface ReleaseMergers {
  readonly mergers: { readonly people: ReadonlyArray<string> } | undefined;
  readonly nameOf: (userId: string) => string | undefined;
}

const NOBODY_NAMED: ReleaseMergers = { mergers: undefined, nameOf: () => undefined };

/**
 * Whether HQ offers releasing the application's production, its refusal — or that it has not
 * said — in words; `undefined` for an application HQ has not named. A release to a Git production
 * its merge limit holds says who merges there, as the held Merge does.
 */
export function releaseGateOf(
  can: HqOffers | undefined,
  { mergers, nameOf }: ReleaseMergers = NOBODY_NAMED,
): ReleaseGate | undefined {
  if (can === undefined) return undefined;
  const offer = hqOffer(can, "release");
  return offer.kind === "allowed"
    ? { allowed: true }
    : {
        allowed: false,
        reason: hqMergeOfferWords(offer, mergers, nameOf) ?? "",
        ...(offer.kind === "refused" ? { refusedBy: "hq" as const } : {}),
      };
}
