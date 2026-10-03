/**
 * The left menu's tree as it last stood — each organization's projects and Mates, with what a row
 * needs to paint: ids, names, tags (the face, the group, the role), the container, the link —
 * remembered in this browser so a reload paints the menu at once, not an empty one that fills
 * when the listing lands (loading-states pass, 2026-10-03). The rows' words, changes, chips and
 * members stay `menuMemory.ts`'s; this is the tree they hang on.
 *
 * Kept per account (`accountLocalStorage`: another person on this browser reads nothing) and per
 * organization, bounded — a few organizations, the newest kept, a cap on rows and bytes — and
 * forgotten when the account closes. Nothing live is kept: a row's dots, timers and status come
 * from its conversation, which a remembered row has not heard yet.
 */
import { EnvironmentId } from "@t3tools/contracts";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import type { Shown } from "@t3tools/client-runtime/zerops/knowledge";
import type { CandidateRow, HeldCandidates } from "@t3tools/client-runtime/zerops/projections";
import * as Schema from "effect/Schema";

import { accountLocalStorage, currentAccountId, onAccountLifetimeClose } from "./accountLifetime";

export const MENU_SKELETON_STORAGE_KEY = "mate:zerops:menu-skeleton";
/** How many organizations' trees are kept: the newest drawn. */
export const MENU_SKELETON_MAX_ORGANIZATIONS = 4;
/** How many rows one organization's tree keeps: the first, in the listing's order. */
export const MENU_SKELETON_MAX_ROWS = 200;
/** How large the whole memory may be, encoded; the oldest organizations go first. */
export const MENU_SKELETON_MAX_BYTES = 256 * 1024;

const RowSchema = Schema.Struct({
  key: Schema.String,
  group: Schema.Literals(["connected", "ready", "provisioning", "unavailable"]),
  missingContainer: Schema.optionalKey(Schema.Literal(true)),
  creationFailed: Schema.optionalKey(Schema.Struct({ message: Schema.optionalKey(Schema.String) })),
  service: Schema.optionalKey(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      status: Schema.String,
      created: Schema.optionalKey(Schema.String),
    }),
  ),
  containerOrigin: Schema.optionalKey(Schema.String),
  environmentId: Schema.optionalKey(Schema.String),
  project: Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    status: Schema.String,
    clientId: Schema.optionalKey(Schema.String),
    created: Schema.optionalKey(Schema.String),
    tagList: Schema.optionalKey(Schema.Array(Schema.String)),
    userRoles: Schema.optionalKey(
      Schema.Array(Schema.Struct({ clientUserId: Schema.String, roleCode: Schema.String })),
    ),
  }),
});

const OrganizationSchema = Schema.Struct({
  /** When it was drawn, wall ms: the oldest organization is the first let go. */
  at: Schema.Number,
  rows: Schema.Array(RowSchema),
});

const MenuSkeletonSchema = Schema.Struct({
  organizations: Schema.Record(Schema.String, OrganizationSchema),
});

export type SkeletonRow = typeof RowSchema.Type;
export type MenuSkeleton = typeof MenuSkeletonSchema.Type;

export const EMPTY_MENU_SKELETON: MenuSkeleton = { organizations: {} };

const optional = <K extends string, V>(key: K, value: V | undefined) =>
  (value === undefined ? {} : { [key]: value }) as { [P in K]?: V };

/** What a row needs of a candidate to paint again, and nothing only true now. */
export function skeletonRowOf(candidate: ZeropsCandidate): SkeletonRow {
  const { project, service } = candidate;
  return {
    key: candidate.key,
    group: candidate.group,
    ...optional("missingContainer", candidate.missingContainer),
    ...optional(
      "creationFailed",
      candidate.creationFailed === undefined
        ? undefined
        : optional("message", candidate.creationFailed.message),
    ),
    ...optional(
      "service",
      service === undefined
        ? undefined
        : {
            id: service.id,
            name: service.name,
            status: service.status,
            ...optional("created", service.created),
          },
    ),
    ...optional("containerOrigin", candidate.containerOrigin),
    ...optional("environmentId", candidate.environmentId),
    project: {
      id: project.id,
      name: project.name,
      status: project.status,
      ...optional("clientId", project.clientId),
      ...optional("created", project.created),
      ...optional("tagList", project.tagList),
      ...optional(
        "userRoles",
        project.userRoles?.map(({ clientUserId, roleCode }) => ({ clientUserId, roleCode })),
      ),
    },
  };
}

