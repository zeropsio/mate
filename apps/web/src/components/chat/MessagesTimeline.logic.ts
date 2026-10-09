import {
  type EngineCardPaging,
  type EngineRunCard,
  type MateLimit,
} from "@t3tools/client-runtime/data";
import { isUsageLimitError } from "@t3tools/client-runtime/data";
import { HISTORY_CUT_KIND } from "@t3tools/client-runtime/data";
import type { MateTintId } from "@t3tools/shared/brand";
import { sameValue } from "../../lib/sameValue";
import {
  batchesByTiming,
  liveBatch,
  type BatchRule,
  type LiveBatch,
} from "@t3tools/shared/liveBatch";
import type { ChangeLandedEvent } from "@t3tools/client-runtime/zerops";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import type { AgentPanelModel } from "@t3tools/client-runtime/state/subagentRuntime";
import {
  type CrewSeam,
  type MessageId,
  type OrchestrationLatestTurn,
  type TurnId,
} from "@t3tools/contracts";

import {
  inferCheckpointTurnCountByTurnId,
  workEntryDisplayIndicatesToolFailure,
  workEntryIndicatesToolNeutralStatus,
  type TimelineEntry,
  type TurnPlanEntry,
  type WorkLogEntry,
} from "../../session-logic";
import { type ChatMessage, type ProposedPlan, type TurnDiffSummary } from "../../types";
import type { ZeropsMateIdentity } from "../../zerops/mateIdentities";
import type { ConversationSpeaker } from "./ConversationRows";
import type { QueuedComposerMessage } from "../../queuedMessageStore";
import {
  activityCounts,
  checksStrip,
  deriveConversationStructure,
  deriveOutcome,
  outcomeDraws,
  turnsAfter,
  isActivityWork,
  isImageOnlyPlaceholder,
  isQuestionToolCall,
  isResumePrompt,
  isUserMessageEntry,
  messageReceipt,
  crewCardOf,
  turnsThatCame,
  readSlashCommand,
  stretchFace,
  standingIncidents,
  stretchIncidents,
  timelineEntryEnd,
  type BrowserStripModel,
  type ConversationTurn,
  type CrewCard,
  type IncidentModel,
  type MessageEntry,
  type OutcomeActivity,
  type OutcomeModel,
  type SlashCommand,
  type Stretch,
  type BrokeOff,
  type WorkLineFace,
  saysNothing,
} from "./conversation.logic";
import {
  foldSteps,
  stepOf,
  backgroundJobOf,
  trackCommands,
  trackedReadsOf,
  type BackgroundJob,
  type TrackedCommands,
  type WorkStep,
} from "./workSteps.logic";
import type { LiveJobs } from "./liveJobs.logic";
import { heldLines, withPagedEffort } from "../../zerops/engineCardPaging.logic";
import { chatItemHasLine, selectChatItems, slotModelOf } from "./runCard.logic";
import { vaultAskOf } from "../zerops/vault/vaultRequest.logic";

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
  /**
   * The thought it is thinking, as far as it got — keyed as the record will
   * key it once it ends, so its bubble stays the same bubble — or none yet
   * between two steps.
   */
  | {
      readonly kind: "thinking";
      readonly key: string | null;
      readonly messages: ReadonlyArray<ChatMessage>;
    }
  /**
   * It writes: its words as they come, the working row's until the run ends
   * (D4) — keyed as the record will key the note they become.
   */
  | {
      readonly kind: "writing";
      readonly note?: { readonly key: string; readonly message: ChatMessage };
    }
  /** Its turns are over and the helpers it launched work on: the run waits on them (run 11). */
  | { readonly kind: "after" }
  /**
   * It asked the person something — a question, an approval — and waits; a
   * question it asked in its own words is the record's item `key` too.
   */
  | {
      readonly kind: "waiting";
      readonly on: "answer" | "approval";
      readonly key?: string;
      /** An approval: what it asks to run — the controls are the composer's. */
      readonly asked?: ReadonlyArray<LiveCall>;
    }
  /**
   * The calls it is making, the newest as the step or the platform operation
   * it is, and any others of its batch, oldest first.
   */
  | {
      readonly kind: "step";
      readonly step: WorkStep;
      readonly others?: ReadonlyArray<LiveCall>;
    }
  | {
      readonly kind: "operation";
      readonly operation: ZeropsOperation;
      readonly others?: ReadonlyArray<LiveCall>;
    };

/** One call the Mate waits on: a step of its own, or a platform operation. */
export type LiveCall =
  | { readonly kind: "step"; readonly step: WorkStep }
  | { readonly kind: "operation"; readonly operation: ZeropsOperation };

/** The calls a running activity carries, oldest first; none for one that is no call. */
export function liveCallsOf(now: TurnHeaderActivity | null): ReadonlyArray<LiveCall> {
  if (now === null) return [];
  if (now.kind === "step") return [...(now.others ?? []), { kind: "step", step: now.step }];
  if (now.kind === "operation") {
    return [...(now.others ?? []), { kind: "operation", operation: now.operation }];
  }
  return [];
}

export type ConversationEvent =
  | { readonly type: "landed"; readonly event: ChangeLandedEvent }
  | { readonly type: "compaction"; readonly label: string }
  | { readonly type: "command"; readonly command: SlashCommand; readonly done: boolean }
  /** The server resumed the thread itself after a usage limit reset. */
  | { readonly type: "resumed" }
  /**
   * What woke the Mate as the run went on: a helper, or work it sent to the
   * background, finishing (run 11) — said where the run took it in.
   */
  | {
      readonly type: "woke";
      readonly tasks: number;
      readonly failed: number;
      readonly helpers: boolean;
      readonly title: string | null;
    };

/** A run as its status says it: who, whether it still works, and for how long. */
export interface RunStatus {
  readonly interruption?: import("@t3tools/contracts").MateInterruption;
  readonly live: boolean;
  readonly face: WorkLineFace;
  readonly startedAt: string;
  readonly endedAt: string | null;
  /** How long the run waited on the person — its questions and approvals — which is not the Mate's work. */
  readonly waitedMs: number;
  /** Live, when the wait still open began: the clock stands still until the person answers. */
  readonly waitingSince: string | null;
  /** It did something — a call, a helper, an operation: it "worked", never only "thought". */
  readonly worked: boolean;
  /** It broke off: what its card says under its line (`ConversationTurn.brokeOff`). */
  readonly brokeOff?: BrokeOff | undefined;
}

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
      /** The Mate's last word under a run that has nothing to report: see `FoldsFrom`. */
      foldsFrom?: FoldsFrom;
    }
  | ({
      /**
       * The run's line where it has no chat to end on — a run that only
       * asked for a plan's approval, or paused before it did anything: who,
       * whether it still works, and its time. A run with a chat says the
       * same on the chat's last line instead (`record.status`), never at the
       * top of its card (the owner, 2026-09-28: "it doesn't need to be at the
       * top"). Its height never changes.
       */
      kind: "work-line";
      id: string;
      createdAt: string;
      stretchKey: string;
      turnId: TurnId | null;
    } & RunStatus)
  | {
      /**
       * The run's record: everything the Mate did, in the order it did it —
       * its thinking a line each, its words in its bubble, each call a step,
       * each operation a line — in one scroll that follows its end. Live, the
       * one thing it is on this second stands at the end beside its face, and
       * joins the record once it ends, so nothing is ever drawn twice. It
       * stays on the page once the run is over, in the same scroll.
       */
      kind: "record";
      id: string;
      createdAt: string;
      turnKey: string;
      /** The turn it draws (an engine card's id: what it holds of a long run, `engineCardPaging`). */
      turnId?: TurnId | null;
      live: boolean;
      items: ReadonlyArray<RecordItem>;
      /** The held, eligible sequence; raw items retain recovery and slot identity evidence. */
      chatItems: ReturnType<typeof selectChatItems>;
      paging: EngineCardPaging | null;
      hasWork: boolean;
      slot: ReturnType<typeof slotModelOf> & { readonly record: ReadonlyArray<RecordItem> };
      /** What its hands are on right now, the newest bubble; null once the run is over. */
      now: TurnHeaderActivity | null;
      /** Its answer streams under the card: nothing of its own is on its way into the chat. */
      answering: boolean;
      /**
       * Who worked and for how long, on the chat's last line beside the
       * Mate's face — on the run's last record only; null on a card the
       * person's words broke off above it.
       */
      status: RunStatus | null;
      /**
       * What the run came to, for its worked line's effort after its time
       * ("2 commands · 1 file read", `useRunEffortWords`, which follows a
       * change merged since); null while it runs.
       */
      outcome: OutcomeModel | null;
    }
  | {
      /**
       * What runs alongside the Mate while it works, under its record: a
       * status bar each for a deploy, a service in trouble, the task list,
       * the helpers and the background tasks. It is the card's bottom, so it
       * may change; settling turns it into the run's result.
       */
      kind: "working";
      id: string;
      createdAt: string;
      stretchKey: string;
      turnKey: string;
      /** The card it stands in: its line and edge are keyed by it. */
      cardKey: string;
      incidents: ReadonlyArray<IncidentModel>;
      /** The run's turns are over and what it started runs on: it carries the way to stop it. */
      waiting?: boolean;
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
      /** Work no run owns, drawn as it always was: a line of its own. */
      kind: "work";
      id: string;
      createdAt: string;
      groupedEntries: WorkLogEntry[];
      isExpandedToolGroupEntry: boolean;
    }
  | {
      /** An operation no run owns: its card is all there is of it. */
      kind: "operation";
      id: string;
      createdAt: string;
      operation: ZeropsOperation;
    }
  | { kind: "event"; id: string; createdAt: string; event: ConversationEvent }
  /** The task the server handed a crewmate: its card, never the person's bubble. */
  | { kind: "crew-card"; id: string; createdAt: string; task: CrewCard }
  /** A line the crew engine drew across a crewmate's chat (`crew.seam`), `words` its words. */
  | { kind: "crew-seam"; id: string; createdAt: string; seam: CrewSeam; words: string }
  | {
      /** The bottom edge of a stretch's card: nothing but the frame closing. */
      kind: "card-end";
      id: string;
      createdAt: string;
    }
  | {
      /**
       * Background work as one quiet line: work that finished outside any
       * turn, or the helpers and tasks whose results woke the run under it —
       * drawn only over a run that shows something.
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
      /**
       * The commands a settled turn sent to the background, on its own card
       * (`jobs:` rows): each job as it stands now, running or reported.
       */
      jobs?: ReadonlyArray<BackgroundJob>;
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
      /** The provider named by this refusal, never the current composer choice. */
      provider?: string;
      /** When the Mate picked up again, once it has. */
      resumedAt: string | null;
      /** Attempts the same limit refused after this one. */
      held: number;
    }
  | { kind: "outcome"; id: string; createdAt: string; outcome: OutcomeModel }
  | {
      /**
       * A value the Mate asked the person for (`zerops_env action=request`): theirs to answer, so
       * it stands after the run and its answer, never folded away with the work.
       */
      kind: "vault-request";
      id: string;
      createdAt: string;
      operation: ZeropsOperation;
    }
  | {
      /** A quiet line where a day begins, or where the conversation went quiet for a while. */
      kind: "seam";
      id: string;
      createdAt: string;
      /**
       * A new day, a long quiet stretch, where the person left off last time, or where the
       * history import cut the conversation's earlier turns (`words` says what stayed behind).
       */
      seam: "day" | "gap" | "new" | "cut";
      words?: string;
    }
  | { kind: "proposed-plan"; id: string; createdAt: string; proposedPlan: ProposedPlan }
  | {
      kind: "queued-message";
      id: string;
      createdAt: string;
      queuedMessage: QueuedComposerMessage;
      /** Oldest queued message, the one the next boundary sends. */
      isNext: boolean;
      /** A message ahead of it is held: it waits for that one. */
      heldAhead: boolean;
    };

