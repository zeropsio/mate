/**
 * Who reaches a Zerops project, and how, as people chips: the organization's members joined with
 * its grants — a Mate on its own, or a project still being made (`accessDraft.logic.ts`). An app's
 * places side by side are a table (`accessTable.logic.ts`). Given several projects, a chip holds
 * the most a person has on the places, or on the Mates where there is no place. A Mate is its
 * owner's: no change here touches it.
 *
 * Zerops grants access per Zerops project: the organization role, unless a project names its own
 * grant for the member (`userRoles`), which wins in both directions (`effectiveProjectRole`).
 *
 * Pure: the member list, the grants and whose each Mate is arrive read.
 */
import type { ProjectGrantsRead } from "@t3tools/client-runtime/data";
import { zeropsRoleWords, type ZeropsOrganizationMember } from "@t3tools/client-runtime/zerops";
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

import { memberPicture } from "~/zerops/memberPicture";
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

/** A level a chip shows: full access, a developer's, read only. */
export type AccessLevel = "full" | "basic" | "read";
/** `hidden`: a project kept from someone who works on or sees every project. */
export type ChipLevel = AccessLevel | "hidden";

/**
 * The levels a person can be given here: full, read only — or, `none`, hidden from someone who
 * works on or sees every project. Zerops keeps every project visible to an owner or an admin
 * (`noAccessRoleInvalid`, measured 2026-10-14).
 */
export type GivenLevel = "full" | "read" | "none";

/**
 * Read and Full in one line each, said once where they are chosen — an invitation's projects and
 * *Add access* — never as bare words: Full is the project's own admin role (`GIVEN_ROLE`), so the
 * person works with its Mates and changes it; Read sees it and changes nothing.
 */
export const ACCESS_LEVEL_LINES: Readonly<Record<"full" | "read", string>> = {
  full: "Works with the project's Mates and changes the project.",
  read: "Follows the work and opens the app; changes nothing.",
};

