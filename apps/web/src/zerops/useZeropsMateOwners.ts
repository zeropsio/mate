/**
 * Whose each Mate is — read from the org's member list.
 *
 * A project's `userRoles` name its `OWNER` by `clientUser` id, and only the
 * org's member list turns that into a person: a name for "Jan's Mate — only
 * Jan opens it" (D5), and a face for the corner of the Mate's own in the left
 * menu.
 *
 * The list is read once per account and only where a surface would use it.
 * What comes back is metadata — names, e-mails, roles, pictures — and never a
 * credential; any token of the org may read it (measured 2026-09-15).
 *
 * A read that fails leaves every owner undefined: rows then say the same
 * thing without a name, and faces go without a badge. Nothing here is worth
 * an error on the screen.
 */

import type { ZeropsOrganizationMember } from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import {
  MATE_SIGNER_TAG_PREFIX,
  mateMemberName,
  mateOwnerRecords,
  resolveMateOwner,
  type MateOwnerCandidate,
} from "@t3tools/client-runtime/zerops/mateAccess";
import { selectMembers, type MembersCellRequest } from "@t3tools/client-runtime/zerops/data";
import { useCallback, useContext, useEffect, useMemo } from "react";

import { zeropsAccountDisplay } from "~/components/zerops/landing/ZeropsAccountControl.logic";

import { menuMemory, rememberMenu, withMembers } from "./menuMemory";
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

/**
 * A member as an owner's badge: their name, and their picture the way the
 * account bar picks one, or their initials. Nobody when the row names nobody —
 * a badge of "?" would claim an owner the list could not tell us.
 */
export function zeropsMateOwner(
  member: ZeropsOrganizationMember | undefined,
  viewerUserId?: string | null,
): ZeropsMateOwner | undefined {
  const name = member === undefined ? undefined : mateMemberName(member);
  if (member?.user === undefined || name === undefined) return undefined;
  const display = zeropsAccountDisplay(member.user);
  const userId = member.user.id;
  return {
    name,
    initials: display.initials,
    avatarUrl: display.avatarUrl,
    isViewer: userId !== undefined && viewerUserId !== undefined && userId === viewerUserId,
  };
}

/** The name of the member whose Zerops user id a signer tag names, when the list has one. */
export function zeropsMemberNameByUserId(
  members: ReadonlyArray<MateOwnerCandidate>,
  userId: string,
): string | undefined {
  const member = members.find((entry) => entry.user?.id === userId);
  return member === undefined ? undefined : mateMemberName(member);
}

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
  const read = selectMembers(
    useKnown(request === null || data === null ? null : data.runtime.cells.known(request)),
  );
  const answered = read.status === "ready" ? read.members : undefined;
  // The members this browser read last, until they are read again: whose each Mate is — its
  // face's badge, *Mine* — from the first paint (`menuMemory.ts`). What waits for the read
  // itself waits on `status`.
  useEffect(() => {
    if (clientId !== undefined && answered !== undefined)
      rememberMenu((memory) => withMembers(memory, clientId, answered));
  }, [answered, clientId]);
  const members = useMemo(
    () => answered ?? (clientId === undefined ? [] : (menuMemory().members[clientId] ?? [])),
    [answered, clientId],
  );
  const status: ZeropsOrganizationMembersStatus =
    !enabled || clientId === undefined ? "idle" : request === null ? "loading" : read.status;
  return { members, status };
}

export function useZeropsOrganizationMembers(input: {
  readonly clientId: string | undefined;
  /** Nothing is read until a surface would use it. */
  readonly enabled: boolean;
}): ReadonlyArray<ZeropsOrganizationMember> {
  return useZeropsOrganizationMembersRead(input).members;
}

/**
 * Who signed a login in, by name, for the coding-agents card — read from the
 * Mate's own organization, and only when a login names somebody else.
 */
export function useZeropsMemberNames(input: {
  readonly clientId: string | undefined;
  readonly enabled: boolean;
}): (userId: string) => string | undefined {
  const members = useZeropsOrganizationMembers(input);
  return useCallback((userId: string) => zeropsMemberNameByUserId(members, userId), [members]);
}

/**
 * Each Mate's owner, for the account's active organization. Nothing is read
 * until at least one project names a person — an `OWNER` of its own, the
 * signer of its agent, or the maker of one that runs without a sign-in
 * (`mate:runs:`, `resolveMateOwner`).
 */
export function useZeropsMateOwners(input: {
  readonly candidates: ReadonlyArray<ZeropsCandidate>;
  readonly enabled: boolean;
}): (candidate: ZeropsCandidate) => ZeropsMateOwner | undefined {
  const { activeOrganization, user } = useZeropsSession();
  const viewerUserId = user?.id;
  const members = useZeropsOrganizationMembers({
    clientId: activeOrganization?.id,
    enabled:
      input.enabled &&
      input.candidates.some(
        (candidate) =>
          candidate.project.userRoles?.some((entry) => entry.roleCode === "OWNER") === true ||
          candidate.project.tagList?.some((tag) => tag.startsWith(MATE_SIGNER_TAG_PREFIX)) ===
            true ||
          mateOwnerRecords(candidate.project).person !== undefined,
      ),
  });
  return useCallback(
    (candidate: ZeropsCandidate) =>
      zeropsMateOwner(resolveMateOwner({ project: candidate.project, members }), viewerUserId),
    [members, viewerUserId],
  );
}
