import { AssetImage, ImageUnavailable } from "~/assets/AssetImage";
import {
  deriveTimelineMinimapItems,
  resolveTimelineMinimapPreview,
  type TimelineMinimapItem,
} from "./timelineMinimapItems";
import {
  type EnvironmentId,
  type MessageId,
  type ServerProviderSkill,
  type TurnId,
} from "@t3tools/contracts";
import { parseScopedThreadKey } from "@t3tools/client-runtime/environment";
import type { AgentPanelModel } from "@t3tools/client-runtime/state/subagentRuntime";
import { emptyAgentPanelModel } from "@t3tools/client-runtime/state/subagentRuntime";

const EMPTY_AGENT_PANEL_MODEL = emptyAgentPanelModel();
const NOOP_OPEN_AGENTS = () => {};
const NOOP_STOP_BACKGROUND_WORK = () => {};
const EMPTY_QUEUED_MESSAGES: ReadonlyArray<QueuedComposerMessage> = [];
const NOOP_QUEUED_MESSAGE_ACTION = (_id: string) => {};
import { resolveChatListAnchoredEndSpace } from "@t3tools/shared/chatList";
import {
  classifyTimelineScroll,
  jumpedAway,
  nextTimelineReading,
  nextPersonScrollSession,
  PERSON_SCROLL_IDLE,
  personIsScrolling,
  type PersonScrollSession,
  type PersonScrollSessionEvent,
  type TimelineScrollDirection,
  type TimelineScrollReading,
} from "@t3tools/client-runtime/zerops/timelineFollow";
import {
  Fragment,
  memo,
  use,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { createEndFollow, takeOwnScroll, type EndFollow } from "./timelineEndFollow";
import { revealBy } from "./timelineReveal.logic";
import { usePace } from "./usePace";
import { FOLLOW_TAU_MS, approach } from "./runMotion.logic";
import { LegendList, type LegendListRef } from "@legendapp/list/react";
import { ReviewCommentDiff } from "./ReviewCommentDiff";
import {
  createMessageAttachmentPreviewProjector,
  deriveTimelineEntries,
  selectMessageImageResources,
  workEntryDisplayIndicatesToolFailure,
  workEntrySignalsSevereFailure,
  workLogEntryIsToolLike,
} from "../../session-logic";
import {
  type ChatImageAttachment,
  type ChatMessage,
  isImageAttachment,
  type TurnDiffSummary,
} from "../../types";
import ChatMarkdown from "../ChatMarkdown";
import { queuedBubbleState, type QueuedComposerMessage } from "../../queuedMessageStore";
import {
  ArrowUpIcon,
  BotIcon,
  BrainIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  CircleAlertIcon,
  ClockIcon,
  EyeIcon,
  GlobeIcon,
  HammerIcon,
  MessageCircleIcon,
  RotateCcwIcon,
  SearchIcon,
  SquarePenIcon,
  TerminalIcon,
  Undo2Icon,
  WrenchIcon,
  XIcon,
  ZapIcon,
} from "lucide-react";
import { Button } from "../ui/button";
import { buildExpandedImagePreview, ExpandedImagePreview } from "./ExpandedImagePreview";
import { MessagePictureBody, useMessagePictureDimensions } from "./MessagePictures";
import { MessageFilesAbove, useMessageFileUrls } from "./MessageFiles";
import {
  placeMessagePictures,
  terminalContextsBySegment,
  unplacedMessageFiles,
} from "./messagePictures.logic";
import { AssetDownloadLink } from "~/assets/AssetDownloadLink";
import { useAssetUrlStates } from "../../assets/assetUrls";
import { ProposedPlanCard } from "./ProposedPlanCard";
import {
  describeTimelineAnchor,
  judgeTimelinePlacing,
  keepTimelineEndVisibleAfterOverlayGrowth,
  readTimelineFirstLineInset,
  readTimelinePosition,
  rememberTimelinePosition,
  resolveTimelineRestoreTarget,
  resolveTimelineScrollAnchor,
} from "./timelineScrollAnchoring";
import {
  isTimelineScrollTarget,
  isVerticalWheel,
  latchWheelGesture,
  timelineScrollKeyInput,
  type WheelGestureLatch,
} from "./timelineScrollTarget";
import { MessageCopyButton } from "./MessageCopyButton";
import {
  computeStableMessagesTimelineRows,
  createMessagesTimelineRowsCache,
  conversationSpeaker,
  deriveMessagesTimelineRows,
  earlierTurnsAnchor,
  helperFinishesOf,
  normalizeCompactToolLabel,
  resolveAssistantMessageCopyState,
  resolveTimelineIsAtEnd,
  resolveTimelineMinimapHasPersistentGutter,
  resolveTimelineMinimapCurrentIndex,
  resolveTimelineMinimapHeightStyle,
  resolveTimelineMinimapHitStripWidth,
  resolveTimelineMinimapIndexFromPointer,
  resolveTimelineMinimapInteractiveWidth,
  resolveTimelineMinimapTopPercent,
  shouldPreserveAssistantLineBreaks,
  toolGroupAction,
  workEntryIsVisibleInGroup,
  type StableMessagesTimelineRowsState,
  type CardSlice,
  type FoldsFrom,
  type MessagesTimelineRow,
  type RowGap,
  TIMELINE_MINIMAP_MIN_ITEMS,
  type TimelineLatestTurn,
} from "./MessagesTimeline.logic";
import { TerminalContextInlineChip } from "./TerminalContextInlineChip";
import { Tooltip, TooltipPopup, TooltipScrollDismissArea, TooltipTrigger } from "../ui/tooltip";
import {
  deriveDisplayedUserMessageState,
  type ParsedTerminalContextEntry,
} from "~/lib/terminalContext";
import { cn } from "~/lib/utils";
import { useUiStateStore } from "~/uiStateStore";
import { useZeropsMate } from "~/zerops/useZeropsMates";
import type { ZeropsMateIdentity } from "~/zerops/mateIdentities";
import { isMateStandUpAsk } from "~/zerops/mateStandUp";
import { useMateStandUpAskLine } from "~/zerops/useMateStandUp";
import { ZeropsMateEmptyState } from "../zerops/ZeropsMateEmptyState";
import { type TimestampFormat } from "@t3tools/contracts/settings";
import { formatChatTimestampTooltip, formatDayAwareTimestamp } from "../../timestampFormat";

import {
  buildInlineTerminalContextText,
  formatInlineTerminalContextLabel,
  textContainsInlineTerminalContextLabels,
} from "./userMessageTerminalContexts";
import { SkillInlineText } from "./SkillInlineText";
import { LAST_WORDS_GRACE_MS, latestFinishedWordsAt } from "./conversation.logic";
import { TurnReport } from "./TurnReport";
import { ConversationAfterWork, ConversationWorking, dockDraws } from "./ConversationWorking";
import { useEndingsHeld } from "./useEndingsHeld";
import { BackgroundLine, FOLD_FADE_MASK, foldsLikeAMessage, RunChat, RunLine } from "./RunChat";
import { forgetRunFolds } from "./runCard.logic";
import type { LiveJobs } from "./liveJobs.logic";
import { backgroundLineOf, jobItems, taskItems } from "./backgroundLine.logic";
import { KeptTimelineContext } from "./keptTimelineContext";
import { ConversationOpeningStage } from "./ConversationOpeningStage";
import type { CarriedRow } from "./stepHeight";
import {
  TimelineRowActivityCtx,
  TimelineRowCtx,
  TimelineWorkingCtx,
  type TimelineRowActivityState,
  type TimelineRowSharedState,
} from "./timelineContext";
import type { DockModel } from "./conversationDock.logic";
import {
  ErrorLine,
  EventLine,
  MessageReceipt,
  PauseBlock,
  Seam,
  StandUpAskLine,
  type ServerUsagePause,
} from "./ConversationRows";
import { ChangeChipMomentContext } from "../zerops/ZeropsChangeLinkChip";
import { CrewSeamActivity, CrewTaskCard, CrewTimelineContext } from "../zerops/crew/CrewTaskCard";
import { CrewmateEmptyState } from "../zerops/crew/CrewmateEmptyState";
import { ZeropsOperationCard } from "../zerops/ZeropsOperationCard";
import { VaultRequestCardContainer } from "../zerops/vault/VaultRequestCardContainer";
import { vaultAskOf } from "../zerops/vault/vaultRequest.logic";
import { useOperationCard } from "../../zerops/activity/useOperationCard";
import { formatWorkspaceRelativePath } from "../../filePathDisplay";
import {
  formatReviewCommentFence,
  parseReviewCommentMessageSegments,
  type ReviewCommentContext,
} from "../../reviewCommentContext";

/** What hands the page back to the person while earlier turns are being placed. */
const GESTURES = ["wheel", "touchmove", "keydown", "pointerdown"] as const;

/** The rows above keep their place as rows arrive and change size under them. */
const MAINTAIN_VISIBLE_CONTENT_POSITION = { data: true, size: true } as const;

const TIMELINE_LIST_HEADER = <div className="h-3 sm:h-4" />;
const TIMELINE_LIST_FADE_HEADER = <div className="h-10 sm:h-12" />;

// Header row shown when older turns exist beyond the loaded window. Plain
// button, no spinner animation; the label change is the loading indicator.
function TimelineLoadEarlierHeader({
  loading,
  onLoadEarlier,
  fade,
}: {
  loading: boolean;
  onLoadEarlier: () => void;
  fade: boolean;
}) {
  return (
    <div className={fade ? "pt-10 sm:pt-12" : "pt-3 sm:pt-4"}>
      <div className="mx-auto w-full max-w-3xl pb-2">
        <button
          type="button"
          onClick={onLoadEarlier}
          disabled={loading}
          className="w-full py-1.5 text-xs text-muted-foreground/60 hover:text-foreground disabled:cursor-default"
        >
          {loading ? "Loading earlier turns…" : "Load earlier turns"}
        </button>
      </div>
    </div>
  );
}
const TIMELINE_LIST_FOOTER = <div className="h-3 sm:h-4" />;
/** The keys that scroll a list: pressed, a reveal in flight gives way. */
const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);
function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
/** How long after a person's click what they opened is brought into view, while it eases open. */
const REVEAL_FOR_MS = 700;
const EMPTY_TIMELINE_SKILLS: ReadonlyArray<Pick<ServerProviderSkill, "name" | "displayName">> = [];
/**
 * How far from the end growth at the end is still followed, in viewports.
 * Following is ours to switch off — every gesture that moves the viewport
 * away turns it off — so while it is on, the end is followed however fast it
 * grows: the browser sliding out of the Mate at work opens a few hundred
 * pixels in a few frames, and LegendList's own tenth of a viewport lost it.
 */
const TIMELINE_FOLLOW_THRESHOLD = 1;
/** The rows a settle brings that enter one after another: the Mate's words and its background work. */
function pacedRow(row: MessagesTimelineRow): boolean {
  if (row.kind === "message") return row.message.role === "assistant";
  return row.kind === "after-work" || row.kind === "background";
}
/** An input a person gave the list, before it moved it. */
export type TimelinePersonInput =
  | { readonly kind: "wheel" | "key"; readonly direction: "up" | "down" }
  | { readonly kind: "touch-move" | "scrollbar" | "content-pointer" };

// ---------------------------------------------------------------------------
// Props (public API)
// ---------------------------------------------------------------------------

interface MessagesTimelineProps {
  agentPanelModel?: AgentPanelModel;
  onOpenAgents?: () => void;
  /** What runs now in the live turn: deploys, helpers, the task list, background tasks. */
  working?: DockModel | null;
  /** The server's word on work that outlived the turn, while it runs on. */
  afterTurnWork?: "working" | "monitoring" | null;
  /** The background jobs the server holds live, as watched (`useLiveJobs`). */
  liveJobs?: LiveJobs | null;
  onStopBackgroundWork?: () => void;
  stoppingBackgroundWork?: boolean;
  isWorking: boolean;
  workingStepLabel?: string | null;
  isCompacting?: boolean;
  activeTurnStartedAt: string | null;
  listRef: React.RefObject<LegendListRef | null>;
  timelineEntries: ReturnType<typeof deriveTimelineEntries>;
  latestTurn: TimelineLatestTurn | null;
  runningTurnId: TurnId | null;
  turnDiffSummaries: ReadonlyArray<TurnDiffSummary>;
  routeThreadKey: string;
  onOpenTurnDiff: (turnId: TurnId, filePath?: string, fromTurnId?: TurnId) => void;
  supportsConversationRollback: boolean;
  /** The thread's provider driver: how its live field reads a batch (`batchesByTiming`). */
  provider?: string | null;
  onRevertToTurnCount: (targetTurnCount: number, messageId: MessageId) => void;
  onRunShellCommand?: (command: string) => void;
  isRevertingCheckpoint: boolean;
  onImageExpand: (preview: ExpandedImagePreview) => void;
  activeThreadEnvironmentId: EnvironmentId;
  markdownCwd: string | undefined;
  resolvedTheme: "light" | "dark";
  timestampFormat: TimestampFormat;
  workspaceRoot: string | undefined;
  skills?: ReadonlyArray<Pick<ServerProviderSkill, "name" | "displayName">>;
  anchorMessageId: MessageId | null;
  onAnchorReady: (messageId: MessageId, anchorIndex: number) => void;
  contentInsetEndAdjustment: number;
  /**
   * Whether the timeline should keep pinning to the live edge as content
   * grows. Off while the user is reading history; LegendList's own
   * maintainScrollAtEnd would otherwise re-pin regardless of ChatView's
   * scroll-mode refs whenever the user drifts near the bottom.
   */
  liveFollowEnabled: boolean;
  /**
   * Where the list stands: at its end or not, which way it moved, and whether
   * a person's scroll moved it (`nextTimelineFollow`'s "position").
   */
  onIsAtEndChange: (
    isAtEnd: boolean,
    scroll: {
      readonly byPerson: boolean;
      readonly direction: TimelineScrollDirection | null;
      /** It jumped far up by no change of its content (`jumpedAway`). */
      readonly jumped?: boolean;
    },
  ) => void;
  /** A person's input on the list, as it comes: whether it leaves the end is the caller's to tell. */
  onPersonInput: (input: TimelinePersonInput) => void;
  onManualNavigation: () => void;
  /** Filled while a remembered reading position is being restored; calling it hands scrolling back. */
  cancelPositionRestoreRef?: React.RefObject<(() => void) | null>;
  hideEmptyPlaceholder?: boolean;
  /**
   * The conversation is on its way: a slow one shows its Mate at work in the
   * middle of the pane, and a quick one shows nothing at all.
   */
  loading?: boolean;
  /**
   * The conversation is still being read from the server (a remembered or
   * cached copy may be showing): what arrives meanwhile is history, and
   * nothing rises in until the read is done.
   */
  syncing?: boolean;
  topFadeEnabled?: boolean;
  /** Non-null when older turns exist beyond the loaded window. */
  loadEarlier?: { readonly loading: boolean; readonly onLoadEarlier: () => void } | null;
  /** Messages sent during the running turn. They render as ghost bubbles after the live rows. */
  queuedMessages?: ReadonlyArray<QueuedComposerMessage>;
  /** The server's pause on this thread, when a usage limit holds it now. */
  usagePause?: ServerUsagePause | null;
  onUsageAutoResumeChange?: ((enabled: boolean) => void) | null;
  onUsageContinue?: (() => void) | null;
  onSteerQueuedMessage?: (id: string) => void;
  steerQueuedMessageShortcutLabel?: string | null;
  /** A question or an approval waits on the person: the queue waits with it. */
  queueBlockedByAnswer?: boolean;
  onRemoveQueuedMessage?: (id: string) => void;
}

// ---------------------------------------------------------------------------
// MessagesTimeline — list owner
// ---------------------------------------------------------------------------

