import * as Equal from "effect/Equal";
import type { ChangeLandedEvent } from "@t3tools/client-runtime/zerops";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import { type MessageId, type OrchestrationLatestTurn, type TurnId } from "@t3tools/contracts";

import {
  inferCheckpointTurnCountByTurnId,
  workEntryDisplayIndicatesToolFailure,
  workEntryIndicatesToolNeutralStatus,
  type TimelineEntry,
  type TurnPlanEntry,
  type WorkLogEntry,
} from "../../session-logic";
import { type ChatMessage, type ProposedPlan, type TurnDiffSummary } from "../../types";
import type { QueuedComposerMessage } from "../../queuedMessageStore";
import { DOCKED_KINDS } from "./conversationDock.logic";
import {
  browserStrip,
  deriveConversationStructure,
  deriveOutcome,
  isActivityWork,
  isImageOnlyPlaceholder,
  isQuestionToolCall,
  isResumePrompt,
  isUsageLimitError,
  isUserMessageEntry,
  messageReceipt,
  noteLine,
  readSlashCommand,
  readUsageLimitNotice,
  stretchFace,
  stretchIncidents,
  stretchNotes,
  summarizeActivity,
  timelineEntryEnd,
  type BrowserStripModel,
  type ConversationTurn,
  type IncidentModel,
  type MessageEntry,
  type OutcomeModel,
  type SlashCommand,
  type Stretch,
  type WorkLineFace,
} from "./conversation.logic";

export type TimelineLatestTurn = Pick<
  OrchestrationLatestTurn,
  "turnId" | "state" | "startedAt" | "completedAt"
>;

const TIMELINE_MINIMAP_ITEM_SPACING = 8;
export const TIMELINE_MINIMAP_MIN_ITEMS = 2;
const TIMELINE_MINIMAP_MAX_HEIGHT_CSS = "calc(100vh - 18rem)";
const TIMELINE_CONTENT_MAX_WIDTH = 768;
const TIMELINE_MINIMAP_PERSISTENT_GUTTER = 48;

export function workEntryIsVisibleInGroup(
  entry: WorkLogEntry,
  expandedToolGroupEntry = false,
): boolean {
  return (
    (expandedToolGroupEntry &&
      (entry.toolLifecycleStatus === "inProgress" ||
        entry.sourceActivityKind === "task.progress")) ||
    !workEntryIndicatesToolNeutralStatus(entry)
  );
}

export interface TimelineEndState {
  readonly isAtEnd?: boolean;
  readonly contentLength?: number;
  readonly scroll?: number;
  readonly scrollLength?: number;
}

/**
 * Follow re-arm band above the hard bottom. Strict on purpose: LegendList's
 * isNearEnd fires within half a viewport, which re-armed live-follow while the
 * user was reading history and yanked them back down on the next stream chunk.
 * A small pixel band (instead of the 1px isAtEnd epsilon alone) keeps re-arming
 * reliable while streaming content is still growing under the viewport.
 */
const TIMELINE_FOLLOW_REARM_THRESHOLD_PX = 40;

export function resolveTimelineIsAtEnd(
  state: TimelineEndState | undefined,
  endInset = 0,
): boolean | undefined {
  if (!state) {
    return undefined;
  }
  if (state.isAtEnd) {
    return true;
  }
  const { contentLength, scroll, scrollLength } = state;
  if (contentLength === undefined || scroll === undefined || scrollLength === undefined) {
    return state.isAtEnd;
  }
  // contentLength includes the end inset (composer overlay), so subtract it to
  // measure the distance to the real content bottom.
  return contentLength - scroll - scrollLength - endInset <= TIMELINE_FOLLOW_REARM_THRESHOLD_PX;
}

export function shouldPreserveAssistantLineBreaks(text: string): boolean {
  return /^★ Insight(?:\s|─)/mu.test(text);
}

export function resolveTimelineMinimapHeightStyle(itemCount: number): string {
  const naturalHeight = Math.max(1, (itemCount - 1) * TIMELINE_MINIMAP_ITEM_SPACING);
  return `min(${naturalHeight}px, ${TIMELINE_MINIMAP_MAX_HEIGHT_CSS})`;
}

export function resolveTimelineMinimapTopPercent(index: number, itemCount: number): number {
  if (itemCount <= 1) {
    return 0;
  }
  return (Math.max(0, Math.min(index, itemCount - 1)) / (itemCount - 1)) * 100;
}

export function resolveTimelineMinimapIndexFromPointer(input: {
  readonly itemCount: number;
  readonly railTop: number;
  readonly railHeight: number;
  readonly pointerY: number;
}): number | null {
  if (input.itemCount <= 0 || input.railHeight <= 0) {
    return null;
  }
  if (input.itemCount === 1) {
    return 0;
  }

  const progress = Math.max(0, Math.min(1, (input.pointerY - input.railTop) / input.railHeight));
  return Math.max(0, Math.min(input.itemCount - 1, Math.round(progress * (input.itemCount - 1))));
}

export function resolveTimelineMinimapCurrentIndex(input: {
  readonly scrollTop: number;
  readonly scrollBottom: number;
  readonly itemBounds: ReadonlyArray<{
    readonly top: number | null;
    readonly height: number | null;
  }>;
}): number | null {
  let precedingIndex: number | null = null;

  for (const [index, item] of input.itemBounds.entries()) {
    if (item.top === null) {
      continue;
    }
    const inView =
      item.top < input.scrollBottom && item.top + Math.max(1, item.height ?? 1) > input.scrollTop;
    if (inView) {
      // The first visible marker is the turn at the reader's current position.
      return index;
    }
    if (item.top <= input.scrollTop) {
      precedingIndex = index;
    }
  }

  return precedingIndex;
}

export function resolveTimelineMinimapHasPersistentGutter(viewportWidth: number): boolean {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) {
    return false;
  }

  const contentWidth = Math.min(viewportWidth, TIMELINE_CONTENT_MAX_WIDTH);
  const sideGutter = Math.max(0, (viewportWidth - contentWidth) / 2);
  return sideGutter >= TIMELINE_MINIMAP_PERSISTENT_GUTTER;
}

const TIMELINE_MINIMAP_HIT_STRIP_LEFT = 12;
const TIMELINE_MINIMAP_HIT_STRIP_MAX_WIDTH = 40;
const TIMELINE_MINIMAP_EXPANDED_HIT_STRIP_WIDTH = "22rem";

/**
 * The minimap overlays the viewport's left edge while the content column is
 * centered, so the side gutter between them shrinks under browser zoom or a
 * narrow pane. A fixed-width hover strip would then sit on top of the message
 * text and swallow its pointer events. Cap the strip's width so it never
 * extends past the gutter into the content column; 0 disables the strip.
 */
export function resolveTimelineMinimapHitStripWidth(viewportWidth: number): number {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) {
    return 0;
  }

  const contentWidth = Math.min(viewportWidth, TIMELINE_CONTENT_MAX_WIDTH);
  const sideGutter = Math.max(0, (viewportWidth - contentWidth) / 2);
  return Math.max(
    0,
    Math.min(
      TIMELINE_MINIMAP_HIT_STRIP_MAX_WIDTH,
      Math.floor(sideGutter) - TIMELINE_MINIMAP_HIT_STRIP_LEFT,
    ),
  );
}

/**
 * Once the preview is open, keep the full preview and the space leading to it
 * interactive. The collapsed strip remains gutter-capped so it cannot block
 * selecting message text.
 */
export function resolveTimelineMinimapInteractiveWidth(
  collapsedWidth: number,
  expanded: boolean,
): number | string {
  return expanded ? TIMELINE_MINIMAP_EXPANDED_HIT_STRIP_WIDTH : collapsedWidth;
}

export function normalizeCompactToolLabel(value: string): string {
  return value.replace(/\s+(?:complete|completed)\s*$/i, "").trim();
}

type ToolGroupAction = "read" | "edit" | "command" | "code-search" | "search" | "other";

export function workLogEntryIsLocalCodeSearch(entry: WorkLogEntry): boolean {
  return (
    entry.itemType === "web_search" &&
    /\bgrep\b/i.test(normalizeCompactToolLabel(entry.toolTitle ?? entry.label))
  );
}

export function toolGroupAction(entry: WorkLogEntry): ToolGroupAction {
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
  if (workLogEntryIsLocalCodeSearch(entry)) return "code-search";
  if (entry.itemType === "web_search") return "search";
  return "other";
}

