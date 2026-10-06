/**
 * Groups — the user's "project" ("Beviro CRM"), which is a set of Zerops
 * projects, each of which is one environment: one `zcp` container, one agent,
 * one conversation.
 *
 * The mental shift this module encodes: a **Zerops project is an environment**,
 * not a project. What the user calls a project is the group above it: an
 * application in the organization's HQ (ADR 0002).
 *
 * ## Where the facts live
 *
 * - **Membership, kind, the application's name, a Mate's face** are HQ's: it is
 *   their only writer, and the client joins where HQ places each project onto
 *   the projects it reads from Zerops (`ZeropsProject.hq`, `hq/placement.ts`).
 *   Delete a project in Zerops and HQ lets it go.
 * - **A Mate's name** is its project's in Zerops, which names every project of an
 *   application in full ("SPN - Rune"); the client shows what follows the
 *   application's name (`nameUnderApp`). Renamed there, or by Mate through the
 *   project's own record, and never held anywhere else.
 * - **That a Mate lives here** is HQ's too: it places the project as a Mate.
 *   The project's `mate` marker is written for the Zerops GUI and read by
 *   nothing here.
 * - **Who asked for the project's development to be stood up** is the Mate's
 *   birth record at HQ (`standupRequestedBy`), placed with the rest of it.
 *
 * A project HQ does not place is in no group: ungrouped.
 *
 * ## Why grouping is computed here rather than queried
 *
 * The tree is derived from the project list the picker already fetches
 * through the lag-free client read, joined with HQ's structure, so a
 * just-created environment is in its group the moment both have it.
 *
 * @module groups
 */

import {
  formatMateFace,
  readMateFace,
  type ZeropsMateFace,
  type ZeropsMateFaceTag,
} from "@t3tools/shared/mateFaces";
export {
  formatMateFace,
  readMateFace,
  type ZeropsMateFace,
  type ZeropsMateFaceTag,
} from "@t3tools/shared/mateFaces";
import type { RoleProjectKind } from "@t3tools/shared/zeropsRoles";

import type { ZeropsProject } from "./api.ts";
import type { HqPlacement } from "./hq/placement.ts";
import { compareZeropsHostnames } from "./listingOrder.ts";
import type { RandomBytes } from "./newProject.ts";

/** Namespace every tag this product writes shares, so nothing collides with a user's own tags. */
export const MATE_TAG_NAMESPACE = "mate";

/**
 * The marker: this project has a Mate, for the Zerops GUI. The bare namespace
 * word, so the GUI shows a project's one-word answer beside its longer tags and
 * a tag filter on `mate` lists the Mates. Written when a Mate is set up; Mate
 * itself reads a Mate's existence from HQ's placement, never from the tag.
 */
export const MATE_MARKER_TAG = MATE_TAG_NAMESPACE;

/**
 * What an environment is for, as HQ places its project (`ROLE_OF_KIND`). Four values rather than
 * two so a group can say "this one is both my dev box and what I show people" without inventing a
 * fifth environment.
 */
export type ZeropsEnvironmentRole = "dev" | "devstage" | "stage" | "prod";

const ROLE_ORDER: ReadonlyArray<ZeropsEnvironmentRole> = ["dev", "devstage", "stage", "prod"];

/** The longest name a Mate goes by: it is read in a menu row. */
export const ZEROPS_BOT_NAME_MAX_LENGTH = 24;

/** Where a project belongs and who lives in it: HQ's placement. */
export interface ZeropsMembership {
  /** A Mate lives here: HQ places it as one, dev/stage included. */
  readonly mate: boolean;
  /** Its application in HQ. */
  readonly groupId: string | undefined;
  readonly role: ZeropsEnvironmentRole | undefined;
  /** Its application's name, as HQ holds it. */
  readonly label: string | undefined;
  /** Who asked for the project's development to be stood up, as HQ's birth record names them. */
  readonly standUp?: { readonly by: string } | undefined;
  /**
   * Who made the Mate, as HQ's record names them: whose sign-in it waits for while nobody has
   * signed it in. Absent for a Mate recorded before HQ kept it.
   */
  readonly madeBy?: string | undefined;
  /** The face its person picked; absent where HQ's record says nothing this client knows. */
  readonly face: ZeropsMateFaceTag | undefined;
  /** The birth intent HQ records for this project, by id. */
  readonly birth?: string | undefined;
}