export const MessagesTimeline = memo(function MessagesTimeline({
  isWorking,
  workingStepLabel = null,
  isCompacting = false,
  activeTurnStartedAt,
  agentPanelModel,
  onOpenAgents = NOOP_OPEN_AGENTS,
  working: workingNow = null,
  afterTurnWork = null,
  liveJobs = null,
  onStopBackgroundWork = NOOP_STOP_BACKGROUND_WORK,
  stoppingBackgroundWork = false,
  listRef,
  timelineEntries,
  latestTurn,
  runningTurnId,
  turnDiffSummaries,
  routeThreadKey,
  onOpenTurnDiff,
  supportsConversationRollback,
  provider = null,
  onRevertToTurnCount,
  onRunShellCommand,
  isRevertingCheckpoint,
  onImageExpand,
  activeThreadEnvironmentId,
  markdownCwd,
  resolvedTheme,
  timestampFormat,
  workspaceRoot,
  skills = EMPTY_TIMELINE_SKILLS,
  anchorMessageId,
  onAnchorReady,
  contentInsetEndAdjustment,
  liveFollowEnabled,
  onIsAtEndChange,
  onPersonInput,
  onManualNavigation,
  cancelPositionRestoreRef,
  hideEmptyPlaceholder = false,
  loading = false,
  syncing = false,
  topFadeEnabled = false,
  loadEarlier = null,
  queuedMessages = EMPTY_QUEUED_MESSAGES,
  usagePause = null,
  onUsageAutoResumeChange = null,
  onUsageContinue = null,
  onSteerQueuedMessage = NOOP_QUEUED_MESSAGE_ACTION,
  steerQueuedMessageShortcutLabel = null,
  queueBlockedByAnswer = false,
  onRemoveQueuedMessage = NOOP_QUEUED_MESSAGE_ACTION,
}: MessagesTimelineProps) {
  // What runs alongside, a bar that ended showing its ending a moment (pass 35).
  const working = useEndingsHeld(workingNow, syncing);
  // The timeline mounts once per thread; a thread left mid-read comes back at
  // the same row.
  const rememberedPosition = useMemo(() => readTimelinePosition(routeThreadKey), [routeThreadKey]);
  const [positionRestored, setPositionRestored] = useState(
    () => rememberedPosition?.atEnd !== false,
  );
  const restoringReadingPosition = !positionRestored;
  const [minimapStripMap] = useState(() => new Map<string, HTMLSpanElement>());
  const endRepinFrameRef = useRef<number | null>(null);

  const previousContentInsetEndAdjustmentRef = useRef(contentInsetEndAdjustment);

  useLayoutEffect(() => {
    keepTimelineEndVisibleAfterOverlayGrowth({
      timeline: listRef.current,
      previousOverlayHeight: previousContentInsetEndAdjustmentRef.current,
      overlayHeight: contentInsetEndAdjustment,
      followingEnd: liveFollowEnabled && anchorMessageId === null,
    });
    previousContentInsetEndAdjustmentRef.current = contentInsetEndAdjustment;
  }, [anchorMessageId, contentInsetEndAdjustment, listRef, liveFollowEnabled]);

  useEffect(() => {
    return () => {
      if (endRepinFrameRef.current !== null) {
        cancelAnimationFrame(endRepinFrameRef.current);
      }
    };
  }, []);

  // A list the pane keeps (`KeptTimelines`): out of sight while the person
  // is elsewhere, shown again when they come back.
  const kept = use(KeptTimelineContext);
  // Where the person left off: the last visit this conversation remembers,
  // read as it opens — and as a kept list shows again — only when something
  // came since, so the line marks what is new and never follows the reader
  // around.
  const readNewSince = () => {
    const visitedAt = useUiStateStore.getState().threadLastVisitedAtById[routeThreadKey];
    const completedAt = latestTurn?.completedAt;
    return visitedAt && completedAt && Date.parse(completedAt) > Date.parse(visitedAt)
      ? visitedAt
      : null;
  };
  const [newSince, setNewSince] = useState(readNewSince);
  const readNewSinceRef = useRef(readNewSince);
  useLayoutEffect(() => {
    readNewSinceRef.current = readNewSince;
  });
  const shownAgain = kept?.shown ?? true;
  const firstShownRef = useRef(true);
  useLayoutEffect(() => {
    if (!shownAgain) return;
    if (firstShownRef.current) {
      firstShownRef.current = false;
      return;
    }
    setNewSince(readNewSinceRef.current());
  }, [shownAgain]);
  // A running turn's last words wait a moment once finished: the rows are
  // derived again when the newest wait runs out.
  const [nowMs, setNowMs] = useState(() => Date.now());
  const finishedWordsAt = useMemo(
    () => latestFinishedWordsAt(timelineEntries, isWorking),
    [timelineEntries, isWorking],
  );
  useEffect(() => {
    if (finishedWordsAt === null) return;
    // At most one wait from now, and past it when it fires: a client clock
    // behind the server's never stretches the wait.
    const timer = setTimeout(
      () => setNowMs(Math.max(Date.now(), finishedWordsAt + LAST_WORDS_GRACE_MS + 1)),
      Math.min(
        LAST_WORDS_GRACE_MS,
        Math.max(0, finishedWordsAt + LAST_WORDS_GRACE_MS - Date.now()),
      ) + 20,
    );
    return () => clearTimeout(timer);
  }, [finishedWordsAt]);
  // Which of the helpers one launch started woke a run: the panel knows when
  // each finished.
  const helperFinishes = useMemo(
    () => helperFinishesOf(agentPanelModel ?? EMPTY_AGENT_PANEL_MODEL),
    [agentPanelModel],
  );
  // Whether something runs alongside the live run: its card is then drawn a
  // slice a row, its panel one of them.
  const alongside = dockDraws(working);
  // What the last derive read and drew: a streamed update reads the live run again, no other.
  const [rowsCache] = useState(createMessagesTimelineRowsCache);
  const rawRows = useMemo(
    () =>
      deriveMessagesTimelineRows({
        cache: rowsCache,
        nowMs,
        newSince,
        timelineEntries,
        latestTurn,
        runningTurnId,
        isWorking,
        activeTurnStartedAt,
        turnDiffSummaries,
        supportsConversationRollback,
        queuedMessages,
        afterTurnWork,
        liveJobs,
        helperFinishes,
        alongside,
        provider,
      }),
    [
      nowMs,
      newSince,
      timelineEntries,
      latestTurn,
      runningTurnId,
      isWorking,
      activeTurnStartedAt,
      turnDiffSummaries,
      supportsConversationRollback,
      queuedMessages,
      afterTurnWork,
      liveJobs,
      helperFinishes,
      alongside,
      provider,
      rowsCache,
    ],
  );
  const stableRows = useStableRows(rawRows);
  // What a settle brings at once — the answer, the background card, a
  // background line — enters one after another (`usePace`); a card's own
  // slices and the person's words enter as they come.
  const pacedRowIds = useMemo(
    () => stableRows.flatMap((row) => (pacedRow(row) ? [row.id] : [])),
    [stableRows],
  );
  // Out of sight (a kept list), nobody watches: they are simply there.
  const rowsHeld = usePace({
    keys: pacedRowIds,
    flush: syncing || restoringReadingPosition || !(kept?.shown ?? true),
  });
  const rowsHeldKey = [...rowsHeld].join("\n");
  // Read by what they are: the list's data changes only when they do.
  const rows = useMemo(() => {
    if (rowsHeldKey === "") return stableRows;
    const held = new Set(rowsHeldKey.split("\n"));
    return stableRows.filter((row) => !held.has(row.id));
  }, [stableRows, rowsHeldKey]);
  // A crewmate's conversation (`CrewTimelineContext`, given for a crew thread
  // only) is empty while it holds nothing but seams.
  const crew = use(CrewTimelineContext);

  // Loading earlier turns keeps the row the person was reading where it
  // stood. The list keeps the first row in sight in place, and at the top of
  // a loaded window that is the day's seam, which moves to the top of what
  // loads: the conversation under it was thrown 3,300 px down (Nova,
  // 2026-09-28). The first row of the conversation in sight, never a seam, is
  // taken back to where it stood once the earlier turns are drawn above it.
  const earlierAnchorRef = useRef<{
    readonly id: string;
    readonly top: number;
    readonly firstId: string | undefined;
  } | null>(null);
  const onLoadEarlier = useCallback(() => {
    const viewport = listRef.current?.getScrollableNode() as HTMLElement | undefined;
    if (viewport !== undefined) {
      const anchor = earlierTurnsAnchor(
        [...viewport.querySelectorAll<HTMLElement>("[data-timeline-row-id]")].map((element) => {
          const box = element.getBoundingClientRect();
          return {
            id: element.dataset.timelineRowId ?? "",
            kind: element.dataset.timelineRowKind,
            top: box.top,
            bottom: box.bottom,
          };
        }),
        viewport.getBoundingClientRect().top,
      );
      earlierAnchorRef.current =
        anchor === null
          ? null
          : { ...anchor, firstId: rows.find((row) => row.kind !== "seam")?.id };
    }
    loadEarlier?.onLoadEarlier();
  }, [listRef, loadEarlier, rows]);
  useLayoutEffect(() => {
    const anchor = earlierAnchorRef.current;
    const viewport = listRef.current?.getScrollableNode() as HTMLElement | undefined;
    if (anchor === null || viewport === undefined) return;
    // Nothing came in above it yet: the earlier turns are still on their way.
    if (rows.find((row) => row.kind !== "seam")?.id === anchor.firstId) return;
    earlierAnchorRef.current = null;
    // The list places what arrived in frames of its own: the row is taken
    // back each time it writes a row's place, before the page paints it.
    const settle = () => {
      const element = viewport.querySelector(`[data-timeline-row-id="${CSS.escape(anchor.id)}"]`);
      if (element === null) return;
      const moved = element.getBoundingClientRect().top - anchor.top;
      if (Math.abs(moved) > 0.5) viewport.scrollTop += moved;
    };
    settle();
    const observer = new MutationObserver(settle);
    observer.observe(viewport, {
      attributes: true,
      attributeFilter: ["style"],
      childList: true,
      subtree: true,
    });
    // The list moves the page itself as it measures what arrived: taken back
    // then too. The person moving the page takes it over at once.
    viewport.addEventListener("scroll", settle, { passive: true });
    const release = () => {
      observer.disconnect();
      viewport.removeEventListener("scroll", settle);
      for (const type of GESTURES) viewport.removeEventListener(type, release);
    };
    for (const type of GESTURES) viewport.addEventListener(type, release, { passive: true });
    const done = setTimeout(release, 1000);
    return () => {
      clearTimeout(done);
      release();
    };
  }, [listRef, rows]);

  // Which rows stand where: what the list's containers are drawn again for.
  const rowOrder = useMemo(() => rows.map((row) => row.id).join("\n"), [rows]);
  const livePauseId = useMemo(
    () => rows.findLast((row) => row.kind === "pause" && row.resumedAt === null)?.id ?? null,
    [rows],
  );
  const minimapItems = useMemo(() => deriveTimelineMinimapItems(rows), [rows]);
  // The rows a reading position may land on stay drawn while it is put
  // back: its own, the run's line and the row above it.
  const restoringAlwaysRender = useMemo(() => {
    if (!restoringReadingPosition || !rememberedPosition) return undefined;
    const { rowId, cardTopId, previousRowId } = rememberedPosition;
    const indices = [rowId, cardTopId, previousRowId].flatMap((id) => {
      const index = id === null ? -1 : rows.findIndex((row) => row.id === id);
      return index >= 0 ? [index] : [];
    });
    return indices.length > 0 ? { indices } : undefined;
  }, [rememberedPosition, restoringReadingPosition, rows]);
  const [timelineViewportElement, setTimelineViewportElement] = useState<HTMLDivElement | null>(
    null,
  );
  const [listReady, setListReady] = useState(false);
  const onListLoad = useCallback(() => setListReady(true), []);
  // The list stands where it stays: a reading position put back, or the end
  // reached. Until then it is out of sight (`data-timeline-placing`).
  const [listPlaced, setListPlaced] = useState(false);
  const [minimapHasPersistentGutter, setMinimapHasPersistentGutter] = useState(false);
  const [minimapHitStripWidth, setMinimapHitStripWidth] = useState(0);
  const [minimapCurrentIndex, setMinimapCurrentIndex] = useState<number | null>(null);
  const handleAnchorReady = useCallback(
    (info: { anchorIndex: number | undefined }) => {
      if (anchorMessageId !== null && info.anchorIndex !== undefined) {
        onAnchorReady(anchorMessageId, info.anchorIndex);
      }
    },
    [anchorMessageId, onAnchorReady],
  );
  const anchoredEndSpace = useMemo(() => {
    const config = resolveChatListAnchoredEndSpace(rows, anchorMessageId, (row) =>
      row.kind === "message" && row.message.role === "user" ? row.message.id : null,
    );
    return config ? { ...config, onReady: handleAnchorReady } : undefined;
  }, [anchorMessageId, handleAnchorReady, rows]);
  // The list holds its end while nothing else holds the viewport: a reading
  // position coming back, a sent message kept near the top, history being
  // read.
  const followingEnd = !restoringReadingPosition && !anchoredEndSpace && liveFollowEnabled;
  const followingEndRef = useRef(followingEnd);
  useLayoutEffect(() => {
    followingEndRef.current = followingEnd;
  }, [followingEnd]);
  // What keeps the list at its end while it follows (`createEndFollow`): at
  // once for growth that comes a few pixels a frame, by a glide for a step.
  // The list's own keeping is off: it jumps.
  const endFollowRef = useRef<EndFollow | null>(null);
  useEffect(() => {
    const endFollow = createEndFollow({
      viewport: () => listRef.current?.getScrollableNode() ?? null,
      // Whether it stands at its end is the follower's own judgement, from
      // the scrolls it hears: the list's own reading goes stale mid-glide.
      follows: () => followingEndRef.current,
    });
    endFollowRef.current = endFollow;
    return () => {
      endFollow.stop();
      endFollowRef.current = null;
    };
  }, [listRef]);
  const followEnd = useCallback(() => endFollowRef.current?.follow(), []);
  // Rows arriving, and the viewport resizing, move the end too.
  useLayoutEffect(() => {
    if (!followingEnd || !listPlaced || rows.length === 0) return;
    const frame = requestAnimationFrame(followEnd);
    return () => cancelAnimationFrame(frame);
  }, [followEnd, followingEnd, listPlaced, rows]);
  useEffect(() => {
    const viewport = timelineViewportElement;
    if (viewport === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(followEnd);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [followEnd, timelineViewportElement]);
  // LegendList re-pins the end itself only for a measurement that moved a row
  // by more than 5 px, so a row easing taller is followed here too — on the
  // next frame, as LegendList does: the scroll range takes the growth once the
  // list has re-rendered its new size.
  const onItemSizeChanged = useCallback(
    ({ previous, size }: { readonly previous: number; readonly size: number }) => {
      if (!followingEndRef.current || size <= previous) return;
      // In the frame the row grew, once the list has drawn its new size (its
      // render runs in a microtask queued before this one), so nothing under
      // the reader moves for a frame; and again on the next frame, for a
      // render the list put off.
      queueMicrotask(followEnd);
      if (endRepinFrameRef.current !== null) return;
      endRepinFrameRef.current = requestAnimationFrame(() => {
        endRepinFrameRef.current = null;
        followEnd();
      });
    },
    [followEnd],
  );

  // Where the person is, kept as they move, by row: the row at the reading
  // line, how far into it, how tall it was, the run's line and the row above
  // it — what finds the place again once rows have changed (a watched run
  // folds when the person leaves).
  const rememberPosition = useCallback((): boolean | undefined => {
    const state = listRef.current?.getState?.();
    // Nothing is the person's place while the list is still being placed.
    if (restoringReadingPosition || !listPlaced || state === undefined || state.data !== rows) {
      return undefined;
    }
    const isAtEnd = resolveTimelineIsAtEnd(state, contentInsetEndAdjustment);
    const anchor = state.data.length ? resolveTimelineScrollAnchor(state) : undefined;
    const row = anchor === undefined ? undefined : state.elementAtIndex(anchor.index);
    const element = listRef.current?.getScrollableNode();
    if (anchor && row && element && isAtEnd !== undefined) {
      const box = row.getBoundingClientRect();
      rememberTimelinePosition(routeThreadKey, {
        rowId: anchor.rowId,
        // DOM geometry includes the header and the virtualizer's layout adjustment.
        offsetWithinRow: element.getBoundingClientRect().top - box.top,
        rowHeight: box.height,
        ...describeTimelineAnchor(rows, anchor.index),
        atEnd: isAtEnd,
      });
    }
    return isAtEnd;
  }, [
    contentInsetEndAdjustment,
    listPlaced,
    listRef,
    restoringReadingPosition,
    routeThreadKey,
    rows,
  ]);
  // Once more as the conversation goes, while it still stands on the page:
  // what changed since the last scroll (a run opened or closed in place) is
  // where the person left it.
  const rememberPositionRef = useRef(rememberPosition);
  useLayoutEffect(() => {
    rememberPositionRef.current = rememberPosition;
  }, [rememberPosition]);
  useLayoutEffect(() => () => void rememberPositionRef.current(), []);

  // What a person is doing to the list, so a scroll they make is told from
  // one the list or the browser makes as rows land, grow, settle or shrink.
  const personSessionRef = useRef<PersonScrollSession>(PERSON_SCROLL_IDLE);
  const notePersonSession = useCallback((event: PersonScrollSessionEvent) => {
    personSessionRef.current = nextPersonScrollSession(personSessionRef.current, event);
  }, []);
  const onPersonInputRef = useRef(onPersonInput);
  useLayoutEffect(() => {
    onPersonInputRef.current = onPersonInput;
  }, [onPersonInput]);
  // Every input a person gives the list, observed here once: each starts or
  // holds their scroll session, and each is handed up to decide follow.
  useEffect(() => {
    const wrapper = timelineViewportElement;
    if (!wrapper) return;
    const scrollNode = () => listRef.current?.getScrollableNode() ?? null;
    const input = (personInput: TimelinePersonInput) => {
      notePersonSession({ type: "input", at: performance.now() });
      onPersonInputRef.current(personInput);
    };
    let wheelLatch: WheelGestureLatch | null = null;
    const onWheel = (event: WheelEvent) => {
      const node = scrollNode();
      if (!node || event.ctrlKey || !isVerticalWheel(event.deltaX, event.deltaY)) return;
      // Whatever it scrolls, the wheel is the person's: should the browser
      // hand the rest of a gesture to the list, the list's move is theirs.
      notePersonSession({ type: "input", at: performance.now() });
      // A wheel that started in a nested scroller (a run's own scroll, a code
      // block) does not leave the end, for the whole gesture it started.
      const direction = event.deltaY < 0 ? "up" : "down";
      wheelLatch = latchWheelGesture(wheelLatch, { at: performance.now(), direction }, () =>
        isTimelineScrollTarget(event.target, node, event.deltaY),
      );
      if (wheelLatch.targetsList) onPersonInputRef.current({ kind: "wheel", direction });
    };
    const onTouchStart = () =>
      notePersonSession({ type: "hold", by: "touch", at: performance.now() });
    const onTouchMove = () => input({ kind: "touch-move" });
    const onTouchEnd = () =>
      notePersonSession({ type: "release", by: "touch", at: performance.now() });
    // The scrollbar: the only pointerdown whose target is the scroll node itself.
    const onPointerDown = (event: PointerEvent) => {
      const node = scrollNode();
      if (!node || !(event.target instanceof Node) || !node.contains(event.target)) return;
      if (event.target === node) {
        notePersonSession({ type: "hold", by: "pointer", at: performance.now() });
        onPersonInputRef.current({ kind: "scrollbar" });
      } else {
        onPersonInputRef.current({ kind: "content-pointer" });
      }
    };
    const onPointerUp = () =>
      notePersonSession({ type: "release", by: "pointer", at: performance.now() });
    // With the focus on the page (a click on message text leaves it there),
    // scroll keys move the scroller around what was last clicked.
    let lastPointerTarget: Element | null = null;
    const onDocumentPointerDown = (event: PointerEvent) => {
      const node = scrollNode();
      lastPointerTarget =
        node !== null && event.target instanceof Element && node.contains(event.target)
          ? event.target
          : null;
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const node = scrollNode();
      if (!node || event.defaultPrevented) return;
      const direction = timelineScrollKeyInput({
        key: event.key,
        shiftKey: event.shiftKey,
        target: event.target,
        timeline: node,
        lastPointerTarget,
      });
      if (direction !== null) input({ kind: "key", direction });
    };
    // The end of a scroll ends the person's session with it.
    const onScrollEnd = (event: Event) => {
      if (event.target === scrollNode()) notePersonSession({ type: "scroll-ended" });
    };
    const document = wrapper.ownerDocument;
    const view = document.defaultView ?? window;
    wrapper.addEventListener("wheel", onWheel, { passive: true });
    wrapper.addEventListener("touchstart", onTouchStart, { passive: true });
    wrapper.addEventListener("touchmove", onTouchMove, { passive: true });
    wrapper.addEventListener("pointerdown", onPointerDown, { passive: true });
    wrapper.addEventListener("scrollend", onScrollEnd, { capture: true });
    document.addEventListener("pointerdown", onDocumentPointerDown, {
      capture: true,
      passive: true,
    });
    document.addEventListener("keydown", onKeyDown);
    view.addEventListener("touchend", onTouchEnd, { passive: true });
    view.addEventListener("touchcancel", onTouchEnd, { passive: true });
    view.addEventListener("pointerup", onPointerUp, { passive: true });
    view.addEventListener("pointercancel", onPointerUp, { passive: true });
    return () => {
      wrapper.removeEventListener("wheel", onWheel);
      wrapper.removeEventListener("touchstart", onTouchStart);
      wrapper.removeEventListener("touchmove", onTouchMove);
      wrapper.removeEventListener("pointerdown", onPointerDown);
      wrapper.removeEventListener("scrollend", onScrollEnd, { capture: true });
      document.removeEventListener("pointerdown", onDocumentPointerDown, { capture: true });
      document.removeEventListener("keydown", onKeyDown);
      view.removeEventListener("touchend", onTouchEnd);
      view.removeEventListener("touchcancel", onTouchEnd);
      view.removeEventListener("pointerup", onPointerUp);
      view.removeEventListener("pointercancel", onPointerUp);
    };
  }, [listRef, notePersonSession, timelineViewportElement]);

  // What a person opens comes into view (`revealBy`): for a moment after
  // their click, while it eases open, the list glides by as much as shows
  // its foot over the composer, never its opener off the top; a scroll of
  // theirs ends it.
  const insetEndRef = useRef(contentInsetEndAdjustment);
  useLayoutEffect(() => {
    insetEndRef.current = contentInsetEndAdjustment;
  }, [contentInsetEndAdjustment]);
  useEffect(() => {
    const wrapper = timelineViewportElement;
    if (!wrapper || typeof requestAnimationFrame !== "function") return;
    let frame = 0;
    let until = 0;
    let last = 0;
    let opener: HTMLElement | null = null;
    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      opener = null;
    };
    const regionOf = (button: HTMLElement): HTMLElement | null => {
      const id = button.getAttribute("aria-controls");
      const controlled = id === null ? null : button.ownerDocument.getElementById(id);
      return (
        controlled ??
        button.closest<HTMLElement>("[data-chat-row],[data-background-line],[data-timeline-row-id]")
      );
    };
    const step = (now: number) => {
      frame = 0;
      const viewport = listRef.current?.getScrollableNode();
      if (opener === null || !viewport || !opener.isConnected || now > until) {
        stop();
        return;
      }
      frame = requestAnimationFrame(step);
      if (opener.getAttribute("aria-expanded") !== "true") return;
      const region = regionOf(opener);
      if (region === null) return;
      const box = viewport.getBoundingClientRect();
      // Inside a run's own scroll, what shows of it ends at that scroll's foot.
      const inner = region.closest<HTMLElement>("[data-run-scroll]");
      const bottom = Math.min(
        region.getBoundingClientRect().bottom,
        inner?.getBoundingClientRect().bottom ?? Number.POSITIVE_INFINITY,
      );
      const by = revealBy({
        openerTop: opener.getBoundingClientRect().top,
        regionBottom: bottom,
        view: { top: box.top, bottom: box.bottom - insetEndRef.current },
      });
      const dt = last === 0 ? 1000 / 60 : now - last;
      last = now;
      if (by <= 0.5) return;
      // Under reduced motion it stands there at once.
      if (reducedMotion()) {
        viewport.scrollTop += by;
        stop();
        return;
      }
      viewport.scrollTop += approach(0, by, dt, FOLLOW_TAU_MS);
    };
    const onClick = (event: globalThis.MouseEvent) => {
      const button =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>("[aria-expanded]")
          : null;
      if (button === null || button.getAttribute("aria-expanded") === "true") return;
      opener = button;
      until = performance.now() + REVEAL_FOR_MS;
      last = 0;
      if (frame === 0) frame = requestAnimationFrame(step);
    };
    // Any scroll of the person's ends it: a wheel, a touch, the keys, the scrollbar.
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (SCROLL_KEYS.has(event.key)) stop();
    };
    const onPointerDown = (event: globalThis.PointerEvent) => {
      if (event.target === listRef.current?.getScrollableNode()) stop();
    };
    wrapper.addEventListener("click", onClick, { capture: true });
    wrapper.addEventListener("wheel", stop, { passive: true });
    wrapper.addEventListener("touchmove", stop, { passive: true });
    wrapper.addEventListener("pointerdown", onPointerDown, { passive: true });
    wrapper.ownerDocument.addEventListener("keydown", onKey);
    return () => {
      stop();
      wrapper.removeEventListener("click", onClick, { capture: true });
      wrapper.removeEventListener("wheel", stop);
      wrapper.removeEventListener("touchmove", stop);
      wrapper.removeEventListener("pointerdown", onPointerDown);
      wrapper.ownerDocument.removeEventListener("keydown", onKey);
    };
  }, [listRef, timelineViewportElement]);

  // Where the list stood at the last read: what tells which way it moved since.
  const lastReadingRef = useRef<TimelineScrollReading | null>(null);

  const readList = useCallback(
    (personScrolling: boolean, own = false) => {
      const node = listRef.current?.getScrollableNode();
      const reading = node ? { scrollTop: node.scrollTop, contentHeight: node.scrollHeight } : null;
      const scroll = reading
        ? {
            ...classifyTimelineScroll({
              previous: lastReadingRef.current,
              current: reading,
              personScrolling,
            }),
            // A jump far up that no change of the content explains — find in
            // page, a fragment link, focus moving — leaves the end, whoever
            // made it; the page's own moves never do.
            jumped: !own && jumpedAway({ previous: lastReadingRef.current, current: reading }),
          }
        : { byPerson: false, direction: null };
      lastReadingRef.current = reading && nextTimelineReading(lastReadingRef.current, reading);
      notePersonSession({ type: "scrolled", at: performance.now(), byPerson: scroll.byPerson });
      const state = listRef.current?.getState?.();
      if (restoringReadingPosition || state?.data !== rows) return;
      const isAtEnd = rememberPosition();
      if (isAtEnd !== undefined) {
        onIsAtEndChange(isAtEnd, scroll);
      }
      if (!state || minimapItems.length === 0) {
        return;
      }

      const scrollTop = state.scroll ?? 0;
      const scrollBottom = scrollTop + (state.scrollLength ?? 0);

      const itemBounds = minimapItems.map((item) => ({
        top: resolveTimelineRowTop(state, item.rowIndex),
        height: resolveTimelineRowHeight(state, item.rowIndex),
      }));

      for (const [index, item] of minimapItems.entries()) {
        const strip = minimapStripMap.get(item.id);
        const bounds = itemBounds[index];
        const rowTop = bounds?.top ?? null;
        const rowHeight = bounds?.height ?? null;
        const inView =
          rowTop !== null &&
          rowTop < scrollBottom &&
          rowTop + Math.max(1, rowHeight ?? 1) > scrollTop;

        // Written only on a change: a write restyles the mark even when it
        // says what it said, and this runs on every scroll event.
        const said = inView ? "true" : "false";
        if (strip && strip.dataset.inView !== said) {
          strip.dataset.inView = said;
        }
      }
      const nextCurrentIndex = resolveTimelineMinimapCurrentIndex({
        scrollTop,
        scrollBottom,
        itemBounds,
      });
      setMinimapCurrentIndex((current) =>
        current === nextCurrentIndex ? current : nextCurrentIndex,
      );
    },
    [
      listRef,
      minimapItems,
      minimapStripMap,
      notePersonSession,
      onIsAtEndChange,
      rememberPosition,
      restoringReadingPosition,
      rows,
    ],
  );
  // A move the page made itself (`scrollOwn`: a glide, a fold) is never the
  // person's, however recently they touched the list.
  const handleScroll = useCallback(() => {
    const node = listRef.current?.getScrollableNode();
    const own = node !== null && node !== undefined && takeOwnScroll(node);
    readList(!own && personIsScrolling(personSessionRef.current, performance.now()), own);
  }, [listRef, readList]);

  // Rows changed under the list: where it stands now is none of the person's doing.
  useEffect(() => {
    const frame = requestAnimationFrame(() => readList(false));
    return () => cancelAnimationFrame(frame);
  }, [readList, rows.length]);

  useEffect(() => {
    if (!timelineViewportElement) {
      return;
    }

    const measure = () => {
      const viewportWidth = timelineViewportElement.getBoundingClientRect().width;
      const nextHasPersistentGutter = resolveTimelineMinimapHasPersistentGutter(viewportWidth);
      setMinimapHasPersistentGutter((current) =>
        current === nextHasPersistentGutter ? current : nextHasPersistentGutter,
      );
      setMinimapHitStripWidth(resolveTimelineMinimapHitStripWidth(viewportWidth));
    };

    const frame = requestAnimationFrame(measure);

    const observer = new ResizeObserver(measure);
    observer.observe(timelineViewportElement);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [timelineViewportElement, rows.length]);

  // The Mate once the directory names it, a neutral speaker before; a crewmate's conversation is
  // the crewmate's: its name and its face speak on every line — the work line too (ARCHITECTURE §6).
  const whoLivesHere = useZeropsMate(activeThreadEnvironmentId);
  const mate = whoLivesHere.kind === "mate" ? whoLivesHere.mate : undefined;
  const crewmate = crew?.crewmate ?? null;
  const nobody = whoLivesHere.kind === "nobody";
  const speaker = useMemo(
    () => conversationSpeaker({ crewmate, mate: mate ?? null, nobody }),
    [crewmate, mate, nobody],
  );
  const openingName = crewmate !== null ? speaker.name : mate?.name;
  // What the conversation held when it opened, on the server's clock: a
  // message newer than that arrived while the person watched. Measured per
  // conversation, from the rows themselves, so a client clock that runs
  // behind the server's never makes the history rise in as it opens.
  const newestMessageAt = useMemo(() => {
    let newest = Number.NEGATIVE_INFINITY;
    for (const row of rows) {
      if (row.kind !== "message") continue;
      const at = Date.parse(row.createdAt);
      if (at > newest) newest = at;
    }
    return newest;
  }, [rows]);
  const [openedWith, setOpenedWith] = useState<{
    readonly key: string;
    readonly at: number;
  } | null>(null);
  // Until the conversation is read, the baseline follows its newest message:
  // a cached copy painting first, then the server's newer messages landing,
  // is history arriving, not a message arriving while the person watched.
  if (
    newestMessageAt > Number.NEGATIVE_INFINITY &&
    (openedWith?.key !== routeThreadKey || (syncing && newestMessageAt > openedWith.at))
  ) {
    setOpenedWith({ key: routeThreadKey, at: newestMessageAt });
  }
  const arrivedAfter = openedWith?.key === routeThreadKey ? openedWith.at : null;
  // The stand-up's ask, in a Mate's main conversation: a quiet line, not the person's bubble.
  const standUpAsk = useMateStandUpAskLine(
    crewmate === null ? parseScopedThreadKey(routeThreadKey) : null,
  );
  // A run the person watched stays open while they are here; once they leave
  // the conversation every run in it folds, so coming back it is folded from
  // the first frame and nothing moves (K7). It folds as the timeline goes,
  // never while it is still on screen.
  // A list the pane keeps (`KeptTimelines`) hides as the person leaves and
  // shows again as they come back, its runs as they stood: the keeper folds
  // them once it lets the list go.
  const foldsOfRef = useRef(routeThreadKey);
  useLayoutEffect(() => {
    foldsOfRef.current = routeThreadKey;
  }, [routeThreadKey]);
  const keptBy = kept !== null;
  useEffect(() => {
    if (keptBy) return;
    return () => forgetRunFolds(foldsOfRef.current);
  }, [keptBy]);
  // Shown after it was kept out of sight: what came meanwhile is history,
  // not a message arriving while the person watched.
  const newestMessageAtRef = useRef(newestMessageAt);
  useLayoutEffect(() => {
    newestMessageAtRef.current = newestMessageAt;
  });
  const shown = kept?.shown ?? true;
  useLayoutEffect(() => {
    if (!shown) return;
    const at = newestMessageAtRef.current;
    setOpenedWith((opened) =>
      opened === null || opened.key !== foldsOfRef.current || opened.at >= at
        ? opened
        : { key: opened.key, at },
    );
  }, [shown]);

  // Its own memo: a ref made afresh with every other change of the rows'
  // shared state handed every message's markdown a new prop, and each was
  // parsed again.
  const threadRef = useMemo(() => parseScopedThreadKey(routeThreadKey), [routeThreadKey]);
  const sharedState = useMemo<TimelineRowSharedState>(
    () => ({
      timestampFormat,
      routeThreadKey,
      threadRef,
      markdownCwd,
      resolvedTheme,
      workspaceRoot,
      skills,
      activeThreadEnvironmentId,
      onRevertToTurnCount,
      onRunShellCommand,
      onImageExpand,
      onOpenTurnDiff,
      speaker,
      standUpAsk,
      livePauseId,
      usagePause,
      onUsageAutoResumeChange,
      onUsageContinue,
      agentPanelModel: agentPanelModel ?? EMPTY_AGENT_PANEL_MODEL,
      onOpenAgents,
      onStopBackgroundWork,
      onSteerQueuedMessage,
      steerQueuedMessageShortcutLabel,
      queueBlockedByAnswer,
      onRemoveQueuedMessage,
      arrivedAfter,
      syncing,
      onHoldReading: onManualNavigation,
    }),
    [
      timestampFormat,
      routeThreadKey,
      threadRef,
      markdownCwd,
      resolvedTheme,
      workspaceRoot,
      skills,
      activeThreadEnvironmentId,
      onRevertToTurnCount,
      onRunShellCommand,
      onImageExpand,
      onOpenTurnDiff,
      speaker,
      standUpAsk,
      livePauseId,
      usagePause,
      onUsageAutoResumeChange,
      onUsageContinue,
      agentPanelModel,
      onOpenAgents,
      onStopBackgroundWork,
      onSteerQueuedMessage,
      steerQueuedMessageShortcutLabel,
      queueBlockedByAnswer,
      onRemoveQueuedMessage,
      arrivedAfter,
      syncing,
      onManualNavigation,
    ],
  );
  const activityState = useMemo<TimelineRowActivityState>(
    () => ({
      isWorking,
      isCompacting,
      isRevertingCheckpoint,
      latestTurnId: latestTurn?.turnId ?? null,
      workingStepLabel,
      stoppingBackgroundWork,
    }),
    [
      isCompacting,
      isRevertingCheckpoint,
      isWorking,
      latestTurn?.turnId,
      workingStepLabel,
      stoppingBackgroundWork,
    ],
  );

  // Stable renderItem — no closure deps. Row components read shared state
  // from TimelineRowCtx, which propagates through LegendList's memo.
  const renderItem = useCallback(
    ({ item }: { item: MessagesTimelineRow }) => (
      <div className="mx-auto w-full min-w-0 max-w-3xl overflow-x-clip" data-timeline-root="true">
        <TimelineRowContent row={item} />
      </div>
    ),
    [],
  );

  const empty =
    crew === null
      ? rows.length === 0
      : rows.every((row) => row.kind === "seam" || row.kind === "crew-seam");
  // A working Mate's conversation still on its way shows its pane, never a
  // run made up from its status alone: the conversation replaced it a moment
  // later, 1,480 px away.
  const onItsWay = loading && timelineEntries.length === 0;
  const showsList = !onItsWay && (!empty || isWorking);
  if (!showsList && (listReady || listPlaced)) {
    setListReady(false);
    setListPlaced(false);
  }
  // Placing: from the list's mount until it stands where it stays — a
  // reading position put back, or the end reached — out of sight, then shown.
  // One loop, however often the rows change: a Mate streaming its answer
  // changes them every frame, and a restore restarted on each change never
  // landed. It reads the rows as they are each frame and moves the page
  // itself, since the list holds an imperative scroll back while its data
  // changes. Loaded rows with a measured anchor show once that scroll is applied;
  // the list's own placing at the end cannot hold them behind an elapsed-time guess.
  // The keeper hears when the open list stands where it stays, a conversation
  // on its way included: nothing warms while the pane is still switching.
  const standing = showsList ? listPlaced : !(hideEmptyPlaceholder && loading);
  const onStanding = kept?.onStanding;
  useLayoutEffect(() => {
    onStanding?.(routeThreadKey, standing);
  }, [onStanding, routeThreadKey, standing]);
  const rowsRef = useRef(rows);
  const listReadyRef = useRef(listReady);
  useLayoutEffect(() => {
    rowsRef.current = rows;
    listReadyRef.current = listReady;
  });
  useLayoutEffect(() => {
    if (!showsList || listPlaced) return;
    const list = listRef.current;
    const viewport: HTMLElement | null = list?.getScrollableNode() ?? null;
    if (!list || !viewport) return;
    const position = restoringReadingPosition ? rememberedPosition : undefined;
    let cancelled = false;
    let frame: number | null = null;
    let stableFrames = 0;
    const finish = () => {
      if (cancelled) return;
      cancelled = true;
      if (frame !== null) cancelAnimationFrame(frame);
      if (position !== undefined) setPositionRestored(true);
      setListPlaced(true);
    };
    // A reading position being put back hands the page to the person's
    // first gesture.
    const takeOver = () => {
      finish();
      onManualNavigation();
    };
    const onScrollKey = (event: globalThis.KeyboardEvent) => {
      if (
        ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key) &&
        !(
          event.target instanceof Element &&
          event.target.closest("input, textarea, [contenteditable=true]")
        )
      )
        takeOver();
    };
    if (position !== undefined) {
      viewport.addEventListener("wheel", takeOver, { passive: true });
      viewport.addEventListener("touchmove", takeOver, { passive: true });
      viewport.addEventListener("pointerdown", takeOver, { passive: true });
      viewport.ownerDocument.addEventListener("keydown", onScrollKey);
      onManualNavigation();
      if (cancelPositionRestoreRef) cancelPositionRestoreRef.current = finish;
    }
    const rowElement = (rowId: string) => {
      const state = list.getState();
      const index = state.indexByKey(rowId);
      return index === undefined ? undefined : (state.elementAtIndex(index) ?? undefined);
    };
    // Where the view should stand now: the remembered row's line where it
    // was (a run folded since at its line), or the end; null until the row
    // it lands on is drawn.
    const aim = (): number | null => {
      const end = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
      if (position === undefined) return end;
      const target = resolveTimelineRestoreTarget({
        position,
        rowIds: rowsRef.current.map((row) => row.id),
        heightOf: (rowId) => rowElement(rowId)?.getBoundingClientRect().height,
      });
      if (target.kind === "end") return end;
      const row = rowElement(target.rowId);
      if (row === undefined) return null;
      const box = row.getBoundingClientRect();
      const offsetWithinRow =
        target.kind === "row"
          ? target.offsetWithinRow
          : (target.edge === "foot" ? box.height : 0) - readTimelineFirstLineInset(viewport);
      return Math.max(
        0,
        Math.min(
          viewport.scrollTop + box.top - viewport.getBoundingClientRect().top + offsetWithinRow,
          end,
        ),
      );
    };
    const tick = () => {
      if (cancelled) return;
      const target = aim();
      const judged = judgeTimelinePlacing(
        {
          listReady: listReadyRef.current,
          offBy: target === null ? null : viewport.scrollTop - target,
        },
        stableFrames,
      );
      stableFrames = judged.stableFrames;
      if (judged.verdict === "placed") {
        finish();
        return;
      }
      if (judged.verdict === "correct" && target !== null) {
        viewport.scrollTop = target;
        // The loaded rows and this measured anchor are now placed. Streaming may move the end
        // every frame, so verify the scroll we applied instead of waiting for silence.
        if (Math.abs(viewport.scrollTop - target) <= 1) {
          finish();
          return;
        }
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelled = true;
      if (frame !== null) cancelAnimationFrame(frame);
      if (position === undefined) return;
      if (cancelPositionRestoreRef?.current === finish) cancelPositionRestoreRef.current = null;
      viewport.removeEventListener("wheel", takeOver);
      viewport.removeEventListener("touchmove", takeOver);
      viewport.removeEventListener("pointerdown", takeOver);
      viewport.ownerDocument.removeEventListener("keydown", onScrollKey);
    };
  }, [
    cancelPositionRestoreRef,
    listPlaced,
    listRef,
    onManualNavigation,
    rememberedPosition,
    restoringReadingPosition,
    showsList,
  ]);
  const content = !showsList ? (
    hideEmptyPlaceholder ? (
      <div
        className="relative h-full min-h-0"
        data-timeline-loading="true"
        data-timeline-thread={routeThreadKey}
      />
    ) : crew === null ? (
      <TimelineEmptyState environmentId={activeThreadEnvironmentId} threadKey={routeThreadKey} />
    ) : (
      <CrewmateEmptyState
        bottomInset={contentInsetEndAdjustment}
        crew={crew}
        environmentId={activeThreadEnvironmentId}
        mateFace={mate ?? null}
        seams={rows.flatMap((row) => (row.kind === "crew-seam" ? [row] : []))}
      />
    )
  ) : (
    <TimelineRowCtx value={sharedState}>
      <TimelineRowActivityCtx value={activityState}>
        <TimelineWorkingCtx value={working}>
          <TooltipScrollDismissArea
            ref={setTimelineViewportElement}
            className="relative h-full min-h-0"
            // Whether the list follows its end: a run's fold then keeps its
            // line in place while the list catches up (`foldAway`).
            data-timeline-follows-end={followingEnd ? "" : undefined}
            // Rows waiting their turn to enter (`usePace`): a run's fold waits for them.
            data-timeline-arriving={rowsHeldKey === "" ? undefined : ""}
            data-timeline-placing={listPlaced ? undefined : ""}
            // The placed rows take the opening stage's place in the readiness frame.
            data-timeline-arrives="at-once"
            data-timeline-thread={routeThreadKey}
          >
            <LegendList<MessagesTimelineRow>
              ref={listRef}
              data={rows}
              // Each container reads its row again whenever a row comes, goes
              // or moves. LegendList (3.3.5) draws `data[indexByKey(key)]`
              // once per container and keeps it until that container's own
              // data changes: read while a row was being inserted, the index
              // was the old one, and the container went on drawing the row
              // that slid into it — a row twice, a card's edge gone (Rhea,
              // run 11). A row that only changed in place is its container's
              // own data, which the list hands it: the rest are not drawn
              // again for it, on every streamed update.
              extraData={rowOrder}
              keyExtractor={keyExtractor}
              getItemType={getItemType}
              renderItem={renderItem}
              estimatedItemSize={90}
              initialScrollAtEnd={rememberedPosition?.atEnd !== false}
              {...(restoringAlwaysRender ? { alwaysRender: restoringAlwaysRender } : {})}
              {...(anchoredEndSpace ? { anchoredEndSpace } : {})}
              contentInsetEndAdjustment={contentInsetEndAdjustment}
              // Off, no band: an end scroll LegendList queued before the person
              // left is dropped once their scroll lands.
              maintainScrollAtEndThreshold={followingEnd ? TIMELINE_FOLLOW_THRESHOLD : 0}
              // The end is kept here (`createEndFollow`), never by the list: its keeping jumps.
              maintainScrollAtEnd={false}
              onItemSizeChanged={onItemSizeChanged}
              maintainVisibleContentPosition={
                restoringReadingPosition ? false : MAINTAIN_VISIBLE_CONTENT_POSITION
              }
              onScroll={handleScroll}
              onLoad={onListLoad}
              className={cn(
                "timeline-legend-list scrollbar-gutter-both h-full min-h-0 overflow-x-hidden overscroll-y-contain px-3 [overflow-anchor:none] sm:px-5",
                topFadeEnabled && "topbar-scroll-fade",
              )}
              ListHeaderComponent={
                loadEarlier !== null ? (
                  <TimelineLoadEarlierHeader
                    loading={loadEarlier.loading}
                    onLoadEarlier={onLoadEarlier}
                    fade={topFadeEnabled}
                  />
                ) : topFadeEnabled ? (
                  TIMELINE_LIST_FADE_HEADER
                ) : (
                  TIMELINE_LIST_HEADER
                )
              }
              ListFooterComponent={TIMELINE_LIST_FOOTER}
            />
            <TimelineMinimap
              items={minimapItems}
              hasPersistentGutter={minimapHasPersistentGutter}
              hitStripWidth={minimapHitStripWidth}
              currentIndex={minimapCurrentIndex}
              stripMap={minimapStripMap}
              onSelect={(item) => {
                onManualNavigation();
                // The person picked where to go: the list's way there is
                // theirs, and landing on the latest follows it.
                notePersonSession({ type: "input", at: performance.now() });
                void listRef.current?.scrollToIndex({
                  index: item.rowIndex,
                  animated: !reducedMotion(),
                  viewOffset: 24,
                });
              }}
            />
          </TooltipScrollDismissArea>
        </TimelineWorkingCtx>
      </TimelineRowActivityCtx>
    </TimelineRowCtx>
  );
  return (
    <>
      {content}
      {kept?.shown === false ? null : (
        <ConversationOpeningStage ready={standing} name={openingName} mate={mate ?? null} />
      )}
    </>
  );
});

function keyExtractor(item: MessagesTimelineRow) {
  return item.id;
}

function getItemType(item: MessagesTimelineRow) {
  return item.kind === "message" ? `message:${item.message.role}` : item.kind;
}

interface TimelinePositionState {
  readonly contentLength?: number;
  readonly scroll?: number;
  readonly scrollLength?: number;
  readonly positionAtIndex?: (index: number) => number | undefined;
  readonly sizeAtIndex?: (index: number) => number | undefined;
}

function resolveTimelineRowTop(state: TimelinePositionState, rowIndex: number) {
  const top = state.positionAtIndex?.(rowIndex);
  return typeof top === "number" && Number.isFinite(top) ? top : null;
}

function resolveTimelineRowHeight(state: TimelinePositionState, rowIndex: number) {
  const height = state.sizeAtIndex?.(rowIndex);
  return typeof height === "number" && Number.isFinite(height) ? height : null;
}

function timelineMinimapEventTargetsPreview(target: EventTarget): boolean {
  return target instanceof Element && target.closest("[data-minimap-preview]") !== null;
}

const MINIMAP_TONE_CLASS: Record<TimelineMinimapItem["tone"], string | null> = {
  quiet: null,
  produced: "bg-status-ok data-[in-view=true]:bg-status-ok",
  failed: "bg-status-failed data-[in-view=true]:bg-status-failed",
  paused: "bg-status-attention data-[in-view=true]:bg-status-attention",
};

function TimelineMinimap({
  hasPersistentGutter,
  hitStripWidth,
  currentIndex,
  items,
  stripMap,
  onSelect,
}: {
  hasPersistentGutter: boolean;
  hitStripWidth: number;
  currentIndex: number | null;
  items: ReadonlyArray<TimelineMinimapItem>;
  stripMap: Map<string, HTMLSpanElement>;
  onSelect: (item: TimelineMinimapItem) => void;
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const resolvedActiveIndex =
    activeIndex !== null && activeIndex < items.length ? activeIndex : null;
  const activeItem = useMemo(
    () =>
      resolveTimelineMinimapPreview(
        resolvedActiveIndex === null ? null : (items[resolvedActiveIndex] ?? null),
      ),
    [items, resolvedActiveIndex],
  );
  const activeTopPercent =
    resolvedActiveIndex === null
      ? 0
      : resolveTimelineMinimapTopPercent(resolvedActiveIndex, items.length);
  const activeTooltipTranslate =
    resolvedActiveIndex === null
      ? "-50%"
      : resolvedActiveIndex === 0
        ? "0%"
        : resolvedActiveIndex === items.length - 1
          ? "-100%"
          : "-50%";
  const resolvedCurrentIndex =
    currentIndex !== null && currentIndex >= 0 && currentIndex < items.length ? currentIndex : null;
  const previousItem =
    resolvedCurrentIndex === null ? null : (items[resolvedCurrentIndex - 1] ?? null);
  const nextItem = resolvedCurrentIndex === null ? null : (items[resolvedCurrentIndex + 1] ?? null);

  const resolveActiveIndexFromPointer = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      return resolveTimelineMinimapIndexFromPointer({
        itemCount: items.length,
        railTop: rect.top,
        railHeight: rect.height,
        pointerY: event.clientY,
      });
    },
    [items.length],
  );

  const updateActiveIndexFromPointer = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      const nextIndex = resolveActiveIndexFromPointer(event);
      setActiveIndex(nextIndex);
    },
    [resolveActiveIndexFromPointer],
  );

  const moveActiveIndex = useCallback(
    (delta: number) => {
      setActiveIndex((current) => {
        const base = current ?? 0;
        return Math.max(0, Math.min(items.length - 1, base + delta));
      });
    },
    [items.length],
  );

  if (items.length < TIMELINE_MINIMAP_MIN_ITEMS) {
    return null;
  }

  return (
    <div
      className={cn(
        "group/minimap pointer-events-none absolute inset-y-0 left-0 z-40 hidden w-18 [@media(pointer:fine)]:block",
        hasPersistentGutter
          ? "opacity-100"
          : "opacity-0 transition-opacity duration-150 hover:opacity-100 focus-within:opacity-100",
      )}
      data-testid="timeline-minimap"
      data-persistent-gutter={hasPersistentGutter ? "true" : "false"}
    >
      <div className="relative h-full w-full select-none">
        <div
          className={cn(
            "absolute top-1/2 left-3 -translate-y-1/2",
            // The strip is width-capped to the side gutter so it never overlays
            // the centered content column; with no usable gutter it goes inert.
            hitStripWidth > 0 ? "pointer-events-auto" : "pointer-events-none",
          )}
          style={{
            height: resolveTimelineMinimapHeightStyle(items.length),
            width: resolveTimelineMinimapInteractiveWidth(hitStripWidth, activeItem !== null),
          }}
        >
          <TimelineMinimapNavigationButton
            direction="previous"
            disabled={previousItem === null}
            onClick={() => {
              if (previousItem) onSelect(previousItem);
            }}
          />
          <button
            aria-label={`Jump to message: ${activeItem?.userText ?? "User message"}`}
            className="absolute inset-y-0 left-0 w-full cursor-pointer bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
            onBlur={() => setActiveIndex(null)}
            onClick={(event) => {
              if (timelineMinimapEventTargetsPreview(event.target)) {
                return;
              }
              const nextIndex = resolveActiveIndexFromPointer(event);
              const selectedItem = nextIndex === null ? null : (items[nextIndex] ?? null);
              if (selectedItem) {
                onSelect(selectedItem);
              }
              event.currentTarget.blur();
            }}
            onFocus={() => setActiveIndex((current) => current ?? resolvedCurrentIndex ?? 0)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                moveActiveIndex(1);
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                moveActiveIndex(-1);
              } else if (event.key === "Home") {
                event.preventDefault();
                setActiveIndex(0);
              } else if (event.key === "End") {
                event.preventDefault();
                setActiveIndex(items.length - 1);
              } else if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                if (activeItem) {
                  onSelect(activeItem);
                }
              }
            }}
            onMouseLeave={() => setActiveIndex(null)}
            onMouseMove={updateActiveIndexFromPointer}
            onMouseDown={(event) => {
              if (timelineMinimapEventTargetsPreview(event.target)) {
                return;
              }
              event.preventDefault();
            }}
            type="button"
          >
            <div className="absolute top-0 left-3 h-full w-px bg-border/15" />
            {items.map((item, index) => {
              const top = `${resolveTimelineMinimapTopPercent(index, items.length)}%`;
              const activeDistance =
                resolvedActiveIndex === null ? null : Math.abs(index - resolvedActiveIndex);
              return (
                <span
                  aria-hidden="true"
                  className={cn(
                    "pointer-events-none absolute left-0 h-0.5 -translate-y-1/2 rounded-full bg-muted-foreground/35 transition-[width,background-color] duration-150 data-[in-view=true]:bg-foreground/90",
                    activeDistance === 0
                      ? "w-6 bg-muted-foreground/75"
                      : activeDistance === 1
                        ? "w-4"
                        : activeDistance === 2
                          ? "w-2.5"
                          : "w-2",
                    // The turn map: a stretch's outcome in its colour, its
                    // length in the mark's weight, a message sent into a
                    // running turn as a dot.
                    MINIMAP_TONE_CLASS[item.tone],
                    item.weight === 1 ? "h-1" : item.weight === 2 ? "h-1.5" : null,
                    item.aside && activeDistance !== 0 ? "w-1" : null,
                  )}
                  data-in-view="false"
                  data-minimap-strip
                  key={item.id}
                  ref={(node) => {
                    if (node) {
                      stripMap.set(item.id, node);
                    } else {
                      stripMap.delete(item.id);
                    }
                  }}
                  style={{ top }}
                />
              );
            })}
            {activeItem ? (
              <span
                className="pointer-events-auto absolute left-8 w-80 cursor-text select-text"
                data-minimap-preview
                onMouseMove={(event) => event.stopPropagation()}
                style={{
                  top: `${activeTopPercent}%`,
                  transform: `translateY(${activeTooltipTranslate})`,
                }}
              >
                <span className="dropdown-glass block rounded-xl p-3 text-left text-popover-foreground shadow-xl shadow-black/25">
                  <span className="block max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-sm font-medium leading-5">
                    {activeItem.userText ?? "User message"}
                  </span>
                  {(activeItem.assistantText ?? activeItem.note) ? (
                    <span
                      className="mt-1 max-h-[3.75rem] overflow-hidden text-muted-foreground text-sm leading-5"
                      style={{
                        display: "-webkit-box",
                        WebkitBoxOrient: "vertical",
                        WebkitLineClamp: 3,
                      }}
                    >
                      {activeItem.assistantText ?? activeItem.note}
                    </span>
                  ) : null}
                </span>
              </span>
            ) : null}
          </button>
          <TimelineMinimapNavigationButton
            direction="next"
            disabled={nextItem === null}
            onClick={() => {
              if (nextItem) onSelect(nextItem);
            }}
          />
        </div>
      </div>
    </div>
  );
}

