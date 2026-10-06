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
 * itself is read once per account, and only where a surface would use it — a
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
import {
  selectMembers,
  settledValue,
  type MembersCellRequest,
} from "@t3tools/client-runtime/zerops/data";
import { useCallback, useContext, useMemo } from "react";

import {
  zeropsAccountDisplay,
  zeropsInitials,
} from "~/components/zerops/landing/ZeropsAccountControl.logic";

import { hqPeopleAtom, hqPeopleViewAtom, hqStructureAtom } from "../state/zerops";
import { noHq, useHqVerdict, type HqVerdictOwner } from "./hqVerdict";
import { useKnown, ZeropsDataContext } from "./zeropsDataContext";
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
   * The read ended with no answer and nothing reads it again on its own: refused, gone, or
   * failed until a person's again.
   */
  readonly refusedForGood: boolean;
} {
  // A surface outside the account's data (a render test in isolation) reads nobody, and its rows
  // say the same thing without names.
  const data = useContext(ZeropsDataContext);
  const { clientId, enabled } = input;
  // One read per organization, shared by every surface that asks (the account's cells):
  // asked at once, they are one read; asked again while it is fresh, none.
  const request = useMemo<MembersCellRequest | null>(
    () =>
      enabled && clientId !== undefined && data !== null
        ? {
            kind: "members",
            account: data.runtime.scope,
            organization: data.organizationRef(clientId),
          }
        : null,
    [clientId, data, enabled],
  );
  const shown = useKnown(
    request === null || data === null ? null : data.runtime.cells.known(request),
  );
  const read = selectMembers(shown);
  const answered = read.status === "ready" ? read.members : undefined;
  // Whose each Mate is — its face's badge, *Mine* — once the members are read; what waits for
  // the read itself waits on `status`.
  const members = answered ?? NO_MEMBERS;
  const status: ZeropsOrganizationMembersStatus =
    !enabled || clientId === undefined ? "idle" : request === null ? "loading" : read.status;
  const refusedForGood =
    shown.state === "gone" ||
    (shown.state === "failed" && shown.retryAtMs === null) ||
    (shown.state === "withheld" && shown.reason === "access-denied");
  return { members, status, settled: settledValue(shown) !== null, refusedForGood };
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
  const structure = useAtomValue(hqStructureAtom);
  const peopleView = useAtomValue(hqPeopleViewAtom);
  const down =
    structure !== null &&
    structure.organizationId === clientId &&
    structure.unavailableSince !== null;
  const hqWord = kept !== undefined && !noHq(kept) && !down;
  const people =
    peopleView !== null && peopleView.organizationId === clientId ? peopleView.people : null;
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