/** A remembered row as the candidate it was: as read when it was drawn. */
export function candidateOfSkeleton(row: SkeletonRow): CandidateRow {
  return {
    key: row.key,
    group: row.group,
    presence: "known",
    ...optional("missingContainer", row.missingContainer),
    ...optional(
      "creationFailed",
      row.creationFailed === undefined ? undefined : { message: row.creationFailed.message },
    ),
    ...optional("service", row.service),
    ...optional("containerOrigin", row.containerOrigin),
    ...optional(
      "environmentId",
      row.environmentId === undefined ? undefined : EnvironmentId.make(row.environmentId),
    ),
    project: row.project,
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The memory with an organization's tree as drawn now — its first rows up to the cap — and only
 * the newest organizations up to theirs; the same memory when the tree is as it was.
 */
export function withOrganizationSkeleton(
  skeleton: MenuSkeleton,
  organizationId: string,
  candidates: ReadonlyArray<ZeropsCandidate>,
  atMs: number,
): MenuSkeleton {
  const rows = candidates.slice(0, MENU_SKELETON_MAX_ROWS).map(skeletonRowOf);
  if (same(skeleton.organizations[organizationId]?.rows, rows)) return skeleton;
  const kept = Object.entries({
    ...skeleton.organizations,
    [organizationId]: { at: atMs, rows },
  })
    .toSorted(([, left], [, right]) => right.at - left.at)
    .slice(0, MENU_SKELETON_MAX_ORGANIZATIONS);
  return { organizations: Object.fromEntries(kept) };
}

const encode = Schema.encodeSync(Schema.fromJsonString(MenuSkeletonSchema));
const decode = Schema.decodeUnknownSync(Schema.fromJsonString(MenuSkeletonSchema));

/**
 * The memory as stored: within `MENU_SKELETON_MAX_BYTES`, the oldest organizations let go first;
 * `null` where even the newest alone does not fit.
 */
export function encodeMenuSkeleton(skeleton: MenuSkeleton): string | null {
  let entries = Object.entries(skeleton.organizations).toSorted(
    ([, left], [, right]) => right.at - left.at,
  );
  while (entries.length > 0) {
    const encoded = encode({ organizations: Object.fromEntries(entries) });
    if (encoded.length <= MENU_SKELETON_MAX_BYTES) return encoded;
    entries = entries.slice(0, -1);
  }
  return null;
}

/** The stored memory; nothing where nothing is stored, or what is cannot be read. */
export function decodeMenuSkeleton(stored: string | null): MenuSkeleton {
  if (stored === null) return EMPTY_MENU_SKELETON;
  try {
    return decode(stored);
  } catch {
    return EMPTY_MENU_SKELETON;
  }
}

/**
 * The rows the menu draws, and whether any comes from this browser's memory:
 * - while the listing holds no rows yet — unread, being read, or its access not verified yet —
 *   the tree it last drew, where it remembers one;
 * - a listing known in part draws its rows, each one whose container is not read yet as it was
 *   remembered — and, while it holds none at all, the tree;
 * - otherwise the listing's own rows: a known, whole listing replaces the memory in place, and a
 *   failed or refused read says so as it always did.
 * A remembered row is never complete: nothing reads "none" off a memory. `settled` says the draw is
 * the one to remember: its listing is known, with rows, and every one of them read.
 */
export function menuRowsOf<Row extends CandidateRow>(
  listing: Shown<ReadonlyArray<Row>>,
  held: HeldCandidates<Row>,
  remembered: ReadonlyArray<Row> | undefined,
): {
  readonly rows: ReadonlyArray<Row>;
  readonly complete: boolean;
  readonly fromMemory: boolean;
  readonly settled: boolean;
} {
  const settled =
    listing.state === "known" &&
    (held.complete || (held.rows.length > 0 && held.rows.every((row) => row.presence === "known")));
  const live = { rows: held.rows, complete: held.complete, fromMemory: false, settled };
  if (remembered === undefined || remembered.length === 0) return live;
  const fromMemory = { rows: remembered, complete: false, fromMemory: true, settled: false };
  switch (listing.state) {
    case "unread":
    case "reading":
      return fromMemory;
    case "withheld":
      return listing.reason === "access-unverified" ? fromMemory : live;
    case "known": {
      if (held.complete) return live;
      if (held.rows.length === 0) return fromMemory;
      let kept = false;
      const rows = held.rows.flatMap((row) => {
        if (row.presence === "known") return [row];
        const same = remembered.filter((entry) => entry.project.id === row.project.id);
        if (same.length === 0) return [row];
        kept = true;
        return same;
      });
      return kept ? { rows, complete: false, fromMemory: true, settled: false } : live;
    }
    default:
      return live;
  }
}

// ── This browser's memory ───────────────────────────────────────────────────────────────────

let held: { readonly account: string; skeleton: MenuSkeleton } | null = null;
let writing: ReturnType<typeof setTimeout> | null = null;
const drawn = new WeakMap<ReadonlyArray<SkeletonRow>, ReadonlyArray<CandidateRow>>();

/** What this browser remembers for the account signed in now; nothing before one is. */
function memory(): MenuSkeleton {
  const account = typeof window === "undefined" ? null : currentAccountId();
  if (account === null) return EMPTY_MENU_SKELETON;
  if (held?.account !== account) {
    let stored: string | null = null;
    try {
      stored = accountLocalStorage.getItem(MENU_SKELETON_STORAGE_KEY);
    } catch {
      stored = null;
    }
    held = { account, skeleton: decodeMenuSkeleton(stored) };
  }
  return held.skeleton;
}

/** The tree this browser remembers drawing for the organization, as candidates — the same array each call. */
export function rememberedMenuCandidates(
  organizationId: string | undefined,
): ReadonlyArray<CandidateRow> | undefined {
  if (organizationId === undefined) return undefined;
  const rows = memory().organizations[organizationId]?.rows;
  if (rows === undefined) return undefined;
  let candidates = drawn.get(rows);
  if (candidates === undefined) {
    candidates = rows.map(candidateOfSkeleton);
    drawn.set(rows, candidates);
  }
  return candidates;
}

/** Remembers the organization's tree as drawn now, written once the menu settles a moment. */
export function rememberMenuCandidates(
  organizationId: string,
  candidates: ReadonlyArray<ZeropsCandidate>,
): void {
  const before = memory();
  if (held === null) return;
  const next = withOrganizationSkeleton(before, organizationId, candidates, Date.now());
  if (next === before) return;
  held.skeleton = next;
  if (writing !== null) clearTimeout(writing);
  writing = setTimeout(() => {
    writing = null;
    if (held === null) return;
    try {
      const encoded = encodeMenuSkeleton(held.skeleton);
      if (encoded === null) accountLocalStorage.removeItem(MENU_SKELETON_STORAGE_KEY);
      else accountLocalStorage.setItem(MENU_SKELETON_STORAGE_KEY, encoded);
    } catch {
      // A full or blocked storage keeps nothing: the next reload waits for the listing.
    }
  }, 400);
}

// A closed account's tree is gone with it, and the next account reads its own.
onAccountLifetimeClose(() => {
  if (writing !== null) clearTimeout(writing);
  writing = null;
  held = null;
  try {
    accountLocalStorage.removeItem(MENU_SKELETON_STORAGE_KEY);
  } catch {
    // Storage refused: nothing more can be done from here.
  }
});
