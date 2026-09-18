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
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
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

function isActivityEntry(entry: TimelineEntry): entry is ActivityEntry {
  return entry.kind === "message"
    ? entry.message.role === "reasoning"
    : entry.kind === "work" &&
        entry.entry.agentSpawn === undefined &&
        entry.entry.questionAnswer === undefined &&
        entry.entry.sourceActivityKind !== "context-compaction" &&
        entry.entry.tone !== "error";
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
      kind: "turn-fold";
      id: string;
      createdAt: string;
      turnId: TurnId;
      label: string;
      expanded: boolean;
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
      kind: "working";
      id: string;
      createdAt: string | null;
      showThinking: boolean;
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

interface TurnFold {
  turnId: TurnId;
  createdAt: string;
  hiddenEntries: ReadonlySet<TimelineEntry>;
  label: string;
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

function lastUserMessageIndex(timelineEntries: ReadonlyArray<TimelineEntry>): number {
  return timelineEntries.findLastIndex(
    (entry) => entry.kind === "message" && entry.message.role === "user",
  );
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

/**
 * Settled turns keep their first and terminal assistant messages visible.
 * Everything between them folds behind a "Worked for ..." row anchored at
 * the first hidden entry. Keeping both ends prevents a short follow-up from
 * hiding a substantive opening response while still bounding noisy turns.
 */
function deriveTurnFolds(input: {
  timelineEntries: ReadonlyArray<TimelineEntry>;
  terminalAssistantMessageIds: ReadonlySet<string>;
  latestTurn: TimelineLatestTurn | null;
  unsettledTurnId: TurnId | null;
}): ReadonlyMap<TimelineEntry, TurnFold> {
  interface TurnGroup {
    entries: Array<TimelineEntry>;
    terminalEntry: Extract<TimelineEntry, { kind: "message" }> | null;
    hasStreamingMessage: boolean;
    /**
     * The user message that kicked the turn off. Entry timestamps alone
     * undercount the duration (the first entry appears only once the
     * provider starts producing output), and a turn cut short by a steer may
     * hold a single instantaneous commentary message.
     */
    startBoundary: string | null;
  }
  const groupsByTurnId = new Map<TurnId, TurnGroup>();

  let pendingUserBoundary: string | null = null;
  for (const entry of input.timelineEntries) {
    if (entry.kind === "message" && entry.message.role === "user") {
      pendingUserBoundary = entry.message.createdAt;
      continue;
    }
    // Thinking is work, so it folds with the rest of it. A provider that
    // interleaves a block with every tool call would otherwise leave dozens of
    // "Thought" rows standing beside the "Worked for ..." summary. Nothing
    // folds while the turn is live, which is when traces are watched.
    const turnId =
      entry.kind === "message" &&
      (entry.message.role === "assistant" || entry.message.role === "reasoning")
        ? (entry.message.turnId ?? null)
        : entry.kind === "work" || entry.kind === "generic-call"
          ? (entry.entry.turnId ?? null)
          : entry.kind === "operation"
            ? (entry.operation.turnId as TurnId | null)
            : null;
    if (!turnId) {
      continue;
    }
    let group = groupsByTurnId.get(turnId);
    if (!group) {
      group = {
        entries: [],
        terminalEntry: null,
        hasStreamingMessage: false,
        // Each user boundary starts at most one turn; a second turn after the
        // same user message (e.g. a steer-superseded continuation) falls back
        // to its own first entry.
        startBoundary: pendingUserBoundary,
      };
      pendingUserBoundary = null;
      groupsByTurnId.set(turnId, group);
    }
    group.entries.push(entry);
    if (entry.kind === "message") {
      if (input.terminalAssistantMessageIds.has(entry.message.id)) {
        group.terminalEntry = entry;
      }
      // A live turn is already excluded below, so only an answer still being
      // written may hold a fold open. A thinking block stranded by a crashed
      // provider keeps its streaming flag forever and must not.
      if (entry.message.streaming && entry.message.role !== "reasoning") {
        group.hasStreamingMessage = true;
      }
    }
  }

  const foldsByAnchorEntry = new Map<TimelineEntry, TurnFold>();
  for (const [turnId, group] of groupsByTurnId) {
    if (turnId === input.unsettledTurnId) {
      continue;
    }
    if (group.hasStreamingMessage) {
      continue;
    }
    const firstAssistantEntry = group.entries.find(
      (entry): entry is Extract<TimelineEntry, { kind: "message" }> =>
        entry.kind === "message" && entry.message.role !== "reasoning",
    );
    const hiddenEntries = new Set<TimelineEntry>();
    for (const entry of group.entries) {
      if (entry === firstAssistantEntry || entry === group.terminalEntry) {
        continue;
      }
      // User input and subagent batches stay visible after their turn settles.
      if (
        entry.kind === "work" &&
        (entry.entry.questionAnswer !== undefined || entry.entry.agentSpawn !== undefined)
      ) {
        continue;
      }
      // Operation cards never fold either: they are the durable outcomes a
      // settled turn needs to leave readable.
      if (entry.kind === "operation") {
        continue;
      }
      hiddenEntries.add(entry);
    }
    if (hiddenEntries.size === 0) {
      continue;
    }
    // A lone compaction row stays visible on its own; it only folds away as
    // part of a turn that already folds other work. Thinking is the same: a
    // question answered by thought alone keeps its "Thought" row rather than
    // collapsing behind a "Worked for ..." that hides nothing else.
    const hidesFoldableWork = group.entries.some(
      (entry) =>
        hiddenEntries.has(entry) &&
        !(entry.kind === "work" && entry.entry.sourceActivityKind === "context-compaction") &&
        !(entry.kind === "message" && entry.message.role === "reasoning"),
    );
    if (!hidesFoldableWork) {
      continue;
    }

    const firstEntry = group.entries[0];
    const firstHiddenEntry = group.entries.find((entry) => hiddenEntries.has(entry));
    const lastEntry = group.entries.at(-1);
    if (!firstEntry || !firstHiddenEntry || !lastEntry) {
      continue;
    }

    const isLatestInterruptedTurn =
      input.latestTurn?.turnId === turnId && input.latestTurn.state === "interrupted";
    // A turn cut short by a steer leaves trailing work entries behind its
    // terminal message — take whichever ended last.
    const lastEntryEnd =
      lastEntry.kind === "message" ? lastEntry.message.updatedAt : lastEntry.createdAt;
    const elapsedMs =
      input.latestTurn?.turnId === turnId &&
      input.latestTurn.startedAt &&
      input.latestTurn.completedAt
        ? computeElapsedMs(input.latestTurn.startedAt, input.latestTurn.completedAt)
        : computeElapsedMs(
            group.startBoundary ?? firstEntry.createdAt,
            maxIsoTimestamp(group.terminalEntry?.message.updatedAt ?? null, lastEntryEnd) ??
              lastEntryEnd,
          );
    const duration = elapsedMs !== null ? formatDuration(elapsedMs) : null;
    const label = isLatestInterruptedTurn
      ? duration
        ? `You stopped after ${duration}`
        : "You stopped this response"
      : duration
        ? `Worked for ${duration}`
        : "Worked";

    foldsByAnchorEntry.set(firstHiddenEntry, {
      turnId,
      createdAt: firstHiddenEntry.createdAt,
      hiddenEntries,
      label,
    });
  }
  return foldsByAnchorEntry;
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
  const foldsByAnchorEntry = deriveTurnFolds({
    timelineEntries,
    terminalAssistantMessageIds,
    latestTurn: input.latestTurn ?? null,
    unsettledTurnId,
  });
  const collapsedEntries = new Set<TimelineEntry>();
  for (const fold of foldsByAnchorEntry.values()) {
    if (!input.expandedTurnIds?.has(fold.turnId)) {
      for (const entry of fold.hiddenEntries) {
        collapsedEntries.add(entry);
      }
    }
  }

  let activeTurnHeaderIndex = timelineEntries.length;
  if (input.isWorking) {
    const latestUserMessageIndex = lastUserMessageIndex(timelineEntries);
    const firstOwnedAfterUser =
      unsettledTurnId === null
        ? -1
        : timelineEntries.findIndex(
            (entry, index) =>
              index > latestUserMessageIndex && timelineEntryTurnId(entry) === unsettledTurnId,
          );
    activeTurnHeaderIndex =
      firstOwnedAfterUser >= 0 ? firstOwnedAfterUser : latestUserMessageIndex + 1;
  }
  const entryBelongsToActiveTurn = (entry: TimelineEntry, index: number) =>
    input.isWorking &&
    index >= activeTurnHeaderIndex &&
    (unsettledTurnId === null || timelineEntryTurnId(entry) === unsettledTurnId);
  // Runs of thinking and tool calls in one turn become a single activity row,
  // so a provider that thinks between every tool call does not stack "Thought"
  // rows between the calls. A run without thinking stays ordinary tool work.
  const activityGroupsByStart = new Map<
    TimelineEntry,
    { entries: ActivityEntry[]; end: number; turnId: TurnId; active: boolean }
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
    let cursor = index + 1;
    while (cursor < timelineEntries.length) {
      const next = timelineEntries[cursor]!;
      if (
        !isActivityEntry(next) ||
        timelineEntryTurnId(next) !== turnId ||
        collapsedEntries.has(next) ||
        foldsByAnchorEntry.has(next) ||
        (input.isWorking && cursor === activeTurnHeaderIndex)
      ) {
        break;
      }
      entries.push(next);
      cursor += 1;
    }
    if (entries.some((candidate) => candidate.kind === "message")) {
      const lastWork = entries.findLast(
        (candidate): candidate is Extract<ActivityEntry, { kind: "work" }> =>
          candidate.kind === "work" && workEntryIsVisibleInGroup(candidate.entry, true),
      );
      const active =
        input.isWorking &&
        turnId === unsettledTurnId &&
        cursor === timelineEntries.length &&
        !(lastWork && workEntryDisplayIndicatesToolFailure(lastWork.entry));
      activityGroupsByStart.set(entry, { entries, end: cursor, turnId, active });
      for (const member of entries) activityGroupEntries.add(member);
    }
    index = cursor;
  }
  const hasActiveActivityGroup = [...activityGroupsByStart.values()].some((group) => group.active);
  const workEntryIsInActiveRun = (entry: WorkLogEntry) =>
    input.isWorking &&
    unsettledTurnId !== null &&
    entry.toolLifecycleStatus === "inProgress" &&
    entry.turnId === unsettledTurnId;
  const isVisibleActiveToolEntry = (entry: WorkLogEntry) =>
    workLogEntryIsToolLike(entry) && workEntryIsVisibleInGroup(entry, true);
  const activeEntries = input.isWorking
    ? timelineEntries.filter((entry, index) => entryBelongsToActiveTurn(entry, index))
    : [];
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
  const activeToolEntries: Array<Extract<TimelineEntry, { kind: "work" }>> = [];
  for (let index = timelineEntries.length - 1; index >= activeTurnHeaderIndex; index -= 1) {
    const entry = timelineEntries[index]!;
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
  const activeWorkPlacementEntry = latestActiveToolEntry;
  const activeWorkRow =
    activeWorkAnchor && latestActiveToolEntry
      ? (() => {
          const groupId = workGroupId(activeWorkAnchor.id, activeWorkAnchor.entry);
          return {
            kind: "work-live" as const,
            id: `work-live:${workGroupIdentity(activeWorkAnchor.id, activeWorkAnchor.entry)}`,
            createdAt: activeWorkAnchor.createdAt,
            entry: latestActiveToolEntry.entry,
            groupedEntries: visibleActiveToolEntries.map((entry) => entry.entry),
            groupId,
            expanded: input.expandedWorkGroupIds?.has(groupId) ?? false,
          };
        })()
      : null;
  const appendWorkingRow = () => {
    nextRows.push({
      kind: "working",
      id: "working-indicator-row",
      createdAt: input.activeTurnStartedAt,
      // A live activity row already says "Thinking" or names the running tool.
      showThinking:
        activeWorkRow === null && !activeTurnHasVisibleContent && !hasActiveActivityGroup,
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

    if (input.isWorking && index === activeTurnHeaderIndex) {
      appendWorkingRow();
    }

    if (timelineEntry === activeWorkPlacementEntry) {
      appendActiveWorkRows();
    }

    const anchoredTurnFold = foldsByAnchorEntry.get(timelineEntry);
    if (anchoredTurnFold) {
      nextRows.push({
        kind: "turn-fold",
        id: `turn-fold:${anchoredTurnFold.turnId}`,
        createdAt: anchoredTurnFold.createdAt,
        turnId: anchoredTurnFold.turnId,
        label: anchoredTurnFold.label,
        expanded: input.expandedTurnIds?.has(anchoredTurnFold.turnId) ?? false,
      });
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
      let cursor = index + 1;
      while (cursor < timelineEntries.length) {
        const nextEntry = timelineEntries[cursor];
        if (
          !nextEntry ||
          // An "operation" row (like any other non-"work" kind) ends the run.
          nextEntry.kind !== "work" ||
          nextEntry.entry.questionAnswer !== undefined ||
          nextEntry.entry.sourceActivityKind === "context-compaction" ||
          nextEntry.entry.tone === "error" ||
          activeWorkEntries.has(nextEntry) ||
          collapsedEntries.has(nextEntry) ||
          foldsByAnchorEntry.has(nextEntry)
        ) {
          break;
        }
        groupedEntries.push(nextEntry.entry);
        cursor += 1;
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
            id: `work-live:${workGroupIdentity(timelineEntry.id, timelineEntry.entry)}`,
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
            id: `work-toggle:${timelineEntry.id}`,
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
              id: `work-toggle:${timelineEntry.id}`,
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
      index = cursor - 1;
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

  if (input.isWorking && activeTurnHeaderIndex === timelineEntries.length) {
    appendWorkingRow();
  }

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
    // Visible assistant text decides whether the working row shows "Thinking".
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

    case "working":
      return (
        a.createdAt === (b as typeof a).createdAt && a.showThinking === (b as typeof a).showThinking
      );

    case "turn-fold": {
      const bf = b as typeof a;
      return a.createdAt === bf.createdAt && a.label === bf.label && a.expanded === bf.expanded;
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
        a.showAssistantMeta === bm.showAssistantMeta &&
        a.showAssistantCopyButton === bm.showAssistantCopyButton &&
        a.assistantCopyStreaming === bm.assistantCopyStreaming &&
        a.assistantTurnDiffSummary === bm.assistantTurnDiffSummary &&
        a.revertTurnCount === bm.revertTurnCount
      );
    }
  }
}