const ROLE_OF_KIND: Readonly<
  Record<RoleProjectKind | "unknown", ZeropsEnvironmentRole | undefined>
> = {
  mate: "dev",
  devstage: "devstage",
  stage: "stage",
  production: "prod",
  unknown: undefined,
};

const KIND_OF_ROLE: Readonly<Record<ZeropsEnvironmentRole, RoleProjectKind>> = {
  dev: "mate",
  devstage: "devstage",
  stage: "stage",
  prod: "production",
};

/** What HQ calls a project placed for `role`: a dev place is a Mate's. */
export function kindOfRole(role: ZeropsEnvironmentRole): RoleProjectKind {
  return KIND_OF_ROLE[role];
}

/**
 * Where a project belongs and who lives in it, from where HQ places it (`hq`). Permissive on
 * read: a face part this client does not know is left out, never guessed at.
 */
export function readZeropsMembership(
  project: { readonly hq?: HqPlacement | undefined } | undefined,
): ZeropsMembership {
  const placed = project?.hq;
  const asker = placed?.mate?.standupRequestedBy?.trim();
  const maker = placed?.mate?.madeBy?.trim();
  // A Mate HQ holds in no application has its record, and no place.
  const app = placed?.appId === null ? undefined : placed;
  const label = app?.appName.trim();
  return {
    // A dev/stage is a Mate too: its project also serves as its application's stage.
    mate: placed?.kind === "mate" || placed?.kind === "devstage",
    groupId: app?.appId,
    role: app === undefined ? undefined : ROLE_OF_KIND[app.kind],
    label: label === undefined || label === "" ? undefined : label,
    standUp: asker === undefined || asker === "" ? undefined : { by: asker },
    madeBy: maker === undefined || maker === "" ? undefined : maker,
    face: placed?.mate?.face === undefined ? undefined : readMateFace(placed.mate.face),
    birth: placed?.mate?.birthId ?? undefined,
  };
}

/** What joins an application's name to a project's own name in the project's Zerops name. */
const APP_NAME_SEPARATOR = " - ";

/**
 * A project's own name under its application: in Zerops every project of an application is named
 * in full ("SPN - Rune", "SPN - stage"), and under the application the client shows what follows
 * its exact `"<application> - "` prefix. Anything else — another application's name, a different
 * case, no separator, nothing after it, no application — is shown whole, so a stale prefix (the
 * application renamed, the project moved) never cuts a name wrongly.
 */
export function nameUnderApp(projectName: string, appName: string | undefined): string {
  const whole = projectName.trim();
  const app = appName?.trim();
  if (app === undefined || app === "") return whole;
  const prefix = `${app}${APP_NAME_SEPARATOR}`;
  if (!whole.startsWith(prefix)) return whole;
  const rest = whole.slice(prefix.length).trim();
  return rest === "" ? whole : rest;
}

/** `nameUnderApp` for a project, the application being the one HQ places it in. */
export function projectNameInApp(
  project: { readonly name: string; readonly hq?: HqPlacement | undefined } | undefined,
): string {
  if (project === undefined) return "";
  return nameUnderApp(project.name, readZeropsMembership(project).label);
}

/** The full Zerops name of a project of an application: `nameUnderApp`'s inverse. */
export function appProjectName(appName: string | undefined, ownName: string): string {
  const app = appName?.trim();
  const own = ownName.trim();
  return app === undefined || app === "" ? own : `${app}${APP_NAME_SEPARATOR}${own}`;
}

/**
 * What a project is renamed to when its person types `typed` as its own name under its
 * application: the full name, or `undefined` where nothing changes — the name shown is kept, or the
 * full name comes out as the project's already.
 */
