/**
 * Whose each Mate is, and the org's members where a surface names somebody else.
 *
 * A Mate's owner is named from HQ's people (`useZeropsMateOwners`): HQ names
 * exactly the people the reader's view names — whoever signed a Mate's agent
 * in among them — out of the member list it reads itself, so a load reads none
 * for "Jan's Mate — only Jan opens it" (D5). The face in the corner of the
 * Mate's own in the left menu wears that person's picture, which HQ does not
 * keep: it is the platform's, off the member list by their Zerops user id.
 *
 * Whoever else a surface names — a login's signer, a remark's author — HQ's
 * people name too, while HQ has word for the organization. The member list
 * itself is read while a surface would use it — a
 * hand-over's picker, an owner's picture, a name where the organization has no
 * official HQ or its HQ is down. What comes back is metadata — names, e-mails, roles, pictures —
 * and never a credential; any token of the org may read it (measured
 * 2026-09-15).
 *
 * A read that fails leaves every name undefined: rows then say the same thing
 * without a name, and faces go without a badge. Nothing here is worth an error
 * on the screen.
 */

import { useAtomValue } from "@effect/atom-react";
import type { ZeropsOrganizationMember } from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import {
  mateMemberName,
  resolveMateOwnerPerson,
  type MateOwnerCandidate,
  type MateOwnerPerson,
} from "@t3tools/client-runtime/zerops/mateAccess";
import { organizationMembers, type MembersRead } from "@t3tools/client-runtime/data";
import { Atom } from "effect/unstable/reactivity";
import { useCallback, useContext, useEffect, useMemo } from "react";

import {
  zeropsAccountDisplay,
  zeropsInitials,
} from "~/components/zerops/landing/ZeropsAccountControl.logic";

import { hqDown, hqNavigationAtom, hqPeopleAtom } from "../state/zerops";
import { noHq, useHqVerdict, type HqVerdictOwner } from "./hqVerdict";
import { useAccountDataOptional, useProjection } from "./ZeropsAccountData";
import { ZeropsDataContext } from "./zeropsDataContext";
import { useZeropsSession } from "./ZeropsSessionProvider";

/** A Mate's owner, as a face in the corner of the Mate's own draws them. */
export interface ZeropsMateOwner {
  readonly name: string;
  readonly initials: string;
  readonly avatarUrl: string | null;
  /** The owner is the person looking: "You asked", and *Mine* keeps this Mate. */
  readonly isViewer: boolean;
}

/** The name of the member whose Zerops user id a signer is, when the list has one. */
export function zeropsMemberNameByUserId(
  members: ReadonlyArray<MateOwnerCandidate>,
  userId: string,
): string | undefined {
  const member = members.find((entry) => entry.user?.id === userId);
  return member === undefined ? undefined : mateMemberName(member);
}

const NO_MEMBERS: ReadonlyArray<ZeropsOrganizationMember> = [];

/**
 * Where the member read stands: `idle` until a surface would use it, `failed`
 * when it came back with nothing to tell (the list stays empty).
 */
export type ZeropsOrganizationMembersStatus = "idle" | "loading" | "ready" | "failed";

const UNREAD_MEMBERS = Atom.make<MembersRead>({
  members: NO_MEMBERS,
  status: "loading",
  settled: false,
  refused: false,
});

export function useZeropsOrganizationMembersRead(input: {
  readonly clientId: string | undefined;
  /** Nothing is read until a surface would use it. */
  readonly enabled: boolean;
}): {
  readonly members: ReadonlyArray<ZeropsOrganizationMember>;
  readonly status: ZeropsOrganizationMembersStatus;
  /** The members are what a read settled, not ones being read again. */
  readonly settled: boolean;
  /**
   * The read ended with no answer and nothing reads it again on its own: refused, until a
   * person's again.
   */
  readonly refusedForGood: boolean;
} {
  // A surface outside the account's data (a render test in isolation) reads nobody, and its rows
  // say the same thing without names.
  const account = useAccountDataOptional();
  const demandDetail = account?.demandDetail;
  const orgId = account?.orgId ?? null;
  const { clientId, enabled } = input;
  const owner = enabled && clientId !== undefined ? clientId : null;
  // One read per organization, shared by every surface that asks: held while any of them is drawn,
  // and read again while held, on the data layer's cadence.
  useEffect(() => {
    if (demandDetail === undefined || orgId === null || owner === null) return;
    return demandDetail({ family: "organizationMembers", ownerId: owner });
  }, [demandDetail, orgId, owner]);
  const read = useProjection(
    organizationMembers,
    orgId === null || owner === null ? null : { orgId, clientId: owner },
    UNREAD_MEMBERS,
  );
  // Whose each Mate is — its face's badge, *Mine* — once the members are read; what waits for
  // the read itself waits on `status`.
  const status: ZeropsOrganizationMembersStatus = owner === null ? "idle" : read.status;
  return {
    members: read.members,
    status,
    settled: read.settled,
    refusedForGood: read.refused,
  };
}

