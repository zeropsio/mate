/**
 * The conversation as the person reads it — the structure the timeline draws,
 * derived purely from the thread's entries.
 *
 * A turn is the person's messages, one work line after each of them, the
 * answer and the outcome. The person's messages never move or merge: every
 * message the person sent into a turn starts a new *stretch* of work, and each
 * stretch keeps one line. Only the last stretch of the running turn is live;
 * everything above the person's last message is frozen (the no-shift contract:
 * the timeline only grows at the bottom, rows keep their height, nothing seen
 * is merged away).
 *
 * Pure: no React, no clock except the `nowMs` a caller passes.
 */
import type { TurnId } from "@t3tools/contracts";
import { isReadOperationKind, type ZeropsOperation } from "@t3tools/client-runtime/zerops/model";

import { workLogEntryIsToolLike, type TimelineEntry, type WorkLogEntry } from "../../session-logic";
import type { ChatMessage, TurnDiffSummary } from "../../types";
import {
  IMAGE_ONLY_BOOTSTRAP_PROMPT,
  isSlashCommand,
  isUsageLimitResumePrompt,
} from "@t3tools/shared/userAsk";

export type MessageEntry = Extract<TimelineEntry, { kind: "message" }>;
export type WorkEntry = Extract<TimelineEntry, { kind: "work" }>;
export type OperationEntry = Extract<TimelineEntry, { kind: "operation" }>;
type ChangeLandedEntry = Extract<TimelineEntry, { kind: "change-landed" }>;

export interface TimelineLatestTurnLike {
  readonly turnId: TurnId;
  readonly state: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/**
 * One duration format for the whole conversation: "42s", "1m 12s", "13m",
 * "2h 6m". Seconds only under ten minutes, no decimals, never under a second.
 * Floors, so a settled duration reads what the live counter last read.
 */
export function formatWorkDuration(ms: number): string {
  const totalSeconds = Number.isFinite(ms) ? Math.max(1, Math.floor(ms / 1000)) : 1;
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 10) {
    const seconds = totalSeconds % 60;
    return seconds === 0 ? `${totalMinutes}m` : `${totalMinutes}m ${seconds}s`;
  }
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) {
    const minutes = totalMinutes % 60;
    return minutes === 0 ? `${totalHours}h` : `${totalHours}h ${minutes}m`;
  }
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return hours === 0 ? `${days}d` : `${days}d ${hours}h`;
}

function parseMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function laterIso(a: string | null, b: string | null): string | null {
  const aMs = parseMs(a);
  const bMs = parseMs(b);
  if (aMs === null) return b;
  if (bMs === null) return a;
  return bMs > aMs ? b : a;
}

// ---------------------------------------------------------------------------
// What the person typed
// ---------------------------------------------------------------------------

export interface SlashCommand {
  readonly name: string;
  readonly args: string;
}

/**
 * `/compact`, `/model opus` — a command to the harness, never the person's
 * words to the Mate. What counts as one is the shared rule every surface reads
 * (`@t3tools/shared/userAsk`); this only splits it into its name and words.
 */
export function readSlashCommand(text: string): SlashCommand | null {
  const trimmed = text.trim();
  if (!isSlashCommand(trimmed)) return null;
  const [head = "", ...rest] = trimmed.slice(1).split(/\s+/);
  return { name: head.toLowerCase(), args: rest.join(" ").trim() };
}

/** The server's own message resuming a thread after a usage limit reset — never the person's. */
export function isResumePrompt(text: string): boolean {
  return isUsageLimitResumePrompt(text);
}

/** The client's own placeholder for an image-only message: nothing the person wrote. */
export function isImageOnlyPlaceholder(text: string): boolean {
  return text.trim() === IMAGE_ONLY_BOOTSTRAP_PROMPT;
}

// ---------------------------------------------------------------------------
// Usage limits
// ---------------------------------------------------------------------------

export interface UsageLimitNotice {
  /** When the limit resets, when the notice says. */
  readonly resetsAt: string | null;
}

const CLI_LIMIT =
  /you[’']ve hit your [\w\s-]*?limit(?:\s*·\s*resets\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s*\(([^)]+)\))?)?/i;
const ADAPTER_LIMIT = /claude(?: ai)? usage limit reached/i;
const ADAPTER_WAIT = /resets in (?:(\d+)h)?\s*(?:(\d+)m)?/i;
const EPOCH_SUFFIX = /\|(\d{10})\b/;

/** The zone's offset from UTC at `atMs`, in minutes; null for a zone the runtime does not know. */
function zoneOffsetMinutes(timeZone: string, atMs: number): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    }).formatToParts(new Date(atMs));
    const read = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    const asUtc = Date.UTC(
      read("year"),
      read("month") - 1,
      read("day"),
      read("hour"),
      read("minute"),
    );
    return Math.round((asUtc - Math.floor(atMs / 60_000) * 60_000) / 60_000);
  } catch {
    return null;
  }
}

/**
 * A usage-limit notice, read from the text Claude writes when a limit stops it
 * ("You've hit your session limit · resets 9:20pm (UTC)") or the Mate server's
 * own row ("Claude usage limit reached. … resets in 32m."). The reset is the
 * first such wall-clock time after the notice was written.
 */
export function readUsageLimitNotice(text: string, createdAt: string): UsageLimitNotice | null {
  const writtenMs = parseMs(createdAt);
  const cli = CLI_LIMIT.exec(text);
  if (cli && text.trim().length < 240) {
    if (cli[1] === undefined || writtenMs === null) return { resetsAt: null };
    let hour = Number(cli[1]) % 12;
    if ((cli[3] ?? "").toLowerCase() === "pm") hour += 12;
    if (cli[3] === undefined) hour = Number(cli[1]);
    const minute = Number(cli[2] ?? "0");
    const zone = (cli[4] ?? "UTC").trim();
    const offset = zoneOffsetMinutes(zone === "UTC" ? "UTC" : zone, writtenMs);
    if (offset === null) return { resetsAt: null };
    const zoned = new Date(writtenMs + offset * 60_000);
    let candidate =
      Date.UTC(zoned.getUTCFullYear(), zoned.getUTCMonth(), zoned.getUTCDate(), hour, minute) -
      offset * 60_000;
    if (candidate <= writtenMs) candidate += 24 * 60 * 60_000;
    return { resetsAt: new Date(candidate).toISOString() };
  }
  if (ADAPTER_LIMIT.test(text)) {
    const epoch = EPOCH_SUFFIX.exec(text);
    if (epoch) return { resetsAt: new Date(Number(epoch[1]) * 1000).toISOString() };
    const wait = ADAPTER_WAIT.exec(text);
    if (wait && writtenMs !== null && (wait[1] !== undefined || wait[2] !== undefined)) {
      const waitMs = (Number(wait[1] ?? 0) * 60 + Number(wait[2] ?? 0)) * 60_000;
      return { resetsAt: new Date(writtenMs + waitMs).toISOString() };
    }
    return { resetsAt: null };
  }
  return null;
}