export function renamedProjectName(
  project: { readonly name: string; readonly hq?: HqPlacement | undefined },
  typed: string,
): string | undefined {
  const { label } = readZeropsMembership(project);
  // A typed `"<application> - "` is the prefix already, never a second one.
  const own = nameUnderApp(typed, label);
  if (own === projectNameInApp(project)) return undefined;
  const full = appProjectName(label, own);
  return full === project.name.trim() ? undefined : full;
}

/**
 * The face a Mate already born changes to. One that wore its name's tint — no face this client
 * reads a tint from, or one changed before — keeps its name's place among the names the tints
 * are shared out over (`named`), so no other Mate changes colour; one whose face was picked at its
 * birth never had a place there, and takes none now.
 */
export function changedMateFace(worn: ZeropsMateFaceTag | undefined, face: ZeropsMateFace): string {
  return formatMateFace(face, { named: worn?.tint === undefined || worn.named === true });
}

/**
 * Declares the Mate for the Zerops GUI: the marker added to the project's own tags — a plain
 * project its person tagged keeps them (Set up Mate) — and the obsolete `mate:*` metadata tags an
 * earlier client wrote on a Mate dropped, as HQ holds that metadata now. Idempotent, so every path
 * that stands a Mate up — the wizard, "Add dev" with an agent, "Set up Mate" — can write it without
 * checking first.
 */
export function withZeropsMateTag(
  tagList: ReadonlyArray<string> | undefined,
): ReadonlyArray<string> {
  const own = (tagList ?? []).filter(
    (tag) => tag !== MATE_MARKER_TAG && !tag.startsWith(`${MATE_MARKER_TAG}:`),
  );
  const next = [...own, MATE_MARKER_TAG];
  return tagList !== undefined &&
    tagList.length === next.length &&
    next.every((tag) => tagList.includes(tag))
    ? tagList
    : next;
}

export const ZEROPS_GROUP_ID_LENGTH = 12;

/**
 * Crockford base32 — no `i`, `l`, `o` or `u`, so an id read aloud or retyped
 * cannot become a different id.
 */
const GROUP_ID_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

/**
 * 60 bits of randomness, not a hash of the group's name: a name is renameable
 * and an id must not be.
 *
 * `randomBytes` is required rather than defaulted because this module sits
 * under design-system rule R1 — `client-runtime/src/zerops/**` reaches no
 * platform global, and the caller owns the binding.
 */
export function generateZeropsGroupId(randomBytes: RandomBytes): string {
  const draw = randomBytes(new Uint8Array(ZEROPS_GROUP_ID_LENGTH));
  let id = "";
  for (const byte of draw) {
    id += GROUP_ID_ALPHABET[byte % GROUP_ID_ALPHABET.length];
  }
  return id;
}

export interface ZeropsGroupEnvironment {
  readonly project: ZeropsProject;
  readonly role: ZeropsEnvironmentRole | undefined;
}

/**
 * Where a group's displayed name came from — its application in HQ, or the creation under way in
 * it — or that it could not be read. HQ holds no application without a name, so a group whose
 * name reads blank is a read problem, drawn as one with its id as the handle, never an invitation
 * to name it; a group named from its `"birth"` is one HQ has not placed a project of yet.
 */
export type ZeropsGroupNameSource = "hq" | "birth" | "unread";

/**
 * Where an environment being created stands in the account's projects, as the press that made it
 * knows it — drawn in its group before the organization's listing holds the project.
 */
export interface BirthPlacement {
  readonly groupId: string;
  /** The group's name as the press knew it; names a group the listing does not hold yet. */
  readonly groupName: string;
  readonly kind: RoleProjectKind;
  /** What the person called the environment: its project's name, a Mate's own (D3). */
  readonly displayName: string;
  /** The face its person picked for a Mate, worn asleep while it comes up. */
  readonly face?: ZeropsMateFace;
}

/**
 * A creation the organization's listing may not hold yet, placed in its group: one this tab's
 * press made (`matePresses.ts`), or a New project the client is still making, placed from the
 * press.
 */
