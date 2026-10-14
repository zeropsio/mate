/**
 * Who reaches some Zerops projects, and how: the organization's members joined with the grants on
 * each — an app's production, stages and Mates, or one project alone. Each person is a chip: their
 * level on the places (production and stages), or on the Mates where there is no place — or where
 * they reach none of the places; `mixed` where it differs. A Mate is its owner's: no change here
 * touches it.
 *
 * Zerops grants access per Zerops project: the organization role, unless a project names its own
 * grant for the member (`userRoles`), which wins in both directions (`effectiveProjectRole`).
 *
 * Pure: the member list, the grants and whose each Mate is arrive read.
 */
import type { ProjectGrantsRead } from "@t3tools/client-runtime/data";
import type { ZeropsOrganizationMember } from "@t3tools/client-runtime/zerops";
import { appAccessActions, type AppProjects } from "@t3tools/client-runtime/zerops/appAccess";
import type {
  ProjectAccessChange,
  ProjectAccessRole,
} from "@t3tools/client-runtime/zerops/projectAccess";
import { isTokenMember, mateMemberName } from "@t3tools/client-runtime/zerops/mateAccess";
import {
  asOrgRole,
  isMateKind,
  roleAtLeast,
  ZEROPS_ACTIVE_MEMBER_STATUS,
  type RoleProjectKind,
  type ZeropsOrgRole,
} from "@t3tools/shared/zeropsRoles";

import { zeropsInitials } from "../landing/ZeropsAccountControl.logic";

export interface ProjectPeopleInput {
  /** The organization's member list as the data layer holds it. */
  readonly members: {
    /** A read answered it once; its people stand through a later read's failure. */
    readonly known: boolean;
    readonly status: "loading" | "ready" | "failed";
    readonly refused: boolean;
    readonly list: ReadonlyArray<ZeropsOrganizationMember>;
  };
  /** The projects whose access is shown: an app's, as HQ's structure places them, or one alone. */
  readonly projects: ReadonlyArray<{
    readonly projectId: string;
    readonly kind: RoleProjectKind;
    /** The project's own name, for a kind the group has several of. */
    readonly name?: string;
  }>;
  /** Each place's grants, by project id. */
  readonly grants: Readonly<Record<string, ProjectGrantsRead>>;
  /** Whose each Mate is, by project id, as HQ names its owner (a Zerops user id). */
  readonly owners: Readonly<Record<string, string | null | undefined>>;
  /** HQ's picture of a person, by Zerops user id: the one the menu draws a Mate's owner with. */
  readonly pictures: Readonly<Record<string, string | null | undefined>>;
  readonly viewerUserId: string | null;
  /** Who is looking, as their membership names them; absent while it is not known. */
  readonly viewer?: { readonly roleCode?: string; readonly membershipId: string } | undefined;
}

/** A level a chip shows: full access, a developer's, read only — or different from place to place. */
export type AccessLevel = "full" | "basic" | "read";
export type ChipLevel = AccessLevel | "mixed";

/** The two levels a person can be given here. */
export type GivenLevel = "full" | "read";

/** What the viewer may change of one person's access here. */
export interface PersonChange {
  /** Their membership (`clientUser`) id. */
  readonly clientUserId: string;
  /** The level they have here now. */
  readonly level: ChipLevel;
  /** The levels they may be given: both, or — an owner or admin lowered — only full back. */
  readonly levels: ReadonlyArray<GivenLevel>;
  /**
   * The way out: `remove` drops their own grants here, so their organization role decides again;
   * `withdraw` ends an invitation's access here. `null` where there is nothing of theirs to drop.
   */
  readonly end: "remove" | "withdraw" | null;
  /** The Mates here they own, which no change touches. */
  readonly owned: ReadonlyArray<string>;
}

/** Who someone is, as a face and a name: a chip, or a row to add. */
export interface PersonFace {
  readonly userId: string | undefined;
  readonly name: string;
  /** "Ada L.": a chip's name. */
  readonly short: string;
  readonly initials: string;
  readonly avatarUrl: string | null;
  readonly email: string | null;
  /** Who they are to the organization, in a word: "Owner", "Developer"… */
  readonly role: string;
}

