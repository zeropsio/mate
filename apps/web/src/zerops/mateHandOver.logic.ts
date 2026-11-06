/**
 * A Mate's hand-over as the web offers it: to an owner or admin of the organization
 * (`handsOverMates`), to one of the organization's active members as Zerops answers the person's own
 * read of them, and — where Zerops refused the Mate's key (`keyRefused`) — as the one way its page
 * offers back. HQ decides again who may hand over and to whom at the call.
 *
 * Pure (rule R1).
 */
import type { HqProjectPeople } from "@t3tools/client-runtime/data";
import type { ZeropsOrganizationMember } from "@t3tools/client-runtime/zerops";
import { mateMemberName } from "@t3tools/client-runtime/zerops/mateAccess";
import { ZEROPS_ACTIVE_MEMBER_STATUS } from "@t3tools/shared/zeropsRoles";

/** The verb, in the Mate's menu and as its refused page's primary action. */
export const HAND_OVER_VERB = "Hand over this Mate";

/** A person a Mate may be handed to: their person id (HQ's `ownerUserId`) and their name. */
export interface HandOverCandidate {
  readonly userId: string;
  readonly name: string;
}

/**
 * The organization's active members by name — its owner now too, whom a Mate whose key was refused
 * is handed back to for a new key. A row whose person Zerops does not name (an invitation not yet
 * taken) is nobody to hand it to.
 */
export function handOverCandidates(
  members: ReadonlyArray<ZeropsOrganizationMember>,
): ReadonlyArray<HandOverCandidate> {
  return members
    .flatMap((member) => {
      const userId = member.userId ?? member.user?.id;
      const name = mateMemberName(member);
      const active = member.status === undefined || member.status === ZEROPS_ACTIVE_MEMBER_STATUS;
      return active && userId !== undefined && name !== undefined ? [{ userId, name }] : [];
    })
    .toSorted((a, b) => a.name.localeCompare(b.name));
}

/**
 * What a Mate whose key Zerops refused says in place of a Mate that does not connect, and whether
 * its hand-over is offered there — to whoever hands Mates over (`handsOverMates`); `null` for a
 * Mate HQ does not say that of.
 */
export function mateKeyRefused(
  people: HqProjectPeople | undefined,
  name: string,
  handOver: boolean,
): { readonly headline: string; readonly sentence: string; readonly handOver: boolean } | null {
  if (people?.keyRefused !== true) return null;
  const mate = name.length > 0 ? name : "This Mate";
  return {
    headline: `${mate} can't connect: Zerops refused its key.`,
    sentence: handOver
      ? "Hand it over to give it a new key. Whoever you pick becomes its owner."
      : "It connects again once an owner or admin of the organization, or its owner, hands it over.",
    handOver,
  };
}
