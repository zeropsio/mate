/**
 * A project's access before it exists: what a creation dialog shows and sends. Its creator is
 * pinned first — full access, theirs by making it — and everyone else is whom the organization's
 * roles give it plus the grants chosen here, which the creation sends as the project's `userRoles`.
 *
 * The draft starts with the people who reach the app's other projects, at their highest level on
 * its places — or on its Mates, where it has no place, a Mate's own owner aside. A brand new app's
 * project starts with its creator and the roles alone.
 *
 * Pure: the member list and the app's grants arrive read.
 */
import type { ProjectGrantsRead } from "@t3tools/client-runtime/data";
import type { ZeropsOrganizationMember } from "@t3tools/client-runtime/zerops";
import { isTokenMember, mateMemberName } from "@t3tools/client-runtime/zerops/mateAccess";
import { withProjectGrant, type ProjectGrant } from "@t3tools/client-runtime/zerops/projectAccess";
import {
  asOrgRole,
  roleAtLeast,
  type RoleProjectKind,
  type ZeropsOrgRole,
} from "@t3tools/shared/zeropsRoles";

import { memberPicture } from "~/zerops/memberPicture";
import { zeropsInitials } from "../landing/ZeropsAccountControl.logic";
import {
  levelOf,
  projectPeople,
  type ChipLevel,
  type GivenLevel,
  type ProjectPeopleInput,
  type ProjectPeopleView,
  type ProjectPerson,
} from "./projectPeople.logic";

/** The project being made, as the draft's one project. */
export const DRAFT_PROJECT = "new-project";

export interface DraftInput {
  readonly members: ProjectPeopleInput["members"];
  /** What the new project is to its app. */
  readonly kind: RoleProjectKind;
  /** The app's other projects, their grants and whose each Mate is: what the draft starts from. */
  readonly app: Pick<ProjectPeopleInput, "projects" | "grants" | "owners">;
  readonly pictures: ProjectPeopleInput["pictures"];
  /** Who is making it: their membership, and their Zerops user id. */
  readonly creator: { readonly membershipId: string; readonly userId: string | null } | undefined;
  /** The grants chosen so far. */
  readonly list: ReadonlyArray<ProjectGrant>;
}

const RANK: ReadonlyArray<ZeropsOrgRole> = [
  "NO_ACCESS",
  "READ_ONLY",
  "BASIC_USER",
  "ADMIN",
  "OWNER",
];

/** Whether the organization role already gives `roleCode`: a grant naming it changes nothing. */
const roleGives = (orgRole: string | undefined, roleCode: string) =>
  levelOf(orgRole) === levelOf(roleCode);

/**
 * The grants a new project of the app starts with; `null` while the app's places are still read.
 */
export function draftPrefill(input: DraftInput): ReadonlyArray<ProjectGrant> | null {
  const { app } = input;
  const places = app.projects.filter(({ kind }) => kind !== "mate");
  if (places.some(({ projectId }) => app.grants[projectId]?.grants === undefined)) return null;
  const judged = places.length > 0 ? places : app.projects;
  return input.members.list.flatMap((member): Array<ProjectGrant> => {
    if (isTokenMember(member) || member.id === input.creator?.membershipId) return [];
    const userId = member.user?.id ?? member.userId;
    const roles = judged.flatMap(({ projectId }) => {
      if (userId !== undefined && app.owners[projectId] === userId) return [];
      const grant = grantOf(app.grants[projectId], member.id);
      if (grant === "OWNER") return [];
      return [asOrgRole(grant ?? member.roleCode)];
    });
    const best = roles.reduce<ZeropsOrgRole>(
      (high, role) => (RANK.indexOf(role) > RANK.indexOf(high) ? role : high),
      "NO_ACCESS",
    );
    if (best === "NO_ACCESS") return [];
    const roleCode = roleAtLeast(best, "ADMIN") ? "ADMIN" : best;
    return roleGives(member.roleCode, roleCode) ? [] : [{ clientUserId: member.id, roleCode }];
  });
}

