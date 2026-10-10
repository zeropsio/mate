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
import {
  projectLimitEntry,
  projectLimitHistory,
  type HistoricalLimit,
  type EngineRunCard,
} from "@t3tools/client-runtime/data";
import {
  isEngineItemId,
  TurnId,
  type CrewCard as ContractCrewCard,
  type RunRecord,
} from "@t3tools/contracts";
import {
  envChangeWords,
  isReadOperationKind,
  standupStepRole,
  type ZeropsOperation,
} from "@t3tools/client-runtime/zerops/model";

import { brokeOffReason } from "@t3tools/shared/threadStatus";
import { workLogEntryIsToolLike, type TimelineEntry, type WorkLogEntry } from "../../session-logic";
import type { ChatMessage, TurnDiffSummary } from "../../types";
import {
  CREW_CARD_OPENER,
  IMAGE_ONLY_BOOTSTRAP_PROMPT,
  isCrewCard,
  isSlashCommand,
  isUsageLimitResumePrompt,
} from "@t3tools/shared/userAsk";
import { versionText } from "../zerops/operation/version";

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

/**
 * The latest end of `entries` (`timelineEntryEnd`), as folding them with
 * `laterIso` says it — each end read once, not again at every step;
 * `skipTaskReports`, a helper's or a task's report aside.
 */
function latestEndOf(
  entries: ReadonlyArray<TimelineEntry>,
  skipTaskReports: boolean,
): string | null {
  let end: string | null = null;
  let endMs: number | null = null;
  for (const entry of entries) {
    if (skipTaskReports && isTaskReport(entry)) continue;
    const at = timelineEntryEnd(entry);
    const atMs = parseMs(at);
    if (endMs === null || (atMs !== null && atMs > endMs)) {
      end = at;
      endMs = atMs;
    }
  }
  return end;
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
  /** The engine's typed card, which the card is drawn from; absent on V1's text card. */
  readonly typed?: ContractCrewCard;
}

/**
 * The crew card a message opens its run with: the engine's typed card, or V1's text card read
 * from its words; null for anything else.
 */
export function crewCardOf(message: Pick<ChatMessage, "text" | "crewCard">): CrewCard | null {
  const typed = message.crewCard;
  if (typed !== undefined) return { title: typed.title, text: typed.why, typed };
  return readCrewCard(message.text);
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
  /**
   * Every turn of the run, in order: the one the person's message started,
   * then the ones nobody wrote to start — its helpers' results woke the
   * Mate, and it went on (run 11).
   */
  readonly turnIds: ReadonlyArray<TurnId>;
  /** Where each turn nobody wrote to start joined the run: its first entry's index. */
  readonly wakes: ReadonlyArray<number>;
  /** The helpers its turns launched, by task id: what it waits on, and what wakes it. */
  readonly helpers: ReadonlyArray<string>;
  readonly opener: MessageEntry | null;
  readonly openerIndex: number | null;
  /** Timeline indexes of the turn's own entries, in order. */
  readonly entryIndexes: ReadonlyArray<number>;
  readonly terminalEntry: MessageEntry | null;
}

/**
 * The turn each call began in. Claude files a call's result as an update and
 * a completion, the completion now and then under a later turn: a call is its
 * starting turn's, never a turn of its own.
 */
function callTurns(entries: ReadonlyArray<TimelineEntry>): ReadonlyMap<string, TurnId> {
  const turns = new Map<string, TurnId>();
  for (const entry of entries) {
    if (entry.kind !== "work" && entry.kind !== "generic-call") continue;
    const call = entry.entry.toolCallId;
    const turnId = entry.entry.turnId;
    if (call !== undefined && turnId && !turns.has(call)) turns.set(call, turnId);
  }
  return turns;
}

/** The turn an entry is the Mate's work in: its call's, else its own. */
function entryTurnId(entry: TimelineEntry, calls: ReadonlyMap<string, TurnId>): TurnId | null {
  if (entry.kind === "work" || entry.kind === "generic-call") {
    const call = entry.entry.toolCallId;
    const began = call === undefined ? undefined : calls.get(call);
    if (began !== undefined) return began;
  }
  return timelineEntryTurnId(entry);
}

/**
 * The helpers an entry is the launch or the report of, by task id: a launch
 * gathers the helpers it started; a helper's own task names its role, where
 * a shell's or a watch's names none.
 */
function helpersOf(entry: TimelineEntry): ReadonlyArray<string> {
  if (entry.kind !== "work") return [];
  const work = entry.entry;
  if (work.agentSpawn !== undefined) return work.agentSpawn.agentTaskIds;
  return work.agentRole !== undefined && work.taskId !== undefined ? [work.taskId] : [];
}

/** Whether a run's last word, a helper's report aside, is a usage limit refusing it. */
function endsOnALimit(
  entries: ReadonlyArray<TimelineEntry>,
  indexes: ReadonlyArray<number>,
): boolean {
  const last = indexes
    .map((index) => entries[index])
    .findLast((entry) => entry !== undefined && !isTaskReport(entry));
  if (last === undefined) return false;
  return projectLimitEntry(last) !== null;
}

/**
 * How soon after the last thing a run showed the person's next message may
 * come and still be what interrupted it: a run thinks for minutes between
 * the paragraphs it shows (Noibit, run 11: 79 s after its last one, the
 * message that stopped it read "stopped"). Said wrongly, "until your
 * message" stands for a Stop the person pressed just before writing.
 */
const INTERRUPTING_MESSAGE_MS = 180_000;

/**
 * How far apart two of the person's messages may stand and still be one
 * start: the later one sent into a run that has said nothing yet. A run says
 * something within seconds of beginning — its first thought — and the
 * composer holds a second message until the first one's run has begun, so a
 * message that waited longer than this for the next one had its own moment:
 * its run never came (a Stop before it began, a restart, a failed start), and
 * the run the next message starts is that message's alone (Juno, 2026-09-30:
 * the next day's run took the message before it for its opener, and its
 * clock read "Thinking 17:42:08").
 */
export const ONE_START_MS = 60_000;

/**
 * Whether the server said, outside any run, that the messages waiting for
 * one will get none: their start failed, or a Stop found nothing to stop.
 */
function endsTheWait(entry: TimelineEntry): boolean {
  return (
    entry.kind === "work" &&
    (entry.entry.sourceActivityKind === "provider.turn.start.failed" ||
      entry.entry.sourceActivityKind === "provider.turn.interrupt.failed")
  );
}

