/**
 * Who can work on a project, and how, in words: the organization's members joined with the grants
 * on the project's places — its production, stages and the Mate serving as stage. A Mate is its
 * owner's; a grant on one opens nothing else, so Mates are only counted, never judged.
 *
 * Zerops grants access per Zerops project: the organization role, unless a project names its own
 * grant for the member (`userRoles`), which wins in both directions (`effectiveProjectRole`).
 *
 * Pure: the member list, the grants and whose each Mate is arrive read.
 */
import type { ProjectGrantsRead } from "@t3tools/client-runtime/data";
import type { ZeropsOrganizationMember } from "@t3tools/client-runtime/zerops";
import {
  appAccessActions,
  appAccessLevel,
  type AppAccessLevel,
  type AppProjects,
} from "@t3tools/client-runtime/zerops/appAccess";
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
  /** The group's projects, as HQ's structure places them. */
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

/** What the viewer may change of one person's access here. */
export interface PersonChange {
  /** Their membership (`clientUser`) id. */
  readonly clientUserId: string;
  /** The level they have here now; `null` where it is neither. */
  readonly level: AppAccessLevel | null;
  /** The way out: `remove` a member, `withdraw` an invitation. */
  readonly end: "remove" | "withdraw";
  /** The Mates here they own, which no change touches. */
  readonly owned: ReadonlyArray<string>;
}

export interface ProjectPerson {
  /** The membership id: one row per membership. */
  readonly key: string;
  readonly userId: string | undefined;
  readonly name: string;
  readonly initials: string;
  readonly avatarUrl: string | null;
  readonly you: boolean;
  /** Not joined yet: an invitation. */
  readonly pending: boolean;
  /** What they may do here, in words. */
  readonly access: string;
  /** The second line: access, then their Mates here, an invitation first. */
  readonly line: string;
  /** What the viewer may change of their access; `null` for nothing. */
  readonly change: PersonChange | null;
}

export type ProjectPeopleView =
  | { readonly kind: "reading" }
  | { readonly kind: "unreadable"; readonly line: string }
  | {
      readonly kind: "people";
      readonly people: ReadonlyArray<ProjectPerson>;
      /** The viewer may invite someone: an organization owner or admin. */
      readonly invite: boolean;
    };

type Access = "full" | "read" | "none";

const accessOf = (role: ZeropsOrgRole): Access =>
  roleAtLeast(role, "BASIC_USER") ? "full" : role === "READ_ONLY" ? "read" : "none";

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

/** The group's projects as access to it is granted: where it runs, and its other Mates. */
export const appProjectsOf = (projects: ProjectPeopleInput["projects"]): AppProjects => ({
  places: projects.flatMap(({ projectId, kind }) => (kind === "mate" ? [] : [projectId])),
  mates: projects.flatMap(({ projectId, kind }) => (kind === "mate" ? [projectId] : [])),
});

/** "a", "a and b", "a, b and c". */
const listed = (words: ReadonlyArray<string>): string =>
  words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;

const EXCEPTION_WORDS: Readonly<Record<Access, string>> = {
  full: "full access on",
  read: "read only on",
  none: "no access on",
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
    // "Admin · read only on production": an exception stands where "everything" would.
    return [
      words.role,
      ...(exceptions.length === 0 && words.reach !== undefined ? [words.reach] : exceptions),
    ].join(" · ");
  }
  const reached = onPlaces.filter(({ access }) => access !== "none");
  if (reached.length === 0) return null;
  const alike =
    reached.length === onPlaces.length && reached.every((one) => one.access === reached[0]!.access);
  if (alike) return reached[0]!.access === "full" ? "Full access here" : "Read only here";
  return reached.map(({ place, access }) => `${place.label}: ${access}`).join(" · ");
}