export interface ZeropsPlacedBirth {
  /** HQ's intent id, when recorded before the platform accepted the project. */
  readonly intent?: string | undefined;
  /** The project the platform made for it; a creation still being made, the client's own id for it. */
  readonly projectId: string;
  /** When the platform accepted the creation, wall ms — or the client began it. */
  readonly startedAt: number;
  readonly placement: BirthPlacement;
  /** The client's creation stopped before the platform took it: it says so where it is drawn. */
  readonly failed?: boolean | undefined;
  /**
   * The platform has not answered with its project yet, so `projectId` is the creation's own id:
   * the listing may hold its project already, under an id the creation does not know.
   */
  readonly awaitingProject?: boolean | undefined;
}

/** A member of a group still being created: drawn until the listing holds its project. */
export interface ZeropsGroupPendingMember {
  readonly projectId: string;
  readonly kind: RoleProjectKind;
  /** A Mate's name, as it will be listed; anything else's, what the person called it. */
  readonly name: string;
  /** When the platform accepted the creation, wall ms. */
  readonly startedAt: number;
  /** The face its person picked for a Mate, worn asleep until the listing holds it. */
  readonly face?: ZeropsMateFace | undefined;
  /** Its creation stopped before the platform took it (`ZeropsPlacedBirth.failed`). */
  readonly failed?: boolean | undefined;
}

export interface ZeropsGroup {
  readonly groupId: string;
  /** Its application's name in HQ, else the creation's under way, else — unread — its id. */
  readonly name: string;
  readonly nameSource: ZeropsGroupNameSource;
  readonly environments: ReadonlyArray<ZeropsGroupEnvironment>;
  /**
   * Members still being created, oldest first: a creation the platform accepted
   * whose project no group of the listing holds yet. Once one does, the listed
   * member stands in its place — the same project, never both.
   */
  readonly pending: ReadonlyArray<ZeropsGroupPendingMember>;
  /**
   * The group's production environment — present only when exactly one member
   * claims the role. Two claimants is a conflict the user has to resolve, and
   * silently picking one would hide it.
   */
  readonly production: ZeropsGroupEnvironment | undefined;
}

export interface ZeropsGroupTree {
  readonly groups: ReadonlyArray<ZeropsGroup>;
  /** Projects HQ places in no application. */
  readonly ungrouped: ReadonlyArray<ZeropsProject>;
}

/**
 * How the tree orders its groups and its ungrouped projects.
 *
 * `newest` groups by creation time (a group's is the earliest among its
 * members — the moment it was born, unmoved by a stage added later) and
 * ungroups the same way, newest first; `name` is today's order, display name
 * then id; `custom` is the viewer's own arrangement of the groups
 * (`customOrder`), the ungrouped left newest first — a person arranges their
 * projects, not the loose environments under them. There is no default:
 * every caller states which one a viewer sees.
 */
export type ZeropsProjectOrder = "newest" | "name" | "custom";

export interface DeriveZeropsGroupsOptions {
  readonly order: ZeropsProjectOrder;
  /**
   * `custom` only: group ids in the order the viewer put them. A group it
   * does not name — one created since, or never placed — follows the named
   * ones, newest first, so a new project never pushes an arranged one down;
   * an id the listing no longer holds takes no place.
   */
  readonly customOrder?: ReadonlyArray<string>;
  /** The account's creations under way that know their group. */
  readonly births?: ReadonlyArray<ZeropsPlacedBirth>;
  /**
   * HQ's applications, by id and name: one no project of the listing places is a group all the
   * same, empty — what a New project that stopped before its Mate leaves, for a Mate to be added
   * to it (2026-10-03).
   */
  readonly apps?: ReadonlyArray<{ readonly id: string; readonly name: string }>;
}

function roleRank(role: ZeropsEnvironmentRole | undefined): number {
  return role === undefined ? ROLE_ORDER.length : ROLE_ORDER.indexOf(role);
}