export function deriveTurnSpans(input: {
  readonly timelineEntries: ReadonlyArray<TimelineEntry>;
  readonly terminalAssistantMessageIds: ReadonlySet<string>;
  readonly runCards?: Readonly<Record<string, EngineRunCard>>;
  readonly unsettledTurnId: TurnId | null;
  readonly isWorking: boolean;
}): TurnSpan[] {
  type MutableSpan = {
    key: string;
    turnId: TurnId | null;
    turnIds: TurnId[];
    wakes: number[];
    helpers: string[];
    opener: MessageEntry | null;
    openerIndex: number | null;
    entryIndexes: number[];
    terminalEntry: MessageEntry | null;
  };
  const byTurnId = new Map<TurnId, MutableSpan>();
  const spans: MutableSpan[] = [];
  // Messages no turn has claimed yet. The next new turn is opened by the
  // first of the last of them sent one soon after another (`ONE_START_MS`);
  // the later ones were sent into it before it produced anything, and one
  // before a longer silence stands alone. An entry of an existing turn
  // arriving after them makes them messages sent into that turn. Nothing
  // reads which turn is the latest, so a turn keeps its opener once another
  // starts.
  let unclaimed: Array<{ entry: MessageEntry; index: number }> = [];
  // A command the harness ran without a turn of its own (a `/compact`) still
  // waits here when the person writes next: that message opens the next
  // turn, never the command — the command stands alone before it.
  const openerOf = (waiting: typeof unclaimed) => {
    let first = waiting.length - 1;
    while (
      first > 0 &&
      !(
        (parseMs(waiting[first]!.entry.createdAt) ?? 0) -
          (parseMs(waiting[first - 1]!.entry.createdAt) ?? 0) >
        ONE_START_MS
      )
    ) {
      first -= 1;
    }
    const start = waiting.slice(Math.max(first, 0));
    return start.find(({ entry }) => !isCommandMessage(entry)) ?? start[0] ?? null;
  };
  const open = (turnId: TurnId | null, opener: { entry: MessageEntry; index: number } | null) => {
    const span: MutableSpan = {
      key: opener ? `msg:${opener.entry.message.id}` : `turn:${turnId}`,
      turnId,
      turnIds: turnId === null ? [] : [turnId],
      wakes: [],
      helpers: [],
      opener: opener?.entry ?? null,
      openerIndex: opener?.index ?? null,
      entryIndexes: [],
      terminalEntry: null,
    };
    spans.push(span);
    if (turnId !== null) byTurnId.set(turnId, span);
    return span;
  };
  /**
   * A turn nobody wrote to start goes on with the run before it when that run
   * launched helpers (run 11): their results woke the Mate, and the run is
   * one card, not a card per wake — it waited open on them. Any other run's
   * card settled with its answer, and a turn after it — what a background
   * command's end woke, a `/compact`'s, a wake-up hours on — is a run of its
   * own, never one that takes the settled card back (review of pass 42).
   */
  const wake = (turnId: TurnId, index: number | null): MutableSpan | null => {
    const previous = spans.at(-1);
    if (previous === undefined || previous.turnId === null || previous.helpers.length === 0) {
      return null;
    }
    // A usage limit's own attempts and the server's resume after it are the
    // pause's to tell, turn by turn.
    if (endsOnALimit(input.timelineEntries, previous.entryIndexes)) return null;
    previous.turnIds.push(turnId);
    if (index !== null) previous.wakes.push(index);
    // Its answer is the last turn's to give: words before the work it woke to
    // were on the way.
    previous.terminalEntry = null;
    byTurnId.set(turnId, previous);
    return previous;
  };
  const calls = callTurns(input.timelineEntries);
  const cardByOpener = new Map(
    Object.entries(input.runCards ?? {}).flatMap(([id, card]) =>
      card.openerMessageId === undefined ? [] : [[card.openerMessageId, TurnId.make(id)] as const],
    ),
  );
  for (const [index, entry] of input.timelineEntries.entries()) {
    if (isUserMessageEntry(entry)) {
      const turnId = entry.message.turnId ?? cardByOpener.get(entry.message.id) ?? null;
      if (input.runCards !== undefined && turnId != null && input.runCards[turnId] !== undefined) {
        if (!byTurnId.has(turnId)) open(turnId, { entry, index });
        continue;
      }
      unclaimed.push({ entry, index });
      continue;
    }
    const turnId = entryTurnId(entry, calls);
    if (turnId === null) {
      const messageId = entry.kind === "work" ? entry.entry.interruption?.messageId : undefined;
      if (messageId !== undefined) {
        const openerIndex = input.timelineEntries.findIndex(
          (candidate) => isUserMessageEntry(candidate) && candidate.message.id === messageId,
        );
        const opener = input.timelineEntries[openerIndex];
        if (opener !== undefined && isUserMessageEntry(opener)) {
          const span = open(null, { entry: opener, index: openerIndex });
          span.entryIndexes.push(index);
          unclaimed = unclaimed.filter((candidate) => candidate.index > openerIndex);
        }
      }
      if (endsTheWait(entry)) unclaimed = [];
      continue;
    }
    // A completion filed under a later turn than its call began in is its
    // call's, but says the later turn began: the person's messages waiting
    // started it (review of pass 42: their message, taken for one sent into
    // the run it interrupted, lost its own run).
    const filedUnder = timelineEntryTurnId(entry);
    if (
      filedUnder !== null &&
      filedUnder !== turnId &&
      unclaimed.length > 0 &&
      !byTurnId.has(filedUnder)
    ) {
      open(filedUnder, openerOf(unclaimed));
      unclaimed = [];
    }
    let span = byTurnId.get(turnId);
    if (span) {
      unclaimed = [];
    } else {
      const opener = openerOf(unclaimed);
      span =
        (input.runCards === undefined && opener === null ? wake(turnId, index) : null) ??
        open(turnId, opener);
      unclaimed = [];
    }
    span.entryIndexes.push(index);
    span.helpers.push(...helpersOf(entry));
    if (entry.kind === "message" && input.terminalAssistantMessageIds.has(entry.message.id)) {
      span.terminalEntry = entry;
    }
  }
  if (input.unsettledTurnId !== null) {
    if (!byTurnId.has(input.unsettledTurnId)) {
      const opener = openerOf(unclaimed);
      // Woken, named, nothing of it yet: it takes the run on from the end.
      if (opener !== null || wake(input.unsettledTurnId, input.timelineEntries.length) === null) {
        open(input.unsettledTurnId, opener);
      }
    }
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
   * An engine card's earlier runs' answers, oldest first: each stays where the person read it,
   * under the card, as a run a job's end woke goes on in that card and answers below them
   * (Milo's third stress run: the reply under the folded card vanished into it at the wake).
   */
  readonly earlierAnswers: ReadonlyArray<MessageEntry>;
  /**
   * The words the Mate is writing while it runs that cannot be placed yet:
   * its last, nothing after them, not reading as its answer. A note if it
   * moves on, the answer if the run ends — drawn nowhere until then.
   */
  readonly writing: MessageEntry | null;
  readonly live: boolean;
  /**
   * No turn of it runs, and what it started still does — a helper, a
   * background job: the run is not over (run 11, "finished, but background
   * running").
   */
  readonly waiting: boolean;
  readonly run?: RunRecord;
  readonly interrupted: boolean;
  readonly interruption?: import("@t3tools/contracts").MateInterruption;
  /** Interrupted by the person's next message, not by their Stop. */
  readonly byMessage: boolean;
  /**
   * The run broke off on an error it did nothing after — its agent's process
   * died, or its turn failed: why, and on the latest run what to do next
   * (`brokeOffOn`). Such a run
   * has no answer: its last words were on the way, never its last word.
   */
  readonly brokeOff: BrokeOff | null;
  /** The usage-limit notice the turn ended on, when it did. */
  readonly limit: HistoricalLimit | null;
  readonly answerIsRefusal: boolean;
  /** Nothing but a usage-limit notice: a turn a limit refused before it did anything. */
  readonly limitOnly: boolean;
  /**
   * When its engine first ran it, null off the engine: a message the usage limit held is picked
   * up then, not when the person sent it (Milo's run 4: sent at 8:47, picked up at 10:20).
   */
  readonly ranFrom: string | null;
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
  const last = lastOwnEntry(entries);
  if (last === undefined) return false;
  if (last.kind === "message") return last.message.role === "reasoning";
  if (last.kind === "proposed-plan") return false;
  return !(last.kind === "work" && last.entry.tone === "error");
}

/** A turn's last entry of the Mate's own: what `endedOnAStep` reads. */
function lastOwnEntry(entries: ReadonlyArray<TimelineEntry>): TimelineEntry | undefined {
  return entries.findLast(
    (entry) =>
      entry.kind !== "turn-plan" &&
      entry.kind !== "change-landed" &&
      !(entry.kind === "message" && saysNothing(entry.message)) &&
      !(
        (entry.kind === "work" || entry.kind === "generic-call") &&
        (isTaskReport(entry) ||
          entry.entry.sourceActivityKind === "context-compaction" ||
          !workLogEntryIsToolLike(entry.entry))
      ),
  );
}

/**
 * The words a settled run broke off on, or null for one that ended by itself:
 * its last own entry is the server's record of the break (`runtime.error`) —
 * an agent's process that died, a turn that failed, in the turn's own words.
 * Any other failure the server notes after the Mate's last word (a
 * checkpoint it could not take, a Stop or an answer that did not reach the
 * agent) leaves the run finished. A usage limit is a pause, never a break.
 * Only the conversation's latest run says what to do next.
 */
/** Why a run broke off, and — the latest run only — what to do next. */
export interface BrokeOff {
  /** The runtime failure represented here, rather than repeated in the work log. */
  readonly entryId: string | null;
  readonly reason: string;
  readonly next: string | null;
}

function brokeOffOn(input: {
  readonly entries: ReadonlyArray<TimelineEntry>;
  readonly latest: boolean;
  readonly refused: boolean;
}): BrokeOff | null {
  if (input.refused) return null;
  const terminalFailure = input.entries.findLast(
    (entry) =>
      entry.kind === "work" &&
      entry.entry.sourceActivityKind === "runtime.error" &&
      (entry.entry.turnEnd === "crash" || entry.entry.turnEnd === "failed"),
  );
  const last = terminalFailure ?? lastOwnEntry(input.entries);
  if (last?.kind !== "work" || last.entry.sourceActivityKind !== "runtime.error") return null;
  const words = last.entry.detail?.trim() || last.entry.label;
  const reason = brokeOffReason(words);
  const next = words.slice(reason.length).trim();
  return { entryId: last.id, reason, next: input.latest && next.length > 0 ? next : null };
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
    !(entry.kind === "message" && saysNothing(entry.message))
  );
}

/**
 * A message of nothing: no words, and none on their way. An engine Mate's item still being
 * written is words all the same before its first one reaches its record (its leaf reads them from
 * the live text); a V1 message is born with its first delta and judged by it, as it always was.
 */
export function saysNothing(message: Pick<ChatMessage, "id" | "text" | "streaming">): boolean {
  if (message.streaming === true && isEngineItemId(message.id)) return false;
  return message.text.trim().length === 0;
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

/**
 * Whether an engine card's runs are over while what they started runs on: by the background work
 * the card holds, which ends in the same change as its run — the row's word comes a moment after,
 * and the card folded for that moment and opened again (Milo's stress run). A card that holds none
 * of its work goes by the row.
 */
function engineCardWaits(card: EngineRunCard | undefined): boolean {
  if (card === undefined) return false;
  // Its work over, the agent's own turn on it is due: the card goes on until that turn opens
  // (Milo's stress run 4: it folded to "worked", then the wake opened it again 1.9 s later).
  if (card.state?.kind === "working" && card.state.turnDue === true) return true;
  if (card.holdsWork === true) return card.waitsOn !== undefined;
  return card.state?.kind === "working" && card.state.waitsOnHelpers;
}

export function deriveConversationStructure(given: {
  readonly timelineEntries: ReadonlyArray<TimelineEntry>;
  readonly runCards?: Readonly<Record<string, EngineRunCard>>;
  readonly latestTurn: TimelineLatestTurnLike | null;
  readonly runningTurnId: TurnId | null;
  readonly isWorking: boolean;
  readonly activeTurnStartedAt: string | null;
  readonly provider?: string | null | undefined;
  /** The clock the last words' wait is read against; without it nothing waits. */
  readonly nowMs?: number;
  /**
   * Whether a helper still works, by its task id; unset while a turn runs.
   * The latest run waits on the helpers it launched, its turns over (run 11)
   * — never on a background command or a watch, which may run for hours.
   */
  readonly helperWorks?: (taskId: string) => boolean;
}): ConversationStructure {
  const entries = given.timelineEntries;
  const input = given;
  const unsettledTurnId =
    deriveUnsettledTurnId(input.latestTurn, input.runningTurnId) ??
    (input.runCards === undefined && input.isWorking
      ? unnamedRunningTurnId(entries, input.latestTurn)
      : null);
  const terminalIds = deriveTerminalAssistantMessageIds(entries);
  const spans = deriveTurnSpans({
    timelineEntries: entries,
    terminalAssistantMessageIds: terminalIds,
    ...(input.runCards === undefined ? {} : { runCards: input.runCards }),
    unsettledTurnId,
    isWorking: input.isWorking,
  });

  const liveSpan = input.isWorking
    ? (spans.find((span) => unsettledTurnId !== null && span.turnIds.includes(unsettledTurnId)) ??
      spans.find((span) => span.turnId === null))
    : undefined;
  // The latest run, its turns over, while what it started goes on.
  const latestSpan = spans.at(-1);
  const helperWorks = input.helperWorks;
  const waitingSpan =
    input.runCards !== undefined
      ? spans.find((span) => span.turnIds.some((id) => engineCardWaits(input.runCards?.[id])))
      : liveSpan === undefined &&
          helperWorks !== undefined &&
          latestSpan !== undefined &&
          latestSpan.helpers.some((taskId) => helperWorks(taskId))
        ? latestSpan
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
    end:
      span === liveSpan || span === waitingSpan
        ? Infinity
        : (span.entryIndexes.at(-1) ?? span.openerIndex ?? -1),
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
    spans.flatMap((span) => span.turnIds.map((turnId) => [turnId, span] as const)),
  );
  // A call can be seen before the session names its turn — its start arrives
  // turnless, and was drawn as background work finishing "in the background"
  // over the run it began (Nova, 2026-09-28). The same call, reported with
  // its turn, says whose it is.
  // A call is its starting turn's: one seen before the session named its
  // turn, or filed under a later one, says whose it is by its call.
  const turnIdByCall = callTurns(entries);
  const turnIdOf = (entry: TimelineEntry): TurnId | null => entryTurnId(entry, turnIdByCall);
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
  for (const [spanIndex, span] of spans.entries()) {
    const members = membersBySpan.get(span) ?? [];
    const cardRuns = span.turnIds.flatMap((id) => input.runCards?.[id]?.runs ?? []);
    const run = cardRuns.at(-1);
    const typed = input.runCards !== undefined;
    const live = typed ? run?.turnState === "running" : span === liveSpan;
    const turnEntries = members
      .map((index) => entries[index]!)
      .filter((entry) => !isUserMessageEntry(entry));
    const firstMember = members[0];
    const waiting = !live && span === waitingSpan;
    const latestTurnId = input.latestTurn?.turnId ?? null;
    const isLatestTurn = latestTurnId !== null && span.turnIds.at(-1) === latestTurnId;
    const interruption = turnEntries.findLast(
      (entry) => entry.kind === "work" && entry.entry.interruption !== undefined,
    );
    const cutRun = cardRuns.findLast((run) => run.end?.kind === "cut-by-restart");
    const cut = cutRun?.end;
    const restart = typed
      ? cut?.kind === "cut-by-restart"
        ? {
            turnId: span.turnId!,
            restart: cut.restart ?? {
              cause: "restarted" as const,
              at: cutRun?.endedAt == null ? null : new Date(cutRun.endedAt).toISOString(),
            },
            continuation:
              cut.continuedBy !== null
                ? ("continued" as const)
                : cut.notContinued !== undefined
                  ? ("none" as const)
                  : ("automatic" as const),
          }
        : undefined
      : interruption?.kind === "work"
        ? interruption.entry.interruption
        : undefined;
    const interrupted =
      !live &&
      !waiting &&
      (typed
        ? run?.end?.kind === "stopped" || run?.end?.kind === "cut-by-restart"
        : isLatestTurn
          ? input.latestTurn?.state === "interrupted"
          : endedOnAStep(turnEntries));
    // The person's next message came while it ran: their message interrupted
    // it, never their Stop (Noibit, run 11: "stopped after 8m 11s").
    const next = spans[spanIndex + 1];
    const lastOwn = turnEntries.at(-1);
    // The person's Stop ends every task the run started (stop-everything);
    // their message leaves them running.
    const stoppedTasks = turnEntries.some(
      (entry) =>
        (entry.kind === "work" || entry.kind === "generic-call") &&
        entry.entry.toolLifecycleStatus === "stopped",
    );
    const byMessage =
      !typed &&
      restart === undefined &&
      interrupted &&
      !stoppedTasks &&
      next?.opener != null &&
      lastOwn !== undefined &&
      (parseMs(next.opener.createdAt) ?? Infinity) <=
        (parseMs(timelineEntryEnd(lastOwn)) ?? -Infinity) + INTERRUPTING_MESSAGE_MS;

    // D4 (run 11): the answer is decided when the run ends. Until then its
    // words stream in the working row, however much they read as an answer:
    // drawn under a live card, an answer streamed "below while still writing"
    // and turned back into a note when a question followed.
    const refusal = projectLimitHistory({
      entries: turnEntries,
      answer: span.terminalEntry,
      live,
      waiting,
      driver: given.provider,
    });
    const brokeOff =
      live || waiting
        ? null
        : typed
          ? run?.end?.kind === "failed" || run?.end?.kind === "crashed"
            ? {
                entryId: null,
                reason: run.end.reason,
                next: run.end.kind === "failed" && isLatestTurn ? run.end.next : null,
              }
            : null
          : brokeOffOn({
              entries: turnEntries,
              latest: span === spans.at(-1),
              refused: refusal.hasRefusal,
            });
    const answer =
      live || waiting || brokeOff !== null
        ? null
        : typed
          ? (turnEntries.find(
              (entry): entry is MessageEntry =>
                entry.kind === "message" && String(entry.message.id) === run?.summary.answerItemId,
            ) ?? null)
          : span.terminalEntry;
    const earlierAnswers = typed
      ? cardRuns.flatMap((each) => {
          const id = each.summary.answerItemId;
          const said =
            id === null
              ? undefined
              : turnEntries.find(
                  (entry): entry is MessageEntry =>
                    entry.kind === "message" && String(entry.message.id) === id,
                );
          return said === undefined || said === answer ? [] : [said];
        })
      : [];
    // Words still streaming, nothing after them: the working row's, as they
    // come. Anything after them — a step, a thought — makes them a note in
    // the record, and so does their end: Codex says nothing of a command
    // until it completes, so words held until a step came after them hid the
    // whole command long.
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
    const { limit, limitOnly, answerIsRefusal } = refusal;

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
      : typed && run?.endedAt != null
        ? new Date(run.endedAt).toISOString()
        : (latestEndOf(turnEntries, true) ?? turnStart);

    // Split at the person's messages, and where a turn nobody wrote to start
    // took the run on.
    type Draft = { lead: MessageEntry | null; leadIndex: number | null; indexes: number[] };
    const drafts: Draft[] = [];
    const wakes = new Set(span.wakes);
    for (const index of members) {
      const entry = entries[index]!;
      if (isUserMessageEntry(entry)) {
        drafts.push({ lead: entry, leadIndex: index, indexes: [] });
      } else if (wakes.has(index) && drafts.length > 0) {
        drafts.push({ lead: null, leadIndex: null, indexes: [index] });
      } else if (drafts.length === 0) {
        drafts.push({ lead: null, leadIndex: null, indexes: [index] });
      } else {
        drafts.at(-1)!.indexes.push(index);
      }
    }
    if (drafts.length === 0) {
      // A live turn the server has named but that has produced nothing yet.
      drafts.push({ lead: span.opener, leadIndex: span.openerIndex, indexes: [] });
    } else if (live && span.wakes.some((index) => index >= entries.length)) {
      // Woken, and nothing of the turn yet: the run goes on from here.
      drafts.push({ lead: null, leadIndex: null, indexes: [] });
    }

    const stretches: Stretch[] = drafts.map((draft, position) => {
      const next = drafts[position + 1];
      const stretchEntries = draft.indexes.map((index) => entries[index]!);
      const last = position === drafts.length - 1;
      // A turn woken with nothing of it yet began once what came before it ended.
      const wokenAt =
        position > 0 && draft.lead === null && stretchEntries.length === 0
          ? laterIso(
              input.activeTurnStartedAt,
              latestEndOf(
                members.map((index) => entries[index]!),
                false,
              ),
            )
          : null;
      const startedAt =
        draft.lead?.createdAt ??
        stretchEntries[0]?.createdAt ??
        wokenAt ??
        turnStart ??
        input.activeTurnStartedAt ??
        "";
      const endedAt = last
        ? live
          ? null
          : (turnEnd ?? startedAt)
        : (next!.lead?.createdAt ??
          // As a run's own end: a helper reporting in is the helper's time.
          latestEndOf(stretchEntries, true) ??
          startedAt);
      const woke =
        draft.lead === null && position > 0
          ? stretchEntries[0] === undefined
            ? (span.turnIds.at(-1) ?? null)
            : turnIdOf(stretchEntries[0])
          : null;
      return {
        key: draft.lead
          ? `msg:${draft.lead.message.id}`
          : `turn:${woke ?? span.turnId ?? span.key}`,
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
      earlierAnswers,
      writing,
      live,
      waiting,
      ...(run === undefined ? {} : { run }),
      interrupted,
      ...(restart === undefined ? {} : { interruption: restart }),
      byMessage,
      brokeOff,
      limit,
      limitOnly,
      answerIsRefusal,
      ranFrom: cardRuns.reduce<string | null>(
        (first, each) =>
          each.startedAt === null || (first !== null && Date.parse(first) <= each.startedAt)
            ? first
            : new Date(each.startedAt).toISOString(),
        null,
      ),
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

type ActivityAction = "edit" | "command" | "read" | "code-search" | "search" | "fetch" | "other";

/** What a run's calls did, by kind: the effort its worked line counts. */
export type ActivityKind =
  | Exclude<ActivityAction, "other">
  | "workflow"
  | "guides"
  | "tool"
  | "helpers";

/** One fixed order, so the effort's words never reorder. */
export const ACTIVITY_ORDER: ReadonlyArray<ActivityKind> = [
  "edit",
  "command",
  "read",
  "code-search",
  "search",
  "fetch",
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
  // A fetch reads one page it was given: never a search (Milo's stress run, "1 web search").
  WebFetch: "fetch",
};

function activityAction(entry: WorkLogEntry): ActivityAction {
  // A name the effort has a word for says what the call did; any other
  // falls to what the call is, as its step reads it (`stepKind`).
  const named = namedToolCall(entry);
  const action = named === null ? undefined : NAMED_CALL_ACTION[named];
  if (action !== undefined) return action;
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
export const ZEROPS_TOOL_KIND: Readonly<Record<string, ActivityKind>> = {
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
  /** The calls its operations' cards hold (a deploy, a check): tools it used all the same. */
  operationCalls = 0,
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
    const kind =
      action === "other"
        ? (ZEROPS_TOOL_KIND[namedToolCall(entry) ?? ""] ?? ZEROPS_TOOL_KIND[entry.label] ?? "tool")
        : action;
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  if (operationCalls > 0) counts.set("tool", (counts.get("tool") ?? 0) + operationCalls);
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
 * Every driver's name for a tool, in Claude's: OpenCode's own tools and an
 * ACP agent's kinds (`read`, `edit`, `search`, `execute`, `fetch`, ...).
 * Claude's own names read the same, lowercased.
 */
const TOOL_NAMES: Readonly<Record<string, string>> = {
  read: "Read",
  write: "Write",
  edit: "Edit",
  multiedit: "Edit",
  patch: "Edit",
  apply_patch: "Edit",
  delete: "Edit",
  move: "Edit",
  bash: "Bash",
  execute: "Bash",
  grep: "Grep",
  search: "Grep",
  codesearch: "Grep",
  glob: "Glob",
  list: "Glob",
  ls: "Glob",
  webfetch: "WebFetch",
  fetch: "WebFetch",
  websearch: "WebSearch",
  todowrite: "TodoWrite",
  todoread: "TodoWrite",
  task: "Task",
  skill: "Skill",
  question: "AskUserQuestion",
};

/** An ACP agent's kinds that name no tool: the call's title says what it is. */
const UNNAMED_KINDS: ReadonlySet<string> = new Set(["other", "think", "switch_mode"]);

/**
 * The tool a call ran, in Claude's words: where its detail names it — a call
 * the runtime knows only as a "Tool call" carries its name and arguments as
 * "AskUserQuestion: {…}", the name is for people, the arguments never are —
 * else the name the server gives every driver's call (`toolName`): an MCP
 * tool by its own name, its server dropped; OpenCode's tools and an ACP
 * agent's kinds as Claude's.
 */
export function namedToolCall(
  entry: Pick<WorkLogEntry, "itemType" | "label" | "detail" | "toolName">,
): string | null {
  if (
    entry.itemType === "dynamic_tool_call" ||
    entry.itemType === "collab_agent_tool_call" ||
    entry.label === "Tool call"
  ) {
    const match = /^([A-Za-z][\w-]*):\s*[{[]/.exec(entry.detail ?? "");
    if (match?.[1] !== undefined) return match[1];
  }
  const name = entry.toolName?.trim();
  if (name === undefined || name.length === 0 || UNNAMED_KINDS.has(name)) return null;
  if (name.startsWith("mcp__")) return name.replace(/^mcp__[^_]+(?:_[^_]+)*?__/, "");
  return TOOL_NAMES[name.toLowerCase()] ?? name;
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

/**
 * The picture a call looked at, by its path: the image its runtime says it
 * viewed, else the file it named, else a detail that is only a path.
 */
export function lookedAt(entry: WorkLogEntry): string | null {
  return (
    entry.viewedImagePath ??
    entry.callInput?.filePath ??
    (entry.detail !== undefined && /^\/\S+$/.test(entry.detail.trim()) ? entry.detail.trim() : null)
  );
}

/**
 * The picture a call saw, when it is the Mate looking at one — most often a
 * screenshot it took of its own app — and it saw it: a look that failed saw
 * nothing.
 */
function pictureSeen(entry: WorkLogEntry): string | null {
  const looks = entry.itemType === "image_view" || entry.viewedImagePath !== undefined;
  if (!looks || !isActivityWork(entry) || entry.toolLifecycleStatus === "failed") return null;
  return lookedAt(entry);
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

export type WorkLineFace =
  | "working"
  | "idle"
  | "produced"
  | "failed"
  | "paused"
  | "stopped"
  /** The person's message came in while it worked: it took that up, not stopped. */
  | "interrupted"
  /** It broke off on an error it did nothing after: its agent died, or its turn failed. */
  | "brokeOff";

/**
 * A platform operation whose call never returned, as a step's words: what was
 * asked ("Deploy app"), never that it runs or how it came out. The record
 * says it once a newer batch left it behind, and "No result" once the run is
 * over (pass 35).
 */
export function operationUnreturnedWords(operation: ZeropsOperation): string {
  const { subject } = operation;
  switch (operation.kind) {
    case "deploy":
      return `Deploy ${subject}`;
    case "verify":
    case "browser":
      return `Check ${subject}`;
    case "import":
      return `Create ${subject}`;
    case "mount":
      return `Mount ${subject}`;
    case "subdomain":
      return `Update the subdomain of ${subject}`;
    case "delete":
      return `Delete ${subject}`;
    case "scale":
      return `Scale ${subject}`;
    case "manage":
      return `Manage ${subject}`;
    case "env":
      return operation.envChange === undefined
        ? `Update the environment of ${subject}`
        : envChangeWords(operation.envChange, "asked");
    case "devServer":
      return `Manage the dev server on ${subject}`;
    case "logs":
      return `Read the ${subject} log`;
    case "events":
      return `Read the events of ${subject}`;
    case "process":
      return `Follow ${subject}`;
    case "discover":
      return `Look at ${subject}`;
    case "bootstrap":
      return `Set up ${subject}`;
    case "standup":
      return `Stand ${subject} up`;
    case "error":
      return operation.voice.replace(/\.$/, "");
  }
}

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
    case "verify": {
      // A check of every service (zcp's `all services`) says how many.
      if (subject === "all services") {
        // Only a check that passed is healthy.
        const total = operation.steps.length;
        const healthy = operation.steps.filter((step) => step.state === "done").length;
        const unhealthy = operation.steps.filter((step) => step.state === "failed").length;
        if (total === 0) return failed ? "Checks failed" : "All services healthy";
        const services = total === 1 ? "service" : "services";
        if (unhealthy > 0) return `${unhealthy} of ${total} ${services} unhealthy`;
        return healthy === total && !failed
          ? `${total} ${services} healthy`
          : `${healthy} of ${total} ${services} healthy`;
      }
      return failed ? `${subject}: ${statusWord.toLowerCase()}` : `${subject} is healthy`;
    }
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
    case "standup": {
      // A stage the call queued is the next call's, one it held back waits on
      // what did not stand up: named as coming, never counted as failed.
      const own = operation.steps.filter((step) => standupStepRole(step) === "own");
      const broke = own.find((step) => step.state === "failed");
      if (failed) {
        if (broke === undefined) return `Standing ${subject} up failed`;
        const up = own.filter((step) => step.state === "done").length;
        return `Stood up ${up} of ${own.length} · ${broke.label} failed`;
      }
      const building = own.filter((step) => step.state === "running").map((step) => step.label);
      const next = operation.steps
        .filter((step) => standupStepRole(step) === "next")
        .map((step) => step.label);
      return [
        `Stood ${subject} up`,
        ...(building.length === 0 ? [] : [`${namesInWords(building)} still building`]),
        ...(next.length === 0 ? [] : [`${namesInWords(next)} next`]),
      ].join(" · ");
    }
    // "Done app" read oddly (pass 35): a process it followed to its end.
    case "process":
      if (failed) return `${subject}: ${statusWord.toLowerCase()}`;
      return statusWord === "Done" ? `Followed ${subject}` : `${statusWord} ${subject}`;
    // "Complete app" read oddly too: a set-up session stands its services up.
    case "bootstrap":
      if (failed) return `${subject}: ${statusWord.toLowerCase()}`;
      if (statusWord !== "Complete") return `${statusWord} ${subject}`;
      // An adopt-route session took over what stood already (its kicker, "Adopt · …").
      return operation.kicker.startsWith("Adopt ·") ? `Adopted ${subject}` : `Stood ${subject} up`;
    // What it changed and where (the project's variables, a service's), never a value.
    case "env":
      if (operation.envChange !== undefined) {
        if (failed) return envChangeWords(operation.envChange, "failed");
        // Declined, stopped, unconfirmed: what was asked, and how it ended.
        return operation.phase === "done"
          ? envChangeWords(operation.envChange, "done")
          : `${envChangeWords(operation.envChange, "asked")}: ${statusWord.toLowerCase()}`;
      }
      return failed ? `${subject}: ${statusWord.toLowerCase()}` : `${statusWord} ${subject}`;
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

/** "a", "a and b", "a, b and c". */
function namesInWords(names: ReadonlyArray<string>): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
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

/**
 * A settled stand-up as the deploys it made, one per service: each stands at
 * its address, or broken with its build's reason — the result reads them as
 * it reads any deploy. A running one is its bar's, not the result's.
 */
export function splitStandup(operation: ZeropsOperation): ZeropsOperation[] {
  if (operation.kind !== "standup" || operation.phase === "running") return [operation];
  const { explanation: _explanation, closing: _closing, ...shared } = operation;
  // A stage the call queued or held back runs nothing yet; a build the call
  // stopped waiting for still runs — no address, no verdict.
  const parts = operation.steps
    .filter((step) => standupStepRole(step) === "own")
    .map((step): ZeropsOperation => {
      const phase: ZeropsOperation["phase"] =
        step.state === "failed" ? "failed" : step.state === "running" ? "running" : "done";
      const link = operation.links.find((candidate) => candidate.label === step.label);
      return {
        ...shared,
        key: `${operation.key}:${step.label}`,
        kind: "deploy",
        subject: step.label,
        kicker: `Deploy · ${step.label}`,
        target: { hostname: step.label },
        phase,
        statusWord: phase === "done" ? "Deployed" : phase === "failed" ? "Failed" : "Deploying",
        steps: [step],
        links: link === undefined || phase !== "done" ? [] : [{ label: "Open", url: link.url }],
        ...(phase === "failed" && step.note !== undefined
          ? { explanation: { reason: step.note } }
          : {}),
      };
    });
  // Nothing to split — a refusal before any service — stays the failure it is.
  return parts.length === 0 ? [operation] : parts;
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
  if (turn.brokeOff !== null && stretch.last) return "brokeOff";
  if (turn.interruption?.continuation === "manual" && stretch.last) return "interrupted";
  if (turn.interrupted && stretch.last) return turn.byMessage ? "interrupted" : "stopped";
  if (input.pausedHere) return "paused";
  const operations = stretchOperations(stretch);
  if (unrecoveredFailures(operations).length > 0) return "failed";
  // An error the Mate did not work past: nothing but thinking came after it.
  const lastWord = stretch.entries.findLast(
    (entry) =>
      entry !== turn.answer && !(entry.kind === "message" && entry.message.role === "reasoning"),
  );
  if (
    turn.run === undefined &&
    stretch.last &&
    lastWord?.kind === "work" &&
    lastWord.entry.tone === "error"
  ) {
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

/**
 * The page a check looked at, in words: its path, the front page by name — "Checked / in the
 * browser" said the path, never the page (Milo's stress runs).
 */
export function browserPageWords(caption: string): string {
  return caption === "/" ? "the home page" : caption;
}

export type BrowserDevice = "desktop" | "tablet" | "phone";

/**
 * The device a check looked through: the device it emulated by name, else the
 * viewport it set (CSS pixels), else the picture it took — a phone's picture
 * is tall and, even at three device pixels per CSS pixel, under 1300 wide.
 */
export function browserCheckDevice(check: ZeropsOperation): BrowserDevice {
  const name = check.deviceName;
  if (name !== undefined) {
    if (/desktop/i.test(name)) return "desktop";
    return /ipad|tablet|\btab\b|kindle|nexus (7|9|10)/i.test(name) ? "tablet" : "phone";
  }
  const viewport = check.viewport;
  if (viewport !== undefined) {
    if (viewport.width <= 480) return "phone";
    return viewport.width <= 1024 && viewport.height > viewport.width ? "tablet" : "desktop";
  }
  const shot = check.screenshot;
  if (shot?.width !== undefined && shot.height !== undefined) {
    const tall = shot.height / shot.width;
    if (shot.width <= 480 || (tall >= 1.6 && shot.width < 1300)) return "phone";
    if (tall >= 1.15 && shot.width < 2100) return "tablet";
  }
  return "desktop";
}

/** The shape of a take's frame, width over height, by device: a thumbnail crops its picture to it. */
export const TAKE_ASPECT: Record<BrowserDevice, number> = {
  desktop: 1.6,
  tablet: 0.75,
  phone: 0.45,
};

/**
 * A check's picture's shape, width over height, before a byte of it: its own
 * size where zcp sent it, else the viewport the check set, else its device's
 * frame.
 */
export function browserCheckShape(check: ZeropsOperation): number {
  const shot = check.screenshot;
  if (shot?.width !== undefined && shot.height !== undefined && shot.width > 0 && shot.height > 0) {
    return shot.width / shot.height;
  }
  const viewport = check.viewport;
  if (viewport !== undefined && viewport.width > 0 && viewport.height > 0) {
    return viewport.width / viewport.height;
  }
  return TAKE_ASPECT[browserCheckDevice(check)];
}

/**
 * A page as one device saw it — "host/path on iPhone 16", "host/path on a
 * desktop": what a picture is of, so a later look on another device takes
 * none of this one's.
 */
export function pageView(page: string, device: string | null): string {
  return `${page} on ${device ?? "a desktop"}`;
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

/** What a dev-server call found: running, not running, or nothing (still running, another kind). */
export function devServerRunning(operation: ZeropsOperation): boolean | null {
  if (operation.kind !== "devServer" || operation.phase === "running") return null;
  // A log read checks nothing about the server.
  if (devServerAction(operation) === "logs") return null;
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

/** The kinds that act on a service: after one of them, what was found of it before is old. */
const ACTING_KINDS: ReadonlySet<ZeropsOperation["kind"]> = new Set([
  "deploy",
  "devServer",
  "import",
  "manage",
  "scale",
  "standup",
]);

/**
 * The services an operation acts on: its target, or each a stand-up, an
 * import or a batch deploy names — a batch stays one call in the run's
 * entries, and every service it deploys is acted on.
 */
function actedOn(operation: ZeropsOperation): ReadonlyArray<string> {
  if (!ACTING_KINDS.has(operation.kind)) return [];
  if (
    operation.kind === "standup" ||
    operation.kind === "import" ||
    (operation.kind === "deploy" && operation.batch === true)
  ) {
    return operation.steps.map((step) => step.label);
  }
  return [operationTargetKey(operation)];
}

/**
 * What the dock under a live run's now line says of a service (K10) — one
 * rule for when it stands:
 *
 * - it appears when the latest thing done to a service is a dev-server call
 *   that found it not running (amber), or a start, a restart that failed
 *   (red);
 * - its source is that call's own finding, and nothing older: any later
 *   operation acting on the service — a deploy, a dev-server call, a
 *   stand-up, a restart — takes it down while it runs (the Mate is on it),
 *   and after it settles the dock says only what a dev-server call found
 *   since; a deploy's end leaves nothing to say until the Mate looks again;
 * - it clears once a later call finds the dev server running;
 * - the platform working on the service this moment stands it down too
 *   (`incidentsStanding`);
 * - it waits until the Mate moves on: while the finding is the record's
 *   latest line, it stands right above the now line already, and the dock
 *   would say it twice;
 * - it says the finding in words: "not running", "stopped answering (502)",
 *   "start failed".
 *
 * The run's record keeps the history (`stretchIncidents`); the dock keeps
 * only what is true now.
 */
export function standingIncidents(stretch: Stretch): IncidentModel[] {
  const latest = new Map<string, ZeropsOperation>();
  for (const operation of stretchOperations(stretch)) {
    for (const host of actedOn(operation)) latest.set(host, operation);
  }
  const lineOf = (operation: ZeropsOperation) =>
    stretch.entries.findIndex(
      (entry) => entry.kind === "operation" && entry.operation.key === operation.key,
    );
  const movedOnFrom = (operation: ZeropsOperation) =>
    stretch.entries
      .slice(lineOf(operation) + 1)
      .some((entry) => !(entry.kind === "message" && entry.message.role === "reasoning"));
  return [...latest.entries()].flatMap(([hostname, operation]): IncidentModel[] => {
    if (operation.kind !== "devServer" || devServerRunning(operation) !== false) return [];
    if (!movedOnFrom(operation)) return [];
    const failed = operation.phase === "failed";
    return [
      {
        key: `incident:${operation.key}`,
        hostname,
        phases: [
          failed
            ? `${devServerAction(operation) || "start"} failed`
            : devServerFailurePhrase(operation),
        ],
        tone: failed ? "failed" : "attention",
        appearedAt: operation.settledAt ?? operation.anchorAt,
      },
    ];
  });
}

/** The incidents that stand while the platform is not working on their service (`transient`). */
export function incidentsStanding(
  incidents: ReadonlyArray<IncidentModel>,
  transient: ReadonlySet<string>,
): ReadonlyArray<IncidentModel> {
  return incidents.some((incident) => transient.has(incident.hostname))
    ? incidents.filter((incident) => !transient.has(incident.hostname))
    : incidents;
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
  /** What it was about: "db", "appdev". */
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
  /** The same pages by the device each was seen on (`pageView`): what takes a picture over. */
  readonly views: ReadonlyArray<string>;
  /** Pictures a later run looked at, by path: the file shows what that run saw now. */
  readonly files: ReadonlyArray<string>;
  readonly answered: boolean;
}

/**
 * A picture a run took or looked at: a page as its browser check took it, or
 * a file the Mate looked at — most often a screenshot it took of its own app.
 */
export type OutcomePicture =
  | {
      readonly kind: "check";
      /** The take's key. */
      readonly key: string;
      readonly src: string;
      /** The page, as the person names it: "/status". */
      readonly caption: string;
      /** The page by host and path: what a later run checking it again takes over. */
      readonly page: string;
      /** The device the check emulated, where it named one. */
      readonly device: string | null;
      /** Its check stayed failed. */
      readonly failed: boolean;
      /** Its shape, width over height, known before it loads (`browserCheckShape`). */
      readonly ratio: number;
    }
  | {
      readonly kind: "file";
      readonly key: string;
      readonly dimensions?: { readonly width: number; readonly height: number };
      /** Where the Mate's workspace keeps it. */
      readonly path: string;
      /** The file's name: "home-mobile.png". */
      readonly name: string;
    };

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
    /** A run of several turns: the first whose diff it shows, its diff the whole run's. */
    readonly fromTurnId: TurnId | null;
  } | null;
  readonly checks: {
    readonly count: number;
    readonly views: number;
    readonly failures: number;
    /** Every check, in order: the result finds each page's verdict in them. */
    readonly takes: ReadonlyArray<ZeropsOperation>;
  } | null;
  /**
   * Its pictures, in the order they were taken: each page's last screenshot
   * its checks took, and each picture the Mate looked at — each once, where
   * it was taken last.
   */
  readonly pictures: ReadonlyArray<OutcomePicture>;
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
  return versionText(operation.version?.name) ?? null;
}

function failureWords(operation: ZeropsOperation): string {
  const reason = operation.explanation?.reason ?? operation.closing ?? operation.statusWord;
  return reason.replace(/\.$/, "");
}

/** The pipeline's build steps: a deploy that failed in one of them has a build that fails. */
const BUILD_STEP_IDS: ReadonlySet<string> = new Set(["INIT_BUILD_CONTAINER", "RUN_BUILD_COMMANDS"]);

/**
 * A failed check of how a service is reached, not of how it runs: its
 * subdomain left off, or a domain whose DNS points elsewhere yet — zcp's own
 * words for both (`verify_checks.go`). An address that answers an error is
 * neither.
 */
function reachedOnly(step: ZeropsOperation["steps"][number]): boolean {
  const note = step.note ?? "";
  return (
    (step.id === "http_public" && note.startsWith("subdomain access not enabled")) ||
    (step.id === "public_domain" && note.includes("DNS not pointing at Zerops yet"))
  );
}

/**
 * Where a service stands after an operation, read by how it runs: a health
 * check whose every failure is of how it is reached found it healthy (the
 * owner, 2026-09-29: "fix the state", of a service with clean logs that read
 * "Not healthy" because its subdomain was off).
 */
function standingPhase(operation: ZeropsOperation): ZeropsOperation["phase"] {
  if (operation.kind !== "verify" || operation.phase !== "failed") return operation.phase;
  const failed = operation.steps.filter((step) => step.state === "failed");
  return failed.length > 0 && failed.every(reachedOnly) ? "done" : operation.phase;
}

/** zcp's checks of an address: inside the project, its subdomain, its domain. */
const HTTP_CHECK_IDS: ReadonlySet<string> = new Set([
  "http_internal",
  "http_public",
  "public_domain",
]);

/**
 * A failed check that got no answer in its time: zcp's probe gives up after
 * five seconds (`probeHTTP`), and a dev server compiling its first page takes
 * longer. No answer is no word on how the service runs — an address that
 * answers an error, or refuses, is.
 */
function unanswered(step: ZeropsOperation["steps"][number]): boolean {
  return (
    HTTP_CHECK_IDS.has(step.id) &&
    /request failed: .*(?:deadline exceeded|timeout)/iu.test(step.note ?? "")
  );
}

/**
 * The status an address check got, from its note: "403 · HTTP 403: …" as the
 * card writes it, or zcp's own "HTTP 403: …" (`probeHTTP`). Null where it got
 * none — refused, timed out.
 */
function answeredStatus(step: ZeropsOperation["steps"][number]): number | null {
  const match = /^(?:(\d{3}) · |HTTP (\d{3}))/u.exec(step.note ?? "");
  const code = match?.[1] ?? match?.[2];
  return code === undefined ? null : Number(code);
}

/**
 * A failed check that says nothing against a dev server the run found
 * running: each failure went unanswered, or is the internal address answering
 * short of an error while the public one passed — a dev server's host check
 * turning the project's own hostname away (measured 2026-10-02: a Vite dev
 * server's allowed hosts answered the internal check 403 while its public
 * address served). An
 * address that answers an error, refuses, or a public check that failed, does.
 */
function saysNothingAgainstDevServer(operation: ZeropsOperation): boolean {
  if (operation.kind !== "verify") return false;
  const failed = operation.steps.filter((step) => step.state === "failed");
  const publicServed = operation.steps.some(
    (step) => step.id === "http_public" && step.state === "done",
  );
  const hostTurnedAway = (step: ZeropsOperation["steps"][number]) => {
    const status = answeredStatus(step);
    return step.id === "http_internal" && publicServed && status !== null && status < 500;
  };
  return failed.length > 0 && failed.every((step) => unanswered(step) || hostTurnedAway(step));
}

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
  views: [],
  files: [],
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
  const typed = turn.span.opener?.message.crewCard;
  if (typed !== undefined)
    return typed.number === null ? null : { number: typed.number, title: typed.title };
  const card = turn.span.opener === null ? null : readCrewCard(turn.span.opener.message.text);
  const match = card === null ? null : /^#(\d+)\s+(.+?)(?:\s+·\s+[^·]*)?$/u.exec(card.title);
  return match === null ? null : { number: Number(match[1]), title: match[2]!.trim() };
}

/** What one run took over, read off its settled work: the same run is asked by every run before it. */
interface TurnClaims {
  readonly services: ReadonlyArray<string>;
  readonly changes: ReadonlyArray<string>;
  readonly pages: ReadonlyArray<string>;
  readonly views: ReadonlyArray<string>;
  readonly files: ReadonlyArray<string>;
  readonly task: number | null;
  /** The person wrote it: not a command, not the server resuming after a limit. */
  readonly answers: boolean;
}

const claimsByTurn = new WeakMap<ConversationTurn, TurnClaims>();

function turnClaims(turn: ConversationTurn): TurnClaims {
  const known = claimsByTurn.get(turn);
  if (known !== undefined) return known;
  const services: string[] = [];
  const changes: string[] = [];
  const pages: string[] = [];
  const views: string[] = [];
  for (const operation of turn.stretches.flatMap(stretchOperations).flatMap(splitBatchDeploy)) {
    if (operation.phase === "running") continue;
    services.push(...takenServices(operation));
    if (operation.pullRequest !== undefined) {
      changes.push(`${operation.pullRequest.repository}#${operation.pullRequest.number}`);
    }
    if (operation.kind === "browser") {
      pages.push(browserCheckPage(operation));
      views.push(pageView(browserCheckPage(operation), operation.deviceName ?? null));
    }
  }
  const files = turn.stretches
    .flatMap((stretch) => stretch.entries)
    .flatMap((entry) => {
      if (entry.kind !== "work" && entry.kind !== "generic-call") return [];
      const path = pictureSeen(entry.entry);
      return path === null ? [] : [path];
    });
  const opener = turn.span.opener;
  const claims: TurnClaims = {
    services,
    changes,
    pages,
    views,
    files,
    task: crewTaskOf(turn)?.number ?? null,
    answers: opener !== null && !isResumePrompt(opener.message.text) && !isCommandMessage(opener),
  };
  claimsByTurn.set(turn, claims);
  return claims;
}

/** What the runs after one took over, and whether the person wrote since. */
function laterClaims(turns: ReadonlyArray<ConversationTurn>): OutcomeLater {
  if (turns.length === 0) return NOTHING_LATER;
  const services = new Set<string>();
  const changes = new Set<string>();
  const tasks = new Set<number>();
  const pages = new Set<string>();
  const views = new Set<string>();
  const files = new Set<string>();
  let answered = false;
  for (const turn of turns) {
    const claims = turnClaims(turn);
    for (const host of claims.services) services.add(host);
    for (const change of claims.changes) changes.add(change);
    for (const page of claims.pages) pages.add(page);
    for (const view of claims.views) views.add(view);
    for (const file of claims.files) files.add(file);
    if (claims.task !== null) tasks.add(claims.task);
    answered ||= claims.answers;
  }
  return {
    services: [...services],
    changes: [...changes],
    tasks: [...tasks],
    pages: [...pages],
    views: [...views],
    files: [...files],
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

/** A file's name, whatever separates its path. */
function fileName(path: string): string {
  return path.split(/[\\/]/u).findLast((part) => part.length > 0) ?? path;
}

/** A picture reference that names why its picture was never kept: `mate-asset:<id>:<code>`. */
const NO_PIXELS = /^mate-asset:[a-f0-9-]{36}:[a-z-]+$/u;

/**
 * The pictures a turn took and looked at, in the order they were taken — a
 * check's when it came back, a look's when the Mate saw it: each page's last
 * take with a picture on each device, and each file the Mate looked at. A picture taken
 * again — the same file, the same pixels — stands once, where it was taken
 * last.
 */
function turnPictures(
  turn: ConversationTurn,
  checks: ReadonlyArray<ZeropsOperation>,
): OutcomePicture[] {
  const taken: Array<{
    readonly same: string;
    readonly at: number;
    readonly picture: OutcomePicture;
  }> = [];
  // Each page's last take on each device: a page seen on a desktop and on a
  // phone is two pictures.
  const lastByPage = new Map<string, ZeropsOperation>();
  for (const check of checks) {
    if (check.screenshot === undefined || NO_PIXELS.test(check.screenshot.src)) continue;
    lastByPage.set(pageView(browserCheckPage(check), check.deviceName ?? null), check);
  }
  for (const check of lastByPage.values()) {
    const src = check.screenshot!.src;
    taken.push({
      same: `src:${src}`,
      at: parseMs(check.settledAt ?? check.anchorAt) ?? 0,
      picture: {
        kind: "check",
        key: check.key,
        src,
        caption: browserCheckCaption(check),
        page: browserCheckPage(check),
        device: check.deviceName ?? null,
        failed: browserTakeState(check, checks) === "failed",
        ratio: browserCheckShape(check),
      },
    });
  }
  for (const entry of turn.stretches.flatMap((stretch) => stretch.entries)) {
    if (entry.kind !== "work" && entry.kind !== "generic-call") continue;
    const path = pictureSeen(entry.entry);
    // A reference that says its picture was never kept (gone before it was, the store refused it)
    // has no pixels to draw: the run left no picture there (Rhea's imported run, 2026-10-10).
    if (path === null || NO_PIXELS.test(path)) continue;
    taken.push({
      same: `path:${path}`,
      at: parseMs(entry.entry.updatedAt ?? entry.entry.createdAt) ?? 0,
      picture: {
        kind: "file",
        key: `file:${path}`,
        path,
        name: entry.entry.viewedImageName ?? fileName(entry.entry.callInput?.filePath ?? path),
        ...(entry.entry.viewedImageDimensions
          ? { dimensions: entry.entry.viewedImageDimensions }
          : {}),
      },
    });
  }
  const last = new Map<string, (typeof taken)[number]>();
  for (const item of taken) {
    const known = last.get(item.same);
    if (known === undefined || item.at >= known.at) last.set(item.same, item);
  }
  return [...last.values()]
    .toSorted((left, right) => left.at - right.at)
    .map((item) => item.picture);
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
 * checks and the pictures it took and looked at, what it created, what it
 * could not do, and what its calls came to. Built only from what the turn
 * already carries — null when it did nothing.
 */
export function deriveOutcome(input: {
  readonly turn: ConversationTurn;
  readonly landed: ReadonlyArray<ChangeLandedEntry>;
  /** The diff of each of its turns that has one, in order. */
  readonly diffs: ReadonlyArray<TurnDiffSummary>;
  /** What its calls came to (`activityCounts`). */
  readonly activity?: ReadonlyArray<OutcomeActivity>;
  /** The conversation's turns after it (`turnsAfter`): what they took over since. */
  readonly later?: ReadonlyArray<ConversationTurn>;
  /**
   * Its work is not all held (an engine run read for its closed card alone): its effort is
   * counted elsewhere (`withPagedEffort`), so it has an outcome however little is held.
   */
  readonly unheld?: boolean;
}): OutcomeModel | null {
  const { turn } = input;
  // A run the limit refused before it did anything has no outcome; one whose work is not held
  // (a reload holds only its words, here the refusal) did work all the same.
  if (turn.live || (turn.limitOnly && input.unheld !== true)) return null;
  const operations = turn.stretches
    .flatMap(stretchOperations)
    .flatMap(splitBatchDeploy)
    .flatMap(splitStandup);
  const settled = operations.filter((operation) => operation.phase !== "running");

  const services = new Map<string, OutcomeService>();
  // Services whose latest dev-server call found the dev server running: a
  // check after it that got no answer in its time leaves it there (the
  // stand-up of 2026-10-02: both dev servers started, the check after timed
  // out on their first pages, both answered 200 a minute later).
  const devServerRuns = new Set<string>();
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
    if (operation.kind === "devServer") {
      if (devServerRunning(operation) === true) devServerRuns.add(host);
      else devServerRuns.delete(host);
    }
    // A deploy replaces what ran: the dev server found before it is not what runs now.
    if (operation.kind === "deploy" && operation.phase === "done") devServerRuns.delete(host);
    const phase = standingPhase(operation);
    if (phase === "failed" && devServerRuns.has(host) && saysNothingAgainstDevServer(operation))
      continue;
    if (phase === "failed") {
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
    if (phase !== "done") continue;
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

  // Every turn of the run: the turns its helpers woke change files too
  // (review of pass 42: a run's first turn launched them, and said none).
  const changed = input.diffs.filter((diff) => diff.files.length > 0);
  const first = changed[0];
  const lastDiff = changed.at(-1);
  const files =
    first !== undefined && lastDiff !== undefined
      ? {
          count: new Set(changed.flatMap((diff) => diff.files.map((file) => file.path))).size,
          additions: changed
            .flatMap((diff) => diff.files)
            .reduce((sum, file) => sum + (file.additions ?? 0), 0),
          deletions: changed
            .flatMap((diff) => diff.files)
            .reduce((sum, file) => sum + (file.deletions ?? 0), 0),
          turnId: lastDiff.turnId,
          fromTurnId: first === lastDiff ? null : first.turnId,
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
    pictures: turnPictures(turn, checks),
    created,
    notDone,
    planLeft: planLeftOf(turn),
    change:
      settled.findLast((operation) => operation.pullRequest !== undefined)?.pullRequest ?? null,
    crewTask: crewTaskOf(turn),
    activity: input.activity ?? [],
    later: laterClaims(input.later ?? []),
  };
  return outcome.activity.length === 0 && !outcomeDraws(outcome) && input.unheld !== true
    ? null
    : outcome;
}

/**
 * Whether a run's outcome draws anything under its line. What its calls came
 * to is said on the line itself (`runEffortWords`), so an outcome of that
 * alone draws nothing, and its card holds its line alone.
 */
export function outcomeDraws(outcome: OutcomeModel): boolean {
  return (
    outcome.live.length > 0 ||
    outcome.landed.length > 0 ||
    outcome.files !== null ||
    outcome.checks !== null ||
    outcome.pictures.length > 0 ||
    outcome.created.length > 0 ||
    outcome.notDone.length > 0 ||
    outcome.planLeft.length > 0 ||
    outcome.change !== null ||
    outcome.crewTask !== null
  );
}

// ---------------------------------------------------------------------------
// Receipts
// ---------------------------------------------------------------------------

const NO_TURNS: ReadonlySet<string> = new Set();

/**
 * The runs a person's messages started that came: the latest turn's and every one a message
 * before it names. Only an engine Mate's message names its run; a run waiting in the queue comes
 * after the latest turn, so it is not among them.
 */
export function turnsThatCame(
  entries: ReadonlyArray<TimelineEntry>,
  latestTurn: { readonly turnId: string } | null,
): ReadonlySet<string> {
  if (latestTurn === null) return NO_TURNS;
  const named = entries.flatMap((entry) =>
    entry.kind === "message" && entry.message.role === "user" && entry.message.turnId != null
      ? [entry.message.turnId as string]
      : [],
  );
  const latestAt = named.lastIndexOf(latestTurn.turnId);
  return latestAt === -1 ? NO_TURNS : new Set(named.slice(0, latestAt + 1));
}

/**
 * Whether the Mate has read a message. The one that began a run is read once
 * the server has begun it: the run is the Mate reading it, however long it
 * thinks before a word shows. One sent into a running turn is read at the
 * Mate's next step — once something of its turn came after it. A message the
 * provider has not reached yet is only sent. One no run took, with a run
 * after it, says nothing: the Mate moved on without it, and "not read yet"
 * would promise a next step that never comes. One whose own run came (`turnsThatCame`) was
 * read, however that run ended — a Stop before a word draws no turn, yet the Mate had it.
 */
export function messageReceipt(
  message: ChatMessage,
  structure: ConversationStructure,
  index: number,
  came: ReadonlySet<string> = NO_TURNS,
): "sent" | "seen" | null {
  const stretch = structure.stretchByIndex.get(index);
  if (stretch === undefined) {
    if (structure.turns.some((turn) => (turn.stretches[0]?.anchorIndex ?? -1) > index)) return null;
    return message.turnId != null && came.has(message.turnId) ? "seen" : "sent";
  }
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
