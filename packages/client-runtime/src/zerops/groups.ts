/**
 * Groups — the user's "project" ("Beviro CRM"), which is a set of Zerops
 * projects, each of which is one environment: one `zcp` container, one agent,
 * one conversation.
 *
 * The mental shift this module encodes: a **Zerops project is an environment**,
 * not a project. What the user calls a project is the group above it.
 *
 * ## Where the two facts live, and why they are split
 *
 * - **Membership is a tag on each project** (`mate:g:<id>`). Symmetric, so no
 *   member is the master and none carries the others' data — delete a project
 *   and it leaves the group by construction. It is also the only placement
 *   that keeps the whole tree readable from Zerops business data with the
 *   user's own token, which is what spec §0 boundary 1 requires: nothing here
 *   reads the container.
 * - **The group's name lives in the recipe store**, keyed by the same id. A
 *   name in the tag cannot be the authority: a rename would be an N-project
 *   retag with no atomicity, and human input — spaces, diacritics, length —
 *   has no business in a field the platform matches on exactly.
 * - **…and is mirrored into a `mate:name:<name>` tag, for legibility only.**
 *   The Zerops GUI shows a project's tags and filters on them (its dashboard
 *   has a tag filter), so a member carrying nothing but `mate:g:7k2m9qx4vb1c`
 *   is unreadable in the platform's own UI. The mirror is written
 *   best-effort, never read as authority, and a stale one loses to the store.
 *   It also means the tree names itself correctly with no store at all, which
 *   is what lets this ship before the store exists.
 *
 * Neither side can corrupt the other. A group whose store record is missing
 * still renders — named by its label tag, or by its id as a last resort, with
 * `nameSource` saying which; a project whose group tag is missing is simply
 * ungrouped.
 *
 * ## Why grouping is computed here rather than queried
 *
 * `tagList` is searchable server-side (`POST /project/search`, operators `eq`
 * and `in`, measured 2026-09-05), but that index is Elasticsearch-backed and
 * trails writes — a just-created environment is absent from its own group for
 * the first seconds, which is exactly when the user is watching it appear. So
 * the tree is derived from the project list the picker already fetches through
 * the lag-free client read, and the tag search stays an optimization nobody
 * depends on.
 *
 * @module groups
 */

import type { ZeropsProject } from "./api.ts";
import type { RandomBytes } from "./newProject.ts";

/** Namespace every tag this product writes shares, so nothing collides with a user's own tags. */
export const MATE_TAG_NAMESPACE = "mate";

const GROUP_TAG_PREFIX = `${MATE_TAG_NAMESPACE}:g:`;
const ROLE_TAG_PREFIX = `${MATE_TAG_NAMESPACE}:role:`;
const LABEL_TAG_PREFIX = `${MATE_TAG_NAMESPACE}:name:`;

/** Any tag this module owns; everything else on a project is foreign and preserved verbatim. */
const MATE_TAG_PREFIX = `${MATE_TAG_NAMESPACE}:`;

/**
 * What an environment is for. Four values rather than two so a group can say
 * "this one is both my dev box and what I show people" without inventing a
 * fifth environment.
 */
export type ZeropsEnvironmentRole = "dev" | "devstage" | "stage" | "prod";

const ROLE_ORDER: ReadonlyArray<ZeropsEnvironmentRole> = ["dev", "devstage", "stage", "prod"];

const ROLE_VALUES: ReadonlySet<string> = new Set(ROLE_ORDER);

function isEnvironmentRole(value: string): value is ZeropsEnvironmentRole {
  return ROLE_VALUES.has(value);
}

export function formatGroupTag(groupId: string): string {
  return `${GROUP_TAG_PREFIX}${groupId}`;
}

export function formatRoleTag(role: ZeropsEnvironmentRole): string {
  return `${ROLE_TAG_PREFIX}${role}`;
}

