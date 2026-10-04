/**
 * The left menu's tree as it last stood — each organization's Mates, with the environment each
 * one's conversation opened in — remembered in this browser so the open row keeps its highlight
 * while its link is not made again (`projectOpenedIn`). Which rows the menu draws is HQ's
 * (`useZeropsMenu.tsx`), from the structure `menuMemory.ts` remembers; the rows' words, changes,
 * chips and members are `menuMemory.ts`'s too.
 *
 * Kept per account (`accountLocalStorage`: another person on this browser reads nothing) and per
 * organization, bounded — a few organizations, the newest kept, a cap on rows and bytes — and
 * forgotten when the account closes. Nothing live is kept: a row's dots, timers and status come
 * from its conversation, which a remembered row has not heard yet.
 */
import type { EnvironmentId } from "@t3tools/contracts";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import * as Schema from "effect/Schema";

import { accountLocalStorage, currentAccountId, onAccountLifetimeClose } from "./accountLifetime";

export const MENU_SKELETON_STORAGE_KEY = "mate:zerops:menu-skeleton";
/** How many organizations' trees are kept: the newest drawn. */
export const MENU_SKELETON_MAX_ORGANIZATIONS = 4;
/** How many rows one organization's tree keeps: the first, in the listing's order. */
export const MENU_SKELETON_MAX_ROWS = 200;
/** How large the whole memory may be, encoded; the oldest organizations go first. */
export const MENU_SKELETON_MAX_BYTES = 256 * 1024;
/**
 * How long after it was last marked an organization's tree drawn again marks it visited: often
 * enough that the organization visited daily is never the oldest, seldom enough not to write the
 * memory at every draw.
 */
export const MENU_SKELETON_VISIT_MS = 10 * 60_000;

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
  /**
   * The environment its conversation opened in, last time its link was made — only to say which
   * row is open while the menu paints from memory, never that it is linked.
   */
  openedIn: Schema.optionalKey(Schema.String),
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

/**
 * What a row needs of a candidate to paint again, and nothing only true now: a Mate linked when
 * it was drawn is remembered as one whose link is not made yet — whether it is linked is its
 * socket's to say — with the environment it opened in, for the open row's highlight.
 */
export function skeletonRowOf(
  candidate: ZeropsCandidate,
  /** Where it opened before, kept while its link is not made now. */
  openedBefore?: string,
): SkeletonRow {
  const { project, service } = candidate;
  return {
    key: candidate.key,
    group: candidate.group === "connected" ? "ready" : candidate.group,
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
    ...optional("openedIn", candidate.environmentId ?? openedBefore),
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

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The memory with an organization's tree as drawn now — its first rows up to the cap, each Mate
 * keeping the environment it last opened in — and only the newest organizations up to theirs.
 * The same memory when the tree is as it was, unless its last mark is `MENU_SKELETON_VISIT_MS`
 * old: then it is marked visited.
 */
export function withOrganizationSkeleton(
  skeleton: MenuSkeleton,
  organizationId: string,
  candidates: ReadonlyArray<ZeropsCandidate>,
  atMs: number,
): MenuSkeleton {
  const before = skeleton.organizations[organizationId];
  const opened = new Map(
    (before?.rows ?? []).flatMap((row) =>
      row.openedIn === undefined ? [] : [[row.key, row.openedIn] as const],
    ),
  );
  const rows = candidates
    .slice(0, MENU_SKELETON_MAX_ROWS)
    .map((candidate) => skeletonRowOf(candidate, opened.get(candidate.key)));
  const unchanged = before !== undefined && same(before.rows, rows);
  if (unchanged && atMs - before.at < MENU_SKELETON_VISIT_MS) return skeleton;
  const kept = Object.entries({
    ...skeleton.organizations,
    [organizationId]: { at: atMs, rows: unchanged ? before.rows : rows },
  })
    .toSorted(([, left], [, right]) => right.at - left.at)
    .slice(0, MENU_SKELETON_MAX_ORGANIZATIONS);
  return { organizations: Object.fromEntries(kept) };
}

/** The remembered Mate an environment's conversation opened in, in the organization's tree. */
export function projectOpenedIn(
  skeleton: MenuSkeleton,
  organizationId: string,
  environmentId: EnvironmentId,
): string | undefined {
  return skeleton.organizations[organizationId]?.rows.find((row) => row.openedIn === environmentId)
    ?.project.id;
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

// ── This browser's memory ───────────────────────────────────────────────────────────────────

let held: { readonly account: string; skeleton: MenuSkeleton } | null = null;
const listeners = new Set<() => void>();

function changed(): void {
  for (const listener of listeners) listener();
}

/** Calls `listener` at every change to the memory; returns its removal. */
export function onMenuSkeletonChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
/** Each organization's tree drawn since the last write, by organization, with when. */
let pending = new Map<
  string,
  { readonly candidates: ReadonlyArray<ZeropsCandidate>; readonly atMs: number }
>();
let writing: ReturnType<typeof setTimeout> | null = null;
function readStored(): MenuSkeleton {
  try {
    return decodeMenuSkeleton(accountLocalStorage.getItem(MENU_SKELETON_STORAGE_KEY));
  } catch {
    return EMPTY_MENU_SKELETON;
  }
}

/**
 * What this browser remembers for the account signed in now; nothing before one is. The same
 * object until it changes (`onMenuSkeletonChange`): what reads it follows its writes.
 */
export function menuSkeletonSnapshot(): MenuSkeleton {
  const account = typeof window === "undefined" ? null : currentAccountId();
  if (account === null) return EMPTY_MENU_SKELETON;
  if (held?.account !== account) held = { account, skeleton: readStored() };
  return held.skeleton;
}

/**
 * Remembers the organization's tree as drawn now, written once the menu settles a moment — into
 * the memory as stored then, replacing only this organization's tree: another tab of the account,
 * in another organization, keeps what it wrote meanwhile.
 */
export function rememberMenuCandidates(
  organizationId: string,
  candidates: ReadonlyArray<ZeropsCandidate>,
): void {
  const before = menuSkeletonSnapshot();
  if (held === null) return;
  const atMs = Date.now();
  const next = withOrganizationSkeleton(before, organizationId, candidates, atMs);
  if (next === before) return;
  held.skeleton = next;
  changed();
  pending.set(organizationId, { candidates, atMs });
  if (writing !== null) clearTimeout(writing);
  writing = setTimeout(() => {
    writing = null;
    const drawnSince = pending;
    pending = new Map();
    if (held === null) return;
    let skeleton = readStored();
    for (const [id, { candidates: rows, atMs: at }] of drawnSince) {
      skeleton = withOrganizationSkeleton(skeleton, id, rows, at);
    }
    if (!same(held.skeleton, skeleton)) {
      held.skeleton = skeleton;
      changed();
    }
    try {
      const encoded = encodeMenuSkeleton(skeleton);
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
  pending = new Map();
  held = null;
  changed();
  try {
    accountLocalStorage.removeItem(MENU_SKELETON_STORAGE_KEY);
  } catch {
    // Storage refused: nothing more can be done from here.
  }
});