/**
 * The prefill as a creation that asks nothing waits for it: the people read, the grants to send, or
 * a read that failed — a new project is never made without the people who reach the app.
 */
export type DraftPeople =
  | { readonly kind: "reading" }
  | { readonly kind: "ready"; readonly userRoles: ReadonlyArray<ProjectGrant> }
  | { readonly kind: "failed" };

export function draftPeople(input: DraftInput): DraftPeople {
  const { members, app } = input;
  // Someone the organization does not show its members to starts with no one but themselves.
  if (!members.known && !members.refused)
    return members.status === "failed" ? { kind: "failed" } : { kind: "reading" };
  const places = app.projects.filter(({ kind }) => kind !== "mate");
  const unread = (places.length > 0 ? places : app.projects).map(
    ({ projectId }) => app.grants[projectId],
  );
  if (unread.some((read) => read?.grants === undefined && read?.status === "failed"))
    return { kind: "failed" };
  const userRoles = draftPrefill(input);
  return userRoles === null ? { kind: "reading" } : { kind: "ready", userRoles };
}

const grantOf = (read: ProjectGrantsRead | undefined, clientUserId: string) =>
  read?.grants?.find((entry) => entry.clientUserId === clientUserId)?.roleCode;

/** The draft as chips: its creator first, then everyone the project will reach. */
export function draftView(input: DraftInput): ProjectPeopleView {
  const creatorMember = input.members.list.find(
    (member) => member.id === input.creator?.membershipId,
  );
  const view = projectPeople({
    members: {
      ...input.members,
      list: input.members.list.filter((member) => member !== creatorMember),
    },
    projects: [{ projectId: DRAFT_PROJECT, kind: input.kind }],
    grants: { [DRAFT_PROJECT]: { status: "ready", grants: input.list } },
    owners: {},
    pictures: input.pictures,
    viewerUserId: null,
    // Whoever makes the project chooses who reaches it: Zerops takes the list with the creation,
    // its creator being its owner. An organization owner's or admin's access there is changed only
    // by an organization owner, as on a project that exists: a creator below them, a Developer
    // too, brings people in as an admin does and leaves the owners' and admins' chips as they are.
    viewer: {
      roleCode: roleAtLeast(creatorMember?.roleCode, "OWNER") ? "OWNER" : "ADMIN",
      membershipId: input.creator?.membershipId ?? "",
    },
  });
  if (view.kind !== "people") return view;
  const chosen = (key: string) => input.list.some((entry) => entry.clientUserId === key);
  const people = view.people.map((person): ProjectPerson =>
    person.change === null
      ? person
      : {
          ...person,
          // An invitation is withdrawn on the Team page; here only a chosen grant goes.
          change: { ...person.change, end: chosen(person.key) ? "remove" : null },
        },
  );
  return { ...view, people: [creatorChip(creatorMember, input), ...people] };
}

function creatorChip(
  member: ZeropsOrganizationMember | undefined,
  input: DraftInput,
): ProjectPerson {
  const name = (member === undefined ? undefined : mateMemberName(member)) ?? "You";
  const userId = input.creator?.userId ?? undefined;
  const avatar = member?.user?.avatar;
  return {
    key: input.creator?.membershipId || "creator",
    userId,
    name,
    short: "You",
    initials: zeropsInitials(name),
    avatarUrl: memberPicture({
      hq: userId === undefined ? null : input.pictures[userId],
      avatar,
      email: member?.user?.email,
    }),
    email: member?.user?.email?.trim() || null,
    role: "Project creator",
    you: true,
    creator: true,
    pending: false,
    access: "Full access, as its creator",
    line: "Full access, as its creator",
    level: "full",
    note: null,
    change: null,
  };
}

