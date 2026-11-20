import { mateDiagnostics } from "@t3tools/client-runtime/zerops/diagnostics";
import { NO_MATE_LIMIT, type MateLimit } from "@t3tools/client-runtime/data";
import { deriveTimelineMinimapItems } from "./timelineMinimapItems";
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
const EMPTY_QUEUED_MESSAGES: ReadonlyArray<QueuedComposerMessage> = [];
const EMPTY_NOTICES: ReadonlyArray<ConversationNotice> = [];
const NOOP_QUEUED_MESSAGE_ACTION = (_id: string) => {};
const EMPTY_ORIGIN_ASKS: ReadonlyArray<OriginAskPlace> = [];
const EMPTY_MIRROR_ASKS: ReadonlyArray<MirrorAskPlace> = [];
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
  memo,
  use,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  createEndFollow,
  ownListScrolls,
  scrollOwn,
  takeOwnScroll,
  type OwnScroll,
  type EndFollow,
} from "./timelineEndFollow";
import { landingHolds } from "./answerLanding.logic";
import { headStoodJustNow, wordsJustStood, type WordsStood } from "./wordsLanding";
import { AsPainted } from "./AsPainted";
import { foldTimelineWork } from "./timelineFold";
import { revealBy } from "./timelineReveal.logic";
import { TimelineLoadEarlierHeader } from "./TimelineLoadEarlierHeader";
import { TimelineMinimap } from "./TimelineMinimap";
import {
  ProposedPlanTimelineRow,
  OperationTimelineRow,
  VaultRequestTimelineRow,
  OriginRequestTimelineRow,
  MirrorRequestTimelineRow,
  ProposalTimelineRow,
} from "./TimelineAskRows";
import {
  TaskCardTimelineRow,
  ErrorTimelineRow,
  WorkLineTimelineRow,
  AfterWorkTimelineRow,
  RecordTimelineRow,
  BackgroundTimelineRow,
  EventTimelineRow,
  NoticeTimelineRow,
  CrewCardTimelineRow,
  PageTimelineRow,
  SeamTimelineRow,
} from "./TimelineLineRows";
import {
  markPanelsGone,
  takePanelStand,
  panelLeftRecently,
  usePanelStand,
} from "./timelinePanelStand";
import {
  QueuedMessageTimelineRow,
  UserTimelineRow,
  AssistantTimelineRow,
} from "./TimelineMessageRows";
import { TimelineEmptyState } from "./TimelineEmptyState";
import { TimelineDraftRows } from "./TimelineDraftRows";
import {
  getItemType,
  resolveTimelineRowTop,
  resolveTimelineRowHeight,
} from "./timelineRowGeometry";
import { WorkGroupSection } from "./TimelineWorkEntries";
import { keyExtractor } from "./timelineRowKey";
import { usePace } from "./usePace";
import { FOLLOW_TAU_MS, approach } from "./runMotion.logic";
import { LegendList, type LegendListProps, type LegendListRef } from "@legendapp/list/react";
import { deriveTimelineEntries } from "../../session-logic";
import { type QueuedComposerMessage } from "../../queuedMessageStore";
import { ExpandedImagePreview } from "./ExpandedImagePreview";
import {
  describeTimelineAnchor,
  judgeTimelinePlacing,
  TIMELINE_ROW_READ_DEADLINE_MS,
  type RememberedTimelinePosition,
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
  wheelHandedToList,
  timelineScrollKeyInput,
  type WheelGestureLatch,
} from "./timelineScrollTarget";
import {
  computeStableMessagesTimelineRows,
  createMessagesTimelineRowsCache,
  conversationSpeaker,
  deriveMessagesTimelineRows,
  livePauseId,
  livePauseStageId,
  earlierTurnsAnchor,
  helperFinishesOf,
  isRestartRow,
  historicalInsertions,
  resolveTimelineIsAtEnd,
  resolveTimelineMinimapHasPersistentGutter,
  resolveTimelineMinimapCurrentIndex,
  resolveTimelineMinimapHitStripWidth,
  carriedRowGrowth,
  endArrivals,
  type StableMessagesTimelineRowsState,
  type CardSlice,
  type MessagesTimelineRow,
  type RowGap,
  type TimelineLatestTurn,
  type MateAway,
} from "./MessagesTimeline.logic";
import type { ThreadEndNotice } from "./threadErrorNotice.logic";
import { TooltipScrollDismissArea } from "../ui/tooltip";
import { cn } from "~/lib/utils";
import { useUiStateStore } from "~/uiStateStore";
import { useZeropsMate } from "~/zerops/useZeropsMates";
import { mateMentionMatcher, useMentionableMates } from "~/zerops/mateMentions";
import type { ZeropsMateIdentity } from "~/zerops/mateIdentities";
import { isMateStandUpAsk, mateStandUpStopped } from "~/zerops/mateStandUp";
import { useMateStandUpAskLine } from "~/zerops/useMateStandUp";
import { useEngineLiveStructure } from "./useEngineLiveMessage";
import { useEngineCardSnapshots, useEngineRunCards } from "./useEngineCardPaging";
import { type TimestampFormat } from "@t3tools/contracts/settings";

import { LAST_WORDS_GRACE_MS, latestFinishedWordsAt } from "./conversation.logic";
import { TurnReport } from "./TurnReport";
import { ConversationWorking, dockDraws } from "./ConversationWorking";
import { useEndingsHeld } from "./useEndingsHeld";
import { forgetRunFolds } from "./runCard.logic";
import { easeRooms, type Rooms } from "./runRoom";
import type { LiveJobs } from "~/zerops/runSteps/liveJobs";
import { KeptTimelineContext } from "./keptTimelineContext";
import { ConversationOpeningStage, ConversationOpeningWaits } from "./ConversationOpeningStage";
import { useLoadFill } from "~/lib/loadFills";

/**
 * Two frames of the 50 ms the conversation's fade once started with, now spent holding for the
 * menu's fill; the rest pays for the pass that takes the hold's end to the stage.
 */
const PAGE_HOLDS_FOR_MENU_MS = 32;
import { useZeropsThreadActivity } from "../../zerops/useZeropsAgentActivity";
import type { CarriedRow } from "./stepHeight";
import {
  TimelineNoticesCtx,
  TimelineRowActivityCtx,
  TimelineRowCtx,
  TimelineWorkingCtx,
  type TimelineRowActivityState,
  type RowRooms,
  type TimelineRowSharedState,
} from "./timelineContext";
import { makeTimelineRowReads, TimelineRowReadsCtx } from "./timelineRowReads";
import type { DockModel } from "./conversationDock.logic";
import {
  NoticeAnnouncer,
  type ConversationNotice,
  PauseBlock,
  StandUpAskLine,
  type ServerUsagePause,
} from "./ConversationRows";
import { CrewSeamActivity, CrewTimelineContext } from "../zerops/crew/CrewTaskCard";
import { MateTaskMessageRow } from "../zerops/MateTaskCard";
import { MateAnswerWait, MateMessageRow } from "../zerops/MateMessageRow";
import { CrewmateEmptyState } from "../zerops/crew/CrewmateEmptyState";
import { NewestReleaseAskContext } from "../zerops/proposal/ProposalCardContainer";
import { useProposalDecisionsRead } from "../../zerops/proposalRecord";
import { type MirrorAskPlace } from "../zerops/mirror/mirrorAsk.logic";
import { type OriginAskPlace } from "../zerops/origin/originAsk.logic";
import { useAskReveal } from "../ask/askReveal";

/** What hands the page back to the person while earlier turns are being placed. */
const GESTURES = ["wheel", "touchmove", "keydown", "pointerdown"] as const;

/** The rows above keep their place as rows arrive and change size under them. */
const MAINTAIN_VISIBLE_CONTENT_POSITION = { data: true, size: true } as const;

const TIMELINE_LIST_HEADER = <div className="h-3 sm:h-4" />;
const TIMELINE_LIST_FADE_HEADER = <div className="h-10 sm:h-12" />;

const TIMELINE_LIST_FOOTER = <div className="h-3 sm:h-4" />;
/** The keys that scroll a list: pressed, a reveal in flight gives way. */
const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);
function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
/** How far a held head goes up for the view to stand at the conversation's end, `room` aside. */
function headUnderEnd(
  landing: { readonly element: HTMLElement; readonly at: number },
  scroller: HTMLElement,
  room: number,
): number {
  const end = scroller.scrollHeight - room - scroller.clientHeight;
  return landing.at - (landing.element.getBoundingClientRect().top - (end - scroller.scrollTop));
}
/** How long after a person's click what they opened is brought into view, while it eases open. */
const REVEAL_FOR_MS = 700;
/**
 * The room under the conversation's end for what the agent asks (`askRoomEnd`), as the list has
 * it. It opens at once and a view at the end glides down into it. Once answered it stays while the view stands
 * in it, the view easing back up to the end on the follow curve, then goes: dropped at once, the
 * browser would cut the view back by all of it in one frame.
 */
