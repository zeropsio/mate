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
 * - **Membership, kind, the application's name, a Mate's name and face** are
 *   HQ's: it is their only writer, and the client joins where HQ places each
 *   project onto the projects it reads from Zerops (`ZeropsProject.hq`,
 *   `hq/placement.ts`). Delete a project in Zerops and HQ lets it go.
 * - **That a Mate lives here** is the project's own `mate` marker, for the
 *   Zerops GUI too, and a Mate HQ places is one whatever its tags say.
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
  MATE_SHAPE_IDS,
  MATE_TINT_IDS,
  type MateShapeId,
  type MateTintId,
} from "@t3tools/shared/brand";
import type { RoleProjectKind } from "@t3tools/shared/zeropsRoles";

import type { ZeropsProject } from "./api.ts";
import type { HqPlacement } from "./hq/placement.ts";
import { compareZeropsHostnames } from "./listingOrder.ts";
import type { RandomBytes } from "./newProject.ts";

/** Namespace every tag this product writes shares, so nothing collides with a user's own tags. */
export const MATE_TAG_NAMESPACE = "mate";

/**
 * The marker: this project has a Mate. The bare namespace word, so the Zerops
 * GUI shows a project's one-word answer beside its longer tags and a tag
 * filter on `mate` lists exactly the Mates. It is the declared fact, written
 * when a Mate is set up and kept when its container is rebuilt or lost — the
 * container is the Mate's body, the tag is its existence.
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

/** Where a project belongs and who lives in it: HQ's placement, and the project's own tags. */
export interface ZeropsMembership {
  /** A Mate lives here: HQ places it as one — dev/stage included — or it carries the `mate` marker. */
  readonly mate: boolean;
  /** Its application in HQ. */
  readonly groupId: string | undefined;
  readonly role: ZeropsEnvironmentRole | undefined;
  /** Its application's name, as HQ holds it. */
  readonly label: string | undefined;
  /** The Mate's own name, the thing a person addresses. */
  readonly bot: string | undefined;
  /** Who asked for the project's development to be stood up, as HQ's birth record names them. */
  readonly standUp?: { readonly by: string } | undefined;
  /** The face its person picked; absent where HQ's record says nothing this client knows. */
  readonly face: ZeropsMateFaceTag | undefined;
}