/** The draft with one person's level chosen — or, `remove`, their chosen grant dropped. */
export function draftChoose(
  list: ReadonlyArray<ProjectGrant>,
  members: ReadonlyArray<ZeropsOrganizationMember>,
  clientUserId: string,
  choice: GivenLevel | "remove",
): ReadonlyArray<ProjectGrant> {
  const roleCode =
    choice === "remove"
      ? null
      : choice === "full"
        ? "ADMIN"
        : choice === "read"
          ? "READ_ONLY"
          : "NO_ACCESS";
  const orgRole = members.find((member) => member.id === clientUserId)?.roleCode;
  return withProjectGrant(
    list,
    clientUserId,
    roleCode === null || roleGives(orgRole, roleCode) ? null : roleCode,
  );
}

/**
 * Whether a creation dialog asks who reaches the new project: only where someone besides its
 * creator is on it or can be added — a person alone in the organization is asked nothing, and
 * nothing is drawn while the people are read.
 */
export function draftSpeaks(view: ProjectPeopleView): boolean {
  return (
    view.kind === "people" &&
    (view.people.length > 1 || (view.invite && view.candidates.length > 0))
  );
}

/** A level as a sentence says it: "with Full access". */
const LEVEL_PHRASE: Readonly<Record<ChipLevel, string>> = {
  full: "Full access",
  basic: "more than Read access",
  read: "Read access",
  hidden: "no access",
};

const LEVEL_ORDER: ReadonlyArray<ChipLevel> = ["full", "basic", "read"];

/** "Ada", "Ada and Bo": a level's people named, the creator as you. */
const named = (people: ReadonlyArray<ProjectPerson>) =>
  people.map((person) => (person.creator ? "you" : person.short)).join(" and ");

/**
 * Who can open a new project, in one line, from the people the draft shows: everyone in the
 * organization or how many of them, then how many at each level — the most common counted, a level
 * of one or two named. `changes` counts the people whose access the person changed here from where
 * the draft started; `null` while the people are read.
 */
export function draftSummary(input: {
  readonly view: ProjectPeopleView;
  /** The organization's name; `null` before it is read. */
  readonly organization: string | null;
  /** Where the draft started (`draftPrefill`). */
  readonly prefill: ReadonlyArray<ProjectGrant> | null;
  /** The draft now. */
  readonly list: ReadonlyArray<ProjectGrant>;
}): { readonly line: string; readonly changes: string | null } | null {
  const { view } = input;
  if (view.kind !== "people") return null;
  const changed = draftChangeCount(input.prefill ?? [], input.list);
  const changes = changed === 0 ? null : changed === 1 ? "1 change" : `${String(changed)} changes`;
  const openers = view.people.filter((person) => person.level !== "hidden");
  if (openers.length <= 1) return { line: "Only you can open it.", changes };
  const total = view.people.length + view.candidates.length;
  const organization = input.organization ?? "the organization";
  const head =
    openers.length === total
      ? `Everyone in ${organization} can open it`
      : `${String(openers.length)} of ${String(total)} people in ${organization} can open it`;
  const groups = LEVEL_ORDER.flatMap((level) => {
    const people = openers.filter((person) => person.level === level);
    return people.length === 0 ? [] : [{ level, people }];
  }).toSorted((a, b) => b.people.length - a.people.length);
  const [first] = groups;
  if (groups.length === 1 && first !== undefined)
    return { line: `${head} with ${LEVEL_PHRASE[first.level]}.`, changes };
  const parts = groups.map(
    ({ level, people }, index) =>
      `${index > 0 && people.length <= 2 ? named(people) : String(people.length)} with ${LEVEL_PHRASE[level]}`,
  );
  return { line: `${head}: ${parts.join(", ")}.`, changes };
}

/** How many people's grant differs between two drafts. */
function draftChangeCount(
  from: ReadonlyArray<ProjectGrant>,
  to: ReadonlyArray<ProjectGrant>,
): number {
  const role = (list: ReadonlyArray<ProjectGrant>, clientUserId: string) =>
    list.find((entry) => entry.clientUserId === clientUserId)?.roleCode;
  const people = new Set([...from, ...to].map((entry) => entry.clientUserId));
  return [...people].filter((clientUserId) => role(from, clientUserId) !== role(to, clientUserId))
    .length;
}
