/**
 * Who merges a project's changes, as its page says and sets it: the row's one line, the people an
 * Owner or Admin picks from, the draft they edit, and whether it can be saved. The rule itself is
 * HQ's, mirrored in `@t3tools/shared/zeropsPermissions`; nothing here decides who merges.
 *
 * Pure.
 */
import { sameMergers } from "@t3tools/client-runtime/data";
import { zeropsRoleWords, type ZeropsOrganizationMember } from "@t3tools/client-runtime/zerops";
import { isTokenMember, mateMemberName } from "@t3tools/client-runtime/zerops/mateAccess";
import { HQ_MERGERS_MAX } from "@t3tools/shared/hqMergers";
import { roleAtLeast, ZEROPS_ACTIVE_MEMBER_STATUS } from "@t3tools/shared/zeropsRoles";

/** What the section is called, above its card and as its choice's name. */
export const MERGING_TITLE = "Who can merge";

/** The people a project names beside the Owner and Admins; `null`: it limits nothing. */
export type MergersPeople = ReadonlyArray<string> | null;

/** The Merging row's line: where the setting stands. */
export function mergingLine(people: MergersPeople): string {
  if (people === null) return "Everyone working here can merge";
  if (people.length === 0) return "Only the Owner and Admins merge";
  return `Owner, Admins and ${String(people.length)} ${people.length === 1 ? "person" : "people"} merge`;
}

/**
 * What the page shows of who merges: HQ's navigation, under this page's own write once HQ answered
 * it — its answer is the limit as it stands, until the navigation says anything else than it said
 * at the answer.
 */
export function shownMergers(
  held: MergersPeople,
  answer: { readonly over: MergersPeople; readonly now: MergersPeople } | null,
): MergersPeople {
  return answer !== null && sameMergers(held, answer.over) ? answer.now : held;
}

/** One person of the checklist. */
export interface MergingPerson {
  readonly userId: string;
  readonly name: string;
  /** Their role in the organization in its plain words; `no longer active` for one who left. */
  readonly role: string;
  /** An Owner or Admin: merges whoever is picked, so checked and not to uncheck. */
  readonly always: boolean;
}

const active = (member: ZeropsOrganizationMember) =>
  (member.status ?? ZEROPS_ACTIVE_MEMBER_STATUS) === ZEROPS_ACTIVE_MEMBER_STATUS;

const userIdOf = (member: ZeropsOrganizationMember) => member.userId ?? member.user?.id;

/** What a picked person the organization no longer lists as active is called. */
const LEFT_NAME = "Someone no longer in the organization";

/**
 * The checklist: the organization's active members, Owners and Admins first, then everyone else by
 * name; then whoever the project still names that Zerops no longer lists as an active member, so
 * they can be unchecked (HQ takes no list naming one).
 */
export function mergingPeople(
  members: ReadonlyArray<ZeropsOrganizationMember>,
  named: ReadonlyArray<string>,
): ReadonlyArray<MergingPerson> {
  const listed = members.flatMap((member) => {
    const userId = userIdOf(member);
    return userId === undefined || isTokenMember(member) ? [] : [{ member, userId }];
  });
  const people = listed
    .filter(({ member }) => active(member))
    .map(({ member, userId }): MergingPerson & { readonly rank: number } => {
      const always = roleAtLeast(member.roleCode, "ADMIN");
      return {
        userId,
        name: mateMemberName(member) ?? "Unnamed member",
        role: zeropsRoleWords(member) ?? "Member",
        always,
        rank: member.roleCode === "OWNER" ? 0 : always ? 1 : 2,
      };
    })
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))
    .map(({ rank: _rank, ...person }) => person);
  const shown = new Set(people.map(({ userId }) => userId));
  const left = [...new Set(named)]
    .filter((userId) => !shown.has(userId))
    .map((userId): MergingPerson => {
      const member = listed.find((candidate) => candidate.userId === userId)?.member;
      return {
        userId,
        name: (member === undefined ? undefined : mateMemberName(member)) ?? LEFT_NAME,
        role: "no longer active",
        always: false,
      };
    });
  return [...people, ...left];
}

/** What an Owner or Admin is editing: the choice, and the people picked for the second one. */
export interface MergingDraft {
  readonly limited: boolean;
  /** Kept while "Everyone" is chosen, so choosing back loses no pick. */
  readonly people: ReadonlyArray<string>;
}

export const mergingDraft = (people: MergersPeople): MergingDraft => ({
  limited: people !== null,
  people: people ?? [],
});

/** The draft with one person picked or not. */
export function draftPicked(draft: MergingDraft, userId: string, picked: boolean): MergingDraft {
  const others = draft.people.filter((candidate) => candidate !== userId);
  return { ...draft, people: picked ? [...others, userId] : others };
}

/** Who merges where the project limits it: the Owner and Admins, and whoever it names. */
export const mergingNow = (
  people: ReadonlyArray<MergingPerson>,
  named: ReadonlyArray<string>,
): ReadonlyArray<MergingPerson> =>
  people.filter((person) => person.always || named.includes(person.userId));

/** What saving the draft sends: the people picked, or `null` to lift the limit. */
export const draftSends = (draft: MergingDraft): MergersPeople =>
  draft.limited ? draft.people : null;

/**
 * Whether Save has anything to send: the draft differs from what stands, and names no more people
 * than HQ takes. `tooMany` says the second in words.
 */
export function mergingSave(
  current: MergersPeople,
  draft: MergingDraft,
): { readonly enabled: boolean; readonly tooMany: string | undefined } {
  const sends = draftSends(draft);
  const over = sends !== null && sends.length > HQ_MERGERS_MAX;
  return {
    enabled: !over && !sameMergers(current, sends),
    tooMany: over ? `Pick at most ${String(HQ_MERGERS_MAX)} people.` : undefined,
  };
}