/**
 * The longest label the mirror tag carries. Nothing on the platform enforces
 * it (a 1024-character tag was accepted, measured 2026-09-05) — this is a
 * legibility budget for a tag chip in the Zerops GUI, not a limit.
 */
export const ZEROPS_GROUP_LABEL_MAX_LENGTH = 64;

/**
 * Collapses whitespace and truncates, because the label is a mirror of a name
 * the user typed into a field that has none of those constraints. Returns
 * `undefined` when nothing legible survives, so an empty name writes no tag at
 * all rather than `mate:name:`.
 */
export function formatLabelTag(name: string): string | undefined {
  const normalized = name
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, ZEROPS_GROUP_LABEL_MAX_LENGTH)
    .trim();
  return normalized.length === 0 ? undefined : `${LABEL_TAG_PREFIX}${normalized}`;
}

export interface ZeropsGroupTags {
  readonly groupId: string | undefined;
  readonly role: ZeropsEnvironmentRole | undefined;
  /** The display mirror (`mate:name:`), never authoritative — see the module doc. */
  readonly label: string | undefined;
}

/**
 * Permissive on read, strict on write: an unknown `mate:` kind or an
 * unrecognized role is ignored rather than guessed at, so a tag written by a
 * newer client never resolves to the wrong thing in an older one.
 */
export function readZeropsGroupTags(tagList: ReadonlyArray<string> | undefined): ZeropsGroupTags {
  let groupId: string | undefined;
  let role: ZeropsEnvironmentRole | undefined;
  let label: string | undefined;

  for (const tag of tagList ?? []) {
    if (groupId === undefined && tag.startsWith(GROUP_TAG_PREFIX)) {
      const value = tag.slice(GROUP_TAG_PREFIX.length);
      if (value.length > 0) groupId = value;
      continue;
    }
    if (role === undefined && tag.startsWith(ROLE_TAG_PREFIX)) {
      const value = tag.slice(ROLE_TAG_PREFIX.length);
      if (isEnvironmentRole(value)) role = value;
      continue;
    }
    if (label === undefined && tag.startsWith(LABEL_TAG_PREFIX)) {
      const value = tag.slice(LABEL_TAG_PREFIX.length).trim();
      if (value.length > 0) label = value;
    }
  }

  return { groupId, role, label };
}

/**
 * The tag list to `PUT` back, given the one the project already carries.
 *
 * `PUT /project/{id}` replaces `tagList` wholesale, so every caller has to
 * read-modify-write; doing it here is what keeps a user's own tags from being
 * deleted by a group rename. Omit `groupId` to take the project out of its
 * group entirely.
 */