const ROLE_OF_KIND: Readonly<Record<RoleProjectKind, ZeropsEnvironmentRole>> = {
  mate: "dev",
  devstage: "devstage",
  stage: "stage",
  production: "prod",
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
 * Where a project belongs and who lives in it, from where HQ places it (`hq`) and its marker tag.
 * Permissive on read: a face part this client does not know is left out, never guessed at.
 */
export function readZeropsMembership(
  project:
    | {
        readonly tagList?: ReadonlyArray<string> | undefined;
        readonly hq?: HqPlacement | undefined;
      }
    | undefined,
): ZeropsMembership {
  const marker = (project?.tagList ?? []).includes(MATE_MARKER_TAG);
  const placed = project?.hq;
  const asker = placed?.mate?.standupRequestedBy?.trim();
  // A Mate HQ holds in no application has its record, and no place.
  const app = placed?.appId === null ? undefined : placed;
  const label = app?.appName.trim();
  const name = placed?.mate?.name.trim();
  return {
    // A dev/stage is a Mate too: its project also serves as its application's stage.
    mate: marker || placed?.kind === "mate" || placed?.kind === "devstage",
    groupId: app?.appId,
    role: app === undefined ? undefined : ROLE_OF_KIND[app.kind],
    label: label === undefined || label === "" ? undefined : label,
    bot: name === undefined || name === "" ? undefined : name,
    standUp: asker === undefined || asker === "" ? undefined : { by: asker },
    face:
      placed?.mate === null || placed === undefined ? undefined : readMateFace(placed.mate.face),
  };
}

/** A Mate's face: the colour and the shape its person picked for it. */
export interface ZeropsMateFace {
  readonly tint: MateTintId;
  readonly shape: MateShapeId;
}

/**
 * A face as HQ records it. A part this client does not know — a tint or a
 * shape a newer client added — is absent, and the face derived from the
 * Mate's name stands in for it (`mateTints.ts`).
 */
export interface ZeropsMateFaceTag {
  readonly tint: MateTintId | undefined;
  readonly shape: MateShapeId | undefined;
  /**
   * The Mate wore its name's tint before this face was picked for it, and its
   * name keeps its place among the names the tints are shared out over
   * (`<tint>:<shape>:named`, `assignCandidateMateTints`): so picking
   * it a face recoloured nobody else. Absent on a face picked at its birth.
   */
  readonly named?: true;
}

const TINT_VALUES: ReadonlySet<string> = new Set(MATE_TINT_IDS);
const SHAPE_VALUES: ReadonlySet<string> = new Set(MATE_SHAPE_IDS);

/** The part after the shape saying the Mate's name keeps its place (`ZeropsMateFaceTag.named`). */
const NAMED_FACE_PART = "named";

/** A face as HQ records it: `<tint>:<shape>`, `:named` after it where the name kept its place. */
export function readMateFace(value: string): ZeropsMateFaceTag | undefined {
  // Parts past these three are a newer client's; the ones this one knows still read.
  const [tint, shape, named] = value.split(":");
  const face = {
    tint: tint !== undefined && TINT_VALUES.has(tint) ? (tint as MateTintId) : undefined,
    shape: shape !== undefined && SHAPE_VALUES.has(shape) ? (shape as MateShapeId) : undefined,
  };
  if (face.tint === undefined && face.shape === undefined) return undefined;
  return named === NAMED_FACE_PART ? { ...face, named: true } : face;
}

/** A face in the grammar HQ records it in (`readMateFace`). */
export function formatMateFace(
  face: ZeropsMateFace,
  options: { readonly named?: boolean } = {},
): string {
  const value = `${face.tint}:${face.shape}`;
  return options.named === true ? `${value}:${NAMED_FACE_PART}` : value;
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
 * Declares the Mate: the marker, once, after every other tag. Idempotent, so
 * every path that stands a Mate up — the wizard, "Add dev" with an agent,
 * "Set up Mate" — can write it without checking first.
 */
export function withZeropsMateTag(
  tagList: ReadonlyArray<string> | undefined,
): ReadonlyArray<string> {
  const existing = tagList ?? [];
  return existing.includes(MATE_MARKER_TAG) ? existing : [...existing, MATE_MARKER_TAG];
}

export const ZEROPS_GROUP_ID_LENGTH = 12;

/**
 * Crockford base32 — no `i`, `l`, `o` or `u`, so an id read aloud or retyped
 * from a tag in the Zerops GUI cannot become a different id.
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
 * Where a group's displayed name came from — its application in HQ, the creation under way in it,
 * or nothing at all. The UI wants this: a group named `"id"` is one the user should be invited to
 * name, and a group named `"birth"` is one HQ has not placed a project of yet.
 */
export type ZeropsGroupNameSource = "hq" | "birth" | "id";

/**
 * Where an environment being created stands in the account's projects, as the press that made it
 * knows it — drawn in its group before the organization's listing holds the project.
 */
export interface BirthPlacement {
  readonly groupId: string;
  /** The group's name as the press knew it; names a group the listing does not hold yet. */
  readonly groupName: string;
  readonly kind: RoleProjectKind;
  /** What the person called the environment. */
  readonly displayName: string;
  /** What a Mate is called — its name, not its environment's — drawn while it comes up. */
  readonly botName?: string;
  /** The face its person picked for a Mate, worn asleep while it comes up. */
  readonly face?: ZeropsMateFace;
}

/**
 * A creation the organization's listing may not hold yet, placed in its group: one this tab's
 * press made (`matePresses.ts`), or a New project the client is still making, placed from the
 * press.
 */
export interface ZeropsPlacedBirth {
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
  /** Its application's name in HQ, else the creation's under way, else the id. */
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
  const pending = new Map<string, Array<ZeropsPlacedBirth>>();
  for (const birth of births) {
    if (listed.has(birth.projectId)) continue;
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
        byName(left.project.name, right.project.name) ||
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
          : [groupId, "id"];
    return {
      groupId,
      name,
      nameSource,
      environments: sorted,
      pending: coming.map((birth): ZeropsGroupPendingMember => ({
        projectId: birth.projectId,
        kind: birth.placement.kind,
        name: birth.placement.botName ?? birth.placement.displayName,
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