function useAskRoom(wanted: number, listRef: React.RefObject<LegendListRef | null>): number {
  const [held, setHeld] = useState(0);
  const [previous, setPrevious] = useState(wanted);
  if (wanted !== previous) {
    setPrevious(wanted);
    if (wanted < previous) setHeld(Math.max(held, previous));
  }
  useLayoutEffect(() => {
    if (held <= wanted) return;
    let frame = 0;
    let last = 0;
    let at: number | null = null;
    const step = (now: number) => {
      const element = listRef.current?.getScrollableNode();
      // Where the end stands once the room is gone.
      const end = element
        ? Math.max(0, element.scrollHeight - element.clientHeight - (held - wanted))
        : 0;
      // Within a pixel: the browser rounds the scroll it is given, and a view held at 118 for
      // an end at 117.5 never let the room go — the view rested 319 px short of its end over an
      // empty foot for good (the owner, 0.15.44).
      if (!element || element.scrollTop <= end + 1 || reducedMotion()) {
        setHeld(0);
        return;
      }
      // Moved since by something else: it eases on from there.
      if (at === null || Math.abs(element.scrollTop - at) > 2) at = element.scrollTop;
      at = approach(at, end, last === 0 ? 1000 / 60 : now - last, FOLLOW_TAU_MS);
      last = now;
      scrollOwn(element, at);
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [held, listRef, wanted]);
  return Math.max(wanted, held);
}
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
  /** A failure no run shows, as the conversation's last row (`threadErrorNotice`). */
  endNotice?: ThreadEndNotice | null;
  /** Takes that row away, at its quiet ×. */
  onDismissEndNotice?: () => void;
  /** The background jobs the server holds live, as watched (`useLiveJobs`). */
  liveJobs?: LiveJobs | null;
  isWorking: boolean;
  workingStepLabel?: string | null;
  isCompacting?: boolean;
  /** The origins the engine asked of the person, each by its run card (`originAskPlaces`). */
  originAsks?: ReadonlyArray<OriginAskPlace>;
  /** The repositories the engine asked the person to connect to GitHub (`mirrorAskPlaces`). */
  mirrorAsks?: ReadonlyArray<MirrorAskPlace>;
  /** A person's Stop is in force (`conversationStop`). */
  isStopping?: boolean;
  activeTurnStartedAt: string | null;
  listRef: React.RefObject<LegendListRef | null>;
  timelineEntries: ReturnType<typeof deriveTimelineEntries>;
  latestTurn: TimelineLatestTurn | null;
  runningTurnId: TurnId | null;
  routeThreadKey: string;
  /**
   * A draft's sent message, and the conversation it becomes, stay visible while the list places.
   */
  keepsDraftMessage?: boolean;
  /** The thread's provider driver: how its live field reads a batch (`batchesByTiming`). */
  provider?: string | null;
  onRunShellCommand?: (command: string) => void;
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
   * What the agent asks over the composer covers of the conversation beyond the inset: room under
   * its end the person scrolls into, never followed into, so the ask opening moves nothing.
   */
  askRoomEnd?: number;
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
  /**
   * Whether HQ has said what the conversation shows from its project's flow — a change landing, a
   * release ending (`useZeropsFlowRead`). Until it has, the list is placed out of sight as while a
   * row still reads what it shows (`judgeTimelinePlacing`, at most the opening's beat), so those
   * rows come with the conversation's first paint; one that comes later enters (`opensRoom`).
   */
  flowRead?: boolean;
  /** Non-null when older turns exist beyond the loaded window. */
  loadEarlier?: { readonly loading: boolean; readonly onLoadEarlier: () => void } | null;
  /** Messages sent during the running turn. They render as ghost bubbles after the live rows. */
  queuedMessages?: ReadonlyArray<QueuedComposerMessage>;
  /** What happened that still holds: the conversation's last rows while it does. */
  notices?: ReadonlyArray<ConversationNotice>;
  /** The server's pause on this thread, when a usage limit holds it now. */
  usagePause?: ServerUsagePause | null;
  limit?: MateLimit;
  /** The Mate is out of reach: a live card holds and says so (`MateAway`). */
  away?: MateAway | null;
  interruption?: import("@t3tools/contracts").MateInterruption | null;
  onRestartContinue?:
    | ((interruption: import("@t3tools/contracts").MateInterruption) => void)
    | null;
  onUsageContinue?: (() => void) | null;
  usageContinueTries?: boolean;
  onWithdrawHeldMessage?: ((runId: string) => void) | null;
  /** Who the person's messages are headed with (`TimelineRowSharedState.asker`). */
  asker?: string | undefined;
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
  originAsks = EMPTY_ORIGIN_ASKS,
  mirrorAsks = EMPTY_MIRROR_ASKS,
  isStopping = false,
  activeTurnStartedAt,
  agentPanelModel,
  onOpenAgents = NOOP_OPEN_AGENTS,
  working: workingNow = null,
  afterTurnWork = null,
  endNotice = null,
  onDismissEndNotice,
  liveJobs = null,
  listRef,
  timelineEntries,
  latestTurn,
  runningTurnId,
  routeThreadKey,
  keepsDraftMessage = false,
  provider = null,
  onRunShellCommand,
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
  askRoomEnd = 0,
  liveFollowEnabled,
  onIsAtEndChange,
  onPersonInput,
  onManualNavigation,
  cancelPositionRestoreRef,
  hideEmptyPlaceholder = false,
  loading = false,
  syncing = false,
  topFadeEnabled = false,
  flowRead = true,
  loadEarlier = null,
  queuedMessages = EMPTY_QUEUED_MESSAGES,
  notices = EMPTY_NOTICES,
  usagePause = null,
  limit = NO_MATE_LIMIT,
  away = null,
  interruption = null,
  onRestartContinue = null,
  onUsageContinue = null,
  usageContinueTries = false,
  onWithdrawHeldMessage = null,
  asker,
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
  // The ask's room as the list has it: it opens at once and stays, once answered, until the
  // conversation has come back out of it (`useAskRoom`).
  // Room under the end while a landed answer is held where its words were read (`onAnswerLands`):
  // the card folding above it and its row settling are taken up by the scroll, never by the list
  // clamping at its end — with nothing under the answer, the end was a few pixels short of where
  // it was read, and everything that moved it then showed.
  const [landingRoom, setLandingRoom] = useState(0);
  const askRoom = useAskRoom(askRoomEnd + landingRoom, listRef);
  // The room the end follower stays out of: an answered ask's, which the view eases out of, and an
  // answer's landing room. An open ask's room is the end: the conversation glides up clear of it.
  const followRoomRef = useRef(0);
  // The room under the end as drawn, all of it: what a landing under a held head reads the end by.
  const askRoomRef = useRef(askRoom);
  useLayoutEffect(() => {
    followRoomRef.current = Math.max(0, askRoom - askRoomEnd);
    askRoomRef.current = askRoom;
  }, [askRoom, askRoomEnd]);
  const noticeResizeRef = useRef<{
    position: RememberedTimelinePosition | undefined;
    scrollOffset: number;
  } | null>(null);
  const [noticeReadingPosition, setNoticeReadingPosition] = useState<RememberedTimelinePosition>();
  const remeasurePositionRef = useRef<(() => void) | null>(null);

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
  const timelineThread = useMemo(() => parseScopedThreadKey(routeThreadKey), [routeThreadKey]);
  const cardPaging = useEngineCardSnapshots(timelineThread);
  const liveLines = useEngineLiveStructure(timelineThread, timelineEntries);
  const runCards = useEngineRunCards(timelineThread);
  // By id, so a notice whose words or action change redraws its row alone.
  const noticeKey = notices.map((notice) => notice.id).join("\n");
  const noticeIds = useMemo(() => (noticeKey === "" ? [] : noticeKey.split("\n")), [noticeKey]);
  const noticesById = useMemo(
    () => new Map(notices.map((notice) => [notice.id, notice] as const)),
    [notices],
  );
  // A crewmate's conversation (`CrewTimelineContext`, given for a crew thread
  // only) is empty while it holds nothing but seams.
  const crew = use(CrewTimelineContext);
  const inCrewmate = crew !== null;
  const rawRows = useMemo(
    () =>
      deriveMessagesTimelineRows({
        cache: rowsCache,
        crewmate: inCrewmate,
        ...(runCards === null ? {} : { runCards }),
        limit,
        away: away ?? null,
        nowMs,
        newSince,
        timelineEntries,
        latestTurn,
        runningTurnId,
        isWorking,
        activeTurnStartedAt,
        queuedMessages,
        notices: noticeIds,
        afterTurnWork,
        endNotice,
        liveJobs,
        helperFinishes,
        alongside,
        provider,
        cardPaging,
        liveLines,
        isCompacting,
        originAsks,
        mirrorAsks,
      }),
    [
      inCrewmate,
      cardPaging,
      liveLines,
      originAsks,
      mirrorAsks,
      isCompacting,
      runCards,
      nowMs,
      newSince,
      timelineEntries,
      latestTurn,
      runningTurnId,
      isWorking,
      activeTurnStartedAt,
      queuedMessages,
      noticeIds,
      afterTurnWork,
      endNotice,
      liveJobs,
      helperFinishes,
      alongside,
      provider,
      rowsCache,
      limit,
      away,
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
  // What a settle brings is paced once the conversation worked in sight: one drawn at rest
  // catches up with its history at once (a reload paced its runs' answers in one by one and
  // glided ~1,000 px to the end over 1.5 s, Milo's stress run).
  // Seen working once it stands caught up, from the draw after: a reload's history comes in with
  // its catching up, and paced in under a live run's card the page glided through it to the end
  // (engine final run, A5).
  const [workedInSight, setWorkedInSight] = useState(false);
  useLayoutEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- seen in the draw after it was drawn
    if (isWorking && !syncing) setWorkedInSight(true);
  }, [isWorking, syncing]);
  // Out of sight (a kept list), nobody watches: they are simply there.
  const rowsHeld = usePace({
    keys: pacedRowIds,
    flush: syncing || restoringReadingPosition || !(kept?.shown ?? true) || !workedInSight,
  });
  const rowsHeldKey = [...rowsHeld].join("\n");
  // Read by what they are: the list's data changes only when they do.
  const rows = useMemo(() => {
    if (rowsHeldKey === "") return stableRows;
    const held = new Set(rowsHeldKey.split("\n"));
    return stableRows.filter((row) => !held.has(row.id));
  }, [stableRows, rowsHeldKey]);
  // What was decided of every proposal in the conversation, read from HQ in one call.
  const proposalIds = useMemo(
    () =>
      stableRows.flatMap((row) =>
        row.kind === "proposal" && row.operation.proposal !== undefined
          ? [row.operation.proposal.id]
          : [],
      ),
    [stableRows],
  );
  useProposalDecisionsRead(proposalIds);
  // The newest release ask: an earlier one in the conversation says it took its place.
  const newestReleaseAsk = useMemo(
    () =>
      stableRows
        .flatMap((row) =>
          row.kind === "proposal" && row.operation.proposal?.kind === "release.offer"
            ? [row.operation.proposal.id]
            : [],
        )
        .at(-1) ?? null,
    [stableRows],
  );

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
  const previousRowOrderRef = useRef(rowOrder);
  const insertedHistory = useMemo(
    () => historicalInsertions(previousRowOrderRef.current.split("\n"), rowOrder.split("\n")),
    [rowOrder],
  );
  // Rows that came at the end with this order: their first measurement is their arrival.
  const arrivedRows = useMemo(
    () => endArrivals(previousRowOrderRef.current.split("\n"), rowOrder.split("\n")),
    [rowOrder],
  );
  useLayoutEffect(() => {
    previousRowOrderRef.current = rowOrder;
  }, [rowOrder]);
  // The history whose room the view was last taken along for: once per rows joining.
  const joinedHistoryRef = useRef(insertedHistory);
  const livePause = useMemo(() => livePauseId(rows), [rows]);
  // Only the server's own pause with nothing after it fills the conversation; the engine's pause
  // is a notice card where its run ended (Milo's run 4 drew it a viewport tall, blank below).
  const pauseStageId = useMemo(
    () => livePauseStageId(rows, limit, usagePause),
    [limit, rows, usagePause],
  );
  const minimapItems = useMemo(() => deriveTimelineMinimapItems(rows), [rows]);
  // The rows a reading position may land on stay drawn while it is put
  // back: its own, the run's line and the row above it.
  const restoringAlwaysRender = useMemo(() => {
    const position =
      noticeReadingPosition ?? (restoringReadingPosition ? rememberedPosition : undefined);
    if (!position) return undefined;
    const { rowId, cardTopId, previousRowId } = position;
    const indices = [rowId, cardTopId, previousRowId].flatMap((id) => {
      const index = id === null ? -1 : rows.findIndex((row) => row.id === id);
      return index >= 0 ? [index] : [];
    });
    return indices.length > 0 ? { indices } : undefined;
  }, [noticeReadingPosition, rememberedPosition, restoringReadingPosition, rows]);
  const [timelineViewportElement, setTimelineViewportElement] = useState<HTMLDivElement | null>(
    null,
  );
  const [pauseViewportHeight, setPauseViewportHeight] = useState<number | undefined>();
  const [listReady, setListReady] = useState(false);
  const measuredRowsRef = useRef(new Map<string, MessagesTimelineRow>());
  const onListLoad = useCallback(() => {
    // A size equal to the estimate is measured too: LegendList records it without a
    // size-change callback. Its next streamed growth belongs to this loaded row.
    const sizes = listRef.current?.getState().sizes;
    for (const row of rows) {
      if (sizes?.has(row.id)) measuredRowsRef.current.set(row.id, row);
    }
    setListReady(true);
  }, [listRef, rows]);
  // The list stands where it stays: a reading position put back, or the end
  // reached. Until then it is out of sight (`data-timeline-placing`).
  const [listPlaced, setListPlaced] = useState(false);
  // Rows still reading what they show keep the conversation out of sight while it is placed.
  const [rowReads] = useState(makeTimelineRowReads);
  // So does its project's flow still being read: a landing read after the conversation stood
  // joined its end and moved the page under the person (owner, 2026-11-17). Read by the placing
  // loop each frame, and waited for at most the opening's beat from when this placement began —
  // never from a run of the loop, which a streaming first answer starts again with every row.
  const flowReadRef = useRef(flowRead);
  useLayoutEffect(() => {
    flowReadRef.current = flowRead;
  }, [flowRead]);
  const placingBeganRef = useRef<{ readonly key: string; readonly at: number } | null>(null);
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
  const listPlacedRef = useRef(listPlaced);
  useLayoutEffect(() => {
    listPlacedRef.current = listPlaced;
  }, [listPlaced]);
  const followingEndRef = useRef(followingEnd);
  useLayoutEffect(() => {
    followingEndRef.current = followingEnd;
  }, [followingEnd]);
  // What keeps the list at its end while it follows (`createEndFollow`): growth of what is
  // already there carried at once, an arrival by a glide. The list's own keeping is off: it jumps.
  const endFollowRef = useRef<EndFollow | null>(null);
  // Execution ownership only: fold compensation and end following cannot write together.
  const outerFoldsRef = useRef(new Set<() => void>());
  const foldExecutionsRef = useRef(new Set<ReturnType<typeof foldTimelineWork>>());
  const arrivingRef = useRef(rowsHeldKey !== "");
  useLayoutEffect(() => {
    arrivingRef.current = rowsHeldKey !== "";
  }, [rowsHeldKey]);
  useEffect(
    () => () => {
      for (const execution of foldExecutionsRef.current) execution.dispose();
    },
    [],
  );
  useEffect(() => {
    const endFollow = createEndFollow({
      viewport: () => listRef.current?.getScrollableNode() ?? null,
      // Whether it stands at its end is the follower's own judgement, from
      // the scrolls it hears: the list's own reading goes stale mid-glide.
      follows: () => followingEndRef.current,
      room: () => followRoomRef.current,
      // Placed out of sight, it stands at its end at once, so it is shown standing still.
      unseen: () => !listPlacedRef.current,
      placeEnd: () => {
        void listRef.current?.scrollToEnd({ animated: false, viewOffset: followRoomRef.current });
      },
    });
    endFollowRef.current = endFollow;
    return () => {
      endFollow.stop();
      endFollowRef.current = null;
    };
  }, [listRef]);
  // An answer landing (`onAnswerLands`): what it holds still, where it stood. The follower waits.
  const landingRef = useRef<{
    readonly element: HTMLElement;
    readonly edge: "top" | "bottom";
    /** Where it holds its edge; a held head comes down with the work folding under it. */
    at: number;
    readonly since: number;
    frame: number;
    /** A held head whose answer comes apart from its slot: the view may travel to that answer. */
    readonly glides?: boolean;
    /** When the end first went on under the view: from then the view travels to it. */
    glide?: number | undefined;
    /** The held head's row as the last frame drew it, and how many frames it has stood so. */
    card?: { readonly height: number; readonly still: number };
    /** Words landed under a held head where they were read, and how much of their way is left. */
    words?: { readonly travel: Animation; left: number };
  } | null>(null);
  // A fold or a landing holds the view where it stands: the follower waits for it.
  const followEnd = useCallback((grew = 0, own?: OwnScroll) => {
    if (outerFoldsRef.current.size === 0 && landingRef.current === null) {
      if (own === "list") endFollowRef.current?.undo();
      else endFollowRef.current?.follow(grew);
    }
  }, []);
  // What it holds back where it stood, in the frame that moved it. An answer that comes with its
  // run's end and goes on under the view takes the held head on to where it stands with the view
  // at the conversation's true end, the room under it aside, as soon as its card stands at its
  // new height: never a pause, then a glide (z1: 180 ms still, then 133 px).
  const holdAnswer = useCallback(() => {
    const landing = landingRef.current;
    const scroller = listRef.current?.getScrollableNode();
    if (landing === null || !scroller || !landing.element.isConnected) return;
    const stands = landing.element.getBoundingClientRect()[landing.edge];
    let at = landing.at;
    if (landing.glides === true) {
      // How far the end stands under the view. The view sets off once the head's card stands at
      // its new height, its work folded: scrolled as they shed it, the list drew the rows under
      // them a frame late (the usage limit's notice 47 px off the card's foot). Its work folding,
      // the fold takes it there (`carried`).
      const under = headUnderEnd(landing, scroller, askRoomRef.current);
      if (under <= 2 || foldExecutionsRef.current.size > 0) landing.glide = undefined;
      else if (landing.glide === undefined && (landing.card?.still ?? 0) >= CARD_STILL_FRAMES)
        landing.glide = performance.now();
      if (landing.glide !== undefined) {
        // Eased in from rest, as the card's own ease came to rest: one travel, never a kick.
        const travelled = Math.min(1, (performance.now() - landing.glide) / HEAD_GLIDE_MS);
        at -= travelled * travelled * (3 - 2 * travelled) * Math.max(0, under);
      }
    }
    const off = stands - at;
    if (Math.abs(off) > 0.5) scrollOwn(scroller, scroller.scrollTop + off);
  }, [listRef]);
  // A landing holds what it holds where it stood until the card has settled around it, then keeps
  // that as the end. Under a held head, what folds under it is taken up by room under the end —
  // never the list clamping its scroll, which moves everything above — and the rows the closing
  // panel would carry down to the end stay where they are (`cardRowsCarried`). Under reduced motion
  // nothing is held: the view stays at the end and the landing is one swap. Held, the card folding
  // at once under its head took the answer 229 px up, and the hold's end brought it back down.
  const land = useCallback(
    (target: {
      readonly element: HTMLElement;
      readonly edge: "top" | "bottom";
      readonly at: number;
      readonly glides?: boolean;
    }) => {
      const scroller = listRef.current?.getScrollableNode();
      if (!scroller || !followingEndRef.current || reducedMotion()) return;
      const held = landingRef.current;
      if (held !== null) cancelAnimationFrame(held.frame);
      held?.words?.travel.finish();
      endFollowRef.current?.stop();
      const landing: NonNullable<typeof landingRef.current> = {
        ...target,
        since: performance.now(),
        frame: 0,
      };
      landingRef.current = landing;
      // Under a held head, a view's height: whatever folds under it — the card, its panel, the
      // slot — the room takes up. Below the view, it costs nothing; once it goes, the view glides
      // only as far as it stood in it.
      setLandingRoom(
        target.edge === "top" ? Math.max(ANSWER_ROOM_PX, scroller.clientHeight) : ANSWER_ROOM_PX,
      );
      const list = scroller.closest<HTMLElement>(".timeline-legend-list") ?? scroller;
      list.toggleAttribute("data-timeline-holds-head", target.edge === "top");
      holdAnswer();
      const step = (now: number) => {
        if (landingRef.current !== landing) return;
        if (landing.glides === true) {
          const height =
            landing.element.closest("[data-timeline-row-id]")?.getBoundingClientRect().height ?? 0;
          landing.card = {
            height,
            still:
              landing.card !== undefined && Math.abs(landing.card.height - height) < 0.5
                ? landing.card.still + 1
                : 0,
          };
        }
        holdAnswer();
        // A held head lets go once its card has folded; an answer's line once its row is measured.
        const settling =
          outerFoldsRef.current.size > 0 ||
          now - landing.since < (landing.edge === "top" ? HEAD_HOLD_MS : ANSWER_HOLD_MS) ||
          (landing.glide !== undefined && now - landing.glide < HEAD_GLIDE_MS);
        if (settling && followingEndRef.current) {
          landing.frame = requestAnimationFrame(step);
          return;
        }
        landingRef.current = null;
        landing.words?.travel.finish();
        list.removeAttribute("data-timeline-holds-head");
        // The room goes once nothing moves what it held, and the view glides out of it on the
        // follow curve (`useAskRoom`) to the conversation's true end. Kept until something came
        // after, the view rested short of its end over an empty foot (the owner, 0.15.44).
        const view = listRef.current?.getScrollableNode();
        setLandingRoom(0);
        // Settled with the conversation's end under the view — a notice, a wake's card landing
        // under the held head — the view glides down to it: never left below (the usage limit's
        // notice stood 12 px under the view).
        const under =
          landing.edge === "top" && view
            ? view.scrollHeight - askRoomRef.current - view.clientHeight - view.scrollTop
            : 0;
        landing.frame = requestAnimationFrame(() => {
          if (!followingEndRef.current) return;
          if (under > 2) endFollowRef.current?.follow();
          else endFollowRef.current?.keep();
        });
      };
      landing.frame = requestAnimationFrame(step);
    },
    [holdAnswer, listRef],
  );
  // The room a landing asked for is drawn in this commit, or a row it brings arrives (the answer
  // a moment after its card settled): what it holds goes back where it stood before the frame
  // paints — the list may have clamped or followed its end in it.
  useLayoutEffect(() => {
    if (landingRef.current !== null) holdAnswer();
  }, [askRoom, rows, holdAnswer]);
  // A run's turn ends under the person's eyes, the words they read whole in its slot: its head
  // stands still, from the commit that ends it.
  const onTurnLands = useCallback(
    (head: HTMLElement, top: number, answerApart: boolean) =>
      land({ element: head, edge: "top", at: top, glides: answerApart }),
    [land],
  );
  // A message the person had queued leaves its row under the running run's card — steered into
  // the run, it lands above the card instead: the card's head stands where it was last painted,
  // and the view glides on to the end once it settles. Never the list clamping at its shrunken
  // end, which moved the conversation by both rows at once (Milo's third stress run: 105 px).
  const queuedRowIdsRef = useRef<ReadonlySet<string>>(new Set());
  useLayoutEffect(() => {
    const queued = new Set(rows.flatMap((row) => (row.kind === "queued-message" ? [row.id] : [])));
    const left = [...queuedRowIdsRef.current].some((id) => !queued.has(id));
    queuedRowIdsRef.current = queued;
    const live = rows.findLast((row) => row.kind === "record" && row.live);
    if (!left || live === undefined || landingRef.current !== null) return;
    const head = listRef.current
      ?.getScrollableNode()
      ?.querySelector<HTMLElement>(
        `[data-timeline-row-id="${CSS.escape(live.id)}"] [data-run-chat] > [data-run-head]`,
      );
    const top = head ? headStoodJustNow(head) : null;
    if (head && top !== null) land({ element: head, edge: "top", at: top });
  }, [land, listRef, rows]);
  // Run 5 (C +0:15.29): the answer whose words the person read at the slot's foot landed from its
  // first line, and the page glided 1033 px after it. Cut by the slot's cap, its last line stands
  // where theirs was: held there while the card folds above it and the list places and measures
  // it, then kept as the end.
  const onAnswerLands = useCallback(
    (words: HTMLElement, stood: WordsStood) => {
      const head = stood.head?.element.isConnected === true ? stood.head : null;
      const holding = landingRef.current;
      if (holding !== null && holding.edge === "top" && holding.element === head?.element) {
        // Its card's head is held: the words land under it, a strip's height under where they were
        // read at most — they travel there from where they stood, never cut (recheck on 0.15.44).
        // Read before the frame paints, once the slot they leave has gone in its own commit.
        const row = words.closest<HTMLElement>("[data-timeline-row-id]");
        if (row === null || typeof row.animate !== "function") return;
        requestAnimationFrame(() => {
          const off =
            words.getBoundingClientRect().bottom -
            (holding.element.getBoundingClientRect().top - holding.at) -
            stood.bottom;
          if (Math.abs(off) <= 2) return;
          // Its work folding under the head, they go there on the fold's curve (`carried`): on
          // their own, they went 7 px up as the fold took them 10 px down to the conversation's
          // end (the owner's 29-step close, 2026-10-19).
          const rides =
            landingRef.current === holding &&
            holding.element.parentElement?.querySelector(":scope > [data-folding]") != null;
          const travel = row.animate([{ translate: `0 ${-off}px` }, { translate: "0 0" }], {
            duration: WORDS_LAND_MS,
            easing: rides ? "linear" : "cubic-bezier(0.23, 1, 0.32, 1)",
          });
          if (!rides) return;
          travel.pause();
          holding.words = { travel, left: 1 };
        });
        return;
      }
      if (landingHolds({ head: head !== null, whole: stood.whole }) === "head" && head !== null) {
        land({ element: head.element, edge: "top", at: head.top });
        return;
      }
      land({ element: words, edge: "bottom", at: stood.bottom });
      // Its last line held where it was read, the answer unrolls upward from the height its card
      // stood at, carrying what stands above along: never its card gone above it in one frame (z2,
      // recheck on 0.15.44: −1,138 px, the head out of the view at once).
      const row = words.closest<HTMLElement>("[data-timeline-row-id]");
      if (landingRef.current === null || row === null || stood.head === null) return;
      if (typeof row.animate !== "function") return;
      // Read within the row and its card as they lay out now, wherever the list has placed them
      // yet: the row's foot under the words, and its card's part still drawn above it — its head,
      // closed — which stands where it stood.
      const box = row.getBoundingClientRect();
      const foot = box.bottom - words.getBoundingClientRect().bottom;
      const kept = stood.head.element.isConnected
        ? box.top - stood.head.element.getBoundingClientRect().top
        : 0;
      const from = stood.bottom + foot - (stood.head.top + Math.max(0, kept));
      if (box.height - from < UNROLL_FROM_PX) return;
      const unrolled = {
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
      };
      row.animate(
        [
          { ...unrolled, height: `${from}px` },
          { ...unrolled, height: `${box.height}px` },
        ],
        { duration: ANSWER_UNROLL_MS, easing: "cubic-bezier(0.45, 0, 0.25, 1)" },
      );
      holdAnswer();
    },
    [holdAnswer, land],
  );
  useEffect(
    () => () => {
      const held = landingRef.current;
      if (held !== null) cancelAnimationFrame(held.frame);
    },
    [],
  );
  const onFoldWork = useCallback<NonNullable<TimelineRowSharedState["onFoldWork"]>>(
    (input) => {
      const release = () => {
        outerFoldsRef.current.delete(release);
        foldExecutionsRef.current.delete(execution);
        followEnd();
      };
      const share = { from: input.from, taken: 0, under: 0 };
      // The held head over the work that folds: its card's own.
      const heldOver = () => {
        const landing = landingRef.current;
        return landing?.edge === "top" && landing.element.parentElement?.contains(input.above)
          ? landing
          : null;
      };
      const execution = foldTimelineWork({
        ...input,
        viewport: () => listRef.current?.getScrollableNode() ?? null,
        rows: () => {
          const viewport = listRef.current?.getScrollableNode();
          const state = listRef.current?.getState();
          if (!viewport || !state) return [];
          // Read mounted holders, including a folding row outside the current buffered range.
          return [...viewport.querySelectorAll<HTMLElement>("[data-timeline-root]")].flatMap(
            (root) => {
              const row = root.parentElement;
              const key = root.dataset.timelineRoot;
              const index = key === undefined ? undefined : state.indexByKey(key);
              return row !== null && index !== undefined
                ? [{ row, position: state.positionAtIndex(index), size: state.sizeAtIndex(index) }]
                : [];
            },
          );
        },
        // What the settle brought is still arriving, or the view eases out of the room under the end.
        waits: () =>
          arrivingRef.current ||
          (landingRef.current === null
            ? followRoomRef.current > 0
            : landingRef.current.edge === "top" && heldOver() === null),
        // Under a held head past its wait, the fold takes room under the end, never the view's place;
        // its own head comes down with it instead (`carried`).
        follows: () => followingEndRef.current && landingRef.current?.edge !== "top",
        // A held head comes down as its work folds under it, from the fold's first frame: the
        // history above comes down, the words under it stay where they were read. Folded under a
        // still head, the work carried those words up and the view's way out of the room brought
        // them back down (a crash-cut run, 298 px); waiting for the hold to end paused the close.
        // Its way to the conversation's end, read once as the fold starts — the list draws a
        // fold's frame's end a frame late — goes along on the fold's curve, never after it: the
        // view went up to the answer, then the fold brought it all back down (the owner's
        // 29-step close, 2026-10-19: 232 px up, 461 px down; streamed, 250 ms still).
        carried: (taken) => {
          const left = share.from - share.taken;
          share.taken += taken;
          const landing = heldOver();
          if (landing === null) return;
          const part = left > 0 ? Math.min(1, taken / left) : 1;
          const way = share.under * part;
          share.under -= way;
          landing.at += taken - way;
          if (landing.words !== undefined) {
            landing.words.left *= 1 - part;
            landing.words.travel.currentTime = (1 - landing.words.left) * WORDS_LAND_MS;
          }
          holdAnswer();
        },
        start: () => {
          outerFoldsRef.current.add(release);
          endFollowRef.current?.stop();
          const landing = heldOver();
          const scroller = listRef.current?.getScrollableNode();
          if (landing !== null && scroller)
            share.under = headUnderEnd(landing, scroller, askRoomRef.current);
        },
        release,
      });
      foldExecutionsRef.current.add(execution);
      return execution.cancel;
    },
    [followEnd, holdAnswer, listRef],
  );
  const placeFolds = useCallback(() => {
    for (const execution of foldExecutionsRef.current) execution.place();
  }, []);
  // Rows arriving, and the viewport resizing, move the end too.
  useLayoutEffect(() => {
    const joining = joinedHistoryRef.current !== insertedHistory && insertedHistory.size > 0;
    joinedHistoryRef.current = insertedHistory;
    if (!followingEnd || rows.length === 0) return;
    // A commit can clamp the native range before later row measurements grow it again.
    endFollowRef.current?.observe();
    // Composer geometry keeps the followed line in place. Row growth keeps its existing motion.
    if (previousContentInsetEndAdjustmentRef.current !== contentInsetEndAdjustment) {
      if (outerFoldsRef.current.size === 0)
        endFollowRef.current?.place(
          contentInsetEndAdjustment - previousContentInsetEndAdjustmentRef.current,
        );
    }
    if (!listPlaced) return;
    // History joining before the tail — a landing or a release its application's flow names once
    // the conversation stands — moves the end by its room in the commit that brings it, and the
    // view goes with it before that frame paints. A row not drawn is never measured, so nothing
    // carried it: every row in sight stood its room lower for a frame, and a glide brought them
    // back (90 px a row, the owner 2026-11-11).
    if (joining)
      // After the list has laid the commit out, as a measured row's growth is carried.
      queueMicrotask(() => {
        const state = listRef.current?.getState();
        if (state === undefined) return;
        // The room the list gives each: its estimate until it is drawn, between its place and
        // the next row's (history joins before the tail, so there is one).
        let joined = 0;
        for (const id of insertedHistory) {
          const index = state.indexByKey(id);
          if (index === undefined) continue;
          const room = state.positionAtIndex(index + 1) - state.positionAtIndex(index);
          if (room > 0) joined += room;
        }
        if (joined > 0) followEnd(joined);
      });
    const frame = requestAnimationFrame(() => followEnd());
    return () => cancelAnimationFrame(frame);
  }, [
    askRoom,
    contentInsetEndAdjustment,
    followEnd,
    followingEnd,
    insertedHistory,
    listPlaced,
    listRef,
    rows,
  ]);
  useEffect(() => {
    const viewport = timelineViewportElement;
    if (viewport === null || typeof ResizeObserver === "undefined") return;
    let height = viewport.clientHeight;
    // A shorter viewport moves the end by what it lost: carried, as any growth of what is there.
    const observer = new ResizeObserver(() => {
      const shrank = height - viewport.clientHeight;
      height = viewport.clientHeight;
      remeasurePositionRef.current?.();
      followEnd(Math.max(0, shrank));
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [followEnd, timelineViewportElement]);
  // Every measurement can move the end, including an estimated row becoming
  // shorter. Read its native clamp in the measurement callback before another
  // layout can hide it, then follow after the list applies its layout.
  // An inserted historical row carries its whole measured height before paint; the words
  // below it already stood in view. Every other row's growth is carried too (`carriedRowGrowth`)
  // but an arrival's: a row that came at the end, from its first measurement while its glide runs.
  const arrivingRowsRef = useRef(new Set<string>());
  useLayoutEffect(() => {
    const keys = new Set(rowOrder.split("\n"));
    for (const key of measuredRowsRef.current.keys())
      if (!keys.has(key)) measuredRowsRef.current.delete(key);
    for (const key of arrivingRowsRef.current)
      if (!keys.has(key)) arrivingRowsRef.current.delete(key);
  }, [rowOrder]);
  const onItemSizeChanged = useCallback<
    NonNullable<LegendListProps<MessagesTimelineRow>["onItemSizeChanged"]>
  >(
    (info) => {
      const previous = measuredRowsRef.current.get(info.itemKey);
      if (info.itemData !== undefined) measuredRowsRef.current.set(info.itemKey, info.itemData);
      const arriving =
        (previous === undefined && arrivedRows.has(info.itemKey)) ||
        (arrivingRowsRef.current.has(info.itemKey) && endFollowRef.current?.gliding() === true);
      if (arriving) arrivingRowsRef.current.add(info.itemKey);
      else arrivingRowsRef.current.delete(info.itemKey);
      const grew = carriedRowGrowth({
        inserted: insertedHistory.has(info.itemKey),
        arriving,
        previous,
        next: info.itemData,
        size: info.size,
        previousSize: info.previous,
      });
      remeasurePositionRef.current?.();
      placeFolds();
      if (!followingEndRef.current) return;
      endFollowRef.current?.observe();
      holdAnswer();
      queueMicrotask(() => {
        placeFolds();
        holdAnswer();
        followEnd(grew);
      });
      if (endRepinFrameRef.current !== null) return;
      endRepinFrameRef.current = requestAnimationFrame(() => {
        endRepinFrameRef.current = null;
        placeFolds();
        followEnd();
      });
    },
    [arrivedRows, followEnd, holdAnswer, insertedHistory, placeFolds],
  );

  // Where the person is, kept as they move, by row: the row at the reading
  // line, how far into it, how tall it was, the run's line and the row above
  // it — what finds the place again once rows have changed (a watched run
  // folds when the person leaves).
  const rememberPosition = useCallback((): boolean | undefined => {
    const state = listRef.current?.getState?.();
    // Nothing is the person's place while the list is still being placed.
    if (
      noticeResizeRef.current !== null ||
      restoringReadingPosition ||
      !listPlaced ||
      state === undefined ||
      state.data !== rows
    ) {
      return undefined;
    }
    const isAtEnd = resolveTimelineIsAtEnd(state);
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
  }, [listPlaced, listReady, listRef, restoringReadingPosition, routeThreadKey, rows]);
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
  // "Show in conversation" on an ask docked above the composer: the person's way to its card.
  useAskReveal(rows, (index) => {
    onManualNavigation();
    notePersonSession({ type: "input", at: performance.now() });
    return listRef.current?.scrollToIndex({ index, animated: !reducedMotion(), viewOffset: 24 });
  });
  // The wheel gesture under way and whether it is the list's (`latchWheelGesture`).
  const wheelLatchRef = useRef<WheelGestureLatch | null>(null);
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
    const onWheel = (event: WheelEvent) => {
      const node = scrollNode();
      if (!node || event.ctrlKey || !isVerticalWheel(event.deltaX, event.deltaY)) return;
      // Whatever it scrolls, the wheel is the person's: should the browser
      // hand the rest of a gesture to the list, the list's move is theirs.
      notePersonSession({ type: "input", at: performance.now() });
      // A wheel that started in a nested scroller (a run's own scroll, a code
      // block) does not leave the end while it scrolls that scroller; carried
      // on past its edge into the list, it is the list's (`wheelHandedToList`).
      const direction = event.deltaY < 0 ? "up" : "down";
      const latch = latchWheelGesture(
        wheelLatchRef.current,
        { at: performance.now(), direction },
        () => isTimelineScrollTarget(event.target, node, event.deltaY),
      );
      wheelLatchRef.current = latch;
      if (latch.targetsList) onPersonInputRef.current({ kind: "wheel", direction });
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
    // Opened at the conversation's end, the end stays in sight: what opens grows upward, the last
    // row held where it stands (recheck on 0.15.45: an opened card pushed its answer under the
    // composer) — never past its own row's top reaching the view's, from where it grows down.
    // Opened farther up, the opener stands where it was clicked.
    let keepsEnd = false;
    // Held as it lays out, before it paints: a step a frame late let the end dip 81 px.
    let holdsEnd: ResizeObserver | null = null;
    let heldRow: HTMLElement | null = null;
    const keepEnd = () => {
      const viewport = listRef.current?.getScrollableNode();
      if (!viewport || performance.now() > until) return;
      if (!keepsEnd) {
        shrinkWith(viewport);
        return;
      }
      const end = viewport.scrollHeight - viewport.clientHeight - followRoomRef.current;
      // Its row seen whole is what the list keeps in place as rows grow; once past the top, the
      // list kept the rows under it in place too, and with the end kept here the view went twice
      // as far and fell back (Show work at the end, 2026-11-12: the opener 600 px up and gone,
      // 325 px past the end, then back in one frame).
      const room =
        heldRow === null
          ? Number.POSITIVE_INFINITY
          : heldRow.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
      const to = Math.min(end, viewport.scrollTop + Math.max(0, room));
      if (Math.abs(to - viewport.scrollTop) > 0.5) scrollOwn(viewport, to);
    };
    // What it shut moves the rest in the frame it shrinks, as the list will once it has heard
    // the row — the list hears it every other frame: the rows under it come up with its edge,
    // and at the conversation's end the view comes down with it. Left to the list, the rows under
    // it trailed its edge by a frame's shrink, and the view the browser clamped to the list's end
    // came down at half its pace.
    let carried: HTMLElement[] = [];
    let settling = 0;
    const uncarry = () => {
      for (const row of carried) row.style.translate = "";
      carried = [];
    };
    // How much of its shrink the list has not heard yet, and what to carry by it.
    const unheardOf = () => {
      const root = heldRow?.closest<HTMLElement>("[data-timeline-root]");
      const holder = root?.parentElement;
      const state = listRef.current?.getState();
      const key = root?.dataset.timelineRoot;
      const index = key === undefined ? undefined : state?.indexByKey(key);
      if (holder == null || state === undefined || index === undefined) return null;
      const unheard = Math.min(0, holder.getBoundingClientRect().height - state.sizeAtIndex(index));
      return { unheard, holder, index, state };
    };
    // Once the list has heard the last step, the rows it moved go without their carry.
    const settle = () => {
      settling = 0;
      if (carried.length === 0) return;
      const read = unheardOf();
      if (read === null || read.unheard > -0.5 || performance.now() > until + REVEAL_FOR_MS)
        uncarry();
      else settling = requestAnimationFrame(settle);
    };
    const shrinkWith = (viewport: HTMLElement) => {
      // A fold places the rows itself.
      if (outerFoldsRef.current.size > 0) return;
      const read = unheardOf();
      uncarry();
      if (read === null) return;
      const { unheard, holder, index, state } = read;
      if (unheard < -0.5) {
        for (const row of holder.parentElement?.children ?? []) {
          const under = row.querySelector<HTMLElement>(":scope > [data-timeline-root]");
          const at = under?.dataset.timelineRoot;
          if (!(row instanceof HTMLElement) || at === undefined) continue;
          if ((state.indexByKey(at) ?? -1) <= index) continue;
          row.style.translate = `0 ${unheard}px`;
          carried.push(row);
        }
        if (settling === 0) settling = requestAnimationFrame(settle);
      }
      const end = viewport.scrollHeight - viewport.clientHeight + unheard;
      if (viewport.scrollTop - end > 0.5) scrollOwn(viewport, end);
    };
    const stop = () => {
      holdsEnd?.disconnect();
      holdsEnd = null;
      heldRow = null;
      uncarry();
      cancelAnimationFrame(settling);
      settling = 0;
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
      if (keepsEnd) {
        keepEnd();
        return;
      }
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
      if (button === null) return;
      if (button.getAttribute("aria-expanded") === "true") {
        stop();
        heldRow = button.closest<HTMLElement>("[data-timeline-row-id]");
        if (heldRow === null || typeof ResizeObserver === "undefined") return;
        keepsEnd = false;
        until = performance.now() + REVEAL_FOR_MS;
        holdsEnd = new ResizeObserver(keepEnd);
        holdsEnd.observe(heldRow);
        return;
      }
      opener = button;
      keepsEnd = followingEndRef.current;
      until = performance.now() + REVEAL_FOR_MS;
      holdsEnd?.disconnect();
      holdsEnd = null;
      const row = button.closest<HTMLElement>("[data-timeline-row-id]");
      heldRow = row;
      if (keepsEnd && row !== null && typeof ResizeObserver !== "undefined") {
        holdsEnd = new ResizeObserver(keepEnd);
        holdsEnd.observe(row);
      }
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
    (personScrolling: boolean) => {
      const node = listRef.current?.getScrollableNode();
      const own = node ? takeOwnScroll(node) : undefined;
      placeFolds();
      const reading = node ? { scrollTop: node.scrollTop, contentHeight: node.scrollHeight } : null;
      // The browser carried a wheel gesture of a nested scroller on into the list: the reader
      // took the list, and the wheel's leave or return is told as theirs.
      const now = performance.now();
      const handed =
        own === undefined && reading
          ? wheelHandedToList(wheelLatchRef.current, {
              at: now,
              ...classifyTimelineScroll({
                previous: lastReadingRef.current,
                current: reading,
                personScrolling: true,
              }),
            })
          : null;
      if (handed !== null) {
        wheelLatchRef.current = handed;
        notePersonSession({ type: "input", at: now });
        onPersonInputRef.current({ kind: "wheel", direction: handed.direction });
      }
      const scroll = reading
        ? {
            ...classifyTimelineScroll({
              previous: lastReadingRef.current,
              current: reading,
              personScrolling: own === undefined && (personScrolling || handed !== null),
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
      if (restoringReadingPosition || state?.data !== rows) return own;
      const isAtEnd = rememberPosition();
      if (isAtEnd !== undefined) {
        onIsAtEndChange(isAtEnd, scroll);
      }
      if (!state || minimapItems.length === 0) {
        return own;
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
      return own;
    },
    [
      listRef,
      minimapItems,
      minimapStripMap,
      notePersonSession,
      onIsAtEndChange,
      placeFolds,
      rememberPosition,
      restoringReadingPosition,
      rows,
    ],
  );
  // A move the page made itself (`scrollOwn`: a glide, a fold) is never the
  // person's, however recently they touched the list.
  const handleScroll = useCallback(() => {
    const own = readList(personIsScrolling(personSessionRef.current, performance.now()));
    // A move of the page's own that left the end while it follows: back to the end; the list's
    // own before the frame paints.
    if (own && followingEndRef.current && listPlacedRef.current) followEnd(0, own);
  }, [followEnd, readList]);

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
      const { width: viewportWidth, height } = timelineViewportElement.getBoundingClientRect();
      setPauseViewportHeight(height);
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
  // The person's other Mates their messages name with `@`: one matcher for the list, none in a
  // crewmate's conversation, where `@` names none.
  const mentionableMates = useMentionableMates(mate?.projectId, crew === null);
  const mateMentions = useMemo(() => mateMentionMatcher(mentionableMates), [mentionableMates]);
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
  const openingActivity = useZeropsThreadActivity(threadRef);
  // The room a pause's stage takes, where one stands. With none, what the composer covers is no
  // row's to know: a draft wrapping to a new line changes the list's end and draws no row again.
  const pauseStageHeight =
    pauseStageId === null || pauseViewportHeight === undefined
      ? undefined
      : Math.max(0, pauseViewportHeight - contentInsetEndAdjustment);
  // When each row that may enter (`opensRoom`) joined this conversation: one it held while nobody
  // saw it is placed with it; one joining it in sight enters as the list draws it, once — a landing
  // read late joined the end in one step and moved the page under the person (owner, 2026-11-17).
  const joinedAtRef = useRef(new Map<string, number>());
  const seenRef = useRef(false);
  const [rooms] = useState<RowRooms>(() => ({
    joinedInSight: (rowId) => {
      if (!seenRef.current) return false;
      const joinedAt = joinedAtRef.current.get(rowId);
      return joinedAt === undefined || performance.now() - joinedAt < ROOM_OPENS_WITHIN_MS;
    },
    // Drawn again as the list recycles it, it stands.
    opened: (rowId) => joinedAtRef.current.set(rowId, Number.NEGATIVE_INFINITY),
  }));
  const sharedState = useMemo<TimelineRowSharedState>(
    () => ({
      timestampFormat,
      routeThreadKey,
      threadRef,
      markdownCwd,
      resolvedTheme,
      workspaceRoot,
      skills,
      mateMentions,
      activeThreadEnvironmentId,
      onRunShellCommand,
      onImageExpand,
      speaker,
      onDismissEndNotice,
      driver: provider,
      standUpAsk,
      livePauseId: livePause,
      usagePause,
      pauseStage: { id: pauseStageId, mate: mate ?? null, height: pauseStageHeight },
      limit,
      interruption,
      onRestartContinue,
      onUsageContinue,
      usageContinueTries,
      onWithdrawHeldMessage,
      asker,
      agentPanelModel: agentPanelModel ?? EMPTY_AGENT_PANEL_MODEL,
      onOpenAgents,
      onSteerQueuedMessage,
      steerQueuedMessageShortcutLabel,
      queueBlockedByAnswer,
      onRemoveQueuedMessage,
      arrivedAfter,
      rooms,
      syncing,
      onHoldReading: onManualNavigation,
      onFoldWork,
      onAnswerLands,
      onTurnLands,
    }),
    [
      timestampFormat,
      routeThreadKey,
      threadRef,
      markdownCwd,
      resolvedTheme,
      workspaceRoot,
      skills,
      mateMentions,
      activeThreadEnvironmentId,
      onRunShellCommand,
      onImageExpand,
      speaker,
      onDismissEndNotice,
      provider,
      standUpAsk,
      livePause,
      pauseStageId,
      usagePause,
      mate,
      pauseStageHeight,
      limit,
      interruption,
      onRestartContinue,
      onUsageContinue,
      usageContinueTries,
      onWithdrawHeldMessage,
      asker,
      agentPanelModel,
      onOpenAgents,
      onSteerQueuedMessage,
      steerQueuedMessageShortcutLabel,
      queueBlockedByAnswer,
      onRemoveQueuedMessage,
      arrivedAfter,
      rooms,
      syncing,
      onManualNavigation,
      onFoldWork,
      onAnswerLands,
      onTurnLands,
    ],
  );
  const activityState = useMemo<TimelineRowActivityState>(
    () => ({
      isWorking,
      isCompacting,
      isStopping,
      latestTurnId: latestTurn?.turnId ?? null,
      workingStepLabel,
    }),
    [isCompacting, isStopping, isWorking, latestTurn?.turnId, workingStepLabel],
  );

  // Stable renderItem — no closure deps. Row components read shared state
  // from TimelineRowCtx, which propagates through LegendList's memo. A page the
  // Mate published stands in a column of its own, wider than the words' (the
  // owner, 2026-10-12: "let it go wider").
  const renderItem = useCallback(
    ({ item }: { item: MessagesTimelineRow }) => (
      <div
        className={cn(
          "mx-auto w-full min-w-0 overflow-x-clip",
          item.kind === "page" ? "max-w-6xl" : "max-w-3xl",
        )}
        data-timeline-root={item.id}
      >
        <TimelineRowContent row={item} />
      </div>
    ),
    [],
  );

  // A setup that never started is not a conversation yet: the Mate's arrival says it, and its
  // attempt waiting to start keeps it there until the Mate begins.
  const standUpStopped = useMemo(
    () =>
      crew !== null || runCards === null || queuedMessages.length > 0
        ? null
        : mateStandUpStopped(
            Object.values(runCards).flatMap((card) => card.runs),
            rows.some((row) => row.kind === "message" && row.message.role === "user"),
          ),
    [crew, queuedMessages.length, rows, runCards],
  );
  const empty =
    crew === null
      ? rows.length === 0 || standUpStopped !== null
      : rows.every((row) => row.kind === "seam" || row.kind === "crew-seam");
  // A working Mate's conversation still on its way shows its pane, never a
  // run made up from its status alone: the conversation replaced it a moment
  // later, 1,480 px away.
  const onItsWay = loading && timelineEntries.length === 0;
  const showsList = !onItsWay && (!empty || (isWorking && standUpStopped === null));
  const lastDraftMessage =
    keepsDraftMessage && !listPlaced
      ? rows.findLastIndex((row) => row.kind === "message" && row.message.role === "user")
      : -1;
  // LegendList mounts its rows after its container. Keep the draft's first rows on screen until
  // the measured list stands in their place, including when its conversation mounts afresh.
  const draftRows = lastDraftMessage >= 0 ? rows.slice(0, lastDraftMessage + 1) : [];
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
  // The page's fill of a load (`loadFills`): placed while the menu is still being read, the
  // conversation holds for it as long as its fade's start used to be delayed, and both come in
  // one frame where the menu is ready by then; its rows being placed tell the menu it is close.
  // After the load's first fill nothing holds: a switch opens as fast as it is placed.
  const filled = useLoadFill(kept?.shown === false ? null : "page", standing, {
    soon: showsList,
    patience: PAGE_HOLDS_FOR_MENU_MS,
  });
  // Whether the conversation is seen, and when its rows joined it (`rooms`). What came in the draw
  // that showed it — the fill, or a kept list coming back — came with it, and is placed.
  const keptShown = kept?.shown !== false;
  useLayoutEffect(() => {
    const wasSeen = seenRef.current;
    seenRef.current = filled && keptShown;
    const inSight = wasSeen && seenRef.current;
    const joined = joinedAtRef.current;
    for (const row of rows) {
      if (!opensRoom(row) || joined.has(row.id)) continue;
      joined.set(row.id, inSight ? performance.now() : Number.NEGATIVE_INFINITY);
    }
  }, [filled, keptShown, rows]);
  const paintedThread = useRef<string | null>(null);
  useEffect(() => {
    if (
      !standing ||
      !showsList ||
      kept?.shown === false ||
      paintedThread.current === routeThreadKey
    )
      return;
    // A frame after placed, visible history gives the browser a paint opportunity. Mount
    // alone is not visibility: the list hides while restoring its reading position.
    const frame = requestAnimationFrame(() => {
      paintedThread.current = routeThreadKey;
      mateDiagnostics.record({
        kind: "history-stage",
        environmentId: activeThreadEnvironmentId,
        threadId: routeThreadKey.startsWith(`${activeThreadEnvironmentId}:`)
          ? routeThreadKey.slice(activeThreadEnvironmentId.length + 1)
          : routeThreadKey,
        stage: "paint",
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [standing, showsList, kept?.shown, routeThreadKey, activeThreadEnvironmentId]);
  // The list's own scrolls are the page's moves: its initial scroll to the end re-applied after
  // the conversation was placed was read as a jump far up, and the conversation stopped following
  // its end mid-way.
  useLayoutEffect(() => {
    if (!showsList) return;
    const node = listRef.current?.getScrollableNode();
    return node ? ownListScrolls(node) : undefined;
  }, [listRef, showsList]);
  const rowsRef = useRef(rows);
  useLayoutEffect(() => {
    rowsRef.current = rows;
  });
  useLayoutEffect(() => {
    // A kept conversation still mounts/places while warming, but navigation
    // releases an already placed notice anchor before its hidden layout changes.
    if (!showsList || (!shown && listPlaced)) {
      if (!showsList) placingBeganRef.current = null;
      noticeResizeRef.current = null;
      if (noticeReadingPosition !== undefined) setNoticeReadingPosition(undefined);
      return;
    }
    if (!listReady) return;
    if (!listPlaced && placingBeganRef.current?.key !== routeThreadKey)
      placingBeganRef.current = { key: routeThreadKey, at: performance.now() };
    const placingBegan = placingBeganRef.current;
    const flowReading = () =>
      !listPlaced &&
      !flowReadRef.current &&
      placingBegan !== null &&
      performance.now() - placingBegan.at < TIMELINE_ROW_READ_DEADLINE_MS;
    const insetChanged = previousContentInsetEndAdjustmentRef.current !== contentInsetEndAdjustment;
    previousContentInsetEndAdjustmentRef.current = contentInsetEndAdjustment;
    if (followingEnd || anchoredEndSpace) {
      noticeResizeRef.current = null;
      if (noticeReadingPosition !== undefined) setNoticeReadingPosition(undefined);
    }
    const list = listRef.current;
    const viewport: HTMLElement | null = list?.getScrollableNode() ?? null;
    if (!list || !viewport) return;
    if (listPlaced && insetChanged && !followingEnd && !anchoredEndSpace) {
      if (noticeResizeRef.current === null) {
        const position = readTimelinePosition(routeThreadKey);
        noticeResizeRef.current = { position, scrollOffset: viewport.scrollTop };
        setNoticeReadingPosition(position);
      }
    }
    const noticeResize = listPlaced ? noticeResizeRef.current : null;
    if (listPlaced && noticeResize === null) return;
    const position =
      noticeResize?.position ?? (restoringReadingPosition ? rememberedPosition : undefined);
    let cancelled = false;
    let frame: number | null = null;
    let stableFrames = 0;
    const finish = () => {
      if (cancelled) return;
      cancelled = true;
      if (frame !== null) cancelAnimationFrame(frame);
      if (position !== undefined) setPositionRestored(true);
      // Placed at its end, the end is the follower's, and the list's initial scroll ends before
      // `initialScrollAtEnd` turns off: LegendList (3.3.5) keeps its bootstrap target and, as the
      // prop turns off, hands it to the scroll as its content offset — where the end stood
      // before a late picture grew it — and puts the view there, unheard; the follower then
      // glided the gap. An imperative scroll to the end it stands at drops that target.
      if (followingEndRef.current)
        void list.scrollToEnd({ animated: false, viewOffset: followRoomRef.current });
      setListPlaced(true);
    };
    // A reading position being put back hands the page to the person's
    // first gesture.
    const cancel = () => {
      finish();
      if (noticeResize !== null) {
        noticeResizeRef.current = null;
        setNoticeReadingPosition(undefined);
      }
    };
    const takeOver = () => {
      cancel();
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
    if (position !== undefined || noticeResize !== null) {
      viewport.addEventListener("wheel", takeOver, { passive: true });
      viewport.addEventListener("touchmove", takeOver, { passive: true });
      viewport.addEventListener("pointerdown", takeOver, { passive: true });
      // Keyboard activation opens content through a click without a pointer gesture.
      viewport.addEventListener("click", takeOver, { capture: true });
      viewport.ownerDocument.addEventListener("keydown", onScrollKey);
      if (noticeResize === null) onManualNavigation();
      if (cancelPositionRestoreRef) cancelPositionRestoreRef.current = cancel;
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
      const fallback =
        noticeResize === null ? end : Math.max(0, Math.min(noticeResize.scrollOffset, end));
      if (position === undefined) return fallback;
      const target = resolveTimelineRestoreTarget({
        position,
        rowIds: rowsRef.current.map((row) => row.id),
        heightOf: (rowId) => rowElement(rowId)?.getBoundingClientRect().height,
      });
      if (target.kind === "end") return fallback;
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
    const placingSince = performance.now();
    const tick = () => {
      frame = null;
      if (cancelled) return;
      const target = aim();
      const judged = judgeTimelinePlacing(
        {
          listReady,
          offBy: target === null ? null : viewport.scrollTop - target,
          elapsedMs: performance.now() - placingSince,
          rowsReading: rowReads.reading() || flowReading(),
          rowsSettling: rowReads.settling(),
        },
        stableFrames,
      );
      stableFrames = judged.stableFrames;
      if (judged.verdict === "placed") {
        if (noticeResize === null) finish();
        return;
      }
      if ((judged.verdict === "correct" || judged.verdict === "settle") && target !== null) {
        scrollOwn(viewport, target);
        // Hidden until the rows' late measurements stop moving it (LegendList places rows a
        // frame late), so the first frame shown is the settled one; a Mate streaming its answer
        // moves the end every frame, so past the deadline it shows where it now stands.
        if (judged.verdict === "settle" && noticeResize === null) {
          finish();
          return;
        }
      }
      // A missing DOM row waits for measurement rather than spinning.
      if (noticeResize === null || target !== null) frame = requestAnimationFrame(tick);
    };
    const remeasure = () => {
      stableFrames = 0;
      if (!cancelled && frame === null) frame = requestAnimationFrame(tick);
    };
    if (noticeResize !== null) remeasurePositionRef.current = remeasure;
    tick();
    return () => {
      cancelled = true;
      if (frame !== null) cancelAnimationFrame(frame);
      if (remeasurePositionRef.current === remeasure) remeasurePositionRef.current = null;
      if (position === undefined && noticeResize === null) return;
      if (cancelPositionRestoreRef?.current === cancel) cancelPositionRestoreRef.current = null;
      viewport.removeEventListener("wheel", takeOver);
      viewport.removeEventListener("touchmove", takeOver);
      viewport.removeEventListener("pointerdown", takeOver);
      viewport.removeEventListener("click", takeOver, { capture: true });
      viewport.ownerDocument.removeEventListener("keydown", onScrollKey);
    };
  }, [
    anchoredEndSpace,
    contentInsetEndAdjustment,
    followingEnd,
    noticeReadingPosition,
    routeThreadKey,
    cancelPositionRestoreRef,
    listPlaced,
    listReady,
    listRef,
    onManualNavigation,
    rememberedPosition,
    restoringReadingPosition,
    shown,
    showsList,
  ]);
  useLayoutEffect(() => {
    remeasurePositionRef.current?.();
  }, [rows]);
  const content = !showsList ? (
    hideEmptyPlaceholder ? (
      <div
        className="relative h-full min-h-0"
        data-timeline-loading="true"
        data-timeline-thread={routeThreadKey}
      />
    ) : crew === null ? (
      <TimelineEmptyState
        environmentId={activeThreadEnvironmentId}
        threadKey={routeThreadKey}
        bottomInset={contentInsetEndAdjustment}
        standUpStopped={standUpStopped}
      />
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
      <NewestReleaseAskContext value={newestReleaseAsk}>
        <TimelineNoticesCtx value={noticesById}>
          <TimelineRowActivityCtx value={activityState}>
            <TimelineWorkingCtx value={working}>
              {/* A failed notice is said once here, outside the list that remounts its rows. */}
              <NoticeAnnouncer notices={notices} />
              <TooltipScrollDismissArea
                ref={setTimelineViewportElement}
                className="relative h-full min-h-0"
                // Whether the list follows its end: a run's fold then keeps its
                // line in place while the list catches up (`foldAway`).
                data-timeline-follows-end={followingEnd ? "" : undefined}
                // Rows waiting their turn to enter (`usePace`): a run's fold waits for them.
                data-timeline-arriving={rowsHeldKey === "" ? undefined : ""}
                data-timeline-placing={listPlaced ? undefined : ""}
                // Placement proves readiness; the opening stage owns the conversation's entrance.
                data-timeline-arrives="at-once"
                // Its own draft's frame showed these rows: they show again in place, not eased in.
                data-timeline-from-draft={keepsDraftMessage ? "" : undefined}
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
                  // Bootstrap ends at placement: keeping it armed re-pins new rows before their glide.
                  initialScrollAtEnd={!listPlaced && rememberedPosition?.atEnd !== false}
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
                    restoringReadingPosition || followingEnd
                      ? false
                      : MAINTAIN_VISIBLE_CONTENT_POSITION
                  }
                  onScroll={handleScroll}
                  onLoad={onListLoad}
                  {...(draftRows.length > 0 ? { style: { visibility: "hidden" as const } } : {})}
                  className={cn(
                    "timeline-legend-list scrollbar-gutter-both max-sm:scrollbar-none h-full min-h-0 overflow-x-hidden overscroll-y-contain px-3 [overflow-anchor:none] sm:px-5",
                    topFadeEnabled && "conversation-scroll-fade",
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
                  ListFooterComponent={
                    askRoom > 0 ? (
                      <>
                        {pauseStageId === null ? TIMELINE_LIST_FOOTER : null}
                        <div aria-hidden style={{ height: askRoom }} />
                      </>
                    ) : pauseStageId === null ? (
                      TIMELINE_LIST_FOOTER
                    ) : null
                  }
                />
                {draftRows.length > 0 ? (
                  <TimelineDraftRows rows={draftRows} renderItem={renderItem} />
                ) : null}
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
        </TimelineNoticesCtx>
      </NewestReleaseAskContext>
    </TimelineRowCtx>
  );
  return (
    <>
      <ConversationOpeningWaits
        as="div"
        whole
        className="h-full min-h-0"
        data-conversation-content=""
      >
        <TimelineRowReadsCtx value={rowReads}>{content}</TimelineRowReadsCtx>
      </ConversationOpeningWaits>
      {/* Its live card's head, read as painted before a commit that changes its rows. */}
      <AsPainted of={rows} />
      {kept?.shown === false || pauseStageId !== null || keepsDraftMessage ? null : (
        <ConversationOpeningStage
          ready={filled}
          readPending={onItsWay}
          name={openingName}
          mate={mate ?? null}
          threadKey={routeThreadKey}
          activity={openingActivity}
          timestampFormat={timestampFormat}
        />
      )}
    </>
  );
});

// ---------------------------------------------------------------------------
// TimelineRowContent — the actual row component
// ---------------------------------------------------------------------------

type TimelineRow = MessagesTimelineRow;

/**
 * The room a row keeps above itself (see `rowGap`), so the ink stands where
 * the rhythm says: a part 24 px under the person's bubble or the card's
 * edge, a turn 64 px under them. The answer's prose adds its own: 3 px of
 * leading above its first line (21 + 3), and under its last line 3 px of
 * leading and its 28 px copy line (33 + 31). A phone's screen is a third of a desk's tall: a turn
 * opens under 48 px there, twice a part's room still, and a seam right under a seam (a day nobody
 * spoke on) under a part's, so a week of silence is a few lines and not a screen of nothing.
 */
const GAP_CLASS: Record<RowGap, string> = {
  none: "",
  tight: "pt-1",
  line: "pt-3",
  block: "pt-5",
  part: "pt-6",
  "part-words": "pt-5.25",
  turn: "pt-12 sm:pt-16",
  "turn-after-words": "pt-4.25 sm:pt-8.25",
  "turn-seam": "pt-6 sm:pt-16",
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
    (row.kind === "crew-seam" && !isRestartRow(row)) ||
    row.kind === "after-work" ||
    // Another Mate's message and the wait for its answer are cards, edge to edge with the run's.
    row.kind === "mate-message" ||
    row.kind === "mate-wait"
  ) {
    return "";
  }
  // A line with no card keeps the card's geometry in a frame nobody sees, so
  // opening it draws the card around the line without moving it.
  if (row.kind === "work-line") return "run-tray-ghost";
  // The composer's text edge: 13 px inside its frame on a phone, 17 from sm up.
  return "px-3.25 sm:px-4.25";
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
 * Whether a row, joining the conversation in sight, enters by opening its room: a row of the
 * project's flow (a change landing, a release ending), read from HQ apart from the conversation,
 * and the seam it brings with it (a new day, a quiet hour).
 */
function opensRoom(row: TimelineRow): boolean {
  if (row.kind === "event") return row.event.type === "landed" || row.event.type === "release";
  return row.kind === "seam" && row.flow === true;
}

/**
 * How soon after joining the conversation in sight a row is drawn to open its room: the list draws
 * a row it adds within a frame or two; one drawn later — scrolled to — stands where it is.
 */
const ROOM_OPENS_WITHIN_MS = 250;

/**
 * Whether a row is a message that arrived while the person watched, and has
 * not risen in yet: the person's words from their side, the Mate's up from
 * just below. What the conversation opened onto is simply there.
 */
export function messageEnters(row: TimelineRow, arrivedAfter: number | null): boolean {
  if (arrivedAfter === null || row.kind !== "message") return false;
  if (enteredMessages.has(row.id)) return false;
  // Words the person read in the run's slot land from there: they are not new.
  if (wordsJustStood(row.message.id)) return false;
  return Date.parse(row.createdAt) > arrivedAfter;
}

const TimelineRowContent = memo(function TimelineRowContent({ row }: { row: TimelineRow }) {
  const gap = GAP_CLASS[row.gap ?? "none"];
  const card = row.card;
  const content = <TimelineRowBody row={row} />;
  const { arrivedAfter, standUpAsk, rooms } = use(TimelineRowCtx);
  const [entering] = useState(() => messageEnters(row, arrivedAfter));
  const [roomOpens] = useState(() => opensRoom(row) && rooms?.joinedInSight(row.id) === true);
  // Landed from the run's slot, it never rose in: drawn again, it still has arrived.
  const [landed] = useState(
    () => row.kind === "message" && !entering && wordsJustStood(row.message.id),
  );
  useEffect(() => {
    if (!entering && !landed) return;
    // The oldest goes first: clearing them all would let every message of
    // the open conversation newer than its opening rise in again.
    if (enteredMessages.size >= 500) {
      const oldest = enteredMessages.values().next();
      if (!oldest.done) enteredMessages.delete(oldest.value);
    }
    enteredMessages.add(row.id);
  }, [entering, landed, row.id]);
  const person =
    row.kind === "message" && row.message.role === "user" && !isStandUpAskRow(row, standUpAsk);
  const ref = useRef<HTMLDivElement>(null);
  const held = useHeldBehindComposer(ref, entering && person);
  // Such a row joining the conversation in sight opens its room from nothing, gap and all, on the
  // travel's curve (`easeRooms`): what stands under it, or the list following its end, moves with
  // it, never a step.
  const roomRef = useRef<HTMLDivElement>(null);
  const rowId = row.id;
  useLayoutEffect(() => {
    const room = roomRef.current;
    if (!roomOpens || room === null) return;
    rooms?.opened(rowId);
    // Once open it hears nothing more: its observers go.
    let stopOnceOpen: (() => void) | null = null;
    const eased = easeRooms({
      root: room,
      selector: ":not(*)",
      eases: () => true,
      rootClips: true,
      grows: () => true,
      afterStep: () => stopOnceOpen?.(),
    });
    stopOnceOpen = () => {
      if (!eased.easing()) eased.stop();
    };
    eased.easeFrom(room, 0);
    stopOnceOpen();
    return () => eased.stop();
  }, [roomOpens, rooms, rowId]);
  // Its entrance plays once: the list moves a row among its siblings by putting it back in the
  // page, which plays a running entrance again (recheck on 0.15.44: every answer rose in twice).
  const [entered, setEntered] = useState(false);
  const drawn = (
    <div
      ref={ref}
      className={cn(
        card === undefined || card === "top" ? gap : null,
        card === undefined ? rowInset(row) : null,
        row.kind === "message" && row.message.role === "assistant" ? "group/assistant" : null,
        held
          ? "opacity-0"
          : entering &&
              !entered &&
              (person
                ? "origin-bottom-right animate-bubble-in motion-reduce:animate-none"
                : "animate-rise-in motion-reduce:animate-none"),
      )}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget) setEntered(true);
      }}
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
  // Its room holds the row's gap too: a gap is padding, which a height of nothing keeps.
  return roomOpens ? <div ref={roomRef}>{drawn}</div> : drawn;
});

/** The longest a sent message waits out of sight for the list to bring it above the composer. */
const HELD_BEHIND_COMPOSER_MS = 600;

/**
 * Whether a message the person just sent is still held out of sight: the list adds it at its end,
 * under the composer, and glides it up; it is drawn once it stands clear of the composer, never
 * peeking out from behind it (Milo's stress run 4: born 62 px behind the composer for two frames).
 */
function useHeldBehindComposer(
  ref: React.RefObject<HTMLDivElement | null>,
  enters: boolean,
): boolean {
  const [held, setHeld] = useState(enters);
  useLayoutEffect(() => {
    if (!held) return;
    const started = performance.now();
    let frame = 0;
    const clear = () => {
      const node = ref.current;
      const composer = document.querySelector('[data-slot="composer-shell"]');
      if (node === null || composer === null) return true;
      const box = node.getBoundingClientRect();
      const viewport = node.closest("[data-timeline-thread]")?.getBoundingClientRect();
      return (
        box.bottom <= composer.getBoundingClientRect().top + 1 &&
        (viewport === undefined || box.bottom > viewport.top)
      );
    };
    const check = () => {
      if (clear() || performance.now() - started > HELD_BEHIND_COMPOSER_MS) setHeld(false);
      else frame = requestAnimationFrame(check);
    };
    check();
    return () => cancelAnimationFrame(frame);
  }, [held, ref]);
  return held;
}

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
      {row.kind === "notice" ? <NoticeTimelineRow row={row} /> : null}
      {row.kind === "crew-card" ? <CrewCardTimelineRow row={row} /> : null}
      {/* A task opens its conversation as its card; what is said of it after its Mate took it
          follows as its authors'. Its brief draws no row. */}
      {row.kind === "task-ask" ? (
        <TaskCardTimelineRow source={row.source} taskId={row.taskId} text={row.text} />
      ) : null}
      {row.kind === "task-message" ? <MateTaskMessageRow message={row.message} /> : null}
      {/* Another Mate's message opens the run it started as that Mate's; while this Mate waits for
          an answer to its own, the conversation's end says whose. */}
      {row.kind === "mate-message" ? (
        <MateMessageRow
          item={row.item}
          markdownCwd={ctx.markdownCwd}
          skills={ctx.skills}
          text={row.text}
          threadRef={ctx.threadRef ?? undefined}
        />
      ) : null}
      {row.kind === "mate-wait" ? <MateAnswerWait awaited={row.awaited} /> : null}
      {row.kind === "background" ? <BackgroundTimelineRow row={row} /> : null}
      {row.kind === "error" ? <ErrorTimelineRow row={row} /> : null}
      {row.kind === "pause" ? <PauseTimelineRow row={row} /> : null}
      {row.kind === "outcome" ? <OutcomeTimelineRow row={row} /> : null}
      {row.kind === "page" ? <PageTimelineRow row={row} /> : null}
      {row.kind === "vault-request" ? <VaultRequestTimelineRow row={row} /> : null}
      {row.kind === "origin-request" ? <OriginRequestTimelineRow row={row} /> : null}
      {row.kind === "mirror-request" ? <MirrorRequestTimelineRow row={row} /> : null}
      {row.kind === "proposal" ? <ProposalTimelineRow row={row} /> : null}
      {row.kind === "seam" ? <SeamTimelineRow row={row} /> : null}
      {row.kind === "crew-seam" ? (
        <CrewSeamActivity asEvent seam={row.seam} words={row.words} />
      ) : null}
      {row.kind === "proposed-plan" ? <ProposedPlanTimelineRow row={row} /> : null}
      {row.kind === "queued-message" ? <QueuedMessageTimelineRow row={row} /> : null}
    </>
  );
}

/**
 * Turns whose Mate at work this page watched live: their report arrives as
 * the panel settles into it, once. A report scrolled back into view, or read
 * after a reload, is simply there.
 */
const watchedTurnKeys = new Set<string>();

/** What runs alongside the Mate, under its record. */
function WorkingTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "working" }> }) {
  const ctx = use(TimelineRowCtx);
  const dock = use(TimelineWorkingCtx);
  useEffect(() => {
    watchedTurnKeys.add(row.turnKey);
  }, [row.turnKey]);
  const standRef = usePanelStand(row.turnKey, row.cardKey);
  const { cardKey } = row;
  const carry = useCallback(() => cardRowsCarried(standRef.current, cardKey), [standRef, cardKey]);
  // The card's line it lent room to: taken back when the room closes, and when this row leaves
  // mid-close — a run that settled as its panel closed kept the room as an empty band of card
  // at its foot, under the composer (the owner, 0.15.44, a stopped run's two helpers).
  const lentRef = useRef<HTMLElement | null>(null);
  const onRoom = useCallback(
    (room: number | null) => {
      lentRef.current = holdCardRoom(standRef.current, cardKey, room) ?? lentRef.current;
      if (room === null || room < 0.5) {
        lentRef.current?.style.removeProperty("--card-room");
        lentRef.current = null;
      }
    },
    [standRef, cardKey],
  );
  useEffect(
    () => () => {
      lentRef.current?.style.removeProperty("--card-room");
      lentRef.current = null;
    },
    [],
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
      />
    </div>
  );
}

/**
 * The room a live card's panel holds while it closes (`ConversationWorking`),
 * on the card's line: drawn whole by that row (`[data-card-whole]`), the card
 * reaches over it (`--card-room`).
 */
function holdCardRoom(
  from: HTMLElement | null,
  cardKey: string,
  room: number | null,
): HTMLElement | null {
  const list = from?.closest<HTMLElement>(".timeline-legend-list") ?? null;
  const line = list?.querySelector<HTMLElement>(
    `[data-timeline-row-id="${CSS.escape(`record:${cardKey}`)}"] > .run-tray`,
  );
  if (line === null || line === undefined) return null;
  if (room === null || room < 0.5) {
    line.style.removeProperty("--card-room");
    return null;
  }
  line.style.setProperty("--card-room", `${room}px`);
  return line;
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
  // A turn landing under its held head keeps its place: the card's edge comes up.
  if (
    own.closest("[data-timeline-follows-end]") !== null &&
    !list.hasAttribute("data-timeline-holds-head")
  ) {
    return [
      ...(line === null ? [] : [{ row: line, direction: 1 as const }]),
      { row: own, direction: 1 },
      ...(edge === null ? [] : [{ row: edge, direction: 0 as const }]),
    ];
  }
  return edge === null ? [] : [{ row: edge, direction: -1 }];
}

function PauseTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "pause" }> }) {
  const ctx = use(TimelineRowCtx);
  const ref = useRef<HTMLDivElement>(null);
  const settledHeight = useRef<number | null>(null);
  const shownPhase = useRef<string | null>(null);
  // What the notice says changes when the pause lifts (Continue goes, the line goes quiet): its
  // height glides to the new one rather than cutting, so nothing around it jumps.
  const phase = `${row.resumedAt !== null}:${row.id === ctx.livePauseId ? ctx.limit?.kind : "none"}`;
  useLayoutEffect(() => {
    const node = ref.current;
    if (node === null) return;
    const observer = new ResizeObserver(() => {
      if (node.getAnimations().length === 0)
        settledHeight.current = node.getBoundingClientRect().height;
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const node = ref.current;
    const before = shownPhase.current;
    shownPhase.current = phase;
    if (node === null || before === null || before === phase) return;
    // A glide still running is taken up where it stands: the lift can change the notice twice.
    const running = node.getAnimations();
    const from = running.length > 0 ? node.getBoundingClientRect().height : settledHeight.current;
    for (const glide of running) glide.cancel();
    const to = node.getBoundingClientRect().height;
    settledHeight.current = to;
    if (from === null || Math.abs(from - to) < 1 || reducedMotion()) return;
    node.style.overflow = "clip";
    const glide = node.animate([{ height: `${from}px` }, { height: `${to}px` }], {
      duration: 220,
      easing: "cubic-bezier(0.23, 1, 0.32, 1)",
    });
    glide.onfinish = () => {
      node.style.overflow = "";
    };
  }, [phase]);
  return (
    <div
      ref={ref}
      style={row.id === ctx.pauseStage?.id ? { height: ctx.pauseStage.height } : undefined}
    >
      <PauseBlock
        stage={row.id === ctx.pauseStage?.id}
        mate={ctx.pauseStage?.mate ?? null}
        nowMs={Date.now()}
        onContinue={row.id === ctx.livePauseId ? (ctx.onUsageContinue ?? null) : null}
        triesBeforeReset={ctx.usageContinueTries === true}
        limit={row.id === ctx.livePauseId ? (ctx.limit ?? NO_MATE_LIMIT) : NO_MATE_LIMIT}
        blockedByAnswer={row.id === ctx.livePauseId && ctx.queueBlockedByAnswer === true}
        row={row}
        serverPause={row.id === ctx.livePauseId ? ctx.usagePause : null}
        speaker={ctx.speaker}
        timestampFormat={ctx.timestampFormat}
      />
    </div>
  );
}

function OutcomeTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "outcome" }> }) {
  const ctx = use(TimelineRowCtx);
  const [settling] = useState(() => watchedTurnKeys.delete(row.outcome.turnKey));
  const markerRef = useRef<HTMLDivElement>(null);
  const roomsRef = useRef<Rooms | null>(null);
  const turnKey = row.outcome.turnKey;
  // The panel it replaces stood here a moment ago: the report's band of the
  // card starts at the panel's height and eases to its own.
  useLayoutEffect(() => {
    const band = markerRef.current?.parentElement;
    if (!band) return;
    const rooms = easeRooms({
      root: band,
      selector: ":not(*)",
      eases: () => true,
      rootClips: true,
    });
    roomsRef.current = rooms;
    const stand = takePanelStand(turnKey);
    if (stand !== null) rooms.easeFrom(band, stand.panel);
    // Its panel already folded into the Mate's last word: the report came
    // after. Natural growth, including a handoff from zero, takes its full height.
    else if (panelLeftRecently(turnKey)) rooms.easeFrom(band, 0);
    return () => {
      rooms.stop();
      roomsRef.current = null;
    };
  }, [turnKey]);
  // Hear content changes before the outer list measures this commit.
  useLayoutEffect(() => roomsRef.current?.flush());
  return (
    // The result stands under the worked line, inside the tray (T5): a
    // hairline, then its rows in the card's grid; nothing at all when the run
    // left none.
    <div ref={markerRef} className="run-band">
      <TurnReport onOpenImage={ctx.onImageExpand} outcome={row.outcome} settling={settling} />
    </div>
  );
}

/** How long the words of an answer travel from where they were read to where they land. */
const WORDS_LAND_MS = 220;
/** How long a card's head is held at least: its fold starts once the list has laid it out. */
const HEAD_HOLD_MS = 300;
/** How long the view takes to the end with an answer that landed under a held head. */
const HEAD_GLIDE_MS = 300;
/** How many frames a held head's card stands at one height before the view sets off. */
const CARD_STILL_FRAMES = 2;

/** How long a long answer takes to unroll upward from where its card stood. */
const ANSWER_UNROLL_MS = 320;
/** Less than this to unroll, it stands at its height at once. */
const UNROLL_FROM_PX = 24;
/** How long an answer is held where its words were read: its card folds, its row is measured. */
const ANSWER_HOLD_MS = 1200;
/** The room under the end while it is held: more than its card's foot and its own meta line. */
const ANSWER_ROOM_PX = 120;

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