export function withZeropsGroupTags(
  tagList: ReadonlyArray<string> | undefined,
  next: {
    readonly groupId?: string;
    readonly role?: ZeropsEnvironmentRole;
    /** The group's name, mirrored into `mate:name:` for the Zerops GUI. */
    readonly label?: string;
  },
): ReadonlyArray<string> {
  const foreign = (tagList ?? []).filter((tag) => !tag.startsWith(MATE_TAG_PREFIX));
  const mate: Array<string> = [];
  if (next.groupId !== undefined) mate.push(formatGroupTag(next.groupId));
  if (next.role !== undefined) mate.push(formatRoleTag(next.role));
  // A label with no group is a label for nothing — the mirror only ever
  // accompanies membership.
  if (next.groupId !== undefined && next.label !== undefined) {
    const labelTag = formatLabelTag(next.label);
    if (labelTag !== undefined) mate.push(labelTag);
  }
  return [...foreign, ...mate];
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
 * Where a group's displayed name came from — the store, the label tags its
 * members carry, or nothing at all. The UI wants this: a group named `"id"` is
 * one the user should be invited to name, and a group named `"tag"` is one
 * whose store record has not caught up.
 */
export type ZeropsGroupNameSource = "store" | "tag" | "id";

export interface ZeropsGroup {
  readonly groupId: string;
  /** Store name, else the members' label tag, else the id. */
  readonly name: string;
  readonly nameSource: ZeropsGroupNameSource;
  readonly environments: ReadonlyArray<ZeropsGroupEnvironment>;
  /**
   * The group's production environment — present only when exactly one member
   * claims the role. Two claimants is a conflict the user has to resolve, and
   * silently picking one would hide it.
   */
  readonly production: ZeropsGroupEnvironment | undefined;
}

export interface ZeropsGroupTree {
  readonly groups: ReadonlyArray<ZeropsGroup>;
  /** Projects carrying no group tag — every Zerops project predating this feature. */
  readonly ungrouped: ReadonlyArray<ZeropsProject>;
}

export interface DeriveZeropsGroupsOptions {
  /** Group id → display name, as read from the recipe store. */
  readonly names?: Readonly<Record<string, string>>;
}

function roleRank(role: ZeropsEnvironmentRole | undefined): number {
  return role === undefined ? ROLE_ORDER.length : ROLE_ORDER.indexOf(role);
}

function byName(left: string, right: string): number {
  return left.localeCompare(right, "en", { sensitivity: "base" });
}

/**
 * The label most of a group's members agree on.
 *
 * A rename writes one tag per member and is not atomic, so a half-applied one
 * leaves the group disagreeing with itself. Taking the majority means the
 * displayed name flips only once the rename is more done than not, and ties
 * break deterministically rather than by whichever project the API listed
 * first.
 */
function consensusLabel(labels: ReadonlyArray<string>): string | undefined {
  const counts = new Map<string, number>();
  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);

  let winner: string | undefined;
  let best = 0;
  for (const [label, count] of counts) {
    if (count > best || (count === best && winner !== undefined && byName(label, winner) < 0)) {
      winner = label;
      best = count;
    }
  }
  return winner;
}

/**
 * The left menu's whole data model: projects in, a group tree out. Pure, and
 * total — a project with no `tagList` at all is ungrouped rather than an error.
 */
export function deriveZeropsGroups(
  projects: ReadonlyArray<ZeropsProject>,
  options: DeriveZeropsGroupsOptions = {},
): ZeropsGroupTree {
  const members = new Map<string, Array<ZeropsGroupEnvironment>>();
  const labels = new Map<string, Array<string>>();
  const ungrouped: Array<ZeropsProject> = [];

  for (const project of projects) {
    const { groupId, role, label } = readZeropsGroupTags(project.tagList);
    if (groupId === undefined) {
      ungrouped.push(project);
      continue;
    }
    const bucket = members.get(groupId);
    if (bucket) bucket.push({ project, role });
    else members.set(groupId, [{ project, role }]);
    if (label !== undefined) {
      const found = labels.get(groupId);
      if (found) found.push(label);
      else labels.set(groupId, [label]);
    }
  }

  const groups = [...members.entries()].map(([groupId, environments]) => {
    const sorted = [...environments].sort(
      (left, right) =>
        roleRank(left.role) - roleRank(right.role) || byName(left.project.name, right.project.name),
    );
    const production = sorted.filter((environment) => environment.role === "prod");
    const stored = options.names?.[groupId];
    const mirrored = consensusLabel(labels.get(groupId) ?? []);
    const [name, nameSource]: [string, ZeropsGroupNameSource] =
      stored !== undefined
        ? [stored, "store"]
        : mirrored !== undefined
          ? [mirrored, "tag"]
          : [groupId, "id"];
    return {
      groupId,
      name,
      nameSource,
      environments: sorted,
      production: production.length === 1 ? production[0] : undefined,
    } satisfies ZeropsGroup;
  });

  groups.sort(
    (left, right) => byName(left.name, right.name) || byName(left.groupId, right.groupId),
  );
  ungrouped.sort((left, right) => byName(left.name, right.name));

  return { groups, ungrouped };
}
