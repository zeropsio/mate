/**
 * The organization's team, in words: every person in it — never an integration token — with their
 * role, and what that reaches. An owner or an admin reaches everything; someone who works on or
 * sees every project says so by their role; a developer or a guest reaches the projects their own
 * grants name, each Mate project (an HQ group) once, a Zerops project outside any by its own name.
 *
 * Pure: the member list, each developer's and guest's grants and where each project belongs
 * arrive read.
 */
import type { ZeropsOrganizationMember } from "@t3tools/client-runtime/zerops";
import type { ProjectGrantEntry } from "@t3tools/client-runtime/zerops/appAccess";
import { isTokenMember, mateMemberName } from "@t3tools/client-runtime/zerops/mateAccess";
import {
  invitableTeamRoles,
  membershipOf,
  teamActions,
  teamRoleOf,
  type OrgMembership,
  type TeamRole,
} from "@t3tools/client-runtime/zerops/teamRoles";
import { asOrgRole, ZEROPS_ACTIVE_MEMBER_STATUS } from "@t3tools/shared/zeropsRoles";

import { memberPicture } from "~/zerops/memberPicture";
import { zeropsInitials } from "../zerops/landing/ZeropsAccountControl.logic";
import { UNREADABLE } from "../zerops/projects/projectPeople.logic";

/** Where a person's grant leads: a Mate project, or a Zerops project outside any. */
export interface TeamPlace {
  /** The group's id, or the project's own where it is in none. */
  readonly key: string;
  readonly name: string;
  /** The Mate project, whose page is where access to it is changed; `null` outside any. */
  readonly groupId: string | null;
}

export interface TeamInput {
  /** The organization's member list as the data layer holds it. */
  readonly members: {
    readonly known: boolean;
    readonly status: "loading" | "ready" | "failed";
    readonly refused: boolean;
    readonly list: ReadonlyArray<ZeropsOrganizationMember>;
  };
  /** Each developer's and guest's own grants, by membership id. */
  readonly grants: Readonly<
    Record<
      string,
      {
        readonly status: "loading" | "ready" | "failed";
        readonly value?: ReadonlyArray<ProjectGrantEntry> | undefined;
      }
    >
  >;
  /** Where each Zerops project the viewer can name belongs, by project id. */
  readonly places: Readonly<Record<string, TeamPlace>>;
  /** HQ's picture of a person, by Zerops user id. */
  readonly pictures: Readonly<Record<string, string | null | undefined>>;
  readonly viewerUserId: string | null;
  /** Who is looking, as their membership names them; absent while it is not known. */
  readonly viewer?: { readonly roleCode?: string; readonly membershipId: string } | undefined;
}

/** What a person reaches; `null` while it is not known. */
export type TeamReach =
  | { readonly kind: "everything" }
  | {
      readonly kind: "projects";
      /** The projects the viewer can name, by name. */
      readonly projects: ReadonlyArray<TeamPlace>;
      /** Projects the viewer can't name, counted. */
      readonly unnamed: number;
    };

/** What the viewer may change of a person's place on the team. */
export interface TeamChange {
  readonly clientUserId: string;
  /** Their preset now; `null` for a Zerops role no preset names. */
  readonly current: TeamRole | null;
  /** The presets the viewer may give them. */
  readonly roles: ReadonlyArray<TeamRole>;
  readonly end: "remove" | "withdraw";
}

export interface TeamPerson {
  /** The membership id. */
  readonly key: string;
  readonly userId: string | undefined;
  readonly name: string;
  readonly email: string | null;
  /** When they joined or were invited, as Zerops dates it; `null` where it doesn't. */
  readonly created: string | null;
  /** Their role as a card's badge: a preset's name, else Zerops's role in words. */
  readonly badge: string;
  /** Their membership whole, as the person page edits it. */
  readonly membership: OrgMembership;
  readonly initials: string;
  readonly avatarUrl: string | null;
  readonly you: boolean;
  /** Not joined yet: an invitation. */
  readonly pending: boolean;
  /** Their role, in words. */
  readonly role: string;
  readonly reach: TeamReach | null;
  /** The second line: an invitation first, their role, then what they reach. */
  readonly line: string;
  readonly change: TeamChange | null;
}