function toolGroupActionCount(
  action: ToolGroupAction,
  entries: ReadonlyArray<WorkLogEntry>,
): number {
  if (action !== "edit") return entries.length;

  const changedFiles = new Set<string>();
  let editsWithoutFileDetails = 0;
  for (const entry of entries) {
    if (!entry.changedFiles || entry.changedFiles.length === 0) {
      editsWithoutFileDetails += 1;
      continue;
    }
    for (const file of entry.changedFiles) changedFiles.add(file);
  }
  return changedFiles.size + editsWithoutFileDetails;
}

function toolGroupActionLabel(action: ToolGroupAction, count: number): string {
  switch (action) {
    case "read":
      return `Read ${count} ${count === 1 ? "file" : "files"}`;
    case "edit":
      return `Changed ${count} ${count === 1 ? "file" : "files"}`;
    case "command":
      return `Ran ${count} ${count === 1 ? "command" : "commands"}`;
    case "search":
      return `Searched the web ${count} ${count === 1 ? "time" : "times"}`;
    case "code-search":
      return `Searched code ${count} ${count === 1 ? "time" : "times"}`;
    case "other":
      return `Used ${count} ${count === 1 ? "tool" : "tools"}`;
  }
}

/** Immediate, provider-neutral fallback while generated tool summaries are disabled or unavailable. */
export function summarizeToolGroup(entries: ReadonlyArray<WorkLogEntry>): string {
  const summaryEntries = omitSupersededLifecycleMarkers(entries, (entry) => entry);
  const groupedEntries = new Map<ToolGroupAction, WorkLogEntry[]>();
  for (const entry of summaryEntries) {
    const action = toolGroupAction(entry);
    const group = groupedEntries.get(action);
    if (group) group.push(entry);
    else groupedEntries.set(action, [entry]);
  }
  const labels = [...groupedEntries].map(([action, actionEntries]) =>
    toolGroupActionLabel(action, toolGroupActionCount(action, actionEntries)),
  );
  const sentenceLabels = labels.map((label, index) =>
    index === 0 ? label : label.charAt(0).toLowerCase() + label.slice(1),
  );
  if (sentenceLabels.length < 2) return sentenceLabels[0] ?? "";
  if (sentenceLabels.length === 2) return sentenceLabels.join(" and ");
  return `${sentenceLabels.slice(0, -1).join(", ")}, and ${sentenceLabels.at(-1)}`;
}

export function omitSupersededLifecycleMarkers<T>(
  entries: readonly T[],
  workEntryFor: (entry: T) => WorkLogEntry,
): T[] {
  const laterTerminalIdentities = new Set<string>();
  const reversedEntries: T[] = [];

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    const workEntry = workEntryFor(entry);
    const normalizedLabel = normalizeCompactToolLabel(workEntry.toolTitle ?? workEntry.label);
    const identity = [
      workEntry.turnId ?? "no-turn",
      workEntry.itemType ?? "",
      normalizedLabel,
    ].join("\u001f");
    const isStatuslessIdlessMarker =
      workEntry.toolCallId === undefined &&
      workEntry.toolLifecycleStatus === undefined &&
      (workEntry.sourceActivityKind === "tool.started" ||
        workEntry.sourceActivityKind === "tool.updated");
    if (isStatuslessIdlessMarker && laterTerminalIdentities.has(identity)) continue;

    reversedEntries.push(entry);
    if (
      workEntry.sourceActivityKind === "tool.completed" ||
      (workEntry.toolLifecycleStatus !== undefined &&
        workEntry.toolLifecycleStatus !== "inProgress")
    ) {
      laterTerminalIdentities.add(identity);
    }
  }

  return reversedEntries.toReversed();
}

export function resolveAssistantMessageCopyState({
  text,
  showCopyButton,
  streaming,
}: {
  text: string | null;
  showCopyButton: boolean;
  streaming: boolean;
}) {
  const hasText = text !== null && text.trim().length > 0;
  return {
    text: hasText ? text : null,
    visible: showCopyButton && hasText && !streaming,
  };
}

// ---------------------------------------------------------------------------
// Rows — the conversation as the list draws it
// ---------------------------------------------------------------------------

/** What the Mate's hands are on right now, beside its face while it works. */
export type TurnHeaderActivity =
  | { readonly kind: "thinking" }
  /** It asked the person something and waits for the answer. */
  | { readonly kind: "waiting" }
  | { readonly kind: "tool"; readonly entry: WorkLogEntry }
  | { readonly kind: "operation"; readonly operation: ZeropsOperation };

export type ConversationEvent =
  | { readonly type: "landed"; readonly event: ChangeLandedEvent }
  | { readonly type: "compaction"; readonly label: string }
  | { readonly type: "command"; readonly command: SlashCommand; readonly done: boolean }
  /** The server resumed the thread itself after a usage limit reset. */
  | { readonly type: "resumed" };

type MessagesTimelineRowBody =
  | {
      /** The person's message, or the Mate's answer to a settled turn. */
      kind: "message";
      id: string;
      createdAt: string;
      message: ChatMessage;
      /** User messages: whether the Mate has read it. */
      receipt: "sent" | "seen" | null;
      /** User messages sent into a running turn. */
      aside: boolean;
      /** The client's own placeholder stands in for the text: show the images alone. */
      imageOnly: boolean;
      showAssistantMeta: boolean;
      revertTurnCount?: number | undefined;
    }
  | {
      /**
       * One line per stretch of work, after the message that started it:
       * "Working 4m · the latest note" while live, "Worked 4m · the last note
       * you saw · 12 notes" once frozen. Its height never changes.
       */
      kind: "work-line";
      id: string;
      createdAt: string;
      stretchKey: string;
      turnId: TurnId | null;
      live: boolean;
      face: WorkLineFace;
      startedAt: string;
      endedAt: string | null;
      /** The latest note (live) or the last one the person saw (frozen), one line. */
      note: string | null;
      /** What stands in for a note when the stretch had none. */
      fallback: string | null;
      /** What its calls came to, in words ("Read 4 files · ran 2 commands"); null when it made none. */
      summary: string | null;
      noteCount: number;
      /** The stretch has a log to open. */
      hasLog: boolean;
      open: boolean;
    }
  | {
      /**
       * The Mate at work, at the live stretch's tail — the one place what is
       * happening now is shown: its words streaming beside its face, the
       * newest in full and the steps that failed on the way among them; a
       * status bar for each thing running (deploys, helpers, tasks, a service
       * in trouble); and the browser while it checks. It is the conversation's
       * bottom, so it may change; settling turns it into the turn's report.
       */
      kind: "working";
      id: string;
      createdAt: string;
      stretchKey: string;
      turnKey: string;
      stream: ReadonlyArray<WorkingStreamItem>;
      /** What its hands are on right now; null while it writes. */
      activity: TurnHeaderActivity | null;
      /** Its answer streams under the card: the panel says nothing of its own. */
      answering: boolean;
      strip: BrowserStripModel | null;
      incidents: ReadonlyArray<IncidentModel>;
    }
  | {
      /**
       * Work that outlived the turn — a helper still at it, a watch loop: the
       * Mate at work stays at the conversation's bottom, smaller, with a way
       * to stop it, until the work ends.
       */
      kind: "after-work";
      id: string;
      createdAt: string;
      state: "working" | "monitoring";
    }
  | {
      /**
       * The Mate's words the person answered: the last note of a stretch the
       * person's message closed, frozen beside its face where it was said. A
       * stretch that ends in an answer has none — the answer is the Mate's
       * last word.
       */
      kind: "speech";
      id: string;
      createdAt: string;
      message: ChatMessage;
    }
  | {
      /**
       * A question the Mate asked with its question tool and the person's
       * answer: the question in the Mate's words, on its side, and the
       * answer in theirs, on theirs.
       */
      kind: "answer";
      id: string;
      createdAt: string;
      pairs: ReadonlyArray<{
        readonly key: string;
        readonly question: string;
        readonly answer: string;
      }>;
    }
  | {
      /** A progress note in an opened log: the Mate's words on the way, in full. */
      kind: "log-note";
      id: string;
      createdAt: string;
      message: ChatMessage;
    }
  | {
      /** The tool calls between two notes, as one line; opened, each call below it. */
      kind: "log-activity";
      id: string;
      createdAt: string;
      entries: ReadonlyArray<WorkLogEntry>;
      summary: string;
      failed: boolean;
      expanded: boolean;
    }
  | {
      /** Thinking in an opened log, in order with the rest of what the stretch did. */
      kind: "log-reasoning";
      id: string;
      createdAt: string;
      messages: ReadonlyArray<ChatMessage>;
      live: boolean;
    }
  | {
      /** A platform operation in an opened log: one line, the full card one click away. */
      kind: "log-operation";
      id: string;
      createdAt: string;
      operation: ZeropsOperation;
      expanded: boolean;
    }
  | {
      kind: "work";
      id: string;
      createdAt: string;
      groupedEntries: WorkLogEntry[];
      isExpandedToolGroupEntry: boolean;
    }
  | {
      /** A full operation card: a failure, or one the person opened from the log. */
      kind: "operation";
      id: string;
      createdAt: string;
      operation: ZeropsOperation;
    }
  | {
      /** One strip per stretch for its browser checks: a live stage and a frame per take. */
      kind: "strip";
      id: string;
      createdAt: string;
      strip: BrowserStripModel;
    }
  | {
      /** A service that stopped answering, told as one line rewritten in place. */
      kind: "incident";
      id: string;
      createdAt: string;
      incident: IncidentModel;
    }
  | { kind: "event"; id: string; createdAt: string; event: ConversationEvent }
  | {
      /** The bottom edge of a stretch's card: nothing but the frame closing. */
      kind: "card-end";
      id: string;
      createdAt: string;
    }
  | {
      /**
       * Background work as one quiet line: work that finished outside any
       * turn, or the helpers and tasks whose results woke the run under it.
       */
      kind: "background";
      id: string;
      createdAt: string;
      entries: ReadonlyArray<WorkLogEntry>;
      /** How many tasks — a task that reported twice is still one. */
      tasks: number;
      failed: number;
      /** Every task a helper's: said as helpers, not as background tasks. */
      helpers: boolean;
      /** The latest task's, in the words it was given. */
      title: string | null;
      expanded: boolean;
    }
  | {
      /** Something stopped the Mate: an error it could not work past. */
      kind: "error";
      id: string;
      createdAt: string;
      entry: WorkLogEntry;
    }
  | {
      /** A usage limit: one pause, however many attempts ran into it. */
      kind: "pause";
      id: string;
      createdAt: string;
      resetsAt: string | null;
      /** When the Mate picked up again, once it has. */
      resumedAt: string | null;
      /** Attempts the same limit refused after this one. */
      held: number;
    }
  | { kind: "outcome"; id: string; createdAt: string; outcome: OutcomeModel }
  | {
      /** A quiet line where a day begins, or where the conversation went quiet for a while. */
      kind: "seam";
      id: string;
      createdAt: string;
      /** A new day, a long quiet stretch, or where the person left off last time. */
      seam: "day" | "gap" | "new";
    }
  | { kind: "proposed-plan"; id: string; createdAt: string; proposedPlan: ProposedPlan }
  | { kind: "turn-plan"; id: string; createdAt: string; turnPlan: TurnPlanEntry }
  | {
      kind: "queued-message";
      id: string;
      createdAt: string;
      queuedMessage: QueuedComposerMessage;
      /** Oldest queued message, the one the next boundary sends. */
      isNext: boolean;
    };