export interface ProjectPerson extends PersonFace {
  /** The membership id: one chip per membership. */
  readonly key: string;
  readonly you: boolean;
  /** The one making the project: pinned first in a creation's draft. */
  readonly creator: boolean;
  /** Not joined yet: an invitation. */
  readonly pending: boolean;
  /** What they may do here, in words; `null` where they reach only Mates here. */
  readonly access: string | null;
  /** Access, then their Mates here, an invitation first. */
  readonly line: string;
  /** The chip's badge. */
  readonly level: ChipLevel;
  /** Each project and their level there, where the levels differ. */
  readonly across: ReadonlyArray<{ readonly label: string; readonly level: AccessLevel | null }>;
  /** What the viewer may change of their access; `null` for nothing. */
  readonly change: PersonChange | null;
}

/** A member who reaches none of these projects: someone access can be added for. */
export interface AccessCandidate extends PersonFace {
  readonly clientUserId: string;
  readonly pending: boolean;
}

export type ProjectPeopleView =
  | { readonly kind: "reading" }
  | { readonly kind: "unreadable"; readonly line: string }
  | {
      readonly kind: "people";
      readonly people: ReadonlyArray<ProjectPerson>;
      /** The viewer may add people: an organization owner or admin. */
      readonly invite: boolean;
      /** The members who reach none of these projects, by name. */
      readonly candidates: ReadonlyArray<AccessCandidate>;
    };

type Access = "full" | "read" | "none";

const accessOf = (role: ZeropsOrgRole): Access =>
  roleAtLeast(role, "BASIC_USER") ? "full" : role === "READ_ONLY" ? "read" : "none";

/** A role's badge: an owner's is an admin's, full access; none for no access. */
export const levelOf = (role: string | undefined): AccessLevel | null => {
  const held = asOrgRole(role);
  if (roleAtLeast(held, "ADMIN")) return "full";
  return held === "BASIC_USER" ? "basic" : held === "READ_ONLY" ? "read" : null;
};

/** Who someone is to the organization, in a word. */
const ORG_ROLE_WORDS: Readonly<Record<ZeropsOrgRole, string>> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  BASIC_USER: "Developer",
  READ_ONLY: "Read only",
  NO_ACCESS: "Member",
};

/** "Ada L." — a first name and the last name's initial; a single word or an address as it is. */
export function shortName(name: string): string {
  if (name.includes("@")) return name;
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name.trim();
  return `${parts[0]} ${parts.at(-1)!.charAt(0).toLocaleUpperCase()}.`;
}

/** A role's words, and what it reaches when no place here says otherwise. */
const ROLE_WORDS: Partial<
  Record<ZeropsOrgRole, { readonly role: string; readonly reach?: string }>
> = {
  OWNER: { role: "Owner", reach: "everything" },
  ADMIN: { role: "Admin", reach: "everything" },
  BASIC_USER: { role: "Works on every project" },
  READ_ONLY: { role: "Sees every project" },
};

const PLACE_ORDER: Readonly<Record<string, number>> = { production: 0, stage: 1, devstage: 2 };
const KIND_WORD: Readonly<Record<string, string>> = {
  production: "Production",
  stage: "Stage",
  devstage: "Dev / Stage",
};

interface Place {
  readonly projectId: string;
  /** "Production", or the project's own name where the group has several of its kind. */
  readonly label: string;
  /** The label inside a sentence: a kind's word in lower case, a name as it is. */
  readonly inSentence: string;
}

function placesOf(projects: ProjectPeopleInput["projects"]): ReadonlyArray<Place> {
  const places = projects
    .filter(({ kind }) => kind !== "mate")
    .toSorted((a, b) => (PLACE_ORDER[a.kind] ?? 9) - (PLACE_ORDER[b.kind] ?? 9));
  return places.map(({ projectId, kind, name }) => {
    const several = places.filter((other) => other.kind === kind).length > 1;
    const word = KIND_WORD[kind] ?? kind;
    return several && name !== undefined
      ? { projectId, label: name, inSentence: name }
      : { projectId, label: word, inSentence: word.toLocaleLowerCase() };
  });
}

