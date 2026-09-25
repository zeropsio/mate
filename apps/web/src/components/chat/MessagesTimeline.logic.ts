import * as Equal from "effect/Equal";
import { shallow } from "zustand/vanilla/shallow";
import {
  formatDuration,
  inferCheckpointTurnCountByTurnId,
  isStreamingMessageTextUpdate,
  workEntryDisplayIndicatesToolFailure,
  workEntryIndicatesToolNeutralStatus,
  workLogEntryIsToolLike,
  type TimelineEntry,
  type TurnPlanEntry,
  type WorkLogEntry,
} from "../../session-logic";
import { type ChatMessage, type ProposedPlan, type TurnDiffSummary } from "../../types";
import type { QueuedComposerMessage } from "../../queuedMessageStore";
import {
  isReadOperationKind,
  operationTone,
  plural,
  type ZeropsOperation,
} from "@t3tools/client-runtime/zerops/model";
import type { ChangeLandedEvent } from "@t3tools/client-runtime/zerops";
import type { ServiceStatusToneId } from "@t3tools/shared/brand";
import { type MessageId, type OrchestrationLatestTurn, type TurnId } from "@t3tools/contracts";

export const MAX_VISIBLE_WORK_LOG_ENTRIES = 1;
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

function computeElapsedMs(startIso: string, endIso: string): number | null {
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, end - start);
}

function maxIsoTimestamp(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  const aMs = Date.parse(a);
  const bMs = Date.parse(b);
  if (!Number.isFinite(aMs)) return b;
  if (!Number.isFinite(bMs)) return a;
  return bMs > aMs ? b : a;
}

export interface TimelineDurationMessage {
  id: string;
  role: ChatMessage["role"];
  createdAt: string;
  updatedAt: string;
  streaming: boolean;
}

export type TimelineLatestTurn = Pick<
  OrchestrationLatestTurn,
  "turnId" | "state" | "startedAt" | "completedAt"
>;

/**
 * Thinking and the tool calls around it, as one row that tracks the latest
 * activity. A failed tool call stays inside; an error, a question answer, a
 * compaction or a subagent batch ends the run.
 */
export type ActivityEntry = Extract<TimelineEntry, { kind: "message" | "work" }>;

type ChangeLandedEntry = Extract<TimelineEntry, { kind: "change-landed" }>;

function isActivityEntry(entry: TimelineEntry): entry is ActivityEntry {
  return entry.kind === "message"
    ? entry.message.role === "reasoning"
    : entry.kind === "work" &&
        entry.entry.agentSpawn === undefined &&
        entry.entry.questionAnswer === undefined &&
        entry.entry.sourceActivityKind !== "context-compaction" &&
        entry.entry.tone !== "error";
}

export type TurnHeaderActivity =
  | { readonly kind: "thinking" }
  | { readonly kind: "tool"; readonly entry: WorkLogEntry }
  | { readonly kind: "operation"; readonly operation: ZeropsOperation };

/** One settled fact in a turn's tally: a status word and its tone (none for a plain count). */
export interface TurnTallyFact {
  readonly word: string;
  readonly tone: ServiceStatusToneId | null;
}

/** A service, an import, the browser checks, a landing or the asks — with its facts. */
export interface TurnTallyItem {
  readonly key: string;
  readonly subject: string | null;
  readonly facts: ReadonlyArray<TurnTallyFact>;
}

export type MessagesTimelineRow =
  | {
      kind: "activity-group";
      id: string;
      createdAt: string;
      turnId: TurnId;
      groupId: string;
      entries: ActivityEntry[];
      expanded: boolean;
      /** The live tail of the running turn: its label follows the latest activity. */
      active: boolean;
    }
  | {
      kind: "work";
      id: string;
      createdAt: string;
      groupedEntries: WorkLogEntry[];
      isExpandedToolGroupEntry: boolean;
      isLastExpandedToolGroupEntry: boolean;
    }
  | {
      kind: "work-live";
      id: string;
      createdAt: string;
      entry: WorkLogEntry;
      groupedEntries: WorkLogEntry[];
      groupId: string;
      expanded: boolean;
    }
  | {
      kind: "work-toggle";
      id: string;
      createdAt: string;
      groupId: string;
      hiddenCount: number;
      expanded: boolean;
      onlyToolEntries: boolean;
      summary: string | null;
      summaryKind: ToolGroupSummaryKind | null;
      hasFailure: boolean;
    }
  | {
      /**
       * One per turn, from the send until forever, directly after the
       * message that opened it: "Working · 12s" while live, "Worked for 1m"
       * once settled, with the fold control when the turn folds work away.
       */
      kind: "turn-header";
      id: string;
      createdAt: string;
      /** Null only between a send and the server creating the turn. */
      turnId: TurnId | null;
      state: "live" | "settled";
      /** Live: the clock's start. */
      liveSince: string | null;
      /** Live: what is happening now. */
      activity: TurnHeaderActivity | null;
      /** Settled: "Worked for 8.0s" / "You stopped after 3.0s". */
      label: string | null;
      /** Settled: when the turn ended. */
      endedAt: string | null;
      /** Settled turns that fold work away; the same entries fold as always. */
      fold: { readonly expanded: boolean } | null;
      /** What the turn did, both live and settled; grows only as facts settle. */
      tally: ReadonlyArray<TurnTallyItem>;
    }
  | {
      kind: "context-compaction";
      id: string;
      createdAt: string;
      label: string;
    }
  | {
      kind: "message";
      id: string;
      createdAt: string;
      message: ChatMessage;
      durationStart: string;
      /**
       * An assistant message that is not its turn's final answer: every one
       * while the turn runs (the answer is only known at settle), then all
       * but the last. It reads as narration — the same row, restyled in place.
       */
      narration: boolean;
      showAssistantMeta: boolean;
      showAssistantCopyButton: boolean;
      assistantCopyStreaming: boolean;
      assistantTurnDiffSummary?: TurnDiffSummary | undefined;
      revertTurnCount?: number | undefined;
    }
  | {
      kind: "proposed-plan";
      id: string;
      createdAt: string;
      proposedPlan: ProposedPlan;
    }
  | {
      kind: "turn-plan";
      id: string;
      createdAt: string;
      turnPlan: TurnPlanEntry;
    }
  | {
      kind: "operation";
      id: string;
      createdAt: string;
      operation: ZeropsOperation;
    }
  | {
      /** A Zerops call the model classified "generic" (never a card) — a work-like row, but never identity-merged with an adjacent "work" run. */
      kind: "generic-call";
      id: string;
      createdAt: string;
      entry: WorkLogEntry;
    }
  | {
      /** One of this Mate's changes landing — a fact about the forge, not about the agent. */
      kind: "change-landed";
      id: string;
      createdAt: string;
      event: ChangeLandedEvent;
    }
  | {
      kind: "queued-message";
      id: string;
      createdAt: string;
      queuedMessage: QueuedComposerMessage;
      /** Oldest queued message, the one the next boundary sends. */
      isNext: boolean;
    };

export interface StableMessagesTimelineRowsState {
  byId: Map<string, MessagesTimelineRow>;
  result: MessagesTimelineRow[];
}

export function computeMessageDurationStart(
  messages: ReadonlyArray<TimelineDurationMessage>,
): Map<string, string> {
  const result = new Map<string, string>();
  let lastBoundary: string | null = null;

  for (const message of messages) {
    if (message.role === "user") {
      lastBoundary = message.createdAt;
    }
    result.set(message.id, lastBoundary ?? message.createdAt);
    if (message.role === "assistant" && !message.streaming) {
      lastBoundary = message.updatedAt;
    }
  }

  return result;
}

export function normalizeCompactToolLabel(value: string): string {
  return value.replace(/\s+(?:complete|completed)\s*$/i, "").trim();
}

