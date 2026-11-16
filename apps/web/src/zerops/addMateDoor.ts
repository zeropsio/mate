/**
 * *Add a Mate*, by one rule on every surface that offers it — the menu's + and a project's ···,
 * the overview's card, the project's page: offered where HQ offers it; drawn disabled, with whom
 * to ask, to a person who already works with a Mate in the organization but may not add one; and
 * not drawn at all for a person who only reads. Nothing is offered enabled and then refused.
 */
import { useAtomValue } from "@effect/atom-react";
import { shownHqProjectPeopleAtom } from "@t3tools/client-runtime/data";
import { viewerOwnsMate } from "@t3tools/client-runtime/zerops";
import type { HqOfferState } from "@t3tools/shared/hqOffers";
import { Atom } from "effect/reactivity";
import { useCallback } from "react";

import { useAddMateOffer } from "./useHqOffers";

/** What a person who works with a Mate, and may not add one, reads on the disabled door. */
export const ASK_TO_ADD_MATES = "Ask an Owner or Admin to let you add Mates.";

export type AddMateDoor =
  | { readonly kind: "offered" }
  /** Theirs to want, and refused: drawn disabled, with why. */
  | { readonly kind: "off"; readonly why: string }
  /** Never theirs: they only read here. Not drawn. */
  | { readonly kind: "none" }
  /** HQ has not said yet: each surface keeps what it draws meanwhile. */
  | { readonly kind: "unknown" };

export function addMateDoor(input: {
  /** HQ's verdict on adding a Mate to the project (`add_mate`). */
  readonly offer: HqOfferState;
  /** The person already works with a Mate of their own somewhere in the organization. */
  readonly worksWithMate: boolean;
}): AddMateDoor {
  if (input.offer.kind === "allowed") return { kind: "offered" };
  if (input.offer.kind === "unknown") return { kind: "unknown" };
  return input.worksWithMate ? { kind: "off", why: ASK_TO_ADD_MATES } : { kind: "none" };
}

/** Whether any Mate of the organization shown is the person's own, as HQ says whose each is. */
const worksWithMateAtom = Atom.make((get): boolean =>
  viewerOwnsMate(Object.values(get(shownHqProjectPeopleAtom))),
).pipe(Atom.withLabel("zerops:works-with-mate"));

/** A project's {@link AddMateDoor}, by its application's id. */
export function useAddMateDoor(): (groupId: string) => AddMateDoor {
  const offer = useAddMateOffer();
  const worksWithMate = useAtomValue(worksWithMateAtom);
  return useCallback(
    (groupId) => addMateDoor({ offer: offer(groupId), worksWithMate }),
    [offer, worksWithMate],
  );
}