/**
 * How much room a row keeps above itself — the conversation's rhythm, read
 * from the row before it: a person's messages in a run sit close, a turn's
 * parts follow each other at a line's distance, and a new turn opens with
 * air. A row's gap depends only on its predecessor, so it never changes
 * once both are on screen (opening a log changes the row after it — a click
 * moves what is under it, nothing else does).
 */
export type RowGap = "none" | "tight" | "line" | "block" | "turn";

/**
 * Where a row sits in its stretch's card — the one frame a stretch of work
 * is drawn in, once it holds anything: its line is the card's top; the log,
 * the Mate at work, the words the person answered and the report its body; a
 * `card-end` row its bottom. A line with nothing under it stands alone. The answer and the person's messages stand outside it. The bottom
 * is a row of its own so no row of the body ever becomes the edge: a stretch
 * the person's message closes loses the Mate at work from under its log, and
 * the row above it must not change its frame. Rows no stretch drew have none.
 */
export type CardSlice = "top" | "middle" | "bottom";

export type MessagesTimelineRow = MessagesTimelineRowBody & {
  readonly gap?: RowGap;
  readonly card?: CardSlice;
};

function isLogRowBody(row: MessagesTimelineRow): boolean {
  switch (row.kind) {
    case "log-note":
    case "log-activity":
    case "log-reasoning":
    case "log-operation":
      return true;
    case "work":
      return row.isExpandedToolGroupEntry || row.id.startsWith("log-entry:");
    default:
      return false;
  }
}

function isPersonRow(row: MessagesTimelineRow): boolean {
  return (
    (row.kind === "message" && row.message.role === "user") ||
    row.kind === "queued-message" ||
    row.kind === "answer"
  );
}

function closesTurn(row: MessagesTimelineRow): boolean {
  return (row.kind === "message" && row.message.role === "assistant") || row.kind === "outcome";
}

/** The Mate talking to the person: its line of copy and time keeps room under it already. */
function isMateProse(row: MessagesTimelineRow): boolean {
  return (row.kind === "message" && row.message.role === "assistant") || row.kind === "speech";
}

export function rowGap(
  previous: MessagesTimelineRow | undefined,
  row: MessagesTimelineRow,
): RowGap {
  if (previous === undefined) return "none";
  if (isLogRowBody(row)) return "tight";
  if (row.kind === "seam") return "turn";
  if (previous.kind === "seam") return "block";
  if (isPersonRow(row)) {
    if (isPersonRow(previous)) return "tight";
    if (isMateProse(previous)) return "block";
    return closesTurn(previous) ||
      previous.kind === "event" ||
      previous.kind === "error" ||
      previous.kind === "pause" ||
      previous.kind === "background"
      ? "turn"
      : "block";
  }
  if (closesTurn(previous)) {
    if (row.kind === "outcome") return "line";
    if (isMateProse(previous)) return "block";
    return row.kind === "work-line" ? "turn" : "block";
  }
  // The report hangs from its line: they read as one.
  if (row.kind === "outcome" && previous.kind === "work-line") return "tight";
  return "line";
}

export interface StableMessagesTimelineRowsState {
  byId: Map<string, MessagesTimelineRow>;
  result: MessagesTimelineRow[];
}

export interface ConversationView {
  /** Work lines the person opened, by stretch key. */
  readonly openStretchKeys?: ReadonlySet<string>;
  /** Log lines the person opened (activity lines, operations), by row id. */
  readonly expandedIds?: ReadonlySet<string>;
}

/** Match each user message to the next assistant checkpoint. */
function buildRevertTurnCountByUserMessageId(input: {
  supportsConversationRollback: boolean;
  timelineEntries: ReadonlyArray<TimelineEntry>;
  turnDiffSummaryByAssistantMessageId: ReadonlyMap<MessageId, TurnDiffSummary>;
  inferredCheckpointTurnCountByTurnId: Readonly<Record<string, number | undefined>>;
}): Map<MessageId, number> {
  const byUserMessageId = new Map<MessageId, number>();
  const entryCount = input.supportsConversationRollback ? input.timelineEntries.length : 0;
  for (let index = 0; index < entryCount; index += 1) {
    const entry = input.timelineEntries[index];
    if (!entry || entry.kind !== "message" || entry.message.role !== "user") continue;
    for (let nextIndex = index + 1; nextIndex < input.timelineEntries.length; nextIndex += 1) {
      const nextEntry = input.timelineEntries[nextIndex];
      if (!nextEntry || nextEntry.kind !== "message") continue;
      if (nextEntry.message.role === "user") break;
      const summary = input.turnDiffSummaryByAssistantMessageId.get(nextEntry.message.id);
      if (!summary) continue;
      const turnCount =
        summary.checkpointTurnCount ?? input.inferredCheckpointTurnCountByTurnId[summary.turnId];
      if (typeof turnCount !== "number") break;
      byUserMessageId.set(entry.message.id, Math.max(0, turnCount - 1));
      break;
    }
  }
  return byUserMessageId;
}

/** The question the Mate asked and the person has not answered yet, if one waits. */
function pendingQuestion(stretch: Stretch): Extract<TimelineEntry, { kind: "work" }> | null {
  const asked = stretch.entries.findLast(
    (entry): entry is Extract<TimelineEntry, { kind: "work" }> =>
      entry.kind === "work" && entry.entry.inputQuestions !== undefined,
  );
  if (asked === undefined) return null;
  const answered = stretch.entries.some(
    (entry) =>
      entry.kind === "work" &&
      entry.entry.inputAnswers !== undefined &&
      (asked.entry.inputRequestId === undefined ||
        entry.entry.inputRequestId === asked.entry.inputRequestId),
  );
  return answered ? null : asked;
}