type ToolGroupAction = "read" | "edit" | "command" | "code-search" | "search" | "other";
type ToolGroupSummaryKind = ToolGroupAction | "dynamic-tool" | "agent-tool" | "tone-tool" | "mixed";

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

function toolGroupSummaryKind(entries: ReadonlyArray<WorkLogEntry>): ToolGroupSummaryKind {
  const actions = new Set(entries.map(toolGroupAction));
  if (actions.size !== 1) return "mixed";

  const action = actions.values().next().value!;
  if (action !== "other") return action;

  const fallbackKinds = new Set(
    entries.map((entry): ToolGroupSummaryKind => {
      if (entry.itemType === "mcp_tool_call") return "other";
      if (entry.itemType === "dynamic_tool_call") return "dynamic-tool";
      if (entry.itemType === "collab_agent_tool_call" || entry.taskId) return "agent-tool";
      if (entry.tone === "thinking") return "agent-tool";
      if (entry.tone === "tool") return "tone-tool";
      return "other";
    }),
  );
  return fallbackKinds.size === 1 ? fallbackKinds.values().next().value! : "mixed";
}

function workGroupIdentity(timelineEntryId: string, entry: WorkLogEntry): string {
  return entry.toolCallId
    ? `tool:${entry.turnId ?? "no-turn"}:${entry.toolCallId}`
    : timelineEntryId;
}