/** The shared listing order (`listingOrder.ts`): locale-aware, case- and numeric-aware. */
const byName = compareZeropsHostnames;

/**
 * Descending by `created` (an ISO timestamp, lexically sortable — the same
 * assumption `autoEnterProvisioning.ts` makes), missing
 * always last regardless of which side of the comparison it is on.
 */
function byCreatedNewestFirst(left: string | undefined, right: string | undefined): number {
  if (left === undefined) return right === undefined ? 0 : 1;
  if (right === undefined) return -1;
  return right.localeCompare(left);
}

/**
 * A group's birth moment, wall ms: the earliest `created` among its members,
 * ignoring ones that carry none; where none does, the earliest start of a
 * creation under way in it — so a group just created leads at once rather
 * than sorting last until the listing dates it. `undefined` when neither says.
 */
function groupBornAt(group: ZeropsGroup): number | undefined {
  let earliest: string | undefined;
  for (const { project } of group.environments) {
    const { created } = project;
    if (created === undefined) continue;
    if (earliest === undefined || created < earliest) earliest = created;
  }
  const createdAt = earliest === undefined ? Number.NaN : Date.parse(earliest);
  return Number.isNaN(createdAt) ? group.pending[0]?.startedAt : createdAt;
}

/**
 * Ascending by the place the viewer gave a group; a group given none sorts
 * after every placed one and leaves the tie to the next key.
 */
function byPlace(left: number | undefined, right: number | undefined): number {
  if (left === undefined) return right === undefined ? 0 : 1;
  if (right === undefined) return -1;
  return left - right;
}

/** Descending, missing always last — {@link byCreatedNewestFirst} over wall ms. */
function byBornNewestFirst(left: number | undefined, right: number | undefined): number {
  if (left === undefined) return right === undefined ? 0 : 1;
  if (right === undefined) return -1;
  return right - left;
}

/**
 * Whether an unplaced listed project may be a creation's that still awaits the platform's answer:
 * one made since a running creation began. It is held back until the creation knows its id —
 * then it is that creation's row, or drawn as what it is. Never by name (two Mates may share one):
 * by when it was made. A project made before, or whose making is not known, is drawn; a creation
 * that stopped holds nothing back. A clock that runs ahead of the platform's only draws it twice
 * for a moment, never hides an older project.
 */
function heldBackByCreations(
  births: ReadonlyArray<ZeropsPlacedBirth>,
): (project: ZeropsProject) => boolean {
  const since = births
    .filter((birth) => birth.awaitingProject === true && birth.failed !== true)
    .map((birth) => birth.startedAt);
  if (since.length === 0) return () => false;
  const earliest = Math.min(...since);
  return (project) => {
    const made = Date.parse(project.created ?? "");
    return Number.isFinite(made) && made >= earliest;
  };
}

/**
 * An application's name from HQ's placement on the held projects, for a surface whose listing
 * cannot name it yet: failed, lapsed, or every project withheld. No project labels are parsed.
 */
export function heldGroupLabel(
  projects: ReadonlyArray<{ readonly hq?: HqPlacement | undefined }>,
  groupId: string,
): string | undefined {
  return projects.find((project) => project.hq?.appId === groupId)?.hq?.appName ?? undefined;
}

/**
 * The left menu's whole data model: projects in, a group tree out. Pure, and
 * total — a project HQ does not place is ungrouped rather than an error.
 */
