/**
 * The people of an organization by their Zerops user id, as the client's own read of its member
 * list names and pictures them (`organizationMembers`, read with the viewer's token). HQ keeps only
 * user ids (a Mate's owner, a login's signer, a Chief's person); every name and face beside one
 * comes from here. Somebody the list does not hold stays unnamed.
 *
 * @module data/projections/zeropsPeople
 */
import { mateMemberName } from "../../zerops/mateAccess.ts";
import type { ProjectionReads } from "../store.ts";

export interface ZeropsPerson {
  readonly name: string;
  /**
   * What every surface calls them: their first name where no other member of the organization
   * shares it, else their full name (`name`).
   */
  readonly called: string;
  /** Their membership's id — what a project's `userRoles` names them by. */
  readonly clientUserId: string;
  /** The platform's own picture of them; `null` where they have none. */
  readonly avatarUrl: string | null;
}

const text = (value: string | null | undefined) =>
  value !== null && value !== undefined && value.length > 0 ? value : undefined;

/** Everybody `orgId`'s member list names, by user id; nobody until a read answered it. */
export function zeropsPeople(
  read: ProjectionReads,
  orgId: string,
): ReadonlyMap<string, ZeropsPerson> {
  const members = read.fact("organizationMembers", orgId);
  const people = new Map<string, ZeropsPerson>();
  if (members.kind !== "known") return people;
  const named = members.value.flatMap((member) => {
    const userId = member.userId ?? member.user?.id;
    const name = mateMemberName(member);
    if (userId === undefined || name === undefined) return [];
    const first = text(member.user?.firstName?.trim()) ?? name.split(/\s+/u)[0] ?? name;
    return [{ member, userId, name, first }];
  });
  const sharing = new Map<string, Set<string>>();
  for (const { userId, first } of named) {
    const key = first.toLocaleLowerCase();
    sharing.set(key, (sharing.get(key) ?? new Set()).add(userId));
  }
  for (const { member, userId, name, first } of named) {
    const avatar = member.user?.avatar;
    people.set(userId, {
      name,
      called: sharing.get(first.toLocaleLowerCase())?.size === 1 ? first : name,
      clientUserId: member.id,
      avatarUrl: text(avatar?.smallAvatarUrl) ?? text(avatar?.externalAvatarUrl) ?? null,
    });
  }
  return people;
}