/** What the viewer may change of one person's access here. */
export interface PersonChange {
  /** Their membership (`clientUser`) id. */
  readonly clientUserId: string;
  /** The level they have here now. */
  readonly level: ChipLevel;
  /** The levels to pick between, theirs checked: someone the organization gives no project. */
  readonly levels: ReadonlyArray<GivenLevel>;
  /**
   * Someone whose role reaches every project: each change their menu offers, in its words
   * (`defaultAccessMenu`). Empty for anyone else.
   */
  readonly actions: ReadonlyArray<DefaultAccessAction>;
  /** The viewer's own chip: lowering their own full access asks first, in these words. */
  readonly self: boolean;
  readonly selfLower?: { readonly title: string; readonly description: string };
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
  /** What a hidden project means for them: who can show it again. */
  readonly note: string | null;
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

/** Whether a membership is an invitation not joined yet. */
export const isPending = (member: ZeropsOrganizationMember): boolean =>
  (member.status ?? ZEROPS_ACTIVE_MEMBER_STATUS) !== ZEROPS_ACTIVE_MEMBER_STATUS;

/** Who a member is, as a face and a name: HQ's picture first, as the menu draws them. */
export function memberFace(
  member: ZeropsOrganizationMember,
  pictures: ProjectPeopleInput["pictures"],
): PersonFace {
  const userId = member.user?.id ?? member.userId;
  const name = mateMemberName(member) ?? "Someone";
  return {
    userId,
    name,
    short: shortName(name),
    initials: zeropsInitials(name),
    avatarUrl: memberPicture({
      hq: userId === undefined ? null : pictures[userId],
      avatar: member.user?.avatar,
      email: member.user?.email,
    }),
    email: member.user?.email?.trim() || null,
    role:
      zeropsRoleWords({
        roleCode: asOrgRole(member.roleCode),
        canCreateProjects: member.canCreateProjects,
      }) ?? "",
  };
}

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

/** The chips' own words for each level — Full, Read, Hidden — so a line says what a badge does. */
const EXCEPTION_WORDS: Readonly<Record<Access, string>> = {
  full: "full access on",
  read: "read only on",
  none: "hidden on",
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
  if (alike) return reached[0]!.access === "full" ? "Full access" : "Read only";
  // "Full access on stage · read only on production": full first, then read only.
  const by = (access: Access) =>
    reached.filter((one) => one.access === access).map(({ place }) => place.inSentence);
  const works = by("full");
  const looks = by("read");
  const said = [
    ...(works.length === 0 ? [] : [`${EXCEPTION_WORDS.full} ${listed(works)}`]),
    ...(looks.length === 0 ? [] : [`${EXCEPTION_WORDS.read} ${listed(looks)}`]),
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
    const pending = isPending(member);
    const face = memberFace(member, input.pictures);
    const access = accessWords(role, onPlaces);
    if (access === null && onMates.length === 0) {
      candidates.push({ ...face, clientUserId: member.id, pending });
      return [];
    }

    // The badge: on the places, or on the Mates where there is none — or none they reach. For
    // someone whose role reaches every project, a project kept from them is hidden there.
    const reachesAll = role !== "NO_ACCESS";
    const levelOn = (projectId: string): ChipLevel | null =>
      levelOf(roleOn(projectId)) ?? (reachesAll ? "hidden" : null);
    const placeLevels = places.map((place) => levelOn(place.projectId));
    const judged: ReadonlyArray<ChipLevel | null> = placeLevels.some((level) => level !== null)
      ? placeLevels
      : reachesAll
        ? mates.map(({ projectId }) => (owned.includes(projectId) ? "full" : levelOn(projectId)))
        : onMates.map(({ level }) => level);
    const level: ChipLevel =
      judged.toSorted((a, b) => CHIP_RANK.indexOf(a) - CHIP_RANK.indexOf(b))[0] ??
      levelOf(role) ??
      "hidden";

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
    const defaults = reachesAll
      ? defaultAccessMenu({
          viewerRole: input.viewer?.roleCode,
          memberRole: role,
          self,
          held: level,
          override: own,
        })
      : null;
    const change: PersonChange | null =
      defaults !== null && defaults.length > 0
        ? {
            clientUserId: member.id,
            level,
            levels: [],
            actions: defaults,
            self,
            ...(self ? { selfLower: selfLowerWords(input.viewer?.roleCode) } : {}),
            end: null,
            owned,
          }
        : actions !== null && !reachesAll
          ? {
              clientUserId: member.id,
              level,
              levels: ["full", "read"],
              actions: [],
              self,
              end: pending ? "withdraw" : own ? "remove" : null,
              owned,
            }
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
      note: level === "hidden" ? hiddenNote(judged) : null,
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

/** What someone reaching only Mates here may do on them: "Full access on Fen · read only on Juno". */
function mateWords(
  onMates: ReadonlyArray<{ readonly label: string; readonly level: AccessLevel }>,
): string | null {
  const works = onMates.filter(({ level }) => level !== "read").map(({ label }) => label);
  const looks = onMates.filter(({ level }) => level === "read").map(({ label }) => label);
  const said = [
    ...(works.length === 0 ? [] : [`${EXCEPTION_WORDS.full} ${listed(works)}`]),
    ...(looks.length === 0 ? [] : [`${EXCEPTION_WORDS.read} ${listed(looks)}`]),
  ].join(" · ");
  return said === "" ? null : said.charAt(0).toUpperCase() + said.slice(1);
}

/** The most first: a chip given several projects holds the most a person has there. */
const CHIP_RANK: ReadonlyArray<ChipLevel | null> = ["full", "basic", "read", "hidden", null];

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
    }
  | {
      readonly kind: "action";
      readonly choice: DefaultAccessAction["choice"];
      readonly label: string;
    };

export const LEVEL_WORDS: Readonly<Record<GivenLevel, string>> = {
  full: "Give full access",
  read: "Make read only",
  none: "Hide this project",
};

/** A badge in words, for a hover card's list and for a screen reader. */
export const BADGE_WORDS: Readonly<Record<ChipLevel, string>> = {
  full: "Full",
  basic: "More than Read",
  read: "Read",
  hidden: "Hidden",
};

/** A person's menu: the levels they may be given, theirs checked, then the way out. */
export function personMenu(change: PersonChange): ReadonlyArray<PersonMenuEntry> {
  return [
    ...change.actions.map(({ choice, label }) => ({ kind: "action" as const, choice, label })),
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
  none: "NO_ACCESS",
};

/** One entry of a default-access person's menu: what it sets, in its words. */
export interface DefaultAccessAction {
  /** A level to give, or `remove`: their own grant dropped, so their role decides again. */
  readonly choice: GivenLevel | "remove";
  readonly label: string;
}

const REMOVE_OVERRIDE: DefaultAccessAction = { choice: "remove", label: "Remove override" };

/**
 * The menu of someone whose organization role reaches every project — an owner, an admin, someone
 * who works on or sees every project — as Zerops lets the viewer change it: each level they don't
 * hold, where landing back on their role's own level reads *Remove override*; *Hide this project*
 * for someone who works on or sees every project — never an owner or admin, whom Zerops keeps every
 * project visible to; and *Remove override* on its own where no entry
 * lands back on their role's level. `null` where the viewer may change none of it: not an owner
 * or admin, or an admin looking at another owner or admin (Zerops refuses those writes).
 */
export function defaultAccessMenu(input: {
  readonly viewerRole: string | undefined;
  readonly memberRole: ZeropsOrgRole;
  /** The viewer's own chip. */
  readonly self: boolean;
  /** What they hold here now. */
  readonly held: ChipLevel;
  /** Whether they hold a grant of their own here. */
  readonly override: boolean;
}): ReadonlyArray<DefaultAccessAction> | null {
  if (!roleAtLeast(input.viewerRole, "ADMIN")) return null;
  if (
    !roleAtLeast(input.viewerRole, "OWNER") &&
    !input.self &&
    roleAtLeast(input.memberRole, "ADMIN")
  )
    return null;
  const base = levelOf(input.memberRole);
  const offer = (level: "full" | "read"): ReadonlyArray<DefaultAccessAction> =>
    input.held === level
      ? []
      : [level === base ? REMOVE_OVERRIDE : { choice: level, label: LEVEL_WORDS[level] }];
  return [
    ...offer("full"),
    ...offer("read"),
    ...(input.held !== "hidden" && mayHide(input.memberRole)
      ? [{ choice: "none" as const, label: LEVEL_WORDS.none }]
      : []),
    // A developer's own level is neither entry's: their way back is its own.
    ...(input.override && base === "basic" ? [REMOVE_OVERRIDE] : []),
  ];
}

/** Whether a project can be hidden from someone: only one who works on or sees every project. */
export const mayHide = (role: string | undefined): boolean =>
  asOrgRole(role) === "BASIC_USER" || asOrgRole(role) === "READ_ONLY";

/** Whether a choice gives up the viewer's own full access here, which asks first. */
export const asksFirst = (change: PersonChange, choice: AccessChoiceLike): boolean =>
  change.self && change.level === "full" && (choice === "read" || choice === "none");

type AccessChoiceLike = GivenLevel | "remove" | "withdraw";

/** What giving up one's own full access asks: whether they can turn it back themselves. */
export function selfLowerWords(viewerRole: string | undefined): {
  readonly title: string;
  readonly description: string;
} {
  return {
    title: "Give up your own full access here?",
    description: roleAtLeast(viewerRole, "ADMIN")
      ? "Your role lets you turn it back yourself, from this same menu."
      : "You won't be able to turn it back yourself: an owner or admin will have to do it for you.",
  };
}

/** Who can show a hidden project again: an owner or admin, never the hidden member themselves. */
function hiddenNote(levels: ReadonlyArray<ChipLevel | null>): string | null {
  return levels.includes("hidden")
    ? "Hidden from them here. An owner or admin can show it again."
    : null;
}

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