function workGroupId(timelineEntryId: string, entry: WorkLogEntry): string {
  return `work-group:${workGroupIdentity(timelineEntryId, entry)}`;
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

function deriveTerminalAssistantMessageIds(timelineEntries: ReadonlyArray<TimelineEntry>) {
  const lastAssistantMessageIdByResponseKey = new Map<string, string>();
  let nullTurnResponseIndex = 0;

  for (const timelineEntry of timelineEntries) {
    if (timelineEntry.kind !== "message") {
      continue;
    }
    const { message } = timelineEntry;
    if (message.role === "user") {
      nullTurnResponseIndex += 1;
      continue;
    }
    if (message.role !== "assistant") {
      continue;
    }

    const responseKey = message.turnId
      ? `turn:${message.turnId}`
      : `unkeyed:${nullTurnResponseIndex}`;
    lastAssistantMessageIdByResponseKey.set(responseKey, message.id);
  }

  return new Set(lastAssistantMessageIdByResponseKey.values());
}

/**
 * The session's running turn is authoritative when latestTurn briefly lags or
 * regresses behind it. Otherwise, the latest turn counts as unsettled while it
 * is still running (or has not recorded a completion). This is deliberately
 * keyed on turn lifecycle rather than transient working state: right after the
 * user sends a message, the previous turn is still the "active" one until the
 * server creates the new turn, and folding must not flicker through that window.
 */
function deriveUnsettledTurnId(
  latestTurn: TimelineLatestTurn | null,
  runningTurnId: TurnId | null,
): TurnId | null {
  if (runningTurnId !== null) {
    return runningTurnId;
  }
  if (!latestTurn) {
    return null;
  }
  const isSettled = latestTurn.completedAt !== null && latestTurn.state !== "running";
  return isSettled ? null : latestTurn.turnId;
}

function timelineEntryTurnId(entry: TimelineEntry): TurnId | null {
  if (entry.kind === "message") {
    return entry.message.role === "assistant" || entry.message.role === "reasoning"
      ? (entry.message.turnId ?? null)
      : null;
  }
  if (entry.kind === "turn-plan") {
    return entry.turnPlan.turnId;
  }
  if (entry.kind === "proposed-plan") {
    return entry.proposedPlan.turnId;
  }
  if (entry.kind === "operation") {
    // `ZeropsOperation.turnId` is a plain string — the reducer's package is
    // platform-free (R1) and never imports the branded `TurnId` type.
    return entry.operation.turnId as TurnId | null;
  }
  return entry.kind === "work" || entry.kind === "generic-call"
    ? (entry.entry.turnId ?? null)
    : null;
}

type UserMessageEntry = Extract<TimelineEntry, { kind: "message" }>;

/**
 * One turn as the timeline reads it: its header, the message that opened it,
 * and the entries it owns. A header exists from the moment a message is sent
 * (before the server has named the turn) until forever, always at the same
 * place — directly after the opening message, or before the turn's first
 * entry when no message opened it (a continuation of the same message).
 */
interface TurnSpan {
  headerId: string;
  /** Null only between a send and the server creating the turn. */
  turnId: TurnId | null;
  opener: UserMessageEntry | null;
  /** The header renders before `timelineEntries[anchorIndex]` (or last, past the end). */
  anchorIndex: number;
  entries: TimelineEntry[];
  terminalEntry: Extract<TimelineEntry, { kind: "message" }> | null;
  hasStreamingMessage: boolean;
}

function turnHeaderId(opener: UserMessageEntry | null, turnId: TurnId | null): string {
  return `turn-header:${opener?.message.id ?? turnId}`;
}

function deriveTurnSpans(input: {
  timelineEntries: ReadonlyArray<TimelineEntry>;
  terminalAssistantMessageIds: ReadonlySet<string>;
  unsettledTurnId: TurnId | null;
  isWorking: boolean;
}): TurnSpan[] {
  const spansByTurnId = new Map<TurnId, TurnSpan>();
  const spans: TurnSpan[] = [];
  // User messages no turn has claimed yet. The next new turn is opened by
  // the first of them — later ones, sent before it produced anything, were
  // sent into it. An entry of an existing turn arriving after them makes
  // them messages sent into that turn. Nothing here reads which turn is the
  // latest, so a turn keeps its opener once another one starts.
  let unclaimed: Array<{ entry: UserMessageEntry; index: number }> = [];
  const claimOpener = () => {
    const opener = unclaimed[0] ?? null;
    unclaimed = [];
    return opener;
  };
  const openSpan = (
    turnId: TurnId | null,
    firstIndex: number,
    opener: (typeof unclaimed)[number] | null,
  ) => {
    const span: TurnSpan = {
      headerId: turnHeaderId(opener?.entry ?? null, turnId),
      turnId,
      opener: opener?.entry ?? null,
      anchorIndex: opener ? opener.index + 1 : firstIndex,
      entries: [],
      terminalEntry: null,
      hasStreamingMessage: false,
    };
    spans.push(span);
    if (turnId !== null) spansByTurnId.set(turnId, span);
    return span;
  };

  for (const [index, entry] of input.timelineEntries.entries()) {
    if (entry.kind === "message" && entry.message.role === "user") {
      unclaimed.push({ entry, index });
      continue;
    }
    const turnId = timelineEntryTurnId(entry);
    if (turnId === null) {
      continue;
    }
    let span = spansByTurnId.get(turnId);
    if (span) {
      unclaimed = [];
    } else {
      span = openSpan(turnId, index, claimOpener());
    }
    span.entries.push(entry);
    if (entry.kind === "message") {
      if (input.terminalAssistantMessageIds.has(entry.message.id)) {
        span.terminalEntry = entry;
      }
      // Only an answer still being written may hold a fold open. A thinking
      // block stranded by a crashed provider keeps its streaming flag forever
      // and must not.
      if (entry.message.streaming && entry.message.role !== "reasoning") {
        span.hasStreamingMessage = true;
      }
    }
  }

  const end = input.timelineEntries.length;
  if (input.unsettledTurnId !== null) {
    if (!spansByTurnId.has(input.unsettledTurnId)) {
      openSpan(input.unsettledTurnId, end, claimOpener());
    }
  } else if (input.isWorking && unclaimed.length > 0) {
    openSpan(null, end, unclaimed[0]!);
  }
  return spans.toSorted((left, right) => left.anchorIndex - right.anchorIndex);
}

interface TurnFold {
  hiddenEntries: ReadonlySet<TimelineEntry>;
}

function entryCanFold(entry: TimelineEntry): boolean {
  return entry.kind !== "turn-plan" && entry.kind !== "proposed-plan";
}

/**
 * Settled turns keep their first and terminal assistant messages visible.
 * Everything between them folds behind the turn header. Keeping both ends
 * prevents a short follow-up from hiding a substantive opening response
 * while still bounding noisy turns.
 */
function deriveTurnFold(span: TurnSpan, unsettledTurnId: TurnId | null): TurnFold | null {
  if (span.turnId === null || span.turnId === unsettledTurnId || span.hasStreamingMessage) {
    return null;
  }
  const entries = span.entries.filter(entryCanFold);
  const firstAssistantEntry = entries.find(
    (entry): entry is Extract<TimelineEntry, { kind: "message" }> =>
      entry.kind === "message" && entry.message.role !== "reasoning",
  );
  const hiddenEntries = new Set<TimelineEntry>();
  for (const entry of entries) {
    if (entry === firstAssistantEntry || entry === span.terminalEntry) {
      continue;
    }
    // User input and subagent batches stay visible after their turn settles.
    if (
      entry.kind === "work" &&
      (entry.entry.questionAnswer !== undefined || entry.entry.agentSpawn !== undefined)
    ) {
      continue;
    }
    // Outcome cards never fold either: they are what a settled turn needs to
    // leave readable. A read card (logs, events, process, discover) is how
    // the agent looked, and folds with the rest of the work.
    if (entry.kind === "operation" && !isReadOperationKind(entry.operation.kind)) {
      continue;
    }
    hiddenEntries.add(entry);
  }
  // A lone compaction row stays visible on its own; it only folds away as
  // part of a turn that already folds other work. Thinking is the same: a
  // question answered by thought alone keeps its "Thought" row rather than
  // folding behind a header that hides nothing else.
  const hidesFoldableWork = [...hiddenEntries].some(
    (entry) =>
      !(entry.kind === "work" && entry.entry.sourceActivityKind === "context-compaction") &&
      !(entry.kind === "message" && entry.message.role === "reasoning"),
  );
  return hidesFoldableWork ? { hiddenEntries } : null;
}

/**
 * When a turn's entry ended: a message at its last update, a work row at its
 * latest activity and an operation once it settled — each is anchored at its
 * start, so its start is not its end.
 */
function timelineEntryEnd(entry: TimelineEntry): string {
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

/** "Worked for 8.0s" and the moment the turn ended, from the turn's own timings. */
function describeSettledTurn(
  span: TurnSpan,
  latestTurn: TimelineLatestTurn | null,
): { label: string; endedAt: string | null } {
  const entries = span.entries.filter(entryCanFold);
  const firstEntry = entries[0];
  const lastEntry = entries.at(-1);
  const isLatestTurn = span.turnId !== null && latestTurn?.turnId === span.turnId;
  // A turn cut short by a steer leaves trailing work entries behind its
  // terminal message — take whichever ended last.
  const lastEntryEnd = lastEntry ? timelineEntryEnd(lastEntry) : null;
  const entriesEnd = maxIsoTimestamp(span.terminalEntry?.message.updatedAt ?? null, lastEntryEnd);
  // The opening message is the turn's start: the first entry appears only
  // once the provider starts producing output, and a turn cut short by a
  // steer may hold a single instantaneous commentary message.
  const start = span.opener?.createdAt ?? firstEntry?.createdAt ?? null;
  const timed =
    isLatestTurn && latestTurn.startedAt && latestTurn.completedAt
      ? { start: latestTurn.startedAt, end: latestTurn.completedAt }
      : start !== null && entriesEnd !== null
        ? { start, end: entriesEnd }
        : null;
  const elapsedMs = timed ? computeElapsedMs(timed.start, timed.end) : null;
  const duration = elapsedMs !== null ? formatDuration(elapsedMs) : null;
  const label =
    isLatestTurn && latestTurn.state === "interrupted"
      ? duration
        ? `You stopped after ${duration}`
        : "You stopped this response"
      : duration
        ? `Worked for ${duration}`
        : "Worked";
  return { label, endedAt: timed?.end ?? entriesEnd };
}

/**
 * What the live turn is doing now: the same label the work row below
 * rotates through, repeated in the header so it reads from the top.
 */
function deriveLiveTurnActivity(input: {
  timelineEntries: ReadonlyArray<TimelineEntry>;
  activeEntryIndices: ReadonlyArray<number>;
  activeWork: { entry: WorkLogEntry; index: number } | null;
  activeActivityGroup: { entries: ActivityEntry[]; end: number } | undefined;
  activeTurnHasVisibleContent: boolean;
}): TurnHeaderActivity | null {
  let latest: { index: number; activity: TurnHeaderActivity } | null = null;
  const consider = (index: number, activity: TurnHeaderActivity) => {
    if (latest === null || index >= latest.index) latest = { index, activity };
  };
  for (const index of input.activeEntryIndices) {
    const entry = input.timelineEntries[index];
    if (entry?.kind === "operation" && entry.operation.phase === "running") {
      consider(index, { kind: "operation", operation: entry.operation });
    }
  }
  if (input.activeWork) {
    consider(input.activeWork.index, { kind: "tool", entry: input.activeWork.entry });
  }
  const group = input.activeActivityGroup;
  if (group) {
    const lastThoughtIndex = group.entries.findLastIndex((entry) => entry.kind === "message");
    const trailingWork = omitSupersededLifecycleMarkers(
      group.entries
        .slice(lastThoughtIndex + 1)
        .flatMap((entry) =>
          entry.kind === "work" && workEntryIsVisibleInGroup(entry.entry, true)
            ? [entry.entry]
            : [],
        ),
      (entry) => entry,
    );
    const liveWork =
      trailingWork.findLast((entry) => entry.toolLifecycleStatus === "inProgress") ??
      trailingWork.at(-1);
    consider(group.end - 1, liveWork ? { kind: "tool", entry: liveWork } : { kind: "thinking" });
  }
  if (latest !== null) return (latest as { activity: TurnHeaderActivity }).activity;
  return input.activeTurnHasVisibleContent ? null : { kind: "thinking" };
}

/**
 * The window a turn owns on the clock: from its opening message to its end.
 * A live turn's window is still open. Asks and landings are placed by it,
 * so a reload reads the same facts the live page wrote.
 */
function turnWindow(input: {
  span: TurnSpan;
  latestTurn: TimelineLatestTurn | null;
  unsettledTurnId: TurnId | null;
  checkpointCompletedAtByTurnId: ReadonlyMap<TurnId, string>;
}): { startMs: number; endMs: number } | null {
  const { span, latestTurn } = input;
  const isLatestTurn = span.turnId !== null && latestTurn?.turnId === span.turnId;
  const start =
    span.opener?.createdAt ??
    span.entries[0]?.createdAt ??
    (isLatestTurn ? latestTurn.startedAt : null);
  const startMs = start === null ? Number.NaN : Date.parse(start);
  if (!Number.isFinite(startMs)) return null;
  if (span.turnId === null || span.turnId === input.unsettledTurnId) {
    return { startMs, endMs: Number.POSITIVE_INFINITY };
  }
  // Only what outlives the turn being the latest: its last entry and its
  // checkpoint. `latestTurn.completedAt` would close the window later while
  // the turn is the latest than once the next one starts.
  const lastEntry = span.entries.at(-1);
  const ends = [
    lastEntry === undefined ? undefined : timelineEntryEnd(lastEntry),
    input.checkpointCompletedAtByTurnId.get(span.turnId),
  ].flatMap((end) => (end ? [Date.parse(end)] : []));
  return { startMs, endMs: Math.max(startMs, ...ends.filter(Number.isFinite)) };
}

const TALLIED_OPERATION_KINDS: ReadonlySet<ZeropsOperation["kind"]> = new Set([
  "deploy",
  "verify",
  "import",
  "browser",
]);

function operationFact(operation: ZeropsOperation): TurnTallyFact {
  return { word: operation.statusWord, tone: operationTone(operation) };
}

/**
 * What a turn did, as facts appended once they settle — never predicted:
 * per service its latest deploy and verify outcome, imports, browser checks,
 * the changes that landed inside the turn's window, and the messages the
 * person sent into it. Operation facts keep the order they first settled
 * in; landings follow by landing time; asks come last. The words are the
 * operations' own status words (R5).
 */
function deriveTurnTally(input: {
  span: TurnSpan;
  landed: ReadonlyArray<ChangeLandedEntry>;
  asks: number;
}): TurnTallyItem[] {
  const settled = input.span.entries
    .flatMap((entry) =>
      entry.kind === "operation" &&
      entry.operation.phase !== "running" &&
      TALLIED_OPERATION_KINDS.has(entry.operation.kind)
        ? [entry.operation]
        : [],
    )
    .toSorted(
      (left, right) =>
        (left.settledAt ?? left.anchorAt).localeCompare(right.settledAt ?? right.anchorAt) ||
        left.key.localeCompare(right.key),
    );
  const services = new Map<string, { deploy?: ZeropsOperation; verify?: ZeropsOperation }>();
  const browser = { checks: 0, withErrors: 0 };
  const itemBuilders = new Map<string, () => TurnTallyItem>();
  for (const operation of settled) {
    if (operation.kind === "deploy" || operation.kind === "verify") {
      const host = operation.target?.hostname ?? operation.subject;
      const key = `service:${host}`;
      const service = services.get(key) ?? {};
      service[operation.kind] = operation;
      services.set(key, service);
      if (!itemBuilders.has(key)) {
        itemBuilders.set(key, () => ({
          key,
          subject: host,
          facts: [service.deploy, service.verify].flatMap((outcome) =>
            outcome ? [operationFact(outcome)] : [],
          ),
        }));
      }
    } else if (operation.kind === "import") {
      const key = `import:${operation.key}`;
      itemBuilders.set(key, () => ({
        key,
        subject: operation.subject,
        facts: [operationFact(operation)],
      }));
    } else {
      browser.checks += 1;
      if (operation.phase === "failed" || operation.browserSummary?.failedStep !== undefined) {
        browser.withErrors += 1;
      }
      if (!itemBuilders.has("browser")) {
        itemBuilders.set("browser", () => ({
          key: "browser",
          subject: null,
          facts: [
            {
              word: plural(browser.checks, "browser check"),
              tone: browser.withErrors > 0 ? "attention" : "ok",
            },
            ...(browser.withErrors > 0
              ? [{ word: `${browser.withErrors} with errors`, tone: "failed" as const }]
              : []),
          ],
        }));
      }
    }
  }
  return [
    ...[...itemBuilders.values()].map((build) => build()),
    ...input.landed.map((entry) => ({
      key: `landed:${entry.event.key}`,
      subject: null,
      facts: [
        {
          word: `${entry.event.repository} #${String(entry.event.number)} landed`,
          tone: "ok" as const,
        },
      ],
    })),
    ...(input.asks > 0
      ? [{ key: "asks", subject: null, facts: [{ word: plural(input.asks, "ask"), tone: null }] }]
      : []),
  ];
}

function deriveTurnTallies(input: {
  spans: ReadonlyArray<TurnSpan>;
  timelineEntries: ReadonlyArray<TimelineEntry>;
  latestTurn: TimelineLatestTurn | null;
  unsettledTurnId: TurnId | null;
  turnDiffSummaries: ReadonlyArray<TurnDiffSummary>;
}): Map<TurnSpan, TurnTallyItem[]> {
  const checkpointCompletedAtByTurnId = new Map<TurnId, string>();
  for (const summary of input.turnDiffSummaries) {
    const known = checkpointCompletedAtByTurnId.get(summary.turnId);
    checkpointCompletedAtByTurnId.set(
      summary.turnId,
      maxIsoTimestamp(known ?? null, summary.completedAt) ?? summary.completedAt,
    );
  }
  const openers = new Set(input.spans.flatMap((span) => (span.opener ? [span.opener] : [])));
  const tallies = input.spans.map((span) => ({
    span,
    window: turnWindow({
      span,
      latestTurn: input.latestTurn,
      unsettledTurnId: input.unsettledTurnId,
      checkpointCompletedAtByTurnId,
    }),
    landed: [] as ChangeLandedEntry[],
    asks: 0,
  }));
  const byStart = tallies
    .flatMap((tally) => (tally.window === null ? [] : [{ ...tally.window, tally }]))
    .toSorted((left, right) => left.startMs - right.startMs);
  // The turn that had most recently started by then, if it had not ended.
  const ownerAt = (iso: string) => {
    const ms = Date.parse(iso);
    let low = 0;
    let high = byStart.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (byStart[middle]!.startMs <= ms) low = middle + 1;
      else high = middle;
    }
    const candidate = byStart[low - 1];
    return candidate !== undefined && ms <= candidate.endMs ? candidate.tally : undefined;
  };
  for (const entry of input.timelineEntries) {
    if (entry.kind === "change-landed") {
      ownerAt(entry.event.landedAt)?.landed.push(entry);
    } else if (entry.kind === "message" && entry.message.role === "user" && !openers.has(entry)) {
      const owner = ownerAt(entry.message.createdAt);
      if (owner) owner.asks += 1;
    }
  }
  return new Map(
    tallies.map(({ span, landed, asks }) => [span, deriveTurnTally({ span, landed, asks })]),
  );
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
    if (!entry || entry.kind !== "message" || entry.message.role !== "user") {
      continue;
    }

    for (let nextIndex = index + 1; nextIndex < input.timelineEntries.length; nextIndex += 1) {
      const nextEntry = input.timelineEntries[nextIndex];
      if (!nextEntry || nextEntry.kind !== "message") {
        continue;
      }
      if (nextEntry.message.role === "user") {
        break;
      }
      const summary = input.turnDiffSummaryByAssistantMessageId.get(nextEntry.message.id);
      if (!summary) {
        continue;
      }
      const turnCount =
        summary.checkpointTurnCount ?? input.inferredCheckpointTurnCountByTurnId[summary.turnId];
      if (typeof turnCount !== "number") {
        break;
      }
      byUserMessageId.set(entry.message.id, Math.max(0, turnCount - 1));
      break;
    }
  }
  return byUserMessageId;
}