/** What the Mate's hands are on: waiting for an answer, the running operation or tool, thinking. */
function liveActivity(stretch: Stretch): TurnHeaderActivity | null {
  if (pendingQuestion(stretch) !== null) return { kind: "waiting" };
  for (let index = stretch.entries.length - 1; index >= 0; index -= 1) {
    const entry = stretch.entries[index]!;
    if (entry.kind === "operation" && entry.operation.phase === "running") {
      return { kind: "operation", operation: entry.operation };
    }
    if (
      (entry.kind === "work" || entry.kind === "generic-call") &&
      entry.entry.toolLifecycleStatus === "inProgress" &&
      isActivityWork(entry.entry)
    ) {
      return isQuestionToolCall(entry.entry)
        ? { kind: "waiting" }
        : { kind: "tool", entry: entry.entry };
    }
    if (entry.kind === "message") {
      return entry.message.role === "reasoning" ? { kind: "thinking" } : null;
    }
  }
  return stretch.entries.length === 0 ? { kind: "thinking" } : null;
}

type StretchItem = {
  readonly at: string;
  readonly order: number;
  readonly rows: MessagesTimelineRow[];
};

/**
 * What stopped the turn and stands outside the log: a runtime error, a denied
 * tool, a setup script or a revert that failed. A background task that failed
 * (a type check, a test run) is a step on the way — it stays in the log.
 */
function isErrorEntry(entry: TimelineEntry): boolean {
  return (
    entry.kind === "work" &&
    entry.entry.tone === "error" &&
    entry.entry.questionAnswer === undefined &&
    !isTaskActivityKind(entry.entry.sourceActivityKind)
  );
}

function isTaskActivityKind(kind: string | undefined): boolean {
  return kind !== undefined && kind.startsWith("task.");
}

/**
 * A failure the Mate hit on the way, as the live group marks it: in context,
 * never popping out of it. It says "came back" once a later attempt at the
 * same thing succeeded.
 */
export interface WorkingFailure {
  readonly subject: string | null;
  /** What failed, in words: "Unhealthy", "Re-run type checks failed". */
  readonly words: string;
  /** Once a later attempt at the same thing succeeded: "came back", "then passed". */
  readonly recovered: string | null;
}

/**
 * One thing in the Mate's stream while it works: what it thinks, its words, a
 * step that failed on the way, or the question it asked and waits on.
 */
export type WorkingStreamItem =
  | {
      readonly kind: "thought";
      readonly key: string;
      /** One paragraph of what it thinks. */
      readonly text: string;
      readonly createdAt: string;
      readonly streaming: boolean;
    }
  | { readonly kind: "note"; readonly key: string; readonly message: ChatMessage }
  | { readonly kind: "failure"; readonly key: string; readonly failure: WorkingFailure }
  | { readonly kind: "question"; readonly key: string; readonly questions: ReadonlyArray<string> };

/**
 * How much of a stretch's stream the Mate at work keeps to scroll back
 * through: every word of an ordinary stretch; a runaway one its latest.
 */
const STREAM_DEPTH = 60;

/**
 * What a live stretch streams, oldest first: the Mate's words, each step
 * that failed on the way where it failed — an operation (a verify, a
 * subdomain, a scale; a deploy carries its own state in its status bar, the
 * browser its own in its takes, a dev server in its incident) or a background
 * task — and, while the person's answer is awaited, the question it asked.
 */
/**
 * A thought's paragraphs, in order; a paragraph that is only a bold title
 * joins the one under it, so a title never stands as a bubble of its own.
 * Paragraphs only ever append as a thought streams, so their places are
 * stable keys.
 */
export function thoughtParagraphs(text: string): string[] {
  const paragraphs: string[] = [];
  let title: string | null = null;
  for (const block of text.split(/\n\s*\n/)) {
    const paragraph = block.trim();
    if (paragraph.length === 0) continue;
    if (/^\*\*[^*\n]+\*\*$/.test(paragraph)) {
      title = title === null ? paragraph : `${title}\n\n${paragraph}`;
      continue;
    }
    paragraphs.push(title === null ? paragraph : `${title}\n\n${paragraph}`);
    title = null;
  }
  if (title !== null) paragraphs.push(title);
  return paragraphs;
}

/**
 * The person's latest answer to a question the Mate asked in this stretch:
 * it stands in the card where it arrived, with the question over it, and the
 * Mate at work carries on under it.
 */
function latestAnswer(stretch: Stretch): TimelineEntry | null {
  return (
    stretch.entries.findLast(
      (entry) => entry.kind === "work" && entry.entry.inputAnswers !== undefined,
    ) ?? null
  );
}

function stretchStream(stretch: Stretch, answer: MessageEntry | null): WorkingStreamItem[] {
  const items: WorkingStreamItem[] = [];
  const answered = latestAnswer(stretch);
  const answeredAt = answered === null ? -1 : stretch.entries.indexOf(answered);
  stretch.entries.forEach((entry, index) => {
    // What came before the person's answer stands above it.
    if (index <= answeredAt) return;
    const later = stretch.entries.slice(index + 1);
    if (entry.kind === "message") {
      // The answer streams where it will stand, under the card.
      if (entry === answer || entry.message.text.trim().length === 0) return;
      // Most of a Mate's work is thinking: said nowhere else live, it was
      // minutes of dots (the owner, 2026-09-26: "why aren't there thoughts
      // reflected in the chat?").
      if (entry.message.role === "reasoning") {
        // A train of thought streams a paragraph at a time, each its own
        // bubble — the newest popping in, the one before drifting up — so a
        // long one never stands as one tower of text.
        const paragraphs = thoughtParagraphs(entry.message.text);
        paragraphs.forEach((text, index) => {
          items.push({
            kind: "thought",
            key: `${entry.id}:${index}`,
            text,
            createdAt: entry.createdAt,
            streaming: Boolean(entry.message.streaming) && index === paragraphs.length - 1,
          });
        });
      } else if (entry.message.role === "assistant") {
        items.push({ kind: "note", key: entry.id, message: entry.message });
      }
      return;
    }
    if (entry.kind === "operation") {
      const op = entry.operation;
      if (
        op.phase !== "failed" ||
        DOCKED_KINDS.has(op.kind) ||
        op.kind === "browser" ||
        op.kind === "devServer"
      ) {
        return;
      }
      items.push({
        kind: "failure",
        key: op.key,
        failure: {
          subject: op.subject,
          words: op.statusWord,
          recovered: later.some(
            (next) =>
              next.kind === "operation" &&
              next.operation.kind === op.kind &&
              next.operation.subject === op.subject &&
              next.operation.phase === "done",
          )
            ? "came back"
            : null,
        },
      });
      return;
    }
    if (
      entry.kind === "work" &&
      entry.entry.tone === "error" &&
      isTaskActivityKind(entry.entry.sourceActivityKind)
    ) {
      const label = entry.entry.label;
      items.push({
        kind: "failure",
        key: entry.id,
        failure: {
          subject: null,
          words: `${label} failed`,
          recovered: later.some(
            (next) =>
              next.kind === "work" &&
              next.entry.label === label &&
              next.entry.tone !== "error" &&
              isTaskActivityKind(next.entry.sourceActivityKind),
          )
            ? "then passed"
            : null,
        },
      });
    }
  });
  const question = pendingQuestion(stretch);
  if (question !== null) {
    items.push({
      kind: "question",
      key: `question:${question.id}`,
      questions: (question.entry.inputQuestions ?? []).map((asked) => asked.question),
    });
  }
  return items.slice(-STREAM_DEPTH);
}

/**
 * The rows a stretch draws below its line, each at the moment it appeared so
 * the stretch only ever grows at its bottom. Closed, only what stays visible:
 * the browser strip, an incident, a failure, an error, a landing, a
 * compaction, the person's answers to a question, a plan to approve. Opened,
 * the log interleaves with them: notes in full, tool calls as one line per
 * run, thinking, operations one line each.
 */