/** The server's own row for a limit ("Claude usage limit reached. Send the message again…"). */
export function isUsageLimitError(entry: TimelineEntry): boolean {
  return (
    entry.kind === "work" &&
    entry.entry.tone === "error" &&
    readUsageLimitNotice(`${entry.entry.label} ${entry.entry.detail ?? ""}`, entry.createdAt) !==
      null
  );
}

function usageLimitErrorNotice(entries: ReadonlyArray<TimelineEntry>): UsageLimitNotice | null {
  for (const entry of entries.toReversed()) {
    if (!isUsageLimitError(entry) || entry.kind !== "work") continue;
    return readUsageLimitNotice(
      `${entry.entry.detail ?? ""} ${entry.entry.label}`,
      entry.createdAt,
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Turns
// ---------------------------------------------------------------------------

export function timelineEntryTurnId(entry: TimelineEntry): TurnId | null {
  if (entry.kind === "message") {
    return entry.message.role === "assistant" || entry.message.role === "reasoning"
      ? (entry.message.turnId ?? null)
      : null;
  }
  if (entry.kind === "turn-plan") return entry.turnPlan.turnId;
  if (entry.kind === "proposed-plan") return entry.proposedPlan.turnId;
  if (entry.kind === "operation") {
    // `ZeropsOperation.turnId` is a plain string — the reducer's package is
    // platform-free (R1) and never imports the branded `TurnId` type.
    return entry.operation.turnId as TurnId | null;
  }
  return entry.kind === "work" || entry.kind === "generic-call"
    ? (entry.entry.turnId ?? null)
    : null;
}

/** A message the person wrote — narrowing only that, so an assistant message stays a message. */
export type UserMessageEntry = MessageEntry & {
  readonly message: ChatMessage & { readonly role: "user" };
};

export function isUserMessageEntry(entry: TimelineEntry): entry is UserMessageEntry {
  return entry.kind === "message" && entry.message.role === "user";
}

/** A command to the harness the person typed — `/compact` — drawn as an event, never their words. */
export function isCommandMessage(entry: MessageEntry): boolean {
  return (
    readSlashCommand(entry.message.text) !== null && (entry.message.attachments?.length ?? 0) === 0
  );
}

/** The last assistant message of each response: a turn's answer candidate. */
export function deriveTerminalAssistantMessageIds(
  timelineEntries: ReadonlyArray<TimelineEntry>,
): ReadonlySet<string> {
  const lastByResponse = new Map<string, string>();
  let unkeyedIndex = 0;
  for (const entry of timelineEntries) {
    if (entry.kind !== "message") continue;
    const { message } = entry;
    if (message.role === "user") {
      unkeyedIndex += 1;
      continue;
    }
    if (message.role !== "assistant") continue;
    lastByResponse.set(
      message.turnId ? `turn:${message.turnId}` : `unkeyed:${unkeyedIndex}`,
      message.id,
    );
  }
  return new Set(lastByResponse.values());
}

/**
 * The session's running turn is authoritative when latestTurn briefly lags or
 * regresses behind it. Otherwise the latest turn counts as unsettled while it
 * runs (or has not recorded a completion) — keyed on the turn's lifecycle, not
 * the transient working state, so nothing flickers between a send and the
 * server creating the turn.
 */
export function deriveUnsettledTurnId(
  latestTurn: TimelineLatestTurnLike | null,
  runningTurnId: TurnId | null,
): TurnId | null {
  if (runningTurnId !== null) return runningTurnId;
  if (!latestTurn) return null;
  const settled = latestTurn.completedAt !== null && latestTurn.state !== "running";
  return settled ? null : latestTurn.turnId;
}

/**
 * One provider turn: the message that opened it (if any), where it starts in
 * the timeline, and the entries it owns. A turn exists from the moment a
 * message is sent (before the server has named it) until forever.
 */
export interface TurnSpan {
  readonly key: string;
  /** Null only between a send and the server creating the turn. */
  readonly turnId: TurnId | null;
  readonly opener: MessageEntry | null;
  readonly openerIndex: number | null;
  /** Timeline indexes of the turn's own entries, in order. */
  readonly entryIndexes: ReadonlyArray<number>;
  readonly terminalEntry: MessageEntry | null;
}

export function deriveTurnSpans(input: {
  readonly timelineEntries: ReadonlyArray<TimelineEntry>;
  readonly terminalAssistantMessageIds: ReadonlySet<string>;
  readonly unsettledTurnId: TurnId | null;
  readonly isWorking: boolean;
}): TurnSpan[] {
  type MutableSpan = {
    key: string;
    turnId: TurnId | null;
    opener: MessageEntry | null;
    openerIndex: number | null;
    entryIndexes: number[];
    terminalEntry: MessageEntry | null;
  };
  const byTurnId = new Map<TurnId, MutableSpan>();
  const spans: MutableSpan[] = [];
  // Messages no turn has claimed yet. The next new turn is opened by the
  // first of them; the later ones were sent into it before it produced
  // anything. An entry of an existing turn arriving after them makes them
  // messages sent into that turn. Nothing reads which turn is the latest, so
  // a turn keeps its opener once another starts.
  let unclaimed: Array<{ entry: MessageEntry; index: number }> = [];
  // A command the harness ran without a turn of its own (a `/compact`) still
  // waits here when the person writes next: that message opens the next
  // turn, never the command — the command stands alone before it.
  const openerOf = (waiting: typeof unclaimed) =>
    waiting.find(({ entry }) => !isCommandMessage(entry)) ?? waiting[0] ?? null;
  const open = (turnId: TurnId | null, opener: { entry: MessageEntry; index: number } | null) => {
    const span: MutableSpan = {
      key: opener ? `msg:${opener.entry.message.id}` : `turn:${turnId}`,
      turnId,
      opener: opener?.entry ?? null,
      openerIndex: opener?.index ?? null,
      entryIndexes: [],
      terminalEntry: null,
    };
    spans.push(span);
    if (turnId !== null) byTurnId.set(turnId, span);
    return span;
  };
  for (const [index, entry] of input.timelineEntries.entries()) {
    if (isUserMessageEntry(entry)) {
      unclaimed.push({ entry, index });
      continue;
    }
    const turnId = timelineEntryTurnId(entry);
    if (turnId === null) continue;
    let span = byTurnId.get(turnId);
    if (span) {
      unclaimed = [];
    } else {
      span = open(turnId, openerOf(unclaimed));
      unclaimed = [];
    }
    span.entryIndexes.push(index);
    if (entry.kind === "message" && input.terminalAssistantMessageIds.has(entry.message.id)) {
      span.terminalEntry = entry;
    }
  }
  if (input.unsettledTurnId !== null) {
    if (!byTurnId.has(input.unsettledTurnId)) open(input.unsettledTurnId, openerOf(unclaimed));
  } else if (input.isWorking && unclaimed.length > 0) {
    open(null, openerOf(unclaimed));
  }
  const startOf = (span: MutableSpan) => span.openerIndex ?? span.entryIndexes[0] ?? Infinity;
  return spans.toSorted((left, right) => startOf(left) - startOf(right));
}

// ---------------------------------------------------------------------------
// Stretches
// ---------------------------------------------------------------------------

/**
 * The work between two of the person's messages inside one turn: the message
 * that started it (the turn's opener or a message sent into the running turn)
 * and the entries that came after it, until the person's next message.
 */
export interface Stretch {
  /** Stable for the stretch's life: its message, else its turn. */
  readonly key: string;
  readonly turnKey: string;
  readonly turnId: TurnId | null;
  readonly lead: MessageEntry | null;
  readonly leadIndex: number | null;
  /** A message the person sent into a running turn, not the one that opened it. */
  readonly aside: boolean;
  /** The stretch's own entries (never the person's messages), in timeline order. */
  readonly entries: ReadonlyArray<TimelineEntry>;
  readonly entryIndexes: ReadonlyArray<number>;
  /** The stretch's first timeline index — where the conversation draws it. */
  readonly anchorIndex: number;
  readonly startedAt: string;
  /** Null while live. */
  readonly endedAt: string | null;
  readonly live: boolean;
  /** The turn's last stretch: its answer and outcome follow it. */
  readonly last: boolean;
}

export interface ConversationTurn {
  readonly key: string;
  readonly turnId: TurnId | null;
  readonly span: TurnSpan;
  readonly stretches: ReadonlyArray<Stretch>;
  /** The Mate's answer: the turn's last message, once the turn has settled. */
  readonly answer: MessageEntry | null;
  readonly live: boolean;
  readonly interrupted: boolean;
  /** The usage-limit notice the turn ended on, when it did. */
  readonly limit: UsageLimitNotice | null;
  /** Nothing but a usage-limit notice: a turn a limit refused before it did anything. */
  readonly limitOnly: boolean;
  /** The turn's window on the clock, for placing landings. */
  readonly startMs: number | null;
  readonly endMs: number;
}

export interface ConversationStructure {
  readonly turns: ReadonlyArray<ConversationTurn>;
  /** Timeline indexes no turn owns (a loose message, a landing between turns). */
  readonly looseIndexes: ReadonlySet<number>;
  /** Which stretch owns each timeline index — the person's messages included. */
  readonly stretchByIndex: ReadonlyMap<number, Stretch>;
  readonly unsettledTurnId: TurnId | null;
}

/** When a turn's entry ended: a message at its last update, work at its latest activity, an operation once settled. */
export function timelineEntryEnd(entry: TimelineEntry): string {
  switch (entry.kind) {
    case "message":
      return entry.message.updatedAt;
    case "work":
      return entry.entry.updatedAt ?? entry.createdAt;
    case "operation":
      return entry.operation.settledAt ?? entry.createdAt;
    default:
      return entry.createdAt;
  }
}

/**
 * Whether a settled turn ended on a step rather than a word: the person
 * stopped it, or it was cut off, mid-work. The server says so only of the
 * latest turn; read from how the turn ended, every turn says it the same way
 * once another follows. An error, or the Mate's own last word, ends a turn.
 * A background task reporting in, or a landing, is not the Mate's step.
 */
function endedOnAStep(entries: ReadonlyArray<TimelineEntry>): boolean {
  const last = entries.findLast(
    (entry) =>
      entry.kind !== "turn-plan" &&
      entry.kind !== "change-landed" &&
      !(entry.kind === "message" && entry.message.text.trim().length === 0) &&
      !(
        (entry.kind === "work" || entry.kind === "generic-call") &&
        entry.entry.sourceActivityKind?.startsWith("task.") === true
      ),
  );
  if (last === undefined) return false;
  if (last.kind === "message") return last.message.role === "reasoning";
  return !(last.kind === "work" && last.entry.tone === "error");
}

function hasMeaningfulContent(entry: TimelineEntry): boolean {
  if (entry.kind === "message") {
    return entry.message.role === "assistant" && entry.message.text.trim().length > 0;
  }
  return entry.kind !== "turn-plan";
}

/**
 * The running turn the session has not named yet: while the thread works, a
 * turn whose entries came after the latest one finished. A finished
 * background task wakes the Mate that way — its first words carry the new
 * turn's id before the session says which turn runs, and they are notes on
 * the way, never already its answer.
 */
function unnamedRunningTurnId(
  entries: ReadonlyArray<TimelineEntry>,
  latestTurn: TimelineLatestTurnLike | null,
): TurnId | null {
  const finishedMs = parseMs(latestTurn?.completedAt);
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    // The person wrote since: the work is for their message's turn.
    if (isUserMessageEntry(entry)) return null;
    const turnId = timelineEntryTurnId(entry);
    if (turnId === null) continue;
    if (turnId === latestTurn?.turnId) return null;
    const atMs = parseMs(entry.createdAt);
    return finishedMs === null || (atMs !== null && atMs >= finishedMs) ? turnId : null;
  }
  return null;
}

export function deriveConversationStructure(input: {
  readonly timelineEntries: ReadonlyArray<TimelineEntry>;
  readonly latestTurn: TimelineLatestTurnLike | null;
  readonly runningTurnId: TurnId | null;
  readonly isWorking: boolean;
  readonly activeTurnStartedAt: string | null;
}): ConversationStructure {
  const entries = input.timelineEntries;
  const unsettledTurnId =
    deriveUnsettledTurnId(input.latestTurn, input.runningTurnId) ??
    (input.isWorking ? unnamedRunningTurnId(entries, input.latestTurn) : null);
  const terminalIds = deriveTerminalAssistantMessageIds(entries);
  const spans = deriveTurnSpans({
    timelineEntries: entries,
    terminalAssistantMessageIds: terminalIds,
    unsettledTurnId,
    isWorking: input.isWorking,
  });

  const liveSpan = input.isWorking
    ? (spans.find((span) => span.turnId === unsettledTurnId) ??
      spans.find((span) => span.turnId === null))
    : undefined;
  const openerIndexes = new Set(
    spans.flatMap((span) => (span.openerIndex === null ? [] : [span.openerIndex])),
  );

  // Each turn's range on the timeline: from its opener (or first entry) to its
  // last entry — to the end while it is live. The person's messages inside a
  // range were sent into that turn.
  const ranges = spans.map((span) => ({
    span,
    start: span.openerIndex ?? span.entryIndexes[0] ?? entries.length,
    end: span === liveSpan ? Infinity : (span.entryIndexes.at(-1) ?? span.openerIndex ?? -1),
  }));
  const ownerOf = (index: number) => {
    let owner: (typeof ranges)[number] | undefined;
    for (const range of ranges) {
      if (range.start <= index && index <= range.end) {
        if (owner === undefined || range.start >= owner.start) owner = range;
      }
    }
    return owner?.span;
  };

  const membersBySpan = new Map<TurnSpan, number[]>();
  const looseIndexes = new Set<number>();
  const spanByTurnId = new Map(
    spans.flatMap((span) => (span.turnId ? [[span.turnId, span] as const] : [])),
  );
  for (const [index, entry] of entries.entries()) {
    let span: TurnSpan | undefined;
    if (isUserMessageEntry(entry)) {
      span = openerIndexes.has(index)
        ? spans.find((candidate) => candidate.openerIndex === index)
        : ownerOf(index);
    } else {
      const turnId = timelineEntryTurnId(entry);
      span = turnId === null ? ownerOf(index) : spanByTurnId.get(turnId);
    }
    if (span === undefined) {
      looseIndexes.add(index);
      continue;
    }
    const members = membersBySpan.get(span);
    if (members) members.push(index);
    else membersBySpan.set(span, [index]);
  }

  const stretchByIndex = new Map<number, Stretch>();
  const turns: ConversationTurn[] = [];
  for (const span of spans) {
    const members = membersBySpan.get(span) ?? [];
    const live = span === liveSpan;
    const turnEntries = members
      .map((index) => entries[index]!)
      .filter((entry) => !isUserMessageEntry(entry));
    const firstMember = members[0];
    const isLatestTurn = span.turnId !== null && input.latestTurn?.turnId === span.turnId;
    const interrupted =
      !live &&
      ((isLatestTurn && input.latestTurn?.state === "interrupted") || endedOnAStep(turnEntries));

    // The answer is the turn's last message once it settles. While the turn
    // runs, its last message is the answer already when it reads as one and
    // nothing came after it: it streams where it will stand, never first in
    // the Mate's panel (the owner, 2026-09-26 — "the last message … first
    // starts rendering in the working panel, then it all turns into the
    // result"). Work after it makes it a note on the way after all.
    const lastSaid = turnEntries.findLast(hasMeaningfulContent);
    const answer = !live
      ? span.terminalEntry
      : span.terminalEntry !== null &&
          span.terminalEntry === lastSaid &&
          readsAsAnswer(span.terminalEntry.message.text)
        ? span.terminalEntry
        : null;
    // The limit speaks as Claude's own last words, or as the server's error row.
    const limit =
      (answer !== null
        ? readUsageLimitNotice(answer.message.text, answer.message.createdAt)
        : null) ?? (live ? null : usageLimitErrorNotice(turnEntries));
    const limitOnly =
      limit !== null &&
      turnEntries.every(
        (entry) =>
          entry === answer ||
          !hasMeaningfulContent(entry) ||
          isUsageLimitError(entry) ||
          (entry.kind === "message" && entry.message.role === "reasoning") ||
          (entry.kind === "message" &&
            readUsageLimitNotice(entry.message.text, entry.createdAt) !== null),
      );

    const turnStart =
      span.opener?.createdAt ??
      turnEntries[0]?.createdAt ??
      (live ? input.activeTurnStartedAt : null);
    const turnEnd = live
      ? null
      : ((isLatestTurn && input.latestTurn?.completedAt
          ? laterIso(
              input.latestTurn.completedAt,
              turnEntries.length ? timelineEntryEnd(turnEntries.at(-1)!) : null,
            )
          : null) ??
        turnEntries.reduce<string | null>(
          (end, entry) => laterIso(end, timelineEntryEnd(entry)),
          null,
        ) ??
        turnStart);

    // Split at the person's messages.
    type Draft = { lead: MessageEntry | null; leadIndex: number | null; indexes: number[] };
    const drafts: Draft[] = [];
    for (const index of members) {
      const entry = entries[index]!;
      if (isUserMessageEntry(entry)) {
        drafts.push({ lead: entry, leadIndex: index, indexes: [] });
      } else if (drafts.length === 0) {
        drafts.push({ lead: null, leadIndex: null, indexes: [index] });
      } else {
        drafts.at(-1)!.indexes.push(index);
      }
    }
    if (drafts.length === 0) {
      // A live turn the server has named but that has produced nothing yet.
      drafts.push({ lead: span.opener, leadIndex: span.openerIndex, indexes: [] });
    }

    const stretches: Stretch[] = drafts.map((draft, position) => {
      const next = drafts[position + 1];
      const stretchEntries = draft.indexes.map((index) => entries[index]!);
      const last = position === drafts.length - 1;
      const startedAt =
        draft.lead?.createdAt ??
        stretchEntries[0]?.createdAt ??
        turnStart ??
        input.activeTurnStartedAt ??
        "";
      const endedAt = last
        ? live
          ? null
          : (turnEnd ?? startedAt)
        : (next!.lead?.createdAt ??
          stretchEntries.reduce<string | null>(
            (end, entry) => laterIso(end, timelineEntryEnd(entry)),
            null,
          ) ??
          startedAt);
      return {
        key: draft.lead ? `msg:${draft.lead.message.id}` : `turn:${span.turnId ?? span.key}`,
        turnKey: span.key,
        turnId: span.turnId,
        lead: draft.lead,
        leadIndex: draft.leadIndex,
        aside: draft.lead !== null && draft.lead !== span.opener,
        entries: stretchEntries,
        entryIndexes: draft.indexes,
        anchorIndex: draft.leadIndex ?? draft.indexes[0] ?? firstMember ?? entries.length,
        startedAt,
        endedAt,
        live: live && last,
        last,
      };
    });
    for (const stretch of stretches) {
      if (stretch.leadIndex !== null) stretchByIndex.set(stretch.leadIndex, stretch);
      for (const index of stretch.entryIndexes) stretchByIndex.set(index, stretch);
    }

    turns.push({
      key: span.key,
      turnId: span.turnId,
      span,
      stretches,
      answer,
      live,
      interrupted,
      limit,
      limitOnly,
      startMs: parseMs(turnStart),
      endMs: live ? Infinity : (parseMs(turnEnd) ?? parseMs(turnStart) ?? -Infinity),
    });
  }

  return { turns, looseIndexes, stretchByIndex, unsettledTurnId };
}

// ---------------------------------------------------------------------------
// What a stretch says
// ---------------------------------------------------------------------------

/**
 * Whether the Mate's words read as its answer rather than a note on the way.
 * A note is a sentence or three; an answer breaks into paragraphs, lists,
 * headings or tables early — and words that run this long are one too.
 */
export function readsAsAnswer(text: string): boolean {
  const said = text.trim();
  return (
    /\n\s*\n/.test(said) || /^\s*(?:[-*+]\s|\d+[.)]\s|#{1,6}\s|\|)/m.test(said) || said.length > 480
  );
}

/** A message on the way to the answer — every assistant message but the turn's answer. */
export function stretchNotes(stretch: Stretch, answer: MessageEntry | null): MessageEntry[] {
  return stretch.entries.filter(
    (entry): entry is MessageEntry =>
      entry.kind === "message" &&
      entry.message.role === "assistant" &&
      entry !== answer &&
      entry.message.text.trim().length > 0,
  );
}

/** The first line of a note, markdown stripped to what reads in one line. */
export function noteLine(text: string): string {
  const firstBlock =
    text
      .split(/\n\s*\n/)
      .map((block) => block.trim())
      .find((block) => block.length > 0) ?? "";
  return firstBlock
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, "$1")
    .replace(/^>\s?(?:\[![a-z]+\]\s*)?/gim, "")
    .replace(/\s+/g, " ")
    .trim();
}

type ActivityAction = "edit" | "command" | "read" | "code-search" | "search" | "other";

const ACTIVITY_ORDER: ReadonlyArray<ActivityAction> = [
  "edit",
  "command",
  "read",
  "code-search",
  "search",
  "other",
];

/** A call a runtime names only in its detail, by what it did. */
const NAMED_CALL_ACTION: Readonly<Record<string, ActivityAction>> = {
  Read: "read",
  Edit: "edit",
  MultiEdit: "edit",
  Write: "edit",
  NotebookEdit: "edit",
  Bash: "command",
  Grep: "code-search",
  Glob: "code-search",
  WebSearch: "search",
};

function activityAction(entry: WorkLogEntry): ActivityAction {
  const named = namedToolCall(entry);
  if (named !== null) return NAMED_CALL_ACTION[named] ?? "other";
  if (
    entry.requestKind === "file-read" ||
    entry.itemType === "image_view" ||
    (entry.itemType === "dynamic_tool_call" && entry.toolTitle === "Read File")
  ) {
    return "read";
  }
  if (
    entry.requestKind === "file-change" ||
    entry.itemType === "file_change" ||
    (entry.changedFiles?.length ?? 0) > 0
  ) {
    return "edit";
  }
  if (entry.requestKind === "command" || entry.itemType === "command_execution" || entry.command) {
    return "command";
  }
  if (entry.itemType === "web_search") {
    return /\bgrep\b/i.test(entry.toolTitle ?? entry.label) ? "code-search" : "search";
  }
  return "other";
}

function times(count: number, one: string, many: string): string {
  return count === 1 ? one : many.replace("#", String(count));
}

/**
 * What a run of tool calls did, in one fixed order so the clauses never
 * reorder between two lines: "Edited 2 files · ran 3 commands · read 4 files".
 */
export function summarizeActivity(entries: ReadonlyArray<WorkLogEntry>): string {
  const byAction = new Map<ActivityAction, WorkLogEntry[]>();
  for (const entry of entries) {
    const action = activityAction(entry);
    const list = byAction.get(action);
    if (list) list.push(entry);
    else byAction.set(action, [entry]);
  }
  const clauses = ACTIVITY_ORDER.flatMap((action) => {
    const list = byAction.get(action);
    if (!list) return [];
    if (action === "edit") {
      const files = new Set<string>();
      let unnamed = 0;
      for (const entry of list) {
        if (!entry.changedFiles?.length) unnamed += 1;
        else for (const file of entry.changedFiles) files.add(file);
      }
      const count = files.size + unnamed;
      return [times(count, "edited 1 file", "edited # files")];
    }
    const count = list.length;
    switch (action) {
      case "command":
        return [times(count, "ran 1 command", "ran # commands")];
      case "read":
        return [times(count, "read 1 file", "read # files")];
      case "code-search":
        return [times(count, "searched the code once", "searched the code # times")];
      case "search":
        return [times(count, "searched the web once", "searched the web # times")];
      case "other":
        return [otherToolsClause(list)];
    }
  });
  const sentence = clauses.join(" · ");
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

/** Zerops tools with no card of their own, said by what they did. */
const ZEROPS_TOOL_WORDS: Readonly<Record<string, string>> = {
  zerops_workflow: "checked the workflow",
  zerops_knowledge: "read the Zerops guides",
};

/** A tool call's own name: in its detail for the runtime's calls, its title for a connected tool's. */
function calledToolName(entry: WorkLogEntry): string | null {
  const named = namedToolCall(entry);
  if (named !== null) return named;
  return entry.itemType === "mcp_tool_call" ? (entry.toolTitle ?? null) : null;
}

/**
 * Tools no action names. A Zerops tool is said by what it did, once however
 * often it ran; the rest by name where each call names its tool and at most
 * two tools ran — "used Workflow", "used Workflow twice", "used Workflow and
 * SendMessage" — and counted otherwise.
 */
function otherToolsClause(entries: ReadonlyArray<WorkLogEntry>): string {
  const zerops = [...new Set(entries.flatMap((entry) => ZEROPS_TOOL_WORDS[entry.label] ?? []))];
  const rest = entries.filter((entry) => ZEROPS_TOOL_WORDS[entry.label] === undefined);
  return [...zerops, ...(rest.length === 0 ? [] : [namedToolsClause(rest)])].join(" · ");
}

function namedToolsClause(entries: ReadonlyArray<WorkLogEntry>): string {
  const names = entries.map(calledToolName);
  const distinct = [...new Set(names)];
  if (names.includes(null) || distinct.length > 2) {
    return times(entries.length, "used 1 tool", "used # tools");
  }
  if (distinct.length === 2) return `used ${distinct[0]} and ${distinct[1]}`;
  const name = distinct[0]!;
  return entries.length === 1
    ? `used ${name}`
    : entries.length === 2
      ? `used ${name} twice`
      : `used ${name} ${entries.length} times`;
}

/**
 * The tool a generic call ran, when its detail names it: a call the runtime
 * knows only as a "Tool call" carries its name and arguments as
 * "AskUserQuestion: {…}" — the name is for people, the arguments never are.
 */
export function namedToolCall(
  entry: Pick<WorkLogEntry, "itemType" | "label" | "detail">,
): string | null {
  if (
    entry.itemType !== "dynamic_tool_call" &&
    entry.itemType !== "collab_agent_tool_call" &&
    entry.label !== "Tool call"
  ) {
    return null;
  }
  const match = /^([A-Za-z][\w-]*):\s*[{[]/.exec(entry.detail ?? "");
  return match?.[1] ?? null;
}

/** The file a file tool call names in its arguments, by its name alone. */
function calledFileName(detail: string | undefined): string | null {
  const path = /"file_path"\s*:\s*"([^"]+)"/.exec(detail ?? "")?.[1];
  return path === undefined ? null : (path.split("/").findLast(Boolean) ?? null);
}

const FILE_TOOL_VERB: Readonly<Record<string, string>> = {
  Read: "Reading",
  Edit: "Editing",
  MultiEdit: "Editing",
  Write: "Writing",
  NotebookEdit: "Editing",
};

const TOOL_CALL_WORDS: Readonly<Record<string, string>> = {
  AskUserQuestion: "Waiting for your answer",
  Read: "Reading a file",
  Edit: "Editing a file",
  MultiEdit: "Editing a file",
  Write: "Writing a file",
  NotebookEdit: "Editing a notebook",
  Grep: "Searching the code",
  Glob: "Looking for files",
  Bash: "Running a command",
  WebFetch: "Reading a web page",
  WebSearch: "Searching the web",
  Task: "Starting a helper",
  Agent: "Starting a helper",
  Skill: "Using a skill",
  ToolSearch: "Looking up a tool",
  TodoWrite: "Updating its list",
  ExitPlanMode: "Finishing the plan",
};

/**
 * What a named tool call is doing, in words: "Reading package.json",
 * "Reading a web page", "Using some new tool" — a file by its name, never
 * the rest of the arguments.
 */
export function toolCallWords(name: string, detail?: string): string {
  const verb = FILE_TOOL_VERB[name];
  const file = verb === undefined ? null : calledFileName(detail);
  if (verb !== undefined && file !== null) return `${verb} ${file}`;
  const known = TOOL_CALL_WORDS[name];
  if (known !== undefined) return known;
  const words = name
    .replace(/^mcp__[^_]+__/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  return words.length > 0 ? `Using ${words}` : "Using a tool";
}

/** The question tool, however the runtime names its call. */
export function isQuestionToolCall(
  entry: Pick<WorkLogEntry, "itemType" | "label" | "detail" | "toolTitle">,
): boolean {
  return (
    /^AskUserQuestion\b/.test(entry.toolTitle ?? entry.label) ||
    namedToolCall(entry) === "AskUserQuestion"
  );
}

/** A work entry that is a tool call on the way — the log's activity lines. */
export function isActivityWork(entry: WorkLogEntry): boolean {
  return (
    entry.agentSpawn === undefined &&
    entry.questionAnswer === undefined &&
    entry.sourceActivityKind !== "context-compaction" &&
    entry.tone !== "error" &&
    workLogEntryIsToolLike(entry)
  );
}

export type WorkLineFace = "working" | "idle" | "produced" | "failed" | "paused" | "stopped";

/** A setback the turn did not come back from, on the operation's own target. */
export function unrecoveredFailures(
  operations: ReadonlyArray<ZeropsOperation>,
): ReadonlyArray<ZeropsOperation> {
  return operations.filter((operation, index) => {
    if (operation.phase !== "failed") return false;
    const target = operationTargetKey(operation);
    return !operations
      .slice(index + 1)
      .some(
        (later) =>
          later.phase === "done" &&
          operationTargetKey(later) === target &&
          (later.kind === operation.kind ||
            (operation.kind === "verify" && later.kind === "deploy") ||
            (operation.kind === "deploy" && later.kind === "verify")),
      );
  });
}

export function operationTargetKey(operation: ZeropsOperation): string {
  return operation.target?.hostname ?? operation.subject;
}

/** Operations whose done phase means the turn produced something the person can use. */
const PRODUCING_KINDS: ReadonlySet<ZeropsOperation["kind"]> = new Set([
  "deploy",
  "import",
  "bootstrap",
  "subdomain",
]);

/**
 * A deploy as the person reads it: one service's. A batch deploy is one call
 * the Mate made for several services, and each of them deploys, succeeds or
 * fails on its own — so it becomes one deploy per service, named by it,
 * observed by its hostname, in the state its own step reached.
 */
export function splitBatchDeploy(operation: ZeropsOperation): ZeropsOperation[] {
  if (operation.kind !== "deploy" || operation.batch !== true || operation.steps.length === 0) {
    return [operation];
  }
  // What the batch said as a whole is no single service's: its closing, its
  // version, its reason (a service's own failure keeps its own).
  const { batch: _batch, version: _version, closing: _closing, explanation, ...shared } = operation;
  return operation.steps.map((step) => {
    const phase: ZeropsOperation["phase"] =
      step.state === "done" || step.state === "failed"
        ? step.state
        : operation.phase === "running"
          ? "running"
          : operation.phase === "failed"
            ? "failed"
            : "done";
    const reason = step.note ?? explanation?.reason;
    return {
      ...shared,
      key: `${operation.key}:${step.label}`,
      subject: step.label,
      kicker: `Deploy · ${step.label}`,
      target: { hostname: step.label },
      phase,
      statusWord:
        phase === "done"
          ? "Deployed"
          : phase === "failed"
            ? "Failed"
            : step.state === "queued"
              ? "Waiting"
              : operation.statusWord,
      // Its own step alone: the bar reads its state, waiting or running.
      steps: [step],
      links: [],
      ...(phase === "failed" && reason !== undefined ? { explanation: { reason } } : {}),
    };
  });
}

export function stretchOperations(stretch: Stretch): ZeropsOperation[] {
  return stretch.entries.flatMap((entry) => (entry.kind === "operation" ? [entry.operation] : []));
}

/** The face a work line wears: the stretch's state in one glyph. */
export function stretchFace(input: {
  readonly stretch: Stretch;
  readonly turn: ConversationTurn;
  readonly pausedHere: boolean;
}): WorkLineFace {
  const { stretch, turn } = input;
  if (stretch.live) return "working";
  if (turn.interrupted && stretch.last) return "stopped";
  if (input.pausedHere) return "paused";
  const operations = stretchOperations(stretch);
  if (unrecoveredFailures(operations).length > 0) return "failed";
  // An error the Mate did not work past: nothing but thinking came after it.
  const lastWord = stretch.entries.findLast(
    (entry) =>
      entry !== turn.answer && !(entry.kind === "message" && entry.message.role === "reasoning"),
  );
  if (stretch.last && lastWord?.kind === "work" && lastWord.entry.tone === "error") {
    return "failed";
  }
  if (
    operations.some(
      (operation) => operation.phase === "done" && PRODUCING_KINDS.has(operation.kind),
    ) ||
    stretch.entries.some((entry) => entry.kind === "change-landed")
  ) {
    return "produced";
  }
  return "idle";
}

// ---------------------------------------------------------------------------
// Browser checks and incidents
// ---------------------------------------------------------------------------

function browserCheckUrl(operation: ZeropsOperation): URL | null {
  const subject = operation.subject.trim();
  return URL.canParse(subject)
    ? new URL(subject)
    : URL.canParse(`https://${subject}`) && /^[\w.-]+\.[a-z]{2,}(?:[/:]|$)/i.test(subject)
      ? new URL(`https://${subject}`)
      : null;
}

/**
 * The page a check looked at, as the person names it: the path, decoded,
 * never the query or the host — a service's front page is "/", the same way
 * its status page is "/status".
 */
export function browserCheckCaption(operation: ZeropsOperation): string {
  const url = browserCheckUrl(operation);
  if (url === null) return operation.subject.trim();
  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    path = url.pathname;
  }
  return path === "" ? "/" : path;
}

/** Which page a check looked at, for counting pages: its host and its path. */
function browserCheckPage(operation: ZeropsOperation): string {
  const url = browserCheckUrl(operation);
  return url === null
    ? browserCheckCaption(operation)
    : `${url.host}${browserCheckCaption(operation)}`;
}

/** A check that did not show what it looked for: failed, or finished with errors. */
export function browserCheckFailed(operation: ZeropsOperation): boolean {
  return (
    operation.phase === "failed" ||
    operation.browserSummary?.failedStep !== undefined ||
    (operation.browserSummary?.errorCount ?? 0) > 0
  );
}

/** Why a check failed, in words: the failed step, else the card's own closing. */
export function browserCheckFailure(operation: ZeropsOperation): string | null {
  if (!browserCheckFailed(operation)) return null;
  const step = operation.browserSummary?.failedStep;
  if (step) {
    const words = [step.label, step.note].filter(Boolean).join(": ");
    if (/timeout|timed out/i.test(words)) return "timed out, the page never loaded";
    return words.length > 0 ? words : "failed";
  }
  if ((operation.browserSummary?.errorCount ?? 0) > 0) {
    const count = operation.browserSummary!.errorCount;
    return count === 1 ? "1 error on the page" : `${count} errors on the page`;
  }
  const closing = operation.closing?.trim();
  if (closing && /timeout|timed out/i.test(closing)) return "timed out, the page never loaded";
  return closing && closing.length > 0 ? closing.replace(/\.$/, "") : "failed";
}

/**
 * The checks that failed and stayed failed: a failure a later check of the
 * same page passed is a retry — the Mate asked for a device the browser does
 * not know, or took the page before it was up — never the page's.
 */
export function unrecoveredCheckFailures(
  checks: ReadonlyArray<ZeropsOperation>,
): ReadonlyArray<ZeropsOperation> {
  return checks.filter(
    (check, index) =>
      browserCheckFailed(check) &&
      !checks
        .slice(index + 1)
        .some(
          (later) =>
            later.phase === "done" &&
            !browserCheckFailed(later) &&
            browserCheckPage(later) === browserCheckPage(check),
        ),
  );
}

export type BrowserTakeState = "running" | "passed" | "retried" | "failed";

/**
 * How a take ended, as its frame tells it — the same reading the heading and
 * the report count by: a failure a later take of the same page passed is a
 * retry, never the page's failure.
 */
export function browserTakeState(
  check: ZeropsOperation,
  checks: ReadonlyArray<ZeropsOperation>,
): BrowserTakeState {
  if (check.phase === "running") return "running";
  if (!browserCheckFailed(check)) return "passed";
  return unrecoveredCheckFailures(checks).includes(check) ? "failed" : "retried";
}

/** How many pages the checks looked at. */
function browserCheckViews(checks: ReadonlyArray<ZeropsOperation>): number {
  return new Set(checks.map(browserCheckPage)).size;
}

export interface BrowserStripModel {
  readonly key: string;
  readonly checks: ReadonlyArray<ZeropsOperation>;
  /** Distinct pages looked at. */
  readonly views: number;
  readonly failures: number;
  readonly live: boolean;
}

export function browserStrip(stretch: Stretch): BrowserStripModel | null {
  const checks = stretchOperations(stretch).filter((operation) => operation.kind === "browser");
  if (checks.length === 0) return null;
  return {
    key: `strip:${checks[0]!.key}`,
    checks,
    views: browserCheckViews(checks),
    failures: unrecoveredCheckFailures(checks).length,
    live: stretch.live,
  };
}

export type IncidentTone = "attention" | "ok" | "failed";

export interface IncidentModel {
  readonly key: string;
  readonly hostname: string;
  /** Every state the service went through, oldest first: its history stays at its start. */
  readonly phases: ReadonlyArray<string>;
  readonly tone: IncidentTone;
  /** When the incident began: its first failure. */
  readonly appearedAt: string;
}

function devServerRunning(operation: ZeropsOperation): boolean | null {
  if (operation.kind !== "devServer" || operation.phase === "running") return null;
  if (operation.phase === "failed") return false;
  if (operation.statusWord === "Not running") return false;
  if (operation.statusWord === "Running") return true;
  const step = operation.steps[0];
  if (step === undefined) return null;
  return step.state === "done";
}

function devServerAction(operation: ZeropsOperation): string {
  return (operation.steps[0]?.label ?? "").toLowerCase();
}

function devServerFailurePhrase(operation: ZeropsOperation): string {
  const note = operation.steps[0]?.note;
  if (note && /^HTTP \d{3}$/.test(note)) return `stopped answering (${note.slice(5)})`;
  if (note && note.length > 0)
    return `not running · ${note.charAt(0).toLowerCase()}${note.slice(1)}`;
  return "not running";
}

/**
 * A service that stopped answering and what happened to it, as one line per
 * service and stretch — "nextstoredev · stopped answering (502) · restarted ·
 * running again" — rewritten in place as it resolves, never a card per call.
 * It starts at the first failure; a routine start on its own is no incident.
 */
export function stretchIncidents(stretch: Stretch): IncidentModel[] {
  const byHost = new Map<
    string,
    { phases: string[]; tone: IncidentTone; appearedAt: string; key: string }
  >();
  for (const operation of stretchOperations(stretch)) {
    if (operation.kind !== "devServer") continue;
    const host = operationTargetKey(operation);
    const running = devServerRunning(operation);
    const incident = byHost.get(host);
    if (incident === undefined) {
      if (running !== false) continue;
      byHost.set(host, {
        key: `incident:${operation.key}`,
        phases: [devServerFailurePhrase(operation)],
        tone: "attention",
        appearedAt: operation.settledAt ?? operation.anchorAt,
      });
      continue;
    }
    if (operation.phase === "running") continue;
    const action = devServerAction(operation);
    if (running === true) {
      if (action === "restart") incident.phases.push("restarted");
      else if (action === "start") incident.phases.push("started");
      incident.phases.push("running again");
      incident.tone = "ok";
    } else if (running === false) {
      incident.phases.push(
        action === "health check" ? "still not answering" : `${action || "start"} failed`,
      );
      incident.tone = operation.phase === "failed" ? "failed" : "attention";
    }
  }
  return [...byHost.entries()].map(([hostname, incident]) => ({
    key: incident.key,
    hostname,
    phases: dedupeAdjacent(incident.phases),
    tone: incident.tone,
    appearedAt: incident.appearedAt,
  }));
}

function dedupeAdjacent(phases: ReadonlyArray<string>): string[] {
  return phases.filter((phase, index) => phase !== phases[index - 1]);
}

// ---------------------------------------------------------------------------
// The outcome
// ---------------------------------------------------------------------------

export interface OutcomeService {
  readonly hostname: string;
  readonly tone: "ok" | "failed" | "attention" | "busy";
  /** "Healthy", "Deployed", "Dev server on :8000". */
  readonly word: string;
  readonly version: string | null;
  readonly url: string | null;
  /** A setback on the way that it came back from, kept as history. */
  readonly recovered: string | null;
}

export interface OutcomeModel {
  readonly key: string;
  /** The turn it reports on. */
  readonly turnKey: string;
  readonly live: ReadonlyArray<OutcomeService>;
  readonly landed: ReadonlyArray<{
    readonly key: string;
    readonly line: string;
    readonly title: string;
  }>;
  readonly files: {
    readonly count: number;
    readonly additions: number;
    readonly deletions: number;
    readonly turnId: TurnId;
  } | null;
  readonly checks: {
    readonly count: number;
    readonly views: number;
    readonly failures: number;
    /** Every check, in order: the report shows each take in its device's shape. */
    readonly takes: ReadonlyArray<ZeropsOperation>;
  } | null;
  readonly created: ReadonlyArray<string>;
  readonly removed: ReadonlyArray<string>;
  readonly notDone: ReadonlyArray<string>;
}

function shortVersion(operation: ZeropsOperation): string | null {
  const name = operation.version?.name;
  if (!name) return null;
  return /^[0-9a-f]{12,40}$/i.test(name) ? name.slice(0, 7) : name;
}

function failureWords(operation: ZeropsOperation): string {
  const reason = operation.explanation?.reason ?? operation.closing ?? operation.statusWord;
  return reason.replace(/\.$/, "");
}

/**
 * What a settled turn produced, each fact once and in its own register: the
 * services it left live, the changes that landed and the files it changed,
 * the checks, what it created and removed, and what it could not do. Built
 * only from what the turn already carries — null when it produced nothing.
 */
export function deriveOutcome(input: {
  readonly turn: ConversationTurn;
  readonly landed: ReadonlyArray<ChangeLandedEntry>;
  readonly diff: TurnDiffSummary | null;
}): OutcomeModel | null {
  const { turn } = input;
  if (turn.live || turn.limitOnly) return null;
  const operations = turn.stretches.flatMap(stretchOperations).flatMap(splitBatchDeploy);
  const settled = operations.filter((operation) => operation.phase !== "running");

  const services = new Map<string, OutcomeService>();
  const failedFirst = new Map<string, ZeropsOperation>();
  for (const operation of settled) {
    if (
      operation.kind !== "deploy" &&
      operation.kind !== "verify" &&
      operation.kind !== "devServer"
    )
      continue;
    const host = operationTargetKey(operation);
    const known = services.get(host);
    if (operation.phase === "failed") {
      if (!failedFirst.has(host)) failedFirst.set(host, operation);
      services.set(host, {
        hostname: host,
        tone: "failed",
        word: operation.kind === "verify" ? "Checks failed" : operation.statusWord,
        version: known?.version ?? null,
        url: known?.url ?? null,
        recovered: null,
      });
      continue;
    }
    if (operation.phase !== "done") continue;
    const url = operation.links[0]?.url ?? known?.url ?? null;
    if (operation.kind === "devServer") {
      if (
        known?.tone === "ok" &&
        operation.statusWord === "Running" &&
        known.word !== "Dev server"
      ) {
        continue;
      }
      services.set(host, {
        hostname: host,
        tone: operation.statusWord === "Not running" ? "attention" : "ok",
        word:
          operation.statusWord === "Not running" ? "Dev server not running" : "Dev server running",
        version: known?.version ?? null,
        url,
        recovered: null,
      });
      continue;
    }
    services.set(host, {
      hostname: host,
      tone: "ok",
      word: operation.kind === "verify" ? "Healthy" : "Deployed",
      version: operation.kind === "deploy" ? shortVersion(operation) : (known?.version ?? null),
      url,
      recovered: null,
    });
  }
  for (const [host, failure] of failedFirst) {
    const service = services.get(host);
    if (service && service.tone === "ok") {
      services.set(host, {
        ...service,
        recovered: `First ${failure.kind === "verify" ? "check" : failure.kind === "deploy" ? "deploy" : "try"} failed: ${failureWords(failure)}. It came back after that.`,
      });
    }
  }

  const checks = settled.filter((operation) => operation.kind === "browser");
  const created = settled.flatMap((operation) =>
    operation.kind === "import" && operation.phase === "done" ? [operation.subject] : [],
  );
  const removed = settled.flatMap((operation) =>
    operation.kind === "delete" && operation.phase === "done" ? [operation.subject] : [],
  );
  const notDone = unrecoveredFailures(settled)
    .filter(
      (operation) =>
        operation.kind !== "deploy" &&
        operation.kind !== "verify" &&
        operation.kind !== "devServer" &&
        operation.kind !== "browser" &&
        !isReadOperationKind(operation.kind),
    )
    .map((operation) => `${operation.voice}: ${failureWords(operation)}`);

  const files =
    input.diff && input.diff.files.length > 0 && input.diff.turnId
      ? {
          count: input.diff.files.length,
          additions: input.diff.files.reduce((sum, file) => sum + (file.additions ?? 0), 0),
          deletions: input.diff.files.reduce((sum, file) => sum + (file.deletions ?? 0), 0),
          turnId: input.diff.turnId,
        }
      : null;

  const outcome: OutcomeModel = {
    key: `outcome:${turn.key}`,
    turnKey: turn.key,
    live: [...services.values()],
    landed: input.landed.map((entry) => ({
      key: entry.event.key,
      line: `${entry.event.repository} #${entry.event.number}`,
      title: entry.event.title,
    })),
    files,
    // The report is where a settled turn's checks are seen: every take, as
    // the thumbnail of the device it was taken on.
    checks:
      checks.length > 0
        ? {
            count: checks.length,
            views: browserCheckViews(checks),
            failures: unrecoveredCheckFailures(checks).length,
            takes: checks,
          }
        : null,
    created,
    removed,
    notDone,
  };
  const empty =
    outcome.live.length === 0 &&
    outcome.landed.length === 0 &&
    outcome.files === null &&
    outcome.checks === null &&
    outcome.created.length === 0 &&
    outcome.removed.length === 0 &&
    outcome.notDone.length === 0;
  return empty ? null : outcome;
}

// ---------------------------------------------------------------------------
// Receipts
// ---------------------------------------------------------------------------

/**
 * Whether the Mate has read a message: something of its turn came after it.
 * A message the provider has not reached yet is only sent.
 */
export function messageReceipt(
  message: ChatMessage,
  structure: ConversationStructure,
  index: number,
): "sent" | "seen" {
  const stretch = structure.stretchByIndex.get(index);
  if (stretch === undefined) return "sent";
  const turn = structure.turns.find((candidate) => candidate.key === stretch.turnKey);
  if (turn === undefined) return "sent";
  const sentMs = parseMs(message.createdAt) ?? -Infinity;
  const answered = turn.stretches.some((candidate) =>
    candidate.entries.some(
      (entry) => hasMeaningfulContent(entry) && (parseMs(entry.createdAt) ?? -Infinity) >= sentMs,
    ),
  );
  return answered || turn.answer !== null ? "seen" : "sent";
}
