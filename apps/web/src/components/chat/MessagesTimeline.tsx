import { mateDiagnostics } from "@t3tools/client-runtime/zerops/diagnostics";
import { NO_MATE_LIMIT, type MateLimit } from "@t3tools/client-runtime/data";
import { deriveTimelineMinimapItems } from "./timelineMinimapItems";
import { selectedTimelineRowSpan, useSelectedTimelineRowIds } from "./useSelectedTimelineRows";
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
import { type TimelineScrollDirection } from "@t3tools/client-runtime/zerops/timelineFollow";
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
import { ownListScrolls } from "./timelineEndFollow";
import { AsPainted } from "./AsPainted";
import { TimelineLoadEarlierHeader } from "./TimelineLoadEarlierHeader";
import { TimelineMinimap } from "./TimelineMinimap";
import { opensRoom, TimelineRowContent } from "./TimelineRowFrame";
import { TimelineEmptyState } from "./TimelineEmptyState";
import { TimelineDraftRows } from "./TimelineDraftRows";
import { getItemType } from "./timelineRowGeometry";
import { keyExtractor } from "./timelineRowKey";
import { usePace } from "./usePace";
import { useTimelineMotion } from "./useTimelineMotion";
import { useAnswerLanding } from "./useAnswerLanding";
import { useTimelineGrowth } from "./useTimelineGrowth";
import { useTimelineScrollReading } from "./useTimelineScrollReading";
import { useTimelinePlacing } from "./useTimelinePlacing";
import { LegendList, type LegendListRef } from "@legendapp/list/react";
import { deriveTimelineEntries } from "../../session-logic";
import { type QueuedComposerMessage } from "../../queuedMessageStore";
import { ExpandedImagePreview } from "./ExpandedImagePreview";
import { type RememberedTimelinePosition, readTimelinePosition } from "./timelineScrollAnchoring";
import {
  createMessagesTimelineRowsCache,
  conversationSpeaker,
  deriveMessagesTimelineRows,
  livePauseId,
  livePauseStageId,
  helperFinishesOf,
  resolveTimelineMinimapHasPersistentGutter,
  resolveTimelineMinimapHitStripWidth,
  type MessagesTimelineRow,
  type TimelineLatestTurn,
  type MateAway,
} from "./MessagesTimeline.logic";
import type { ThreadEndNotice } from "./threadErrorNotice.logic";
import { TooltipScrollDismissArea } from "../ui/tooltip";
import { prefersReducedMotion } from "~/lib/reducedMotion";
import { cn } from "~/lib/utils";
import { useZeropsMate } from "~/zerops/useZeropsMates";
import { mateMentionMatcher, useMentionableMates } from "~/zerops/mateMentions";
import { mateStandUpStopped } from "~/zerops/mateStandUp";
import { useMateStandUpAskLine } from "~/zerops/useMateStandUp";
import { useEngineLiveStructure } from "./useEngineLiveMessage";
import { useEngineCardSnapshots, useEngineRunCards } from "./useEngineCardPaging";
import { type TimestampFormat } from "@t3tools/contracts/settings";

import { dockDraws } from "./ConversationWorking";
import { useEndingsHeld } from "./useEndingsHeld";
import { useTimelineNewSince } from "./useTimelineNewSince";
import { useLastWordsClock } from "./useLastWordsClock";
import { useTimelineProposals } from "./useTimelineProposals";
import { useEarlierTurnsAnchor } from "./useEarlierTurnsAnchor";
import { useOpenedIntoView } from "./useOpenedIntoView";
import { useRememberPosition } from "./useRememberPosition";
import { useAskRoom } from "./useAskRoom";
import { useStableRows } from "./useStableRows";
import { forgetRunFolds } from "./runCard.logic";
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
  type ServerUsagePause,
} from "./ConversationRows";
import { CrewTimelineContext } from "../zerops/crew/CrewTaskCard";
import { CrewmateEmptyState } from "../zerops/crew/CrewmateEmptyState";
import { NewestReleaseAskContext } from "../zerops/proposal/ProposalCardContainer";
import { type MirrorAskPlace } from "../zerops/mirror/mirrorAsk.logic";
import { type OriginAskPlace } from "../zerops/origin/originAsk.logic";
import { type TimelinePersonInput, useTimelinePersonInput } from "./useTimelinePersonInput";

/** The rows above keep their place as rows arrive and change size under them. */
const MAINTAIN_VISIBLE_CONTENT_POSITION = { data: true, size: true } as const;