function stretchContentRows(input: {
  stretch: Stretch;
  answer: MessageEntry | null;
  open: boolean;
  view: ConversationView;
  pauseRow: MessagesTimelineRow | null;
}): MessagesTimelineRow[] {
  const { stretch, open, view } = input;
  const expanded = view.expandedIds ?? new Set<string>();
  const items: StretchItem[] = [];
  let order = 0;
  const push = (at: string, rows: MessagesTimelineRow[]) => {
    if (rows.length > 0) items.push({ at, order: order++, rows });
  };

  // A strip and an incident take their place where the entry that began them
  // sits, so a tie on the clock keeps the order things arrived in.
  const strip = browserStrip(stretch);
  const incidentsByKey = new Map(
    stretchIncidents(stretch).map((incident) => [incident.key, incident] as const),
  );

  let activity: WorkLogEntry[] = [];
  let activityStart: TimelineEntry | null = null;
  let reasoning: ChatMessage[] = [];
  let reasoningStart: TimelineEntry | null = null;
  const flushActivity = () => {
    if (activityStart === null) return;
    const entries = omitSupersededLifecycleMarkers(
      activity.filter((entry) => workEntryIsVisibleInGroup(entry, stretch.live)),
      (entry) => entry,
    );
    const start = activityStart;
    activity = [];
    activityStart = null;
    if (!open || entries.length === 0) return;
    const id = `log-activity:${start.id}`;
    const isExpanded = expanded.has(id);
    const last = entries.at(-1)!;
    push(start.createdAt, [
      {
        kind: "log-activity",
        id,
        createdAt: start.createdAt,
        entries,
        summary: summarizeActivity(entries),
        failed: workEntryDisplayIndicatesToolFailure(last),
        expanded: isExpanded,
      },
      ...(isExpanded
        ? entries.map((entry): MessagesTimelineRow => ({
            kind: "work",
            id: `log-entry:${entry.id}`,
            createdAt: entry.createdAt,
            groupedEntries: [entry],
            isExpandedToolGroupEntry: true,
          }))
        : []),
    ]);
  };
  const flushReasoning = () => {
    if (reasoningStart === null) return;
    const start = reasoningStart;
    const messages = reasoning;
    reasoning = [];
    reasoningStart = null;
    if (!open) return;
    push(start.createdAt, [
      {
        kind: "log-reasoning",
        id: `log-reasoning:${start.id}`,
        createdAt: start.createdAt,
        messages,
        live: stretch.live && messages.some((message) => message.streaming),
      },
    ]);
  };
  const flush = () => {
    flushReasoning();
    flushActivity();
  };

  for (const entry of stretch.entries) {
    if (entry === input.answer) continue;
    if (entry.kind === "message") {
      if (entry.message.role === "reasoning") {
        flushActivity();
        if (reasoningStart === null) reasoningStart = entry;
        reasoning.push(entry.message);
        continue;
      }
      flush();
      if (open && entry.message.text.trim().length > 0) {
        push(entry.createdAt, [
          {
            kind: "log-note",
            id: `log-note:${entry.id}`,
            createdAt: entry.createdAt,
            message: entry.message,
          },
        ]);
      }
      continue;
    }
    if ((entry.kind === "work" || entry.kind === "generic-call") && isActivityWork(entry.entry)) {
      flushReasoning();
      if (activityStart === null) activityStart = entry;
      activity.push(entry.entry);
      continue;
    }
    flush();
    switch (entry.kind) {
      case "operation": {
        const op = entry.operation;
        // The checks and a service's trouble belong to the work: live, the
        // working component shows them; settled, the outcome says what they
        // came to; opened, the log keeps them where they happened.
        if (open && strip !== null && op === strip.checks[0]) {
          push(op.anchorAt, [{ kind: "strip", id: strip.key, createdAt: op.anchorAt, strip }]);
        }
        const incident = incidentsByKey.get(`incident:${op.key}`);
        if (open && incident !== undefined) {
          push(incident.appearedAt, [
            { kind: "incident", id: incident.key, createdAt: incident.appearedAt, incident },
          ]);
        }
        if (op.kind === "browser") break;
        // A failed operation is a step like any other: one line in the log,
        // its card a click away. What a failure came to is the outcome's to
        // say, once the turn is done — a card that fails and then recovers
        // never stands under a closed line without its ending.
        if (open) {
          const id = `log-operation:${op.key}`;
          const isExpanded = expanded.has(id);
          push(entry.createdAt, [
            {
              kind: "log-operation",
              id,
              createdAt: entry.createdAt,
              operation: op,
              expanded: isExpanded,
            },
            ...(isExpanded
              ? [
                  {
                    kind: "operation" as const,
                    id: `card:${op.key}`,
                    createdAt: entry.createdAt,
                    operation: op,
                  },
                ]
              : []),
          ]);
        }
        break;
      }
      case "work": {
        const work = entry.entry;
        // What the Mate asked waits above the composer while it waits, and
        // stands over the person's answer once given: never a row of its own.
        if (work.inputQuestions !== undefined && work.inputAnswers === undefined) break;
        if (work.sourceActivityKind === "context-compaction") {
          push(entry.createdAt, [
            {
              kind: "event",
              id: `event:${entry.id}`,
              createdAt: entry.createdAt,
              event: { type: "compaction", label: work.label },
            },
          ]);
        } else if (isErrorEntry(entry)) {
          // A limit's error row is the pause's to tell, once.
          if (!isUsageLimitError(entry)) {
            push(entry.createdAt, [
              { kind: "error", id: entry.id, createdAt: entry.createdAt, entry: work },
            ]);
          }
        } else if (work.inputAnswers !== undefined) {
          // The person answered: their words stand in the conversation.
          const asked =
            stretch.entries
              .flatMap((candidate) =>
                candidate.kind === "work" &&
                candidate.entry.inputQuestions !== undefined &&
                (work.inputRequestId === undefined ||
                  candidate.entry.inputRequestId === work.inputRequestId)
                  ? [candidate.entry.inputQuestions]
                  : [],
              )
              .at(-1) ?? [];
          push(entry.createdAt, [
            {
              kind: "answer",
              id: `answer:${entry.id}`,
              createdAt: entry.createdAt,
              pairs: work.inputAnswers.map((answer) => {
                const question = asked.find(
                  (candidate) => candidate.id === answer.key || candidate.question === answer.key,
                );
                return {
                  key: answer.key,
                  question: question?.question ?? question?.header ?? answer.key,
                  answer: answer.answer,
                };
              }),
            },
          ]);
        } else if (work.questionAnswer !== undefined) {
          push(entry.createdAt, [
            {
              kind: "work",
              id: entry.id,
              createdAt: entry.createdAt,
              groupedEntries: [work],
              isExpandedToolGroupEntry: false,
            },
          ]);
        } else if (open) {
          push(entry.createdAt, [
            {
              kind: "work",
              id: entry.id,
              createdAt: entry.createdAt,
              groupedEntries: [work],
              isExpandedToolGroupEntry: false,
            },
          ]);
        }
        break;
      }
      case "change-landed":
        push(entry.createdAt, [
          {
            kind: "event",
            id: `event:${entry.id}`,
            createdAt: entry.createdAt,
            event: { type: "landed", event: entry.event },
          },
        ]);
        break;
      case "proposed-plan":
        push(entry.createdAt, [
          {
            kind: "proposed-plan",
            id: entry.id,
            createdAt: entry.createdAt,
            proposedPlan: entry.proposedPlan,
          },
        ]);
        break;
      case "turn-plan":
        if (open) {
          push(entry.createdAt, [
            {
              kind: "turn-plan",
              id: entry.id,
              createdAt: entry.createdAt,
              turnPlan: entry.turnPlan,
            },
          ]);
        }
        break;
      case "generic-call":
        if (open) {
          push(entry.createdAt, [
            {
              kind: "work",
              id: entry.id,
              createdAt: entry.createdAt,
              groupedEntries: [entry.entry],
              isExpandedToolGroupEntry: false,
            },
          ]);
        }
        break;
    }
  }
  flush();
  if (input.pauseRow) push(input.pauseRow.createdAt, [input.pauseRow]);

  return items
    .toSorted(
      (left, right) => Date.parse(left.at) - Date.parse(right.at) || left.order - right.order,
    )
    .flatMap((item) => item.rows);
}

/**
 * A run of background work, by task: a watch that reported three times and
 * then finished is one task, and it failed if its last word was a failure.
 */
