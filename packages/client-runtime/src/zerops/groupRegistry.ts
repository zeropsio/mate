/**
 * The account's registry: which groups exist and which projects are in them,
 * stored as tags on the org's Gitea project.
 *
 * ## Why the Gitea project, and not each member project
 *
 * Today a project says which group it is in with a `mate:g:` tag of its own
 * (`groups.ts`). The platform lets a project-`ADMIN` token rewrite its own
 * project's tags (measured 2026-09-15), and every Mate's container token held
 * exactly that — so a Mate could tag itself into another group and the
 * background reconcile would widen its reach to match. Membership asserted by
 * the member is not membership.
 *
 * The registry moves the assertion somewhere its subject cannot reach: one
 * project per account, the Gitea project, whose tags only its owners and
 * admins may write. A Mate has no grant there at all. The per-project
 * `mate:g:` tags stay as display hints, so the tree still renders before the
 * registry is read; they are no longer what decides anything.
 *
 * ## What the tags are
 *
 * Exactly the four in `docs/vocabulary.md`, and nothing invented here:
 *
 * - `mate:gn:{groupId}:{slug}` — a group exists, and `slug` is its Gitea org;
 * - `mate:gm:{groupId}:{projectId}:{kind}` — a project is in it as `mate`,
 *   `stage` or `production`;
 * - `mate:leaving:{userId}` — a member is being removed, and the
 *   projects-screen reconcile finishes it;
 * - `mate:release:{groupId}:mates` — the group's Mate bots may release (D8).
 *
 * ## Everything else on that project survives a write
 *
 * `PUT /project/{id}` replaces `tagList` wholesale, and the Gitea project
 * carries `mate:tool:gitea` besides whatever a person put there. So parsing
 * keeps every tag it does not own — an orphaned `mate:gm:` among them, which
 * names a group that does not exist and must not be deleted on the strength of
 * that — and the tag list this module produces carries them back.
 *
 * ## The budget
 *
 * A project's tag list may be 65 534 bytes of compact JSON, with no count
 * limit — about 2 500 entries of the registry's shape — and every org-wide
 * project read carries them (60 KB at 2 000 tags, measured 2026-09-16). So
 * entries stay short, and an account that ever nears it moves the registry to
 * a file in a repository the broker owns.
 *
 * Nothing here reaches a network (rule R1).
 *
 * @module groupRegistry
 */

import { MATE_TAG_NAMESPACE } from "./groups.ts";
import type { RoleProjectKind, RoleRegistry } from "@t3tools/shared/zeropsRoles";

const GROUP_NAME_TAG_PREFIX = `${MATE_TAG_NAMESPACE}:gn:`;
const GROUP_MEMBER_TAG_PREFIX = `${MATE_TAG_NAMESPACE}:gm:`;
const LEAVING_TAG_PREFIX = `${MATE_TAG_NAMESPACE}:leaving:`;
const RELEASE_TAG_PREFIX = `${MATE_TAG_NAMESPACE}:release:`;
const RELEASE_TAG_SUFFIX = ":mates";

/** The Gitea org name, and what every OIDC claim spells a group with. */
export const GROUP_SLUG_PATTERN = /^[a-z][a-z0-9-]{1,29}$/u;
/** First character plus 1–29 more, per `docs/vocabulary.md`. */
export const GROUP_SLUG_MAX_LENGTH = 30;
const GROUP_SLUG_MIN_LENGTH = 2;
/** What a name with no usable letters falls back to before it is numbered. */
const GROUP_SLUG_FALLBACK = "group";

const PROJECT_KINDS: ReadonlySet<string> = new Set<RoleProjectKind>([
  "mate",
  "stage",
  "production",
]);

export interface ZeropsRegistryProject {
  readonly projectId: string;
  readonly kind: RoleProjectKind;
}

export interface ZeropsRegistryGroup {
  readonly groupId: string;
  readonly slug: string;
  readonly projects: ReadonlyArray<ZeropsRegistryProject>;
  /** D8's switch: off unless an owner turned it on. */
  readonly matesMayRelease: boolean;
}

