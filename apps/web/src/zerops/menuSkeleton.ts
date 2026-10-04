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
import { placementsOf, placeProject } from "@t3tools/client-runtime/zerops/hq";
import { menuMemory } from "./menuMemory";
import type { EnvironmentId } from "@t3tools/contracts";
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
    project: row.project,
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

/** What the menu draws of its listing and its memory (`menuRowsOf`). */
export interface MenuRowsInput<Row extends CandidateRow> {
  readonly listing: Shown<ReadonlyArray<Row>>;
  readonly held: HeldCandidates<Row>;
  /** The organization's tree as this browser remembers it (`rememberedMenuCandidates`). */
  readonly remembered: ReadonlyArray<Row> | undefined;
  /**
   * The listing is the organization's in view: false for the moment a switch of organization
   * leaves the listing on the last one's.
   */
  readonly current: boolean;
  /**
   * The grace `menuWiring` keys has run out (`STILL_READING_PATIENCE_MS`): a known listing not
   * whole and read holds what there is — a project withheld for good, or one whose container is
   * never read — and a read failed for good says so alone.
   */
  readonly graceOver: boolean;
  /**
   * The listing lacks nothing still on its way for this person (`listingWholeForPerson`): every
   * project it does not show is one they can never see or that can never be read.
   */
  readonly whole: boolean;
}

export interface MenuRows<Row> {
  readonly rows: ReadonlyArray<Row>;
  /** Nothing is missing from `rows`: the one licence to say "none". Never from memory. */
  readonly complete: boolean;
  /** Some of `rows` are this browser's memory: what the menu draws teaches its memory nothing. */
  readonly fromMemory: boolean;
  /** The tree to remember of this draw, once its listing is whole; null until then. */
  readonly toRemember: ReadonlyArray<Row> | null;
}

/**
 * The rows the menu draws:
 * - while the listing holds no rows — unread, being read, its read failed and retrying, its
 *   access not verified yet — the tree it last drew, where it remembers one, so a first read
 *   that keeps failing never takes it back between retries (its notice stands under the rows);
 * - a known listing draws its rows, each one whose container is not read yet as remembered, and,
 *   while it is known only in part, the remembered projects it does not hold yet — none vanishes
 *   to come back — until its grace is over, when it is what there is;
 * - a whole, read listing replaces the memory in place, and a lapse says so as it always did;
 * - and for the moment the listing is the last organization's, the tree of the one in view.
 * Only a whole listing is remembered — its rows read, and as remembered those not read yet — so a
 * project never read keeps neither the menu still nor the organization's other changes unkept.
 */
export function menuRowsOf<Row extends CandidateRow>(input: MenuRowsInput<Row>): MenuRows<Row> {
  const { listing, held } = input;
  const remembered = input.remembered ?? [];
  const live: MenuRows<Row> = {
    rows: held.rows,
    complete: held.complete,
    fromMemory: false,
    toRemember: null,
  };
  const fromMemory: MenuRows<Row> = {
    rows: remembered,
    complete: false,
    fromMemory: true,
    toRemember: null,
  };
  if (!input.current)
    return remembered.length === 0 ? { ...live, rows: [], complete: false } : fromMemory;
  if (listing.state !== "known") {
    const holds =
      listing.state === "unread" ||
      listing.state === "reading" ||
      (listing.state === "failed" && (listing.retryAtMs !== null || !input.graceOver)) ||
      (listing.state === "withheld" && listing.reason === "access-unverified");
    return holds && remembered.length > 0 ? fromMemory : live;
  }
  const rememberedOf = (projectId: string) =>
    remembered.filter((row) => row.project.id === projectId);
  const wholeList = listing.coverage === "complete" || input.whole;
  const toRemember = wholeList
    ? held.rows.flatMap((row) => (row.presence === "known" ? [row] : rememberedOf(row.project.id)))
    : null;
  if (held.complete || input.graceOver || remembered.length === 0) return { ...live, toRemember };
  let kept = false;
  const rows = held.rows.flatMap((row) => {
    if (row.presence === "known") return [row];
    const same = rememberedOf(row.project.id);
    if (same.length === 0) return [row];
    kept = true;
    return same;
  });
  if (!wholeList) {
    const listed = new Set(held.rows.map((row) => row.project.id));
    const unlisted = remembered.filter((row) => !listed.has(row.project.id));
    if (unlisted.length > 0) {
      kept = true;
      rows.push(...unlisted);
    }
  }
  return kept ? { rows, complete: false, fromMemory: true, toRemember } : { ...live, toRemember };
}

/** How the menu reads its listing against the organization in view (`menuWiring`). */
export interface MenuWiring {
  /** The listing is the organization's in view (`MenuRowsInput.current`). */
  readonly current: boolean;
  /** The organization what the menu draws is remembered under: the listing's, while current. */
  readonly rememberUnder: string | null;
  /**
   * What the grace before a listing is taken as it is counts for — its organization and what it
   * waits through — so a switch, or a wait of another kind, starts one of its own; null while
   * nothing waits.
   */
  readonly graceKey: string | null;
}

/**
 * Which organization the listing is — the inventory's, a commit behind the session's on a
 * switch — and what its grace counts for: a known listing not whole and read, or a read failed
 * for good.
 */
export function menuWiring(input: {
  /** The organization in view (the session's). */
  readonly organizationId: string | undefined;
  /** The organization the listing is of (the inventory's). */
  readonly listingOrganizationId: string | undefined;
  readonly listing: Shown<ReadonlyArray<unknown>>;
  /** The listing is whole and every row read (`HeldCandidates.complete`). */
  readonly complete: boolean;
}): MenuWiring {
  const organization = input.organizationId;
  const current = organization !== undefined && input.listingOrganizationId === organization;
  if (!current) return { current: false, rememberUnder: null, graceKey: null };
  const { listing } = input;
  const waits =
    listing.state === "known" && !input.complete
      ? "known"
      : listing.state === "failed" && listing.retryAtMs === null
        ? "failed"
        : null;
  return {
    current,
    rememberUnder: organization,
    graceKey: waits === null ? null : `${organization}:${waits}`,
  };
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
const drawn = new WeakMap<
  ReadonlyArray<SkeletonRow>,
  { readonly structure: unknown; readonly candidates: ReadonlyArray<CandidateRow> }
>();

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

/** The tree this browser remembers drawing for the organization, as candidates — the same array each call. */
export function rememberedMenuCandidates(
  organizationId: string | undefined,
): ReadonlyArray<CandidateRow> | undefined {
  return rememberedCandidatesOf(menuSkeletonSnapshot(), organizationId);
}

/** An organization's remembered tree in a memory, as candidates — the same array for the same rows. */
export function rememberedCandidatesOf(
  skeleton: MenuSkeleton,
  organizationId: string | undefined,
): ReadonlyArray<CandidateRow> | undefined {
  if (organizationId === undefined) return undefined;
  const rows = skeleton.organizations[organizationId]?.rows;
  if (rows === undefined) return undefined;
  const structure = menuMemory().structures[organizationId];
  const cached = drawn.get(rows);
  let candidates = cached?.structure === structure ? cached?.candidates : undefined;
  if (candidates === undefined) {
    const placements = structure === undefined ? null : placementsOf(structure);
    candidates = rows.map((row) => {
      const candidate = candidateOfSkeleton(row);
      return placements === null
        ? candidate
        : { ...candidate, project: placeProject(candidate.project, placements) };
    });
    drawn.set(rows, { structure, candidates });
  }
  return candidates;
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