function backgroundRunSummary(run: ReadonlyArray<WorkLogEntry>): {
  tasks: number;
  failed: number;
  helpers: boolean;
  title: string | null;
} {
  const lastByTask = new Map<string, WorkLogEntry>();
  for (const entry of run) lastByTask.set(entry.taskId ?? entry.id, entry);
  const last = run.at(-1);
  return {
    tasks: lastByTask.size,
    failed: [...lastByTask.values()].filter(workEntryDisplayIndicatesToolFailure).length,
    // A helper's task names the helper's role; a shell or a watch loop has none.
    helpers: run.length > 0 && run.every((entry) => entry.agentRole !== undefined),
    title: last === undefined ? null : normalizeCompactToolLabel(last.toolTitle ?? last.label),
  };
}

function localDayKey(iso: string): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const date = new Date(ms);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

/** A quiet stretch of the conversation this long draws its own seam. */
const IDLE_SEAM_MS = 30 * 60 * 1000;

export function deriveMessagesTimelineRows(
  input: {
    timelineEntries: ReadonlyArray<TimelineEntry>;
    latestTurn?: TimelineLatestTurn | null;
    runningTurnId?: TurnId | null;
    isWorking: boolean;
    activeTurnStartedAt: string | null;
    turnDiffSummaries: ReadonlyArray<TurnDiffSummary>;
    supportsConversationRollback: boolean;
    /** Messages sent during the running turn, rendered after the live rows. */
    queuedMessages?: ReadonlyArray<QueuedComposerMessage>;
    /** When the person last saw this conversation, if something came since. */
    newSince?: string | null;
    /** The server's word on work that outlived the turn, while it runs on. */
    afterTurnWork?: "working" | "monitoring" | null;
  } & ConversationView,
): MessagesTimelineRow[] {
  const entries = input.timelineEntries;
  const structure = deriveConversationStructure({
    timelineEntries: entries,
    latestTurn: input.latestTurn ?? null,
    runningTurnId: input.runningTurnId ?? null,
    isWorking: input.isWorking,
    activeTurnStartedAt: input.activeTurnStartedAt,
  });
  const turnByKey = new Map(structure.turns.map((turn) => [turn.key, turn]));

  const diffByTurnId = new Map<TurnId, TurnDiffSummary>();
  const diffByAssistantMessageId = new Map<MessageId, TurnDiffSummary>();
  for (const summary of input.turnDiffSummaries) {
    diffByTurnId.set(summary.turnId, summary);
    if (summary.assistantMessageId)
      diffByAssistantMessageId.set(summary.assistantMessageId, summary);
  }
  const revertTurnCountByUserMessageId = buildRevertTurnCountByUserMessageId({
    supportsConversationRollback: input.supportsConversationRollback,
    timelineEntries: entries,
    turnDiffSummaryByAssistantMessageId: diffByAssistantMessageId,
    inferredCheckpointTurnCountByTurnId: input.supportsConversationRollback
      ? inferCheckpointTurnCountByTurnId(input.turnDiffSummaries)
      : {},
  });

  // Usage limits: the first refusal draws the pause; the attempts after it
  // that did nothing else fold into it, until a turn does real work again.
  const pauseByTurnKey = new Map<
    string,
    { row: Extract<MessagesTimelineRow, { kind: "pause" }> }
  >();
  const foldedTurnKeys = new Set<string>();
  let openPause: Extract<MessagesTimelineRow, { kind: "pause" }> | null = null;
  const pauseRows: Array<Extract<MessagesTimelineRow, { kind: "pause" }>> = [];
  for (const turn of structure.turns) {
    if (turn.limit === null) {
      const didWork = turn.stretches.some((stretch) => stretch.entries.length > 0) || turn.live;
      if (openPause && didWork) {
        const index = pauseRows.indexOf(openPause);
        const resumed = { ...openPause, resumedAt: turn.stretches[0]?.startedAt ?? null };
        pauseRows[index] = resumed;
        for (const [key, value] of pauseByTurnKey)
          if (value.row === openPause) pauseByTurnKey.set(key, { row: resumed });
        openPause = null;
      }
      continue;
    }
    if (openPause && turn.limitOnly) {
      const index = pauseRows.indexOf(openPause);
      const grown: Extract<MessagesTimelineRow, { kind: "pause" }> = {
        ...openPause,
        held: openPause.held + 1,
        resetsAt: turn.limit.resetsAt ?? openPause.resetsAt,
      };
      pauseRows[index] = grown;
      for (const [key, value] of pauseByTurnKey)
        if (value.row === openPause) pauseByTurnKey.set(key, { row: grown });
      openPause = grown;
      if (turn.span.opener === null) foldedTurnKeys.add(turn.key);
      continue;
    }
    // The pause sits where the limit struck: its own error row, else the notice.
    const limitError = turn.stretches
      .flatMap((stretch) => stretch.entries)
      .findLast((entry) => isUsageLimitError(entry));
    const answerAt =
      limitError?.createdAt ?? turn.answer?.createdAt ?? turn.stretches.at(-1)!.startedAt;
    const row: Extract<MessagesTimelineRow, { kind: "pause" }> = {
      kind: "pause",
      id: `pause:${turn.key}`,
      createdAt: answerAt,
      resetsAt: turn.limit.resetsAt,
      resumedAt: null,
      held: 0,
    };
    pauseRows.push(row);
    pauseByTurnKey.set(turn.key, { row });
    openPause = row;
  }

  const landedByTurnKey = new Map<
    string,
    Array<Extract<TimelineEntry, { kind: "change-landed" }>>
  >();
  for (const [index, entry] of entries.entries()) {
    if (entry.kind !== "change-landed") continue;
    const stretch = structure.stretchByIndex.get(index);
    if (!stretch) continue;
    const list = landedByTurnKey.get(stretch.turnKey);
    if (list) list.push(entry);
    else landedByTurnKey.set(stretch.turnKey, [entry]);
  }

  const rows: MessagesTimelineRow[] = [];
  let lastDay: string | null = null;
  let lastEnd: string | null = null;
  const newSinceMs = input.newSince ? Date.parse(input.newSince) : NaN;
  let newSinceDrawn = !Number.isFinite(newSinceMs);
  const seamBefore = (at: string, id: string) => {
    const day = localDayKey(at);
    const atMs = Date.parse(at);
    if (day !== null && day !== lastDay) {
      rows.push({ kind: "seam", id: `seam:day:${day}`, createdAt: at, seam: "day" });
      lastDay = day;
    } else {
      const endMs = lastEnd === null ? NaN : Date.parse(lastEnd);
      if (Number.isFinite(endMs) && Number.isFinite(atMs) && atMs - endMs > IDLE_SEAM_MS) {
        rows.push({ kind: "seam", id: `seam:gap:${id}`, createdAt: at, seam: "gap" });
      }
    }
    if (!newSinceDrawn && Number.isFinite(atMs) && atMs > newSinceMs) {
      rows.push({ kind: "seam", id: "seam:new", createdAt: input.newSince!, seam: "new" });
      newSinceDrawn = true;
    }
  };
  const personRow = (entry: MessageEntry, index: number, aside: boolean): MessagesTimelineRow => {
    if (isResumePrompt(entry.message.text)) {
      return {
        kind: "event",
        id: entry.id,
        createdAt: entry.createdAt,
        event: { type: "resumed" },
      };
    }
    const command = readSlashCommand(entry.message.text);
    if (command !== null && (entry.message.attachments?.length ?? 0) === 0) {
      const stretch = structure.stretchByIndex.get(index);
      return {
        kind: "event",
        id: entry.id,
        createdAt: entry.createdAt,
        // A command no turn owns ran without one and is over.
        event: {
          type: "command",
          command,
          done:
            stretch === undefined ||
            !stretch.live ||
            stretch.entries.some(
              (candidate) =>
                candidate.kind === "work" &&
                candidate.entry.sourceActivityKind === "context-compaction",
            ),
        },
      };
    }
    return {
      kind: "message",
      id: entry.id,
      createdAt: entry.createdAt,
      message: entry.message,
      receipt: messageReceipt(entry.message, structure, index),
      aside,
      imageOnly: isImageOnlyPlaceholder(entry.message.text),
      showAssistantMeta: false,
      revertTurnCount: revertTurnCountByUserMessageId.get(entry.message.id),
    };
  };

  const emitted = new Set<string>();
  // Each stretch's card, as the rows it drew: its line first.
  const cardRanges: Array<readonly [start: number, end: number]> = [];
  // Work no turn owns — background tasks finishing after their turn ended —
  // is gathered, a task that failed included, unless it is something to show
  // on its own: an error that stopped the Mate, an answer, a compaction.
  const isLooseActivity = (index: number) => {
    const candidate = entries[index];
    return (
      candidate !== undefined &&
      structure.looseIndexes.has(index) &&
      (candidate.kind === "work" || candidate.kind === "generic-call") &&
      (candidate.entry.tone !== "error" ||
        isTaskActivityKind(candidate.entry.sourceActivityKind)) &&
      candidate.entry.questionAnswer === undefined &&
      candidate.entry.sourceActivityKind !== "context-compaction"
    );
  };
  const expandedIds = input.expandedIds ?? new Set<string>();
  // Where each run's entries begin: the person's message, or its first entry.
  const firstIndexByTurn = new Map<string, number>();
  structure.stretchByIndex.forEach((stretch, index) => {
    const known = firstIndexByTurn.get(stretch.turnKey);
    if (known === undefined || index < known) firstIndexByTurn.set(stretch.turnKey, index);
  });
  const turnStartIndexes = new Set(firstIndexByTurn.values());
  /**
   * What woke a run nobody wrote to start: the helpers and background tasks
   * that finished since the run before it began, for a background result
   * wakes the Mate. None when work no turn owns stands right before the run:
   * that line says so already.
   */
  const wokeBy = (turn: ConversationTurn): WorkLogEntry[] => {
    const start = firstIndexByTurn.get(turn.key) ?? entries.length;
    if (isLooseActivity(start - 1)) return [];
    const finished: WorkLogEntry[] = [];
    for (let index = start - 1; index >= 0; index -= 1) {
      const entry = entries[index]!;
      if (turnStartIndexes.has(index) || isUserMessageEntry(entry)) break;
      if (entry.kind === "work" && entry.entry.sourceActivityKind === "task.completed")
        finished.unshift(entry.entry);
    }
    return finished;
  };
  /**
   * One run of the Mate as the conversation draws it — a turn, from the
   * person's message that started it to its answer — as one card, however
   * often the person wrote while it worked. A message sent into the run is
   * delivered at the Mate's next step and the run goes on: it stands inside
   * the card where it arrived, under the Mate's words just before it, and
   * the line keeps saying the Mate is working until the run ends (the owner,
   * 2026-09-26: a message queued mid-run split the work into "Juno worked
   * for 1m 4s" and a reply, as if the Mate had finished — "it needs to be
   * handled properly").
   */
  const emitTurn = (turn: ConversationTurn) => {
    if (foldedTurnKeys.has(turn.key)) return;
    const first = turn.stretches[0];
    const last = turn.stretches.at(-1);
    if (first === undefined || last === undefined) return;

    // Keyed by the message, as a loose message's seam is: the seam must not
    // change its identity when a turn claims the message it stands before.
    seamBefore(first.lead?.createdAt ?? first.startedAt, first.lead?.id ?? first.key);
    if (first.lead !== null && first.leadIndex !== null) {
      rows.push(personRow(first.lead, first.leadIndex, first.aside));
    } else {
      // A run nobody wrote to start opens with what woke it, where the
      // person's message would stand (Nova, 2026-09-26: a helper's review
      // came back, and the run it woke began with no word of why).
      const woke = wokeBy(turn);
      if (woke.length > 0) {
        const id = `woke:${first.key}`;
        const expanded = expandedIds.has(id);
        rows.push({
          kind: "background",
          id,
          createdAt: first.startedAt,
          entries: woke,
          ...backgroundRunSummary(woke),
          expanded,
        });
        if (expanded) {
          for (const work of woke) {
            rows.push({
              kind: "work",
              id: `woke-entry:${work.id}`,
              createdAt: work.createdAt,
              groupedEntries: [work],
              isExpandedToolGroupEntry: true,
            });
          }
        }
      }
    }

    // A /compact is its own event line: it says when the context is condensed,
    // so its run draws no work line and no second compaction line. What the
    // person sent while it ran is theirs all the same: it stands after the
    // line, and the run it started is drawn as any other.
    const leadCommand = first.lead ? readSlashCommand(first.lead.message.text) : null;
    if (leadCommand?.name === "compact") {
      lastEnd = first.endedAt ?? first.startedAt;
      const [, next, ...rest] = turn.stretches;
      if (next !== undefined)
        emitTurn({ ...turn, stretches: [{ ...next, aside: false }, ...rest] });
      return;
    }

    // An answer that is the limit's own notice is the pause's to tell.
    const answer =
      turn.answer !== null &&
      readUsageLimitNotice(turn.answer.message.text, turn.answer.message.createdAt) === null
        ? turn.answer
        : null;
    const notes = turn.stretches.flatMap((stretch) => stretchNotes(stretch, turn.answer));
    const lastNote = notes.at(-1) ?? null;
    const open = input.openStretchKeys?.has(first.key) ?? false;
    const pause = pauseByTurnKey.get(turn.key)?.row ?? null;
    const pausedHere = pause !== null || turn.limitOnly;
    const activityEntries = turn.stretches.flatMap((stretch) =>
      stretch.entries.flatMap((candidate) =>
        (candidate.kind === "work" || candidate.kind === "generic-call") &&
        isActivityWork(candidate.entry)
          ? [candidate.entry]
          : [],
      ),
    );
    const shownActivity = omitSupersededLifecycleMarkers(
      activityEntries.filter((candidate) => workEntryIsVisibleInGroup(candidate, turn.live)),
      (candidate) => candidate,
    );
    const summary = shownActivity.length > 0 ? summarizeActivity(shownActivity) : null;
    const hasLog = turn.stretches.some((stretch) =>
      stretch.entries.some(
        (candidate) =>
          candidate !== turn.answer &&
          candidate.kind !== "change-landed" &&
          !(
            candidate.kind === "message" &&
            candidate.message.role === "reasoning" &&
            candidate.message.text.trim().length === 0
          ),
      ),
    );
    // A settled run with nothing to open has nothing to say: the answer
    // stands under the message by itself. A live one always has its line, and
    // so does one the usage limit refused — the person's message is answered
    // by the reason.
    const cardStart = rows.length;
    if (turn.live || hasLog || pausedHere)
      rows.push({
        kind: "work-line",
        id: `work-line:${first.key}`,
        createdAt: first.startedAt,
        stretchKey: first.key,
        turnId: first.turnId,
        live: turn.live,
        face: stretchFace({ stretch: last, turn, pausedHere }),
        startedAt: first.startedAt,
        endedAt: last.endedAt,
        note: lastNote === null ? null : noteLine(lastNote.message.text),
        fallback: lastNote !== null ? null : pausedHere ? "Stopped by the usage limit" : summary,
        summary,
        noteCount: notes.length,
        hasLog,
        open,
      });

    turn.stretches.forEach((stretch, index) => {
      if (index > 0) {
        // What the person sent into the run, where it arrived, under the
        // Mate's words just before it — which an opened log says itself.
        const before = turn.stretches[index - 1]!;
        const said = stretchNotes(before, turn.answer).at(-1) ?? null;
        if (!open && said !== null) {
          rows.push({
            kind: "speech",
            id: `speech:${before.key}`,
            createdAt: said.createdAt,
            message: said.message,
          });
        }
        if (stretch.lead !== null && stretch.leadIndex !== null) {
          rows.push(personRow(stretch.lead, stretch.leadIndex, stretch.aside));
        }
      }
      rows.push(
        ...stretchContentRows({
          stretch,
          answer: turn.answer,
          open,
          view: input,
          pauseRow: stretch === last ? pause : null,
        }),
      );
    });

    if (last.live) {
      // Under the person's answer the Mate at work starts afresh: its own
      // panel, so the window of what it said before the question is gone.
      const answeredBy = latestAnswer(last);
      rows.push({
        kind: "working",
        id: answeredBy === null ? `working:${last.key}` : `working:${last.key}:${answeredBy.id}`,
        createdAt: last.startedAt,
        stretchKey: last.key,
        turnKey: turn.key,
        stream: stretchStream(last, turn.answer),
        activity: liveActivity(last),
        answering: answer !== null,
        strip: browserStrip(last),
        incidents: stretchIncidents(last),
      });
    }

    // Settled, the Mate at work becomes the run's report — the same pills,
    // where it was — and the Mate's answer follows it.
    if (!turn.live) {
      const outcome = deriveOutcome({
        turn,
        landed: landedByTurnKey.get(turn.key) ?? [],
        diff: turn.turnId === null ? null : (diffByTurnId.get(turn.turnId) ?? null),
      });
      if (outcome !== null) {
        rows.push({
          kind: "outcome",
          id: outcome.key,
          createdAt: turn.answer?.createdAt ?? last.endedAt ?? last.startedAt,
          outcome,
        });
      }
    }
    // The card closes before the answer: the Mate's last word stands on the
    // conversation's own edge, as the person's messages do. A line with
    // nothing under it is no card — a closed log of a run that came to no
    // report is one quiet line, not an empty box.
    if (rows[cardStart]?.kind === "work-line" && rows.length > cardStart + 1) {
      rows.push({
        kind: "card-end",
        id: `card-end:${first.key}`,
        createdAt: rows.at(-1)!.createdAt,
      });
      cardRanges.push([cardStart, rows.length]);
    }
    // A run that ended with no answer — stopped, interrupted — ends in its
    // last words, the Mate talking to the person as its answer would have:
    // after the card, in the answer's hand (the owner, 2026-09-26: "why all
    // of the sudden the mate reply has an avatar and background bubble?").
    // An opened log says them instead.
    const speech = !turn.live && answer === null && !open ? lastNote : null;
    if (speech !== null) {
      rows.push({
        kind: "speech",
        id: `speech:${last.key}`,
        createdAt: speech.createdAt,
        message: speech.message,
      });
    }
    // The answer follows the card, settled or still streaming.
    if (answer !== null) {
      rows.push({
        kind: "message",
        id: answer.id,
        createdAt: answer.createdAt,
        message: answer.message,
        receipt: null,
        aside: false,
        imageOnly: false,
        showAssistantMeta: !answer.message.streaming,
      });
    }
    lastEnd = last.endedAt ?? last.startedAt;
  };

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    if (isLooseActivity(index)) {
      // A run of background work no turn owns: one line, its tasks one click away.
      const run: WorkLogEntry[] = [];
      let cursor = index;
      while (isLooseActivity(cursor)) {
        run.push((entries[cursor] as Extract<TimelineEntry, { kind: "work" }>).entry);
        cursor += 1;
      }
      seamBefore(entry.createdAt, entry.id);
      const id = `background:${entry.id}`;
      const expanded = expandedIds.has(id);
      rows.push({
        kind: "background",
        id,
        createdAt: entry.createdAt,
        entries: run,
        ...backgroundRunSummary(run),
        expanded,
      });
      if (expanded) {
        for (const work of run) {
          rows.push({
            kind: "work",
            id: `log-entry:${work.id}`,
            createdAt: work.createdAt,
            groupedEntries: [work],
            isExpandedToolGroupEntry: true,
          });
        }
      }
      lastEnd = timelineEntryEnd(entries[cursor - 1]!);
      index = cursor - 1;
      continue;
    }
    if (structure.looseIndexes.has(index)) {
      seamBefore(entry.createdAt, entry.id);
      if (isUserMessageEntry(entry)) rows.push(personRow(entry, index, false));
      else if (entry.kind === "message" && entry.message.role === "assistant") {
        // A message no turn owns (a notice from before turns were recorded): the Mate's words all the same.
        rows.push({
          kind: "message",
          id: entry.id,
          createdAt: entry.createdAt,
          message: entry.message,
          receipt: null,
          aside: false,
          imageOnly: false,
          showAssistantMeta: !entry.message.streaming,
        });
      } else if (entry.kind === "change-landed") {
        rows.push({
          kind: "event",
          id: `event:${entry.id}`,
          createdAt: entry.createdAt,
          event: { type: "landed", event: entry.event },
        });
      } else if (entry.kind === "work" && isErrorEntry(entry)) {
        rows.push({ kind: "error", id: entry.id, createdAt: entry.createdAt, entry: entry.entry });
      } else if (entry.kind === "operation") {
        // An operation no turn owns has no line to open: its card is all there is.
        rows.push({
          kind: "operation",
          id: `card:${entry.operation.key}`,
          createdAt: entry.createdAt,
          operation: entry.operation,
        });
      } else if (entry.kind === "proposed-plan") {
        rows.push({
          kind: "proposed-plan",
          id: entry.id,
          createdAt: entry.createdAt,
          proposedPlan: entry.proposedPlan,
        });
      } else if (entry.kind === "work" || entry.kind === "generic-call") {
        rows.push({
          kind: "work",
          id: entry.id,
          createdAt: entry.createdAt,
          groupedEntries: [entry.entry],
          isExpandedToolGroupEntry: false,
        });
      }
      lastEnd = timelineEntryEnd(entry);
      continue;
    }
    const stretch = structure.stretchByIndex.get(index);
    if (stretch === undefined) continue;
    const turn = turnByKey.get(stretch.turnKey)!;
    if (emitted.has(turn.key)) continue;
    emitted.add(turn.key);
    emitTurn(turn);
  }
  // A live turn that has drawn nothing yet — one a finished background task
  // woke, before its first words — is the conversation's bottom all the same.
  for (const turn of structure.turns) {
    if (!turn.live || emitted.has(turn.key)) continue;
    emitted.add(turn.key);
    emitTurn(turn);
  }

  if (!input.isWorking && input.afterTurnWork) {
    rows.push({
      kind: "after-work",
      id: "after-work",
      createdAt: rows.at(-1)?.createdAt ?? "",
      state: input.afterTurnWork,
    });
  }
  input.queuedMessages?.forEach((queuedMessage, index) => {
    rows.push({
      kind: "queued-message",
      id: `queued-message:${queuedMessage.id}`,
      createdAt: queuedMessage.createdAt,
      queuedMessage,
      isNext: index === 0,
    });
  });
  const cards = new Map<number, CardSlice>();
  for (const [start, end] of cardRanges) {
    for (let index = start; index < end; index += 1) {
      cards.set(index, index === start ? "top" : index === end - 1 ? "bottom" : "middle");
    }
  }
  return rows.map((row, index) => {
    const card = cards.get(index);
    // A card's edge is not a row of the conversation: the row after it keeps
    // the room it kept after the card's last row.
    const previous = rows[index - 1]?.kind === "card-end" ? rows[index - 2] : rows[index - 1];
    return {
      ...row,
      gap: row.kind === "card-end" ? "none" : rowGap(previous, row),
      ...(card === undefined ? {} : { card }),
    };
  });
}