export interface ZeropsRegistry {
  readonly groups: ReadonlyArray<ZeropsRegistryGroup>;
  /** Members marked for removal, whose removal any session finishes (1.4). */
  readonly leaving: ReadonlyArray<string>;
  /**
   * Every tag on the project this module does not own, verbatim and in the
   * order it was read — `mate:tool:gitea`, whatever a person added, and any
   * registry tag too malformed or too orphaned to mean anything. Carried so a
   * write-back never deletes what it could not understand.
   */
  readonly other: ReadonlyArray<string>;
}

const EMPTY: ZeropsRegistry = { groups: [], leaving: [], other: [] };

/**
 * The registry as the Gitea project's tags state it.
 *
 * A `mate:gm:` naming a group with no `mate:gn:` is not a membership — there
 * is no slug to call the group by and no Gitea org behind it — so it stays in
 * `other` rather than becoming a group with an invented name or vanishing.
 */
export function parseZeropsRegistry(tagList: ReadonlyArray<string> | undefined): ZeropsRegistry {
  if (tagList === undefined || tagList.length === 0) return EMPTY;

  const slugs = new Map<string, string>();
  const members = new Map<string, Array<ZeropsRegistryProject>>();
  const releasing = new Set<string>();
  const leaving: Array<string> = [];
  const other: Array<string> = [];
  // A `mate:gm:` read before its `mate:gn:` still belongs to the group, so
  // membership is resolved in a second pass over what the first kept.
  const pendingMembers: Array<{ readonly tag: string; readonly groupId: string }> = [];

  for (const tag of tagList) {
    if (tag.startsWith(GROUP_NAME_TAG_PREFIX)) {
      const [groupId, slug, ...rest] = tag.slice(GROUP_NAME_TAG_PREFIX.length).split(":");
      if (rest.length > 0 || !groupId || !slug || !GROUP_SLUG_PATTERN.test(slug)) {
        other.push(tag);
        continue;
      }
      // First wins: two names for one group is a conflict nobody can resolve
      // here, and picking the later one would make the answer depend on the
      // order the platform happened to return.
      if (slugs.has(groupId)) other.push(tag);
      else slugs.set(groupId, slug);
      continue;
    }

    if (tag.startsWith(GROUP_MEMBER_TAG_PREFIX)) {
      const [groupId, projectId, kind, ...rest] = tag
        .slice(GROUP_MEMBER_TAG_PREFIX.length)
        .split(":");
      if (rest.length > 0 || !groupId || !projectId || !kind || !PROJECT_KINDS.has(kind)) {
        other.push(tag);
        continue;
      }
      pendingMembers.push({ tag, groupId });
      (members.get(groupId) ?? members.set(groupId, []).get(groupId)!).push({
        projectId,
        kind: kind as RoleProjectKind,
      });
      continue;
    }

    if (tag.startsWith(RELEASE_TAG_PREFIX) && tag.endsWith(RELEASE_TAG_SUFFIX)) {
      const groupId = tag.slice(RELEASE_TAG_PREFIX.length, tag.length - RELEASE_TAG_SUFFIX.length);
      if (groupId.length === 0 || groupId.includes(":")) other.push(tag);
      else releasing.add(groupId);
      continue;
    }

    if (tag.startsWith(LEAVING_TAG_PREFIX)) {
      const userId = tag.slice(LEAVING_TAG_PREFIX.length);
      if (userId.length === 0 || userId.includes(":")) other.push(tag);
      else if (!leaving.includes(userId)) leaving.push(userId);
      continue;
    }

    other.push(tag);
  }

  for (const pending of pendingMembers) {
    if (!slugs.has(pending.groupId)) other.push(pending.tag);
  }
  for (const groupId of [...releasing]) {
    if (!slugs.has(groupId)) {
      releasing.delete(groupId);
      other.push(`${RELEASE_TAG_PREFIX}${groupId}${RELEASE_TAG_SUFFIX}`);
    }
  }

  const groups = [...slugs]
    .map(([groupId, slug]): ZeropsRegistryGroup => ({
      groupId,
      slug,
      projects: members.get(groupId) ?? [],
      matesMayRelease: releasing.has(groupId),
    }))
    .sort((left, right) => left.slug.localeCompare(right.slug, "en"));

  return { groups, leaving, other };
}

