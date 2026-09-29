/**
 * What the left menu last drew, remembered in this browser so a reload
 * paints the menu as it stood — not names that grow into rows as each Mate
 * connects, change rows that arrive when Gitea answers, a stop named twice,
 * and *Mine* showing everyone until the members are read (the owner,
 * 2026-09-27). Each piece stands until its own live read replaces it:
 * - a Mate's row: what was asked, its last words, when, and whether unread;
 * - a project's change rows, drawn without their verbs;
 * - a project's production chip, as it last said it;
 * - a Mate's crew, its faces, so its line keeps its place;
 * - an organization's members, whose each Mate is.
 *
 * Kept per account, like the project order, and forgotten when the account
 * closes: it quotes conversations — masked, as every quote is
 * (`maskSecrets`), but still what was said.
 */
import type { FlowPullRequest, ZeropsOrganizationMember } from "@t3tools/client-runtime/zerops";
import { ThreadId } from "@t3tools/contracts";
import { MATE_TINT_IDS, type MateTintId } from "@t3tools/shared/brand";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { mateRowView } from "~/components/zerops/SidebarMateRow.logic";

import { accountLocalStorage, currentAccountId, onAccountLifetimeClose } from "./accountLifetime";
import type { ZeropsAgentActivity } from "./agentActivity";

export const MENU_MEMORY_STORAGE_KEY = "mate:zerops:menu-memory";

const RowSchema = Schema.Struct({
  subject: Schema.optionalKey(Schema.String),
  snippet: Schema.optionalKey(Schema.String),
  /** The row held its third line with no words to keep (drawn again as `MateReplyPending`). */
  awaitingWords: Schema.optionalKey(Schema.Boolean),
  task: Schema.optionalKey(Schema.String),
  at: Schema.String,
  unread: Schema.Boolean,
  threadId: Schema.String,
  threadKey: Schema.String,
});

const ChangeSchema = Schema.Struct({
  repository: Schema.String,
  number: Schema.Number,
  title: Schema.String,
  mateProjectId: Schema.optionalKey(Schema.String),
  author: Schema.optionalKey(Schema.String),
  url: Schema.optionalKey(Schema.String),
  line: Schema.String,
  baseBranch: Schema.String,
  updatedAt: Schema.optionalKey(Schema.String),
});

/** A project's production chip as it was drawn (`SidebarProductionChip.logic.ts`). */
const ChipSchema = Schema.Struct({
  label: Schema.Literals(["prod", "stage"]),
  state: Schema.Literals([
    "ok",
    "waiting",
    "releasing",
    "failed",
    "down",
    "stopped",
    "creating",
    "empty",
  ]),
  version: Schema.optionalKey(Schema.String),
  next: Schema.optionalKey(Schema.String),
  waiting: Schema.optionalKey(Schema.Number),
});

/**
 * A Mate's crew as its line under the row drew it: its faces, the lead first,
 * at rest — which of them works or waits, and the crew's one fact, are only
 * true now and are read again.
 */
const CrewSchema = Schema.Struct({
  faces: Schema.Array(
    Schema.Struct({
      handle: Schema.String,
      displayName: Schema.String,
      tint: Schema.Literals(MATE_TINT_IDS),
      lead: Schema.Boolean,
    }),
  ),
});

const MemberSchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.optionalKey(Schema.String),
  status: Schema.optionalKey(Schema.String),
  roleCode: Schema.optionalKey(Schema.String),
  canCreateProjects: Schema.optionalKey(Schema.Boolean),
  user: Schema.optionalKey(
    Schema.Struct({
      id: Schema.optionalKey(Schema.String),
      fullName: Schema.optionalKey(Schema.String),
      firstName: Schema.optionalKey(Schema.String),
      lastName: Schema.optionalKey(Schema.String),
      email: Schema.optionalKey(Schema.String),
      avatar: Schema.optionalKey(
        Schema.NullOr(
          Schema.Struct({
            smallAvatarUrl: Schema.optionalKey(Schema.NullOr(Schema.String)),
            largeAvatarUrl: Schema.optionalKey(Schema.NullOr(Schema.String)),
            externalAvatarUrl: Schema.optionalKey(Schema.NullOr(Schema.String)),
          }),
        ),
      ),
    }),
  ),
});

const MenuMemorySchema = Schema.Struct({
  rows: Schema.Record(Schema.String, RowSchema),
  changes: Schema.Record(Schema.String, Schema.Array(ChangeSchema)),
  // Absent from a memory written before the production chip: none remembered
  // yet, and the rest of that memory still reads.
  chips: Schema.Record(Schema.String, ChipSchema).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed({})),
  ),
  // A memory written before crews were kept reads with none.
  crews: Schema.Record(Schema.String, CrewSchema).pipe(
    Schema.withDecodingDefault(Effect.succeed({})),
  ),
  members: Schema.Record(Schema.String, Schema.Array(MemberSchema)),
});

export type RememberedRow = typeof RowSchema.Type;
export type RememberedChange = typeof ChangeSchema.Type;
export type RememberedChip = typeof ChipSchema.Type;
export type RememberedCrew = typeof CrewSchema.Type;
export type RememberedMember = typeof MemberSchema.Type;
export type MenuMemory = typeof MenuMemorySchema.Type;

