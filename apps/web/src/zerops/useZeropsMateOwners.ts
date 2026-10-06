/**
 * Whose each Mate is, and who a surface names, as HQ names them.
 *
 * A Mate's owner is HQ's (`hqProjectPeople`): HQ decides who owns it and sends their name and
 * picture, so a load reads no member list for "Jan's Mate — only Jan opens it" (D5). Whoever else a
 * surface names — a login's signer, a remark's author — HQ's people name too. Somebody HQ names no
 * record of goes without a name, and a face without a badge.
 *
 * The member list itself is read only where a surface needs the organization's people beyond what
 * HQ names (`useZeropsOrganizationMembersRead`): verifying the organization's official HQ.
 */

import { useAtomValue } from "@effect/atom-react";
import type { ZeropsOrganizationMember } from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { shownHqProjectPeopleAtom, type HqMateOwner } from "@t3tools/client-runtime/data";
import {
  selectMembers,
  settledValue,
  type MembersCellRequest,
} from "@t3tools/client-runtime/zerops/data";
import { useCallback, useContext, useMemo } from "react";

import { zeropsInitials } from "~/components/zerops/landing/ZeropsAccountControl.logic";

import { hqNavigationAtom, hqPeopleAtom } from "../state/zerops";
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
  // What waits for the read itself waits on `status`.
  const members = answered ?? NO_MEMBERS;
  const status: ZeropsOrganizationMembersStatus =
    !enabled || clientId === undefined ? "idle" : request === null ? "loading" : read.status;
  const refusedForGood =
    shown.state === "gone" ||
    (shown.state === "failed" && shown.retryAtMs === null) ||
    (shown.state === "withheld" && shown.reason === "access-denied");
  return { members, status, settled: settledValue(shown) !== null, refusedForGood };
}

/**
 * Somebody of the organization `clientId` by their Zerops user id, by name — a login's signer, a
 * remark's author — as HQ's people name them for the organization in view; its last word stands
 * while HQ does not answer. Nobody of another organization.
 */
export function useHqPersonNames(
  clientId: string | undefined,
): (userId: string) => string | undefined {
  const navigation = useAtomValue(hqNavigationAtom);
  const people = useAtomValue(hqPeopleAtom);
  const shown = clientId !== undefined && navigation.orgId === clientId;
  return useCallback(
    (userId: string) => (shown ? people?.[userId]?.name : undefined),
    [people, shown],
  );
}

/**
 * A Mate's owner as HQ names them (`HqMateOwner`), as a face in the corner of the Mate's own draws
 * them: their name and its initials, and the platform's picture of them HQ sends.
 */
export function zeropsMateOwnerOf(
  owner: HqMateOwner | null | undefined,
  viewerUserId?: string | null,
): ZeropsMateOwner | undefined {
  if (owner === null || owner === undefined) return undefined;
  return {
    name: owner.name,
    initials: zeropsInitials(owner.name),
    avatarUrl: owner.avatarUrl,
    isViewer: viewerUserId !== undefined && viewerUserId !== null && owner.userId === viewerUserId,
  };
}

/** Each Mate's owner, for the organization shown, as HQ names them (`hqProjectPeople`). */
export function useZeropsMateOwners(): (candidate: ZeropsCandidate) => ZeropsMateOwner | undefined {
  const { user } = useZeropsSession();
  const people = useAtomValue(shownHqProjectPeopleAtom);
  const viewerUserId = user?.id;
  return useCallback(
    (candidate: ZeropsCandidate) =>
      zeropsMateOwnerOf(people[candidate.project.id]?.owner, viewerUserId),
    [people, viewerUserId],
  );
}

/**
 * Whether a project's Mate waits on the viewer, by its id, as HQ says it (`waitsOnViewer`): they
 * signed its agent in. Only what one's own Mate waits on waits on them — its question, its
 * change's review; a colleague's waits on its owner. Nobody's, before HQ says.
 */
export function useWaitsOnViewer(): (projectId: string) => boolean {
  const people = useAtomValue(shownHqProjectPeopleAtom);
  return useCallback((projectId: string) => people[projectId]?.waitsOnViewer === true, [people]);
}