function TimelineMinimapNavigationButton({
  direction,
  disabled,
  onClick,
}: {
  direction: "previous" | "next";
  disabled: boolean;
  onClick: () => void;
}) {
  const previous = direction === "previous";
  const label = previous ? "Previous turn" : "Next turn";
  const Icon = previous ? ChevronUpIcon : ChevronDownIcon;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={cn(
              "absolute left-1 z-10 inline-flex -translate-x-1/2 opacity-0 pointer-events-auto transition-opacity duration-150 hover:opacity-100 focus-within:opacity-100",
              previous ? "bottom-[calc(100%+2px)]" : "top-[calc(100%+2px)]",
            )}
          />
        }
      >
        <Button
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          size="icon-micro"
          type="button"
          variant="ghost-muted"
        >
          <Icon className="size-4 text-foreground/90" />
        </Button>
      </TooltipTrigger>
      <TooltipPopup side={previous ? "top" : "bottom"}>{label}</TooltipPopup>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// TimelineRowContent — the actual row component
// ---------------------------------------------------------------------------

type TimelineWorkEntry = Extract<MessagesTimelineRow, { kind: "work" }>["groupedEntries"][number];
type TimelineRow = MessagesTimelineRow;

/**
 * The room a row keeps above itself (see `rowGap`), so the ink stands where
 * the rhythm says: a part 24 px under the person's bubble or the card's
 * edge, a turn 64 px under them. The answer's prose adds its own: 3 px of
 * leading above its first line (21 + 3), and under its last line 3 px of
 * leading and its 28 px copy line (33 + 31).
 */