/** The projects as access to them is granted: where the app runs, and its Mates. */
export const appProjectsOf = (projects: ProjectPeopleInput["projects"]): AppProjects => ({
  places: projects.flatMap(({ projectId, kind }) => (kind === "mate" ? [] : [projectId])),
  mates: projects.flatMap(({ projectId, kind }) => (kind === "mate" ? [projectId] : [])),
});

/** "a", "a and b", "a, b and c". */
const listed = (words: ReadonlyArray<string>): string =>
  words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;

/** The menu's own words for each level, so a row says what its menu would set. */
const EXCEPTION_WORDS: Readonly<Record<Access, string>> = {
  full: "works on",
  read: "only looks at",
  none: "no access to",
};

/** What a member may do here, in words; `null` where they may touch none of its places. */
function accessWords(
  role: ZeropsOrgRole,
  onPlaces: ReadonlyArray<{ readonly place: Place; readonly access: Access }>,
): string | null {
  const words = ROLE_WORDS[role];
  if (words !== undefined) {
    const base = accessOf(role);
    const exceptions = (["full", "read", "none"] as const).flatMap((access) => {
      const differing = onPlaces.filter((one) => one.access === access && access !== base);
      return differing.length === 0
        ? []
        : [`${EXCEPTION_WORDS[access]} ${listed(differing.map(({ place }) => place.inSentence))}`];
    });
    // "Admin · only looks at production": an exception stands where "everything" would.
    return [
      words.role,
      ...(exceptions.length === 0 && words.reach !== undefined ? [words.reach] : exceptions),
    ].join(" · ");
  }
  const reached = onPlaces.filter(({ access }) => access !== "none");
  if (reached.length === 0) return null;
  const alike =
    reached.length === onPlaces.length && reached.every((one) => one.access === reached[0]!.access);
  if (alike) return reached[0]!.access === "full" ? "Can work on it" : "Can only look";
  // "Works on stage · only looks at production": what they work on first, then what they see.
  const by = (access: Access) =>
    reached.filter((one) => one.access === access).map(({ place }) => place.inSentence);
  const works = by("full");
  const looks = by("read");
  const said = [
    ...(works.length === 0 ? [] : [`works on ${listed(works)}`]),
    ...(looks.length === 0 ? [] : [`only looks at ${listed(looks)}`]),
  ].join(" · ");
  return said.charAt(0).toUpperCase() + said.slice(1);
}

export const UNREADABLE = {
  refused: "Zerops doesn’t show you this organization’s members.",
  failed: "Couldn’t read this organization’s members.",
};

