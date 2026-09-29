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
  CREW_CARD_OPENER,
  IMAGE_ONLY_BOOTSTRAP_PROMPT,
  isCrewCard,
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

/** The task the server hands a crewmate, drawn as an event — never the person's bubble. */
export interface CrewCard {
  /** The card's first line. */
  readonly title: string;
  /** Its other lines. */
  readonly text: string;
}

/** A crew task card (`@t3tools/shared/userAsk`) split into its title and text, or null for anything else. */
export function readCrewCard(text: string): CrewCard | null {
  if (!isCrewCard(text)) return null;
  const [title = "", ...rest] = text.trimStart().slice(CREW_CARD_OPENER.length).trim().split("\n");
  return { title: title.trim(), text: rest.join("\n").trim() };
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
  /**
   * The words the Mate is writing while it runs that cannot be placed yet:
   * its last, nothing after them, not reading as its answer. A note if it
   * moves on, the answer if the run ends — drawn nowhere until then.
   */
  readonly writing: MessageEntry | null;
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
 * once another follows. An error, a plan the Mate proposed, or its own last
 * word ends a turn. A background task reporting in, a landing, the harness
 * condensing the context, or a row that only tells — a question waiting on
 * the person, a warning — is not the Mate's step.
 */
function endedOnAStep(entries: ReadonlyArray<TimelineEntry>): boolean {
  const last = entries.findLast(
    (entry) =>
      entry.kind !== "turn-plan" &&
      entry.kind !== "change-landed" &&
      !(entry.kind === "message" && entry.message.text.trim().length === 0) &&
      !(
        (entry.kind === "work" || entry.kind === "generic-call") &&
        (isTaskReport(entry) ||
          entry.entry.sourceActivityKind === "context-compaction" ||
          !workLogEntryIsToolLike(entry.entry))
      ),
  );
  if (last === undefined) return false;
  if (last.kind === "message") return last.message.role === "reasoning";
  if (last.kind === "proposed-plan") return false;
  return !(last.kind === "work" && last.entry.tone === "error");
}

/** A background task or a helper reporting in: the task's word, never the Mate's step. */
function isTaskReport(entry: TimelineEntry): boolean {
  return (
    (entry.kind === "work" || entry.kind === "generic-call") &&
    entry.entry.sourceActivityKind?.startsWith("task.") === true
  );
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

/**
 * Whether an entry is the Mate's last word so far, for holding its words: a
 * plan update, a task's report and a message of nothing are not — the words
 * before them are still its last.
 */
function countsAsLastWord(entry: TimelineEntry): boolean {
  return (
    entry.kind !== "turn-plan" &&
    !isTaskReport(entry) &&
    !(entry.kind === "message" && entry.message.text.trim().length === 0)
  );
}

/**
 * How long a running turn's last words wait, once finished, before they are
 * placed: the turn nearly always settles within it.
 */
export const LAST_WORDS_GRACE_MS = 1500;

/**
 * When a running turn's newest words finished, if they are the last thing
 * said and nothing followed them — the wait `LAST_WORDS_GRACE_MS` runs from
 * there, and the page derives again once it has run out.
 */
export function latestFinishedWordsAt(
  entries: ReadonlyArray<TimelineEntry>,
  isWorking: boolean,
): number | null {
  if (!isWorking) return null;
  const last = entries.findLast((entry) => !isUserMessageEntry(entry) && countsAsLastWord(entry));
  if (
    last === undefined ||
    last.kind !== "message" ||
    last.message.role !== "assistant" ||
    last.message.streaming === true
  )
    return null;
  return parseMs(last.message.updatedAt ?? last.createdAt);
}

export function deriveConversationStructure(input: {
  readonly timelineEntries: ReadonlyArray<TimelineEntry>;
  readonly latestTurn: TimelineLatestTurnLike | null;
  readonly runningTurnId: TurnId | null;
  readonly isWorking: boolean;
  readonly activeTurnStartedAt: string | null;
  /** The clock the last words' wait is read against; without it nothing waits. */
  readonly nowMs?: number;
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
  // A call can be seen before the session names its turn — its start arrives
  // turnless, and was drawn as background work finishing "in the background"
  // over the run it began (Nova, 2026-09-28). The same call, reported with
  // its turn, says whose it is.
  const turnIdByCall = new Map<string, TurnId>();
  for (const entry of entries) {
    if (
      (entry.kind === "work" || entry.kind === "generic-call") &&
      entry.entry.toolCallId !== undefined &&
      entry.entry.turnId
    ) {
      turnIdByCall.set(entry.entry.toolCallId, entry.entry.turnId);
    }
  }
  const turnIdOf = (entry: TimelineEntry): TurnId | null => {
    const own = timelineEntryTurnId(entry);
    if (own !== null || (entry.kind !== "work" && entry.kind !== "generic-call")) return own;
    const call = entry.entry.toolCallId;
    return call === undefined ? null : (turnIdByCall.get(call) ?? null);
  };
  for (const [index, entry] of entries.entries()) {
    let span: TurnSpan | undefined;
    if (isUserMessageEntry(entry)) {
      span = openerIndexes.has(index)
        ? spans.find((candidate) => candidate.openerIndex === index)
        : ownerOf(index);
    } else {
      const turnId = turnIdOf(entry);
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
    const lastSaid = turnEntries.findLast(
      (entry) => hasMeaningfulContent(entry) && !isTaskReport(entry),
    );
    const answer = !live
      ? span.terminalEntry
      : span.terminalEntry !== null &&
          span.terminalEntry === lastSaid &&
          readsAsAnswer(span.terminalEntry.message.text)
        ? span.terminalEntry
        : null;
    // Words still streaming that cannot be placed yet are drawn nowhere, so
    // none stream in one place and then move to another: streamed in the
    // panel first, every answer jumped under the card at its first paragraph
    // break. Anything after them — a step, a thought — makes them a note, and
    // so does their end: Codex says nothing of a command until it completes,
    // so words held until a step came after them hid the whole command long.
    const lastEntry = turnEntries.findLast(countsAsLastWord);
    // Words that have just finished wait a moment more: the turn nearly
    // always settles within it, and a short answer then goes straight under
    // the card instead of into the panel and out again.
    const terminal = span.terminalEntry;
    const justFinished =
      terminal !== null &&
      input.nowMs !== undefined &&
      input.nowMs -
        (parseMs(terminal.message.updatedAt ?? terminal.createdAt) ?? Number.NEGATIVE_INFINITY) <
        LAST_WORDS_GRACE_MS;
    const writing =
      live &&
      answer === null &&
      terminal !== null &&
      lastEntry === terminal &&
      (terminal.message.streaming === true || justFinished)
        ? terminal
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
    // Settled, a turn ends where the Mate's own entries did — whether it is
    // the latest or not, so its "worked for" never changes after the fact. A
    // helper or a background task it left working reports in on the turn,
    // but that is the task's time, not the Mate's.
    const turnEnd = live
      ? null
      : (turnEntries.reduce<string | null>(
          (end, entry) => (isTaskReport(entry) ? end : laterIso(end, timelineEntryEnd(entry))),
          null,
        ) ?? turnStart);

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
      writing,
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

/** What a run's calls did, by kind: the effort its worked line counts. */
export type ActivityKind =
  | Exclude<ActivityAction, "other">
  | "workflow"
  | "guides"
  | "tool"
  | "helpers";

/** One fixed order, so the effort's words never reorder. */
const ACTIVITY_ORDER: ReadonlyArray<ActivityKind> = [
  "edit",
  "command",
  "read",
  "code-search",
  "search",
  "workflow",
  "guides",
  "tool",
  "helpers",
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

/** Zerops tools with no card of their own, counted by what they did. */
const ZEROPS_TOOL_KIND: Readonly<Record<string, ActivityKind>> = {
  zerops_workflow: "workflow",
  zerops_knowledge: "guides",
};

/** What a run's calls came to, one kind: "2 commands" is `{ kind: "command", count: 2 }`. */
export interface OutcomeActivity {
  readonly kind: ActivityKind;
  readonly count: number;
}

/**
 * What a run's calls came to, counted by kind in one fixed order — the files
 * it edited once each, however often; a Zerops tool by what it did; the
 * helpers it started, a batch or a workflow by its helpers. The worked line
 * says it (`runEffortWords`), never a row of the result.
 */
export function activityCounts(
  calls: ReadonlyArray<WorkLogEntry>,
  launches: ReadonlyArray<WorkLogEntry> = [],
): OutcomeActivity[] {
  const counts = new Map<ActivityKind, number>();
  const edited = new Set<string>();
  let unnamedEdits = 0;
  for (const entry of calls) {
    const action = activityAction(entry);
    if (action === "edit") {
      if (!entry.changedFiles?.length) unnamedEdits += 1;
      else for (const file of entry.changedFiles) edited.add(file);
      continue;
    }
    const kind = action === "other" ? (ZEROPS_TOOL_KIND[entry.label] ?? "tool") : action;
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  if (edited.size + unnamedEdits > 0) counts.set("edit", edited.size + unnamedEdits);
  const helpers = launches.reduce(
    (sum, entry) => sum + Math.max(1, entry.agentSpawn?.agentTaskIds.length ?? 1),
    0,
  );
  if (helpers > 0) counts.set("helpers", helpers);
  return ACTIVITY_ORDER.flatMap((kind) => {
    const count = counts.get(kind);
    return count === undefined ? [] : [{ kind, count }];
  });
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

/** A work entry that is a tool call on the way — the log's steps. A task is none: it runs one. */
export function isActivityWork(entry: WorkLogEntry): boolean {
  return (
    entry.agentSpawn === undefined &&
    entry.sourceActivityKind?.startsWith("task.") !== true &&
    entry.questionAnswer === undefined &&
    entry.sourceActivityKind !== "context-compaction" &&
    entry.tone !== "error" &&
    workLogEntryIsToolLike(entry)
  );
}

export type WorkLineFace = "working" | "idle" | "produced" | "failed" | "paused" | "stopped";

/**
 * A platform operation as a step's words: running, its own voice ("Deploying
 * app"); settled, what it came to in a sentence — "Deployed app", "app is
 * healthy", "Workflow failed" — never its status word before its name
 * ("Failed Workflow", 2026-09-27).
 */
export function operationLineWords(operation: ZeropsOperation): string {
  const voice = operation.voice.replace(/\.$/, "");
  const { subject, statusWord } = operation;
  if (operation.kind === "error" || operation.phase === "running") return voice;
  const failed = operation.phase === "failed";
  switch (operation.kind) {
    case "verify":
      return failed ? `${subject}: ${statusWord.toLowerCase()}` : `${subject} is healthy`;
    case "deploy":
      return failed && !isGitPushOnly(operation)
        ? `Deploy to ${subject} failed`
        : `${statusWord} ${subject}`;
    case "subdomain":
      return failed
        ? `The subdomain of ${subject} failed`
        : `${statusWord} the subdomain of ${subject}`;
    case "logs":
      return `Read the ${subject} log`;
    case "events":
      return `Read the events of ${subject}`;
    case "discover":
      return `Looked at ${subject}`;
    case "devServer":
      // What it came to, as its pill says it: "Running app" read as work
      // still going on, under a finished bar.
      if (failed) return `Dev server on ${subject} failed`;
      return statusWord === "Running" || statusWord === "Not running"
        ? `Dev server ${statusWord.toLowerCase()} on ${subject}`
        : `Dev server on ${subject}`;
    default:
      return failed ? `${subject}: ${statusWord.toLowerCase()}` : `${statusWord} ${subject}`;
  }
}

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

/** The address a check looked at, when its subject is one. */
export function browserCheckUrl(operation: ZeropsOperation): URL | null {
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
export function browserCheckPage(operation: ZeropsOperation): string {
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
    // The step as a thing the check could not do. The tool's bare class of
    // error ("Other") tells a person nothing.
    const note = step.note?.trim() && !/^other$/i.test(step.note.trim()) ? step.note.trim() : null;
    const label = step.label?.trim() ?? "";
    if (/timeout|timed out/i.test(`${label} ${note ?? ""}`))
      return "timed out, the page never loaded";
    if (label.length === 0) return note ?? "failed";
    return note === null ? `couldn't ${label}` : `couldn't ${label}: ${note}`;
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

/**
 * Browser checks made one after another, as the one row of the chat they
 * share: a page checked on a desktop and then on a phone is one row of takes.
 */
export function checksStrip(
  checks: ReadonlyArray<ZeropsOperation>,
  live: boolean,
): BrowserStripModel {
  return {
    key: `strip:${checks[0]!.key}`,
    checks,
    views: browserCheckViews(checks),
    failures: unrecoveredCheckFailures(checks).length,
    live,
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
  /** As the run left it: running, not running, or still broken. */
  readonly tone: "ok" | "attention" | "failed";
  /** "Dev server running", "Deployed", "Healthy", "Build failing". */
  readonly word: string;
  readonly version: string | null;
  readonly url: string | null;
  /** When the run last deployed, started or checked it: a version made after is someone else's. */
  readonly at: string;
  /** Still broken as the run left it: why, when, and what its log said last. */
  readonly failure: OutcomeFailure | null;
}

/** Why something is still broken: what its row says and a fix request carries (S6). */
export interface OutcomeFailure {
  /** The failure's own words: "3 type errors in session.ts". */
  readonly reason: string;
  readonly at: string;
  /** The last lines of the log it left, oldest first. */
  readonly logLines: ReadonlyArray<string>;
}

/** Something the run set out to do and did not: a push, a service it could not create. */
export interface OutcomeNotDone {
  readonly key: string;
  /** What it was about: "gitea", "appdev". */
  readonly subject: string;
  /** "Import failed", "Push failed". */
  readonly word: string;
  readonly reason: string | null;
  readonly at: string;
}

/**
 * What the runs after a run took over since it ended — its rows are theirs
 * now — and whether the person wrote again, which answers what waited on
 * them.
 */
export interface OutcomeLater {
  /** Services a later run deployed, started, stopped, created or removed. */
  readonly services: ReadonlyArray<string>;
  /** Changes a later run pushed to: "repository#number". */
  readonly changes: ReadonlyArray<string>;
  /** Crew tasks a later run worked, by number. */
  readonly tasks: ReadonlyArray<number>;
  /** Pages a later run checked, by host and path. */
  readonly pages: ReadonlyArray<string>;
  readonly answered: boolean;
}

export interface OutcomeModel {
  readonly key: string;
  /** The turn it reports on. */
  readonly turnKey: string;
  readonly live: ReadonlyArray<OutcomeService>;
  /** Changes that landed while it ran: "merged as #54". */
  readonly landed: ReadonlyArray<{
    readonly key: string;
    readonly repository: string;
    readonly number: number;
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
    /** Every check, in order: the result finds each page's pictures and verdict in them. */
    readonly takes: ReadonlyArray<ZeropsOperation>;
  } | null;
  readonly created: ReadonlyArray<string>;
  readonly notDone: ReadonlyArray<OutcomeNotDone>;
  /** Steps of its plan it did not finish. */
  readonly planLeft: ReadonlyArray<string>;
  /** The pull request its push landed through: the change it left for the person. */
  readonly change: { readonly repository: string; readonly number: number } | null;
  /** The crew task it worked, as its card named it. */
  readonly crewTask: { readonly number: number; readonly title: string } | null;
  /** What its calls came to, by kind: the effort its worked line counts (`runEffortWords`). */
  readonly activity: ReadonlyArray<OutcomeActivity>;
  readonly later: OutcomeLater;
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

/** The pipeline's build steps: a deploy that failed in one of them has a build that fails. */
const BUILD_STEP_IDS: ReadonlySet<string> = new Set(["INIT_BUILD_CONTAINER", "RUN_BUILD_COMMANDS"]);

/** A service a failure left broken, in a few words: where it broke, not the call's status word. */
function brokenWord(operation: ZeropsOperation): string {
  if (operation.kind === "verify") return "Not healthy";
  if (operation.kind === "devServer") return "Dev server not running";
  const failed = operation.steps.find((step) => step.state === "failed");
  return failed !== undefined && BUILD_STEP_IDS.has(failed.id) ? "Build failing" : "Deploy failed";
}

function failureOf(operation: ZeropsOperation): OutcomeFailure {
  return {
    reason: failureWords(operation),
    at: operation.settledAt ?? operation.anchorAt,
    logLines: operation.explanation?.logTail ?? [],
  };
}

/** What did not go through, by what it set out to do. */
const NOT_DONE_WORD: Partial<Record<ZeropsOperation["kind"], string>> = {
  deploy: "Push failed",
  import: "Import failed",
  delete: "Removal failed",
  subdomain: "Subdomain failed",
  mount: "Mount failed",
  scale: "Scaling failed",
  env: "Settings change failed",
  bootstrap: "Setup failed",
};

/**
 * A deploy call that only pushed to git, or found nothing to push: its one
 * step is the push. A push whose build zcp watched carries the build's steps
 * and is a deploy like any other.
 */
export function isGitPushOnly(operation: ZeropsOperation): boolean {
  return (
    operation.kind === "deploy" &&
    operation.strategy === "git-push" &&
    operation.steps.length === 1 &&
    operation.steps[0]!.id === "push"
  );
}

const NOTHING_LATER: OutcomeLater = {
  services: [],
  changes: [],
  tasks: [],
  pages: [],
  answered: false,
};

/** The names an import created or a removal took away: "db, cache" is two. */
function servicesNamed(subject: string): string[] {
  return subject.split(/,\s*/u).filter((name) => name.length > 0 && name !== "the services");
}

/** The services a settled operation takes over: deployed, started, stopped, created or removed. */
function takenServices(operation: ZeropsOperation): string[] {
  if (operation.phase === "running") return [];
  switch (operation.kind) {
    case "deploy":
      return isGitPushOnly(operation) ? [] : [operationTargetKey(operation)];
    case "devServer":
      return ["start", "restart", "stop"].includes(devServerAction(operation))
        ? [operationTargetKey(operation)]
        : [];
    case "import":
    case "delete":
      return operation.phase === "done" ? servicesNamed(operation.subject) : [];
    default:
      return [];
  }
}

/** The crew task a turn worked: the one its card names — "#12 Camera rig · from you". */
function crewTaskOf(turn: ConversationTurn): { number: number; title: string } | null {
  const card = turn.span.opener === null ? null : readCrewCard(turn.span.opener.message.text);
  const match = card === null ? null : /^#(\d+)\s+(.+?)(?:\s+·\s+[^·]*)?$/u.exec(card.title);
  return match === null ? null : { number: Number(match[1]), title: match[2]!.trim() };
}

/** What the runs after one took over, read off their settled work. */
function laterClaims(turns: ReadonlyArray<ConversationTurn>): OutcomeLater {
  if (turns.length === 0) return NOTHING_LATER;
  const services = new Set<string>();
  const changes = new Set<string>();
  const tasks = new Set<number>();
  const pages = new Set<string>();
  let answered = false;
  for (const turn of turns) {
    const opener = turn.span.opener;
    if (opener !== null && !isResumePrompt(opener.message.text)) answered = true;
    const task = crewTaskOf(turn);
    if (task !== null) tasks.add(task.number);
    for (const operation of turn.stretches.flatMap(stretchOperations).flatMap(splitBatchDeploy)) {
      if (operation.phase === "running") continue;
      for (const host of takenServices(operation)) services.add(host);
      if (operation.pullRequest !== undefined) {
        changes.add(`${operation.pullRequest.repository}#${operation.pullRequest.number}`);
      }
      if (operation.kind === "browser") pages.add(browserCheckPage(operation));
    }
  }
  return {
    services: [...services],
    changes: [...changes],
    tasks: [...tasks],
    pages: [...pages],
    answered,
  };
}

/** The steps its plan still had open when the run ended: its last plan's. */
function planLeftOf(turn: ConversationTurn): string[] {
  const plan = turn.stretches
    .flatMap((stretch) => stretch.entries)
    .findLast((entry) => entry.kind === "turn-plan");
  return plan?.kind === "turn-plan"
    ? plan.turnPlan.plan.steps.flatMap((step) => (step.status === "completed" ? [] : [step.step]))
    : [];
}

/** The turns after the one keyed `turnKey`: what its outcome follows. */
export function turnsAfter(
  structure: Pick<ConversationStructure, "turns">,
  turnKey: string,
): ReadonlyArray<ConversationTurn> {
  const index = structure.turns.findIndex((turn) => turn.key === turnKey);
  return index < 0 ? [] : structure.turns.slice(index + 1);
}

/**
 * What a settled turn left, each fact once: the services it left running or
 * broken — as the run left them, never a failure it came back from (the
 * owner, 2026-09-29: "it doesn't make sense to keep log of things that were
 * fixed later") — the changes that landed and the files it changed, the
 * checks, what it created, what it could not do, and what its calls came to.
 * Built only from what the turn already carries — null when it did nothing.
 */
export function deriveOutcome(input: {
  readonly turn: ConversationTurn;
  readonly landed: ReadonlyArray<ChangeLandedEntry>;
  readonly diff: TurnDiffSummary | null;
  /** What its calls came to (`activityCounts`). */
  readonly activity?: ReadonlyArray<OutcomeActivity>;
  /** The conversation's turns after it (`turnsAfter`): what they took over since. */
  readonly later?: ReadonlyArray<ConversationTurn>;
}): OutcomeModel | null {
  const { turn } = input;
  if (turn.live || turn.limitOnly) return null;
  const operations = turn.stretches.flatMap(stretchOperations).flatMap(splitBatchDeploy);
  const settled = operations.filter((operation) => operation.phase !== "running");

  const services = new Map<string, OutcomeService>();
  for (const operation of settled) {
    if (
      operation.kind !== "deploy" &&
      operation.kind !== "verify" &&
      operation.kind !== "devServer"
    )
      continue;
    // A git push says nothing of the service: the build after it, if any, does.
    if (isGitPushOnly(operation)) continue;
    const host = operationTargetKey(operation);
    const known = services.get(host);
    if (operation.phase === "failed") {
      services.set(host, {
        hostname: host,
        tone: "failed",
        word: brokenWord(operation),
        version: known?.version ?? null,
        url: known?.url ?? null,
        at: operation.settledAt ?? operation.anchorAt,
        failure: failureOf(operation),
      });
      continue;
    }
    if (operation.phase !== "done") continue;
    const url = operation.links[0]?.url ?? known?.url ?? null;
    if (operation.kind === "devServer") {
      // Stopped on purpose, it no longer runs because of the run.
      if (devServerAction(operation) === "stop") {
        if (known?.word.startsWith("Dev server") === true) services.delete(host);
        continue;
      }
      if (
        known?.tone === "ok" &&
        operation.statusWord === "Running" &&
        !known.word.startsWith("Dev server")
      ) {
        continue;
      }
      const running = operation.statusWord !== "Not running";
      services.set(host, {
        hostname: host,
        tone: running ? "ok" : "attention",
        word: running ? "Dev server running" : "Dev server not running",
        version: known?.version ?? null,
        url,
        at: operation.settledAt ?? operation.anchorAt,
        failure: null,
      });
      continue;
    }
    services.set(host, {
      hostname: host,
      tone: "ok",
      word: operation.kind === "verify" ? "Healthy" : "Deployed",
      version: operation.kind === "deploy" ? shortVersion(operation) : (known?.version ?? null),
      url,
      at: operation.settledAt ?? operation.anchorAt,
      failure: null,
    });
  }

  const checks = settled.filter((operation) => operation.kind === "browser");
  const created = settled.flatMap((operation) =>
    operation.kind === "import" && operation.phase === "done" ? [operation.subject] : [],
  );
  // What the turn set out to do and did not: a push, a service it could not
  // create, remove or change. A call that failed on the way (the "error"
  // kind — a workflow asked for a service that is not there) is a stumble
  // the log keeps, never an outcome: the run went on past it.
  const notDone = unrecoveredFailures(settled)
    .filter(
      (operation) =>
        (operation.kind !== "deploy" || isGitPushOnly(operation)) &&
        operation.kind !== "verify" &&
        operation.kind !== "devServer" &&
        operation.kind !== "browser" &&
        operation.kind !== "error" &&
        !isReadOperationKind(operation.kind),
    )
    .map((operation): OutcomeNotDone => ({
      key: operation.key,
      subject: operation.subject,
      word: NOT_DONE_WORD[operation.kind] ?? operation.statusWord,
      reason:
        operation.explanation?.reason.replace(/\.$/, "") ??
        operation.closing?.replace(/\.$/, "") ??
        null,
      at: operation.settledAt ?? operation.anchorAt,
    }));

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
      repository: entry.event.repository,
      number: entry.event.number,
      line: `${entry.event.repository} #${entry.event.number}`,
      title: entry.event.title,
    })),
    files,
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
    notDone,
    planLeft: planLeftOf(turn),
    change:
      settled.findLast((operation) => operation.pullRequest !== undefined)?.pullRequest ?? null,
    crewTask: crewTaskOf(turn),
    activity: input.activity ?? [],
    later: laterClaims(input.later ?? []),
  };
  const empty =
    outcome.activity.length === 0 &&
    outcome.live.length === 0 &&
    outcome.landed.length === 0 &&
    outcome.files === null &&
    outcome.checks === null &&
    outcome.created.length === 0 &&
    outcome.notDone.length === 0 &&
    outcome.planLeft.length === 0 &&
    outcome.change === null &&
    outcome.crewTask === null;
  return empty ? null : outcome;
}

// ---------------------------------------------------------------------------
// Receipts
// ---------------------------------------------------------------------------

/**
 * Whether the Mate has read a message. The one that began a run is read once
 * the server has begun it: the run is the Mate reading it, however long it
 * thinks before a word shows. One sent into a running turn is read at the
 * Mate's next step — once something of its turn came after it. A message the
 * provider has not reached yet is only sent.
 */
export function messageReceipt(
  message: ChatMessage,
  structure: ConversationStructure,
  index: number,
): "sent" | "seen" {
  const stretch = structure.stretchByIndex.get(index);
  if (stretch === undefined) return "sent";
  if (!stretch.aside && stretch.turnId !== null) return "seen";
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