const GAP_CLASS: Record<RowGap, string> = {
  none: "",
  tight: "pt-1",
  line: "pt-3",
  block: "pt-5",
  part: "pt-6",
  "part-words": "pt-5.25",
  turn: "pt-16",
  "turn-after-words": "pt-8.25",
};

/**
 * Where a row with no card sits across the column. The person's messages hug
 * the right edge, a seam — a day's, a crew's — spans it, and the Mate's work that outlived its
 * turn is a card of its own; everything else the Mate says stands on the
 * composer's text edge — its 1 px frame and 16 px padding — so the answer,
 * an event and the text inside every card start on one line.
 */
function rowInset(row: TimelineRow): string {
  if (row.kind === "message" && row.message.role === "user") return "";
  if (
    row.kind === "queued-message" ||
    row.kind === "seam" ||
    row.kind === "crew-seam" ||
    row.kind === "after-work"
  ) {
    return "";
  }
  // A line with no card keeps the card's geometry in a frame nobody sees, so
  // opening it draws the card around the line without moving it.
  if (row.kind === "work-line") return "run-tray-ghost";
  return "px-4.25";
}

/**
 * A stretch's card, a slice per row (`MessagesTimelineRow.card`): its line is
 * the top, with the room above it outside the card; each row of its body is
 * a band of the card with its room inside; a row of its own is the bottom
 * edge. One frame, one surface, one inner edge — the composer's.
 */