const TIMELINE_LIST_HEADER = <div className="h-3 sm:h-4" />;
const TIMELINE_LIST_FADE_HEADER = <div className="h-10 sm:h-12" />;

const TIMELINE_LIST_FOOTER = <div className="h-3 sm:h-4" />;
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

  // The ask's room as the list has it: it opens at once and stays, once answered, until the
  // conversation has come back out of it (`useAskRoom`).
  // Room under the end while a landed answer is held where its words were read (`onAnswerLands`):
  // the card folding above it and its row settling are taken up by the scroll, never by the list
  // clamping at its end — with nothing under the answer, the end was a few pixels short of where
  // it was read, and everything that moved it then showed.
  const [landingRoom, setLandingRoom] = useState(0);
  const askRoom = useAskRoom(askRoomEnd + landingRoom, listRef);
  const noticeResizeRef = useRef<{
    position: RememberedTimelinePosition | undefined;
    scrollOffset: number;
  } | null>(null);
  const [noticeReadingPosition, setNoticeReadingPosition] = useState<RememberedTimelinePosition>();

  // A list the pane keeps (`KeptTimelines`): out of sight while the person
  // is elsewhere, shown again when they come back.
  const kept = use(KeptTimelineContext);
  const newSince = useTimelineNewSince(routeThreadKey, latestTurn, kept?.shown ?? true);
  const nowMs = useLastWordsClock(timelineEntries, isWorking);
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
  const newestReleaseAsk = useTimelineProposals(stableRows);

  const onLoadEarlier = useEarlierTurnsAnchor(listRef, rows, loadEarlier);

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
  // Selected rows stay drawn, so a selection dragged past the draw buffer keeps its ends.
  const selectedRowIds = useSelectedTimelineRowIds(timelineViewportElement);
  const alwaysRender = useMemo(() => {
    const selected = selectedTimelineRowSpan(rows, selectedRowIds);
    if (selected.length === 0) return restoringAlwaysRender;
    return { indices: [...(restoringAlwaysRender?.indices ?? []), ...selected] };
  }, [restoringAlwaysRender, rows, selectedRowIds]);
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
  const motion = useTimelineMotion({
    listRef,
    askRoom,
    askRoomEnd,
    listPlaced,
    followingEnd,
    rowsHeldKey,
    contentInsetEndAdjustment,
  });
  const { followRoomRef, followingEndRef, outerFoldsRef } = motion;
  const { holdAnswer, onTurnLands, onAnswerLands, onFoldWork } = useAnswerLanding({
    listRef,
    motion,
    setLandingRoom,
    askRoom,
    rows,
  });
  const { rowOrder, onItemSizeChanged } = useTimelineGrowth({
    listRef,
    motion,
    holdAnswer,
    rows,
    followingEnd,
    listPlaced,
    askRoom,
    contentInsetEndAdjustment,
    timelineViewportElement,
    measuredRowsRef,
  });

  const rememberPosition = useRememberPosition(
    listRef,
    rows,
    routeThreadKey,
    noticeResizeRef,
    restoringReadingPosition,
    listPlaced,
    listReady,
  );

  const person = useTimelinePersonInput({
    rows,
    onManualNavigation,
    listRef,
    onPersonInput,
    timelineViewportElement,
  });
  const { notePersonSession } = person;

  useOpenedIntoView(
    timelineViewportElement,
    listRef,
    contentInsetEndAdjustment,
    followRoomRef,
    outerFoldsRef,
    followingEndRef,
  );

  const handleScroll = useTimelineScrollReading({
    listRef,
    motion,
    person,
    restoringReadingPosition,
    rows,
    rememberPosition,
    onIsAtEndChange,
    minimapItems,
    minimapStripMap,
    setMinimapCurrentIndex,
  });

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
  useTimelinePlacing({
    rows,
    showsList,
    shown,
    listPlaced,
    setListPlaced,
    listReady,
    noticeResizeRef,
    noticeReadingPosition,
    setNoticeReadingPosition,
    routeThreadKey,
    flowRead,
    contentInsetEndAdjustment,
    followingEnd,
    anchoredEndSpace,
    listRef,
    restoringReadingPosition,
    rememberedPosition,
    setPositionRestored,
    motion,
    onManualNavigation,
    cancelPositionRestoreRef,
    rowReads,
  });
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
                  {...(alwaysRender ? { alwaysRender } : {})}
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
                      animated: !prefersReducedMotion(),
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

/**
 * How soon after joining the conversation in sight a row is drawn to open its room: the list draws
 * a row it adds within a frame or two; one drawn later — scrolled to — stands where it is.
 */
const ROOM_OPENS_WITHIN_MS = 250;