export type TeamView =
  | { readonly kind: "reading" }
  | { readonly kind: "unreadable"; readonly line: string }
  | {
      readonly kind: "people";
      readonly people: ReadonlyArray<TeamPerson>;
      /** "12 people". */
      readonly count: string;
      /** The roles the viewer may invite someone as; none, and nobody is invited here. */
      readonly invite: ReadonlyArray<TeamRole>;
    };

/** Each preset's name, as a card's badge and a person's role say it. */
export const TEAM_ROLE_WORDS: Readonly<Record<TeamRole, string>> = {
  owner: "Owner",
  admin: "Admin",
  developer: "Developer",
  guest: "Guest",
};

/** A Zerops role in plain words, as *Advanced* names it. */
export const ROLE_CODE_WORDS = {
  OWNER: "Owner",
  ADMIN: "Admin",
  BASIC_USER: "Basic user",
  READ_ONLY: "Read only",
  NO_ACCESS: "No access",
} as const;

const ROLE_WORDS = {
  OWNER: "Owner",
  ADMIN: "Admin",
  BASIC_USER: "Works on every project",
  READ_ONLY: "Sees every project",
} as const;

/** Whether a membership's role reaches no project by itself: its grants say what it reaches. */
const byGrants = (member: ZeropsOrganizationMember) =>
  !isTokenMember(member) && asOrgRole(member.roleCode) === "NO_ACCESS";

/** The memberships whose own grants the team names: every developer and guest. */
export const teamGrantIds = (
  list: ReadonlyArray<ZeropsOrganizationMember>,
): ReadonlyArray<string> => list.flatMap((member) => (byGrants(member) ? [member.id] : []));

/** "a", "a and b". */
const listed = (words: ReadonlyArray<string>): string =>
  words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;

/** What a person reaches, in words: "everything", "on Snap and Beviro", "on 3 projects". */
export function reachWords(reach: TeamReach): string {
  if (reach.kind === "everything") return "everything";
  const total = reach.projects.length + reach.unnamed;
  if (total === 0) return "no projects yet";
  if (reach.unnamed === 0 && total <= 2)
    return `on ${listed(reach.projects.map(({ name }) => name))}`;
  return `on ${total} projects`;
}

function reachOf(member: ZeropsOrganizationMember, input: TeamInput): TeamReach | null {
  const role = asOrgRole(member.roleCode);
  if (role === "OWNER" || role === "ADMIN") return { kind: "everything" };
  if (role !== "NO_ACCESS") return null;
  const read = input.grants[member.id];
  if (read?.status !== "ready" || read.value === undefined) return null;
  const places = new Map<string, TeamPlace>();
  const unnamed = new Set<string>();
  for (const { projectId, roleCode } of read.value) {
    if (asOrgRole(roleCode) === "NO_ACCESS") continue;
    const place = input.places[projectId];
    if (place === undefined) unnamed.add(projectId);
    else places.set(place.key, place);
  }
  return {
    kind: "projects",
    projects: [...places.values()].toSorted((a, b) => a.name.localeCompare(b.name)),
    unnamed: unnamed.size,
  };
}

const rankOf = (roleCode: string | undefined) =>
  ({ OWNER: 0, ADMIN: 1 })[asOrgRole(roleCode) as "OWNER" | "ADMIN"] ?? 2;