export function projectPeople(input: ProjectPeopleInput): ProjectPeopleView {
  const { members } = input;
  if (members.refused) return { kind: "unreadable", line: UNREADABLE.refused };
  if (!members.known)
    return members.status === "failed"
      ? { kind: "unreadable", line: UNREADABLE.failed }
      : { kind: "reading" };

  const places = placesOf(input.projects);
  for (const place of places) {
    const read = input.grants[place.projectId];
    if (read?.grants !== undefined) continue;
    if (read?.status === "failed")
      return { kind: "unreadable", line: `Couldn’t read who has access to ${place.inSentence}.` };
    return { kind: "reading" };
  }
  // A Mate's grants count once read; until then its owner stands for it.
  const mates = input.projects.flatMap(({ projectId, kind, name }) =>
    kind === "mate" ? [{ projectId, label: name ?? "Mate" }] : [],
  );

  const mateOwners = input.projects.flatMap(({ projectId, kind }) => {
    const owner = input.owners[projectId];
    return isMateKind(kind) && owner != null ? [owner] : [];
  });
  const viewerAdmin = input.viewer !== undefined && roleAtLeast(input.viewer.roleCode, "ADMIN");

  const candidates: Array<AccessCandidate> = [];
  const ranked = members.list.flatMap((member) => {
    // Every integration token is a membership too; tokens are HQ's, never people here.
    if (isTokenMember(member)) return [];
    const role = asOrgRole(member.roleCode);
    const userId = member.user?.id ?? member.userId;
    const grantOf = (projectId: string) =>
      input.grants[projectId]?.grants?.find(({ clientUserId }) => clientUserId === member.id)
        ?.roleCode;
    const roleOn = (projectId: string) => asOrgRole(grantOf(projectId) ?? role);
    const owned = input.projects.flatMap(({ projectId, kind }) =>
      isMateKind(kind) &&
      ((userId !== undefined && input.owners[projectId] === userId) ||
        grantOf(projectId) === "OWNER")
        ? [projectId]
        : [],
    );
    const onPlaces = places.map((place) => ({
      place,
      access: accessOf(roleOn(place.projectId)),
    }));
    const onMates = mates.flatMap((mate) => {
      const level = levelOf(owned.includes(mate.projectId) ? "OWNER" : roleOn(mate.projectId));
      return level === null ? [] : [{ ...mate, level }];
    });
    const name = mateMemberName(member) ?? "Someone";
    const pending = (member.status ?? ZEROPS_ACTIVE_MEMBER_STATUS) !== ZEROPS_ACTIVE_MEMBER_STATUS;
    const avatar = member.user?.avatar;
    const face: PersonFace = {
      userId,
      name,
      short: shortName(name),
      initials: zeropsInitials(name),
      avatarUrl:
        (userId === undefined ? null : input.pictures[userId]) ||
        avatar?.smallAvatarUrl ||
        avatar?.externalAvatarUrl ||
        avatar?.largeAvatarUrl ||
        null,
      email: member.user?.email?.trim() || null,
      role: ORG_ROLE_WORDS[role],
    };
    const access = accessWords(role, onPlaces);
    if (access === null && onMates.length === 0) {
      candidates.push({ ...face, clientUserId: member.id, pending });
      return [];
    }

    // The badge: on the places, or on the Mates where there is none — or none they reach.
    const placeLevels = places.map((place) => levelOf(roleOn(place.projectId)));
    const judged = placeLevels.some((level) => level !== null)
      ? placeLevels
      : onMates.map(({ level }) => level);
    const first = judged[0] ?? levelOf(role);
    const level: ChipLevel =
      first !== null && judged.every((one) => one === first) ? first : "mixed";
    const across =
      level === "mixed"
        ? [
            ...places.map((place) => ({
              label: place.label,
              level: levelOf(roleOn(place.projectId)),
            })),
            ...mates.map((mate) => ({
              label: mate.label,
              level: onMates.find((one) => one.projectId === mate.projectId)?.level ?? null,
            })),
          ]
        : [];

    const mateCount = mateOwners.filter((owner) => owner === userId).length;
    const said = access ?? mateWords(onMates.filter((one) => !owned.includes(one.projectId)));
    const actions = appAccessActions({
      viewer: input.viewer,
      member: {
        id: member.id,
        ...(member.roleCode === undefined ? {} : { roleCode: member.roleCode }),
        pending,
      },
    });
    // Their own grants here, which removing drops: never on a Mate of theirs.
    const own = input.projects.some(
      ({ projectId }) => !owned.includes(projectId) && grantOf(projectId) !== undefined,
    );
    const self = input.viewer !== undefined && member.id === input.viewer.membershipId;
    const change: PersonChange | null =
      actions !== null
        ? {
            clientUserId: member.id,
            level,
            levels: ["full", "read"],
            end: pending ? "withdraw" : own ? "remove" : null,
            owned,
          }
        : // An owner or admin lowered somewhere here: only the way back to full.
          viewerAdmin && !self && roleAtLeast(role, "ADMIN") && own && level !== "full"
          ? { clientUserId: member.id, level, levels: ["full"], end: null, owned }
          : null;

    // What they may do here: on its places, or by their role where it has none yet.
    const best = Math.min(
      ...(onPlaces.length === 0 ? [accessOf(role)] : onPlaces.map((one) => one.access)).map(
        (one) => (one === "full" ? 0 : one === "read" ? 1 : 2),
      ),
    );
    const person: ProjectPerson = {
      ...face,
      key: member.id,
      you: userId !== undefined && userId === input.viewerUserId,
      creator: false,
      pending,
      access,
      line: [
        ...(pending ? ["Invited · not joined yet"] : []),
        ...(said === null ? [] : [said]),
        ...(mateCount === 0 ? [] : [mateCount === 1 ? "1 Mate" : `${mateCount} Mates`]),
      ].join(" · "),
      level,
      across,
      change,
    };
    return [{ person, rank: [person.you ? 0 : 1, pending ? 1 : 0, best, -roleRank(role)] }];
  });

  return {
    kind: "people",
    invite: viewerAdmin,
    candidates: candidates.toSorted((a, b) => a.name.localeCompare(b.name)),
    people: ranked
      .toSorted((a, b) => {
        for (const [index, value] of a.rank.entries()) {
          const other = b.rank[index]!;
          if (value !== other) return value - other;
        }
        return a.person.name.localeCompare(b.person.name);
      })
      .map(({ person }) => person),
  };
}

