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
import { mateMemberName, resolveMateOwner } from "@t3tools/client-runtime/zerops/mateAccess";
import { useCallback, useEffect, useRef, useState } from "react";

import { zeropsAccountDisplay } from "~/components/zerops/landing/ZeropsAccountControl.logic";

import { useZeropsSession } from "./ZeropsSessionProvider";

/** A Mate's owner, as a face in the corner of the Mate's own draws them. */
export interface ZeropsMateOwner {
  readonly name: string;
  readonly initials: string;
  readonly avatarUrl: string | null;
}

/**
 * A member as an owner's badge: their name, and their picture the way the
 * account bar picks one, or their initials. Nobody when the row names nobody —
 * a badge of "?" would claim an owner the list could not tell us.
 */
export function zeropsMateOwner(
  member: ZeropsOrganizationMember | undefined,
): ZeropsMateOwner | undefined {
  const name = member === undefined ? undefined : mateMemberName(member);
  if (member?.user === undefined || name === undefined) return undefined;
  const display = zeropsAccountDisplay(member.user);
  return { name, initials: display.initials, avatarUrl: display.avatarUrl };
}

export function useZeropsOrganizationMembers(input: {
  readonly clientId: string | undefined;
  /** Nothing is read until a surface would use it. */
  readonly enabled: boolean;
}): ReadonlyArray<ZeropsOrganizationMember> {
  const { client } = useZeropsSession();
  const [members, setMembers] = useState<ReadonlyArray<ZeropsOrganizationMember>>([]);
  const read = useRef<string | null>(null);
  const { clientId, enabled } = input;

  useEffect(() => {
    if (!enabled || clientId === undefined) return;
    if (read.current === clientId) return;
    read.current = clientId;

    const controller = new AbortController();
    void client
      .listOrganizationMembers(clientId, controller.signal)
      .then((answer) => {
        if (!controller.signal.aborted) setMembers(answer);
      })
      .catch(() => {
        // No names, and the rows say the same thing without them.
        read.current = null;
      });

    return () => {
      controller.abort();
    };
  }, [client, clientId, enabled]);

  return members;
}

/**
 * Each Mate's owner, for the account's active organization. Nothing is read
 * until at least one project names an `OWNER` of its own.
 */
export function useZeropsMateOwners(input: {
  readonly candidates: ReadonlyArray<ZeropsCandidate>;
  readonly enabled: boolean;
}): (candidate: ZeropsCandidate) => ZeropsMateOwner | undefined {
  const { activeOrganization } = useZeropsSession();
  const members = useZeropsOrganizationMembers({
    clientId: activeOrganization?.id,
    enabled:
      input.enabled &&
      input.candidates.some((candidate) =>
        candidate.project.userRoles?.some((entry) => entry.roleCode === "OWNER"),
      ),
  });
  return useCallback(
    (candidate: ZeropsCandidate) =>
      zeropsMateOwner(resolveMateOwner({ project: candidate.project, members })),
    [members],
  );
}