/**
 * How much room a row keeps above itself — the conversation's rhythm, read
 * from the row before it. A turn is one group: the person's words, the card
 * of the Mate's work and its answer stand 24 px apart, ink to ink (`part`),
 * and 64 px of air open the next turn (`turn`), so the eye finds turns
 * without reading. The Mate's answer is prose: its first line's leading is
 * part of the room above it (`part-words`), and its leading and its copy line
 * are part of the room under it (`turn-after-words`). Inside a card, and
 * between a person's messages in a run, rows sit closer (`tight`, `line`,
 * `block`). A row's gap depends only on its predecessor, so it never changes
 * once both are on screen (opening a log changes the row after it — a click
 * moves what is under it, nothing else does).
 */
export type RowGap =
  | "none"
  | "tight"
  | "line"
  | "block"
  | "part"
  | "part-words"
  | "turn"
  | "turn-after-words";

/**
 * The run whose Mate at work stood where this row now begins: a run with
 * nothing to report settles into its line alone, and the Mate's last word
 * under it eases up from where the panel stood instead of jumping. Whether it
 * does is the page's to know — only a panel it just drew folds.
 */
export interface FoldsFrom {
  readonly turnKey: string;
  /** The card the panel stood in: its line and edge are keyed by it. */
  readonly cardKey: string;
  /** The panel's card closed with it: its bottom edge is gone too. */
  readonly cardClosed: boolean;
}

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

/**
 * One thing a run's record holds, at the moment it happened — its `key`
 * stable from its first sight, so the record only ever grows at its end.
 */
export type RecordItem =
  /** A call it made: in words, its command after them, how long. */
  | {
      readonly kind: "step";
      readonly key: string;
      readonly at: string;
      readonly step: WorkStep;
      /**
       * While the run goes on, a line that folds calls in a row (`foldSteps`)
       * carries each as a line of its own: the live slot draws one it still
       * holds as it ended, and the history folds it in once it lands.
       */
      readonly parts?: ReadonlyArray<{
        readonly kind: "step";
        readonly key: string;
        readonly at: string;
        readonly step: WorkStep;
      }>;
    }
  /** A stretch of thinking, however short: a bubble of its own, and how long it took. */
  | {
      readonly kind: "thought";
      readonly key: string;
      readonly at: string;
      readonly messages: ReadonlyArray<ChatMessage>;
      readonly durationMs: number | null;
    }
  /**
   * A question it asked the person with its question tool, in its own words:
   * its side of the card, in its tint — the person's answer, their item under
   * it — asked and waiting, or answered.
   */
  | {
      readonly kind: "question";
      readonly key: string;
      readonly at: string;
      readonly questions: ReadonlyArray<string>;
    }
  /** Its words to the person on the way, in full. */
  | {
      readonly kind: "note";
      readonly key: string;
      readonly at: string;
      readonly message: ChatMessage;
    }
  /**
   * Where the person spoke into the run: a message sent into it stands on
   * the page above the card, and the chat marks here, in one line, where it
   * reached the Mate; their answer to its question stands here whole, under
   * the question, and nowhere else.
   */
  | {
      readonly kind: "person";
      readonly key: string;
      readonly at: string;
      /** A message sent into the run; an answer has its words instead. */
      readonly message?: ChatMessage;
      readonly words?: string;
      /** The client's own placeholder stands in for the text: the message is its images. */
      readonly imageOnly: boolean;
    }
  /** A platform operation, once it settled: one line, its card a click away. */
  | {
      readonly kind: "operation";
      readonly key: string;
      readonly at: string;
      readonly operation: ZeropsOperation;
      /**
       * Its call never returned: "stale" while the run goes on (a newer batch
       * started), "closed" once it settled without it — "No result".
       */
      readonly noResult?: "stale" | "closed";
    }
  /** Helpers it started, a batch or a workflow at once. */
  | {
      readonly kind: "helpers";
      readonly key: string;
      readonly at: string;
      readonly entry: WorkLogEntry;
    }
  /** A background task or a helper reporting back: where its result reached the run. */
  | {
      readonly kind: "task";
      readonly key: string;
      readonly at: string;
      readonly entry: WorkLogEntry;
    }
  /** Its to-do list: one line for the run, its latest state. */
  | {
      readonly kind: "plan";
      readonly key: string;
      readonly at: string;
      readonly plan: TurnPlanEntry;
    }
  /** The browser checks a settled stretch made: a frame per take. */
  | {
      readonly kind: "strip";
      readonly key: string;
      readonly at: string;
      readonly strip: BrowserStripModel;
    }
  /** A service that stopped answering, once the stretch is over. */
  | {
      readonly kind: "incident";
      readonly key: string;
      readonly at: string;
      readonly incident: IncidentModel;
    }
  | {
      readonly kind: "event";
      readonly key: string;
      readonly at: string;
      readonly event: ConversationEvent;
    }
  /** A line the crew engine drew across a crewmate's chat while it ran (`crew.seam`). */
  | {
      readonly kind: "crew-seam";
      readonly key: string;
      readonly at: string;
      readonly seam: CrewSeam;
      readonly words: string;
    }
  /** Something that stopped it: an error it could not work past. */
  | {
      readonly kind: "error";
      readonly key: string;
      readonly at: string;
      readonly entry: WorkLogEntry;
    }
  /** Any other call: said as a step. */
  | {
      readonly kind: "call";
      readonly key: string;
      readonly at: string;
      readonly entry: WorkLogEntry;
    };

export type MessagesTimelineRow = MessagesTimelineRowBody & {
  readonly gap?: RowGap;
  readonly card?: CardSlice;
  /**
   * Nothing stands in this row's card but its line's row: a settled run with
   * nothing to report, or a live one with nothing running alongside it. That
   * row draws the card whole, so its corners are its own — the composer's
   * around the line alone, the card's once more stands in it — and the rest
   * of its rows draw nothing (`[data-card-whole]`). On each of its rows.
   */
  readonly cardWhole?: true;
};

function isPersonRow(row: MessagesTimelineRow): boolean {
  return (row.kind === "message" && row.message.role === "user") || row.kind === "queued-message";
}

function closesTurn(row: MessagesTimelineRow): boolean {
  return (row.kind === "message" && row.message.role === "assistant") || row.kind === "outcome";
}

/** The Mate talking to the person: its line of copy and time keeps room under it already. */
function isMateProse(row: MessagesTimelineRow): boolean {
  return row.kind === "message" && row.message.role === "assistant";
}

/**
 * What stands where the person's message would, opening a run nobody typed:
 * a command, a resume, the task handed to a crewmate, what woke the Mate
 * (`woke:` — background work no run owns is a line of its own, not an opener).
 */
function opensRun(row: MessagesTimelineRow): boolean {
  return (
    (row.kind === "background" && row.id.startsWith("woke:")) ||
    row.kind === "crew-card" ||
    (row.kind === "event" && (row.event.type === "command" || row.event.type === "resumed"))
  );
}

/** The room that opens a new turn under `previous`: after an answer, its copy line is part of it. */
function turnAfter(previous: MessagesTimelineRow): RowGap {
  return isMateProse(previous) ? "turn-after-words" : "turn";
}

export function rowGap(
  previous: MessagesTimelineRow | undefined,
  row: MessagesTimelineRow,
): RowGap {
  if (previous === undefined) return "none";
  // What runs alongside hangs from the record; the record starts its card,
  // as a run's line with no chat does.
  if (row.kind === "working") return "tight";
  // A seam opens the turn under it: a turn's air above it, a part's under it.
  if (row.kind === "seam" || row.kind === "crew-seam") return turnAfter(previous);
  if (previous.kind === "seam" || previous.kind === "crew-seam")
    return isMateProse(row) ? "part-words" : "part";
  if (isPersonRow(row)) {
    if (isPersonRow(previous)) return "tight";
    // A message waiting to be sent goes into the run on screen, and what the
    // person said into a run nobody typed is that run's: parts of its turn.
    if (opensRun(previous) || (row.kind === "queued-message" && !isMateProse(previous)))
      return "part";
    return turnAfter(previous);
  }
  // The answer is the turn's last part, under the card or the words it answers.
  if (isMateProse(row)) return isMateProse(previous) ? "block" : "part-words";
  if (row.kind === "record" || row.kind === "work-line") {
    // The card under the words that started its run is a part of their turn;
    // a run nobody wrote to start opens a turn of its own.
    return isPersonRow(previous) || opensRun(previous) ? "part" : turnAfter(previous);
  }
  if (opensRun(row)) return isPersonRow(previous) ? "part" : turnAfter(previous);
  if (closesTurn(previous)) return row.kind === "outcome" ? "line" : "block";
  // The result hangs from its heading or its record: they read as one.
  if (row.kind === "outcome" && (previous.kind === "work-line" || previous.kind === "record"))
    return "tight";
  return "line";
}

export interface StableMessagesTimelineRowsState {
  byId: Map<string, MessagesTimelineRow>;
  result: MessagesTimelineRow[];
}