export function deriveZeropsGroups(
  projects: ReadonlyArray<ZeropsProject>,
  options: DeriveZeropsGroupsOptions,
): ZeropsGroupTree {
  const members = new Map<string, Array<ZeropsGroupEnvironment>>();
  const labels = new Map<string, string>();
  const ungrouped: Array<ZeropsProject> = [];
  const births = options.births ?? [];
  const born = new Set(births.map((birth) => birth.projectId));
  const heldBack = heldBackByCreations(births);

  for (const project of projects) {
    const { groupId, role, label } = readZeropsMembership(project);
    if (groupId === undefined) {
      // Listed before HQ places it: its birth still does — or, made while a creation still awaits
      // the platform's answer, it may be that creation's, which draws it.
      if (!born.has(project.id) && !heldBack(project)) ungrouped.push(project);
      continue;
    }
    const bucket = members.get(groupId);
    if (bucket) bucket.push({ project, role });
    else members.set(groupId, [{ project, role }]);
    if (label !== undefined) labels.set(groupId, label);
  }

  // A creation stays pending until a group of the listing holds its project;
  // its group exists from the moment it started, members listed or not.
  const listed = new Set([...members.values()].flat().map(({ project }) => project.id));
  const listedIntents = new Set(
    projects.flatMap((project) => {
      const birth = readZeropsMembership(project).birth;
      return birth === undefined ? [] : [birth];
    }),
  );
  const pending = new Map<string, Array<ZeropsPlacedBirth>>();
  for (const birth of births) {
    if (
      listed.has(birth.projectId) ||
      (birth.intent !== undefined && listedIntents.has(birth.intent))
    )
      continue;
    const { groupId } = birth.placement;
    const bucket = pending.get(groupId);
    if (bucket) bucket.push(birth);
    else pending.set(groupId, [birth]);
    if (!members.has(groupId)) members.set(groupId, []);
  }

  for (const app of options.apps ?? []) {
    if (!members.has(app.id)) members.set(app.id, []);
    if (!labels.has(app.id) && app.name.trim() !== "") labels.set(app.id, app.name);
  }

  const groups = [...members.entries()].map(([groupId, environments]) => {
    const sorted = [...environments].sort(
      (left, right) =>
        roleRank(left.role) - roleRank(right.role) ||
        byName(projectNameInApp(left.project), projectNameInApp(right.project)) ||
        byName(left.project.id, right.project.id),
    );
    const production = sorted.filter((environment) => environment.role === "prod");
    const coming = [...(pending.get(groupId) ?? [])].sort(
      (left, right) => left.startedAt - right.startedAt || byName(left.projectId, right.projectId),
    );
    const named = labels.get(groupId);
    const created = coming.find((birth) => birth.placement.groupName.trim() !== "")?.placement
      .groupName;
    const [name, nameSource]: [string, ZeropsGroupNameSource] =
      named !== undefined
        ? [named, "hq"]
        : created !== undefined
          ? [created, "birth"]
          : [groupId, "unread"];
    return {
      groupId,
      name,
      nameSource,
      environments: sorted,
      pending: coming.map((birth): ZeropsGroupPendingMember => ({
        projectId: birth.projectId,
        kind: birth.placement.kind,
        name: nameUnderApp(birth.placement.displayName, birth.placement.groupName),
        startedAt: birth.startedAt,
        ...(birth.placement.face === undefined ? {} : { face: birth.placement.face }),
        ...(birth.failed === true ? { failed: true } : {}),
      })),
      production: production.length === 1 ? production[0] : undefined,
    } satisfies ZeropsGroup;
  });

  if (options.order === "newest" || options.order === "custom") {
    const bornByGroupId = new Map(groups.map((group) => [group.groupId, groupBornAt(group)]));
    const placed = new Map(
      (options.order === "custom" ? (options.customOrder ?? []) : []).map((groupId, index) => [
        groupId,
        index,
      ]),
    );
    groups.sort(
      (left, right) =>
        byPlace(placed.get(left.groupId), placed.get(right.groupId)) ||
        byBornNewestFirst(bornByGroupId.get(left.groupId), bornByGroupId.get(right.groupId)) ||
        byName(left.name, right.name) ||
        byName(left.groupId, right.groupId),
    );
    ungrouped.sort(
      (left, right) =>
        byCreatedNewestFirst(left.created, right.created) ||
        byName(left.name, right.name) ||
        byName(left.id, right.id),
    );
  } else {
    groups.sort(
      (left, right) => byName(left.name, right.name) || byName(left.groupId, right.groupId),
    );
    ungrouped.sort((left, right) => byName(left.name, right.name));
  }

  return { groups, ungrouped };
}