/** What someone reaching only Mates here may do on them: "Works on Fen · only looks at Juno". */
function mateWords(
  onMates: ReadonlyArray<{ readonly label: string; readonly level: AccessLevel }>,
): string | null {
  const works = onMates.filter(({ level }) => level !== "read").map(({ label }) => label);
  const looks = onMates.filter(({ level }) => level === "read").map(({ label }) => label);
  const said = [
    ...(works.length === 0 ? [] : [`works on ${listed(works)}`]),
    ...(looks.length === 0 ? [] : [`only looks at ${listed(looks)}`]),
  ].join(" · ");
  return said === "" ? null : said.charAt(0).toUpperCase() + said.slice(1);
}

const RANKS: ReadonlyArray<ZeropsOrgRole> = [
  "NO_ACCESS",
  "READ_ONLY",
  "BASIC_USER",
  "ADMIN",
  "OWNER",
];
const roleRank = (role: ZeropsOrgRole): number => RANKS.indexOf(role);

export type PersonMenuEntry =
  | {
      readonly kind: "level";
      readonly level: GivenLevel;
      readonly label: string;
      readonly checked: boolean;
    }
  | {
      readonly kind: "end";
      readonly end: NonNullable<PersonChange["end"]>;
      readonly label: string;
    };

export const LEVEL_WORDS: Readonly<Record<GivenLevel, string>> = {
  full: "Give full access",
  read: "Make read only",
};

/** A badge in words, for a hover card's list and for a screen reader. */
export const BADGE_WORDS: Readonly<Record<ChipLevel, string>> = {
  full: "Full",
  basic: "Basic",
  read: "Read",
  mixed: "Mixed",
};

/** A person's menu: the levels they may be given, theirs checked, then the way out. */
export function personMenu(change: PersonChange): ReadonlyArray<PersonMenuEntry> {
  return [
    ...change.levels.map((level) => ({
      kind: "level" as const,
      level,
      label: LEVEL_WORDS[level],
      checked: change.level === level,
    })),
    ...(change.end === null
      ? []
      : [
          {
            kind: "end" as const,
            end: change.end,
            label: change.end === "withdraw" ? "Withdraw invite" : "Remove access",
          },
        ]),
  ];
}

const GIVEN_ROLE: Readonly<Record<GivenLevel, ProjectAccessRole>> = {
  full: "ADMIN",
  read: "READ_ONLY",
};

/**
 * What one menu choice — or adding someone — writes: their grant on every project here but the
 * Mates they own, a level or, removing, none of their own.
 */
export function accessChanges(input: {
  readonly clientUserId: string;
  readonly projectIds: ReadonlyArray<string>;
  readonly owned: ReadonlyArray<string>;
  readonly choice: GivenLevel | "remove";
}): ReadonlyArray<ProjectAccessChange> {
  const roleCode = input.choice === "remove" ? null : GIVEN_ROLE[input.choice];
  return input.projectIds.flatMap((projectId) =>
    input.owned.includes(projectId)
      ? []
      : [{ clientUserId: input.clientUserId, projectId, roleCode }],
  );
}