const UNREADABLE = {
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

  const app = appProjectsOf(input.projects);
  const mateOwners = input.projects.flatMap(({ projectId, kind }) => {
    const owner = input.owners[projectId];
    return isMateKind(kind) && owner != null ? [owner] : [];
  });

  const ranked = members.list.flatMap((member) => {
    // Every integration token is a membership too; tokens are HQ's, never people here.
    if (isTokenMember(member)) return [];
    const role = asOrgRole(member.roleCode);
    const onPlaces = places.map((place) => {
      const grant = input.grants[place.projectId]?.grants?.find(
        ({ clientUserId }) => clientUserId === member.id,
      );
      return { place, access: accessOf(asOrgRole(grant?.roleCode ?? role)) };
    });
    const access = accessWords(role, onPlaces);
    if (access === null) return [];
    const userId = member.user?.id ?? member.userId;
    const name = mateMemberName(member) ?? "Someone";
    const mates = mateOwners.filter((owner) => owner === userId).length;
    const pending = (member.status ?? ZEROPS_ACTIVE_MEMBER_STATUS) !== ZEROPS_ACTIVE_MEMBER_STATUS;
    const avatar = member.user?.avatar;
    const actions = appAccessActions({
      viewer: input.viewer,
      member: {
        id: member.id,
        ...(member.roleCode === undefined ? {} : { roleCode: member.roleCode }),
        pending,
      },
    });
    const owned = input.projects.flatMap(({ projectId, kind }) =>
      isMateKind(kind) && userId !== undefined && input.owners[projectId] === userId
        ? [projectId]
        : [],
    );
    // What they may do here: on its places, or by their role where it has none yet.
    const best = Math.min(
      ...(onPlaces.length === 0 ? [accessOf(role)] : onPlaces.map((one) => one.access)).map(
        (one) => (one === "full" ? 0 : one === "read" ? 1 : 2),
      ),
    );
    const person: ProjectPerson = {
      key: member.id,
      userId,
      name,
      initials: zeropsInitials(name),
      avatarUrl:
        (userId === undefined ? null : input.pictures[userId]) ||
        avatar?.smallAvatarUrl ||
        avatar?.externalAvatarUrl ||
        avatar?.largeAvatarUrl ||
        null,
      you: userId !== undefined && userId === input.viewerUserId,
      pending,
      access,
      line: [
        ...(pending ? ["Invited · not joined yet"] : []),
        access,
        ...(mates === 0 ? [] : [mates === 1 ? "1 Mate" : `${mates} Mates`]),
      ].join(" · "),
      change:
        actions === null
          ? null
          : {
              clientUserId: member.id,
              level: appAccessLevel({
                orgRole: member.roleCode,
                grantOf: (projectId) =>
                  input.grants[projectId]?.grants?.find(
                    ({ clientUserId }) => clientUserId === member.id,
                  )?.roleCode,
                projects: app,
                owned,
              }),
              end: actions.end,
              owned,
            },
    };
    return [{ person, rank: [person.you ? 0 : 1, pending ? 1 : 0, best, -roleRank(role)] }];
  });

  return {
    kind: "people",
    invite: input.viewer !== undefined && roleAtLeast(input.viewer.roleCode, "ADMIN"),
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
      readonly level: AppAccessLevel;
      readonly label: string;
      readonly checked: boolean;
    }
  | { readonly kind: "end"; readonly end: PersonChange["end"]; readonly label: string };

export const LEVEL_WORDS: Readonly<Record<AppAccessLevel, string>> = {
  work: "Can work on it",
  look: "Can only look",
};

/** A person's menu: the two levels, theirs checked, then the way out of the project. */
export function personMenu(
  change: PersonChange,
  projectName: string,
): ReadonlyArray<PersonMenuEntry> {
  return [
    ...(["work", "look"] as const).map((level) => ({
      kind: "level" as const,
      level,
      label: LEVEL_WORDS[level],
      checked: change.level === level,
    })),
    {
      kind: "end",
      end: change.end,
      label: change.end === "withdraw" ? "Withdraw invite" : `Remove from ${projectName}`,
    },
  ];
}