export const EMPTY_MENU_MEMORY: MenuMemory = {
  rows: {},
  changes: {},
  chips: {},
  crews: {},
  members: {},
};

/**
 * A row's words as a Mate's activity last said them — and whether it held a
 * third line with no words to keep, which is the row's height: a reload draws
 * the line again rather than growing it when the socket answers.
 */
export function rememberedRowOf(activity: ZeropsAgentActivity): RememberedRow {
  // The row's third line stood without words to keep — words still to come,
  // the step it was on, the question it asked, the error it stopped on before
  // saying anything: a reload holds the line with the dots (`mateRowView`).
  const awaiting =
    activity.snippet === undefined && mateRowView(activity, activity.face).reply !== undefined;
  return {
    ...(activity.subject === undefined ? {} : { subject: activity.subject }),
    ...(activity.snippet === undefined ? {} : { snippet: activity.snippet }),
    ...(awaiting ? { awaitingWords: true } : {}),
    ...(activity.task === undefined ? {} : { task: activity.task }),
    at: activity.at,
    unread: activity.unread,
    threadId: activity.threadId,
    threadKey: activity.threadKey,
  };
}

/**
 * A remembered row as an activity to draw: its words and its time, and
 * nothing that is only true now — at rest, no status, no plan, no pause —
 * so no clock ticks and no *Stop* is offered from memory.
 */
export function activityFromMemory(row: RememberedRow): ZeropsAgentActivity {
  return {
    threadId: ThreadId.make(row.threadId),
    kind: "idle",
    status: null,
    face: "idle",
    subject: row.subject,
    at: row.at,
    snippet: row.snippet,
    ...(row.awaitingWords === true ? { awaitingWords: true as const } : {}),
    unread: row.unread,
    pausedUntil: undefined,
    threadKey: row.threadKey,
    task: row.task,
    remembered: true,
  };
}

/** What a change row needs of a pull request to be drawn again. */
export function rememberedChangeOf(pull: FlowPullRequest): RememberedChange {
  return {
    repository: pull.repository,
    number: pull.number,
    title: pull.title,
    ...(pull.mateProjectId === undefined ? {} : { mateProjectId: pull.mateProjectId }),
    ...(pull.author === undefined ? {} : { author: pull.author }),
    ...(pull.url === undefined ? {} : { url: pull.url }),
    line: pull.line,
    baseBranch: pull.baseBranch,
    ...(pull.updatedAt === undefined ? {} : { updatedAt: pull.updatedAt }),
  };
}

/**
 * A remembered change as a pull request: its title where it hung, and no
 * verdict — its checks and whether it merges are Gitea's to say again.
 */