/**
 * The tag list a registry is written back as: sorted, so a registry that has
 * not moved produces an identical document and a write that changes nothing is
 * visibly a no-op.
 */
export function formatZeropsRegistryTags(registry: ZeropsRegistry): ReadonlyArray<string> {
  const tags: Array<string> = [...registry.other];
  for (const group of registry.groups) {
    tags.push(`${GROUP_NAME_TAG_PREFIX}${group.groupId}:${group.slug}`);
    for (const project of group.projects) {
      tags.push(`${GROUP_MEMBER_TAG_PREFIX}${group.groupId}:${project.projectId}:${project.kind}`);
    }
    if (group.matesMayRelease) {
      tags.push(`${RELEASE_TAG_PREFIX}${group.groupId}${RELEASE_TAG_SUFFIX}`);
    }
  }
  for (const userId of registry.leaving) tags.push(`${LEAVING_TAG_PREFIX}${userId}`);
  return [...new Set(tags)].sort();
}

/** The registry in the shape the shared role function reads (`docs/roles.md`). */
export function toRoleRegistry(registry: ZeropsRegistry): RoleRegistry {
  return {
    groups: registry.groups.map((group) => ({
      id: group.groupId,
      slug: group.slug,
      projects: group.projects.map((project) => ({ id: project.projectId, kind: project.kind })),
    })),
  };
}

/**
 * A group's slug, derived from its name once and never changed afterwards —
 * it is the Gitea org, and renaming a Gitea org breaks every clone URL under
 * it.
 *
 * Unique against the slugs already taken, because the org namespace is the
 * whole account's: two groups called "Acme" and "acme!" would otherwise ask
 * for the same org. Collisions are numbered rather than hashed, so the second
 * "Acme" is `acme-2` and a person can still read it.
 */
export function deriveGroupSlug(name: string, existingSlugs: ReadonlyArray<string> = []): string {
  const taken = new Set(existingSlugs);
  const base = groupSlugBase(name);
  if (!taken.has(base)) return base;
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const tail = `-${suffix}`;
    const candidate = `${base.slice(0, GROUP_SLUG_MAX_LENGTH - tail.length)}${tail}`;
    if (!taken.has(candidate)) return candidate;
  }
  // 999 groups sharing one name is not a case worth a cleverer scheme; the
  // caller gets a name it can refuse rather than a slug that collides.
  throw new Error(`No free slug for "${name}".`);
}

function groupSlugBase(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    // Strip the combining marks NFKD just split off, so "Ácme" is "acme" and
    // not "a-cme".
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  // The slug has to start with a letter: a group called "2024 Launch" cannot
  // be `2024-launch`.
  const started = /^[a-z]/u.test(cleaned) ? cleaned : `${GROUP_SLUG_FALLBACK}-${cleaned}`;
  const clamped = started.slice(0, GROUP_SLUG_MAX_LENGTH).replace(/-+$/u, "");
  return clamped.length >= GROUP_SLUG_MIN_LENGTH ? clamped : GROUP_SLUG_FALLBACK;
}

/**
 * The body of `PUT /project/{id}` — the one call that writes a project's tags.
 *
 * Five fields, and `userRoles` is not among them. The platform replaces the
 * record, and `userRoles` is an object on the wire whose omission means "leave
 * the roles alone" and whose inclusion would rewrite who can reach the
 * project. The registry has no business doing that, and the Gitea project is
 * exactly where a mistake there would be worst.
 */
export function projectTagWriteBody(input: {
  readonly name: string;
  readonly description?: string | undefined;
  readonly tagList: ReadonlyArray<string>;
  readonly publicIpV4Shared?: boolean | undefined;
  readonly maxCreditLimit?: number | null | undefined;
}): {
  readonly name: string;
  readonly description: string;
  readonly tagList: ReadonlyArray<string>;
  readonly publicIpV4Shared: boolean;
  readonly maxCreditLimit: number | null;
} {
  return {
    name: input.name,
    description: input.description ?? "",
    tagList: input.tagList,
    publicIpV4Shared: input.publicIpV4Shared ?? false,
    maxCreditLimit: input.maxCreditLimit ?? null,
  };
}