const CARD_SLICE: Record<CardSlice, string> = {
  top: "run-tray run-tray-top",
  middle: "run-tray run-tray-middle",
  bottom: "run-tray run-tray-bottom",
};
// Where two slices meet, each row's clip snapped away from the joint and the
// page showed through as a hairline (2026-09-29): a slice with another under
// it lays its ground across the joint (`[data-card-slice]` in index.css).

/**
 * The messages that have risen into place once: the list draws a row again
 * whenever it recycles it, and a message scrolled back into sight stays put.
 */
const enteredMessages = new Set<string>();

/**
 * Whether a row is a message that arrived while the person watched, and has
 * not risen in yet: the person's words from their side, the Mate's up from
 * just below. What the conversation opened onto is simply there.
 */
export function messageEnters(row: TimelineRow, arrivedAfter: number | null): boolean {
  if (arrivedAfter === null || row.kind !== "message") return false;
  if (enteredMessages.has(row.id)) return false;
  return Date.parse(row.createdAt) > arrivedAfter;
}

const TimelineRowContent = memo(function TimelineRowContent({ row }: { row: TimelineRow }) {
  const gap = GAP_CLASS[row.gap ?? "none"];
  const card = row.card;
  const content = <TimelineRowBody row={row} />;
  const { arrivedAfter, standUpAsk } = use(TimelineRowCtx);
  const [entering] = useState(() => messageEnters(row, arrivedAfter));
  useEffect(() => {
    if (!entering) return;
    // The oldest goes first: clearing them all would let every message of
    // the open conversation newer than its opening rise in again.
    if (enteredMessages.size >= 500) {
      const oldest = enteredMessages.values().next();
      if (!oldest.done) enteredMessages.delete(oldest.value);
    }
    enteredMessages.add(row.id);
  }, [entering, row.id]);
  const person =
    row.kind === "message" && row.message.role === "user" && !isStandUpAskRow(row, standUpAsk);
  return (
    <div
      className={cn(
        card === undefined || card === "top" ? gap : null,
        card === undefined ? rowInset(row) : null,
        row.kind === "message" && row.message.role === "assistant" ? "group/assistant" : null,
        entering &&
          (person
            ? "origin-bottom-right animate-bubble-in motion-reduce:animate-none"
            : "animate-rise-in motion-reduce:animate-none"),
      )}
      data-card-slice={card}
      data-card-whole={row.cardWhole ? "" : undefined}
      data-timeline-row-id={row.id}
      data-timeline-row-kind={row.kind}
      data-message-id={row.kind === "message" ? row.message.id : undefined}
      data-message-role={row.kind === "message" ? row.message.role : undefined}
    >
      {card === undefined ? (
        content
      ) : (
        <div className={cn(CARD_SLICE[card], card === "middle" ? gap : null)}>{content}</div>
      )}
    </div>
  );
});

/** A message that is a Mate's stand-up ask, where the conversation draws it as its quiet line. */
function isStandUpAskRow(row: TimelineRow, standUpAsk: string | null): boolean {
  return (
    standUpAsk !== null &&
    row.kind === "message" &&
    row.message.role === "user" &&
    isMateStandUpAsk(row.message.text)
  );
}

function TimelineRowBody({ row }: { row: TimelineRow }) {
  const ctx = use(TimelineRowCtx);
  const askLine = isStandUpAskRow(row, ctx.standUpAsk);
  return (
    <>
      {askLine && row.kind === "message" && ctx.standUpAsk !== null ? (
        <StandUpAskLine
          at={row.message.createdAt}
          timestampFormat={ctx.timestampFormat}
          words={ctx.standUpAsk}
        />
      ) : null}
      {row.kind === "message" && row.message.role === "user" && !askLine ? (
        <UserTimelineRow row={row} />
      ) : null}
      {row.kind === "message" && row.message.role === "assistant" ? (
        <AssistantTimelineRow row={row} />
      ) : null}
      {row.kind === "work-line" ? <WorkLineTimelineRow row={row} /> : null}
      {row.kind === "record" ? <RecordTimelineRow row={row} /> : null}
      {row.kind === "working" ? <WorkingTimelineRow row={row} /> : null}
      {row.kind === "after-work" ? <AfterWorkTimelineRow row={row} /> : null}
      {row.kind === "work" ? (
        <WorkGroupSection
          groupedEntries={row.groupedEntries}
          isExpandedToolGroupEntry={row.isExpandedToolGroupEntry}
        />
      ) : null}
      {row.kind === "operation" ? <OperationTimelineRow row={row} /> : null}
      {row.kind === "event" ? <EventTimelineRow row={row} /> : null}
      {row.kind === "crew-card" ? <CrewCardTimelineRow row={row} /> : null}
      {row.kind === "background" ? <BackgroundTimelineRow row={row} /> : null}
      {row.kind === "error" ? (
        <ErrorLine label={row.entry.label} detail={row.entry.detail} />
      ) : null}
      {row.kind === "pause" ? <PauseTimelineRow row={row} /> : null}
      {row.kind === "outcome" ? <OutcomeTimelineRow row={row} /> : null}
      {row.kind === "vault-request" ? <VaultRequestTimelineRow row={row} /> : null}
      {row.kind === "seam" ? <SeamTimelineRow row={row} /> : null}
      {row.kind === "crew-seam" ? <CrewSeamActivity seam={row.seam} words={row.words} /> : null}
      {row.kind === "proposed-plan" ? <ProposedPlanTimelineRow row={row} /> : null}
      {row.kind === "queued-message" ? <QueuedMessageTimelineRow row={row} /> : null}
    </>
  );
}

function WorkLineTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "work-line" }> }) {
  return <RunLine status={row} />;
}

/**
 * Turns whose Mate at work this page watched live: their report arrives as
 * the panel settles into it, once. A report scrolled back into view, or read
 * after a reload, is simply there.
 */
const watchedTurnKeys = new Set<string>();

/**
 * Where the Mate at work last stood, per run, while this page drew it: its
 * row, its card's bottom edge and its line, and when it left. What settles in
 * its place — the report, or the Mate's last word under a run with nothing to
 * report — starts there and eases to its own height, so a panel folding away
 * never throws what follows (Nova, 2026-09-27: a tall panel folding into its
 * report threw a streamed answer 470 px). Only a panel that left just now
 * folds: one scrolled away, or never seen, is simply gone.
 */
interface PanelStand {
  readonly panel: number;
  readonly cardEnd: number;
  readonly line: number;
}
const panelStands = new Map<string, PanelStand>();
/**
 * When a run's panel left the rows, read from the rows themselves: the list
 * mounts and unmounts its rows in its own order, so the row that replaces the
 * panel may arrive before the panel's own row is gone.
 */
const panelLeftAt = new Map<string, number>();
/** When what replaced a run's panel first took its stand: an effect replayed takes it again. */
const panelTakenAt = new Map<string, number>();
const FOLD_RETAKE_MS = 50;

/** Marks the runs whose panel the rows no longer carry. */
function markPanelsGone(
  previous: ReadonlyArray<MessagesTimelineRow>,
  rows: ReadonlyArray<MessagesTimelineRow>,
): void {
  const live = new Set(rows.flatMap((row) => (row.kind === "working" ? [row.turnKey] : [])));
  const now = performance.now();
  for (const row of previous) {
    if (row.kind === "working" && !live.has(row.turnKey)) panelLeftAt.set(row.turnKey, now);
  }
  for (const turnKey of live) {
    panelLeftAt.delete(turnKey);
    panelTakenAt.delete(turnKey);
  }
}
const FOLD_FRESH_MS = 1500;
/** How long after its panel left a run's report, arriving late, still eases in. */
const FOLD_LATE_MS = 4000;
const FOLD_EASE = "height 460ms cubic-bezier(0.32, 0.72, 0, 1)";