export function teamPeople(input: TeamInput): TeamView {
  const { members } = input;
  if (members.refused) return { kind: "unreadable", line: UNREADABLE.refused };
  if (!members.known)
    return members.status === "failed"
      ? { kind: "unreadable", line: UNREADABLE.failed }
      : { kind: "reading" };

  const ranked = members.list.flatMap((member) => {
    // Every integration token is a membership too; tokens are HQ's, never people here.
    if (isTokenMember(member)) return [];
    const userId = member.user?.id ?? member.userId;
    const name = mateMemberName(member) ?? "Someone";
    const pending = (member.status ?? ZEROPS_ACTIVE_MEMBER_STATUS) !== ZEROPS_ACTIVE_MEMBER_STATUS;
    const preset = teamRoleOf(member);
    const role =
      preset === "developer" || preset === "guest"
        ? TEAM_ROLE_WORDS[preset]
        : ROLE_WORDS[asOrgRole(member.roleCode) as keyof typeof ROLE_WORDS];
    const reach = reachOf(member, input);
    const actions = teamActions({
      viewer: input.viewer,
      member: {
        id: member.id,
        ...(member.roleCode === undefined ? {} : { roleCode: member.roleCode }),
        pending,
      },
    });
    const avatar = member.user?.avatar;
    const person: TeamPerson = {
      key: member.id,
      userId,
      name,
      email: member.user?.email?.trim() || null,
      created: member.created ?? null,
      badge:
        preset === null ? ROLE_CODE_WORDS[asOrgRole(member.roleCode)] : TEAM_ROLE_WORDS[preset],
      membership: membershipOf(member),
      initials: zeropsInitials(name),
      avatarUrl: memberPicture({
        hq: userId === undefined ? null : input.pictures[userId],
        avatar,
        email: member.user?.email,
      }),
      you: userId !== undefined && userId === input.viewerUserId,
      pending,
      role,
      reach,
      line: [
        ...(pending ? ["Invited · not joined yet"] : []),
        role,
        ...(reach === null ? [] : [reachWords(reach)]),
      ].join(" · "),
      change:
        actions === null
          ? null
          : { clientUserId: member.id, current: preset, roles: actions.roles, end: actions.end },
    };
    return [{ person, rank: [person.you ? 0 : 1, pending ? 1 : 0, rankOf(member.roleCode)] }];
  });

  const people = ranked
    .toSorted((a, b) => {
      for (const [index, value] of a.rank.entries()) {
        const other = b.rank[index]!;
        if (value !== other) return value - other;
      }
      return a.person.name.localeCompare(b.person.name);
    })
    .map(({ person }) => person);
  return {
    kind: "people",
    people,
    count: people.length === 1 ? "1 person" : `${people.length} people`,
    invite: input.viewer === undefined ? [] : invitableTeamRoles(input.viewer.roleCode),
  };
}

/** How the team is ordered: when each joined, either way, or by name. */
export type TeamSort = "created-asc" | "created-desc" | "name";

export const TEAM_SORT_WORDS: Readonly<Record<TeamSort, string>> = {
  "created-asc": "Oldest first",
  "created-desc": "Newest first",
  name: "By name",
};

/**
 * The people a search and an order leave: a name or an e-mail containing what was typed, any case;
 * ordered by when they joined — someone Zerops doesn't date last — or by name.
 */
export function shownTeam(
  people: ReadonlyArray<TeamPerson>,
  query: string,
  sort: TeamSort,
): ReadonlyArray<TeamPerson> {
  const needle = query.trim().toLocaleLowerCase();
  const found =
    needle === ""
      ? people
      : people.filter(
          ({ name, email }) =>
            name.toLocaleLowerCase().includes(needle) ||
            (email?.toLocaleLowerCase().includes(needle) ?? false),
        );
  const byName = (a: TeamPerson, b: TeamPerson) => a.name.localeCompare(b.name);
  if (sort === "name") return found.toSorted(byName);
  const direction = sort === "created-asc" ? 1 : -1;
  return found.toSorted((a, b) => {
    if (a.created === b.created) return byName(a, b);
    if (a.created === null) return 1;
    if (b.created === null) return -1;
    return direction * a.created.localeCompare(b.created);
  });
}