export function deriveMessagesTimelineRows(input: {
  timelineEntries: ReadonlyArray<TimelineEntry>;
  latestTurn?: TimelineLatestTurn | null;
  runningTurnId?: TurnId | null;
  expandedTurnIds?: ReadonlySet<TurnId>;
  expandedWorkGroupIds?: ReadonlySet<string>;
  isWorking: boolean;
  activeTurnStartedAt: string | null;
  turnDiffSummaries: ReadonlyArray<TurnDiffSummary>;
  supportsConversationRollback: boolean;
  /** Messages sent during the running turn, rendered after the live rows. */
  queuedMessages?: ReadonlyArray<QueuedComposerMessage>;
}): MessagesTimelineRow[] {
  const turnDiffSummaryByAssistantMessageId = new Map<MessageId, TurnDiffSummary>();
  for (const summary of input.turnDiffSummaries) {
    if (summary.assistantMessageId) {
      turnDiffSummaryByAssistantMessageId.set(summary.assistantMessageId, summary);
    }
  }
  const revertTurnCountByUserMessageId = buildRevertTurnCountByUserMessageId({
    supportsConversationRollback: input.supportsConversationRollback,
    timelineEntries: input.timelineEntries,
    turnDiffSummaryByAssistantMessageId,
    inferredCheckpointTurnCountByTurnId: input.supportsConversationRollback
      ? inferCheckpointTurnCountByTurnId(input.turnDiffSummaries)
      : {},
  });
  const nextRows: MessagesTimelineRow[] = [];
  const timelineEntries = input.timelineEntries;
  const workTimelineEntries = timelineEntries.filter(
    (entry): entry is Extract<TimelineEntry, { kind: "work" }> => entry.kind === "work",
  );
  const preferredWorkRowOwnerById = new Map<string, Extract<TimelineEntry, { kind: "work" }>>();
  for (const timelineEntry of workTimelineEntries) {
    if (!preferredWorkRowOwnerById.has(timelineEntry.entry.id)) {
      preferredWorkRowOwnerById.set(timelineEntry.entry.id, timelineEntry);
    }
  }
  // Preserve established work-row ids when they are unique. A later entry
  // that reuses one falls back to its timeline identity so list keys remain
  // stable and collision-free across collapse and expansion.
  const claimedWorkRowIds = new Set(preferredWorkRowOwnerById.keys());
  const workRowIdByEntry = new Map<WorkLogEntry, string>();
  for (const [entryIndex, timelineEntry] of workTimelineEntries.entries()) {
    if (preferredWorkRowOwnerById.get(timelineEntry.entry.id) === timelineEntry) {
      workRowIdByEntry.set(timelineEntry.entry, timelineEntry.entry.id);
      continue;
    }
    let rowId = timelineEntry.id;
    if (claimedWorkRowIds.has(rowId)) {
      rowId = `work-row:${timelineEntry.id}:${entryIndex}`;
    }
    while (claimedWorkRowIds.has(rowId)) {
      rowId = `${rowId}:duplicate`;
    }
    claimedWorkRowIds.add(rowId);
    workRowIdByEntry.set(timelineEntry.entry, rowId);
  }
  const workRowId = (entry: WorkLogEntry) => workRowIdByEntry.get(entry) ?? entry.id;
  const durationStartByMessageId = computeMessageDurationStart(
    timelineEntries.flatMap((entry) => (entry.kind === "message" ? [entry.message] : [])),
  );
  const terminalAssistantMessageIds = deriveTerminalAssistantMessageIds(timelineEntries);
  const unsettledTurnId = deriveUnsettledTurnId(
    input.latestTurn ?? null,
    input.runningTurnId ?? null,
  );
  const turnSpans = deriveTurnSpans({
    timelineEntries,
    terminalAssistantMessageIds,
    unsettledTurnId,
    isWorking: input.isWorking,
  });
  const foldBySpan = new Map<TurnSpan, TurnFold>();
  const collapsedEntries = new Set<TimelineEntry>();
  for (const span of turnSpans) {
    const fold = deriveTurnFold(span, unsettledTurnId);
    if (fold === null) continue;
    foldBySpan.set(span, fold);
    if (span.turnId !== null && !input.expandedTurnIds?.has(span.turnId)) {
      for (const entry of fold.hiddenEntries) {
        collapsedEntries.add(entry);
      }
    }
  }
  const tallyBySpan = deriveTurnTallies({
    spans: turnSpans,
    timelineEntries,
    latestTurn: input.latestTurn ?? null,
    unsettledTurnId,
    turnDiffSummaries: input.turnDiffSummaries,
  });
  const spansByAnchorIndex = new Map<number, TurnSpan[]>();
  for (const span of turnSpans) {
    const atIndex = spansByAnchorIndex.get(span.anchorIndex);
    if (atIndex) atIndex.push(span);
    else spansByAnchorIndex.set(span.anchorIndex, [span]);
  }
  const activeSpan = input.isWorking
    ? turnSpans.find((span) => span.turnId === unsettledTurnId)
    : undefined;
  const activeTurnStartIndex = activeSpan?.anchorIndex ?? timelineEntries.length;
  const entryBelongsToActiveTurn = (entry: TimelineEntry, index: number) =>
    activeSpan !== undefined &&
    index >= activeTurnStartIndex &&
    (unsettledTurnId === null || timelineEntryTurnId(entry) === unsettledTurnId);
  // Runs of thinking and tool calls in one turn become a single activity row,
  // so a provider that thinks between every tool call does not stack "Thought"
  // rows between the calls. A run without thinking stays ordinary tool work.
  //
  // A change landing is a fact about the forge, placed by its moment: it is
  // transparent to a run, which stays one row with the landing right after
  // it, instead of splitting where the landing fell.
  const activityGroupsByStart = new Map<
    TimelineEntry,
    {
      entries: ActivityEntry[];
      landed: ChangeLandedEntry[];
      end: number;
      turnId: TurnId;
      active: boolean;
    }
  >();
  const activityGroupEntries = new Set<TimelineEntry>();
  for (let index = 0; index < timelineEntries.length;) {
    const entry = timelineEntries[index]!;
    const turnId = timelineEntryTurnId(entry);
    if (turnId === null || !isActivityEntry(entry) || collapsedEntries.has(entry)) {
      index += 1;
      continue;
    }
    const entries: ActivityEntry[] = [entry];
    const landed: ChangeLandedEntry[] = [];
    const pendingLanded: ChangeLandedEntry[] = [];
    let end = index + 1;
    let cursor = index + 1;
    while (cursor < timelineEntries.length && !spansByAnchorIndex.has(cursor)) {
      const next = timelineEntries[cursor]!;
      if (next.kind === "change-landed") {
        pendingLanded.push(next);
        cursor += 1;
        continue;
      }
      if (
        !isActivityEntry(next) ||
        timelineEntryTurnId(next) !== turnId ||
        collapsedEntries.has(next)
      ) {
        break;
      }
      entries.push(next);
      landed.push(...pendingLanded.splice(0));
      cursor += 1;
      end = cursor;
    }
    if (entries.some((candidate) => candidate.kind === "message")) {
      const lastWork = entries.findLast(
        (candidate): candidate is Extract<ActivityEntry, { kind: "work" }> =>
          candidate.kind === "work" && workEntryIsVisibleInGroup(candidate.entry, true),
      );
      const active =
        input.isWorking &&
        turnId === unsettledTurnId &&
        // Nothing but landings after it: still the live tail.
        cursor === timelineEntries.length &&
        !(lastWork && workEntryDisplayIndicatesToolFailure(lastWork.entry));
      activityGroupsByStart.set(entry, { entries, landed, end, turnId, active });
      for (const member of entries) activityGroupEntries.add(member);
    }
    index = end;
  }
  const workEntryIsInActiveRun = (entry: WorkLogEntry) =>
    input.isWorking &&
    unsettledTurnId !== null &&
    entry.toolLifecycleStatus === "inProgress" &&
    entry.turnId === unsettledTurnId;
  const isVisibleActiveToolEntry = (entry: WorkLogEntry) =>
    workLogEntryIsToolLike(entry) && workEntryIsVisibleInGroup(entry, true);
  const activeEntryIndices: number[] = [];
  for (let index = activeTurnStartIndex; index < timelineEntries.length; index += 1) {
    if (entryBelongsToActiveTurn(timelineEntries[index]!, index)) activeEntryIndices.push(index);
  }
  const activeEntries = activeEntryIndices.map((index) => timelineEntries[index]!);
  const activeTurnHasVisibleContent = activeEntries.some((entry) => {
    if (entry.kind === "message") {
      return entry.message.role === "assistant" && (entry.message.text?.trim().length ?? 0) > 0;
    }
    if (entry.kind === "work" || entry.kind === "generic-call") {
      return (
        entry.entry.agentSpawn === undefined &&
        workLogEntryIsToolLike(entry.entry) &&
        entry.entry.toolLifecycleStatus === "inProgress"
      );
    }
    if (entry.kind === "operation") return true;
    if (entry.kind === "proposed-plan" || entry.kind === "turn-plan") return true;
    return false;
  });

  // Stops at any non-"work" neighbour, including an "operation" row: an
  // operation card ends the live tail on both sides, same as any other kind.
  // A change landing is transparent: it renders right after the live row.
  const activeToolEntries: Array<Extract<TimelineEntry, { kind: "work" }>> = [];
  for (let index = timelineEntries.length - 1; index >= activeTurnStartIndex; index -= 1) {
    const entry = timelineEntries[index]!;
    if (entry.kind === "change-landed") {
      continue;
    }
    if (
      !entryBelongsToActiveTurn(entry, index) ||
      entry.kind !== "work" ||
      activityGroupEntries.has(entry) ||
      entry.entry.agentSpawn !== undefined ||
      entry.entry.questionAnswer !== undefined ||
      entry.entry.sourceActivityKind === "context-compaction" ||
      entry.entry.tone === "error" ||
      !workLogEntryIsToolLike(entry.entry)
    ) {
      break;
    }
    activeToolEntries.unshift(entry);
  }
  const activeWorkEntries = new Set(activeToolEntries);
  const visibleActiveToolEntries = omitSupersededLifecycleMarkers(
    activeToolEntries.filter((entry) => isVisibleActiveToolEntry(entry.entry)),
    (entry) => entry.entry,
  );
  const activeWorkAnchor = activeToolEntries[0];
  const latestActiveToolEntry = visibleActiveToolEntries.at(-1);
  // The live row stays where the run began; later calls update it in place.
  const activeWorkPlacementEntry = latestActiveToolEntry ? activeWorkAnchor : undefined;
  const activeWorkRow =
    activeWorkAnchor && latestActiveToolEntry
      ? (() => {
          const groupId = workGroupId(activeWorkAnchor.id, activeWorkAnchor.entry);
          return {
            kind: "work-live" as const,
            // One id for a tool run, live or summarized: it never re-keys at
            // the moment its last call settles or the turn moves on.
            id: groupId,
            createdAt: activeWorkAnchor.createdAt,
            entry: latestActiveToolEntry.entry,
            groupedEntries: visibleActiveToolEntries.map((entry) => entry.entry),
            groupId,
            expanded: input.expandedWorkGroupIds?.has(groupId) ?? false,
          };
        })()
      : null;
  const liveActivity =
    activeSpan === undefined
      ? null
      : deriveLiveTurnActivity({
          timelineEntries,
          activeEntryIndices,
          activeWork:
            activeWorkRow && activeWorkPlacementEntry
              ? {
                  entry: activeWorkRow.entry,
                  index: timelineEntries.lastIndexOf(activeWorkPlacementEntry),
                }
              : null,
          activeActivityGroup: [...activityGroupsByStart.values()].find((group) => group.active),
          activeTurnHasVisibleContent,
        });
  const appendTurnHeaders = (anchorIndex: number) => {
    for (const span of spansByAnchorIndex.get(anchorIndex) ?? []) {
      const live = span === activeSpan;
      const fold = foldBySpan.get(span);
      const settled = live ? null : describeSettledTurn(span, input.latestTurn ?? null);
      nextRows.push({
        kind: "turn-header",
        id: span.headerId,
        createdAt:
          span.opener?.createdAt ?? span.entries[0]?.createdAt ?? input.activeTurnStartedAt ?? "",
        turnId: span.turnId,
        state: live ? "live" : "settled",
        liveSince: live ? input.activeTurnStartedAt : null,
        activity: live ? liveActivity : null,
        label: settled?.label ?? null,
        endedAt: settled?.endedAt ?? null,
        fold:
          fold && span.turnId !== null
            ? { expanded: input.expandedTurnIds?.has(span.turnId) ?? false }
            : null,
        tally: tallyBySpan.get(span) ?? [],
      });
    }
  };
  const pushChangeLandedRow = (entry: ChangeLandedEntry) => {
    nextRows.push({
      kind: "change-landed",
      id: entry.id,
      createdAt: entry.createdAt,
      event: entry.event,
    });
  };
  const appendActiveWorkRows = () => {
    if (activeWorkRow === null) return;
    nextRows.push(activeWorkRow);
    if (!activeWorkRow.expanded) return;
    for (const [entryIndex, workEntry] of activeWorkRow.groupedEntries.entries()) {
      nextRows.push({
        kind: "work",
        id: workRowId(workEntry),
        createdAt: workEntry.createdAt,
        groupedEntries: [workEntry],
        isExpandedToolGroupEntry: true,
        isLastExpandedToolGroupEntry: entryIndex === activeWorkRow.groupedEntries.length - 1,
      });
    }
  };

  for (let index = 0; index < timelineEntries.length; index += 1) {
    const timelineEntry = timelineEntries[index];
    if (!timelineEntry) {
      continue;
    }

    appendTurnHeaders(index);

    if (timelineEntry === activeWorkPlacementEntry) {
      appendActiveWorkRows();
    }

    if (collapsedEntries.has(timelineEntry)) {
      continue;
    }

    const activityGroup = activityGroupsByStart.get(timelineEntry);
    if (activityGroup) {
      const groupId =
        timelineEntry.kind === "work"
          ? workGroupId(timelineEntry.id, timelineEntry.entry)
          : `activity-group:${timelineEntry.id}`;
      nextRows.push({
        kind: "activity-group",
        id: groupId,
        createdAt: timelineEntry.createdAt,
        turnId: activityGroup.turnId,
        groupId,
        entries: activityGroup.entries,
        expanded: input.expandedWorkGroupIds?.has(groupId) ?? false,
        active: activityGroup.active,
      });
      for (const landed of activityGroup.landed) pushChangeLandedRow(landed);
      index = activityGroup.end - 1;
      continue;
    }

    if (timelineEntry.kind === "work" && activeWorkEntries.has(timelineEntry)) {
      continue;
    }

    if (
      timelineEntry.kind === "work" &&
      timelineEntry.entry.sourceActivityKind === "context-compaction"
    ) {
      nextRows.push({
        kind: "context-compaction",
        id: timelineEntry.id,
        createdAt: timelineEntry.createdAt,
        label: timelineEntry.entry.label,
      });
      continue;
    }

    // A question answer is the user's own words: always its own row, never
    // grouped with the tool calls around it.
    if (timelineEntry.kind === "work" && timelineEntry.entry.questionAnswer !== undefined) {
      nextRows.push({
        kind: "work",
        id: timelineEntry.id,
        createdAt: timelineEntry.createdAt,
        groupedEntries: [timelineEntry.entry],
        isExpandedToolGroupEntry: false,
        isLastExpandedToolGroupEntry: false,
      });
      continue;
    }

    if (timelineEntry.kind === "work") {
      const groupedEntries = [timelineEntry.entry];
      const landedInRun: ChangeLandedEntry[] = [];
      const pendingLanded: ChangeLandedEntry[] = [];
      let end = index + 1;
      let cursor = index + 1;
      while (cursor < timelineEntries.length) {
        const nextEntry = timelineEntries[cursor];
        if (nextEntry?.kind === "change-landed" && !spansByAnchorIndex.has(cursor)) {
          pendingLanded.push(nextEntry);
          cursor += 1;
          continue;
        }
        if (
          !nextEntry ||
          // An "operation" row (like any other non-"work" kind) ends the run.
          nextEntry.kind !== "work" ||
          nextEntry.entry.questionAnswer !== undefined ||
          nextEntry.entry.sourceActivityKind === "context-compaction" ||
          // An error is a run of its own, as the live tail reads it: the
          // tools after it start their own run, live or summarized.
          nextEntry.entry.tone === "error" ||
          timelineEntry.entry.tone === "error" ||
          activeWorkEntries.has(nextEntry) ||
          collapsedEntries.has(nextEntry) ||
          spansByAnchorIndex.has(cursor)
        ) {
          break;
        }
        groupedEntries.push(nextEntry.entry);
        landedInRun.push(...pendingLanded.splice(0));
        cursor += 1;
        end = cursor;
      }
      const visibleGroupedEntries = omitSupersededLifecycleMarkers(
        groupedEntries.filter((entry) =>
          workEntryIsVisibleInGroup(entry, workEntryIsInActiveRun(entry)),
        ),
        (entry) => entry,
      );
      if (visibleGroupedEntries.length > 0) {
        const onlyToolEntries = visibleGroupedEntries.every(
          (entry) =>
            workLogEntryIsToolLike(entry) &&
            entry.agentSpawn === undefined &&
            entry.tone !== "error",
        );
        const activeInProgressToolEntries = visibleGroupedEntries.filter(workEntryIsInActiveRun);
        if (onlyToolEntries && activeInProgressToolEntries.length > 0) {
          const groupId = workGroupId(timelineEntry.id, timelineEntry.entry);
          const expanded = input.expandedWorkGroupIds?.has(groupId) ?? false;
          const latestActiveToolEntry = activeInProgressToolEntries.at(-1)!;
          nextRows.push({
            kind: "work-live",
            id: groupId,
            createdAt: timelineEntry.createdAt,
            entry: latestActiveToolEntry,
            groupedEntries: visibleGroupedEntries,
            groupId,
            expanded,
          });
          if (expanded) {
            for (const [entryIndex, workEntry] of visibleGroupedEntries.entries()) {
              nextRows.push({
                kind: "work",
                id: workRowId(workEntry),
                createdAt: workEntry.createdAt,
                groupedEntries: [workEntry],
                isExpandedToolGroupEntry: true,
                isLastExpandedToolGroupEntry: entryIndex === visibleGroupedEntries.length - 1,
              });
            }
          }
        } else if (onlyToolEntries) {
          const groupId = workGroupId(timelineEntry.id, timelineEntry.entry);
          const expanded = input.expandedWorkGroupIds?.has(groupId) ?? false;
          const lastEntry = visibleGroupedEntries.at(-1)!;
          nextRows.push({
            kind: "work-toggle",
            id: groupId,
            createdAt: timelineEntry.createdAt,
            groupId,
            hiddenCount: visibleGroupedEntries.length,
            expanded,
            onlyToolEntries: true,
            summary: summarizeToolGroup(visibleGroupedEntries),
            summaryKind: toolGroupSummaryKind(visibleGroupedEntries),
            hasFailure: workEntryDisplayIndicatesToolFailure(lastEntry),
          });
          if (expanded) {
            for (const [entryIndex, workEntry] of visibleGroupedEntries.entries()) {
              nextRows.push({
                kind: "work",
                id: workRowId(workEntry),
                createdAt: workEntry.createdAt,
                groupedEntries: [workEntry],
                isExpandedToolGroupEntry: true,
                isLastExpandedToolGroupEntry: entryIndex === visibleGroupedEntries.length - 1,
              });
            }
          }
        } else if (visibleGroupedEntries.length <= MAX_VISIBLE_WORK_LOG_ENTRIES) {
          nextRows.push({
            kind: "work",
            id: timelineEntry.id,
            createdAt: timelineEntry.createdAt,
            groupedEntries: visibleGroupedEntries,
            isExpandedToolGroupEntry: false,
            isLastExpandedToolGroupEntry: false,
          });
        } else {
          const groupId = workGroupId(timelineEntry.id, timelineEntry.entry);
          const expanded = input.expandedWorkGroupIds?.has(groupId) ?? false;
          // Agent-spawn CTA rows are always visible: they never belong behind
          // a "+N tool calls" toggle. Selection is by membership (exempt OR
          // recent-tail), preserving the group's order in both states
          // (concatenating filtered lists once moved a mid-group spawn row
          // above earlier tool rows).
          const alwaysVisibleEntries = new Set(
            visibleGroupedEntries.filter((entry) => entry.agentSpawn !== undefined),
          );
          const overflowCandidates = visibleGroupedEntries.filter(
            (entry) => !alwaysVisibleEntries.has(entry),
          );
          const hiddenEntries = overflowCandidates.slice(0, -MAX_VISIBLE_WORK_LOG_ENTRIES);
          const hiddenEntrySet = new Set(hiddenEntries);
          const visibleEntries = visibleGroupedEntries.filter(
            (entry) => alwaysVisibleEntries.has(entry) || !hiddenEntrySet.has(entry),
          );
          const renderedEntries = expanded ? visibleGroupedEntries : visibleEntries;

          for (const workEntry of renderedEntries) {
            nextRows.push({
              kind: "work",
              id: workRowId(workEntry),
              createdAt: workEntry.createdAt,
              groupedEntries: [workEntry],
              isExpandedToolGroupEntry: false,
              isLastExpandedToolGroupEntry: false,
            });
          }

          if (hiddenEntries.length > 0) {
            const latestToolEntry = visibleGroupedEntries.findLast(workLogEntryIsToolLike);

            nextRows.push({
              kind: "work-toggle",
              id: groupId,
              createdAt: timelineEntry.createdAt,
              groupId,
              hiddenCount: hiddenEntries.length,
              expanded,
              onlyToolEntries: hiddenEntries.every(workLogEntryIsToolLike),
              summary: null,
              summaryKind: null,
              hasFailure:
                latestToolEntry !== undefined &&
                workEntryDisplayIndicatesToolFailure(latestToolEntry) &&
                hiddenEntries.some(workEntryDisplayIndicatesToolFailure),
            });
          }
        }
      }
      for (const landed of landedInRun) pushChangeLandedRow(landed);
      index = end - 1;
      continue;
    }

    if (timelineEntry.kind === "proposed-plan") {
      nextRows.push({
        kind: "proposed-plan",
        id: timelineEntry.id,
        createdAt: timelineEntry.createdAt,
        proposedPlan: timelineEntry.proposedPlan,
      });
      continue;
    }

    if (timelineEntry.kind === "turn-plan") {
      nextRows.push({
        kind: "turn-plan",
        id: timelineEntry.id,
        createdAt: timelineEntry.createdAt,
        turnPlan: timelineEntry.turnPlan,
      });
      continue;
    }

    if (timelineEntry.kind === "operation") {
      nextRows.push({
        kind: "operation",
        id: timelineEntry.id,
        createdAt: timelineEntry.createdAt,
        operation: timelineEntry.operation,
      });
      continue;
    }

    if (timelineEntry.kind === "generic-call") {
      nextRows.push({
        kind: "generic-call",
        id: timelineEntry.id,
        createdAt: timelineEntry.createdAt,
        entry: timelineEntry.entry,
      });
      continue;
    }

    if (timelineEntry.kind === "change-landed") {
      pushChangeLandedRow(timelineEntry);
      continue;
    }

    const assistantTurnStillInProgress =
      timelineEntry.message.role === "assistant" &&
      unsettledTurnId !== null &&
      timelineEntry.message.turnId === unsettledTurnId;

    const durationStart =
      durationStartByMessageId.get(timelineEntry.message.id) ?? timelineEntry.message.createdAt;

    // While the turn is still running, the latest assistant message is only
    // provisionally terminal — withhold the metadata row until the turn
    // settles so commentary doesn't flash timestamps mid-work.
    const showAssistantMeta =
      timelineEntry.message.role === "assistant" &&
      terminalAssistantMessageIds.has(timelineEntry.message.id) &&
      !assistantTurnStillInProgress;

    nextRows.push({
      kind: "message",
      id: timelineEntry.id,
      createdAt: timelineEntry.createdAt,
      message: timelineEntry.message,
      durationStart,
      narration: timelineEntry.message.role === "assistant" && !showAssistantMeta,
      showAssistantMeta,
      showAssistantCopyButton: showAssistantMeta,
      assistantCopyStreaming: timelineEntry.message.streaming || assistantTurnStillInProgress,
      assistantTurnDiffSummary:
        timelineEntry.message.role === "assistant"
          ? turnDiffSummaryByAssistantMessageId.get(timelineEntry.message.id)
          : undefined,
      revertTurnCount:
        timelineEntry.message.role === "user"
          ? revertTurnCountByUserMessageId.get(timelineEntry.message.id)
          : undefined,
    });
  }

  appendTurnHeaders(timelineEntries.length);

  input.queuedMessages?.forEach((queuedMessage, index) => {
    nextRows.push({
      kind: "queued-message",
      id: `queued-message:${queuedMessage.id}`,
      createdAt: queuedMessage.createdAt,
      queuedMessage,
      isNext: index === 0,
    });
  });
  return nextRows;
}