function rowElementById(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-timeline-row-id="${CSS.escape(id)}"]`);
}

/**
 * The stand a run's panel just left, for what takes its place: null when the
 * panel is still there, left a while ago, or its stand was taken already — an
 * effect replayed at once (React's strict mode runs each twice) takes it again.
 */
function takePanelStand(turnKey: string): PanelStand | null {
  const stand = panelStands.get(turnKey);
  const leftAt = panelLeftAt.get(turnKey);
  if (stand === undefined || leftAt === undefined) return null;
  const now = performance.now();
  const takenAt = panelTakenAt.get(turnKey);
  if (takenAt === undefined) panelTakenAt.set(turnKey, now);
  else if (now - takenAt > FOLD_RETAKE_MS) return null;
  return now - leftAt < FOLD_FRESH_MS ? stand : null;
}

/** A run's panel left the rows a moment ago: what arrives in its place late still eases. */
function panelLeftRecently(turnKey: string): boolean {
  const leftAt = panelLeftAt.get(turnKey);
  return leftAt !== undefined && performance.now() - leftAt < FOLD_LATE_MS;
}

/** Eases an element's height from `from` to `to`, then lets it size itself again. */
function easeHeight(element: HTMLElement, from: number, to: number): () => void {
  if (Math.abs(to - from) < 1 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return () => {};
  }
  const release = () => {
    element.style.height = "";
    element.style.overflow = "";
    element.style.transition = "";
  };
  element.style.height = `${from}px`;
  element.style.overflow = "hidden";
  const frame = requestAnimationFrame(() => {
    element.style.transition = FOLD_EASE;
    element.style.height = `${to}px`;
  });
  const onEnd = (event: TransitionEvent) => {
    if (event.target !== element || event.propertyName !== "height") return;
    element.removeEventListener("transitionend", onEnd);
    release();
  };
  element.addEventListener("transitionend", onEnd);
  return () => {
    cancelAnimationFrame(frame);
    element.removeEventListener("transitionend", onEnd);
    release();
  };
}

/** Records where a run's panel stands while the rows carry it. */
function usePanelStand(turnKey: string, cardKey: string) {
  const markerRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const own = markerRef.current?.closest<HTMLElement>("[data-timeline-row-id]");
    if (!own) return;
    const measure = () => {
      // Gone from the rows, its row may still be emptied or recycled: its
      // last stand is the one it left.
      if (panelLeftAt.has(turnKey) || !own.isConnected) return;
      const panel = own.getBoundingClientRect().height;
      if (panel <= 0) return;
      panelStands.set(turnKey, {
        panel,
        cardEnd: rowElementById(`card-end:${cardKey}`)?.getBoundingClientRect().height ?? 0,
        line: rowElementById(`work-line:${cardKey}`)?.getBoundingClientRect().height ?? 0,
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(own);
    return () => {
      observer.disconnect();
      // Unmounted while the rows still carry it — scrolled out of the list's
      // window — its stand would be stale by the time it is taken.
      if (!panelLeftAt.has(turnKey)) panelStands.delete(turnKey);
    };
  }, [turnKey, cardKey]);
  return markerRef;
}

/**
 * Room at the top of the Mate's last word under a run that settled into its
 * line alone: as tall as the panel that just stood there, easing to nothing.
 */
function FoldRoom({ fold }: { readonly fold: FoldsFrom | undefined }) {
  const roomRef = useRef<HTMLDivElement>(null);
  // Once it folds it folds through: a report arriving a moment later — the
  // files a run changed are known after its settle — eases in from the card
  // while this room eases on to nothing, rather than snapping shut.
  const [folding, setFolding] = useState<FoldsFrom | undefined>(fold);
  if (fold !== undefined && folding === undefined) setFolding(fold);
  useLayoutEffect(() => {
    const room = roomRef.current;
    if (folding === undefined || room === null) return;
    const stand = takePanelStand(folding.turnKey);
    if (stand === null) return;
    const lineNow = rowElementById(`work-line:${folding.cardKey}`)?.getBoundingClientRect().height;
    const from =
      stand.panel +
      (folding.cardClosed ? stand.cardEnd + (stand.line - (lineNow ?? stand.line)) : 0);
    return easeHeight(room, from, 0);
  }, [folding]);
  return <div ref={roomRef} aria-hidden="true" data-fold-room />;
}

/** What runs alongside the Mate, under its record. */
function WorkingTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "working" }> }) {
  const ctx = use(TimelineRowCtx);
  const { stoppingBackgroundWork } = use(TimelineRowActivityCtx);
  const dock = use(TimelineWorkingCtx);
  useEffect(() => {
    watchedTurnKeys.add(row.turnKey);
  }, [row.turnKey]);
  const standRef = usePanelStand(row.turnKey, row.cardKey);
  const { cardKey } = row;
  const carry = useCallback(() => cardRowsCarried(standRef.current, cardKey), [standRef, cardKey]);
  const onRoom = useCallback(
    (room: number | null) => holdCardRoom(standRef.current, cardKey, room),
    [standRef, cardKey],
  );
  return (
    <div ref={standRef} className="contents">
      <ConversationWorking
        carry={carry}
        onRoom={onRoom}
        dock={dock}
        environmentId={ctx.activeThreadEnvironmentId}
        incidents={row.incidents}
        onOpenAgents={ctx.onOpenAgents}
        threadRef={ctx.threadRef}
        {...(row.waiting === true
          ? { stop: { stopping: stoppingBackgroundWork, onStop: ctx.onStopBackgroundWork } }
          : {})}
      />
    </div>
  );
}

/**
 * The room a live card's panel holds while it closes (`ConversationWorking`),
 * on the card's line: drawn whole by that row (`[data-card-whole]`), the card
 * reaches over it (`--card-room`).
 */
function holdCardRoom(from: HTMLElement | null, cardKey: string, room: number | null) {
  const list = from?.closest<HTMLElement>(".timeline-legend-list") ?? null;
  const line = list?.querySelector<HTMLElement>(
    `[data-timeline-row-id="${CSS.escape(`record:${cardKey}`)}"] > .run-tray`,
  );
  if (line === null || line === undefined) return;
  if (room === null || room < 0.5) {
    line.style.removeProperty("--card-room");
    return;
  }
  line.style.setProperty("--card-room", `${room}px`);
}

/**
 * The rows of a live card the list moves as what runs alongside gives its
 * room back (`ConversationWorking`), from inside that card's working row.
 * Following its end, the list re-pins to it, and what stands above the room
 * goes down with it — the card's line and the room's own row — while the
 * card's edge stands still. Else the list keeps its place, and the card's
 * edge comes up.
 */
function cardRowsCarried(
  from: HTMLElement | null,
  cardKey: string,
): ReadonlyArray<CarriedRow> | null {
  const own = from?.closest<HTMLElement>("[data-card-slice]") ?? null;
  const list = own?.closest<HTMLElement>(".timeline-legend-list") ?? null;
  if (own === null || list === null) return null;
  const find = (id: string) =>
    list.querySelector<HTMLElement>(`[data-timeline-row-id="${CSS.escape(id)}"]`);
  const line = find(`record:${cardKey}`);
  const edge = find(`card-end:${cardKey}`);
  if (own.closest("[data-timeline-follows-end]") !== null) {
    return [
      ...(line === null ? [] : [{ row: line, direction: 1 as const }]),
      { row: own, direction: 1 },
      ...(edge === null ? [] : [{ row: edge, direction: 0 as const }]),
    ];
  }
  return edge === null ? [] : [{ row: edge, direction: -1 }];
}

/** Work that outlived the turn: the Mate at work, smaller, until it ends. */
function AfterWorkTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "after-work" }> }) {
  const ctx = use(TimelineRowCtx);
  const { stoppingBackgroundWork } = use(TimelineRowActivityCtx);
  const dock = use(TimelineWorkingCtx);
  return (
    <ConversationAfterWork
      dock={dock}
      environmentId={ctx.activeThreadEnvironmentId}
      onOpenAgents={ctx.onOpenAgents}
      onStop={ctx.onStopBackgroundWork}
      speaker={ctx.speaker}
      state={row.state}
      stopping={stoppingBackgroundWork}
      threadRef={ctx.threadRef}
    />
  );
}

/**
 * A run's chat in its card: every bubble in one scroll, and, while the Mate
 * works, its face beside what it is on at the end — the one place the present
 * is shown, so nothing is ever drawn twice (the owner, 2026-09-27: "it
 * literally duplicates what's the mate bubbles").
 */
function RecordTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "record" }> }) {
  return <RunChat row={row} />;
}

/**
 * Background work as one quiet line (`backgroundLine.logic`): what a settled
 * turn sent to the background, on its own card (`jobs:`), work that finished
 * outside any turn, or what woke the run under it.
 */
function BackgroundTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "background" }> }) {
  const items =
    row.jobs !== undefined
      ? jobItems(row.jobs)
      : row.entries.length > 0
        ? taskItems(row.entries)
        : // A helper the panel says finished, with no report of its own here.
          [
            {
              key: row.id,
              title: row.title ?? (row.helpers ? "A helper" : "A background task"),
              state: row.failed > 0 ? ("failed" as const) : ("done" as const),
              report: null,
              mono: false,
            },
          ];
  return <BackgroundLine line={backgroundLineOf(items, row.helpers)} />;
}

function EventTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "event" }> }) {
  const ctx = use(TimelineRowCtx);
  return (
    <EventLine
      at={row.createdAt}
      event={row.event}
      speaker={ctx.speaker}
      timestampFormat={ctx.timestampFormat}
    />
  );
}

/** The task the server handed a crewmate, drawn as a task (`CrewTaskCard.tsx`). */
function CrewCardTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "crew-card" }> }) {
  return <CrewTaskCard card={row.task} id={row.id} />;
}

/** Wake at the provider deadline; a historical refusal does not keep a clock running. */
function PauseTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "pause" }> }) {
  const ctx = use(TimelineRowCtx);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const resetsAt = (row.id === ctx.livePauseId ? ctx.usagePause?.resetsAt : null) ?? row.resetsAt;
  const waiting = row.resumedAt === null && resetsAt !== null;
  useEffect(() => {
    if (!waiting || resetsAt === null || Date.parse(resetsAt) <= nowMs) return;
    const refreshClock = () => setNowMs(Date.now());
    // Browser timer bounds only schedule another comparison, never an early reset.
    const delay = Math.max(0, Math.min(Date.parse(resetsAt) - Date.now(), 2 ** 31 - 1));
    const id = setTimeout(refreshClock, delay);
    window.addEventListener("focus", refreshClock);
    return () => {
      clearTimeout(id);
      window.removeEventListener("focus", refreshClock);
    };
  }, [waiting, resetsAt, nowMs]);
  return (
    <PauseBlock
      nowMs={nowMs}
      onAutoResumeChange={row.id === ctx.livePauseId ? ctx.onUsageAutoResumeChange : null}
      onContinue={row.id === ctx.livePauseId ? (ctx.onUsageContinue ?? null) : null}
      row={row}
      serverPause={row.id === ctx.livePauseId ? ctx.usagePause : null}
      speaker={ctx.speaker}
      timestampFormat={ctx.timestampFormat}
    />
  );
}

function OutcomeTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "outcome" }> }) {
  const ctx = use(TimelineRowCtx);
  const [settling] = useState(() => watchedTurnKeys.delete(row.outcome.turnKey));
  const markerRef = useRef<HTMLDivElement>(null);
  const turnKey = row.outcome.turnKey;
  // The panel it replaces stood here a moment ago: the report's band of the
  // card starts at the panel's height and eases to its own.
  useLayoutEffect(() => {
    const band = markerRef.current?.parentElement;
    if (!band) return;
    const stand = takePanelStand(turnKey);
    if (stand !== null) return easeHeight(band, stand.panel, band.getBoundingClientRect().height);
    // Its panel already folded into the Mate's last word: the report came
    // after, and grows in from nothing.
    if (panelLeftRecently(turnKey)) return easeHeight(band, 0, band.getBoundingClientRect().height);
  }, [turnKey]);
  return (
    // The result stands under the worked line, inside the tray (T5): a
    // hairline, then its rows in the card's grid; nothing at all when the run
    // left none.
    <div ref={markerRef} className="run-band">
      <TurnReport
        onOpenImage={ctx.onImageExpand}
        onOpenTurnDiff={(turnId, fromTurnId) =>
          ctx.onOpenTurnDiff(turnId, undefined, fromTurnId ?? undefined)
        }
        outcome={row.outcome}
        settling={settling}
      />
    </div>
  );
}

function SeamTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "seam" }> }) {
  const ctx = use(TimelineRowCtx);
  return <Seam row={row} timestampFormat={ctx.timestampFormat} />;
}

/**
 * A message waiting for the running turn: a dashed user bubble with icon
 * actions inside it. The dashed outline and the clock carry the state; the
 * timing reads from the clock's tooltip.
 */
export function QueuedMessageTimelineRow({
  row,
}: {
  row: Extract<TimelineRow, { kind: "queued-message" }>;
}) {
  const ctx = use(TimelineRowCtx);
  const { queuedMessage } = row;
  const attachmentCount = queuedMessage.images.length;
  const contextCount = queuedMessage.terminalContexts.length + queuedMessage.reviewComments.length;
  const text = queuedMessage.prompt.trim();
  const state = queuedBubbleState({
    message: queuedMessage,
    isNext: row.isNext,
    heldAhead: row.heldAhead,
    blockedByAnswer: ctx.queueBlockedByAnswer === true,
  });
  return (
    <div className="flex flex-col items-end" data-queued-message-id={queuedMessage.id}>
      <div className="max-w-[80%] rounded-2xl border border-dashed border-border p-3 text-message-foreground/80">
        {text.length > 0 ? (
          <UserMessageBody
            text={text}
            terminalContexts={[]}
            skills={ctx.skills}
            markdownCwd={ctx.markdownCwd}
          />
        ) : null}
        {attachmentCount > 0 || contextCount > 0 ? (
          <div className={cn("text-secondary-label text-xs", text.length > 0 && "mt-1.5")}>
            {[
              attachmentCount > 0
                ? `${attachmentCount} attachment${attachmentCount === 1 ? "" : "s"}`
                : null,
              contextCount > 0
                ? `${contextCount} context item${contextCount === 1 ? "" : "s"}`
                : null,
            ]
              .filter(Boolean)
              .join(", ")}
          </div>
        ) : null}
        <div className="mt-2 flex items-center gap-4 text-secondary-label text-xs">
          {/* The clock's place, one line high: what it waits for, or why its send was refused. */}
          {state.line === null ? (
            <Tooltip>
              <TooltipTrigger
                render={<span className="inline-flex h-6 items-center" />}
                aria-label={`Queued. ${state.clockLabel}.`}
              >
                <ClockIcon className="size-3.5" aria-hidden />
              </TooltipTrigger>
              <TooltipPopup side="bottom">{state.clockLabel}</TooltipPopup>
            </Tooltip>
          ) : (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span
                    className={cn(
                      "min-w-0 truncate leading-6",
                      state.line.tone === "error" && "text-destructive",
                    )}
                    data-queued-line={state.line.tone}
                  />
                }
              >
                {state.line.text}
              </TooltipTrigger>
              <TooltipPopup side="bottom">{state.line.text}</TooltipPopup>
            </Tooltip>
          )}
          <div className="ml-auto flex items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost-muted"
                    onPointerDown={(event) => event.preventDefault()}
                    // Held back while an answer is due, never pressed to do nothing: it says why.
                    aria-disabled={state.send.disabled ? true : undefined}
                    onClick={() => {
                      if (!state.send.disabled) ctx.onSteerQueuedMessage(queuedMessage.id);
                    }}
                    aria-label={state.send.label}
                  />
                }
              >
                {state.send.retry ? (
                  <RotateCcwIcon className="size-3.5" aria-hidden />
                ) : (
                  <ArrowUpIcon className="size-3.5" aria-hidden />
                )}
              </TooltipTrigger>
              <TooltipPopup side="bottom">
                {state.send.label}
                {row.isNext && !state.send.disabled && ctx.steerQueuedMessageShortcutLabel
                  ? ` (${ctx.steerQueuedMessageShortcutLabel})`
                  : null}
              </TooltipPopup>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost-muted"
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={() => ctx.onRemoveQueuedMessage(queuedMessage.id)}
                    aria-label="Cancel and return to the composer"
                  />
                }
              >
                <XIcon className="size-3.5" aria-hidden />
              </TooltipTrigger>
              <TooltipPopup side="bottom">Cancel and return to the composer</TooltipPopup>
            </Tooltip>
          </div>
        </div>
      </div>
    </div>
  );
}

const MESSAGE_HEADING_LEVEL = 3;

function MessageAuthorHeading({ children }: { children: string }) {
  return <h3 className="sr-only select-none">{children}</h3>;
}

function UserTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "message" }> }) {
  const ctx = use(TimelineRowCtx);
  const resources = useMemo(
    () => selectMessageImageResources(row.message.attachments),
    [row.message.attachments],
  );
  const previewStates = useAssetUrlStates(ctx.activeThreadEnvironmentId, resources);
  const pictureStates = useMemo(
    () =>
      new Map(resources.map((resource, index) => [resource.attachmentId, previewStates[index]!])),
    [previewStates, resources],
  );
  const [projectPreviews] = useState(createMessageAttachmentPreviewProjector);
  const messageWithPreviews = useMemo(() => {
    const urlsById = new Map(
      resources.flatMap((resource, index) => {
        const state = previewStates[index];
        return state?._tag === "Success" ? [[resource.attachmentId, state.url] as const] : [];
      }),
    );
    return projectPreviews(row.message, (attachment) => urlsById.get(attachment.id));
  }, [previewStates, projectPreviews, resources, row.message]);
  const userImages = (messageWithPreviews.attachments ?? []).filter(isImageAttachment);
  // The client's own placeholder for an image-only message is nothing the person wrote.
  const displayedUserMessage = deriveDisplayedUserMessageState(
    row.imageOnly ? "" : row.message.text,
  );
  const terminalContexts = displayedUserMessage.contexts;
  // Pictures sit where the person put them; images no label places stay above the words.
  const placedPictures = useMemo(
    () =>
      placeMessagePictures(displayedUserMessage.visibleText, messageWithPreviews.attachments ?? []),
    [displayedUserMessage.visibleText, messageWithPreviews.attachments],
  );
  const pictureContexts = useMemo(
    () =>
      placedPictures ? terminalContextsBySegment(placedPictures.segments, terminalContexts) : null,
    [placedPictures, terminalContexts],
  );
  const pictureDimensions = useMessagePictureDimensions(ctx.activeThreadEnvironmentId, resources);
  const imagesAbove = placedPictures?.unplaced ?? userImages;
  // Files sit where their labels stand; a phone's, with none, above the words.
  const messageAttachments = messageWithPreviews.attachments;
  const filesAbove = useMemo(
    () =>
      placedPictures?.unplacedFiles ??
      unplacedMessageFiles(displayedUserMessage.visibleText, messageAttachments ?? []),
    [displayedUserMessage.visibleText, messageAttachments, placedPictures],
  );
  const shownFiles = useMemo(
    () =>
      (messageAttachments ?? []).filter(
        (attachment) =>
          filesAbove.includes(attachment) ||
          (placedPictures?.segments.some(
            (segment) => segment.kind === "file" && segment.file === attachment,
          ) ??
            false),
      ),
    [filesAbove, messageAttachments, placedPictures],
  );
  const fileUrls = useMessageFileUrls(ctx.activeThreadEnvironmentId, shownFiles);
  const expandImage = (image: ChatImageAttachment) => {
    const preview = buildExpandedImagePreview(userImages, image.id);
    if (preview) ctx.onImageExpand(preview);
  };
  const revertTurnCount = row.revertTurnCount;

  return (
    // The time and actions sit beside the bubble's foot rather than under it:
    // a hover-only strip in flow would add a blank line under every message.
    // The receipt stays: it is how the person knows the Mate read it.
    <div className="group flex flex-row-reverse items-end gap-2">
      {/* One bubble for every message: a message sent as a turn ended can
          become the next turn's opener, and it must not change its size. */}
      <div
        className="relative max-w-4/5 rounded-2xl bg-message px-3.5 py-2.5 text-prose text-message-foreground"
        data-message-aside={row.aside ? "true" : undefined}
      >
        <MessageAuthorHeading>You</MessageAuthorHeading>
        {imagesAbove.length > 0 && (
          <div className="mb-2 grid max-w-[420px] grid-cols-2 gap-2">
            {imagesAbove.map((image: ChatImageAttachment) => {
              const state = pictureStates.get(image.id);
              return (
                <div
                  key={image.id}
                  className="overflow-hidden rounded-lg border border-border/80 bg-background/70"
                >
                  {state?._tag === "Failure" ? (
                    <ImageUnavailable reason={state.reason} />
                  ) : image.previewUrl ? (
                    <button
                      type="button"
                      className="h-full w-full cursor-zoom-in"
                      aria-label={`Preview ${image.name}`}
                      onClick={() => expandImage(image)}
                    >
                      <AssetImage
                        loading="lazy"
                        decoding="async"
                        src={image.previewUrl}
                        alt={image.name}
                        className="block max-h-[220px] w-full object-contain"
                        style={{ aspectRatio: `${image.width ?? 16} / ${image.height ?? 9}` }}
                      />
                    </button>
                  ) : (
                    <div className="flex min-h-[72px] items-center justify-center px-2 py-3 text-center text-secondary-label text-2xs">
                      {image.name}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <MessageFilesAbove files={filesAbove} urls={fileUrls} />
        {placedPictures ? (
          <MessagePictureBody
            segments={placedPictures.segments}
            dimensions={pictureDimensions}
            states={pictureStates}
            onOpen={expandImage}
            fileUrls={fileUrls}
            renderText={(segment) => (
              <CollapsibleUserMessageBody
                text={segment.text}
                terminalContexts={[...(pictureContexts?.get(segment.after) ?? [])]}
                skills={ctx.skills}
                markdownCwd={ctx.markdownCwd}
              />
            )}
          />
        ) : (
          <CollapsibleUserMessageBody
            text={displayedUserMessage.visibleText}
            terminalContexts={terminalContexts}
            skills={ctx.skills}
            markdownCwd={ctx.markdownCwd}
          />
        )}
      </div>
      {row.receipt ? (
        <span className="flex shrink-0 pb-1.5">
          <MessageReceipt receipt={row.receipt} speaker={ctx.speaker} />
        </span>
      ) : null}
      <div className="flex shrink-0 items-center pb-1 text-xs tabular-nums opacity-0 transition-opacity duration-200 pointer-coarse:opacity-100 focus-within:opacity-100 group-hover:opacity-100">
        <div className="flex shrink-0 items-center gap-2">
          <Tooltip>
            <TooltipTrigger render={<p className="text-muted-foreground text-xs tabular-nums" />}>
              {formatDayAwareTimestamp(row.message.createdAt, ctx.timestampFormat)}
            </TooltipTrigger>
            <TooltipPopup>
              {formatChatTimestampTooltip(row.message.createdAt, ctx.timestampFormat)}
            </TooltipPopup>
          </Tooltip>
          <div className="flex items-center gap-0.5">
            {typeof revertTurnCount === "number" && (
              <RevertUserMessageButton turnCount={revertTurnCount} messageId={row.message.id} />
            )}
            {displayedUserMessage.copyText && (
              <MessageCopyButton text={displayedUserMessage.copyText} variant="ghost" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function RevertUserMessageButton({
  turnCount,
  messageId,
}: {
  turnCount: number;
  messageId: MessageId;
}) {
  const ctx = use(TimelineRowCtx);
  const activity = use(TimelineRowActivityCtx);

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="xs"
            variant="ghost"
            disabled={activity.isRevertingCheckpoint || activity.isWorking}
            onClick={() => ctx.onRevertToTurnCount(turnCount, messageId)}
            aria-label="Revert to this message"
          />
        }
      >
        <Undo2Icon className="size-3" />
      </TooltipTrigger>
      <TooltipPopup side="top">Revert to this message</TooltipPopup>
    </Tooltip>
  );
}

/**
 * Hover-revealed wall-clock time with a full-date tooltip — the same metadata
 * presentation as message rows, for work entries and turn folds. The parent
 * carries `group/timeline-row`; hover or focus on an existing control reveals
 * the time without adding a tab stop. Hidden timestamps stay outside the row
 * layout. Visibility changes immediately so leaving flow cannot overlap text
 * during a fade-out. Place it before any trailing disclosure control so
 * revealing the time does not move the chevron.
 */
function TimelineRowTimestamp({
  createdAt,
  timestampFormat,
  className,
}: {
  createdAt: string;
  timestampFormat: TimestampFormat;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={cn(
              "pointer-events-none absolute me-1 shrink-0 whitespace-nowrap rounded-md text-muted-foreground text-xs tabular-nums opacity-0 group-hover/timeline-row:pointer-events-auto group-hover/timeline-row:static group-hover/timeline-row:opacity-100 group-focus-within/timeline-row:pointer-events-auto group-focus-within/timeline-row:static group-focus-within/timeline-row:opacity-100",
              className,
            )}
          />
        }
      >
        {formatDayAwareTimestamp(createdAt, timestampFormat)}
      </TooltipTrigger>
      <TooltipPopup>{formatChatTimestampTooltip(createdAt, timestampFormat)}</TooltipPopup>
    </Tooltip>
  );
}

/** The Mate's answer to a settled turn, set for reading. */
function AssistantTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "message" }> }) {
  return (
    <>
      <FoldRoom fold={row.foldsFrom} />
      <MateProse message={row.message} showMeta={row.showAssistantMeta} />
    </>
  );
}

/**
 * The Mate talking to the person — its answer, or the words the person
 * answered: prose on the conversation's text edge, one hand for both, with
 * no bubble and no face (the person's words are the bubbles). Its copy and
 * its time stand on a line of their own under it, shown on hover — reserved,
 * so showing them moves nothing, and under the words, so they cover none
 * and no edge clips them (the owner, 2026-09-26: "placement of this utterly
 * sucks + its even cut of overflow").
 */
/** The Mate's words in its prose hand: the answer's type, links and chips. */
function MateProseWords({
  text,
  at,
  streaming,
}: {
  readonly text: string;
  /** When they were said: the moment a change chip reads its state at. */
  readonly at: string;
  readonly streaming: boolean;
}) {
  const ctx = use(TimelineRowCtx);
  return (
    <>
      <MessageAuthorHeading>{ctx.speaker.name}</MessageAuthorHeading>
      <ChangeChipMomentContext value={at}>
        <ChatMarkdown
          variant="answer"
          text={text}
          cwd={ctx.markdownCwd}
          threadRef={ctx.threadRef ?? undefined}
          isStreaming={streaming}
          lineBreaks={shouldPreserveAssistantLineBreaks(text)}
          skills={ctx.skills}
          headingLevelOffset={MESSAGE_HEADING_LEVEL}
          onOpenImage={ctx.onImageExpand}
          onRunShellCommand={ctx.onRunShellCommand}
        />
      </ChangeChipMomentContext>
    </>
  );
}

function MateProse({
  message,
  showMeta,
}: {
  readonly message: ChatMessage;
  readonly showMeta: boolean;
}) {
  const ctx = use(TimelineRowCtx);
  const messageText = message.text || (message.streaming ? "" : "(empty response)");
  const copy = resolveAssistantMessageCopyState({
    text: message.text ?? null,
    showCopyButton: showMeta,
    streaming: Boolean(message.streaming),
  });
  return (
    <div className="min-w-0">
      <MateProseWords
        at={message.createdAt}
        streaming={Boolean(message.streaming)}
        text={messageText}
      />
      {showMeta ? (
        <div
          className="-ms-1.5 mt-1 flex h-6 items-center gap-1 text-muted-foreground text-xs tabular-nums opacity-0 transition-opacity duration-200 pointer-coarse:opacity-100 focus-within:opacity-100 group-hover/assistant:opacity-100"
          data-mate-prose-actions
        >
          {copy.visible ? <MessageCopyButton text={copy.text ?? ""} variant="ghost" /> : null}
          <Tooltip>
            <TooltipTrigger render={<p className="text-muted-foreground text-xs tabular-nums" />}>
              {formatDayAwareTimestamp(message.updatedAt, ctx.timestampFormat)}
            </TooltipTrigger>
            <TooltipPopup>
              {formatChatTimestampTooltip(message.updatedAt, ctx.timestampFormat)}
            </TooltipPopup>
          </Tooltip>
        </div>
      ) : null}
    </div>
  );
}

function ProposedPlanTimelineRow({
  row,
}: {
  row: Extract<TimelineRow, { kind: "proposed-plan" }>;
}) {
  const ctx = use(TimelineRowCtx);

  return (
    <div className="min-w-0 px-1 py-0.5">
      <ProposedPlanCard
        planMarkdown={row.proposedPlan.planMarkdown}
        environmentId={ctx.activeThreadEnvironmentId}
        threadRef={ctx.threadRef ?? undefined}
        cwd={ctx.markdownCwd}
        workspaceRoot={ctx.workspaceRoot}
      />
    </div>
  );
}

/** One `ZeropsOperation` card, anchored at the transcript position the reducer gave it. */
const OperationTimelineRow = memo(function OperationTimelineRow({
  row,
}: {
  row: Extract<TimelineRow, { kind: "operation" }>;
}) {
  const ctx = use(TimelineRowCtx);
  const regions = useOperationCard(
    row.operation,
    ctx.activeThreadEnvironmentId,
    undefined,
    true,
    ctx.threadRef?.threadId ?? null,
  );
  // A request for a vault value is the person's to answer: its card is the ask.
  if (vaultAskOf(row.operation) !== null) {
    return (
      <div className="min-w-0 px-1 py-0.5">
        <VaultRequestCardContainer
          environmentId={ctx.activeThreadEnvironmentId}
          operation={row.operation}
        />
      </div>
    );
  }
  return (
    <div className="min-w-0 px-1 py-0.5">
      <ZeropsOperationCard operation={row.operation} threadRef={ctx.threadRef} {...regions} />
    </div>
  );
});

/** A value the Mate asked the person for, after its run: the card that takes it into the vault. */
const VaultRequestTimelineRow = memo(function VaultRequestTimelineRow({
  row,
}: {
  row: Extract<TimelineRow, { kind: "vault-request" }>;
}) {
  const ctx = use(TimelineRowCtx);
  return (
    <div className="min-w-0 px-1 py-0.5">
      <VaultRequestCardContainer
        environmentId={ctx.activeThreadEnvironmentId}
        operation={row.operation}
      />
    </div>
  );
});

// ---------------------------------------------------------------------------
// Self-ticking labels — update their own text nodes so elapsed-time display
// does not create a React commit every second while a response is streaming.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Extracted row sections — own their state / store subscriptions so changes
// re-render only the affected row, not the entire list.
// ---------------------------------------------------------------------------

/** Renders one or more already-derived work log rows. Overflow expansion is modeled as LegendList data. */
const WorkGroupSection = memo(function WorkGroupSection({
  groupedEntries,
  isExpandedToolGroupEntry,
}: {
  groupedEntries: Extract<MessagesTimelineRow, { kind: "work" }>["groupedEntries"];
  isExpandedToolGroupEntry: boolean;
}) {
  const { workspaceRoot } = use(TimelineRowCtx);
  const nonEmptyEntries = useMemo(
    () =>
      groupedEntries.filter((entry) => workEntryIsVisibleInGroup(entry, isExpandedToolGroupEntry)),
    [groupedEntries, isExpandedToolGroupEntry],
  );
  const onlyToolEntries = nonEmptyEntries.every((entry) => workLogEntryIsToolLike(entry));
  // Named for assistive technology only: a visible "Work Log" heading over
  // every run of entries was the system describing itself to the person.
  const groupLabel = onlyToolEntries
    ? nonEmptyEntries.length === 1
      ? "1 tool call"
      : `${nonEmptyEntries.length} tool calls`
    : "What the Mate did";
  const GroupContainer = isExpandedToolGroupEntry ? "div" : "section";

  if (nonEmptyEntries.length === 0) return null;

  return (
    <GroupContainer
      className={cn("-mx-1 px-1", isExpandedToolGroupEntry ? "py-0" : "space-y-0.5 py-0.5")}
      aria-label={isExpandedToolGroupEntry ? undefined : groupLabel}
    >
      <div className="space-y-px">
        {nonEmptyEntries.map((workEntry) => (
          <PlainWorkEntryRow
            key={workEntry.id}
            workEntry={workEntry}
            workspaceRoot={workspaceRoot}
            isExpandedToolGroupEntry={isExpandedToolGroupEntry}
          />
        ))}
      </div>
    </GroupContainer>
  );
});

// ---------------------------------------------------------------------------
// Leaf components
// ---------------------------------------------------------------------------

const UserMessageTerminalContextInlineLabel = memo(
  function UserMessageTerminalContextInlineLabel(props: { context: ParsedTerminalContextEntry }) {
    const tooltipText =
      props.context.body.length > 0
        ? `${props.context.header}\n${props.context.body}`
        : props.context.header;

    return (
      <TerminalContextInlineChip
        label={props.context.header}
        tooltipText={tooltipText}
        kind={props.context.kind}
      />
    );
  },
);

const CollapsibleUserMessageBody = memo(function CollapsibleUserMessageBody(props: {
  text: string;
  terminalContexts: ParsedTerminalContextEntry[];
  skills: ReadonlyArray<Pick<ServerProviderSkill, "name" | "displayName">>;
  markdownCwd: string | undefined;
  footer?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasVisibleBody = props.text.trim().length > 0 || props.terminalContexts.length > 0;
  // The person's words fold as the Mate's do in its run's chat: one rule for both.
  const canCollapse = hasVisibleBody && foldsLikeAMessage(props.text);
  const isCollapsed = canCollapse && !expanded;

  return (
    <div>
      {hasVisibleBody ? (
        <div
          className={cn("relative", isCollapsed && "max-h-44 overflow-hidden")}
          data-user-message-body="true"
          data-user-message-collapsed={isCollapsed ? "true" : "false"}
          data-user-message-collapsible={canCollapse ? "true" : "false"}
          data-user-message-fade={isCollapsed ? "true" : "false"}
          style={
            isCollapsed
              ? {
                  WebkitMaskImage: FOLD_FADE_MASK,
                  maskImage: FOLD_FADE_MASK,
                }
              : undefined
          }
        >
          <UserMessageBody
            text={props.text}
            terminalContexts={props.terminalContexts}
            skills={props.skills}
            markdownCwd={props.markdownCwd}
          />
        </div>
      ) : null}
      {canCollapse || props.footer ? (
        <div
          className={cn(
            "mt-1.5 flex items-center gap-2",
            canCollapse && props.footer ? "justify-between" : "justify-end",
          )}
          data-user-message-footer="true"
        >
          {canCollapse ? (
            <Button
              type="button"
              size="xs"
              variant="ghost-muted"
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
              className="-ml-1"
            >
              {expanded ? "Show less" : "Show full message"}
            </Button>
          ) : null}
          {props.footer ? (
            <div className="ml-auto flex items-center gap-2">{props.footer}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});

const UserMessageBody = memo(function UserMessageBody(props: {
  text: string;
  terminalContexts: ParsedTerminalContextEntry[];
  skills: ReadonlyArray<Pick<ServerProviderSkill, "name" | "displayName">>;
  markdownCwd: string | undefined;
}) {
  const ctx = use(TimelineRowCtx);
  const renderInlineMarkdownSegment = (text: string, key: string) => {
    const leadingWhitespace = /^\s+/.exec(text)?.[0] ?? "";
    const textWithoutLeadingWhitespace = text.slice(leadingWhitespace.length);
    const trailingWhitespace = /\s+$/.exec(textWithoutLeadingWhitespace)?.[0] ?? "";
    const content = textWithoutLeadingWhitespace.slice(
      0,
      textWithoutLeadingWhitespace.length - trailingWhitespace.length,
    );

    return (
      <Fragment key={key}>
        {leadingWhitespace ? <span aria-hidden="true">{leadingWhitespace}</span> : null}
        {content ? (
          <ChatMarkdown
            text={content}
            cwd={props.markdownCwd}
            threadRef={ctx.threadRef ?? undefined}
            skills={props.skills}
            className="text-message-foreground"
            variant="person"
            lineBreaks
            parseRawHtml={false}
            headingLevelOffset={MESSAGE_HEADING_LEVEL}
          />
        ) : null}
        {trailingWhitespace ? <span aria-hidden="true">{trailingWhitespace}</span> : null}
      </Fragment>
    );
  };

  const reviewCommentSegments = parseReviewCommentMessageSegments(props.text);
  if (reviewCommentSegments.some((segment) => segment.kind === "review-comment")) {
    return (
      <div className="space-y-3 text-message-foreground">
        {reviewCommentSegments.map((segment) =>
          segment.kind === "text" ? (
            segment.text.trim().length > 0 ? (
              <div key={segment.id} className="wrap-break-word">
                <ChatMarkdown
                  text={segment.text.trim()}
                  cwd={props.markdownCwd}
                  threadRef={ctx.threadRef ?? undefined}
                  skills={props.skills}
                  className="text-message-foreground"
                  variant="person"
                  lineBreaks
                  parseRawHtml={false}
                  headingLevelOffset={MESSAGE_HEADING_LEVEL}
                />
              </div>
            ) : null
          ) : (
            <UserMessageReviewCommentCard key={segment.comment.id} comment={segment.comment} />
          ),
        )}
      </div>
    );
  }

  if (props.terminalContexts.length > 0) {
    const hasEmbeddedInlineLabels = textContainsInlineTerminalContextLabels(
      props.text,
      props.terminalContexts,
    );
    const inlinePrefix = buildInlineTerminalContextText(props.terminalContexts);
    const inlineNodes: ReactNode[] = [];

    if (hasEmbeddedInlineLabels) {
      let cursor = 0;

      for (const context of props.terminalContexts) {
        const label = formatInlineTerminalContextLabel(context);
        const matchIndex = props.text.indexOf(label, cursor);
        if (matchIndex === -1) {
          inlineNodes.length = 0;
          break;
        }
        if (matchIndex > cursor) {
          inlineNodes.push(
            renderInlineMarkdownSegment(
              props.text.slice(cursor, matchIndex),
              `user-terminal-context-inline-before:${context.header}:${cursor}`,
            ),
          );
        }
        inlineNodes.push(
          <UserMessageTerminalContextInlineLabel
            key={`user-terminal-context-inline:${context.header}`}
            context={context}
          />,
        );
        cursor = matchIndex + label.length;
      }

      if (inlineNodes.length > 0) {
        if (cursor < props.text.length) {
          inlineNodes.push(
            renderInlineMarkdownSegment(
              props.text.slice(cursor),
              `user-message-terminal-context-inline-rest:${cursor}`,
            ),
          );
        }

        return (
          <div className="whitespace-pre-wrap wrap-break-word text-message-foreground text-sm leading-relaxed">
            {inlineNodes}
          </div>
        );
      }
    }

    for (const context of props.terminalContexts) {
      inlineNodes.push(
        <UserMessageTerminalContextInlineLabel
          key={`user-terminal-context-inline:${context.header}`}
          context={context}
        />,
      );
      inlineNodes.push(
        <span key={`user-terminal-context-inline-space:${context.header}`} aria-hidden="true">
          {" "}
        </span>,
      );
    }

    if (props.text.length > 0) {
      inlineNodes.push(
        <ChatMarkdown
          key="user-message-terminal-context-inline-text"
          text={props.text}
          cwd={props.markdownCwd}
          threadRef={ctx.threadRef ?? undefined}
          skills={props.skills}
          className="text-message-foreground"
          variant="person"
          lineBreaks
          parseRawHtml={false}
          headingLevelOffset={MESSAGE_HEADING_LEVEL}
        />,
      );
    } else if (inlinePrefix.length === 0) {
      return null;
    }

    return (
      <div className="whitespace-pre-wrap wrap-break-word text-message-foreground text-sm leading-relaxed">
        {inlineNodes}
      </div>
    );
  }

  if (props.text.length === 0) {
    return null;
  }

  return (
    <ChatMarkdown
      text={props.text}
      cwd={props.markdownCwd}
      threadRef={ctx.threadRef ?? undefined}
      skills={props.skills}
      className="text-message-foreground"
      variant="person"
      lineBreaks
      parseRawHtml={false}
      headingLevelOffset={MESSAGE_HEADING_LEVEL}
    />
  );
});

function UserMessageReviewCommentCard({ comment }: { comment: ReviewCommentContext }) {
  const ctx = use(TimelineRowCtx);
  const fenceLanguage = comment.fenceLanguage ?? "diff";

  return (
    <div className="space-y-2 rounded-lg border border-border/70 bg-background/70 p-3">
      <div className="space-y-1">
        <div className="text-message-foreground text-xs font-medium">
          {formatWorkspaceRelativePath(comment.filePath, ctx.workspaceRoot)}
        </div>
        <div className="text-secondary-label text-2xs">
          {comment.sectionTitle} · {comment.rangeLabel}
        </div>
      </div>
      {comment.text.length > 0 && (
        <div className="whitespace-pre-wrap wrap-break-word text-sm">
          <SkillInlineText text={comment.text} skills={ctx.skills} />
        </div>
      )}
      {fenceLanguage !== "diff" && comment.diff.trim().length > 0 && (
        <ChatMarkdown
          text={formatReviewCommentFence(fenceLanguage, comment.diff)}
          cwd={ctx.markdownCwd}
          threadRef={ctx.threadRef ?? undefined}
          skills={ctx.skills}
          className="text-message-foreground"
        />
      )}
      {fenceLanguage === "diff" && comment.diff.trim().length > 0 && (
        <ReviewCommentDiff comment={comment} theme={ctx.resolvedTheme} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Structural sharing — reuse old row references when data hasn't changed
// so LegendList (and React) can skip re-rendering unchanged items.
// ---------------------------------------------------------------------------

/** Returns a structurally-shared copy of `rows`: for each row whose content
 *  hasn't changed since last call, the previous object reference is reused. */
function useStableRows(rows: MessagesTimelineRow[]): MessagesTimelineRow[] {
  const prevState = useRef<StableMessagesTimelineRowsState>({
    byId: new Map<string, MessagesTimelineRow>(),
    result: [],
  });

  return useMemo(() => {
    const nextState = computeStableMessagesTimelineRows(rows, prevState.current);
    // A run's panel leaves when the rows stop carrying it, whatever order the
    // list then mounts and unmounts their rows in.
    markPanelsGone(prevState.current.result, nextState.result);
    prevState.current = nextState;
    return nextState.result;
  }, [rows]);
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

type WorkEntryIconName =
  | "bot"
  | "brain"
  | "check"
  | "circle-alert"
  | "eye"
  | "globe"
  | "hammer"
  | "message-circle"
  | "search"
  | "square-pen"
  | "terminal"
  | "wrench"
  | "x"
  | "zap";

function WorkEntryIconSvg({ name, className }: { name: WorkEntryIconName; className: string }) {
  switch (name) {
    case "bot":
      return <BotIcon className={className} aria-hidden />;
    case "brain":
      return <BrainIcon className={className} aria-hidden />;
    case "check":
      return <CheckIcon className={className} aria-hidden />;
    case "circle-alert":
      return <CircleAlertIcon className={className} aria-hidden />;
    case "eye":
      return <EyeIcon className={className} aria-hidden />;
    case "globe":
      return <GlobeIcon className={className} aria-hidden />;
    case "hammer":
      return <HammerIcon className={className} aria-hidden />;
    case "message-circle":
      return <MessageCircleIcon className={className} aria-hidden />;
    case "search":
      return <SearchIcon className={className} aria-hidden />;
    case "square-pen":
      return <SquarePenIcon className={className} aria-hidden />;
    case "terminal":
      return <TerminalIcon className={className} aria-hidden />;
    case "wrench":
      return <WrenchIcon className={className} aria-hidden />;
    case "x":
      return <XIcon className={className} aria-hidden />;
    case "zap":
      return <ZapIcon className={className} aria-hidden />;
  }
}

function workToneIcon(tone: TimelineWorkEntry["tone"]): {
  iconName: WorkEntryIconName;
  className: string;
} {
  if (tone === "error") {
    return {
      iconName: "circle-alert",
      className: "text-foreground",
    };
  }
  if (tone === "thinking") {
    return {
      iconName: "bot",
      className: "text-icon-muted",
    };
  }
  if (tone === "info") {
    return {
      iconName: "check",
      className: "text-icon-muted",
    };
  }
  return {
    iconName: "zap",
    className: "text-foreground",
  };
}

function workEntryPreview(
  workEntry: Pick<TimelineWorkEntry, "detail" | "command" | "changedFiles" | "itemType">,
  workspaceRoot: string | undefined,
) {
  if (workEntry.command) return workEntry.command;
  // A tool call's result is not its name. `detail` carries the raw payload an
  // MCP tool answered with, which belongs in the body the row opens — as the
  // label it is a truncated line of machine text, and the body then dedupes
  // against it and leaves the row with nothing to open.
  if (workEntry.detail && workEntry.itemType !== "mcp_tool_call") return workEntry.detail;
  if ((workEntry.changedFiles?.length ?? 0) === 0) return null;
  const [firstPath] = workEntry.changedFiles ?? [];
  if (!firstPath) return null;
  const displayPath = formatWorkspaceRelativePath(firstPath, workspaceRoot);
  return workEntry.changedFiles!.length === 1
    ? displayPath
    : `${displayPath} +${workEntry.changedFiles!.length - 1} more`;
}

function workEntryRawCommand(
  workEntry: Pick<TimelineWorkEntry, "command" | "rawCommand">,
): string | null {
  const rawCommand = workEntry.rawCommand?.trim();
  if (!rawCommand || !workEntry.command) {
    return null;
  }
  return rawCommand === workEntry.command.trim() ? null : rawCommand;
}

/**
 * The expanded body never repeats the row's visible label. A failed row keeps
 * its label in the body so the full, untruncated error stays reachable.
 */
function buildToolCallExpandedBody(
  workEntry: TimelineWorkEntry,
  workspaceRoot: string | undefined,
  visibleLabel: string,
  failed: boolean,
): string | null {
  const blocks: string[] = [];
  const seen = new Set<string>(failed ? [] : [visibleLabel.trim()]);
  const addBlock = (value: string | null | undefined) => {
    const text = value?.trim();
    if (!text || seen.has(text)) return;
    seen.add(text);
    blocks.push(text);
  };
  if (workEntry.itemType === "mcp_tool_call" && workEntry.toolData !== undefined) {
    addBlock(`MCP call\n${JSON.stringify(workEntry.toolData, null, 2)}`);
  }
  const raw = workEntryRawCommand(workEntry);
  addBlock(raw?.trim() ? raw : workEntry.command);
  addBlock(workEntry.detail);
  const changedFiles = workEntry.changedFiles ?? [];
  if (changedFiles.length > 0) {
    addBlock(
      changedFiles
        .map((filePath) => formatWorkspaceRelativePath(filePath, workspaceRoot))
        .join("\n"),
    );
  }
  return blocks.length > 0 ? blocks.join("\n\n") : null;
}

const toolCallExpandedBodyClassName =
  "max-h-64 cursor-text overflow-auto whitespace-pre-wrap break-words font-mono text-secondary-label text-(length:--font-size-code,var(--text-2xs)) leading-relaxed select-text";

const TOOL_ACTION_ICON: Record<
  Exclude<ReturnType<typeof toolGroupAction>, "other">,
  WorkEntryIconName
> = {
  read: "eye",
  edit: "square-pen",
  command: "terminal",
  search: "globe",
  "code-search": "search",
};

function workEntryIconName(workEntry: TimelineWorkEntry): WorkEntryIconName {
  if (
    workEntry.sourceActivityKind === "user-input.requested" ||
    workEntry.sourceActivityKind === "user-input.resolved"
  ) {
    return "message-circle";
  }
  const action = toolGroupAction(workEntry);
  if (action !== "other") return TOOL_ACTION_ICON[action];

  switch (workEntry.itemType) {
    case "mcp_tool_call":
      return "wrench";
    case "dynamic_tool_call":
      return "hammer";
    case "collab_agent_tool_call":
      return "bot";
  }

  // Subagent lifecycle rows (grouped by taskId) get agent identity chrome.
  if (workEntry.taskId) {
    return "bot";
  }

  return workToneIcon(workEntry.tone).iconName;
}

function capitalizePhrase(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return value;
  }
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
}

function toolWorkEntryHeading(workEntry: TimelineWorkEntry): string {
  if (!workEntry.toolTitle) {
    return capitalizePhrase(normalizeCompactToolLabel(workEntry.label));
  }
  return capitalizePhrase(normalizeCompactToolLabel(workEntry.toolTitle));
}

const stopRowToggle = (e: { stopPropagation: () => void }) => e.stopPropagation();

/**
 * Click handler for expanded row labels, which turn text selection back on.
 * Only a click that ends a real selection is withheld from the row toggle, so
 * an ordinary click on the label still bubbles and collapses the row it opened.
 */
const stopRowToggleWhileSelectingText = (e: MouseEvent<HTMLElement>) => {
  const selection = e.currentTarget.ownerDocument.getSelection();
  if (selection && !selection.isCollapsed) {
    e.stopPropagation();
  }
};

const PlainWorkEntryRow = memo(function PlainWorkEntryRow(props: {
  workEntry: TimelineWorkEntry;
  workspaceRoot: string | undefined;
  isExpandedToolGroupEntry: boolean;
}) {
  const { workEntry, workspaceRoot, isExpandedToolGroupEntry } = props;
  const { timestampFormat } = use(TimelineRowCtx);
  const [expanded, setExpanded] = useState(false);
  const iconConfig = workToneIcon(workEntry.tone);
  const showWarningIndicator = workEntry.sourceActivityKind === "runtime.warning";
  const showFailedIndicator = workEntryDisplayIndicatesToolFailure(workEntry);
  const entryIconName =
    showWarningIndicator || showFailedIndicator ? "x" : workEntryIconName(workEntry);
  const previewText = workEntryPreview(workEntry, workspaceRoot) ?? toolWorkEntryHeading(workEntry);
  // An expanded command row is labelled "Command" and shows the command in its
  // body, so the body dedupes against that label rather than the preview.
  const expandedLabel = workEntry.command?.trim() ? "Command" : previewText;
  const displayText = expanded ? expandedLabel : previewText;
  const expandedBody = buildToolCallExpandedBody(
    workEntry,
    workspaceRoot,
    expandedLabel,
    showFailedIndicator,
  );
  // A command that is the visible label still expands: the expanded row wraps
  // the label in full instead of repeating it in the body.
  const canExpand =
    expandedBody !== null ||
    Boolean(workEntryRawCommand(workEntry)?.trim() || workEntry.command?.trim());
  const showDestructiveRowStyle =
    showFailedIndicator &&
    (workEntrySignalsSevereFailure(workEntry) || !workLogEntryIsToolLike(workEntry));
  // Ordinary tool failures stay muted; only runtime errors and warnings get
  // color. The red treatment is reserved for severe failures.
  const iconWrapperClass = cn(
    "flex w-5 shrink-0 items-center",
    showWarningIndicator
      ? "text-warning"
      : showDestructiveRowStyle
        ? "text-destructive"
        : workEntry.tone === "tool" || showFailedIndicator
          ? "text-icon-muted"
          : iconConfig.className,
  );
  const headingClass = showWarningIndicator
    ? "font-medium text-warning"
    : showDestructiveRowStyle
      ? "font-medium text-destructive"
      : workLogEntryIsToolLike(workEntry)
        ? "text-muted-foreground"
        : "text-foreground/80";
  const showEntryIcon = !isExpandedToolGroupEntry || showWarningIndicator || showFailedIndicator;
  const accessibleDisplayText = showFailedIndicator
    ? `${previewText}, tool call failed`
    : previewText;
  const rowToggleProps = canExpand
    ? {
        role: "button" as const,
        tabIndex: 0 as const,
        "aria-label": accessibleDisplayText,
        "aria-expanded": expanded,
        onClick: () => setExpanded((v) => !v),
        onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded((v) => !v);
          }
        },
      }
    : {};

  return (
    <div
      className={cn(
        "group/timeline-row relative flex flex-col rounded-md transition-colors",
        isExpandedToolGroupEntry ? "py-0" : "py-px",
        expanded && "mb-1",
        canExpand &&
          "cursor-pointer hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70",
      )}
      {...rowToggleProps}
    >
      {/* Its icon in the page's 20 px mark column, its words on the edge the
          answer's list items and the other event lines start on. */}
      <div className="flex select-none items-center transition-[opacity,translate] duration-200">
        <span
          className={cn(iconWrapperClass, !showEntryIcon && "invisible")}
          role={showFailedIndicator ? "img" : undefined}
          aria-label={showFailedIndicator ? "Tool call failed" : undefined}
          aria-hidden={!showEntryIcon}
        >
          <WorkEntryIconSvg
            name={entryIconName}
            className="block size-3.5 shrink-0 stroke-[1.8] opacity-70"
          />
        </span>
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <div className="min-w-0 flex-1 overflow-hidden">
            <p className="flex min-w-0 w-full items-baseline gap-1.5 text-line">
              <span
                className={cn(
                  "min-w-0 flex-1",
                  expanded ? "whitespace-pre-wrap break-words select-text" : "truncate",
                  headingClass,
                )}
                onClick={expanded ? stopRowToggleWhileSelectingText : undefined}
              >
                {displayText}
              </span>
            </p>
          </div>
          <TimelineRowTimestamp createdAt={workEntry.createdAt} timestampFormat={timestampFormat} />
          <span
            className={cn(
              "flex size-4 shrink-0 items-center justify-center",
              !canExpand && "invisible",
            )}
            aria-hidden
          >
            <ChevronRightIcon
              className={cn(
                "size-3 shrink-0 text-icon-muted opacity-70 transition-transform duration-200",
                expanded && "rotate-90",
              )}
            />
          </span>
        </div>
      </div>
      {expanded && canExpand && expandedBody ? (
        <div
          className="mt-1 ms-5 cursor-default border-s border-border/45 ps-3 pt-0.5"
          onClick={stopRowToggle}
          onPointerDown={stopRowToggle}
        >
          <pre className={toolCallExpandedBodyClassName}>{expandedBody}</pre>
        </div>
      ) : null}
      {workEntry.questionAnswer ? (
        <QuestionAnswerHistory answer={workEntry.questionAnswer} />
      ) : null}
    </div>
  );
});

/** A submitted question answer: each answered question, its text answer, and the files attached. */
function QuestionAnswerHistory({
  answer,
}: {
  answer: import("@t3tools/contracts").UserInputAttachmentAnswerPayload;
}) {
  const { activeThreadEnvironmentId } = use(TimelineRowCtx);
  const attachments = useMemo(() => Object.values(answer.attachmentsByQuestionId).flat(), [answer]);
  const resources = useMemo(
    () =>
      attachments.map((attachment) => ({
        _tag: "attachment" as const,
        attachmentId: attachment.id,
        mimeType: attachment.mimeType,
        ...(attachment.type === "image" && "asset" in attachment && attachment.asset
          ? { occurrenceId: attachment.asset.id }
          : {}),
      })),
    [attachments],
  );
  const states = useAssetUrlStates(activeThreadEnvironmentId, resources);
  return (
    <div className="ms-7 mt-2 space-y-2" onClick={stopRowToggle}>
      {[
        ...new Set([
          ...Object.keys(answer.answers),
          ...Object.keys(answer.attachmentsByQuestionId),
        ]),
      ].map((questionId) => (
        <div key={questionId} className="space-y-1">
          {answer.questionTextById?.[questionId] ? (
            <p className="text-sm text-muted-foreground">{answer.questionTextById[questionId]}</p>
          ) : null}
          <p className="whitespace-pre-wrap text-sm">
            {[answer.answers[questionId]]
              .flat()
              .filter((value): value is string => typeof value === "string")
              .join(", ")}
          </p>
          <div className="flex flex-wrap gap-2">
            {(answer.attachmentsByQuestionId[questionId] ?? []).map((attachment) => {
              const state = states[attachments.indexOf(attachment)];
              const url = state?._tag === "Success" ? state.url : undefined;
              return (
                <AssetDownloadLink
                  key={attachment.id}
                  source={url ?? ""}
                  download={attachment.type === "file" ? attachment.name : undefined}
                  className="text-sm underline"
                  target={attachment.type === "image" ? "_blank" : undefined}
                  rel="noopener noreferrer"
                >
                  {attachment.type === "image" && state?._tag === "Failure" ? (
                    <ImageUnavailable reason={state.reason} />
                  ) : attachment.type === "image" && url ? (
                    <AssetImage
                      loading="lazy"
                      decoding="async"
                      src={url}
                      alt={attachment.name}
                      className="h-20 w-32 rounded object-contain"
                    />
                  ) : (
                    attachment.name
                  )}
                </AssetDownloadLink>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Nothing said yet. In a Mate's conversation that is the Mate's own opening —
 * its mark, its question, and the sign-in when no agent could act
 * (`ZeropsMateEmptyState`); elsewhere upstream's one line.
 */
function TimelineEmptyState({
  environmentId,
  threadKey,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadKey: string;
}) {
  const whoLivesHere = useZeropsMate(environmentId);
  // Neither opening while that is not known: the region stays, empty.
  if (whoLivesHere.kind === "unknown") return <div className="h-full" />;
  if (whoLivesHere.kind === "nobody") {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-placeholder text-sm">Send a message to start the conversation.</p>
      </div>
    );
  }
  return (
    <ZeropsMateEmptyState
      environmentId={environmentId}
      mate={whoLivesHere.mate}
      threadRef={parseScopedThreadKey(threadKey)}
    />
  );
}