export function useZeropsOrganizationMembers(input: {
  readonly clientId: string | undefined;
  /** Nothing is read until a surface would use it. */
  readonly enabled: boolean;
}): ReadonlyArray<ZeropsOrganizationMember> {
  return useZeropsOrganizationMembersRead(input).members;
}

/**
 * Somebody of the organization `clientId` by their Zerops user id, by name — a login's signer, a
 * remark's author: as HQ's people name them while HQ has word for the organization (its official
 * HQ, not down), the ids being the join; else from the member list, read only while `enabled`.
 */
export function useZeropsMemberNames(input: {
  readonly clientId: string | undefined;
  readonly enabled: boolean;
}): (userId: string) => string | undefined {
  const { clientId, enabled } = input;
  const data = useContext(ZeropsDataContext);
  const owner = useMemo<HqVerdictOwner | undefined>(
    () =>
      data === null || clientId === undefined
        ? undefined
        : { account: data.runtime.scope.account, clientId },
    [clientId, data],
  );
  const kept = useHqVerdict(owner);
  const navigation = useAtomValue(hqNavigationAtom);
  const shown = navigation.orgId === clientId;
  const hqWord = kept !== undefined && !noHq(kept) && !(shown && hqDown(navigation));
  const people = shown && navigation.read !== "unread" ? navigation.people : null;
  const members = useZeropsOrganizationMembers({ clientId, enabled: enabled && !hqWord });
  return useCallback(
    (userId: string) =>
      hqWord ? people?.[userId]?.name : zeropsMemberNameByUserId(members, userId),
    [hqWord, members, people],
  );
}

/**
 * A Mate's owner as HQ's people name them (`resolveMateOwnerPerson`), as a face in the corner of
 * the Mate's own draws them: their name and its initials, and their picture the way the account
 * bar picks one — the platform's, off the member whose Zerops user id HQ names. HQ keeps no
 * picture; a person the member list does not have (yet) wears their initials.
 */
export function zeropsMateOwnerOf(
  person: MateOwnerPerson | undefined,
  viewerUserId?: string | null,
  members: ReadonlyArray<ZeropsOrganizationMember> = [],
): ZeropsMateOwner | undefined {
  if (person === undefined) return undefined;
  const user = members.find((entry) => entry.user?.id === person.userId)?.user;
  return {
    name: person.name,
    initials: zeropsInitials(person.name),
    avatarUrl: user === undefined ? null : zeropsAccountDisplay(user).avatarUrl,
    isViewer: viewerUserId !== undefined && viewerUserId !== null && person.userId === viewerUserId,
  };
}

/**
 * Each Mate's owner, for the account's active organization, named from HQ's people
 * (`resolveMateOwnerPerson`). Their picture is the platform's: the member list is read for it
 * once HQ names anybody, and the list this browser read last stands in until then.
 */
export function useZeropsMateOwners(): (candidate: ZeropsCandidate) => ZeropsMateOwner | undefined {
  const { activeOrganization, user } = useZeropsSession();
  const people = useAtomValue(hqPeopleAtom);
  const members = useZeropsOrganizationMembers({
    clientId: activeOrganization?.id,
    enabled: people !== null && Object.keys(people).length > 0,
  });
  const viewerUserId = user?.id;
  return useCallback(
    (candidate: ZeropsCandidate) =>
      zeropsMateOwnerOf(
        resolveMateOwnerPerson({ project: candidate.project, people }),
        viewerUserId,
        members,
      ),
    [members, people, viewerUserId],
  );
}