type MessagesTimelineRowsInput = Parameters<typeof deriveMessagesTimelineRows>[0];

export interface MessagesTimelineRowsProjection {
  readonly input: MessagesTimelineRowsInput;
  readonly rows: MessagesTimelineRow[];
}

function hasVisibleMessageText(message: ChatMessage): boolean {
  return (message.text?.trim().length ?? 0) > 0;
}

function replaceStreamingMessageRows(
  input: MessagesTimelineRowsInput,
  previous: MessagesTimelineRowsProjection,
): MessagesTimelineRow[] | null {
  const {
    timelineEntries: previousEntries,
    turnDiffSummaries: previousSummaries,
    latestTurn: previousLatestTurn,
    expandedTurnIds: previousExpandedTurns,
    expandedWorkGroupIds: previousExpandedGroups,
    ...previousContext
  } = previous.input;
  const {
    timelineEntries,
    turnDiffSummaries,
    latestTurn,
    expandedTurnIds,
    expandedWorkGroupIds,
    ...context
  } = input;
  if (
    timelineEntries.length !== previousEntries.length ||
    !shallow(previousContext, context) ||
    !shallow(previousSummaries, turnDiffSummaries) ||
    !shallow(previousLatestTurn, latestTurn) ||
    !shallow(previousExpandedTurns, expandedTurnIds) ||
    !shallow(previousExpandedGroups, expandedWorkGroupIds)
  ) {
    return null;
  }
  const replacements = new Map<ChatMessage, ChatMessage>();
  for (const [index, entry] of timelineEntries.entries()) {
    const previousEntry = previousEntries[index]!;
    if (entry === previousEntry) continue;
    if (
      entry.kind !== "message" ||
      previousEntry.kind !== "message" ||
      entry.id !== previousEntry.id ||
      entry.createdAt !== previousEntry.createdAt
    ) {
      return null;
    }
    if (entry.message === previousEntry.message) continue;
    if (!isStreamingMessageTextUpdate(previousEntry.message, entry.message)) return null;
    // Visible assistant text decides whether the live header reads "Thinking".
    if (hasVisibleMessageText(previousEntry.message) !== hasVisibleMessageText(entry.message)) {
      return null;
    }
    replacements.set(previousEntry.message, entry.message);
  }
  if (replacements.size === 0) return previous.rows;
  return previous.rows.map((row) => {
    if (row.kind !== "message") return row;
    const message = replacements.get(row.message);
    return message ? { ...row, message } : row;
  });
}