/** A turn's captured work can be rewound even if it failed before an assistant answer. */
function buildRevertTurnCountByUserMessageId(input: {
  supportsConversationRollback: boolean;
  timelineEntries: ReadonlyArray<TimelineEntry>;
  turnDiffSummaryByAssistantMessageId: ReadonlyMap<MessageId, TurnDiffSummary>;
  turnDiffSummaryByTurnId: ReadonlyMap<TurnId, TurnDiffSummary>;
  inferredCheckpointTurnCountByTurnId: Readonly<Record<string, number | undefined>>;
}): Map<MessageId, number> {
  const byUserMessageId = new Map<MessageId, number>();
  const entryCount = input.supportsConversationRollback ? input.timelineEntries.length : 0;
  for (let index = 0; index < entryCount; index += 1) {
    const entry = input.timelineEntries[index];
    if (!entry || entry.kind !== "message" || entry.message.role !== "user") continue;
    const ownSummary =
      entry.message.turnId === null
        ? undefined
        : input.turnDiffSummaryByTurnId.get(entry.message.turnId);
    const ownCount =
      ownSummary?.checkpointTurnCount ??
      (ownSummary === undefined
        ? undefined
        : input.inferredCheckpointTurnCountByTurnId[ownSummary.turnId]);
    if (typeof ownCount === "number") {
      byUserMessageId.set(entry.message.id, Math.max(0, ownCount - 1));
      continue;
    }
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

/**
 * The row a load of earlier turns keeps in place: the first row of the
 * conversation in sight, never a seam — a day's seam moves to the top of what
 * loads, and the list kept it in place while the conversation under it was
 * thrown 3,300 px down (Nova, 2026-09-28).
 */
export function earlierTurnsAnchor(
  rows: ReadonlyArray<{
    readonly id: string;
    readonly kind: string | undefined;
    readonly top: number;
    readonly bottom: number;
  }>,
  viewportTop: number,
): { readonly id: string; readonly top: number } | null {
  let anchor: { readonly id: string; readonly top: number } | null = null;
  for (const row of rows) {
    if (row.kind === "seam" || row.bottom <= viewportTop) continue;
    if (anchor === null || row.top < anchor.top) anchor = { id: row.id, top: row.top };
  }
  return anchor;
}

/** A helper's finish, as the helpers panel knows it: which one, and when. */
export interface HelperFinish {
  readonly id: string;
  readonly title: string;
  readonly finishedAt: string;
  readonly failed: boolean;
}

/** Every helper the panel knows to have finished, done or failed, with its time. */
export function helperFinishesOf(model: AgentPanelModel): HelperFinish[] {
  const agents = [
    ...model.directAgents,
    ...model.workflows.flatMap((group) => [
      ...group.phases.flatMap((phase) => phase.members),
      ...group.unphasedMembers,
    ]),
  ];
  return agents.flatMap((agent) =>
    (agent.status === "completed" || agent.status === "failed") && agent.completedAt
      ? [
          {
            id: agent.id,
            title: agent.title,
            finishedAt: agent.completedAt,
            failed: agent.status === "failed",
          },
        ]
      : [],
  );
}

/**
 * The person's pick, in their words: the "(Recommended)" the Mate put on an
 * option was its advice, not what the person answered (Nova, 2026-09-28: the
 * mark stood in the person's own bubble).
 */
export function answerWords(answer: string): string {
  const words = answer.replace(/\s*\(recommended\)\s*$/iu, "").trim();
  return words.length > 0 ? words : answer;
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

/**
 * Whether an approval the Mate asked for still waits on the person: one asked
 * for and not given yet, the clock standing still meanwhile (`waitedOn`).
 */
function approvalPending(stretch: Stretch): Extract<TimelineEntry, { kind: "work" }> | null {
  const open: Array<Extract<TimelineEntry, { kind: "work" }>> = [];
  for (const entry of stretch.entries) {
    if (entry.kind !== "work") continue;
    if (entry.entry.sourceActivityKind === "approval.requested") open.push(entry);
    else if (entry.entry.sourceActivityKind === "approval.resolved") open.shift();
  }
  return open.at(-1) ?? null;
}

/**
 * How long a run waited, which is not the Mate's work: on the person, from
 * each question or approval it asked to their answer, and on its helpers,
 * from a turn's end to the turn their results woke (review of pass 42: a
 * 20-minute helper between two short turns read "worked 21m"). Live, a wait
 * still open is where the clock stands still; settled, a person's wait
 * lasted to the run's end.
 */
function waitedOn(turn: ConversationTurn): { waitedMs: number; waitingSince: string | null } {
  let waitedMs = 0;
  let since: TimelineEntry | null = null;
  for (const [position, stretch] of turn.stretches.entries()) {
    const before = position === 0 ? null : (turn.stretches[position - 1]?.endedAt ?? null);
    if (stretch.lead === null && before !== null) {
      waitedMs += Math.max(0, Date.parse(stretch.startedAt) - Date.parse(before)) || 0;
    }
    for (const entry of stretch.entries) {
      if (entry.kind !== "work") continue;
      const kind = entry.entry.sourceActivityKind;
      if (kind === "user-input.requested" || kind === "approval.requested") since ??= entry;
      else if ((kind === "user-input.resolved" || kind === "approval.resolved") && since !== null) {
        waitedMs += Math.max(0, Date.parse(entry.createdAt) - Date.parse(since.createdAt)) || 0;
        since = null;
      }
    }
  }
  if (since === null) {
    return {
      waitedMs,
      waitingSince: turn.waiting ? (turn.stretches.at(-1)?.endedAt ?? null) : null,
    };
  }
  if (turn.live) return { waitedMs, waitingSince: since.createdAt };
  const end = turn.stretches.at(-1)?.endedAt ?? null;
  const left = end === null ? 0 : Date.parse(end) - Date.parse(since.createdAt);
  return { waitedMs: waitedMs + (Math.max(0, left) || 0), waitingSince: null };
}

/** A call of the stretch, as the batch rule reads it: a call of the Mate's own, or an operation's. */
type BatchEntry = Extract<TimelineEntry, { kind: "work" | "generic-call" | "operation" }>;

function epoch(iso: string | undefined): number | null {
  if (iso === undefined) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * What the batch rule reads off the whole thread: the calls that returned, by
 * their call id — a start whose completion was filed under another turn, or
 * none, never merged with it (`session-logic` collapses by turn and call id),
 * yet its call returned — and, by the thread's provider, whether a call that
 * names no response goes stale by timing (`batchesByTiming`).
 */
export interface BatchReading extends BatchRule {
  readonly returned: ReadonlySet<string>;
}

export function batchReadingOf(
  entries: ReadonlyArray<TimelineEntry>,
  rule: BatchRule,
): BatchReading {
  const returned = new Set<string>();
  for (const entry of entries) {
    if (entry.kind !== "work" && entry.kind !== "generic-call") continue;
    const { toolCallId, toolLifecycleStatus } = entry.entry;
    if (toolCallId !== undefined && toolLifecycleStatus !== undefined) {
      if (toolLifecycleStatus !== "inProgress") returned.add(toolCallId);
    }
  }
  return { returned, byTiming: rule.byTiming };
}

/** A start whose call's completion stands apart from it in the thread: the completion tells it. */
function startOfAReturnedCall(work: WorkLogEntry, returned: ReadonlySet<string>): boolean {
  return (
    work.toolLifecycleStatus === "inProgress" &&
    work.toolCallId !== undefined &&
    returned.has(work.toolCallId)
  );
}

/** A call's start, return and response, for the batch rule; null for an entry that is no call. */
function batchCallOf(
  entry: TimelineEntry,
  reading: BatchReading,
): {
  readonly startedAt: number | null;
  readonly returnedAt: number | null;
  readonly response?: string | undefined;
} | null {
  if (entry.kind === "operation") {
    const op = entry.operation;
    const response = op.responseId;
    // The call it waits on now: a session's open follow-up, else its founder.
    if (op.openedAt !== undefined && op.phase === "running") {
      return { startedAt: epoch(op.openedAt), returnedAt: null, response };
    }
    const startedAt = epoch(op.anchorAt);
    // Its call returned: a stand-up's builds run on, the Mate waits no more.
    if (op.returnedAt !== undefined) {
      return { startedAt, returnedAt: epoch(op.returnedAt), response };
    }
    // Its call never returned — still running, or cut off as its run ended.
    if (op.phase !== "running" && op.phase !== "interrupted") {
      return { startedAt, returnedAt: epoch(op.settledAt) ?? startedAt, response };
    }
    return { startedAt, returnedAt: null, response };
  }
  if (entry.kind !== "work" && entry.kind !== "generic-call") return null;
  const work = entry.entry;
  if (!isActivityWork(work) || work.toolLifecycleStatus === undefined) return null;
  if (startOfAReturnedCall(work, reading.returned)) return null;
  const response = work.responseId;
  if (work.toolLifecycleStatus === "inProgress") {
    return { startedAt: epoch(work.startedAt ?? work.createdAt), returnedAt: null, response };
  }
  // A completion seen on its own tells that a call returned, never when one
  // started: one no later activity stamped (`updatedAt`). Only the timing
  // rule reads it; a call that names its response goes by the response.
  const alone = work.updatedAt === undefined;
  return {
    startedAt: alone ? null : epoch(work.startedAt ?? work.createdAt),
    returnedAt: epoch(work.updatedAt ?? work.createdAt),
    response,
  };
}

/**
 * The calls by the batch rule (`liveBatch`): the newest batch's still open —
 * what the Mate waits on now — and those an older batch left marked open,
 * stale, each with when it went stale. Read over a whole run, so a call left
 * open before the person wrote into it goes stale too.
 */
export function stretchBatch(
  stretch: Pick<Stretch, "entries">,
  reading: BatchReading,
): LiveBatch<BatchEntry> {
  return liveBatch(
    stretch.entries.flatMap((entry) => {
      const call = batchCallOf(entry, reading);
      return call === null ? [] : [{ item: entry as BatchEntry, ...call }];
    }),
    reading,
  );
}

/**
 * What the Mate's hands are on: waiting for an answer, the calls it waits on
 * — the newest batch's still open, never one an older batch left marked open
 * (`stretchBatch`) — the thought it is thinking, or its words on their way. A
 * thought with a returned call after it is over: the Mate is between steps,
 * and the thought is the record's.
 */
function liveActivity(
  stretch: Stretch,
  writing: MessageEntry | null,
  tracked: TrackedCommands,
  batch: LiveBatch<BatchEntry>,
): TurnHeaderActivity {
  const asked = pendingQuestion(stretch);
  if (asked !== null) return { kind: "waiting", on: "answer", key: `question:${asked.id}` };
  // An operation whose call returned runs on in the band; one whose session's
  // follow-up the Mate waits on (`openedAt`) stands in the slot, a line of
  // its own apart from the session's in the record (`liveCallItem`).
  const open = new Set<TimelineEntry>(
    batch.open.filter(
      (entry) =>
        entry.kind !== "operation" ||
        entry.operation.returnedAt === undefined ||
        entry.operation.openedAt !== undefined,
    ),
  );
  /** The open calls of the batch up to `index`, oldest first, as the slot shows them. */
  const callsTo = (index: number): LiveCall[] =>
    stretch.entries.slice(0, index + 1).flatMap((call): LiveCall[] => {
      if (!open.has(call)) return [];
      if (call.kind === "operation") return [{ kind: "operation", operation: call.operation }];
      if (call.kind !== "work" && call.kind !== "generic-call") return [];
      if (isQuestionToolCall(call.entry)) return [];
      return [{ kind: "step", step: stepOf(call.entry, tracked, true) }];
    });
  const approval = approvalPending(stretch);
  if (approval !== null) {
    // What it asks to run: the call it waits on, else what the request names.
    const calls = callsTo(stretch.entries.length - 1);
    const named = approval.entry.command ?? approval.entry.detail;
    const asking: ReadonlyArray<LiveCall> =
      calls.length > 0
        ? calls
        : named === undefined
          ? []
          : [{ kind: "step", step: stepOf(approval.entry, tracked, true) }];
    return asking.length > 0
      ? { kind: "waiting", on: "approval", asked: asking }
      : { kind: "waiting", on: "approval" };
  }
  if (writing !== null && stretch.entries.includes(writing)) {
    return { kind: "writing", note: { key: `note:${writing.id}`, message: writing.message } };
  }
  let passed = false;
  for (let index = stretch.entries.length - 1; index >= 0; index -= 1) {
    const entry = stretch.entries[index]!;
    if (open.has(entry)) {
      if (
        (entry.kind === "work" || entry.kind === "generic-call") &&
        isQuestionToolCall(entry.entry)
      ) {
        return { kind: "waiting", on: "answer" };
      }
      // Every call of the batch is the slot's, operations too: none of them
      // is in the record until it returns.
      const calls = callsTo(index);
      const newest = calls.at(-1);
      const others = calls.slice(0, -1);
      if (newest === undefined) continue;
      const rest = others.length > 0 ? { others } : {};
      return newest.kind === "step"
        ? { kind: "step", step: newest.step, ...rest }
        : { kind: "operation", operation: newest.operation, ...rest };
    }
    if (entry.kind === "message") {
      // A call that started at the instant the message was stamped is no
      // older than it, whichever the record files first: an open one is what
      // the Mate's hands are on (run 12: a note and a command's start at
      // 14:40:20.255Z read "Thinking" through the whole command).
      const instant = Date.parse(entry.createdAt);
      if (
        stretch.entries
          .slice(0, index)
          .some((earlier) => open.has(earlier) && Date.parse(earlier.createdAt) === instant)
      ) {
        continue;
      }
      if (entry.message.role !== "reasoning" || passed) {
        return { kind: "thinking", key: null, messages: [] };
      }
      // The thought it is thinking: the thinking that closes the stretch.
      const messages: ChatMessage[] = [];
      let start: TimelineEntry = entry;
      for (let back = index; back >= 0; back -= 1) {
        const candidate = stretch.entries[back]!;
        if (candidate.kind !== "message" || candidate.message.role !== "reasoning") break;
        messages.unshift(candidate.message);
        start = candidate;
      }
      return { kind: "thinking", key: `thought:${start.id}`, messages };
    }
    passed = true;
  }
  return { kind: "thinking", key: null, messages: [] };
}

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

const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/**
 * Text cut at its blank lines, except those inside a code block: a block's
 * blank line is its own, whether the block has closed or is still streaming.
 */
function blocksOutsideCode(text: string): string[] {
  const blocks: string[] = [];
  let block = "";
  let openFence: string | null = null;
  const parts = text.split(/(\n\s*\n)/);
  for (let index = 0; index < parts.length; index += 2) {
    const part = parts[index]!;
    block = block.length === 0 ? part : `${block}${parts[index - 1]!}${part}`;
    for (const line of part.split("\n")) {
      const fence = FENCE_LINE.exec(line);
      if (fence === null) continue;
      const marker = fence[1]!;
      if (openFence === null) {
        openFence = marker;
      } else if (
        marker[0] === openFence[0] &&
        marker.length >= openFence.length &&
        fence[2]!.trim() === ""
      ) {
        openFence = null;
      }
    }
    if (openFence === null) {
      blocks.push(block);
      block = "";
    }
  }
  if (block.length > 0) blocks.push(block);
  return blocks;
}

/**
 * A thought's paragraphs, in order; a paragraph that is only a bold title
 * joins the one under it, so a title never stands as a paragraph of its own.
 * Paragraphs only ever append as a thought streams, so their places are
 * stable keys.
 */
export function thoughtParagraphs(text: string): string[] {
  const paragraphs: string[] = [];
  let title: string | null = null;
  for (const block of blocksOutsideCode(text)) {
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
 * A thought's line in the record: its title where it has one (a long thought
 * opens with one in bold), else its first sentence — never the whole wall.
 */
export function thoughtPreview(messages: ReadonlyArray<Pick<ChatMessage, "text">>): string | null {
  const text = messages
    .map((message) => message.text)
    .join("\n\n")
    .trim();
  if (text.length === 0) return null;
  const title = /^\*\*([^*\n]+)\*\*/.exec(text)?.[1]?.trim();
  if (title !== undefined && title.length > 0) return title;
  const plain = text
    .replace(/[*_`#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return /^(.+?[.!?])(?:\s|$)/.exec(plain)?.[1] ?? plain;
}

/**
 * A stretch's part of its run's record, each thing at the moment it happened
 * — the question the Mate asked, and the person's answer under it, among
 * them — and the rows it hands elsewhere: a plan to approve and a usage
 * limit's pause stand in the card after the record.
 *
 * Live, the thought the Mate is thinking and the call it is making are not in
 * it: they are the now line's, beside its face at the card's foot, and join
 * the record once they end, so nothing is ever drawn twice — a browser check
 * too, a row of takes once it is taken. A service's trouble is the working
 * row's status bar while the stretch runs, and the record's once it is over.
 */
function stretchRecord(input: {
  stretch: Stretch;
  answer: MessageEntry | null;
  writing: MessageEntry | null;
  brokeOffEntryId: string | null;
  pauseRow: MessagesTimelineRow | null;
  tracked: TrackedCommands;
  /** When the run ended; null while it runs. What reported after it is the next run's to tell. */
  until: string | null;
  /** The thread's calls as the batch rule reads them (`batchReadingOf`). */
  reading: BatchReading;
  /** The whole run's calls by the batch rule. */
  batch: LiveBatch<BatchEntry>;
}): { items: RecordItem[]; rows: MessagesTimelineRow[] } {
  const { stretch } = input;
  const placed: Array<{ readonly order: number; readonly item: RecordItem }> = [];
  const rows: MessagesTimelineRow[] = [];
  let order = 0;
  const push = (item: RecordItem) => {
    placed.push({ order: order++, item });
  };
  /**
   * A browser check is a step: the now line's while it is taken, its row of
   * the chat once it is (K10), and a check that follows it with nothing
   * between shares the row: a page checked on a desktop and then on a phone
   * is one row of takes. A check after other work starts a row of its own,
   * so a row above the newest never grows.
   */
  const joinCheck = (check: ZeropsOperation, at: string) => {
    const last = placed.at(-1);
    if (last !== undefined && last.item.kind === "strip") {
      placed[placed.length - 1] = {
        order: last.order,
        item: {
          ...last.item,
          strip: checksStrip([...last.item.strip.checks, check], stretch.live),
        },
      };
      return;
    }
    push({
      kind: "strip",
      key: `operation:${check.key}`,
      at,
      strip: checksStrip([check], stretch.live),
    });
  };

  // While the run goes on its services in trouble are what runs alongside,
  // the whole run's: a message sent into it must not move them into the
  // record's middle.
  const runLive = input.until === null;
  const incidentsByKey = new Map(
    (runLive ? [] : stretchIncidents(stretch)).map((incident) => [incident.key, incident] as const),
  );

  /**
   * Where a line stands: when it joined the record — a call when it returned,
   * an operation when it settled — so a line landing never pushes the lines
   * before it down (a call is first seen when it starts, and the Mate's words
   * before it can carry a later time). One still running when the person
   * wrote into the run joined at the end of its part.
   */
  const joinedAt = (ended: string | null, seen: string): string => {
    const partEnded = stretch.live ? null : stretch.endedAt;
    if (ended === null) return partEnded ?? seen;
    return partEnded !== null && Date.parse(partEnded) < Date.parse(ended) ? partEnded : ended;
  };

  // A start its completion never merged with is that completion's line.
  const returnedIds = input.reading.returned;
  // Calls an older batch left marked open, and when each went stale.
  const staleSince = new Map<WorkLogEntry, string>(
    input.batch.stale.flatMap(({ item, since }) =>
      item.kind === "operation" ? [] : [[item.entry, new Date(since).toISOString()] as const],
    ),
  );
  const staleOperationSince = new Map<string, string>(
    input.batch.stale.flatMap(({ item, since }) =>
      item.kind === "operation"
        ? [[item.operation.key, new Date(since).toISOString()] as const]
        : [],
    ),
  );
  let activity: WorkLogEntry[] = [];
  let reasoning: ChatMessage[] = [];
  let reasoningStart: TimelineEntry | null = null;
  // Thinking starts where what came before it ended: the Mate often says its
  // thought only as it acts on it.
  let lastEndAt = stretch.startedAt;
  let thinkingFrom = stretch.startedAt;
  const flushActivity = () => {
    if (activity.length === 0) return;
    // While the run goes on, a call still running in a part the person's
    // message closed is a running line at that part's end; only the one the
    // Mate is making now stands beside its face.
    const entries = omitSupersededLifecycleMarkers(
      // A call that never returned stays: live, the now line's or stale; settled, "No result".
      activity.filter(
        (entry) =>
          workEntryIsVisibleInGroup(entry, true) && !startOfAReturnedCall(entry, returnedIds),
      ),
      (entry) => entry,
    );
    activity = [];
    for (const step of foldSteps(entries, input.tracked, runLive)) {
      // The call it is making stands beside its face until it returns. A
      // command it left running in the background returned: its line is
      // here, running, from the moment it started.
      // One an older batch left marked open never returns (`stretchBatch`):
      // it joins where it went stale, with no time, and settles as "No result".
      const last = step.entries.at(-1)!;
      const staleAt = staleSince.get(last);
      if (runLive && last.toolLifecycleStatus === "inProgress") {
        if (staleAt !== undefined) {
          // Over, in the past tense: an in-progress call never folds into a
          // step (`foldSteps`), so the step is this call alone.
          const over = stepOf(last, input.tracked, false);
          push({
            kind: "step",
            key: `step:${step.key}`,
            at: staleAt,
            step: { ...over, key: step.key, state: "done", endedAt: null, noResult: "stale" },
          });
          continue;
        }
        if (stretch.live) continue;
      }
      const call = step.entries[0]!;
      const at =
        staleAt ??
        joinedAt(
          call.toolLifecycleStatus === "inProgress" ? null : (call.updatedAt ?? call.createdAt),
          call.createdAt,
        );
      const parts =
        runLive && step.entries.length > 1
          ? step.entries.map((entry) => {
              const part = stepOf(entry, input.tracked, false);
              return { kind: "step" as const, key: `step:${part.key}`, at, step: part };
            })
          : undefined;
      push({
        kind: "step",
        key: `step:${step.key}`,
        at,
        step,
        ...(parts === undefined ? {} : { parts }),
      });
    }
  };
  /**
   * A stretch of thinking ends where what came next began; one still going is
   * the Mate's face's to show.
   */
  const flushReasoning = (endedAt: string | null) => {
    if (reasoningStart === null) return;
    const start = reasoningStart;
    const messages = reasoning;
    reasoning = [];
    reasoningStart = null;
    if (endedAt === null && stretch.live) return;
    const measured =
      endedAt === null ? null : Math.max(0, Date.parse(endedAt) - Date.parse(thinkingFrom));
    const durationMs = measured !== null && Number.isFinite(measured) ? measured : null;
    push({
      kind: "thought",
      key: `thought:${start.id}`,
      at: start.createdAt,
      messages,
      durationMs,
    });
  };
  const flush = (at: string | null) => {
    flushReasoning(at);
    flushActivity();
  };

  let previous: TimelineEntry | null = null;
  for (const entry of stretch.entries) {
    if (
      previous !== null &&
      !(previous.kind === "message" && previous.message.role === "reasoning")
    ) {
      const end = timelineEntryEnd(previous);
      if (Date.parse(end) > Date.parse(lastEndAt)) lastEndAt = end;
    }
    previous = entry;
    // Words not placed yet split nothing: a block of thinking drawn around
    // them would have the note land between its halves once it is known. The
    // thinking before them ended where they began, though: it stays in the
    // chat while they are on their way.
    if (entry === input.answer || entry === input.writing) {
      flushReasoning(entry.createdAt);
      continue;
    }
    // The Mate's question tool: the question it asked and the person's answer
    // are lines of the chat, from its request to the person (below), so the
    // call itself is never a line of its own.
    if ((entry.kind === "work" || entry.kind === "generic-call") && isQuestionToolCall(entry.entry))
      continue;
    if (entry.kind === "message") {
      if (entry.message.role === "reasoning") {
        flushActivity();
        if (reasoningStart === null) {
          reasoningStart = entry;
          thinkingFrom =
            Date.parse(lastEndAt) < Date.parse(entry.createdAt) ? lastEndAt : entry.createdAt;
        }
        reasoning.push(entry.message);
        continue;
      }
      flush(entry.createdAt);
      if (!saysNothing(entry.message)) {
        push({
          kind: "note",
          key: `note:${entry.id}`,
          at: entry.createdAt,
          message: entry.message,
        });
      }
      continue;
    }
    if ((entry.kind === "work" || entry.kind === "generic-call") && isActivityWork(entry.entry)) {
      flushReasoning(entry.createdAt);
      activity.push(entry.entry);
      continue;
    }
    // A command's own task is the command's step: no line of its own.
    if (entry.kind === "work" && input.tracked.trackers.has(entry.entry.id)) continue;
    flush(entry.createdAt);
    switch (entry.kind) {
      case "operation": {
        const op = entry.operation;
        const staleAt = staleOperationSince.get(op.key);
        if (op.kind === "browser") {
          // One an older batch left marked open joins where it went stale,
          // and stays there once the run is over.
          if (staleAt !== undefined) {
            joinCheck(op, staleAt);
            break;
          }
          // Taken now, it is the now line's; it joins where it ended.
          if (stretch.live && op.phase === "running") break;
          joinCheck(
            op,
            joinedAt(
              op.phase === "running" ? null : (op.settledAt ?? entry.createdAt),
              op.anchorAt,
            ),
          );
          break;
        }
        const incident = incidentsByKey.get(`incident:${op.key}`);
        if (incident !== undefined) {
          push({ kind: "incident", key: incident.key, at: incident.appearedAt, incident });
        }
        // What the Mate waits on stands in the live slot until its call
        // returns; one that runs on after (a stand-up's builds) is the band's,
        // and its line joins the record where its call returned.
        // Its call never returned: one an older batch left marked open joins
        // where it went stale, and stays there once the run is over.
        const unreturned =
          op.returnedAt === undefined && (op.phase === "running" || op.phase === "interrupted");
        if (unreturned && staleAt !== undefined) {
          push({
            kind: "operation",
            key: `operation:${op.key}`,
            at: staleAt,
            operation: op,
            noResult: runLive ? "stale" : "closed",
          });
          break;
        }
        if (runLive && op.phase === "running" && op.returnedAt === undefined && stretch.live) {
          break;
        }
        // The run is over without it: no result.
        const closed = !runLive && unreturned;
        push({
          kind: "operation",
          key: `operation:${op.key}`,
          at: joinedAt(
            op.returnedAt ?? (op.phase === "running" ? null : (op.settledAt ?? entry.createdAt)),
            entry.createdAt,
          ),
          operation: op,
          ...(closed ? { noResult: "closed" as const } : {}),
        });
        break;
      }
      case "work": {
        const work = entry.entry;
        // What the Mate asked stands in its card, asked and answered, in its
        // own words; while it waits, the composer asks the person too.
        if (work.inputQuestions !== undefined && work.inputAnswers === undefined) {
          const questions = work.inputQuestions
            .map((question) => (question.question || question.header).trim())
            .filter((question) => question.length > 0);
          if (questions.length > 0) {
            push({ kind: "question", key: `question:${entry.id}`, at: entry.createdAt, questions });
          }
          break;
        }
        if (work.interruption !== undefined) {
          break;
        } else if (work.crewSeam !== undefined) {
          push({
            kind: "crew-seam",
            key: `crew-seam:${entry.id}`,
            at: entry.createdAt,
            seam: work.crewSeam,
            words: work.label,
          });
        } else if (work.sourceActivityKind === "context-compaction") {
          push({
            kind: "event",
            key: `event:${entry.id}`,
            at: entry.createdAt,
            event: { type: "compaction", label: work.label },
          });
        } else if (isErrorEntry(entry)) {
          // Pauses and the run's terminal failure already stand outside the log.
          if (!isUsageLimitError(entry) && entry.id !== input.brokeOffEntryId) {
            push({ kind: "error", key: `error:${entry.id}`, at: entry.createdAt, entry: work });
          }
        } else if (work.inputAnswers !== undefined) {
          // The person's answer, in their words, under the question it answers.
          push({
            kind: "person",
            key: `person:${entry.id}`,
            at: entry.createdAt,
            words: work.inputAnswers.map((given) => answerWords(given.answer)).join(" · "),
            imageOnly: false,
          });
        } else if (work.agentSpawn !== undefined) {
          push({ kind: "helpers", key: `helpers:${entry.id}`, at: entry.createdAt, entry: work });
        } else if (isTaskActivityKind(work.sourceActivityKind)) {
          // A task reporting back is a line where its result reached the run.
          // Its start is the call that launched it, and its progress the bars'.
          // A helper's row stands where it was spawned and takes each report
          // as it comes: its line is where it finished, and one that finished
          // after the run is what woke the next, never a line of this record.
          const finishedAt = work.updatedAt ?? entry.createdAt;
          // A task that names no call and ended while a command still runs
          // may be that command's own: it waits for the command to return,
          // so it never stands a moment as a line and then turns into a step.
          const commandStillRuns =
            runLive &&
            work.taskToolUseId === undefined &&
            stretch.entries.some(
              (candidate) =>
                candidate.kind === "work" &&
                candidate.entry.command !== undefined &&
                candidate.entry.toolLifecycleStatus === "inProgress" &&
                Date.parse(candidate.entry.startedAt ?? candidate.entry.createdAt) <=
                  Date.parse(finishedAt),
            );
          if (
            work.sourceActivityKind === "task.completed" &&
            !commandStillRuns &&
            (input.until === null || Date.parse(finishedAt) <= Date.parse(input.until))
          ) {
            push({ kind: "task", key: `task:${entry.id}`, at: finishedAt, entry: work });
          }
        } else {
          push({ kind: "call", key: `call:${entry.id}`, at: entry.createdAt, entry: work });
        }
        break;
      }
      case "change-landed":
        push({
          kind: "event",
          key: `event:${entry.id}`,
          at: entry.createdAt,
          event: { type: "landed", event: entry.event },
        });
        break;
      case "proposed-plan":
        rows.push({
          kind: "proposed-plan",
          id: entry.id,
          createdAt: entry.createdAt,
          proposedPlan: entry.proposedPlan,
        });
        break;
      case "turn-plan":
        push({ kind: "plan", key: `plan:${entry.id}`, at: entry.createdAt, plan: entry.turnPlan });
        break;
      case "generic-call":
        push({ kind: "call", key: `call:${entry.id}`, at: entry.createdAt, entry: entry.entry });
        break;
    }
  }
  // A run's last thinking ended with the run; a live one's is still going.
  flush(stretch.live ? null : stretch.endedAt);
  if (input.pauseRow) rows.push(input.pauseRow);

  const items = placed
    .toSorted(
      (left, right) =>
        Date.parse(left.item.at) - Date.parse(right.item.at) || left.order - right.order,
    )
    .map(({ item }) => item);
  return { items, rows };
}

/** What a settled run's calls came to, and the helpers it started: its effort. */
function turnActivity(turn: ConversationTurn): OutcomeActivity[] {
  const entries = turn.stretches.flatMap((stretch) => stretch.entries);
  const calls = omitSupersededLifecycleMarkers(
    entries.flatMap((entry) =>
      (entry.kind === "work" || entry.kind === "generic-call") &&
      isActivityWork(entry.entry) &&
      !isQuestionToolCall(entry.entry) &&
      workEntryIsVisibleInGroup(entry.entry, turn.live)
        ? [entry.entry]
        : [],
    ),
    (entry) => entry,
  );
  const launches = entries.flatMap((entry) =>
    entry.kind === "work" && entry.entry.agentSpawn !== undefined ? [entry.entry] : [],
  );
  return activityCounts(calls, launches);
}

/**
 * How long after a run nobody wrote to start the word that woke it may land:
 * a helper's finish reaches the thread a moment after the run it woke began
 * (Bodhi woke into "thought 5s" cards with nothing above them).
 */
const WOKE_LAG_MS = 10_000;

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

/** A crew seam's line, placed where the engine drew it. */
function crewSeamRow(
  id: string,
  work: WorkLogEntry,
  seam: CrewSeam,
): Extract<MessagesTimelineRow, { kind: "crew-seam" }> {
  return { kind: "crew-seam", id, createdAt: work.createdAt, seam, words: work.label };
}

interface Remembered<T> {
  readonly reads: ReadonlyArray<unknown>;
  readonly value: T;
  used: number;
}

/**
 * What one conversation's derive keeps for the next: each run's batch and
 * each stretch's record, with everything it read to draw them. A streamed
 * update changes the live run's reads alone, so only the live run is read
 * again; every settled run keeps its lines, the same objects as before.
 */
export interface MessagesTimelineRowsCache {
  generation: number;
  readonly batches: Map<string, Remembered<LiveBatch<BatchEntry>>>;
  readonly records: Map<string, Remembered<{ items: RecordItem[]; rows: MessagesTimelineRow[] }>>;
  /** By run: what its calls came to (`turnActivity`), read off its entries alone. */
  readonly activities: Map<string, Remembered<OutcomeActivity[]>>;
}

export function createMessagesTimelineRowsCache(): MessagesTimelineRowsCache {
  return { generation: 0, batches: new Map(), records: new Map(), activities: new Map() };
}

function sameReads(left: ReadonlyArray<unknown>, right: ReadonlyArray<unknown>): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (!Object.is(left[index], right[index])) return false;
  }
  return true;
}

/** `compute()`, or what it gave last time for the same `key` from the same `reads`. */
function remembered<T>(
  store: Map<string, Remembered<T>> | undefined,
  generation: number,
  key: string,
  readsOf: () => ReadonlyArray<unknown>,
  compute: () => T,
  equalReads = sameReads,
): T {
  if (store === undefined) return compute();
  const reads = readsOf();
  const known = store.get(key);
  if (known !== undefined && equalReads(known.reads, reads)) {
    known.used = generation;
    return known.value;
  }
  const value = compute();
  store.set(key, { reads, value, used: generation });
  return value;
}

/** What the last derive did not draw is not kept: the cache holds one conversation. */
function forgetUnused(cache: MessagesTimelineRowsCache): void {
  for (const store of [cache.batches, cache.records, cache.activities] as const) {
    for (const [key, known] of store) if (known.used !== cache.generation) store.delete(key);
  }
}

/** Whether a call returned elsewhere in the thread: `startOfAReturnedCall`'s read of `returned`. */
function returnedRead(entry: TimelineEntry, reading: BatchReading): boolean {
  return (
    (entry.kind === "work" || entry.kind === "generic-call") &&
    entry.entry.toolCallId !== undefined &&
    reading.returned.has(entry.entry.toolCallId)
  );
}

/** Everything `stretchBatch` reads of a run: its entries, and the thread's word on their calls. */
function batchReads(
  entries: ReadonlyArray<TimelineEntry>,
  reading: BatchReading,
): ReadonlyArray<unknown> {
  const reads: unknown[] = [reading.byTiming, entries.length];
  for (const entry of entries) reads.push(entry, returnedRead(entry, reading));
  return reads;
}

/**
 * Everything `stretchRecord` reads, its pause row aside: the stretch's own
 * entries and clock, the run's, and what the thread says of each of its calls
 * — the commands tracking them, the tasks' and the saved outputs' words, the
 * calls returned elsewhere, the batch. A read added to `stretchRecord` is
 * added here, or a settled run keeps a stale line.
 */
function recordReads(input: {
  stretch: Stretch;
  answer: MessageEntry | null;
  writing: MessageEntry | null;
  brokeOffEntryId: string | null;
  tracked: TrackedCommands;
  until: string | null;
  reading: BatchReading;
  batch: LiveBatch<BatchEntry>;
}): ReadonlyArray<unknown> {
  const { stretch, tracked } = input;
  const reads: unknown[] = [
    stretch.live,
    stretch.startedAt,
    stretch.endedAt,
    input.answer,
    input.writing,
    input.brokeOffEntryId,
    input.until,
    input.batch,
    tracked.liveJobs ?? null,
    stretch.entries.length,
  ];
  for (const entry of stretch.entries) {
    reads.push(entry);
    if (entry.kind !== "work" && entry.kind !== "generic-call") continue;
    reads.push(returnedRead(entry, input.reading), ...trackedReadsOf(entry.entry, tracked));
  }
  return reads;
}

/**
 * A quiet stretch of the conversation this long draws a time line: minutes
 * apart are one conversation, and a line between them split it in pieces.
 */
const IDLE_SEAM_MS = 60 * 60 * 1000;

/** Finish the structural card once, before browser occupancy, folds and motion. */
export function assembleRecordCard(input: {
  items: ReadonlyArray<RecordItem>;
  now: TurnHeaderActivity | null;
  answering: boolean;
  outcome: OutcomeModel | null;
  paging?: EngineCardPaging | null;
  compacting?: boolean;
  liveLines?: ReadonlyMap<string, boolean>;
}) {
  const paging = input.paging ?? null;
  const chatItems = selectChatItems(heldLines(input.items, paging), input.liveLines);
  return {
    chatItems,
    paging,
    hasWork: (paging?.hasWork ?? false) || chatItems.length > 0,
    outcome: withPagedEffort(input.outcome, paging),
    slot: {
      ...slotModelOf({
        now: input.now,
        answering: input.answering,
        compacting: input.compacting ?? false,
        items: input.items,
        ...(input.liveLines === undefined ? {} : { liveLines: input.liveLines }),
      }),
      // Dwell admits finished lines too; a wordless thought must never occupy it.
      record: input.items.filter((item) => chatItemHasLine(item, input.liveLines)),
    },
  };
}

export function deriveMessagesTimelineRows(input: {
  readonly limit?: MateLimit;
  readonly runCards?: Readonly<Record<string, EngineRunCard>>;
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
  /** The background jobs the server holds live (`liveJobs.logic`): one it does not never reports. */
  liveJobs?: LiveJobs | null;
  /** The clock a running turn's last words wait against (`LAST_WORDS_GRACE_MS`). */
  nowMs?: number;
  /** When each helper finished, as the helpers panel knows it (`helperFinishesOf`). */
  helperFinishes?: ReadonlyArray<HelperFinish>;
  /** Something runs alongside the live run: its panel draws a bar (`dockDraws`). */
  alongside?: boolean;
  /**
   * The thread's provider driver: whether its calls go stale by timing
   * (`batchesByTiming`); not known, nothing does.
   */
  provider?: string | null;
  /** Account coverage and summaries, keyed by rendered card identity. */
  cardPaging?: Readonly<Record<string, EngineCardPaging>>;
  isCompacting?: boolean;
  /** Structural visibility only; streamed bytes stay at the leaf. */
  liveLines?: ReadonlyMap<string, boolean>;
  /**
   * What the last derive of this conversation read and drew
   * (`createMessagesTimelineRowsCache`): a run whose reads are the same draws
   * the same, and is not read again. The rows are the same with it or without.
   */
  cache?: MessagesTimelineRowsCache;
}): MessagesTimelineRow[] {
  // Where the history import cut: a line at the conversation's top, never a step of the run it
  // was recorded in.
  const cut = input.timelineEntries.find(
    (entry) => entry.kind === "work" && entry.entry.sourceActivityKind === HISTORY_CUT_KIND,
  );
  const entries =
    cut === undefined
      ? input.timelineEntries
      : input.timelineEntries.filter((entry) => entry !== cut);
  const cache = input.cache;
  if (cache !== undefined) cache.generation += 1;
  const reading = batchReadingOf(entries, { byTiming: batchesByTiming(input.provider) });
  const structure = deriveConversationStructure({
    timelineEntries: entries,
    ...(input.runCards === undefined ? {} : { runCards: input.runCards }),
    latestTurn: input.latestTurn ?? null,
    runningTurnId: input.runningTurnId ?? null,
    isWorking: input.isWorking,
    activeTurnStartedAt: input.activeTurnStartedAt,
    provider: input.provider,
    ...(input.nowMs === undefined ? {} : { nowMs: input.nowMs }),
    // The helpers a run launched work on with no turn running: it waits on
    // them. The server's live tasks say which — a moment past their end
    // (`LIVE_JOB_GRACE_MS`), so the turn a finish wakes finds the run still
    // open; a server from before says only that some helper works.
    ...(input.isWorking
      ? {}
      : {
          helperWorks: (taskId: string) =>
            input.liveJobs != null
              ? input.liveJobs.ids.has(taskId)
              : input.afterTurnWork === "working",
        }),
  });
  const turnByKey = new Map(structure.turns.map((turn) => [turn.key, turn]));
  const came = turnsThatCame(entries, input.latestTurn ?? null);
  // Which tasks are the commands they track: a command's words, and no row of their own.
  const tracked = {
    ...trackCommands(
      entries.flatMap((entry) =>
        entry.kind === "work" || entry.kind === "generic-call" ? [entry.entry] : [],
      ),
    ),
    liveJobs: input.liveJobs ?? null,
  };

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
    turnDiffSummaryByTurnId: diffByTurnId,
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
    const provider = turn.limit.provider;
    const answerAt = turn.limit.createdAt;
    const row: Extract<MessagesTimelineRow, { kind: "pause" }> = {
      kind: "pause",
      id: `pause:${turn.key}`,
      ...(provider === null ? {} : { provider }),
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

  const rows: MessagesTimelineRow[] =
    cut?.kind === "work"
      ? [
          {
            kind: "seam",
            id: "seam:cut",
            createdAt: cut.createdAt,
            seam: "cut",
            words: cut.entry.label,
          },
        ]
      : [];
  let lastDay: string | null = null;
  let lastEnd: string | null = null;
  const newSinceMs = input.newSince ? Date.parse(input.newSince) : NaN;
  let newSinceDrawn = !Number.isFinite(newSinceMs);
  const seamBefore = (at: string, id: string) => {
    const day = localDayKey(at);
    const atMs = Date.parse(at);
    const endMs = lastEnd === null ? NaN : Date.parse(lastEnd);
    // The conversation is dated at its top; after that a line stands only
    // where an hour or a day passed — the day where a new one began, else the
    // time. Midnight between two messages minutes apart is no reason for one.
    const quiet =
      !Number.isFinite(endMs) || (Number.isFinite(atMs) && atMs - endMs >= IDLE_SEAM_MS);
    if (quiet && day !== null && day !== lastDay) {
      rows.push({ kind: "seam", id: `seam:day:${day}`, createdAt: at, seam: "day" });
      lastDay = day;
    } else if (quiet && Number.isFinite(endMs)) {
      rows.push({ kind: "seam", id: `seam:gap:${id}`, createdAt: at, seam: "gap" });
    }
    if (!newSinceDrawn && Number.isFinite(atMs) && atMs > newSinceMs) {
      rows.push({ kind: "seam", id: "seam:new", createdAt: input.newSince!, seam: "new" });
      newSinceDrawn = true;
    }
  };
  const personRow = (entry: MessageEntry, index: number, aside: boolean): MessagesTimelineRow => {
    const task = crewCardOf(entry.message);
    if (task !== null) {
      return { kind: "crew-card", id: entry.id, createdAt: entry.createdAt, task };
    }
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
      receipt: messageReceipt(entry.message, structure, index, came),
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
      candidate.entry.sourceActivityKind !== "context-compaction" &&
      candidate.entry.crewSeam === undefined &&
      // A command's own task is told on its command's card (`jobs:`), never loose.
      !tracked.trackers.has(candidate.entry.id)
    );
  };
  /** When a background task or a helper finished: a helper's row takes each report as it comes. */
  const finishedAt = (work: WorkLogEntry) => Date.parse(work.updatedAt ?? work.createdAt);
  // Helpers one launch started together share its row, so which of them
  // finished is the helpers panel's to say. Each finish wakes the Mate once:
  // the runs nothing else woke take them in the order they finished. A helper
  // that reported in a row of its own is that row's (`wokeBy`).
  const reported = new Set(
    entries.flatMap((entry) =>
      entry.kind === "work" &&
      entry.entry.sourceActivityKind === "task.completed" &&
      entry.entry.taskId !== undefined &&
      (entry.entry.agentSpawn?.agentTaskIds.length ?? 1) <= 1
        ? [entry.entry.taskId]
        : [],
    ),
  );
  const gathered = new Set(
    entries.flatMap((entry) =>
      entry.kind === "work" && (entry.entry.agentSpawn?.agentTaskIds.length ?? 0) > 1
        ? entry.entry.agentSpawn!.agentTaskIds
        : [],
    ),
  );
  // One that finished while a run worked was that run's to take in, never
  // what woke a later one (run 9: a helper done mid-run woke a run twenty
  // minutes on, as a line of its own).
  // Each stretch on its own: a run that went on over several turns did not
  // work between them, while its helpers did (run 11).
  const working = structure.turns.flatMap((turn) =>
    turn.stretches.map((stretch) => {
      const end = stretch.endedAt;
      return [
        Date.parse(stretch.startedAt),
        end === null ? Number.POSITIVE_INFINITY : Date.parse(end),
      ] as const;
    }),
  );
  const takenIn = (finishedMs: number) =>
    working.some(([from, to]) => finishedMs >= from && finishedMs <= to);
  const helperQueue = (input.helperFinishes ?? [])
    .filter((finish) => gathered.has(finish.id) && !reported.has(finish.id))
    .toSorted((left, right) => Date.parse(left.finishedAt) - Date.parse(right.finishedAt));
  /**
   * The gathered helper that woke a run nothing else woke, taken: the first
   * that finished between runs, before it began — else, `lagging`, the
   * first whose word landed in its first moments (`WOKE_LAG_MS`). Only the
   * one taken is spared from having been taken in by the run it landed in.
   */
  const helperWoke = (startedAt: string, lagging: boolean): HelperFinish | null => {
    const startMs = Date.parse(startedAt);
    const at = helperQueue.findIndex((finish) => {
      const ms = Date.parse(finish.finishedAt);
      return lagging ? ms > startMs && ms <= startMs + WOKE_LAG_MS : ms <= startMs && !takenIn(ms);
    });
    if (at < 0) return null;
    return helperQueue.splice(at, 1)[0] ?? null;
  };
  // The tasks that finished in a turn, each a line of its own, in the order
  // they finished: read once, and each run asks only of its own moments.
  const finishedTasks = entries
    .flatMap((entry, index) => {
      if (
        entry.kind !== "work" ||
        entry.entry.sourceActivityKind !== "task.completed" ||
        structure.looseIndexes.has(index) ||
        // A command's own task is told on its command's card.
        tracked.trackers.has(entry.entry.id) ||
        (entry.entry.agentSpawn?.agentTaskIds.length ?? 1) > 1
      ) {
        return [];
      }
      const ms = finishedAt(entry.entry);
      return Number.isNaN(ms) ? [] : [{ work: entry.entry, ms }];
    })
    .toSorted((left, right) => left.ms - right.ms);
  /** When the run before `turn` ended: what finished since is what may have woken it. */
  const turnIndex = new Map(structure.turns.map((turn, index) => [turn, index] as const));
  const previousEndMs = (turn: ConversationTurn): number => {
    const previous = structure.turns[(turnIndex.get(turn) ?? -1) - 1];
    return previous === undefined
      ? -Infinity
      : Date.parse(previous.stretches.at(-1)?.endedAt ?? "");
  };
  /**
   * What woke a run nobody wrote to start: the helpers and background tasks
   * that finished after the run before it ended and before it began, for a
   * result delivered then wakes the Mate. What finished while the run before
   * still worked was that run's to take in. Rows gathering several helpers
   * say only the latest report: which of them finished is the helpers
   * panel's to say (`helperWoke`). Work no turn owns says itself in its own
   * line, and is never said again here.
   */
  const wokeBy = (turn: ConversationTurn, lagging: boolean): WorkLogEntry[] =>
    wokeBetween(Date.parse(turn.stretches[0]?.startedAt ?? ""), previousEndMs(turn), lagging);
  /**
   * What finished after `fromMs` and before a run — or one of its turns
   * nobody wrote to start — began at `startMs`; `lagging`, in its first
   * moments instead (`WOKE_LAG_MS`).
   */
  const wokeBetween = (
    startMs: number,
    previousEndMs: number,
    lagging: boolean,
  ): WorkLogEntry[] => {
    const fromMs = lagging ? startMs : previousEndMs;
    const untilMs = lagging ? startMs + WOKE_LAG_MS : startMs;
    if (!Number.isFinite(untilMs) || Number.isNaN(fromMs)) return [];
    let low = 0;
    let high = finishedTasks.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (finishedTasks[middle]!.ms > fromMs) high = middle;
      else low = middle + 1;
    }
    const found: WorkLogEntry[] = [];
    for (let at = low; at < finishedTasks.length && finishedTasks[at]!.ms <= untilMs; at += 1) {
      found.push(finishedTasks[at]!.work);
    }
    return found;
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

    const lead = first.lead !== null && first.leadIndex !== null ? first.lead : null;
    if (lead !== null) {
      // Keyed by the message, as a loose message's seam is: the seam must not
      // change its identity when a turn claims the message it stands before.
      seamBefore(lead.createdAt, lead.id);
      rows.push(personRow(lead, first.leadIndex!, first.aside));
      // A /compact is its own event line: it says when the context is
      // condensed, so its run draws no card and no second compaction line.
      // What the person sent while it ran is theirs all the same: it stands
      // after the line, and the run it started is drawn as any other.
      if (readSlashCommand(lead.message.text)?.name === "compact") {
        lastEnd = first.endedAt ?? first.startedAt;
        const [, next, ...rest] = turn.stretches;
        if (next !== undefined)
          emitTurn({ ...turn, stretches: [{ ...next, aside: false }, ...rest] });
        return;
      }
    }

    // An answer that is the limit's own notice is the pause's to tell.
    const answer = turn.answerIsRefusal ? null : turn.answer;
    const pause = pauseByTurnKey.get(turn.key)?.row ?? null;
    const pausedHere = pause !== null || turn.limitOnly;

    // What the person sent into the run while it went on stands on the page,
    // in the order it was sent, and the run's card stays whole under it, as a
    // typing indicator stays under the last message; the card's chat marks
    // where each reached the Mate (the owner, 2026-09-28, of the card
    // breaking around them: "these split working groups have no chance to
    // stay like this when the work is done").
    // What woke a run nobody wrote to start: what finished before it began,
    // tasks first, then a helper; only with none, what landed in its first
    // moments (`WOKE_LAG_MS`) — a word that reached the thread late.
    let woke: WorkLogEntry[] = [];
    let helper: HelperFinish | null = null;
    if (lead === null) {
      woke = wokeBy(turn, false);
      if (woke.length === 0) helper = helperWoke(first.startedAt, false);
      if (woke.length === 0 && helper === null) {
        woke = wokeBy(turn, true);
        if (woke.length === 0) helper = helperWoke(first.startedAt, true);
      }
    }
    // Where a turn nobody wrote to start took the run on, what woke it is
    // said there, inside the card, once (run 11: "in the background" and
    // "helper" lines between cards, connected to nothing).
    const wakes = new Map<string, { woke: WorkLogEntry[]; helper: HelperFinish | null }>();
    turn.stretches.forEach((stretch, index) => {
      if (index === 0 || stretch.lead !== null) return;
      const startMs = Date.parse(stretch.startedAt);
      const fromMs = Date.parse(turn.stretches[index - 1]?.endedAt ?? "") || -Infinity;
      let found = wokeBetween(startMs, fromMs, false);
      let finish: HelperFinish | null = null;
      if (found.length === 0) finish = helperWoke(stretch.startedAt, false);
      if (found.length === 0 && finish === null) {
        found = wokeBetween(startMs, fromMs, true);
        if (found.length === 0) finish = helperWoke(stretch.startedAt, true);
      }
      wakes.set(stretch.key, { woke: found, helper: finish });
    });
    const wokeIds = new Set([
      ...woke.map((entry) => entry.id),
      ...[...wakes.values()].flatMap((wake) => wake.woke.map((entry) => entry.id)),
    ]);
    const exchanges: MessagesTimelineRow[] = [];
    // What the card holds besides its record: a plan to approve, a pause.
    const extras: MessagesTimelineRow[] = [];
    const items: RecordItem[] = [];
    // The batch rule reads the whole run: a call left open before the person
    // wrote into it goes stale too.
    const runEntries = turn.stretches.flatMap((part) => part.entries);
    const batch = remembered(
      cache?.batches,
      cache?.generation ?? 0,
      turn.key,
      () => batchReads(runEntries, reading),
      () => stretchBatch({ entries: runEntries }, reading),
    );
    turn.stretches.forEach((stretch, index) => {
      const wake = wakes.get(stretch.key);
      if (wake !== undefined && (wake.woke.length > 0 || wake.helper !== null)) {
        items.push({
          kind: "event",
          key: `woke:${stretch.key}`,
          at: stretch.startedAt,
          event: {
            type: "woke",
            ...(wake.woke.length > 0
              ? backgroundRunSummary(wake.woke)
              : {
                  tasks: 1,
                  failed: wake.helper!.failed ? 1 : 0,
                  helpers: true,
                  title: wake.helper!.title,
                }),
          },
        });
      }
      if (index > 0 && stretch.lead !== null && stretch.leadIndex !== null) {
        const person = personRow(stretch.lead, stretch.leadIndex, stretch.aside);
        exchanges.push(person);
        items.push({
          kind: "person",
          key: `person:${stretch.lead.id}`,
          at: stretch.lead.createdAt,
          message: stretch.lead.message,
          imageOnly: person.kind === "message" && person.imageOnly,
        });
      }
      const recordInput = {
        stretch,
        answer: turn.answer,
        writing: turn.writing,
        brokeOffEntryId: turn.brokeOff?.entryId ?? null,
        tracked,
        until: turn.live ? null : last.endedAt,
        reading,
        batch,
      };
      const record = remembered(
        cache?.records,
        cache?.generation ?? 0,
        `${turn.key}\u0000${stretch.key}`,
        () => recordReads(recordInput),
        () => stretchRecord({ ...recordInput, pauseRow: null }),
      );
      const built = record;
      // What woke the run is said once, over it (`wokeBy`), never again as its line.
      items.push(
        ...built.items.filter((item) => item.kind !== "task" || !wokeIds.has(item.entry.id)),
      );
      extras.push(...built.rows);
    });
    const paging = input.cardPaging?.[turn.turnId ?? ""] ?? null;
    const unheld = paging?.hasWork ?? false;
    const hasRecord = unheld || items.some((item) => item.kind !== "person");
    // A live run with nothing in its record whose answer is known already is
    // drawn as it will settle: a result that woke the Mate and was answered in
    // one breath flashed a card for a frame, and the answer jumped up as it
    // went (Nova, 2026-09-26).
    const answeredAlone = turn.live && !hasRecord && answer !== null;
    // Its turns over, what it started goes on: the card stays open on it.
    const waiting = turn.waiting;
    const working = (last.live && !answeredAlone) || waiting;
    const carded =
      (turn.live && !answeredAlone) ||
      waiting ||
      hasRecord ||
      pausedHere ||
      turn.interruption !== undefined ||
      turn.brokeOff !== null ||
      turn.interrupted ||
      extras.length > 0;
    const diffs = turn.span.turnIds.flatMap((turnId) => diffByTurnId.get(turnId) ?? []);
    const outcome =
      turn.live || waiting
        ? null
        : deriveOutcome({
            turn,
            landed: landedByTurnKey.get(turn.key) ?? [],
            diffs,
            activity: remembered(
              cache?.activities,
              cache?.generation ?? 0,
              turn.key,
              () => [turn.live, ...runEntries],
              () => turnActivity(turn),
            ),
            later: turnsAfter(structure, turn.key),
            ...(unheld ? { unheld } : {}),
          });
    // What the result draws under the line: an outcome of what its calls came
    // to alone is said on the line (`outcomeDraws`).
    const result = outcome !== null && outcomeDraws(outcome) ? outcome : null;

    if (lead === null) {
      // A run nobody wrote to start opens with what woke it, where the
      // person's message would stand (Nova, 2026-09-26: a helper's review
      // came back, and the run it woke began with no word of why) — when it
      // shows anything at all. One that did nothing to see is nothing to
      // announce (the owner, 2026-09-27, of a lone "Background task
      // finished" line: "why does it say here?").
      // Taken even by a run that shows nothing: it was woken all the same.
      if (!carded && answer === null) {
        lastEnd = last.endedAt ?? last.startedAt;
        return;
      }
      seamBefore(first.startedAt, first.key);
      if (woke.length > 0) {
        rows.push({
          kind: "background",
          id: `woke:${first.key}`,
          createdAt: first.startedAt,
          entries: woke,
          ...backgroundRunSummary(woke),
        });
      } else if (helper !== null) {
        rows.push({
          kind: "background",
          id: `woke:${first.key}`,
          createdAt: first.startedAt,
          entries: [],
          tasks: 1,
          failed: helper.failed ? 1 : 0,
          helpers: true,
          title: helper.title,
        });
      }
    }
    rows.push(...exchanges);
    const status: RunStatus = {
      // A run that waits on what it started is not over: its clock runs on.
      live: turn.live || waiting,
      face: waiting
        ? "working"
        : pausedHere
          ? input.limit?.kind === "limited"
            ? "paused"
            : "idle"
          : stretchFace({ stretch: last, turn, pausedHere: false }),
      startedAt: first.startedAt,
      endedAt: waiting ? null : last.endedAt,
      ...(turn.brokeOff === null || waiting ? {} : { brokeOff: turn.brokeOff }),
      ...(turn.interruption === undefined ? {} : { interruption: turn.interruption }),
      ...waitedOn(turn),
      // A question it asked is work too: a run that only asked read "thought".
      worked:
        unheld ||
        items.some(
          (item) =>
            item.kind !== "thought" &&
            item.kind !== "note" &&
            item.kind !== "person" &&
            item.kind !== "crew-seam",
        ) ||
        turn.stretches.some((stretch) =>
          stretch.entries.some(
            (candidate) =>
              (candidate.kind === "work" || candidate.kind === "generic-call") &&
              (isQuestionToolCall(candidate.entry) || candidate.entry.inputQuestions !== undefined),
          ),
        ),
    };
    // Who worked and for how long is said once, on the chat's last line,
    // where the Mate's face stands — the live edge while it works, the run's
    // end once it is over. A run with no chat keeps it as a line of its own.
    const chatted = hasRecord || working || turn.interruption !== undefined;
    if (carded && (!pausedHere || chatted || extras.length > 0)) {
      const cardStart = rows.length;
      if (!chatted && !pausedHere) {
        rows.push({
          kind: "work-line",
          id: `work-line:${first.key}`,
          createdAt: first.startedAt,
          stretchKey: first.key,
          turnId: first.turnId,
          ...status,
        });
      } else if (chatted) {
        const now = waiting
          ? { kind: "after" as const }
          : working && answer === null
            ? liveActivity(last, turn.writing, tracked, batch)
            : null;
        const source = {
          kind: "record" as const,
          id: `record:${first.key}`,
          createdAt: first.startedAt,
          turnKey: turn.key,
          turnId: turn.turnId,
          live: turn.live || waiting,
          items,
          now,
          answering: answer !== null,
          status,
          outcome,
        };
        const compacting = source.live && (input.isCompacting ?? false);
        const messages = [
          ...items.flatMap((item) =>
            item.kind === "thought" ? item.messages : item.kind === "note" ? [item.message] : [],
          ),
          ...(now?.kind === "thinking"
            ? now.messages
            : now?.kind === "writing" && now.note !== undefined
              ? [now.note.message]
              : []),
        ];
        // The existing record cache also keeps its finished card. Only this card's coverage and
        // streamed visibility are reads; bytes and other cards' paging never invalidate it.
        const assembled = remembered(
          cache?.records,
          cache?.generation ?? 0,
          `card:${turn.key}`,
          () => [
            source,
            paging,
            compacting,
            ...messages
              .filter((message) => message.streaming)
              .map((message) => input.liveLines?.get(message.id)),
          ],
          () => ({
            items,
            rows: [
              {
                ...source,
                ...assembleRecordCard({
                  ...source,
                  paging,
                  compacting,
                  ...(input.liveLines === undefined ? {} : { liveLines: input.liveLines }),
                }),
              },
            ],
          }),
          sameValue,
        );
        rows.push(...assembled.rows);
      }
      rows.push(...extras);
      if (working) {
        // What runs alongside is the whole run's, however often the person wrote into it.
        const wholeRun: Stretch = {
          ...last,
          entries: turn.stretches.flatMap((stretch) => stretch.entries),
        };
        rows.push({
          kind: "working",
          // The card's own: keyed by its last stretch, it moved to the next
          // card when the person's message became that run's opener, and
          // the list drew rows twice and lost the card's edge (Rhea, run 11).
          id: `working:${first.key}`,
          createdAt: last.startedAt,
          stretchKey: last.key,
          turnKey: turn.key,
          cardKey: first.key,
          incidents: standingIncidents(wholeRun),
          ...(waiting ? { waiting: true } : {}),
        });
      }
      // Settled, what runs alongside becomes the run's result, where it was —
      // its rows under the now line — easing from its height, and the answer
      // follows.
      if (result !== null) {
        rows.push({
          kind: "outcome",
          id: result.key,
          createdAt: turn.answer?.createdAt ?? last.endedAt ?? last.startedAt,
          outcome: result,
        });
      }
      // What it sent to the background, on its own card: one line, the jobs
      // as they stand now — reported since. While they run, the card waits
      // on them, and what runs alongside says them.
      if (!turn.live && !waiting) {
        const jobs = turn.stretches.flatMap((stretch) =>
          stretch.entries.flatMap((candidate) => {
            if (candidate.kind !== "work") return [];
            const job = backgroundJobOf(candidate.entry, tracked);
            return job === null ? [] : [job];
          }),
        );
        if (jobs.length > 0) {
          rows.push({
            kind: "background",
            id: `jobs:${first.key}`,
            createdAt: last.endedAt ?? last.startedAt,
            entries: [],
            tasks: jobs.length,
            failed: jobs.filter((job) => job.state === "failed").length,
            helpers: false,
            title: jobs.at(-1)?.title ?? null,
            jobs,
          });
        }
      }
      // A line with nothing under it is no card: one quiet line, not an
      // empty box.
      if (rows.length > cardStart + (chatted ? 0 : 1)) {
        rows.push({
          kind: "card-end",
          id: `card-end:${first.key}`,
          createdAt: rows.at(-1)!.createdAt,
        });
        cardRanges.push([cardStart, rows.length]);
      }
    }

    // With nothing to report, the Mate's last word under the run eases up
    // from where what ran alongside it stood.
    const foldsFrom: FoldsFrom | undefined =
      result !== null || (turn.live && !answeredAlone)
        ? undefined
        : {
            turnKey: turn.key,
            cardKey: first.key,
            cardClosed: !carded || rows.at(-1)?.kind !== "card-end",
          };
    // A provider pause owns its stage, outside the work card it follows.
    if (pause !== null) rows.push(pause);
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
        ...(foldsFrom === undefined ? {} : { foldsFrom }),
      });
    }
    // What it asked the person for follows its words: the person answers it there.
    for (const item of items) {
      if (item.kind !== "operation" || vaultAskOf(item.operation) === null) continue;
      rows.push({
        kind: "vault-request",
        id: `vault-request:${item.operation.key}`,
        createdAt: item.operation.anchorAt,
        operation: item.operation,
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
      rows.push({
        kind: "background",
        id: `background:${entry.id}`,
        createdAt: entry.createdAt,
        entries: run,
        ...backgroundRunSummary(run),
      });
      lastEnd = timelineEntryEnd(entries[cursor - 1]!);
      index = cursor - 1;
      continue;
    }
    if (structure.looseIndexes.has(index)) {
      // A command's own task, reporting after its turn: its card tells it (`jobs:`).
      if (
        (entry.kind === "work" || entry.kind === "generic-call") &&
        tracked.trackers.has(entry.entry.id)
      ) {
        continue;
      }
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
      } else if (entry.kind === "work" && entry.entry.crewSeam !== undefined) {
        rows.push(crewSeamRow(entry.id, entry.entry, entry.entry.crewSeam));
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

  // Work that outlived its run is that run's card's to say, waiting on it;
  // only work no run waits on stands at the bottom on its own.
  if (!input.isWorking && input.afterTurnWork && !structure.turns.some((turn) => turn.waiting)) {
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
      heldAhead: (input.queuedMessages ?? [])
        .slice(0, index)
        .some((ahead) => ahead.holdUntilUserAction === true),
    });
  });
  const cards = new Map<number, CardSlice>();
  const whole = new Set<number>();
  for (const [start, end] of cardRanges) {
    for (let index = start; index < end; index += 1) {
      cards.set(index, index === start ? "top" : index === end - 1 ? "bottom" : "middle");
    }
    // Nothing under the line but what runs alongside, while nothing does.
    const body = rows.slice(start + 1, end - 1);
    const bare =
      rows[start]?.kind === "record" &&
      body.every(
        (row) => row.kind === "working" && row.incidents.length === 0 && input.alongside !== true,
      );
    if (bare) {
      for (let index = start; index < end; index += 1) whole.add(index);
    }
  }
  if (cache !== undefined) forgetUnused(cache);
  return rows.map((row, index) => {
    const card = cards.get(index);
    // A card's edge is not a row of the conversation: the row after it keeps
    // the room it kept after the card's last row.
    const previous = rows[index - 1]?.kind === "card-end" ? rows[index - 2] : rows[index - 1];
    return {
      ...row,
      gap: row.kind === "card-end" ? "none" : rowGap(previous, row),
      ...(card === undefined ? {} : { card }),
      ...(whole.has(index) ? { cardWhole: true as const } : {}),
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
function sameFold(a: FoldsFrom | undefined, b: FoldsFrom | undefined): boolean {
  return a?.turnKey === b?.turnKey && a?.cardKey === b?.cardKey && a?.cardClosed === b?.cardClosed;
}

/**
 * Whether a record's item draws the same as the one on screen: messages by
 * identity (a streamed message is a new object), the rest by what it holds.
 */
function sameRecordItem(a: RecordItem, b: RecordItem): boolean {
  if (a === b) return true;
  if (a.kind !== b.kind || a.key !== b.key || a.at !== b.at) return false;
  switch (a.kind) {
    case "note":
      return a.message === (b as typeof a).message;
    case "thought": {
      const bt = b as typeof a;
      return (
        a.durationMs === bt.durationMs &&
        a.messages.length === bt.messages.length &&
        a.messages.every((message, index) => message === bt.messages[index])
      );
    }
    case "person": {
      const bp = b as typeof a;
      return a.message === bp.message && a.words === bp.words && a.imageOnly === bp.imageOnly;
    }
    default:
      return sameValue(a, b);
  }
}

function isRowUnchanged(a: MessagesTimelineRow, b: MessagesTimelineRow): boolean {
  if (a === b) return true;
  if (
    a.kind !== b.kind ||
    a.id !== b.id ||
    a.createdAt !== b.createdAt ||
    a.gap !== b.gap ||
    a.card !== b.card ||
    a.cardWhole !== b.cardWhole
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
        a.revertTurnCount === bm.revertTurnCount &&
        sameFold(a.foldsFrom, bm.foldsFrom)
      );
    }
    case "record": {
      const br = b as typeof a;
      return (
        a.live === br.live &&
        a.answering === br.answering &&
        a.hasWork === br.hasWork &&
        sameValue(a.paging, br.paging) &&
        sameValue(a.chatItems, br.chatItems) &&
        sameValue(a.slot, br.slot) &&
        sameValue(a.now, br.now) &&
        // Its now line's clock and its worked line's effort.
        sameValue(a.status, br.status) &&
        sameValue(a.outcome, br.outcome) &&
        a.items.length === br.items.length &&
        a.items.every((item, index) => sameRecordItem(item, br.items[index]!))
      );
    }
    case "proposed-plan":
      return a.proposedPlan === (b as typeof a).proposedPlan;
    case "queued-message": {
      const bq = b as typeof a;
      return a.queuedMessage === bq.queuedMessage && a.isNext === bq.isNext;
    }
    default:
      // The rest are rebuilt on every derive from fresh reads (operations,
      // work entries, landings): compare what they hold, not their identity.
      return sameValue(a, b);
  }
}

/**
 * Who speaks in a conversation: a crewmate's conversation is the crewmate's, a Mate's the Mate's
 * once the directory names it. Before that a neutral speaker — never upstream's "Assistant", which
 * is the speaker only where nobody lives — so nothing guessed shows and the name arrives in place.
 */
export function conversationSpeaker(input: {
  readonly crewmate: {
    readonly handle: string;
    readonly profile?: { readonly displayName?: string; readonly tint?: MateTintId } | null;
  } | null;
  /** The Mate the directory names here; null while it names none. */
  readonly mate: Pick<ZeropsMateIdentity, "name" | "tint" | "shape"> | null;
  /** The directory says nobody lives here: upstream's assistant speaks. */
  readonly nobody: boolean;
}): ConversationSpeaker {
  const { crewmate, mate } = input;
  if (crewmate !== null) {
    return {
      name: crewmate.profile?.displayName ?? `@${crewmate.handle}`,
      tint: crewmate.profile?.tint ?? "slate",
    };
  }
  if (mate !== null) return { name: mate.name, tint: mate.tint, shape: mate.shape };
  return input.nobody ? { name: "Assistant", tint: "slate" } : { name: "This Mate", tint: "slate" };
}