export function changeFromMemory(change: RememberedChange): FlowPullRequest {
  return {
    repository: change.repository,
    number: change.number,
    title: change.title,
    kind: "code",
    mateProjectId: change.mateProjectId,
    author: change.author,
    url: change.url,
    checks: "none",
    checkWord: undefined,
    mergeability: "checking",
    merged: false,
    mergedAt: undefined,
    headSha: undefined,
    baseBranch: change.baseBranch,
    line: change.line,
    updatedAt: change.updatedAt,
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** `memory` with each entry of `entries` in `part`, and none `keep` does not hold. */
function withPart<K extends "rows" | "changes" | "members">(
  memory: MenuMemory,
  part: K,
  entries: Readonly<Record<string, MenuMemory[K][string]>>,
  keep?: ReadonlySet<string>,
): MenuMemory {
  const next: Record<string, MenuMemory[K][string]> = {};
  for (const [key, value] of Object.entries(memory[part])) {
    if (keep === undefined || keep.has(key)) next[key] = value as MenuMemory[K][string];
  }
  Object.assign(next, entries);
  return same(next, memory[part]) ? memory : ({ ...memory, [part]: next } as MenuMemory);
}

/** The Mates' rows as their activity reads now, and — given the listing — none for a Mate gone. */
export function withRows(
  memory: MenuMemory,
  rows: Readonly<Record<string, RememberedRow>>,
  listed?: ReadonlySet<string>,
): MenuMemory {
  return withPart(memory, "rows", rows, listed);
}

/** Each project's change rows as drawn once Gitea answered, and — given the listing — none for a project gone. */
export function withChanges(
  memory: MenuMemory,
  changes: Readonly<Record<string, ReadonlyArray<RememberedChange>>>,
  listed?: ReadonlySet<string>,
): MenuMemory {
  return withPart(memory, "changes", changes, listed);
}

/**
 * Each project's production chip as last drawn, `null` forgetting one that no
 * longer is, and — given the listing — none for a project gone.
 */
export function withChips(
  memory: MenuMemory,
  chips: Readonly<Record<string, RememberedChip | null>>,
  listed?: ReadonlySet<string>,
): MenuMemory {
  const next: Record<string, RememberedChip> = {};
  for (const [key, chip] of Object.entries(memory.chips)) {
    if ((listed === undefined || listed.has(key)) && chips[key] !== null) next[key] = chip;
  }
  for (const [key, chip] of Object.entries(chips)) if (chip !== null) next[key] = chip;
  return same(next, memory.chips) ? memory : { ...memory, chips: next };
}

/** A crew's faces as its line drew them, at rest: each crewmate, the lead first. */
export function rememberedCrewOf(
  faces: ReadonlyArray<{
    readonly handle: string;
    readonly displayName: string;
    readonly tint: MateTintId;
    readonly lead: boolean;
  }>,
): RememberedCrew {
  return {
    faces: faces.map(({ handle, displayName, tint, lead }) => ({
      handle,
      displayName,
      tint,
      lead,
    })),
  };
}

/**
 * Each Mate's crew as last read, `null` forgetting one that is gone, and —
 * given the listing — none for a Mate no longer listed.
 */
export function withCrews(
  memory: MenuMemory,
  crews: Readonly<Record<string, RememberedCrew | null>>,
  listed?: ReadonlySet<string>,
): MenuMemory {
  const next: Record<string, RememberedCrew> = {};
  for (const [key, crew] of Object.entries(memory.crews)) {
    if ((listed === undefined || listed.has(key)) && crews[key] !== null) next[key] = crew;
  }
  for (const [key, crew] of Object.entries(crews)) if (crew !== null) next[key] = crew;
  return same(next, memory.crews) ? memory : { ...memory, crews: next };
}

/** An organization's members as last read, what they carry beyond a member's record dropped. */
export function withMembers(
  memory: MenuMemory,
  clientId: string,
  members: ReadonlyArray<ZeropsOrganizationMember>,
): MenuMemory {
  return withPart(memory, "members", { [clientId]: members.flatMap(memberOf) });
}

const decodeMember = Schema.decodeUnknownOption(MemberSchema);

function memberOf(member: ZeropsOrganizationMember): ReadonlyArray<RememberedMember> {
  const decoded = decodeMember(member);
  return decoded._tag === "Some" ? [decoded.value] : [];
}

const readMemory = Schema.decodeUnknownSync(Schema.fromJsonString(MenuMemorySchema));
const writeMemory = Schema.encodeSync(Schema.fromJsonString(MenuMemorySchema));

let held: { readonly account: string; memory: MenuMemory } | null = null;
let writing: ReturnType<typeof setTimeout> | null = null;

function readStored(): MenuMemory {
  try {
    const stored = accountLocalStorage.getItem(MENU_MEMORY_STORAGE_KEY);
    if (stored === null) return EMPTY_MENU_MEMORY;
    return readMemory(stored);
  } catch {
    // Unreadable, or from a shape before this one: nothing remembered.
    return EMPTY_MENU_MEMORY;
  }
}

/** What this browser remembers for the account signed in now. */
export function menuMemory(): MenuMemory {
  const account = typeof window === "undefined" ? null : currentAccountId();
  if (account === null) return EMPTY_MENU_MEMORY;
  if (held?.account !== account) held = { account, memory: readStored() };
  return held.memory;
}

const activities = new WeakMap<RememberedRow, ZeropsAgentActivity>();
const pulls = new WeakMap<ReadonlyArray<RememberedChange>, ReadonlyArray<FlowPullRequest>>();

/** The row this browser remembers for a Mate, as an activity to draw — the same object each draw. */
export function rememberedActivity(projectId: string): ZeropsAgentActivity | undefined {
  const row = menuMemory().rows[projectId];
  if (row === undefined) return undefined;
  let activity = activities.get(row);
  if (activity === undefined) {
    activity = activityFromMemory(row);
    activities.set(row, activity);
  }
  return activity;
}

/** The change rows this browser remembers drawing for a project. */
export function rememberedChanges(groupId: string): ReadonlyArray<FlowPullRequest> | undefined {
  const changes = menuMemory().changes[groupId];
  if (changes === undefined) return undefined;
  let drawn = pulls.get(changes);
  if (drawn === undefined) {
    drawn = changes.map(changeFromMemory);
    pulls.set(changes, drawn);
  }
  return drawn;
}

/** Remembers what `update` makes of the memory, written once the menu settles a moment. */
export function rememberMenu(update: (memory: MenuMemory) => MenuMemory): void {
  const before = menuMemory();
  if (held === null) return;
  const next = update(before);
  if (next === before) return;
  held.memory = next;
  if (writing !== null) clearTimeout(writing);
  writing = setTimeout(() => {
    writing = null;
    try {
      if (held !== null) {
        accountLocalStorage.setItem(MENU_MEMORY_STORAGE_KEY, writeMemory(held.memory));
      }
    } catch {
      // A full or blocked storage keeps nothing: the next reload grows as before.
    }
  }, 400);
}

// A closed account's memory is gone with it: it quotes its conversations.
onAccountLifetimeClose(() => {
  if (writing !== null) clearTimeout(writing);
  writing = null;
  held = null;
  try {
    accountLocalStorage.removeItem(MENU_MEMORY_STORAGE_KEY);
  } catch {
    // Storage refused: nothing more can be done from here.
  }
});