export function computeStableMessagesTimelineRows(
  rows: MessagesTimelineRow[],
  previous: StableMessagesTimelineRowsState,
): StableMessagesTimelineRowsState {
  const next = new Map<string, MessagesTimelineRow>();
  let anyChanged = rows.length !== previous.byId.size;

  const result = rows.map((row, index) => {
    const prevRow = previous.byId.get(row.id);
    const nextRow = prevRow && isRowUnchanged(prevRow, row) ? prevRow : row;
    next.set(row.id, nextRow);
    if (!anyChanged && previous.result[index] !== nextRow) {
      anyChanged = true;
    }
    return nextRow;
  });

  return anyChanged ? { byId: next, result } : previous;
}

/**
 * Whether a freshly derived row draws the same as the one already on screen,
 * so the list keeps the old object and the row does not re-render. Messages
 * compare by identity (a streamed message is a new object); everything the
 * derivation rebuilds compares by value.
 */
function isRowUnchanged(a: MessagesTimelineRow, b: MessagesTimelineRow): boolean {
  if (
    a.kind !== b.kind ||
    a.id !== b.id ||
    a.createdAt !== b.createdAt ||
    a.gap !== b.gap ||
    a.card !== b.card
  ) {
    return false;
  }
  switch (a.kind) {
    case "message": {
      const bm = b as typeof a;
      return (
        a.message === bm.message &&
        a.receipt === bm.receipt &&
        a.aside === bm.aside &&
        a.imageOnly === bm.imageOnly &&
        a.showAssistantMeta === bm.showAssistantMeta &&
        a.revertTurnCount === bm.revertTurnCount
      );
    }
    case "log-note":
      return a.message === (b as typeof a).message;
    case "speech":
      return a.message === (b as typeof a).message;
    case "log-reasoning": {
      const br = b as typeof a;
      return (
        a.live === br.live &&
        a.messages.length === br.messages.length &&
        a.messages.every((message, index) => message === br.messages[index])
      );
    }
    case "proposed-plan":
      return a.proposedPlan === (b as typeof a).proposedPlan;
    case "turn-plan":
      return a.turnPlan.plan === (b as typeof a).turnPlan.plan;
    case "queued-message": {
      const bq = b as typeof a;
      return a.queuedMessage === bq.queuedMessage && a.isNext === bq.isNext;
    }
    default:
      // The rest are rebuilt on every derive from fresh reads (operations,
      // work entries, landings): compare what they hold, not their identity.
      return Equal.equals(a, b);
  }
}