/** Keep one projection per timeline. Reuse rows only when streaming content changes. */
export function deriveMessagesTimelineRowsWithState(
  input: MessagesTimelineRowsInput,
  previous: MessagesTimelineRowsProjection | null = null,
): MessagesTimelineRowsProjection {
  return {
    input,
    rows:
      (previous === null ? null : replaceStreamingMessageRows(input, previous)) ??
      deriveMessagesTimelineRows(input),
  };
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

/** Shallow field comparison per row variant — avoids deep equality cost. */
function isRowUnchanged(a: MessagesTimelineRow, b: MessagesTimelineRow): boolean {
  if (a.kind !== b.kind || a.id !== b.id) return false;

  switch (a.kind) {
    case "activity-group": {
      const group = b as typeof a;
      return (
        a.active === group.active &&
        a.expanded === group.expanded &&
        a.groupId === group.groupId &&
        a.entries.length === group.entries.length &&
        a.entries.every((entry, index) => entry === group.entries[index])
      );
    }

    case "turn-header": {
      const bh = b as typeof a;
      return (
        a.createdAt === bh.createdAt &&
        a.turnId === bh.turnId &&
        a.state === bh.state &&
        a.liveSince === bh.liveSince &&
        a.label === bh.label &&
        a.endedAt === bh.endedAt &&
        a.fold?.expanded === bh.fold?.expanded &&
        Equal.equals(a.activity, bh.activity) &&
        Equal.equals(a.tally, bh.tally)
      );
    }

    case "context-compaction": {
      const bc = b as typeof a;
      return a.createdAt === bc.createdAt && a.label === bc.label;
    }

    case "proposed-plan":
      return a.proposedPlan === (b as typeof a).proposedPlan;

    case "queued-message": {
      const bq = b as typeof a;
      return a.queuedMessage === bq.queuedMessage && a.isNext === bq.isNext;
    }

    case "turn-plan": {
      const bp = b as typeof a;
      // Plans rewrite in place: compare the snapshot's identity fields so an
      // unchanged plan keeps its row reference (virtualization stability).
      return a.createdAt === bp.createdAt && a.turnPlan.plan === bp.turnPlan.plan;
    }

    case "operation": {
      const bo = b as typeof a;
      // The model rebuilds every `ZeropsOperation` fresh on each derive
      // (no per-operation cache), so object identity always reports
      // "changed" — deep-compare the whole entity instead, the same way
      // `work` below does for its own freshly-built `groupedEntries`.
      return a.createdAt === bo.createdAt && Equal.equals(a.operation, bo.operation);
    }

    case "generic-call": {
      const bg = b as typeof a;
      // Renders the whole `WorkLogEntry` (`SimpleWorkEntryRow`) — deep-compare
      // it rather than a hand-picked field subset, so a streamed-in
      // `toolInput` (or any other field the row shows) is not missed.
      return a.createdAt === bg.createdAt && Equal.equals(a.entry, bg.entry);
    }

    case "change-landed": {
      const bl = b as typeof a;
      // The event is rebuilt each read, so identity would never hold; what
      // makes it the same row is the change and the moment it landed.
      return a.createdAt === bl.createdAt && a.event.key === bl.event.key;
    }

    case "work": {
      const bw = b as typeof a;
      return (
        a.isExpandedToolGroupEntry === bw.isExpandedToolGroupEntry &&
        a.isLastExpandedToolGroupEntry === bw.isLastExpandedToolGroupEntry &&
        Equal.equals(a.groupedEntries, bw.groupedEntries)
      );
    }

    case "work-live": {
      const bw = b as typeof a;
      return (
        a.createdAt === bw.createdAt &&
        a.groupId === bw.groupId &&
        a.expanded === bw.expanded &&
        Equal.equals(a.entry, bw.entry) &&
        Equal.equals(a.groupedEntries, bw.groupedEntries)
      );
    }

    case "work-toggle": {
      const bw = b as typeof a;
      return (
        a.createdAt === bw.createdAt &&
        a.groupId === bw.groupId &&
        a.hiddenCount === bw.hiddenCount &&
        a.expanded === bw.expanded &&
        a.onlyToolEntries === bw.onlyToolEntries &&
        a.summary === bw.summary &&
        a.summaryKind === bw.summaryKind &&
        a.hasFailure === bw.hasFailure
      );
    }

    case "message": {
      const bm = b as typeof a;
      return (
        a.message === bm.message &&
        a.durationStart === bm.durationStart &&
        a.narration === bm.narration &&
        a.showAssistantMeta === bm.showAssistantMeta &&
        a.showAssistantCopyButton === bm.showAssistantCopyButton &&
        a.assistantCopyStreaming === bm.assistantCopyStreaming &&
        a.assistantTurnDiffSummary === bm.assistantTurnDiffSummary &&
        a.revertTurnCount === bm.revertTurnCount
      );
    }
  }
}
