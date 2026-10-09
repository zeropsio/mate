/**
 * A run's card, as a chat (the owner, 2026-09-27: "have the whole thing look
 * like a chat, treat it like my messages … different font style / bubble
 * color / special components depending on what kind of call it is").
 *
 * The card is a quiet tray with one grid (K1, K11): a 28 px column of marks,
 * the words one column in, times and actions on one right edge. Its foot is
 * the now line (K10): the Mate's face, what it is doing this moment in words
 * — the step itself while it runs — and the run's one clock (K3); once the
 * run is over, the worked line. Above it, everything the Mate said and did
 * stands in the order it happened, in five weights that cannot be mistaken
 * for one another (K14):
 * - what it said to the person, and what the person said: 14 px bubbles, its
 *   words in its tint (K13), theirs in their own neutral bubble, a question
 *   and its answer a pair;
 * - what it did: compact 13 px rows in a light outline, a run of calls one
 *   card with hairlines between, a command titled by its words or, with none,
 *   by the command itself (K4);
 * - what it thought: the quietest, 13 px faint italics, two lines of it.
 * What went wrong wears a red mark while it is still broken, and turns quiet
 * once a later step undid it — never a pink row (K9); what merely happened (a
 * context condensed, a change landed) a caption between hairlines.
 *
 * Closed, the card is its summary line: who worked, for how long, what the
 * effort came to, and "Show work". Open — while the run goes on, and once
 * the person asks for the work — it is one scroll holding everything the run
 * said and did (the owner, 2026-09-29: "when open with scroll and all events
 * and when close just the summary -> expand open the scroll with
 * everything"). The scroll follows the newest line while it stands at its
 * foot, and stays where the person scrolled to once they leave it; a long
 * run's earlier lines are drawn as the person scrolls up to them. Inside it
 * nothing is cut without a way to the rest (D4): a command at four lines and
 * what it printed at twelve behind "Show all N lines", a thought behind a
 * click, a long message of the Mate's behind "Show full message" — each
 * opening in place, under the line the person clicked, which stays where it
 * is. Nothing opens a dialog.
 */
import { AssetImage } from "~/assets/AssetImage";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import {
  isActiveSubagentStatus,
  type RuntimeSubagent,
} from "@t3tools/client-runtime/state/subagentRuntime";
import {
  ActivityIcon,
  AppWindowIcon,
  AsteriskIcon,
  BotIcon,
  ChevronDownIcon,
  FilePenLineIcon,
  FileTextIcon,
  GlobeIcon,
  ImageIcon,
  ListTodoIcon,
  OctagonAlertIcon,
  SearchIcon,
  SquareTerminalIcon,
  TriangleAlertIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react";
import {
  createContext,
  Fragment,
  use,
  useCallback,
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from "react";
import { flushSync } from "react-dom";

import { afterLayout } from "~/lib/afterLayout";
import { cn } from "~/lib/utils";
import { MessageFilesAbove, useMessageFileUrls } from "./MessageFiles";
import { useMateBrowserCallFrames } from "../../zerops/browserStreamLinks";
import { frameImageSrc } from "@t3tools/client-runtime/zerops/browserStream";
import { FixAction } from "./FixAction";
import { useMateOfEnvironment } from "../../zerops/accountEnvironments";
import { RunShimmer } from "./RunShimmer";
import { CommandScript } from "./CommandScript";
import { FileWriteDetail } from "./FileWriteDetail";
import { stepWriteCalls } from "./fileWrites.logic";
import { useAssetUrls, useAssetUrlState } from "../../assets/assetUrls";
import {
  selectMessageImageResources,
  workEntryDisplayIndicatesToolFailure,
  type TurnPlanEntry,
  type WorkLogEntry,
} from "../../session-logic";
import type { ChatImageAttachment, ChatMessage, ChatAttachment } from "../../types";
import { echoOfMessage } from "./messagePictures.logic";
import ChatMarkdown from "../ChatMarkdown";
import { ChangeChipMomentContext } from "../zerops/ZeropsChangeLinkChip";
import { CrewSeamActivity } from "../zerops/crew/CrewTaskCard";
import { KindGlyph, readsPipeline, ZeropsOperationCard } from "../zerops/ZeropsOperationCard";
import { MateFace } from "../zerops/primitives";
import { useChangedSinceShown } from "~/hooks/useChangedSinceShown";
import {
  devServerUrlFor,
  useOperationCard,
  type OperationCardRegions,
} from "../../zerops/activity/useOperationCard";
import { useZeropsTopology } from "../../zerops/useZeropsFeeds";
import { helpersBubbleOf } from "./helpersBubble.logic";
import { BrowserStrip, BrowserTakes } from "./BrowserStrip";
import {
  browserCheckCaption,
  browserTakeState,
  formatWorkDuration,
  operationLineWords,
  operationUnreturnedWords,
  type BrokeOff,
  type BrowserStripModel,
  type IncidentModel,
  type OutcomeModel,
} from "./conversation.logic";
import { Button } from "../ui/button";
import { restartWords } from "../../zerops/restartWords";
import { calmClockMs } from "./nowLineCalm.logic";
import { keepInPlace, scrollerOf } from "./keepInPlace";
import { useCalmLine } from "./useCalmLine";
import {
  SLOT_MAX_ROWS,
  slotClock,
  slotHoldsIn,
  slotRunningPast,
  type LiveSlot as LiveSlotState,
} from "./liveSlot.logic";
import { useLiveSlot } from "./useLiveSlot";
import { foldWork } from "./foldWork";
import { usePace } from "./usePace";
import { KeptTimelineContext } from "./keptTimelineContext";
import { type DrawnRow, landingHosts, rowShifts, slotMoves } from "./slotMoves.logic";
import { resultPictures as allResultPictures, stripShowsFiles } from "./runResult.logic";
import { useStripFiles } from "./resultStripFiles";
import {
  backgroundItemWord,
  reportsInline,
  type BackgroundLineModel,
} from "./backgroundLine.logic";
import { useRunEffortWords } from "./runResultFacts";
import { pageReached, type ScrollPages } from "~/zerops/engineCardPaging.logic";
import { useEngineCardPages } from "~/zerops/useEngineCardPaging";
import {
  type EaseBudget,
  ROOM_TAU_MS,
  approach,
  glideStep,
  keepsFoot,
  movesAsPerson,
} from "./runMotion.logic";
import { easeRooms, forgetScrollTop, noteScrollTop, type Rooms, unclamp } from "./runRoom";
import { followScrollTo } from "~/lib/followScroll";
import { StatusBar } from "./StatusBar";
import { versionText } from "../zerops/operation/version";
import { ImportDetail } from "./ImportDetail";
import { useStandupReading } from "../../zerops/activity/useStandupReading";
import {
  cardOperationOf,
  detailLines,
  liveOperationBar,
  observedLinesOf,
  settledOperationBar,
  showsCardInSlot,
  slotOpenDeployLine,
} from "./operationBar.logic";
import { opensOnto, stepOutput } from "./opens.logic";
import { showHelper } from "./helperFocus";
import { ElapsedSince } from "./ConversationRows";
import { helperNowWords, helperReportLine, helperSpan } from "./helpers.logic";
import { StandupDetail } from "./StandupDetail";
import type { ExpandedImagePreview } from "./ExpandedImagePreview";
import {
  normalizeCompactToolLabel,
  shouldPreserveAssistantLineBreaks,
  thoughtParagraphs,
  type ConversationEvent,
  type MessagesTimelineRow,
  type RecordItem,
  type RunStatus,
  type TurnHeaderActivity,
} from "./MessagesTimeline.logic";
import {
  chatOpensAt,
  cutEdges,
  earlierShown,
  followAfter,
  NOTHING_OPENED,
  footTop,
  movedByClamp,
  formatClock,
  laidOutPosition,
  type RunScrollEvent,
  type RunScrollFollow,
  recoveredFailures,
  nowLineFace,
  nowLineOf,
  nowLineWords,
  noteText,
  slotWords,
  operationNowWords,
  reachesEarlier,
  runCardShows,
  chooseLiveRunFold,
  runFoldOf,
  setRunFold,
  transitionRunFold,
  severalCallsWords,
  type SlotFiller,
  stepNowWords,
  subscribeRunFolds,
  type NowLine as NowLineModel,
  type RunFold,
  type RunScrollPosition,
  standsAtFoot,
} from "./runCard.logic";
import { useRunScrollResettle } from "./useRunScrollResettle";
import {
  useEngineLiveMessage,
  useEngineLiveMessages,
  useEngineLiveNow,
} from "../../zerops/useEngineLiveMessage";
import {
  TimelineRowActivityCtx,
  TimelineRowCtx,
  type TimelineRowSharedState,
} from "./timelineContext";
import { stepOf, type StepKind, type StepPhrase, type WorkStep } from "./workSteps.logic";

// ---------------------------------------------------------------------------
// Shared with the rest of the card
// ---------------------------------------------------------------------------

/** A markdown heading's level under its message's author (for the accessibility tree only). */
const MESSAGE_HEADING_LEVEL = 3;

/** The dots while the Mate composes what comes next. */
export function TypingDots({ className }: { readonly className?: string }) {
  return (
    <span aria-hidden="true" className={cn("flex items-center gap-1", className)}>
      <span className="size-1.5 animate-typing-first rounded-full bg-muted-foreground motion-reduce:animate-none" />
      <span className="size-1.5 animate-typing-second rounded-full bg-muted-foreground motion-reduce:animate-none" />
      <span className="size-1.5 animate-typing-third rounded-full bg-muted-foreground motion-reduce:animate-none" />
    </span>
  );
}

/** A to-do list, a step a line: done ones muted, the one in hand in the busy tone. */
export function PlanSteps({
  steps,
}: {
  readonly steps: ReadonlyArray<{
    readonly step: string;
    readonly status: "pending" | "inProgress" | "completed";
  }>;
}) {
  const seen = new Map<string, number>();
  return (
    <ol className="grid gap-px" data-plan-steps>
      {steps.map((step) => {
        const occurrence = seen.get(step.step) ?? 0;
        seen.set(step.step, occurrence + 1);
        return (
          <li
            key={`${step.step}:${occurrence}`}
            className="flex min-h-7 min-w-0 items-start gap-2.5 text-prose"
            data-plan-step={step.status}
          >
            <span aria-hidden="true" className="flex w-4 shrink-0 justify-center pt-2">
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  step.status === "completed"
                    ? "bg-status-ok"
                    : step.status === "inProgress"
                      ? "bg-status-busy"
                      : "bg-muted-foreground/35",
                )}
              />
            </span>
            <span
              className={cn(
                "min-w-0 pt-1",
                step.status === "completed" ? "text-muted-foreground" : "text-foreground",
              )}
            >
              {step.step}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Kinds whose time says something: a read or an edit is over before it can be read. */
const TIMED: ReadonlySet<StepKind> = new Set(["command", "web", "tool"]);

/**
 * What a line of the chat still running says in its time's place: that it
 * runs, never a second clock — what runs ticks once, in its bar or on the
 * now line (K3).
 */
const STILL_RUNNING = "Running";

/** What a call that never returned says once its run settled, where its time would be. */
const NO_RESULT = "No result";

/**
 * What a command sent to the background says where its time would be, while
 * its job runs on past the turn: where it runs, never a clock nobody ticks.
 */
const IN_THE_BACKGROUND = "In the background";

/** A job whose session is gone before it reported: it never will. */
const NO_REPORT = "Didn't report back";

/** A job stopped before it finished. */
const STOPPED = "Stopped";

/** How long a step took; one still running says so, one that never returned says that. */
function stepTime(step: WorkStep): ReactNode {
  if (step.noResult === "closed") return NO_RESULT;
  if (step.noResult === "stale") return null;
  if (step.state === "running") return STILL_RUNNING;
  if (step.background?.state === "running") return IN_THE_BACKGROUND;
  if (step.background?.state === "lost") return NO_REPORT;
  if (step.background?.state === "stopped") return STOPPED;
  if (!TIMED.has(step.kind) || step.endedAt === null) return null;
  const ms = Date.parse(step.endedAt) - Date.parse(step.startedAt);
  return Number.isFinite(ms) && ms >= 1000 ? formatWorkDuration(ms) : null;
}

/**
 * How long a platform operation took; one still running says so — one whose
 * call returned while it runs on says nothing: the band times it.
 */
function operationTime(operation: ZeropsOperation): ReactNode {
  if (operation.phase === "running") {
    return operation.returnedAt === undefined ? STILL_RUNNING : null;
  }
  if (operation.settledAt === undefined) return null;
  const ms = Date.parse(operation.settledAt) - Date.parse(operation.anchorAt);
  return Number.isFinite(ms) && ms >= 1000 ? formatWorkDuration(ms) : null;
}

// ---------------------------------------------------------------------------
// Folding, as the person's own messages fold
// ---------------------------------------------------------------------------

/** Past this many lines or characters a message folds — the person's and the Mate's alike. */
const FOLD_LINES = 8;
const FOLD_LENGTH = 600;

/** Whether words fold: past 8 lines or 600 characters. */
export function foldsLikeAMessage(text: string): boolean {
  if (text.trim().length === 0) return false;
  return text.length > FOLD_LENGTH || text.split("\n").length > FOLD_LINES;
}

const FOLD_FADE_HEIGHT_REM = 1.75;
/** A folded message's bottom, fading into the bubble it sits in. */
export const FOLD_FADE_MASK = `linear-gradient(to bottom, black calc(100% - ${FOLD_FADE_HEIGHT_REM}rem), transparent)`;

/** A thought's surface: the faintest fill in the card — the quietest thing in it. */
const THOUGHT_FILL = "bg-foreground/3";

/** What the Mate did: a light hairline drawn outside the box, so it takes no room — outlined on the tray, never filled. */
const CALL_SURFACE = "ring-1 ring-foreground/9";

// ---------------------------------------------------------------------------
// The chat, drawn once
// ---------------------------------------------------------------------------

/**
 * Whether the chat has been drawn once: a bubble mounting after that arrived
 * while the person watched.
 */
const ChatShownContext = createContext<{ readonly current: boolean } | null>(null);

/**
 * The run's scroll, to the lines in it: what the person opens there holds the
 * scroll where it stands, rather than following its foot; closing the last of
 * it lets it follow again (`followAfter`).
 */
const RunScrollHoldContext = createContext<((key: string, opens: boolean) => void) | null>(null);

/**
 * Whether a bubble stands in the live slot (pass 35): drawn as the row it
 * becomes in the history, with no mark, time or chevron of its own — the
 * slot's face, clock and caps stand for them — and nothing to open.
 */
const InSlotContext = createContext(false);

/** The key of the chat's line a bubble is drawn for: what its plop finds it by. */
const ChatLineContext = createContext<string | null>(null);

/**
 * What the person opened in the run's card, by its line's key: a row the slot
 * showed lands in the history as it stood — opened, or at its cap — so its
 * plop moves it and never resizes it (pass 35).
 */
const CarriedOpenContext = createContext<Map<string, Carried> | null>(null);

/** A line's state as carried: the person's own choice, or how the slot last drew it. */
interface Carried {
  readonly value: boolean;
  /** The person set it: it holds wherever the line is drawn. */
  readonly own: boolean;
}

/**
 * A state of a line's, kept across its slot row and its history row. With
 * `follows`, the slot row draws it from what it shows now — a call's input
 * streams in after its start — until the person sets it, and the history row
 * takes it as the slot last drew it.
 */
function useCarried(
  part: string,
  initial: () => boolean,
  follows = false,
  shut = false,
): [boolean, (next: boolean) => void] {
  const carried = use(CarriedOpenContext);
  const line = use(ChatLineContext);
  const inSlot = use(InSlotContext);
  const key = line === null ? null : `${line}#${part}`;
  const following = follows && inSlot;
  const [value, setValue] = useState<boolean | undefined>(() => {
    const kept = key === null ? undefined : carried?.get(key);
    if (kept !== undefined && (kept.own || !following)) return kept.value;
    if (following) return undefined;
    const first = initial();
    if (key !== null) carried?.set(key, { value: first, own: false });
    return first;
  });
  // Shut: it stands closed whatever it carried, and stays so after.
  if (shut && value !== false) {
    if (key !== null) carried?.set(key, { value: false, own: false });
    setValue(false);
  }
  const shown = shut ? false : (value ?? initial());
  if (value === undefined && key !== null && carried?.get(key)?.value !== shown) {
    carried?.set(key, { value: shown, own: false });
  }
  return [
    shown,
    (next) => {
      if (key !== null) carried?.set(key, { value: next, own: true });
      setValue(next);
    },
  ];
}

/**
 * In the live slot, the line of the one deploy that stands open on its card:
 * the newest running one — the others stay one line each, so the slot never
 * outgrows its room.
 */
const SlotStandsOpenContext = createContext<string | null>(null);

/** An operation whose call returned while it runs on: the band under the chat draws it. */
function runsOnInBand(operation: ZeropsOperation): boolean {
  return (
    operation.kind !== "standup" &&
    operation.phase === "running" &&
    operation.returnedAt !== undefined &&
    operation.openedAt === undefined
  );
}

/** Whether the line lands by a plop from the live slot: then it never rises in on its own. */
const PlopsContext = createContext(false);

/** A call riding in a new card that lands by a plop: it rises in, the card plops. */
const RidesContext = createContext(false);

/** Whether this bubble arrived while the person watched: what the chat opened onto is simply there. */
function useArrivedLive(): boolean {
  const shown = use(ChatShownContext);
  // What a resync brings nobody watched happen: it is simply there.
  const { syncing } = use(TimelineRowCtx);
  const [arrived] = useState(() => (shown?.current ?? false) && !syncing);
  return arrived;
}

/**
 * Whether a bubble rises in as it arrives — in the history or in the slot,
 * once it was first drawn — never one landing by a plop.
 */
function useRisesIn(): boolean {
  const arrived = useArrivedLive();
  // As it mounted: a line that landed by a plop never rises in later.
  const plopping = use(PlopsContext);
  const [plops] = useState(plopping);
  return arrived && !plops;
}

const HOLD_NOTHING = () => {};

/**
 * What the person opened or closed is theirs to read (K12): the conversation
 * stops following its end, and so does the run's scroll it stands in, so the
 * line they clicked stays where it is and only what is under it moves. Drawn
 * outside a conversation, it holds nothing. The run's scroll counts each
 * switch on its own: its `part` of the line keeps it one switch as the row
 * lands from the slot, and a holder of several names each (`which`).
 */
export function useHoldReading(part?: string): (opens: boolean, which?: string) => void {
  const ctx = use(TimelineRowCtx) as TimelineRowSharedState | null;
  const holdScroll = use(RunScrollHoldContext);
  const line = use(ChatLineContext);
  const id = useId();
  const key = line !== null && part !== undefined ? `${line}#${part}` : id;
  const holdPage = ctx?.onHoldReading ?? HOLD_NOTHING;
  return (opens, which) => {
    holdScroll?.(which === undefined ? key : `${key}#${which}`, opens);
    holdPage();
  };
}

// ---------------------------------------------------------------------------
// A bubble
// ---------------------------------------------------------------------------

/**
 * The chat's one bubble (the owner, 2026-09-28: "the design of every element
 * has to be largely the same, differences subtle but obvious"): every bubble
 * is this shape — one round, 14 px in, 10 px down — on one left edge, and its
 * words start 14 px in whatever it holds. What tells them apart is only the
 * surface, and the mark each wears in the Mate's column beside it.
 */
const BUBBLE_SHAPE = "rounded-2xl";
const BUBBLE_PAD = "px-3.5 py-2.5";
/**
 * A call's row: compact beside the bubbles — 7 px down, 12 px in, and 14 px
 * from the right so its chevron ends on the card's one right edge, with the
 * now line's clock and the result's actions (S2).
 */
const CALL_PAD = "ps-3 pe-3.5 py-1.75";
/** A thought: 8 px down, 12 px in. */
const THOUGHT_PAD = "px-3 py-2";

/**
 * The chat's two sizes, by weight (K14): what anyone said — the person's
 * words, the Mate's — at the prose size, 14 px; everything else at 13 px,
 * quieter: what it did (a call's row), what it thought, a time, a caption,
 * the way to more, code.
 */
const WORDS = "text-prose";
const META = "text-line";

/** How a bubble reads: its words to the person, a thought, a thing it did — and in what state. */
type BubbleTone = "speech" | "thought" | "tool";

const BUBBLE_TONE: Record<BubbleTone, string> = {
  // Its words to the person: its own tint, lightly (`.run-speech`).
  speech: "run-speech text-foreground",
  // Talking to itself: the same bubble, half the fill, the words italic and faint.
  thought: `${THOUGHT_FILL} text-muted-foreground`,
  // A thing it did: a hairline on the tray, never a fill, so a call never
  // reads as something said.
  tool: `${CALL_SURFACE} text-foreground`,
};

/**
 * A bubble in the Mate's column: as wide as the column, as a card of calls is,
 * so every bubble shares its right edge as well as its left.
 */
function Bubble({
  tone,
  kind,
  size = WORDS,
  className,
  children,
}: {
  readonly tone: BubbleTone;
  /** What the bubble stands for, for the page's own tests and probes. */
  readonly kind: string;
  /** Its words' size: said at the prose size, thought at the quiet one. */
  readonly size?: typeof WORDS | typeof META;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "w-full min-w-0 overflow-hidden",
        BUBBLE_SHAPE,
        size,
        BUBBLE_TONE[tone],
        className,
      )}
      data-chat-bubble={tone}
      data-chat-kind={kind}
    >
      {children}
    </div>
  );
}

/** Whether a box stands at its end: within two pixels of it. */
function cappedAtEnd(box: HTMLElement): boolean {
  return box.scrollTop + box.clientHeight >= box.scrollHeight - 2;
}

/** A fade at each edge of a box that has more past it (`.run-capped`). */
function markCappedEdges(box: HTMLElement): void {
  if (typeof box.toggleAttribute !== "function") return;
  // Read whole before either is written: a fade written between two reads
  // made the second restyle the page first.
  const above = box.scrollTop > 1;
  const below = !cappedAtEnd(box) && box.scrollHeight > box.clientHeight + 1;
  box.toggleAttribute("data-more-above", above);
  box.toggleAttribute("data-more-below", below);
}

interface CappedBoxProps {
  readonly follows?: boolean;
  /** What the person opened under a call: twelve lines (`--run-detail-cap`). */
  readonly detail?: boolean;
  /** Which of its line's boxes it is, where the line has several. */
  readonly part?: string;
  /**
   * In the log: all of it, its item opened. What a call printed (`detail`)
   * stands whole there — it is drawn only once its call is opened.
   */
  readonly open?: boolean;
  /** In the log: whether what it holds runs past the cap, so its item offers the rest. */
  readonly onCut?: (cut: boolean) => void;
  readonly className?: string;
  readonly children: ReactNode;
}

/**
 * One item's box: at most four of the card's lines (`--run-item-cap`), in the
 * working row and in the log alike, so a plop moves an item and never resizes
 * it (run 11). In the working row what runs past the cap scrolls inside it
 * (`SlotBox`); in the log nothing scrolls inside it (`LogBox`).
 */
function CappedBox(props: CappedBoxProps) {
  return use(InSlotContext) ? <SlotBox {...props} /> : <LogBox {...props} />;
}

/**
 * An item's box in the log: it never scrolls (the owner, 2026-10-05: "it
 * should show the start and then on expand it should show everything, no
 * scroll inside in either case"). A scroll there caught the wheel of a person
 * skimming the card, and a box cut at four lines with its scrollbar hidden
 * said nothing of what ran past. Closed, it shows the head of what it holds —
 * the head names it, the newest words were for while it ran — a fade at its
 * foot where more runs past; opened by its item, all of it. One that stood at
 * its end in the working row rolls back to its head as it lands, so the swap
 * reads as the one box moving.
 */
function LogBox({ detail = false, part, open, onCut, className, children }: CappedBoxProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const whole = open ?? detail;
  // Whether it stood at its end in the slot: carried from there, taken once.
  const [stoodAtEnd, setStoodAtEnd] = useCarried(
    part ?? (detail ? "detail-end" : "capped-end"),
    () => false,
  );
  // Whether what it holds runs past the cap: measured while it stands closed
  // and kept while it is open — one drawn open was cut, or it would not open.
  const [cut, setCut] = useState(whole);
  const wholeRef = useRef(whole);
  const measureRef = useRef(() => {});
  useLayoutEffect(() => {
    const box = boxRef.current;
    const content = contentRef.current;
    if (box === null || content === null) return;
    const measure = () => {
      if (wholeRef.current) return;
      const next = content.offsetHeight > box.clientHeight + 1;
      // Its fade at once, before the frame paints; the draw that says so follows.
      if (typeof box.toggleAttribute === "function") box.toggleAttribute("data-more-below", next);
      setCut(next);
    };
    measureRef.current = measure;
    // Measured once the page is laid out, as its observer first reports it:
    // read as it mounts, each box of a history drawing its lines forced the
    // page's layout in the middle of the draw.
    if (typeof ResizeObserver === "undefined") {
      measure();
      return;
    }
    const resized = new ResizeObserver(measure);
    resized.observe(content);
    return () => resized.disconnect();
  }, []);
  useLayoutEffect(() => {
    wholeRef.current = whole;
    // Closed again: what runs past the cap is measured anew, once laid out.
    if (!whole) afterLayout(() => measureRef.current());
  }, [whole]);
  const tellCut = useEffectEvent((next: boolean) => onCut?.(next));
  useEffect(() => tellCut(cut), [cut]);
  // Once, as it lands: the carried end is spent.
  const rollBack = useEffectEvent(() => {
    if (!stoodAtEnd) return;
    setStoodAtEnd(false);
    const box = boxRef.current;
    const content = contentRef.current;
    if (box === null || content === null || typeof content.animate !== "function") return;
    const past = content.offsetHeight - box.clientHeight;
    if (past < 1 || prefersReducedMotion()) return;
    content.animate([{ transform: `translateY(${-past}px)` }, { transform: "none" }], {
      duration: FOLD_EASE_MS,
      easing: FOLD_EASING,
    });
  });
  useLayoutEffect(() => rollBack(), []);
  return (
    <div
      ref={boxRef}
      className={cn("run-capped min-w-0", className)}
      data-capped={detail ? "detail" : "item"}
      data-capped-at="log"
      data-more-below={cut && !whole ? "" : undefined}
      data-whole={whole ? "" : undefined}
    >
      <div ref={contentRef} data-capped-held="">
        {children}
      </div>
    </div>
  );
}

/**
 * An item's box in the working row (run 11, the owner: thinking "grows to a
 * max height, then scrolls inside with a fade"; "running commands and
 * everything should have scrollable max-height"): what runs past the cap
 * scrolls inside it, a fade at an edge saying there is more. While its item
 * streams (`follows`) it keeps the newest words in view, until the person
 * scrolls it; whether it stands at its end is carried by its line's key to
 * the log, which rolls it back to its head.
 */
function SlotBox({ follows = false, detail = false, part, className, children }: CappedBoxProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  // Whether it stands at its end, carried from the slot to the history.
  const [atEnd, setAtEnd] = useCarried(
    part ?? (detail ? "detail-end" : "capped-end"),
    () => follows,
  );
  const stickRef = useRef(atEnd);
  // Where it last scrolled itself: a scroll that lands there is its own,
  // any other the person's — even in the same frame as its own.
  const ownTopRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    const box = boxRef.current;
    const content = contentRef.current;
    const end = endRef.current;
    if (box === null || content === null || end === null) return;
    const settle = () => {
      if (stickRef.current) {
        const bottom = box.scrollHeight - box.clientHeight;
        if (Math.abs(box.scrollTop - bottom) > 1) {
          followScrollTo(box, bottom);
          ownTopRef.current = box.scrollTop;
        }
      }
      markCappedEdges(box);
    };
    settle();
    const observers: Array<{ disconnect: () => void }> = [];
    if (typeof ResizeObserver !== "undefined") {
      const resized = new ResizeObserver(settle);
      resized.observe(content);
      observers.push(resized);
    }
    // A node the list puts back stands at its head, saying nothing — no
    // scroll, no resize: its end leaving view is the one sign of it.
    if (typeof IntersectionObserver === "function") {
      const seen = new IntersectionObserver(
        (entries) => {
          if (!entries.every((entry) => entry.isIntersecting)) settle();
        },
        { root: box },
      );
      seen.observe(end);
      observers.push(seen);
    }
    return () => {
      for (const observer of observers) observer.disconnect();
    };
  }, []);
  // An item that starts streaming follows from then, until the person scrolls it.
  useLayoutEffect(() => {
    if (follows) stickRef.current = true;
  }, [follows]);
  return (
    <div
      ref={boxRef}
      className={cn("run-capped min-w-0", className)}
      data-capped={detail ? "detail" : "item"}
      onScroll={() => {
        const box = boxRef.current;
        if (box === null) return;
        // Read before its fades are written: a read after them restyled the page.
        const top = box.scrollTop;
        const end = cappedAtEnd(box);
        markCappedEdges(box);
        const own = ownTopRef.current;
        ownTopRef.current = null;
        if (own !== null && Math.abs(top - own) <= 1) return;
        stickRef.current = end;
        if (end !== atEnd) setAtEnd(end);
      }}
    >
      <div ref={contentRef}>{children}</div>
      <div ref={endRef} aria-hidden className="h-px" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// What a bubble holds, opened in place
// ---------------------------------------------------------------------------

/** Only an open the person made rises; a carried, a first or a landing one is simply there. */
function rises(made: boolean): string | false {
  return made && "animate-detail-in motion-reduce:animate-none";
}

/** A bubble's detail: open or not, and its switch — the person's reading held while it opens. */
function useDisclosure(initial = false, part = "open", follows = false, shut = false) {
  const hold = useHoldReading(part);
  const [open, setOpen] = useCarried(part, () => initial, follows, shut);
  // Opened by the person here: only that open moves (a carried, a first or a
  // landing one is simply there).
  const [made, setMade] = useState(false);
  return {
    open,
    made,
    set: (next: boolean) => {
      // Set as it stands, nothing opened or closed.
      if (next === open) return;
      hold(next);
      setMade(true);
      setOpen(next);
    },
    toggle: () => {
      hold(!open);
      setMade(true);
      setOpen(!open);
    },
  };
}

/**
 * The part of a call that opens what it holds: its first line, pressable, and
 * a chevron at the end of it that is always there — at rest too, so what
 * opens is plain before the pointer finds it. Nothing under the pointer paints
 * a band across the line: the call is its whole row, not its first line (the
 * owner, 2026-09-28: "the way result is shown with the expand / collapse
 * suck").
 */
function DisclosureButton({
  open,
  onToggle,
  label,
  className,
  children,
}: {
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly label: string;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  if (use(InSlotContext)) {
    return <div className={cn("block w-full min-w-0", className)}>{children}</div>;
  }
  return (
    <button
      aria-expanded={open}
      aria-label={label}
      className={cn(
        "group/disclose block w-full min-w-0 cursor-pointer text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-inset",
        className,
      )}
      data-chat-disclose
      onClick={onToggle}
      type="button"
    >
      {children}
    </button>
  );
}

/** The chevron a call that opens wears after its time: at rest, turned over while open. */
function OpensMark() {
  return (
    <ChevronDownIcon
      aria-hidden="true"
      className="size-3.5 shrink-0 text-muted-foreground/55 transition-[color,rotate] duration-150 group-hover/disclose:text-foreground group-aria-expanded/disclose:rotate-180"
    />
  );
}

/**
 * Closes what `pressed` opened, keeping `pressed` where it stands on screen —
 * or, where it is gone once closed, the foot of the bubble it stood in (K12).
 */
function collapseInPlace(pressed: HTMLElement, close: () => void) {
  keepInPlace({
    anchor: pressed,
    fallback: pressed.closest<HTMLElement>("[data-chat-bubble], [data-chat-row]"),
    scroller: scrollerOf(pressed),
    change: () => flushSync(close),
  });
}

/**
 * A bubble's words in its item's box. In the working row, the box as it
 * streams. In the log, the head of them; past the cap the bubble is a press
 * onto the whole of them — "Show all" at its foot under the pointer — and
 * "Show less" under them closes it again, standing where it was pressed.
 */
function OpensWhole({
  follows = false,
  what,
  children,
}: {
  readonly follows?: boolean;
  /** What it holds, for the press's name: "thought", "message", "question". */
  readonly what: string;
  readonly children: ReactNode;
}) {
  const inSlot = use(InSlotContext);
  const disclosure = useDisclosure(false, "open");
  const [cut, setCut] = useState(false);
  if (inSlot) return <CappedBox follows={follows}>{children}</CappedBox>;
  return (
    <>
      <div className="relative min-w-0">
        <CappedBox onCut={setCut} open={disclosure.open}>
          {children}
        </CappedBox>
        {cut && !disclosure.open ? (
          <button
            aria-expanded={false}
            aria-label={`Show all of the ${what}`}
            className="run-item-open absolute inset-0 cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
            data-chat-disclose
            onClick={() => disclosure.set(true)}
            type="button"
          >
            <span aria-hidden="true" className={cn(META, "run-item-more")}>
              Show all
            </span>
          </button>
        ) : null}
      </div>
      {disclosure.open ? (
        <button
          aria-expanded
          className={cn(
            META,
            "mt-1 block cursor-pointer rounded-sm not-italic text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70",
          )}
          // It stands at the foot of what it opened: closing folds what
          // stands above it, and it stays under the pointer (K12).
          onClick={(event) => collapseInPlace(event.currentTarget, () => disclosure.set(false))}
          type="button"
        >
          Show less
        </button>
      ) : null}
    </>
  );
}

/**
 * What a call's detail says, in its own inset on the code's left edge — a
 * command's output, a report, an error: a well under what was run, never
 * text that drifts left of it. In the working row past twelve lines it
 * scrolls inside its box; in the log it stands whole, as it was opened.
 */
function OutputBlock({
  label = null,
  mono = true,
  part,
  text,
}: {
  readonly label?: string | null;
  readonly mono?: boolean;
  /** Which of its line's outputs it is, where the line has several. */
  readonly part?: string;
  readonly text: string;
}) {
  return (
    <section aria-label={label ?? undefined} className="grid min-w-0 gap-1">
      {label === null ? null : <h4 className={cn(META, "text-muted-foreground")}>{label}</h4>}
      <CappedBox
        className="rounded-xl bg-foreground/4"
        detail
        {...(part === undefined ? {} : { part })}
      >
        <pre
          className={cn(
            "min-w-0 whitespace-pre-wrap break-words px-3 py-2 text-foreground/80 select-text",
            META,
            mono ? "font-mono" : "font-sans",
          )}
        >
          {text}
        </pre>
      </CappedBox>
    </section>
  );
}

/**
 * A bubble's first line: its words, and at the right edge its time and the
 * chevron, centred on the first line of words however far they wrap. What kind
 * of thing it is stands in the Mate's column beside it (`Mark`), so the words
 * of every bubble start on one edge. In a card of calls the chevron keeps its
 * slot on every row, so each call's time stands on the card's one edge.
 */
function Headline({
  children,
  time = null,
  timeTone = "muted",
  opens = false,
  column = false,
  running = false,
}: {
  readonly children: ReactNode;
  readonly time?: ReactNode;
  readonly timeTone?: "muted" | "failed";
  readonly opens?: boolean;
  /** A row of a card of calls: the time and the chevron keep their column. */
  readonly column?: boolean;
  /**
   * The call is running now: a light sweeps across its words, in their own
   * inks, until it returns — the card's "this, now" without a spinner.
   */
  readonly running?: boolean;
}) {
  // In the slot, the right edge is the run's one clock: a row gets its time when it lands.
  if (use(InSlotContext)) {
    return (
      <span className={cn("flex min-w-0 items-start gap-2", META)}>
        <RunShimmer className="min-w-0 flex-1 break-words" sweeps={running}>
          {children}
        </RunShimmer>
        <span aria-hidden="true" className="run-slot-clock-room" />
      </span>
    );
  }
  return (
    <span className={cn("flex min-w-0 items-start gap-2", META)}>
      <RunShimmer className="min-w-0 flex-1 break-words" sweeps={running}>
        {children}
      </RunShimmer>
      {time !== null || opens || column ? (
        <span className="flex h-[1lh] shrink-0 items-center gap-1.5 ps-2">
          <span
            className={cn(
              META,
              "tabular-nums",
              timeTone === "failed" ? "text-status-failed-text" : "text-muted-foreground",
            )}
          >
            {time}
          </span>
          {opens ? <OpensMark /> : column ? <span className="size-3.5 shrink-0" /> : null}
        </span>
      ) : null}
    </span>
  );
}

/** What kind of thing a bubble is, in the muted ink: the mark it wears in the Mate's column. */
function DidMark({ icon: Icon }: { readonly icon: LucideIcon }) {
  return <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />;
}

/** Whether a failure still stands, or a later step undid it (K9). */
type Failure = "broken" | "undone";

/**
 * A failure's mark, in place of its kind's: red while it is still broken,
 * quiet once a later step undid it — red always means still broken (K9).
 */
function FailedMark({ failure }: { readonly failure: Failure }) {
  return (
    <TriangleAlertIcon
      aria-hidden="true"
      className={cn(
        "size-4 shrink-0",
        failure === "broken" ? "text-status-failed-text" : "text-muted-foreground",
      )}
    />
  );
}

/**
 * The Mate's column, beside a bubble: 28 px, the width of its face at the
 * chat's foot, 8 px off the bubbles — one grid for everything in the card
 * (K1). A bubble's mark stands in it centred on the bubble's first line.
 */
const MARK_COLUMN = "w-7 shrink-0";
const MARK_GAP = "gap-2";

/** Which first line a mark stands beside: the words', a call's or a thought's. */
type MarkLine = "words" | "call" | "thought";

/** Each first line's top and height: a bubble's 10 px and 14 px words, a call's 7 and 13, a thought's 8 and 13. */
const MARK_LINE: Record<MarkLine, string> = {
  words: "pt-2.5 text-prose",
  call: "pt-1.75 text-line",
  thought: "pt-2 text-line",
};

/**
 * A bubble's mark, where the Mate's column meets its first line: under the
 * bubble's top, one line of its words tall.
 */
function Mark({
  line = "words",
  children,
}: {
  readonly line?: MarkLine | undefined;
  readonly children: ReactNode;
}) {
  const inSlot = use(InSlotContext);
  return (
    <span
      aria-hidden="true"
      className={cn(MARK_COLUMN, "flex justify-center", MARK_LINE[line])}
      data-run-mark=""
      data-slot-mark={inSlot ? "" : undefined}
    >
      <span className="flex h-[1lh] items-center">{inSlot ? null : children}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// The Mate's words and thoughts
// ---------------------------------------------------------------------------

/** A note of the Mate's, in full: its words as markdown, at the moment it said them. */
function NoteWords({ message }: { readonly message: ChatMessage }) {
  const ctx = use(TimelineRowCtx);
  return (
    <ChangeChipMomentContext value={message.createdAt}>
      <ChatMarkdown
        className="text-foreground"
        cwd={ctx.markdownCwd}
        headingLevelOffset={MESSAGE_HEADING_LEVEL}
        isStreaming={Boolean(message.streaming)}
        lineBreaks={shouldPreserveAssistantLineBreaks(message.text)}
        onOpenImage={ctx.onImageExpand}
        onRunShellCommand={ctx.onRunShellCommand}
        skills={ctx.skills}
        text={noteText(message.text, Boolean(message.streaming))}
        threadRef={ctx.threadRef ?? undefined}
      />
    </ChangeChipMomentContext>
  );
}

/**
 * A stretch of thinking, a paragraph at a time, each keyed where it stands, so
 * the ones written keep their place as the newest grows — the same shape
 * still coming and settled, so it never changes height as it ends.
 */
function ThoughtParagraphs({ messages }: { readonly messages: ReadonlyArray<ChatMessage> }) {
  const ctx = use(TimelineRowCtx);
  const paragraphs = messages.flatMap((message) => {
    const said = thoughtParagraphs(message.text);
    return said.map((text, index) => ({
      key: `${message.id}:${index}`,
      text,
      streaming: Boolean(message.streaming) && index === said.length - 1,
    }));
  });
  return (
    <div className="grid gap-2.5 italic">
      {paragraphs.map((paragraph) => (
        <ChatMarkdown
          key={paragraph.key}
          className={THOUGHT_TEXT}
          cwd={ctx.markdownCwd}
          headingLevelOffset={MESSAGE_HEADING_LEVEL}
          isStreaming={paragraph.streaming}
          skills={ctx.skills}
          text={paragraph.text}
          threadRef={ctx.threadRef ?? undefined}
        />
      ))}
    </div>
  );
}

/** Values keyed by what they say and how often it came before: stable as a list only grows. */
function keyedByOccurrence(
  values: ReadonlyArray<string>,
): ReadonlyArray<{ readonly key: string; readonly value: string }> {
  const seen = new Map<string, number>();
  return values.map((value) => {
    const occurrence = seen.get(value) ?? 0;
    seen.set(value, occurrence + 1);
    return { key: `${value}#${occurrence}`, value };
  });
}

/**
 * A question it asked the person with its question tool: its own words, in
 * its tint — the person's answer stands under it, in theirs.
 */
function QuestionBubble({ questions }: { readonly questions: ReadonlyArray<string> }) {
  return (
    <Bubble className={BUBBLE_PAD} kind="question" tone="speech">
      <OpensWhole what="question">
        {keyedByOccurrence(questions).map(({ key, value }) => (
          <p key={key} className="whitespace-pre-wrap break-words">
            {value}
          </p>
        ))}
      </OpensWhole>
    </Bubble>
  );
}

/**
 * Its words to the person on the way: the chat's bubble in its fullest fill,
 * in its item's box — the newest words in view while they stream, its head
 * in the log and the whole of them a press away.
 */
function NoteBubble({ message: recorded }: { readonly message: ChatMessage }) {
  const message = useEngineLiveMessage(recorded);
  return (
    <Bubble className={BUBBLE_PAD} kind="note" tone="speech">
      <OpensWhole follows={Boolean(message.streaming)} what="message">
        <NoteWords message={message} />
      </OpensWhole>
    </Bubble>
  );
}

/** A thought's hand: small, faint and italic — its code and file names too. */
/** A thought's words at the card's quiet size, 13 px on 20 px lines, however it is drawn. */
const THOUGHT_TEXT = "chat-markdown-aside text-muted-foreground text-line leading-5";

/**
 * Whether what `watch` is given runs past the lines it is clamped to — or,
 * `across`, past the width of its one line. Until it is measured — the first
 * render, before the page paints it — `guess`.
 */
function useRunsPast(
  guess: boolean,
  across = false,
): readonly [boolean, (element: HTMLElement | null) => void] {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [past, setPast] = useState(guess);
  useLayoutEffect(() => {
    if (element === null) return;
    const measure = () =>
      setPast(
        across
          ? element.scrollWidth > element.clientWidth + 1
          : element.scrollHeight > element.clientHeight + 1,
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, across]);
  const [watch] = useState(() => (node: HTMLElement | null) => setElement(node));
  return [past, watch];
}

/**
 * A stretch of its thinking, the quietest thing in the card (K14): 13 px,
 * faint and italic on the faintest fill, in its item's box — its newest words
 * in view while it streams, its head in the log and the whole of it a press
 * away (D4: nothing is cut without a way to reach it).
 */
function ThoughtBubble({ messages: recorded }: { readonly messages: ReadonlyArray<ChatMessage> }) {
  const messages = useEngineLiveMessages(recorded);
  const text = messages.map((message) => message.text).join("\n\n");
  if (text.trim().length === 0) return null;
  return (
    <Bubble className={THOUGHT_PAD} kind="thought" size={META} tone="thought">
      <OpensWhole follows={messages.some((message) => message.streaming)} what="thought">
        <ThoughtParagraphs messages={messages} />
      </OpensWhole>
    </Bubble>
  );
}

// ---------------------------------------------------------------------------
// Its calls
// ---------------------------------------------------------------------------

/**
 * A call said plainly: the verb in the secondary ink, the names it took in
 * full ink — in mono where the code knows them, a file by its name alone,
 * never in a chip.
 */
function PhraseWords({ phrase }: { readonly phrase: StepPhrase }) {
  const name = (target: string) => (
    <span className={cn("min-w-0 break-words text-foreground", phrase.code && "font-mono")}>
      {target}
    </span>
  );
  const parts: ReactNode[] = [];
  const seen = new Map<string, number>();
  phrase.targets.forEach((target, index) => {
    const occurrence = seen.get(target) ?? 0;
    seen.set(target, occurrence + 1);
    const last = index === phrase.targets.length - 1;
    parts.push(
      <span key={`${target}#${occurrence}`}>
        {index > 0 ? (
          <span className="text-foreground/75">{last && phrase.more === 0 ? " and " : ", "}</span>
        ) : null}
        {name(target)}
      </span>,
    );
  });
  return (
    <span>
      <span className="text-foreground/75">{phrase.verb}</span>
      {phrase.targets.length > 0 ? " " : null}
      {parts}
      {phrase.more > 0 ? <span className="text-foreground/75"> and {phrase.more} more</span> : null}
    </span>
  );
}

/**
 * The pictures the settled run's result draws in its strip, by path: a step
 * that looked at one names it on its line and leaves the picture to the
 * strip, so an opened card never shows it twice (Bodhi, run 9).
 */
const NO_PATHS: ReadonlySet<string> = new Set();
const ResultPicturesContext = createContext<ReadonlySet<string>>(NO_PATHS);

/** The pictures a step looked at, as themselves: small, each one opening the picture viewer. */
function StepPictures({ step }: { readonly step: WorkStep }) {
  const inResult = use(ResultPicturesContext);
  const { threadRef, onImageExpand } = use(TimelineRowCtx);
  const shown = step.entries.flatMap((entry) =>
    stepOf(entry, undefined, false)
      .images.filter((path) => !inResult.has(path))
      .map((path) => ({ key: `picture:${entry.id}:${path}`, path })),
  );
  if (shown.length === 0 || threadRef === null) return null;
  return (
    <span className="flex min-w-0 flex-wrap gap-1.5 px-3 pb-1.75">
      {shown.map(({ key, path }) => (
        <StepPicture key={key} onOpen={onImageExpand} path={path} threadRef={threadRef} />
      ))}
    </span>
  );
}

function StepPicture({
  path,
  threadRef,
  onOpen,
}: {
  readonly path: string;
  readonly threadRef: ScopedThreadRef;
  readonly onOpen: (preview: ExpandedImagePreview) => void;
}) {
  const asset = useAssetUrlState(threadRef.environmentId, {
    _tag: "workspace-file",
    threadId: threadRef.threadId,
    path,
  });
  const name = path.split("/").pop() || path;
  if (asset._tag === "Loading") {
    return (
      <span
        aria-label="Loading the picture"
        className="block h-20 w-32 rounded-lg bg-foreground/5"
        role="status"
      />
    );
  }
  if (asset._tag !== "Success") {
    return <span className={cn(META, "text-muted-foreground")}>{name} is not there any more</span>;
  }
  return (
    <button
      aria-label={`Open ${name}`}
      className="block h-20 w-32 cursor-zoom-in overflow-hidden rounded-lg border border-border/60 bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
      onClick={() => onOpen({ images: [{ src: asset.url, name }], index: 0 })}
      type="button"
    >
      <AssetImage
        loading="lazy"
        decoding="async"
        alt={name}
        className="block size-full object-contain object-top"
        src={asset.url}
      />
    </button>
  );
}

/** Each kind of call's mark, leading its box. */
const STEP_GLYPH: Record<StepKind, LucideIcon> = {
  command: SquareTerminalIcon,
  read: FileTextIcon,
  search: SearchIcon,
  edit: FilePenLineIcon,
  web: GlobeIcon,
  look: ImageIcon,
  tool: WrenchIcon,
};

/**
 * Two of a command's 20 px lines: past them, the way to the rest — its words
 * say what it does, and four lines of shell read heavy (Bodhi, run 9).
 */
/**
 * A run of calls, one after another, as one bubble of the chat's shape: each
 * call a row of it and a hairline between them. Ten reads in a row are one
 * stretch of work, not ten boxes, and every call's time stands on the
 * bubble's one right edge (the owner, 2026-09-28: "there is no spacing between
 * items"). Each row wears its own mark in the Mate's column, beside it.
 */
function CallGroup({ children }: { readonly children: ReactNode }) {
  const shownRef = useRef(false);
  useEffect(() => {
    shownRef.current = true;
  }, []);
  return (
    <CallGroupContext value={shownRef}>
      <div
        className={cn("w-full min-w-0 divide-y divide-foreground/9", BUBBLE_SHAPE, CALL_SURFACE)}
        data-chat-calls
      >
        {children}
      </div>
    </CallGroupContext>
  );
}

/** Whether a call's card was drawn before the call joined it. */
const CallGroupContext = createContext<{ readonly current: boolean } | null>(null);

/**
 * One call, as its row of the bubble — a failure by its mark, never a flood —
 * its mark in the Mate's column beside it — out of the bubble, in the column
 * the chat's row keeps for it. A call joining a bubble already there rises in
 * on its own; one that came with its bubble rises in with it.
 */
function CallRow({
  kind,
  mark,
  failure = null,
  children,
}: {
  /** What the call stands for, for the page's own tests and probes. */
  readonly kind: string;
  /** What kind of call it is, in the Mate's column. */
  readonly mark: ReactNode;
  /** Where it failed: still broken, or undone by a later step. */
  readonly failure?: Failure | null;
  readonly children: ReactNode;
}) {
  const group = use(CallGroupContext);
  // A call a resync brings is simply there.
  const { syncing } = use(TimelineRowCtx);
  // One riding in a card that plops rises in, though its card is new.
  const rides = use(RidesContext);
  const [joined] = useState(() => ((group?.current ?? false) || rides) && !syncing);
  const lineKey = use(ChatLineContext);
  // As it mounted: a call that landed by a plop never rises in later.
  const plopping = use(PlopsContext);
  const [plops] = useState(plopping);
  return (
    <div
      className={cn(
        "relative min-w-0 first:rounded-t-2xl last:rounded-b-2xl",
        joined && !plops && "run-rise",
      )}
      data-run-rises={joined && !plops ? "" : undefined}
      data-chat-bubble={failure === null ? "tool" : "failed"}
      data-chat-failed={failure ?? undefined}
      data-chat-kind={kind}
      data-chat-row
      data-run-key={lineKey ?? undefined}
    >
      {/* Its mark stands off the bubble, over the row's empty column. */}
      <span className="absolute end-full top-0 me-2">
        <Mark line="call">{mark}</Mark>
      </span>
      {children}
    </div>
  );
}

/**
 * A command's code, in mono, in its item's box — a script never prints whole
 * into the chat unasked (the owner, 2026-09-28: "I see 100s of LoC printed
 * directly"): four lines of it, following the code as it streams in; in the
 * log its head, and all of it once its call is opened. It is how, under what
 * the command was for, on the words' own edge: in the muted ink, failed too —
 * its mark and its right edge say that it failed. Its grammar tints that ink
 * without raising it (`CommandScript`).
 */
function CommandCode({
  script,
  follows,
  open,
  onCut,
}: {
  readonly script: string;
  readonly follows: boolean;
  readonly open: boolean;
  readonly onCut: (cut: boolean) => void;
}) {
  return (
    <CappedBox follows={follows} onCut={onCut} open={open}>
      <code
        className={cn(
          "block whitespace-pre-wrap break-words font-mono text-muted-foreground",
          META,
        )}
      >
        <CommandScript script={script} />
      </code>
    </CappedBox>
  );
}

/**
 * A call the Mate made, as its row in the card of calls: led by what kind of
 * call it was, its time and a chevron on the card's right edge. A command
 * says what it was for, then its code in its item's box. What it printed
 * opens under it, on its first line's press, in an inset on the code's own
 * left edge. The one it is making now counts its time in the same quiet ink:
 * blue means something to click (S3), and the run has one clock.
 */
function StepBubble({
  step,
  undone = false,
}: {
  readonly step: WorkStep;
  /** It failed, and a later step undid it: quiet, not red (K9). */
  readonly undone?: boolean;
}) {
  const inSlot = use(InSlotContext);
  const script = step.kind === "command" ? (step.script ?? step.code) : null;
  // A command that said nothing of itself is its own title (K4): its first
  // line, in mono, and the whole of it in its box under it when it runs on.
  const bare = script !== null && step.words === null;
  const disclosure = useDisclosure(false, "open");
  const outputs = stepOutput(step);
  const writeCalls = stepWriteCalls(step);
  const failure: Failure | null = step.state !== "failed" ? null : undone ? "undone" : "broken";
  const running = step.state === "running";
  const time = stepTime(step);
  const showsCode = script !== null && (!bare || step.codeLines > 1);
  // In the log its code stands at its head: past the cap, the call opens onto the rest.
  const [codeCut, setCodeCut] = useState(false);
  const opens = opensOnto({ control: "step", step, codeCut: !inSlot && showsCode && codeCut });
  const title = step.words ?? step.code ?? "A command";
  const headline = (
    <Headline
      column
      opens={opens}
      running={running}
      time={failure === null ? time : "Failed"}
      timeTone={failure === "broken" ? "failed" : "muted"}
    >
      {step.kind === "command" ? (
        step.words === null ? (
          <span className="font-mono text-foreground">{step.code}</span>
        ) : (
          <span className="text-foreground/75">{step.words}</span>
        )
      ) : step.phrase !== null ? (
        <PhraseWords phrase={step.phrase} />
      ) : (
        <span className="text-foreground/75">{title}</span>
      )}
      {step.kind === "edit" && step.entries.length > 1 ? (
        <span className="text-muted-foreground">{` · ${step.entries.length} edits`}</span>
      ) : null}
    </Headline>
  );
  const pad = showsCode ? "ps-3 pe-3.5 pt-1.75 pb-0.5" : CALL_PAD;
  return (
    <CallRow
      failure={failure}
      kind={`step:${step.kind}`}
      mark={
        failure === null ? (
          <DidMark icon={STEP_GLYPH[step.kind]} />
        ) : (
          <FailedMark failure={failure} />
        )
      }
    >
      {opens ? (
        <DisclosureButton
          className={pad}
          label={`${title}. ${disclosure.open ? "Hide" : "Show"} ${outputs.length > 0 ? "what it returned" : writeCalls.length > 0 ? "what it wrote" : "all of its code"}`}
          onToggle={disclosure.toggle}
          open={disclosure.open}
        >
          {headline}
        </DisclosureButton>
      ) : (
        <div className={pad}>{headline}</div>
      )}
      {showsCode ? (
        <div className="px-3 pb-1.75">
          <CommandCode
            follows={inSlot && running}
            onCut={setCodeCut}
            open={disclosure.open}
            script={script}
          />
        </div>
      ) : null}
      <StepPictures step={step} />
      {disclosure.open && outputs.length > 0 ? (
        <div
          className={cn("grid gap-2 px-3 pb-2", rises(disclosure.made))}
          data-chat-detail
          data-chat-detail-rises={disclosure.made ? "" : undefined}
        >
          {outputs.map((output) => (
            <OutputBlock
              key={output.key}
              label={output.label}
              part={`detail-end:${output.key}`}
              text={output.text}
            />
          ))}
        </div>
      ) : null}
      {disclosure.open && writeCalls.length > 0 ? (
        <div className={cn("px-3 pb-2", rises(disclosure.made))} data-chat-detail>
          <FileWriteDetail
            box={(part, text) => (
              <CappedBox className="rounded-xl bg-foreground/4" detail part={part}>
                {text}
              </CappedBox>
            )}
            callIds={writeCalls}
          />
        </div>
      ) : null}
    </CallRow>
  );
}

// ---------------------------------------------------------------------------
// The platform's work
// ---------------------------------------------------------------------------

/** A deploy's pipeline and build log, whole: the card, under what opened it. */
export function OperationDetail({
  operation,
  environmentId,
  threadRef,
  turnRuns,
  regions,
}: {
  readonly operation: ZeropsOperation;
  readonly environmentId: EnvironmentId | null;
  readonly threadRef: ScopedThreadRef | null;
  /** Its turn runs: a stand-up's builds that ran on are read as they stand. */
  readonly turnRuns: boolean;
  /** What its line already read of the platform: the card draws it, never reading it twice. */
  readonly regions?: OperationCardRegions;
}) {
  if (operation.kind === "standup") {
    return (
      <StandupDetail environmentId={environmentId} operation={operation} turnRuns={turnRuns} />
    );
  }
  if (operation.kind === "import") {
    return <ImportDetail environmentId={environmentId} operation={operation} />;
  }
  if (regions !== undefined) {
    return (
      <ZeropsOperationCard
        headless
        operation={cardOperationOf(operation, regions.service)}
        threadRef={threadRef}
        {...regions}
      />
    );
  }
  return (
    <ZeropsOperationDetail
      environmentId={environmentId}
      operation={operation}
      threadRef={threadRef}
    />
  );
}

function ZeropsOperationDetail({
  operation,
  environmentId,
  threadRef,
}: {
  readonly operation: ZeropsOperation;
  readonly environmentId: EnvironmentId | null;
  readonly threadRef: ScopedThreadRef | null;
}) {
  // The whole log's dialog is the line's: one opened in the live slot stays open as it lands.
  const regions = useOperationCard(
    operation,
    environmentId,
    useCarried("log", () => false),
    true,
    threadRef?.threadId ?? null,
  );
  return (
    <ZeropsOperationCard
      headless
      operation={cardOperationOf(operation, regions.service)}
      threadRef={threadRef}
      {...regions}
    />
  );
}

/**
 * A platform operation as its bubble — a deploy, a subdomain, a restart:
 * what it did in a sentence, its pipeline as a bar, and its time; while it
 * runs, what the Mate waits on beside its face (the bar under the chat has
 * its clock). Its card — the pipeline, the build log — opens under it.
 */
/** Whether the turn an operation ran in still runs: what it started may still be read live. */
function useTurnRuns(operation: ZeropsOperation): boolean {
  const activity = use(TimelineRowActivityCtx);
  return activity.isWorking && activity.latestTurnId === operation.turnId;
}

/** A stand-up's row: it opens to its services' lines only when there are any. */
function StandupBubble({
  operation,
  undone,
}: {
  readonly operation: ZeropsOperation;
  readonly undone: boolean;
}) {
  const ctx = use(TimelineRowCtx);
  const reading = useStandupReading(
    operation,
    ctx.activeThreadEnvironmentId,
    useTurnRuns(operation),
  );
  return (
    <OperationBubble
      lines={detailLines(operation, reading?.rows.length ?? null)}
      operation={operation}
      undone={undone}
    />
  );
}

/** What an operation's line takes: the operation, how it ended, how much it opens to. */
interface OperationLineProps {
  readonly operation: ZeropsOperation;
  /** It failed, and a later one on the same service went through: quiet (K9). */
  readonly undone?: boolean;
  /**
   * Its call never returned: what was asked, never "Running" — "stale" while
   * the run goes on, "closed" ("No result") once it is over.
   */
  readonly noResult?: "stale" | "closed" | undefined;
  /** How much it opens to: its services' lines, its card's parts (`detailLines`). */
  readonly lines?: number;
}

/**
 * An operation's line. In the live slot, a deploy — the one kind whose card
 * draws a pipeline and a build log — reads the platform there, from its start
 * to its plop: its bar follows its pipeline, and the newest running one stands
 * open on its card (the pipeline's steps, the build's newest lines, the way to
 * the whole log) once the store has read any of it (pass 36: "the running
 * builds, their logs ... seem to be completely gone"). A batch deploy is one
 * line like any call: its bar a segment per service, its card the service the
 * platform says is building.
 */
function OperationBubble(props: OperationLineProps) {
  const inSlot = use(InSlotContext);
  if (!inSlot || props.noResult !== undefined || props.operation.kind !== "deploy") {
    return <OperationLine {...props} regions={null} />;
  }
  return <WatchedOperationBubble {...props} />;
}

/** An operation in the live slot, with what its card reads of the platform. */
function WatchedOperationBubble(props: OperationLineProps) {
  const ctx = use(TimelineRowCtx);
  const line = use(ChatLineContext);
  const standsOpen = use(SlotStandsOpenContext);
  // The whole log's dialog is the line's: one opened here stays open as it
  // lands. A line that stands closed reads no build log.
  const regions = useOperationCard(
    props.operation,
    ctx.activeThreadEnvironmentId,
    useCarried("log", () => false),
    line !== null && line === standsOpen,
    ctx.threadRef?.threadId ?? null,
  );
  return <OperationLine {...props} regions={regions} />;
}

function OperationLine({
  operation,
  undone = false,
  noResult,
  lines: given,
  regions,
}: OperationLineProps & {
  /** What its card read of the platform: null where nothing reads it here. */
  readonly regions: OperationCardRegions | null;
}) {
  const observed = observedLinesOf(regions?.observed);
  const inSlot = use(InSlotContext);
  const line = use(ChatLineContext);
  const standsOpen = use(SlotStandsOpenContext);
  const ctx = use(TimelineRowCtx);
  const turnRuns = useTurnRuns(operation);
  // Its call returned while it runs on: the band under the chat draws it, so
  // its line here lands closed and opens onto nothing until it ends.
  const inBand = !inSlot && turnRuns && runsOnInBand(operation);
  // A dev server's card draws the way to its address, where the topology knows it.
  const topology = useZeropsTopology(ctx.activeThreadEnvironmentId);
  const devServerUrl = devServerUrlFor(operation, topology);
  const lines = inBand ? 0 : (given ?? detailLines(operation, null, observed, devServerUrl));
  // In the slot the newest running deploy stands open on what its card read, and lands so.
  const disclosure = useDisclosure(
    inSlot && line !== null && line === standsOpen && showsCardInSlot(observed),
    "open",
    true,
    inBand,
  );
  const failed = operation.phase === "failed";
  const failure: Failure | null = !failed ? null : undone ? "undone" : "broken";
  const running = noResult === undefined && operation.phase === "running";
  // Live in the slot, its pipeline as it goes and the step it is on.
  // A batch's bar keeps a segment per service; a deploy's follows its pipeline.
  const live =
    running && inSlot
      ? liveOperationBar(
          operation,
          operation.batch === true ? undefined : regions?.observed?.pipeline,
        )
      : null;
  // Settled, a bar only where it says what the line does not (`settledOperationBar`).
  const settled = settledOperationBar(operation, undone, inSlot ? "slot" : "log");
  const words =
    noResult === undefined ? operationLineWords(operation) : operationUnreturnedWords(operation);
  // A deploy's steps are its progress, under its name: the line holds its
  // name and its time alone — no bar, no step word, no reason (the owner,
  // 2026-10-05: "it should be steps, but they should be visible").
  const stepped = noResult === undefined && readsPipeline(operation);
  const reason =
    failed && !stepped ? (operation.explanation?.reason ?? operation.closing ?? null) : null;
  const detail =
    reason ??
    (operation.kind === "deploy" && !stepped
      ? (versionText(operation.version?.name) ?? null)
      : null);
  // Its reason cut short on its one line is a way to the whole of it.
  // Opened, it stands whole in place, wrapped: no longer cut, still the
  // way back to its one line.
  const [cut, watchDetail] = useRunsPast(false, true);
  const reasonCut = reason !== null && (cut || disclosure.open);
  // Nothing to add: no chevron, and it does not press.
  const opens = opensOnto({ control: "operation", lines, reasonCut });
  const head = (
    <Headline
      column
      opens={opens}
      time={
        noResult === undefined ? operationTime(operation) : noResult === "closed" ? NO_RESULT : null
      }
      timeTone={failure === "broken" ? "failed" : "muted"}
    >
      <span className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5">
        <RunShimmer
          className={stepped ? "text-foreground" : "text-foreground/75"}
          // A deploy's running step pulses: its name stands still in the ink.
          sweeps={live !== null && !stepped}
        >
          {words}
        </RunShimmer>
        {stepped ? null : live !== null ? (
          <>
            <StatusBar className="w-12" segments={live.segments} />
            {live.word === null ? null : <span className="text-muted-foreground">{live.word}</span>}
          </>
        ) : running || noResult !== undefined || settled.length === 0 ? null : (
          <StatusBar className="w-12" segments={settled} />
        )}
        {detail !== null ? (
          <span
            ref={watchDetail}
            className={cn(
              "min-w-0 font-mono text-muted-foreground",
              reason !== null && disclosure.open ? "whitespace-pre-wrap break-words" : "truncate",
            )}
          >
            {detail}
          </span>
        ) : null}
      </span>
    </Headline>
  );
  return (
    <CallRow
      failure={failure}
      kind={`operation:${operation.kind}`}
      mark={
        failure === null ? <KindGlyph kind={operation.kind} /> : <FailedMark failure={failure} />
      }
    >
      {opens ? (
        <DisclosureButton
          className={CALL_PAD}
          label={`${words}. ${disclosure.open ? "Hide" : "Show"} it`}
          onToggle={disclosure.toggle}
          open={disclosure.open}
        >
          {head}
        </DisclosureButton>
      ) : (
        <div className={CALL_PAD}>{head}</div>
      )}
      {opens && disclosure.open ? (
        <div
          className={cn(
            "px-3 pb-2",
            // Only an open the person made moves; a carried or a landing one is simply there.
            rises(disclosure.made),
          )}
          data-chat-detail
          data-chat-detail-rises={disclosure.made ? "" : undefined}
        >
          {lines !== 0 ? (
            <OperationDetail
              environmentId={ctx.activeThreadEnvironmentId}
              operation={operation}
              threadRef={ctx.threadRef}
              turnRuns={turnRuns}
              {...(regions === null ? {} : { regions })}
            />
          ) : null}
          {failed && !undone ? (
            <OperationFixAction
              environmentId={ctx.activeThreadEnvironmentId}
              operation={operation}
            />
          ) : null}
        </div>
      ) : null}
    </CallRow>
  );
}

function OperationFixAction({
  environmentId,
  operation,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly operation: ZeropsOperation;
}) {
  const mate = useMateOfEnvironment(environmentId);
  return (
    <FixAction
      mate={mate === undefined ? undefined : { projectId: mate.projectId, groupId: undefined }}
      problem={{
        what: operationLineWords(operation),
        at: operation.settledAt ?? operation.anchorAt,
        error: operation.explanation?.reason ?? operation.closing,
        logLines: operation.explanation?.logTail,
        ask: "Find out why, fix it, and try again.",
      }}
    />
  );
}

/** The host a check's address names, its port included: what tells two sites' pages apart. */
function checkHost(subject: string): string {
  return subject.replace(/^[a-z][a-z0-9+.-]*:\/\//iu, "").split(/[/?#]/u)[0] ?? subject;
}

/**
 * The pages it checked in the browser, as their row of the chat from the
 * first check's start: what it checks, and each take in its device's shape
 * as it comes back — the one it is taking now a live frame of the page, in
 * the frame its picture will stand in, so the row never changes height when
 * the picture comes. The stage with every take opens under it.
 */
function ChecksBubble({ strip: recorded }: { readonly strip: BrowserStripModel }) {
  const ctx = use(TimelineRowCtx);
  const calls = useMemo(
    () =>
      recorded.checks.map((check) => ({
        callId: check.callIds.length === 1 ? check.callIds[0]! : null,
        turnId: check.turnId,
      })),
    [recorded.checks],
  );
  const activity = use(TimelineRowActivityCtx);
  const frames = useMateBrowserCallFrames(
    ctx.activeThreadEnvironmentId,
    ctx.threadRef?.threadId ?? null,
    calls,
    activity.isWorking,
  );
  const strip = useMemo(
    () => ({
      ...recorded,
      checks: recorded.checks.map((check, index): ZeropsOperation => {
        const read = frames[index];
        if (read === undefined || read.kind === "unknown") return check;
        const { screenshot: _recorded, ...withoutPicture } = check;
        return read.frame === null
          ? withoutPicture
          : {
              ...check,
              screenshot: {
                src: frameImageSrc(read.frame),
                width: read.frame.width,
                height: read.frame.height,
              },
            };
      }),
    }),
    [recorded, frames],
  );
  const disclosure = useDisclosure();
  const latest = strip.checks.at(-1)!;
  const running = latest.phase === "running";
  const settled = strip.checks.filter((check) => check.phase !== "running");
  // Two pages of one host by name, as one is; more by their count, and so
  // are pages of two hosts, whose paths do not say which is which ("/" on
  // another port is not the app's front page).
  const pages = [...new Set(strip.checks.map(browserCheckCaption))];
  const hosts = new Set(strip.checks.map((check) => checkHost(check.subject)));
  // As the now line said it while it ran: "Checking /status in the browser".
  const words = `${
    running
      ? `Checking ${browserCheckCaption(latest)}`
      : strip.views === 1
        ? `Checked ${browserCheckCaption(latest)}`
        : strip.views === 2 && pages.length === 2 && hosts.size === 1
          ? `Checked ${pages[0]} and ${pages[1]}`
          : `Checked ${strip.views} pages`
  } in the browser`;
  const verdict = running
    ? null
    : strip.failures > 0
      ? strip.failures === 1
        ? "1 check failed"
        : `${strip.failures} checks failed`
      : settled.length === 1
        ? null
        : `${settled.length} checks passed`;
  const startedMs = Date.parse(strip.checks[0]!.anchorAt);
  const endedMs = Date.parse(latest.settledAt ?? latest.anchorAt);
  const tookMs = endedMs - startedMs;
  // How long the row took, from its first check; one still being taken says
  // so — its time ticks on the now line alone.
  const time = running
    ? STILL_RUNNING
    : Number.isFinite(tookMs) && tookMs >= 1000
      ? formatWorkDuration(tookMs)
      : null;
  const failed = strip.failures > 0;
  const takes = strip.checks.some(
    (check) =>
      check.screenshot ||
      check.phase === "running" ||
      browserTakeState(check, strip.checks) === "failed",
  );
  // One take with no picture and nothing read opens onto the same check.
  const opens = opensOnto({
    control: "checks",
    checks: strip.checks.length,
    shown: strip.checks.filter(
      (check) =>
        check.screenshot !== undefined ||
        check.browserRead !== undefined ||
        check.explanation !== undefined,
    ).length,
  });
  const head = (
    <Headline column opens={opens} time={time} timeTone={failed ? "failed" : "muted"}>
      <span>
        <span className="text-foreground/75">{words}</span>
        {verdict === null ? null : (
          <span className={failed ? "text-status-failed-text" : "text-muted-foreground"}>
            {` · ${verdict}`}
          </span>
        )}
      </span>
    </Headline>
  );
  return (
    <CallRow
      failure={failed ? "broken" : null}
      kind="checks"
      mark={failed ? <FailedMark failure="broken" /> : <DidMark icon={AppWindowIcon} />}
    >
      {opens ? (
        <DisclosureButton
          className={CALL_PAD}
          label={`${words}${verdict === null ? "" : `, ${verdict}`}. ${disclosure.open ? "Hide" : "Show"} the checks`}
          onToggle={disclosure.toggle}
          open={disclosure.open}
        >
          {head}
        </DisclosureButton>
      ) : (
        <div className={CALL_PAD}>{head}</div>
      )}
      {disclosure.open || !takes ? null : (
        <div className="px-3 pb-2">
          <BrowserTakes
            threadRef={ctx.threadRef}
            environmentId={ctx.activeThreadEnvironmentId}
            onOpenImage={ctx.onImageExpand}
            takes={strip.checks}
          />
        </div>
      )}
      {opens && disclosure.open ? (
        <div
          className={cn("px-3 pb-2", rises(disclosure.made))}
          data-chat-detail
          data-chat-detail-rises={disclosure.made ? "" : undefined}
        >
          <BrowserStrip
            bare
            environmentId={ctx.activeThreadEnvironmentId}
            onOpenImage={ctx.onImageExpand}
            strip={strip}
            threadRef={ctx.threadRef}
          />
        </div>
      ) : null}
    </CallRow>
  );
}

/** A service's trouble, in its colour: red while broken, amber while it needs the person. */
function IncidentMark({ tone }: { readonly tone: IncidentModel["tone"] }) {
  return (
    <ActivityIcon
      aria-hidden="true"
      className={cn(
        "size-4 shrink-0",
        tone === "failed"
          ? "text-status-failed-text"
          : tone === "attention"
            ? "text-status-attention-text"
            : "text-muted-foreground",
      )}
    />
  );
}

/** A service that stopped answering, and what became of it: its phases in order. */
function IncidentBubble({ incident }: { readonly incident: IncidentModel }) {
  return (
    <Bubble kind="incident" tone="tool" className={BUBBLE_PAD}>
      <span className="font-medium">{incident.hostname}</span>
      <span className="text-muted-foreground">{` ${incident.phases.join(" → ")}`}</span>
    </Bubble>
  );
}

// ---------------------------------------------------------------------------
// Helpers, tasks, its to-do list
// ---------------------------------------------------------------------------

const AGENT_STATUS_WORD: Record<RuntimeSubagent["status"], string> = {
  pending: "Starting",
  running: "Working",
  waiting: "Waiting for you",
  idle: "Idle",
  completed: "Done",
  failed: "Failed",
  cancelled: "Stopped",
  interrupted: "Cut off",
};

/**
 * One helper: its task in the words it was given, its state and its clock —
 * never the model or the harness's role name — and under it what it does
 * now, or what it came to. Pressed, its own card opens in the helpers panel:
 * its steps, its clock, its report whole.
 */
function HelperRow({ agent }: { readonly agent: RuntimeSubagent }) {
  const ctx = use(TimelineRowCtx);
  const active = isActiveSubagentStatus(agent.status);
  const word = AGENT_STATUS_WORD[agent.status];
  const { since, ranMs } = helperSpan(agent);
  const line = active ? helperNowWords(agent) : helperReportLine(agent);
  return (
    <li className="grid min-w-0">
      <button
        aria-label={`${agent.title}: ${word}. Open its work`}
        className="grid min-w-0 cursor-pointer gap-0.5 rounded-lg px-1.5 py-1 text-start transition-colors hover:bg-foreground/4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
        onClick={() => {
          if (ctx.threadRef !== null) showHelper(scopedThreadKey(ctx.threadRef), agent.id);
          ctx.onOpenAgents();
        }}
        type="button"
      >
        <span className={cn("flex min-w-0 items-baseline gap-3", META)}>
          <span
            className={cn(
              "min-w-0 flex-1",
              agent.status === "failed" ? "text-status-failed-text" : "text-foreground/90",
            )}
          >
            {agent.title}
          </span>
          <span className={cn("shrink-0 text-muted-foreground tabular-nums", META)}>
            {word}
            {since !== null ? (
              <>
                {" · "}
                <ElapsedSince since={since} />
              </>
            ) : ranMs !== null && ranMs >= 1000 ? (
              ` · ${formatWorkDuration(ranMs)}`
            ) : null}
          </span>
        </span>
        {line === null ? null : (
          <span className={cn("line-clamp-2 text-muted-foreground", META)}>{line}</span>
        )}
      </button>
    </li>
  );
}

/** A helper's mark where the Mate's face stands in its own run: it works under the Mate. */
function HelperFace() {
  return (
    <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center">
      <BotIcon className="size-4 text-muted-foreground" />
    </span>
  );
}

/** Helpers it started: how many and what for; each one, its state and what it said, opened under it. */
function HelpersBubble({ entry }: { readonly entry: WorkLogEntry }) {
  const ctx = use(TimelineRowCtx);
  const disclosure = useDisclosure();
  const spawn = entry.agentSpawn;
  if (!spawn) return null;
  const { agents, summary, words, what, failed, ended } = helpersBubbleOf(
    ctx.agentPanelModel,
    spawn,
  );
  // Helpers not known yet: nothing to open onto.
  const opens = opensOnto({ control: "helpers", agents: agents.length });
  const head = (
    <Headline column opens={opens} timeTone="muted" time={summary.live ? "Working" : ended}>
      <span>
        <span className="text-foreground/75">{words}</span>
        {what ? <span className="text-muted-foreground">{` · ${what}`}</span> : null}
      </span>
    </Headline>
  );
  return (
    <CallRow
      failure={failed ? "broken" : null}
      kind="helpers"
      mark={failed ? <FailedMark failure="broken" /> : <DidMark icon={BotIcon} />}
    >
      {opens ? (
        <DisclosureButton
          className={CALL_PAD}
          label={`${words}. ${disclosure.open ? "Hide" : "Show"} them`}
          onToggle={disclosure.toggle}
          open={disclosure.open}
        >
          {head}
        </DisclosureButton>
      ) : (
        <div className={CALL_PAD}>{head}</div>
      )}
      {opens && disclosure.open ? (
        // Its helpers' words on the bubble's text edge: 8 px in, and their own 6.
        <div
          className={cn("grid gap-2 px-2 pb-2.5", rises(disclosure.made))}
          data-chat-detail
          data-chat-detail-rises={disclosure.made ? "" : undefined}
        >
          <ul className="grid gap-0.5">
            {agents.map((agent) => (
              <HelperRow key={agent.id} agent={agent} />
            ))}
          </ul>
        </div>
      ) : null}
    </CallRow>
  );
}

function capitalizePhrase(value: string): string {
  const trimmed = value.trim();
  return trimmed.length === 0 ? value : `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
}

/** A task in the words it was given. */
export function taskTitle(entry: WorkLogEntry): string {
  return capitalizePhrase(normalizeCompactToolLabel(entry.toolTitle ?? entry.label));
}

/** What a task reported: a helper's report in words, a shell's output as it printed it. */
function TaskReport({ entry }: { readonly entry: WorkLogEntry }) {
  const report = entry.detail?.trim();
  if (!report) return null;
  return <OutputBlock mono={entry.agentRole === undefined} text={report} />;
}

/** A background task or a helper reporting back, where its result reached the run; its report under it. */
function TaskBubble({ entry }: { readonly entry: WorkLogEntry }) {
  const disclosure = useDisclosure();
  const failed = workEntryDisplayIndicatesToolFailure(entry);
  const words = `${taskTitle(entry)} ${failed ? "failed" : "finished"}`;
  const where = entry.agentRole !== undefined ? "helper" : "ran in the background";
  const reported = Boolean(entry.detail?.trim());
  const line = (
    <Headline column opens={reported}>
      <span className="text-foreground/75">{words}</span>
      <span className="text-muted-foreground">{` · ${where}`}</span>
    </Headline>
  );
  return (
    <CallRow
      failure={failed ? "broken" : null}
      kind="task"
      mark={
        failed ? (
          <FailedMark failure="broken" />
        ) : (
          <DidMark icon={entry.agentRole !== undefined ? BotIcon : SquareTerminalIcon} />
        )
      }
    >
      {reported ? (
        <DisclosureButton
          className={CALL_PAD}
          label={`${words}. ${disclosure.open ? "Hide" : "Show"} what it reported`}
          onToggle={disclosure.toggle}
          open={disclosure.open}
        >
          {line}
        </DisclosureButton>
      ) : (
        <div className={CALL_PAD}>{line}</div>
      )}
      {disclosure.open ? (
        <div
          className={cn("px-3 pb-2", rises(disclosure.made))}
          data-chat-detail
          data-chat-detail-rises={disclosure.made ? "" : undefined}
        >
          <TaskReport entry={entry} />
        </div>
      ) : null}
    </CallRow>
  );
}

/** Its to-do list: how far it got, the step in hand; the list under it. */
function PlanBubble({ plan }: { readonly plan: TurnPlanEntry }) {
  const disclosure = useDisclosure();
  const { steps } = plan.plan;
  const done = steps.filter((step) => step.status === "completed").length;
  const current =
    steps.find((step) => step.status === "inProgress")?.step ??
    steps.find((step) => step.status === "pending")?.step ??
    null;
  // A list of the one step its line names is the whole of it.
  const opens = opensOnto({ control: "plan", steps: steps.map((step) => step.step), current });
  const head = (
    <Headline column opens={opens} time={`${done}/${steps.length}`}>
      <span>
        <span className="text-foreground/75">To-do list</span>
        {current !== null ? <span className="text-muted-foreground">{` · ${current}`}</span> : null}
      </span>
    </Headline>
  );
  return (
    <CallRow kind="plan" mark={<DidMark icon={ListTodoIcon} />}>
      {opens ? (
        <DisclosureButton
          className={CALL_PAD}
          label={`To-do list, ${done} of ${steps.length} done. ${disclosure.open ? "Hide" : "Show"} it`}
          onToggle={disclosure.toggle}
          open={disclosure.open}
        >
          {head}
        </DisclosureButton>
      ) : (
        <div className={CALL_PAD}>{head}</div>
      )}
      {opens && disclosure.open ? (
        <div
          className={cn("px-3 pb-2", rises(disclosure.made))}
          data-chat-detail
          data-chat-detail-rises={disclosure.made ? "" : undefined}
        >
          <PlanSteps steps={steps} />
        </div>
      ) : null}
    </CallRow>
  );
}

// ---------------------------------------------------------------------------
// What stopped it, and what merely happened
// ---------------------------------------------------------------------------

/**
 * Something that stopped it — what it couldn't do: its words in red on the
 * tray's outline, its mark red beside it, never a pink flood; the whole error
 * under it.
 */
function ErrorBubble({ entry }: { readonly entry: WorkLogEntry }) {
  const disclosure = useDisclosure();
  const { label, detail } = entry;
  const more = detail !== undefined && detail.trim() !== label.trim() ? detail.trim() : null;
  const line = (
    <Headline opens={more !== null}>
      <span className="text-status-failed-text">{label}</span>
    </Headline>
  );
  return (
    <Bubble kind="error" tone="tool">
      {more === null ? (
        <div className={BUBBLE_PAD}>{line}</div>
      ) : (
        <DisclosureButton
          className={BUBBLE_PAD}
          label={`${label}. ${disclosure.open ? "Hide" : "Show"} the whole error`}
          onToggle={disclosure.toggle}
          open={disclosure.open}
        >
          {line}
        </DisclosureButton>
      )}
      {disclosure.open && more !== null ? (
        <div
          className={cn("px-3 pb-2", rises(disclosure.made))}
          data-chat-detail
          data-chat-detail-rises={disclosure.made ? "" : undefined}
        >
          <OutputBlock text={more} />
        </div>
      ) : null}
    </Bubble>
  );
}

/** Something that happened in a run, in words: what, then a word more. */
export function recordEventWords(
  event: ConversationEvent,
  speaker: string,
): { readonly words: string; readonly detail: string | null } {
  switch (event.type) {
    case "landed":
      return {
        words: `${event.event.repository} #${event.event.number} landed`,
        detail: event.event.title,
      };
    case "compaction":
      return {
        words: "Context condensed",
        detail: `${speaker} kept a summary of the conversation so far`,
      };
    case "resumed":
      return {
        words: "The usage limit reset",
        detail: `${speaker} picked up where the work stopped`,
      };
    case "command":
      return {
        words: `You ran /${event.command.name}`,
        detail: event.command.args || null,
      };
    case "woke": {
      const what =
        event.title === null
          ? `${event.tasks} ${event.helpers ? "helpers" : "background jobs"}`
          : event.tasks === 1
            ? event.title
            : `${event.title} and ${event.tasks - 1} more`;
      return {
        words: `${what} ${event.failed > 0 ? "failed" : "finished"}`,
        detail: `${speaker} went on`,
      };
    }
  }
}

/** What merely happened: no one's bubble — a caption between hairlines, across the chat. */
function EventCaption({ event }: { readonly event: ConversationEvent }) {
  const ctx = use(TimelineRowCtx);
  const { words, detail } = recordEventWords(event, ctx.speaker.name);
  return (
    <div className={cn("flex min-w-0 items-center gap-3", META)} data-chat-kind="event">
      <span aria-hidden="true" className="h-px min-w-4 flex-1 bg-border/70" />
      <span className="min-w-0 truncate text-muted-foreground">
        <span className="text-foreground/80">{words}</span>
        {detail !== null ? ` · ${detail}` : null}
      </span>
      <span aria-hidden="true" className="h-px min-w-4 flex-1 bg-border/70" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// What the Mate is on now
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// The chat
// ---------------------------------------------------------------------------

type RecordRow = Extract<MessagesTimelineRow, { kind: "record" }>;

/** A line of the chat: its key, stable from its first sight, and where it stands. */
interface ChatLine {
  readonly key: string;
  readonly bubble: ReactNode;
  /** What kind of bubble it is, in the Mate's column beside it; a call wears its own. */
  readonly mark?: ReactNode;
  /** The first line its mark stands beside: the words' by default. */
  readonly markLine?: MarkLine;
  /** A caption across the chat, off the Mate's column. */
  readonly across?: boolean;
  /** The person's words, on their side of the chat. */
  readonly theirs?: boolean;
  /** A thing it did: a row of the card its run of calls shares. */
  readonly call?: boolean;
  /** The Mate's question: the person's answer under it pairs with it. */
  readonly asks?: boolean;
  /** An answer under its question, 6 px under it — a pair, not two lines (K14). */
  readonly pairs?: boolean;
  /** It lands from the live slot by a plop, rather than rising in. */
  readonly plops?: boolean;
}

/** A thought's mark: a small asterisk, fainter than a call's. */
const THOUGHT_MARK = (
  <AsteriskIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground/70" />
);

/** Its words' mark: its own face, at rest — who is speaking, beside what it said. */
function SpeakerMark() {
  const ctx = use(TimelineRowCtx);
  if (ctx.speaker.helper) return <HelperFace />;
  return <MateFace shape={ctx.speaker.shape} size="sm" state="idle" tint={ctx.speaker.tint} />;
}

/** What the chat draws: a line on its own, or a run of calls in one card, keyed by its first. */
type ChatEntry = ChatLine | { readonly key: string; readonly calls: ReadonlyArray<ChatLine> };

/**
 * The chat's lines with each run of calls gathered into one card. A call only
 * ever joins the card at the end, so what arrives grows the last card and
 * never re-keys one above it.
 */
function gatherCalls(lines: ReadonlyArray<ChatLine>): ReadonlyArray<ChatEntry> {
  const entries: ChatEntry[] = [];
  for (const line of lines) {
    const last = entries.at(-1);
    if (line.call !== true) entries.push(line);
    else if (last !== undefined && "calls" in last) {
      entries[entries.length - 1] = { key: last.key, calls: [...last.calls, line] };
    } else entries.push({ key: `calls:${line.key}`, calls: [line] });
  }
  return entries;
}

/**
 * The slot's rows, a card of calls keyed by the first call it ever held: one
 * whose first call leaves first stays the same card, its rows never mounted
 * again (B4), and a new batch's card is a new card, and rises in (E5).
 * `cards` says which card each call last stood in; the next one comes back.
 */
function slotEntries(
  lines: ReadonlyArray<ChatLine>,
  cards: ReadonlyMap<string, string>,
): { readonly entries: ReadonlyArray<ChatEntry>; readonly cards: ReadonlyMap<string, string> } {
  const next = new Map<string, string>();
  const taken = new Set<string>();
  const entries = gatherCalls(lines).map((entry) => {
    if (!("calls" in entry)) return entry;
    const kept = entry.calls
      .map((line) => cards.get(line.key))
      .find((key) => key !== undefined && !taken.has(key));
    const key = kept ?? `calls#${entry.calls[0]?.key ?? entry.key}`;
    taken.add(key);
    for (const line of entry.calls) next.set(line.key, key);
    return { ...entry, key };
  });
  return { entries, cards: next };
}

/** Whether two cards-by-call maps say the same. */
function sameCards(left: ReadonlyMap<string, string>, right: ReadonlyMap<string, string>) {
  return left.size === right.size && [...left].every(([call, card]) => right.get(call) === card);
}

const NO_CARDS: ReadonlyMap<string, string> = new Map();

/**
 * Where the person's words reached the Mate, on their side, in their bubble:
 * an answer to its question whole — it stands nowhere else; a message they
 * sent into the run in short, one line — the message itself stands on the
 * page above the card (the owner, 2026-09-28) — and its pictures small under
 * it, each opening the viewer: never a picture's label standing in for its
 * words (2026-10-01: "it also swallows the text it had").
 */
function PersonMark({ item }: { readonly item: Extract<RecordItem, { kind: "person" }> }) {
  const bubble = cn("max-w-4/5 bg-message text-message-foreground", BUBBLE_SHAPE, BUBBLE_PAD);
  if (item.words !== undefined) {
    return (
      <p className={cn(bubble, "whitespace-pre-wrap break-words", WORDS)} data-chat-kind="person">
        {item.words}
      </p>
    );
  }
  // The client's own placeholder for an image-only message is nothing they wrote.
  const echo = echoOfMessage(
    item.imageOnly ? "" : (item.message?.text ?? ""),
    item.message?.attachments ?? [],
  );
  return (
    <div className={cn(bubble, "grid min-w-0 gap-2")} data-chat-kind="person">
      {echo.line.length > 0 ? <p className={cn("truncate", WORDS)}>{echo.line}</p> : null}
      {echo.pictures.length > 0 ? <PersonPictures pictures={echo.pictures} /> : null}
    </div>
  );
}

/** Files recorded with a question response, beside the answer's own words. */
function AnswerFiles({ attachments }: { readonly attachments: ReadonlyArray<ChatAttachment> }) {
  const { activeThreadEnvironmentId } = use(TimelineRowCtx);
  const pictures = attachments.filter(
    (attachment): attachment is ChatImageAttachment => attachment.type === "image",
  );
  const files = attachments.filter((attachment) => attachment.type !== "image");
  const urls = useMessageFileUrls(activeThreadEnvironmentId, files);
  return (
    <div className="grid gap-2">
      <PersonPictures pictures={pictures} />
      <MessageFilesAbove files={files} urls={urls} />
    </div>
  );
}

/** The pictures of a message the person sent into the run: a compact strip, each opening the viewer on all of them. */
function PersonPictures({ pictures }: { readonly pictures: ReadonlyArray<ChatImageAttachment> }) {
  const { activeThreadEnvironmentId, onImageExpand } = use(TimelineRowCtx);
  const resources = useMemo(() => selectMessageImageResources(pictures), [pictures]);
  const urls = useAssetUrls(activeThreadEnvironmentId, resources);
  const byId = new Map(
    resources.flatMap((resource, index) => {
      const url = urls[index];
      return resource._tag === "attachment" && url ? [[resource.attachmentId, url] as const] : [];
    }),
  );
  const shown = pictures.map((picture) => ({
    picture,
    src: byId.get(picture.id) ?? picture.previewUrl ?? null,
  }));
  const viewable = shown.flatMap(({ picture, src }) =>
    src === null ? [] : [{ src, name: picture.name }],
  );
  return (
    <span className="flex min-w-0 flex-wrap gap-1.5" data-person-pictures>
      {shown.map(({ picture, src }) =>
        src === null ? (
          <span
            key={picture.id}
            aria-label={`Loading ${picture.name}`}
            className="block h-16 w-24 rounded-lg bg-foreground/5"
            role="status"
          />
        ) : (
          <button
            key={picture.id}
            aria-label={`Open ${picture.name}`}
            className="block h-16 w-32 cursor-zoom-in overflow-hidden rounded-lg border border-border/60 bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
            onClick={() =>
              onImageExpand({
                images: viewable,
                index: Math.max(
                  0,
                  viewable.findIndex((view) => view.src === src),
                ),
              })
            }
            type="button"
          >
            <AssetImage
              loading="lazy"
              decoding="async"
              alt={picture.name}
              className="block size-full object-contain"
              src={src}
            />
          </button>
        ),
      )}
    </span>
  );
}

/**
 * A record's item as its line of the chat; `undone` the failures a later step
 * undid (`recoveredFailures`), which stand quiet.
 */
function itemLine(item: RecordItem, undone: ReadonlySet<string>): ChatLine {
  switch (item.kind) {
    case "step":
      return {
        key: item.key,
        bubble: <StepBubble step={item.step} undone={undone.has(item.key)} />,
        call: true,
      };
    case "call":
      if (item.entry.questionAnswer !== undefined) {
        const attachments = Object.values(item.entry.questionAnswer.attachmentsByQuestionId).flat();
        return { key: item.key, bubble: <AnswerFiles attachments={attachments} />, theirs: true };
      }
      return {
        key: item.key,
        bubble: <StepBubble step={stepOf(item.entry, undefined, false)} />,
        call: true,
      };
    case "thought":
      return {
        key: item.key,
        bubble: <ThoughtBubble messages={item.messages} />,
        mark: THOUGHT_MARK,
        markLine: "thought",
      };
    case "note":
      return {
        key: item.key,
        bubble: <NoteBubble message={item.message} />,
        mark: <SpeakerMark />,
      };
    case "question":
      return {
        key: item.key,
        bubble: <QuestionBubble questions={item.questions} />,
        mark: <SpeakerMark />,
        asks: true,
      };
    case "person":
      return { key: item.key, bubble: <PersonMark item={item} />, theirs: true };
    case "operation":
      return {
        key: item.key,
        bubble:
          item.operation.kind === "standup" && item.noResult === undefined ? (
            <StandupBubble operation={item.operation} undone={undone.has(item.key)} />
          ) : (
            <OperationBubble
              noResult={item.noResult}
              operation={item.operation}
              undone={undone.has(item.key)}
            />
          ),
        call: true,
      };
    case "helpers":
      return { key: item.key, bubble: <HelpersBubble entry={item.entry} />, call: true };
    case "task":
      return { key: item.key, bubble: <TaskBubble entry={item.entry} />, call: true };
    case "plan":
      return { key: item.key, bubble: <PlanBubble plan={item.plan} />, call: true };
    case "strip":
      return { key: item.key, bubble: <ChecksBubble strip={item.strip} />, call: true };
    case "incident":
      return {
        key: item.key,
        bubble: <IncidentBubble incident={item.incident} />,
        mark: <IncidentMark tone={item.incident.tone} />,
      };
    case "event":
      return { key: item.key, bubble: <EventCaption event={item.event} />, across: true };
    case "crew-seam":
      return {
        key: item.key,
        bubble: <CrewSeamActivity seam={item.seam} words={item.words} />,
        across: true,
      };
    case "error":
      return {
        key: item.key,
        bubble: <ErrorBubble entry={item.entry} />,
        mark: (
          <OctagonAlertIcon
            aria-hidden="true"
            className="size-4 shrink-0 text-status-failed-text"
          />
        ),
      };
  }
}

/**
 * A line of the chat: the Mate's column — each bubble's mark beside its first
 * line, its face at the column's foot, on the status line — then the bubble;
 * the person's words on their own side; or a caption across both.
 */
function ChatRow({
  lineKey,
  across,
  theirs,
  pairs = false,
  mark,
  markLine,
  children,
}: {
  /** The line it draws: what its plop finds it by. */
  readonly lineKey: string;
  readonly across: boolean;
  readonly theirs: boolean;
  /** It answers the question right above it: 6 px under it, not 12. */
  readonly pairs?: boolean;
  readonly mark?: ReactNode;
  readonly markLine?: MarkLine | undefined;
  readonly children: ReactNode;
}) {
  const rises = useRisesIn();
  // What it opens is kept by its key, across its slot row and its history row.
  children = <ChatLineContext value={lineKey}>{children}</ChatLineContext>;
  if (across) {
    return (
      <li className="min-w-0" data-chat-row data-run-key={lineKey}>
        {children}
      </li>
    );
  }
  return (
    <li
      className={cn("flex min-w-0 items-start", MARK_GAP, pairs && "-mt-1.5")}
      data-chat-row
      data-run-key={lineKey}
    >
      {/* The Mate's column, on a phone's card too: it holds the marks that
          tell the bubbles apart, so every bubble keeps one edge. */}
      {mark === undefined ? (
        <span aria-hidden="true" className={MARK_COLUMN} />
      ) : (
        <Mark line={markLine}>{mark}</Mark>
      )}
      {/* Only what arrives while the person watches rises in. */}
      <div
        className={cn("flex min-w-0 flex-1", theirs && "justify-end", rises && "run-rise")}
        data-run-rises={rises ? "" : undefined}
      >
        {children}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// The now line
// ---------------------------------------------------------------------------

/**
 * The run's clock, m:ss, counting while the run goes on — the Mate's own
 * time: it stands still while a question waits on the person. Its text node
 * updates, the line never re-renders.
 */
function RunTicker({ status }: { readonly status: RunStatus }) {
  const ref = useRef<HTMLSpanElement>(null);
  // What it last showed: it never counts back (`calmClockMs`).
  const last = useRef<{ readonly run: string; readonly ms: number } | null>(null);
  const { startedAt, waitingSince, waitedMs } = status;
  const elapsed = () => {
    const now = waitingSince === null ? Date.now() : Date.parse(waitingSince);
    return now - Date.parse(startedAt) - waitedMs;
  };
  const read = () => {
    const ms = calmClockMs(last.current, startedAt, elapsed());
    last.current = { run: startedAt, ms };
    return formatClock(ms);
  };
  // A steady clock: each second turns on the run's own second, however often
  // the card draws — a draw never restarts the count, so no second is ever
  // skipped or held twice.
  const paint = useEffectEvent((): number => {
    if (ref.current) ref.current.textContent = read();
    const into = elapsed() % 1000;
    return Number.isFinite(into) && into >= 0 ? into : 0;
  });
  useEffect(() => {
    if (waitingSince !== null) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      timer = setTimeout(tick, 1000 - paint() + 5);
    };
    tick();
    return () => clearTimeout(timer);
  }, [startedAt, waitingSince, waitedMs]);
  return (
    <span ref={ref} className="run-now-clock" data-work-line-clock>
      {read()}
    </span>
  );
}

/**
 * A step as the now line says it, sweeping while it runs: its own words and a
 * command's code after them, a command that said nothing of itself as its
 * code, a call said plainly with the names it took in mono.
 */
function StepNowWords({
  step,
  sweeps = true,
  codeAfter = true,
}: {
  readonly step: WorkStep;
  /** The one step on the line sweeps; a line each of several at once stands still. */
  readonly sweeps?: boolean;
  /** A command's first line after its words — not where its whole stands under them. */
  readonly codeAfter?: boolean;
}) {
  if (step.kind === "command" && step.words === null) {
    return (
      <RunShimmer className="run-now-verb run-now-mono" inline sweeps={sweeps}>
        {step.code}
      </RunShimmer>
    );
  }
  if (step.kind !== "command" && step.phrase !== null) {
    return (
      <RunShimmer className="run-now-verb" inline sweeps={sweeps}>
        {step.phrase.verb}
        {keyedByOccurrence(step.phrase.targets).map(({ key, value }, index, all) => (
          <Fragment key={key}>
            {index === 0 ? " " : index === all.length - 1 ? " and " : ", "}
            <span className="run-now-mono">{value}</span>
          </Fragment>
        ))}
        {step.phrase.more > 0 ? ` and ${step.phrase.more} more` : null}
      </RunShimmer>
    );
  }
  return (
    <>
      <RunShimmer className="run-now-verb" inline sweeps={sweeps}>
        {stepNowWords(step)}
      </RunShimmer>
      {codeAfter && step.kind === "command" && step.code !== null ? (
        <span className="run-now-code">{step.code}</span>
      ) : null}
    </>
  );
}

/** The now line's words, by what the run is doing. */
function NowWords({ line }: { readonly line: NowLineModel }) {
  switch (line.kind) {
    case "thinking":
      return (
        <>
          <span className="run-now-verb">Thinking</span>
          {line.thought === null ? null : <span className="run-now-thought">{line.thought}</span>}
        </>
      );
    case "step":
      return <StepNowWords step={line.step} />;
    case "operation":
      return (
        <>
          <RunShimmer className="run-now-verb" inline sweeps>
            {operationNowWords(line.operation)}
          </RunShimmer>
        </>
      );
    case "several":
      return <span className="run-now-verb">{severalCallsWords(line.calls)}</span>;
    case "waiting":
      return <span className="run-now-verb">{nowLineWords(line)}</span>;
    case "after":
    case "starting":
      return (
        <>
          <span className="run-now-verb">{nowLineWords(line)}</span>
          <TypingDots className="run-now-dots" />
        </>
      );
    case "writing":
      return (
        <>
          <span className="run-now-verb">Writing</span>
          <TypingDots className="run-now-dots" />
        </>
      );
    case "condensing":
      return (
        <>
          <span className="run-now-verb">Condensing the context</span>
          <TypingDots className="run-now-dots" />
        </>
      );
    case "worked":
      return (
        <>
          <span className="run-now-worked">{line.words}</span>
          {line.effort === null ? null : (
            <span className="run-now-effort">{` · ${line.effort}`}</span>
          )}
        </>
      );
  }
}

/** How long the words a line leaves take to go: their fade, and a frame to spare. */
const LINE_LEAVES_MS = 160;

/**
 * The words the now line just left, as it last drew them, while they fade
 * where they stood (`.run-now-leaving`); null once gone, and on a first paint.
 */
function useLeavingLine(
  line: NowLineModel,
  words: string,
): { readonly line: NowLineModel; readonly words: string } | null {
  const drawn = useRef({ line, words });
  const [swap, setSwap] = useState<{
    readonly words: string;
    readonly leaving: { readonly line: NowLineModel; readonly words: string } | null;
  }>({ words, leaving: null });
  if (swap.words !== words) setSwap({ words, leaving: drawn.current });
  useLayoutEffect(() => {
    drawn.current = { line, words };
  });
  const leaving = swap.leaving;
  useEffect(() => {
    if (leaving === null) return;
    const timer = setTimeout(
      () => setSwap((current) => ({ ...current, leaving: null })),
      LINE_LEAVES_MS,
    );
    return () => clearTimeout(timer);
  }, [leaving]);
  return leaving;
}

/**
 * The card's foot, the now line (K10): the Mate's face, what it is doing this
 * moment in words — the step itself while it runs, which lands in the chat
 * above once it ends — and the run's one clock (K3), in ink (S3). The
 * present stands in one place and only its words change, rising into it; the
 * past piles up above it. Once the run is over it is the worked line: who,
 * how long, and what the effort came to.
 */
function NowLine({
  status,
  now: recordedNow,
  answering,
  outcome,
  end = null,
  settledHere = false,
}: {
  readonly status: RunStatus;
  readonly now: TurnHeaderActivity | null;
  readonly answering: boolean;
  /** What the run came to: its effort, on the worked line (`useRunEffortWords`). */
  readonly outcome: OutcomeModel | null;
  /** A control in the right column, beside the clock while the run is live. */
  readonly end?: ReactNode;
  /**
   * The person watched the run end here: its worked line takes the working
   * row's place rising into it, as the line's words change in place — never a
   * swap in one frame (run 11).
   */
  readonly settledHere?: boolean;
}) {
  const now = useEngineLiveNow(recordedNow);
  const ctx = use(TimelineRowCtx);
  const { isCompacting } = use(TimelineRowActivityCtx);
  const effort = useRunEffortWords(outcome);
  const baseLine = nowLineOf({
    status,
    now,
    answering,
    compacting: isCompacting,
    speaker: ctx.speaker.name,
    effort,
  });
  const latest =
    !status.live && status.interruption !== undefined
      ? {
          kind: "worked" as const,
          words:
            status.interruption.continuation === "automatic"
              ? `${restartWords(ctx.speaker.name, status.interruption, ctx.timestampFormat)} · continuation scheduled`
              : status.interruption.continuation === "requested"
                ? `${restartWords(ctx.speaker.name, status.interruption, ctx.timestampFormat)} · continuation requested`
                : status.interruption.continuation === "continued"
                  ? `${restartWords(ctx.speaker.name, status.interruption, ctx.timestampFormat)} · continued automatically`
                  : `Interrupted — ${restartWords(ctx.speaker.name, status.interruption, ctx.timestampFormat)}`,
          effort: null,
        }
      : baseLine;
  // A line once shown stands a moment, and a burst shows its latest only
  // (`nowLineCalm.logic`); the run's end shows at once.
  const line = useCalmLine(latest, nowLineWords(latest), !status.live);
  const settledFace = nowLineFace(line, status);
  const restartPending =
    !status.live &&
    status.interruption?.continuation === "manual" &&
    ctx.interruption != null &&
    ctx.interruption.turnId === status.interruption.turnId &&
    ctx.interruption.messageId === status.interruption.messageId;
  const face = restartPending ? { ...settledFace, state: "needs" as const } : settledFace;
  const words = nowLineWords(line);
  // The line's words change in place as the run goes: the old ones leave
  // where they stood as the new ones rise into it, so a change reads as the
  // same line saying something new.
  const wordsChanged = useChangedSinceShown(words);
  const [risesIn] = useState(settledHere);
  const leaving = useLeavingLine(line, words);
  const head = (
    <span
      key={words}
      className="run-now-head"
      data-run-now-change={wordsChanged || risesIn ? "" : undefined}
    >
      <NowWords line={line} />
    </span>
  );
  return (
    <div
      className="run-now"
      data-run-now={line.kind}
      data-run-status={
        line.kind === "worked" ? status.face : line.kind === "waiting" ? "waiting" : "working"
      }
    >
      {ctx.speaker.helper ? (
        <HelperFace />
      ) : (
        <MateFace
          gaze={face.gaze}
          greets
          known={ctx.arrivedAfter !== null && !ctx.syncing}
          shape={ctx.speaker.shape}
          size="sm"
          state={face.state}
          tint={ctx.speaker.tint}
        />
      )}
      <div className="run-now-words" data-work-line={status.face}>
        {leaving === null ? null : (
          <span aria-hidden="true" className="run-now-head run-now-leaving" key={leaving.words}>
            <NowWords line={leaving.line} />
          </span>
        )}
        {head}
        {/* What a screen reader hears: the line's words as they change —
            never the thought's latest words or a step's ticking time. */}
        {status.live ? (
          <span className="sr-only" role="status">
            {words}
          </span>
        ) : null}
      </div>
      {status.live ? (
        <span className="flex items-center gap-3">
          <RunTicker status={status} />
          {end}
        </span>
      ) : restartPending && ctx.queueBlockedByAnswer ? (
        <span className="flex items-center gap-2">
          <span>Answer the pending question to continue.</span>
          {end}
        </span>
      ) : restartPending ? (
        <span className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={ctx.onRestartContinue == null}
            onClick={() => ctx.onRestartContinue?.(status.interruption!)}
          >
            Continue
          </Button>
          {end}
        </span>
      ) : (
        (end ?? <span />)
      )}
      {/* A run that broke off ends on why, under its line, in the words the
          server gave it: never a stack. Watched as it ends, its room opens
          as the line settles — never a jump of the card. */}
      {!status.live && status.brokeOff !== undefined ? (
        <BrokeOffLine brokeOff={status.brokeOff} rises={risesIn} />
      ) : null}
    </div>
  );
}

/**
 * Why a run broke off, under its line, and on the latest run what to do
 * next. When a later run begins, what to do next leaves; its words keep their
 * room, unseen, while the line stays on screen — a wrapped line never shrinks
 * the card under the person's eyes. Drawn anew, the line is its reason alone.
 */
function BrokeOffLine({
  brokeOff,
  rises,
}: {
  readonly brokeOff: BrokeOff;
  /** Watched as the run ends: its room opens as the line settles. */
  readonly rises: boolean;
}) {
  const [heldNext, setHeldNext] = useState(brokeOff.next);
  if (brokeOff.next !== null && brokeOff.next !== heldNext) setHeldNext(brokeOff.next);
  return (
    <div
      className={cn("grid min-w-0 [grid-column:2/-1]", rises && "motion-safe:animate-room-open")}
      data-run-broke-off
    >
      <p className="min-h-0 min-w-0 overflow-hidden pt-0.5 text-sm leading-5 text-status-failed-text">
        {brokeOff.reason}
        {heldNext === null ? null : (
          <span
            aria-hidden={brokeOff.next === null ? true : undefined}
            className={brokeOff.next === null ? "invisible" : undefined}
          >
            {` ${heldNext}`}
          </span>
        )}
      </p>
    </div>
  );
}

/**
 * The line of a run with no chat to end on — one that only asked for a plan's
 * approval, or paused before it did anything: the now line alone.
 */
export function RunLine({ status }: { readonly status: RunStatus }) {
  return <NowLine answering={false} now={null} outcome={null} status={status} />;
}

/**
 * The boxes in a run's chat whose height eases as what they hold grows
 * (`easeRooms`): a bubble, a card of calls, and a deploy's step, which gains
 * its failure or its log under it as it ends — eased there, the steps under
 * it ride its edge instead of dropping 32 px in a frame (R12-26).
 */
const EASED_BOXES = "[data-chat-bubble],[data-chat-calls],[data-zerops-pipeline-step]";

/** What the motions of a run's card share: the live slot's rooms, read by the history beside it. */
interface RunMotion {
  slot: Rooms | null;
  /** The speed a frame gives the slot's and the history's eases, each way. */
  readonly budget: EaseBudget;
}

const NO_KEYS: ReadonlyArray<string> = [];
const NO_HOLDS: ReadonlySet<string> = new Set();

/** Lines landing from the live slot: where each stood, and where the history's lines stood. */
interface Landing {
  /** Each line leaving the slot by its key, by where its row stood (NaN: it rode along unseen). */
  readonly from: ReadonlyMap<string, number>;
  /** The lines leaving that stood in the slot: they join the history at once (`usePace`). */
  readonly hosts: ReadonlySet<string>;
  /** Where the slot stood: what lands above it moves it, and it glides there. */
  readonly slot: number | null;
  /** How tall the card's row stood: a list that follows its end moves it a frame late. */
  readonly card: number | null;
  /** The history's lines by their key, by where each stood on screen. */
  readonly rows: ReadonlyMap<string, number>;
  /**
   * The slot's rows, by where each stood in it (from the slot's top): one that
   * stays keeps its place in the slot as a row above it leaves.
   */
  readonly staying: ReadonlyMap<string, number>;
  /** How tall each leaving line's bubble stood in the slot: it grows from there in the history. */
  readonly bubbles: ReadonlyMap<string, number>;
}

/** Where each of the chat's lines under `root` stands on screen, by its key. */
function lineTops(root: HTMLElement | null): ReadonlyMap<string, number> {
  const tops = new Map<string, number>();
  if (typeof root?.querySelectorAll !== "function") return tops;
  for (const line of root.querySelectorAll<HTMLElement>("li[data-chat-row][data-run-key]")) {
    tops.set(line.dataset.runKey!, line.getBoundingClientRect().top);
  }
  return tops;
}

/**
 * Where each row under `root` stands — a card of calls and each call in it —
 * by its key, from `from` (the root's top on screen).
 */
function rowTops(root: HTMLElement | null, from: number): ReadonlyMap<string, number> {
  const tops = new Map<string, number>();
  if (typeof root?.querySelectorAll !== "function") return tops;
  for (const row of root.querySelectorAll<HTMLElement>("[data-chat-row][data-run-key]")) {
    tops.set(row.dataset.runKey!, row.getBoundingClientRect().top - from);
  }
  return tops;
}

/** How tall the first bubble of each row under `root` stands, by the row's key. */
function bubbleHeights(root: HTMLElement | null): ReadonlyMap<string, number> {
  const heights = new Map<string, number>();
  if (typeof root?.querySelectorAll !== "function") return heights;
  for (const row of root.querySelectorAll<HTMLElement>("[data-chat-row][data-run-key]")) {
    const bubble = row.matches("[data-chat-bubble]")
      ? row
      : row.querySelector<HTMLElement>("[data-chat-bubble]");
    if (bubble !== null) heights.set(row.dataset.runKey!, bubble.getBoundingClientRect().height);
  }
  return heights;
}

/** The row drawn for the chat's line `key` under `root`, if one is. */
function rowByKey(root: HTMLElement | null, key: string): HTMLElement | null {
  if (typeof root?.querySelectorAll !== "function") return null;
  for (const row of root.querySelectorAll<HTMLElement>("[data-run-key]")) {
    if (row.dataset.runKey === key) return row;
  }
  return null;
}

/** How long a "Thinking" between steps waits before its word shows: a quick gap never flashes. */
const THINKING_WORD_DELAY_MS = 300;

/**
 * A line the slot drew live that ended with no line of its own in the record:
 * said over, never still running — a step in its settled words.
 */
function endedLine(item: RecordItem): RecordItem {
  if (item.kind !== "step" || item.step.state !== "running") return item;
  const last = item.step.entries.at(-1);
  if (last === undefined) return item;
  const over = stepOf({ ...last, toolLifecycleStatus: "completed" }, undefined, false);
  return { ...item, step: { ...over, key: item.step.key } };
}

/** Sets a property of an element's own style, or takes it away; nothing when it says that already. */
function writeStyle(element: HTMLElement, name: string, value: string | null): void {
  if ((element.style.getPropertyValue(name) || null) === value) return;
  if (value === null) element.style.removeProperty(name);
  else element.style.setProperty(name, value);
}

/**
 * Places the live slot's face and clock on its first line, and says the room
 * the slot takes, its gap above it included: on a short page the card holds
 * it whole once the history has none left to give.
 */
function placeSlot(list: HTMLOListElement | null): void {
  // Drawn outside a page (a test's renderer), it has no layout to read.
  if (typeof list?.querySelector !== "function") return;
  const mark = list.querySelector<HTMLElement>("[data-slot-mark] > span");
  const slotBox = list.parentElement;
  if (slotBox === null) return;
  // Every box read before anything is written: a write between two reads
  // restyled the card, and the second read laid it out again.
  const line = mark?.getBoundingClientRect();
  const slotRect = slotBox.getBoundingClientRect();
  const y = line === undefined ? null : line.top + line.height / 2 - slotRect.top;
  // The room the slot takes, its gap above it included: on a short page
  // the card holds it whole once the history has none left to give.
  const chat = slotBox.parentElement;
  const above = slotBox.previousElementSibling ?? null;
  const from =
    chat === null
      ? null
      : above === null
        ? chat.getBoundingClientRect().top
        : above.getBoundingClientRect().bottom;
  writeStyle(slotBox, "--run-slot-line", y === null ? null : `${y}px`);
  // Said on the card, which every line of it inherits: written only when it changes.
  if (chat !== null && from !== null) {
    writeStyle(chat, "--run-slot-room", `${Math.ceil(slotRect.bottom - from)}px`);
  }
  // They move with the first line only once placed: a first paint, a
  // thread opened or a card scrolled back to never slides them in.
  if (!slotBox.hasAttribute("data-placed")) {
    requestAnimationFrame(() => slotBox.setAttribute("data-placed", ""));
  }
}

/**
 * What the slot says when no item stands in it: "Thinking" — muted, its word
 * a moment late, so a quick gap between two steps never flashes it — its
 * words on their way, a wait on the person, the context condensing.
 */
function SlotFillerWords({ filler }: { readonly filler: SlotFiller }) {
  // On the slot's first draw it is simply there: a page opening never waits for it.
  const late = useArrivedLive();
  switch (filler.kind) {
    case "thinking":
      return late ? (
        <span
          className="run-slot-word run-slot-later"
          style={{ animationDelay: `${THINKING_WORD_DELAY_MS}ms` }}
        >
          Thinking
        </span>
      ) : (
        <span className="run-slot-word">Thinking</span>
      );
    case "writing":
      return (
        <>
          <span className="run-slot-word">Writing</span>
          <TypingDots className="run-now-dots" />
        </>
      );
    case "condensing":
      return (
        <>
          <span className="run-slot-word">Condensing the context</span>
          <TypingDots className="run-now-dots" />
        </>
      );
    case "waiting":
      return (
        <span className="run-slot-word">{nowLineWords({ kind: "waiting", on: filler.on })}</span>
      );
    case "after":
    case "starting":
      return (
        <>
          <span className="run-slot-word">{nowLineWords(filler)}</span>
          <TypingDots className="run-now-dots" />
        </>
      );
  }
}

/**
 * The live slot, the card's foot while the run goes on (pass 35, replacing
 * the one-line now line): the Mate's face in the 28 px column, the run's one
 * clock on its first line's right edge, and what the Mate is doing this
 * moment drawn whole, as the row it becomes in the history — the same
 * bubble, inks and caps, with a sweep over a call's words while it runs and
 * no chevron: it shows the thing in full up to its cap. Several at once are
 * a row each, three at most, then "+N more running". Nothing standing in it,
 * it says what the Mate does between things: "Thinking", "Writing", a wait.
 */
const NO_ITEMS: ReadonlyMap<string, RecordItem> = new Map();

/** What the empty slot says, as a key: the same words are no change. */
function fillerKey(filler: SlotFiller): string {
  return filler.kind === "waiting" ? `${filler.kind}:${filler.on}` : filler.kind;
}

function LiveSlot({
  ref,
  folded,
  end,
  slot,
  live,
  items,
  filler,
  now: recordedNow,
  answering,
  status,
  undone,
  motionRef,
}: {
  readonly ref: Ref<HTMLDivElement>;
  readonly folded: boolean;
  readonly end: ReactNode;
  readonly slot: LiveSlotState;
  /** What is live now, as the items they become. */
  readonly live: ReadonlyArray<RecordItem>;
  /** The record: what an item that ended and stands its minimum is drawn from. */
  readonly items: ReadonlyArray<RecordItem>;
  readonly filler: SlotFiller;
  readonly now: TurnHeaderActivity | null;
  readonly answering: boolean;
  readonly status: RunStatus;
  readonly undone: ReadonlySet<string>;
  /** Its card's motion: the history reads the slot's ease from it. */
  readonly motionRef: { readonly current: RunMotion };
}) {
  const now = useEngineLiveNow(recordedNow);
  const ctx = use(TimelineRowCtx);
  const { isCompacting } = use(TimelineRowActivityCtx);
  // What the face and a screen reader say stands its dwell, as the slot's
  // items do: a call of 180 ms between two thoughts never flips them.
  const doing = nowLineOf({
    status,
    now,
    answering,
    compacting: isCompacting,
    speaker: ctx.speaker.name,
    effort: null,
  });
  const latest = useCalmLine(doing, nowLineWords(doing), !status.live);
  const face = nowLineFace(latest, status);
  // "Thinking", "Writing", a wait: what the empty slot says stands its dwell too.
  const said = useCalmLine(filler, fillerKey(filler), !status.live);
  // What each entry last showed live: one that ended with no line of its own
  // in the record yet stands its minimum as it last showed, never a gap.
  const [lastLive, setLastLive] = useState<ReadonlyMap<string, RecordItem>>(NO_ITEMS);
  if (live.some((item) => lastLive.get(item.key) !== item)) {
    const standing = new Set(slot.entries.map((entry) => entry.key));
    setLastLive(
      new Map([
        ...[...lastLive].filter(([key]) => standing.has(key)),
        ...live.map((item) => [item.key, item] as const),
      ]),
    );
  }
  const byKey = new Map<string, RecordItem>();
  for (const [key, item] of lastLive) {
    // A check the record drew into the row of the one before it is drawn there.
    if (item.kind !== "strip") byKey.set(key, live.includes(item) ? item : endedLine(item));
  }
  for (const item of items) {
    // A call the record folded into the line before it is drawn as it ended
    // while it stands here (`parts`).
    if (item.kind === "step") {
      for (const part of item.parts ?? []) byKey.set(part.key, part);
    }
    byKey.set(item.key, item);
  }
  for (const item of live) byKey.set(item.key, item);
  const shown = slot.entries.flatMap((entry) => {
    // One the record drew into another line (a check joining the row of the
    // one before it) is drawn there already.
    const item = byKey.get(entry.key);
    if (item === undefined) return [];
    // A question's answer rises in under it, and the pair plops as one.
    const said =
      item.kind === "question" && entry.answer !== undefined ? byKey.get(entry.answer) : undefined;
    const answer = said?.kind === "person" ? [{ entry, item: said }] : [];
    return [{ entry, item }, ...answer];
  });
  const drawn = shown.slice(0, SLOT_MAX_ROWS);
  const more = slotRunningPast(shown);
  // The deploy line standing open keeps standing until it plops.
  const [heldOpen, setHeldOpen] = useState<string | null>(null);
  const standsOpen = slotOpenDeployLine(
    drawn.flatMap(({ item }) =>
      item.kind === "operation" && item.noResult === undefined
        ? [{ key: item.key, operation: item.operation }]
        : [],
    ),
    heldOpen,
  );
  if (standsOpen !== heldOpen) setHeldOpen(standsOpen);
  const lines = drawn
    .map(({ item }) => itemLine(item, undone))
    .map((line, index, all) =>
      line.theirs === true && all[index - 1]?.asks === true ? { ...line, pairs: true } : line,
    );
  // The clock counts what the first line shows, never the run beside a step
  // (`slotClock`); a wait on the person stands it still.
  const firstDrawn = lines.length === 0 ? undefined : drawn[0];
  const clock = slotClock(
    slot,
    firstDrawn === undefined ? null : { key: firstDrawn.entry.key, at: firstDrawn.item.at },
    status.waitingSince,
    status.waitingOnHelpers === true,
  );
  // The thing's own time: what the run waited elsewhere is the run's clock's
  // to leave out, and a wait on the person is counted as itself.
  const ticker: RunStatus | null =
    clock === null
      ? null
      : { ...status, startedAt: clock.from, waitedMs: 0, waitingSince: clock.stopped };
  // Which card each call stands in, kept from draw to draw (`slotEntries`).
  const [cards, setCards] = useState<ReadonlyMap<string, string>>(NO_CARDS);
  const slotted = slotEntries(lines, cards);
  if (!sameCards(cards, slotted.cards)) setCards(slotted.cards);
  const listRef = useRef<HTMLOListElement>(null);
  // What enters after the slot's first draw arrived while the person watched.
  const shownRef = useRef(false);
  useLayoutEffect(() => {
    shownRef.current = true;
  }, []);
  // Its room eases as rows come and go (`easeRooms`), uncovering a row that
  // joins at its foot; nothing eases on a resync.
  const syncingRef = useRef(ctx.syncing);
  const slotRoomsRef = useRef<Rooms | null>(null);
  useLayoutEffect(() => {
    syncingRef.current = ctx.syncing;
  }, [ctx.syncing]);
  useLayoutEffect(() => {
    const list = listRef.current;
    const slotBox = list?.parentElement;
    if (list === null || slotBox === null || slotBox === undefined) return;
    const rooms = easeRooms({
      root: slotBox,
      selector: EASED_BOXES,
      eases: () => shownRef.current && !syncingRef.current,
      rootClips: true,
      budget: motionRef.current.budget,
    });
    slotRoomsRef.current = rooms;
    const motion = motionRef.current;
    motion.slot = rooms;
    return () => {
      rooms.stop();
      slotRoomsRef.current = null;
      if (motion.slot === rooms) motion.slot = null;
    };
  }, [motionRef]);
  // Every commit, before the list's row measures it in its own.
  useLayoutEffect(() => slotRoomsRef.current?.flush());
  // The face and the clock stand on the first line, whatever bubble it is in.
  // Read once its room holds the height it showed: a slot read at its new
  // height first lowered the card's cap at once, and the card bounced back
  // the next frame as the slot eased (a phone's card, run 9).
  // Read once the page is laid out, before it paints: in the draw itself it
  // laid the page out early, on every word streamed into the slot.
  useLayoutEffect(() => {
    afterLayout(() => placeSlot(listRef.current));
    // Read when what it shows changed, never on every draw.
  }, [slot, live, items, said, lines.length]);
  // A row opened or shut in place, or the page resized: the room it takes
  // changes with no change of what it shows.
  useEffect(() => {
    const slotBox = listRef.current?.parentElement;
    if (slotBox === null || slotBox === undefined || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => placeSlot(listRef.current));
    observer.observe(slotBox);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className="run-slot"
      hidden={folded}
      style={folded ? { display: "none" } : undefined}
      data-run-now={lines.length === 0 ? said.kind : "items"}
      data-run-status={latest.kind === "waiting" ? "waiting" : "working"}
      data-work-line={status.face}
    >
      <span className="run-slot-face">
        {ctx.speaker.helper ? (
          <HelperFace />
        ) : (
          <MateFace
            gaze={face.gaze}
            greets
            known={ctx.arrivedAfter !== null && !ctx.syncing}
            shape={ctx.speaker.shape}
            size="sm"
            state={face.state}
            tint={ctx.speaker.tint}
          />
        )}
      </span>
      <InSlotContext value>
        <SlotStandsOpenContext value={standsOpen}>
          <ChatShownContext value={shownRef}>
            <ol ref={listRef} className="run-slot-list">
              {lines.length === 0 ? (
                <li key={`filler:${said.kind}`} className="run-slot-filler">
                  <span aria-hidden="true" className={MARK_COLUMN} data-slot-mark="">
                    <span className="flex h-[1lh] items-center" />
                  </span>
                  <span className="run-now-words">
                    <SlotFillerWords filler={said} />
                  </span>
                </li>
              ) : (
                slotted.entries.map((entry) =>
                  "calls" in entry ? (
                    <ChatRow key={entry.key} across={false} lineKey={entry.key} theirs={false}>
                      <CallGroup>
                        {entry.calls.map((line) => (
                          <ChatLineContext key={line.key} value={line.key}>
                            {line.bubble}
                          </ChatLineContext>
                        ))}
                      </CallGroup>
                    </ChatRow>
                  ) : (
                    <ChatRow
                      key={entry.key}
                      across={entry.across === true}
                      lineKey={entry.key}
                      mark={entry.mark}
                      markLine={entry.markLine}
                      pairs={entry.pairs === true}
                      theirs={entry.theirs === true}
                    >
                      {entry.bubble}
                    </ChatRow>
                  ),
                )
              )}
              {more > 0 ? <li className="run-slot-more">{`+${more} more running`}</li> : null}
            </ol>
          </ChatShownContext>
        </SlotStandsOpenContext>
      </InSlotContext>
      <span className="run-slot-clock" data-run-clock-waiting={clock?.waiting ? "" : undefined}>
        {clock?.waiting ? <span className="sr-only">Waiting for you </span> : null}
        {ticker === null ? null : <RunTicker status={ticker} />}
        {end}
      </span>
      {/* What a screen reader hears: what the slot shows, as it changes. */}
      <span className="sr-only" role="status">
        {slotWords(firstDrawn?.item ?? null, said)}
      </span>
    </div>
  );
}

/**
 * A run's chat in its card: what the Mate said and did, in the order it
 * happened, in one scroll, and under it the Mate's status — the present said
 * once. As the run settles its work eases shut into the line, the summary
 * (the owner, 2026-09-29: "why didn't this autocollapse at the end?"), unless
 * the person is reading the work right then; a run they come back to is
 * closed to that line, and "Show work" opens the scroll under it.
 */
export function RunChat({ row }: { readonly row: RecordRow }) {
  // What the person opened, kept as a row lands from the slot in the history.
  const [carriedOpen] = useState(() => new Map<string, Carried>());
  const ctx = use(TimelineRowCtx);
  // An engine run too long to read whole: its effort from its summary, its lines a page at a time.
  const paging = row.paging;
  const pages = useEngineCardPages(paging);
  const outcome = row.outcome;
  const hold = useHoldReading();
  const rootRef = useRef<HTMLDivElement>(null);
  const aboveRef = useRef<HTMLDivElement>(null);
  // Whether the person reads the work this moment — scrolled up in it, or
  // something in it opened: a run settling then stays open.
  const readingRef = useRef(false);
  // How the history's scroll keeps to its foot, for a line landing in it.
  const keepScrollRef = useRef<(() => void) | null>(null);
  // How its boxes ease (`easeRooms`), for a line landing in it.
  const historyRoomsRef = useRef<Rooms | null>(null);
  // What its parts' motions share (`RunMotion`).
  const motionRef = useRef<RunMotion>({ slot: null, budget: { at: -1, grow: 0, shrink: 0 } });
  // What in it involves the person: a question it asked, their words in it.
  const personKeys = useMemo(
    () =>
      row.items.flatMap((item) =>
        item.kind === "question" || item.kind === "person" ? [item.key] : [],
      ),
    [row.items],
  );
  const { fold, foldNow, settling, motionAllowed } = useRunFold({
    conversation: ctx.routeThreadKey,
    run: row.turnKey,
    live: row.live,
    asks: row.now?.kind === "waiting",
    personKeys,
    readingRef,
    rootRef,
    aboveRef,
    onFoldWork: ctx.onFoldWork ?? foldWork,
  });
  // The card's own height eases (`easeRooms`) as its parts come and go — the
  // history's scroll arriving with its first line, the slot giving way to the
  // line, the live height let go — for a run watched live here; what changes
  // inside the history and the slot is theirs to ease.
  const watchedRef = useRef(false);
  const cardEasesRef = useRef(false);
  useLayoutEffect(() => {
    if (row.live && !ctx.syncing) watchedRef.current = true;
    cardEasesRef.current = watchedRef.current && !ctx.syncing;
  });
  const cardRoomsRef = useRef<Rooms | null>(null);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    const rooms = easeRooms({
      root,
      selector: ":not(*)",
      eases: () => cardEasesRef.current,
      rootClips: true,
      attributes: ["data-run-live"],
    });
    cardRoomsRef.current = rooms;
    return () => {
      rooms.stop();
      cardRoomsRef.current = null;
    };
  }, []);
  // A run the person comes back to (D3), or one that just settled: its
  // worked line alone — the summary — and "Show work" opens the whole run
  // under it (K12).
  const settled = row.status !== null && !row.live;
  // Watched live here, it ends under the person's eyes: its line rises in.
  const [watchedLive, setWatchedLive] = useState(row.live && !ctx.syncing);
  if (row.live && !ctx.syncing && !watchedLive) setWatchedLive(true);
  const shows = runCardShows(settled, fold, row.hasWork);
  const folded = shows.toggle === "show";
  const liveFolded = fold === "folded";
  // The work stands over the line while the run goes on, while it stays open
  // for a reader, and while it folds away into the line.
  const above = shows.work === "above";
  // What a later step undid, read once per record, not once per redraw.
  const undone = useMemo(() => recoveredFailures(row.items), [row.items]);
  // The live slot (pass 35): what the Mate is doing this moment, each thing
  // as the row it becomes; it plops into the history once it ended and
  // stood its minimum. Only the run's last record, while it runs, has one.
  const slotted = row.live && row.status !== null;
  const now = row.now;
  const model = row.slot;
  // A folded line's own calls are the record's too (`parts`).
  const recordKeys = useMemo(
    () =>
      model.record.flatMap((item) =>
        item.kind === "step" && item.parts !== undefined
          ? [item.key, ...item.parts.map((part) => part.key).filter((key) => key !== item.key)]
          : [item.key],
      ),
    [model.record],
  );
  const slotRef = useRef<HTMLDivElement>(null);
  // What goes live enters the slot one after another (`usePace`).
  const liveKeys = useMemo(() => model.live.map((item) => item.key), [model.live]);
  // Out of sight (a kept list), nobody watches: what arrives is simply there.
  const outOfSight = !(use(KeptTimelineContext)?.shown ?? true);
  const liveHeld = usePace({ keys: liveKeys, flush: !slotted || ctx.syncing || outOfSight });
  // When the quiet began, from the data: the record's newest line, else the
  // run's start — a reload or a catch-up never restarts "Thinking".
  const quietFrom = useMemo(() => {
    const ats = row.items.map((item) => Date.parse(item.at)).filter(Number.isFinite);
    const start = row.status === null ? Number.NaN : Date.parse(row.status.startedAt);
    return ats.length > 0 ? Math.max(...ats) : start;
  }, [row.items, row.status]);
  // Where each row leaving the slot stood, and each line of the history, read
  // before they move: the plop starts there, and the history glides from there.
  const [landing, setLanding] = useState<Landing | null>(null);
  const slot = useLiveSlot({
    live: slotted ? liveKeys.filter((key) => !liveHeld.has(key)) : NO_KEYS,
    // What waits its turn to go live is not the record's yet either: a
    // question waiting never rides into the history as ended.
    record: liveHeld.size === 0 ? recordKeys : recordKeys.filter((key) => !liveHeld.has(key)),
    final: !slotted,
    syncing: ctx.syncing,
    quietFrom,
    onChange: (from, to, redrawn) => {
      // Out of sight, nobody watches it land: what arrives is simply there.
      if (outOfSight) return;
      // What enters makes its room too: the history glides as the slot grows.
      const { leaving, entering } = slotMoves(from, to);
      if (leaving.length === 0 && !entering) return;
      // Where things stood as last painted: a change heard right after a draw
      // that already moved them (a check that ended as it was due, drawn as
      // it settled) starts from what the person saw, never from that draw.
      // On its own clock nothing was drawn since: what shows now, a glide in
      // flight included.
      const painted = (redrawn ? paintedRef.current : null) ?? paintedNow();
      const stood = new Map<string, number>();
      for (const key of leaving) {
        const top = painted.slotRows.get(key);
        stood.set(key, top === undefined || !slotted ? Number.NaN : top + (painted.slot ?? 0));
      }
      setLanding({
        from: stood,
        hosts: landingHosts(from, leaving, new Set(painted.slotRows.keys())),
        rows: slotted ? painted.rows : new Map(),
        slot: slotted ? painted.slot : null,
        card: painted.card,
        staying: slotted ? painted.slotRows : new Map(),
        bubbles: slotted ? painted.slotBubbles : new Map(),
      });
    },
  });
  /** Where the history's lines, the slot and its rows stand on screen now. */
  const paintedNow = () => {
    const slotTop = boxOf(slotRef.current)?.top ?? null;
    return {
      rows: lineTops(aboveRef.current),
      slot: slotTop,
      slotRows: rowTops(slotRef.current, slotTop ?? 0),
      slotBubbles: bubbleHeights(slotRef.current),
      card: boxOf(cardRowOf(rootRef.current))?.height ?? null,
    };
  };
  const paintedRef = useRef<ReturnType<typeof paintedNow> | null>(null);
  // What left the slot lands: the history at its foot, its lines gliding
  // where the landing moved them, each landed line plopping from where it
  // stood in the slot. Once the card holds its height the slot glides to its
  // new place too; growing, the card grows at its bottom, and a list that
  // follows its end moves it — a frame late, as for any row that grows.
  useLayoutEffect(() => {
    // Each landing once: it stays the last one heard until the next.
    if (landing === null) return;
    if (prefersReducedMotion()) return;
    const grew = (boxOf(cardRowOf(rootRef.current))?.height ?? 0) - (landing.card ?? 0);
    // A history that follows its foot follows it to where the landed line
    // ends; a move up the person made just before is read first, and stops it.
    keepScrollRef.current?.();
    const scroll = scrollIn(aboveRef.current);
    const list = scroll?.querySelector<HTMLElement>(":scope > ol") ?? null;
    if (scroll !== null && list !== null) glideLines(scroll, list, landing.rows, landing.slot);
    for (const [key, from] of landing.from) {
      // One that rode along unseen rises in as it arrives (`useRisesIn`).
      if (!Number.isFinite(from)) continue;
      const line = rowByKey(list, key);
      if (line === null) continue;
      // A call that opened a card of its own lands with its card.
      const card = line.closest<HTMLElement>("[data-chat-calls]");
      const alone = card !== null && card.childElementCount === 1;
      plop(alone ? (card.closest<HTMLElement>("[data-chat-row]") ?? line) : line, from);
      // Its bubble grows from the height it showed in the slot (a thought
      // the slot showed four lines of, the history in full).
      const stoodHeight = landing.bubbles.get(key);
      const bubble = line.matches("[data-chat-bubble]")
        ? line
        : line.querySelector<HTMLElement>("[data-chat-bubble]");
      if (stoodHeight !== undefined && bubble !== null) {
        historyRoomsRef.current?.easeFrom(bubble, stoodHeight);
      }
    }
    const element = slotRef.current;
    if (landing.slot === null || landing.card === null || element === null) return;
    // Growing, the card grows at its bottom, and the list moves the slot.
    if (grew <= 0.5) glideFrom(element, landing.slot);
    // A row that stays in the slot keeps its place in it as a row above it
    // leaves, and travels to its new one on the same curve: read from what
    // holds it — the slot, or its card of calls — so the slot's own move, a
    // glide or the list's, is never added to it.
    const rowSelector = "[data-chat-row][data-run-key]";
    for (const row of element.querySelectorAll<HTMLElement>(rowSelector)) {
      const stood = landing.staying.get(row.dataset.runKey!);
      if (stood === undefined) continue;
      const holder = row.parentElement?.closest<HTMLElement>(rowSelector) ?? null;
      const inHolder = holder !== null && element.contains(holder) ? holder : null;
      const holderStood = inHolder === null ? 0 : landing.staying.get(inHolder.dataset.runKey!);
      if (holderStood === undefined) continue;
      stopGliding(row);
      const base = (inHolder ?? element).getBoundingClientRect().top;
      glideBy(row, stood - holderStood - (row.getBoundingClientRect().top - base));
    }
  }, [landing]);
  // Read after each draw of a live run's card, once its landing glides
  // started — declared after the landing, so it runs after it: the next
  // change starts from what shows, never from the glides' destinations.
  // Read once the page is laid out, before it paints: what the frame shows.
  // Read in the draw, it laid the page out early on every word streamed, and
  // read every line of the history's box again; out of sight, never.
  const paintedDueRef = useRef({ due: false, wanted: false });
  useLayoutEffect(() => {
    const painted = paintedDueRef.current;
    painted.wanted = slotted && !outOfSight;
    if (!painted.wanted) {
      paintedRef.current = null;
      return;
    }
    if (painted.due) return;
    painted.due = true;
    afterLayout(() => {
      painted.due = false;
      if (painted.wanted) paintedRef.current = paintedNow();
    });
  });
  // Every commit, before the list's row measures the card in its own.
  useLayoutEffect(() => cardRoomsRef.current?.flush());
  const holds = slotted ? slotHoldsIn(slot, recordKeys) : NO_HOLDS;
  // A folded line whose call the slot still holds stands unfolded, that call
  // left out: it folds in once the call lands.
  const history =
    holds.size === 0
      ? row.chatItems
      : row.chatItems.flatMap((selected): typeof row.chatItems => {
          const { item } = selected;
          if (holds.has(item.key)) return [];
          if (item.kind !== "step" || item.parts === undefined) return [selected];
          if (!item.parts.some((part) => holds.has(part.key))) return [selected];
          return item.parts
            .filter((part) => !holds.has(part.key))
            .map((part) => ({ item: part, pairs: false }));
        });
  const feedRef = useRef<HTMLDivElement>(null);
  const fromHeightRef = useRef<number | null>(null);
  // A toggle leaves the height the work stood at: once the new fold is laid
  // out, the room eases from it to its own.
  useLayoutEffect(() => {
    const from = fromHeightRef.current;
    fromHeightRef.current = null;
    const feed = feedRef.current;
    if (from === null || feed === null) return;
    easeFeedHeight(feed, from);
  });
  // What joins the history enters one after another (`usePace`): a line
  // landing from the slot at once, what rode along with it after.
  const historyKeys = useMemo(() => history.map(({ item }) => item.key), [history]);
  const historyHeld = usePace({
    keys: historyKeys,
    landing: landing?.hosts ?? NO_HOLDS,
    flush: !slotted || ctx.syncing || outOfSight,
  });
  const entered =
    historyHeld.size === 0 ? history : history.filter(({ item }) => !historyHeld.has(item.key));
  const lines = above || !folded ? chatLines(entered, undone) : [];
  // The scroll mounts with its first line, so its box is there from its
  // first frame for what keeps it at its foot.
  const scroll =
    lines.length === 0 ? null : (
      <RunScroll
        label={`${ctx.speaker.name}'s work`}
        landing={landing?.from ?? null}
        lines={lines}
        keepRef={keepScrollRef}
        roomsRef={historyRoomsRef}
        motionRef={motionRef}
        eases={slotted && !ctx.syncing}
        opensAtStart={!above}
        {...(above ? { readingRef } : {})}
        {...(pages === null ? {} : { pages })}
      />
    );
  const settledOutcome = settled ? row.outcome : null;
  const toggleWork = () => {
    hold(folded);
    // Watched to its end and still open over its line: it
    // folds into the line as a run settling does.
    if (fold === "watched") {
      foldNow();
      return;
    }
    fromHeightRef.current = feedRef.current?.getBoundingClientRect().height ?? null;
    setRunFold(ctx.routeThreadKey, row.turnKey, folded ? "shown" : "folded");
  };
  // "Show work" pressed before its lines were read: it opens once their first page is held, or
  // stays closed if the read fails.
  const openingRef = useRef<{ reading: boolean } | null>(null);
  const openWhenHeld = useEffectEvent(() => toggleWork());
  useLayoutEffect(() => {
    const opening = openingRef.current;
    if (opening === null || paging === null) return;
    if (paging.holdsLines) {
      openingRef.current = null;
      openWhenHeld();
    } else if (paging.reading !== null) opening.reading = true;
    else if (opening.reading) openingRef.current = null;
  }, [paging]);

  // What the result's strip draws, as it said (`resultStripFiles`); the first six until then.
  const stripGuess = useMemo(
    () => (settledOutcome === null ? NO_PATHS : stripShowsFiles(allResultPictures(settledOutcome))),
    [settledOutcome],
  );
  const resultPictures = useStripFiles(settledOutcome?.turnKey ?? null, stripGuess);
  const liveToggle =
    shows.toggle === null ? null : (
      <WorkToggle
        open={!liveFolded}
        onToggle={() => {
          hold(!liveFolded);
          chooseLiveRunFold(ctx.routeThreadKey, row.turnKey, liveFolded ? "watched" : "folded");
        }}
      />
    );
  return (
    // One container for the chat and its now line: the Mate's column keeps
    // one gap for both. Its words wear its tint (`.run-speech`). Keyed, so the
    // scroll the person watched is the one that folds away.
    <CarriedOpenContext value={carriedOpen}>
      <ResultPicturesContext value={resultPictures}>
        <div
          ref={rootRef}
          className="@container/chat min-w-0"
          data-run-chat
          data-run-fold={settled ? fold : undefined}
          // The shared height holds through the settle's fold: dropped in the
          // commit the fold measures, the history jumped to its own height first.
          data-run-live={slotted || settling || fold === "folding" ? "" : undefined}
          style={
            {
              "--run-speaker-tint": `var(--zerops-mate-tint-${ctx.speaker.tint})`,
            } as CSSProperties
          }
        >
          {above && scroll !== null ? (
            <div
              key="above"
              ref={aboveRef}
              className="run-above"
              hidden={row.live && liveFolded}
              style={row.live && liveFolded ? { display: "none" } : undefined}
              data-folding={fold === "folding" ? "" : undefined}
            >
              {scroll}
              {/* The hairline over the line, folding away with the work. */}
              {fold === "folding" ? <div aria-hidden="true" className="run-above-rule" /> : null}
            </div>
          ) : null}
          {row.status === null ? null : settled ? (
            <NowLine
              key="line"
              answering={false}
              outcome={outcome}
              settledHere={watchedLive && motionAllowed}
              end={
                // A chat opens from its first thing the Mate did (`chatLines`),
                // and only onto a line that shows something.
                shows.toggle !== null ? (
                  <WorkToggle
                    onToggle={() => {
                      // Its lines not read yet: it opens once their first page is held.
                      if (folded && pages !== null && paging !== null && !paging.holdsLines) {
                        if (openingRef.current !== null) return;
                        hold(folded);
                        openingRef.current = { reading: false };
                        pages.read("later");
                        return;
                      }
                      toggleWork();
                    }}
                    open={!folded}
                    {...(pages !== null && paging !== null && !paging.holdsLines
                      ? { onIntent: () => pages.read("later") }
                      : {})}
                  />
                ) : null
              }
              now={null}
              status={row.status}
            />
          ) : (
            <LiveSlot
              key="slot"
              folded={liveFolded}
              end={liveFolded ? null : liveToggle}
              ref={slotRef}
              items={model.record}
              live={model.live}
              filler={model.filler}
              now={now}
              answering={row.answering}
              slot={slot}
              status={row.status}
              undone={undone}
              motionRef={motionRef}
            />
          )}
          {row.live && row.status !== null && liveFolded ? (
            <NowLine
              key="live-summary"
              answering={row.answering}
              outcome={null}
              now={now}
              status={row.status}
              end={liveToggle}
            />
          ) : null}
          <div key="below" ref={feedRef} className="run-later-feed">
            {above ? null : scroll}
          </div>
        </div>
      </ResultPicturesContext>
    </CarriedOpenContext>
  );
}

/** Build bubbles only for the selected history once its work is drawn. */
function chatLines(items: RecordRow["chatItems"], undone: ReadonlySet<string>): ChatLine[] {
  return items.map(({ item, pairs }) => ({ ...itemLine(item, undone), pairs }));
}

/**
 * How a run's card stands in this conversation. Live work starts watched;
 * an explicit Show/Hide choice carries through completion. Otherwise, as it
 * settles its work eases shut into its line — unless the person is reading
 * it right then, when it stays open until they leave (`forgetRunFolds`) or it
 * is drawn again. A run that settled out of sight is simply folded, and so is
 * every run under reduced motion.
 */
function useRunFold({
  conversation,
  run,
  live,
  asks,
  personKeys,
  readingRef,
  rootRef,
  aboveRef,
  onFoldWork,
}: {
  readonly conversation: string;
  readonly run: string;
  readonly live: boolean;
  /** Its run waits on the person. */
  readonly asks: boolean;
  /** Its items that involve the person: a run that goes on in it with a new one opens it. */
  readonly personKeys: ReadonlyArray<string>;
  readonly readingRef: { readonly current: boolean };
  readonly rootRef: { readonly current: HTMLElement | null };
  readonly aboveRef: { readonly current: HTMLElement | null };
  readonly onFoldWork: NonNullable<TimelineRowSharedState["onFoldWork"]>;
}): {
  readonly fold: RunFold;
  readonly foldNow: () => void;
  readonly settling: boolean;
  readonly motionAllowed: boolean;
} {
  // A card drawn settled first is folded until it says otherwise, a run going on in it too: it
  // opens only as `observe` decides, never for a frame before.
  const [bornLive] = useState(live);
  const read = () => runFoldOf(conversation, run, live && bornLive ? "watched" : "folded");
  const stored = useSyncExternalStore(subscribeRunFolds, read, read);
  const fold = stored;
  const wasLiveRef = useRef(live);
  // What of the person it held while it stood settled.
  const settledPersonKeysRef = useRef<ReadonlySet<string>>(new Set());
  // The draw where the run settled, before its fold is measured: the card
  // holds its live height through it, or it jumps first.
  const [drawnLive, setDrawnLive] = useState(live);
  const settling = !live && drawnLive && stored === "watched";
  // Where the line's words stood as the run settled: the fold starts there.
  const settledAtRef = useRef<number | null>(null);
  const motionAllowed = () =>
    !prefersReducedMotion() &&
    (typeof document === "undefined" || document.visibilityState !== "hidden");
  const measure = () => {
    if (!motionAllowed()) return null;
    return nowWordsOf(rootRef.current)?.getBoundingClientRect().top ?? null;
  };
  // It folds from where its line's words stand now, easing the work shut
  // into the line — at once under reduced motion.
  const foldNow = () => {
    settledAtRef.current = measure();
    transitionRunFold(conversation, run, { kind: "hide", measured: settledAtRef.current !== null });
  };
  const observe = useEffectEvent((wasLive: boolean) => {
    settledAtRef.current = live ? null : (settledAtRef.current ?? (wasLive ? measure() : null));
    transitionRunFold(
      conversation,
      run,
      live
        ? {
            kind: "live",
            rejoined: !wasLive,
            asks: asks || personKeys.some((key) => !settledPersonKeysRef.current.has(key)),
          }
        : {
            kind: "settled",
            wasLive,
            reading: readingRef.current,
            measured: settledAtRef.current !== null,
          },
    );
  });
  useLayoutEffect(() => {
    const wasLive = wasLiveRef.current;
    wasLiveRef.current = live;
    setDrawnLive(live);
    observe(wasLive);
    // A run that asks the person opens the card it went on in folded.
  }, [conversation, run, live, asks, readingRef]);
  useLayoutEffect(() => {
    if (!live) settledPersonKeysRef.current = new Set(personKeys);
  }, [live, personKeys]);
  useLayoutEffect(() => {
    if (fold !== "folding") return;
    const from = settledAtRef.current;
    const above = aboveRef.current;
    const words = nowWordsOf(rootRef.current);
    let active = true;
    const done = () => {
      if (!active) return;
      active = false;
      settledAtRef.current = null;
      transitionRunFold(conversation, run, { kind: "finished" });
    };
    if (from === null || above === null || words === null) {
      done();
      return;
    }
    const cancel = foldAway(above, from - words.getBoundingClientRect().top, done, onFoldWork);
    return () => {
      active = false;
      cancel();
    };
  }, [conversation, run, fold, aboveRef, rootRef, onFoldWork]);
  return { fold, foldNow, settling, motionAllowed: motionAllowed() };
}

/** The now line's words in a run's chat: where the line stands. */
function nowWordsOf(chat: HTMLElement | null): HTMLElement | null {
  return chat?.querySelector<HTMLElement>(":scope > .run-now .run-now-words") ?? null;
}

function prefersReducedMotion(): boolean {
  // Drawn outside a page (a test's renderer) nothing moves.
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** How "Show work" and "Hide work" ease the work's room open or shut (K12). */
const FOLD_EASE_MS = 220;
const FOLD_EASING = "cubic-bezier(0.23, 1, 0.32, 1)";

/**
 * Eases a run's work from the height it stood at before the person asked, to
 * its own: only what is under the line they clicked moves. Reduced motion
 * shows it at once.
 */
function easeFeedHeight(feed: HTMLElement, from: number): void {
  const to = feed.getBoundingClientRect().height;
  if (Math.abs(to - from) < 1 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }
  feed.animate(
    [
      { height: `${from}px`, overflow: "hidden" },
      { height: `${to}px`, overflow: "hidden" },
    ],
    { duration: FOLD_EASE_MS, easing: FOLD_EASING },
  );
}

/**
 * Folds the work over a run's line shut (`foldWork`): from its height, less
 * `shift` — how much higher the line stands without its hairline and room,
 * which the fold starts by keeping — to nothing, clipping as it closes; `done`
 * once it is shut.
 */
function foldAway(
  above: HTMLElement,
  shift: number,
  done: () => void,
  onFoldWork: NonNullable<TimelineRowSharedState["onFoldWork"]>,
): () => void {
  const from = above.getBoundingClientRect().height + shift;
  if (from < 1) {
    done();
    return () => undefined;
  }
  return onFoldWork({ above, from, done });
}

/** "Show work" on a folded run's line, "Hide work" once it is open: its chevron turns over. */
function WorkToggle({
  open,
  onToggle,
  onIntent,
}: {
  readonly open: boolean;
  readonly onToggle: () => void;
  /** The person is about to press it (a pointer over it, focus on it): what it opens is read. */
  readonly onIntent?: () => void;
}) {
  return (
    <button
      aria-expanded={open}
      className="run-now-fold"
      onClick={onToggle}
      onFocus={onIntent}
      onPointerEnter={onIntent}
      type="button"
    >
      {open ? "Hide work" : "Show work"}
      <ChevronDownIcon aria-hidden="true" className="run-now-fold-icon" />
    </button>
  );
}

/** How long a scroll stands still before its move counts as ended, where the browser never says so. */
const SCROLL_QUIET_MS = 150;

/**
 * The run's one scroll (the owner, 2026-09-29: "open with scroll and all
 * events"): every line it said and did, in the order it happened, the newest
 * at its foot. It opens at its foot and follows what arrives while it stands
 * there; once the person scrolls up to read, or opens something in it, it
 * stays where they are until they scroll back down. A long run opens on its
 * newest lines and draws the earlier ones as the person scrolls up to them,
 * the lines in view kept where they stand. A fade at an edge says there is
 * more past it. What arrives after it was first drawn arrived while the
 * person watched, and rises in. It mounts with its first line (`RunChat`).
 */
function RunScroll({
  label,
  lines,
  readingRef,
  keepRef,
  landing = null,
  eases = false,
  opensAtStart = false,
  roomsRef,
  motionRef,
  pages,
}: {
  readonly label: string;
  readonly lines: ReadonlyArray<ChatLine>;
  /** Told whether the person reads the work: scrolled up in it, or something in it opened. */
  readonly readingRef?: { current: boolean };
  /** Given how to keep it at its foot while it follows, read first (`keep`). */
  readonly keepRef?: { current: (() => void) | null };
  /** The lines landing from the live slot this draw: they plop into place, never rise in. */
  readonly landing?: ReadonlyMap<string, number> | null;
  /** Whether its room eases as lines join it, and it glides to its foot: a live run, watched. */
  readonly eases?: boolean;
  /**
   * Whether it opens at its first line: a settled run's work opened by "Show
   * work" reads from the start; a live one, or one watched to its end, opens
   * at its foot.
   */
  readonly opensAtStart?: boolean;
  /** Given how its boxes ease, for a line landing in it. */
  readonly roomsRef?: { current: Rooms | null };
  /** Its card's motion: the live slot's ease beside it. */
  readonly motionRef?: { readonly current: RunMotion };
  /**
   * An engine run too long to read whole: the lines past the ones held, read a page at a time
   * as the scroll nears them (`pageReached`).
   */
  readonly pages?: ScrollPages;
}) {
  // Drawn once: from here on, what arrives arrives while the person watches.
  const shownRef = useRef(false);
  useEffect(() => {
    shownRef.current = true;
  }, []);
  // Where the chat starts: its newest lines when it opens. What arrives after
  // only ever joins at the end, so the window grows and never slides.
  const [from, setFrom] = useState(() => (opensAtStart ? 0 : chatOpensAt(lines.length)));
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const easesRef = useRef(eases);
  useLayoutEffect(() => {
    easesRef.current = eases;
  }, [eases]);
  // Its room easing to its lines (`easeRooms`): made before what keeps it at
  // its foot, so that hears each change with the room already holding the
  // height it showed.
  const roomRef = useRef<Rooms | null>(null);
  // Earlier lines are being drawn above the ones in view, this commit.
  const drawingEarlierRef = useRef(false);
  // When the person last gave it an input: what tells their move from its own motion's.
  const personAtRef = useRef(Number.NEGATIVE_INFINITY);
  const heardPerson = useEffectEvent(() => {
    personAtRef.current = performance.now();
  });
  // A pointer or a finger held on it is their input until it lifts: a
  // drag-select scrolling at its edge, a finger resting on the lines.
  const holdsRef = useRef({ pointer: false, touch: false });
  const heardHold = useEffectEvent((kind: "pointer" | "touch") => {
    heardPerson();
    const holds = holdsRef.current;
    if (holds[kind]) return;
    holds[kind] = true;
    // It lifts with its own end, or with anything that ends a press without
    // one (a context menu, the window losing focus, a drag), or after a
    // while: a lost end never holds it for good.
    const ends = [
      ...(kind === "pointer" ? ["pointerup", "pointercancel"] : ["touchend", "touchcancel"]),
      "contextmenu",
      "blur",
      "dragstart",
    ];
    const lifted = () => {
      clearTimeout(cap);
      holds[kind] = false;
      heardPerson();
      for (const type of ends) window.removeEventListener(type, lifted, true);
    };
    const cap = setTimeout(lifted, HOLD_LONGEST_MS);
    for (const type of ends) window.addEventListener(type, lifted, true);
  });
  useEffect(() => {
    const element = scrollRef.current;
    if (element === null) return;
    const pointer = () => heardHold("pointer");
    const touch = () => heardHold("touch");
    element.addEventListener("keydown", heardPerson, true);
    element.addEventListener("wheel", heardPerson, { capture: true, passive: true });
    element.addEventListener("touchmove", heardPerson, { capture: true, passive: true });
    element.addEventListener("pointerdown", pointer, true);
    element.addEventListener("touchstart", touch, { capture: true, passive: true });
    return () => {
      element.removeEventListener("keydown", heardPerson, true);
      element.removeEventListener("wheel", heardPerson, true);
      element.removeEventListener("touchmove", heardPerson, true);
      element.removeEventListener("pointerdown", pointer, true);
      element.removeEventListener("touchstart", touch, true);
    };
  }, []);
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element === null) return;
    // It, its lines — so lines leaving or shrinking at its foot let it settle
    // there gradually, never clamp it down at once — and each bubble and card
    // of calls in it, as what they hold changes.
    const rooms = easeRooms({
      root: element,
      selector: `[data-run-scroll] > ol, ${EASED_BOXES}`,
      // Earlier lines drawn over the ones in view take their room at once:
      // where the person reads is kept by the scroll (`keepFromFootRef`).
      eases: () => easesRef.current && shownRef.current && !drawingEarlierRef.current,
      budget: motionRef?.current.budget ?? null,
    });
    roomRef.current = rooms;
    if (roomsRef !== undefined) roomsRef.current = rooms;
    return () => {
      rooms.stop();
      forgetScrollTop(element);
      roomRef.current = null;
      if (roomsRef !== undefined) roomsRef.current = null;
    };
  }, [roomsRef, motionRef]);
  // Every commit, before the list's row measures it in its own.
  useLayoutEffect(() => roomRef.current?.flush());
  // It follows its foot until the person moves it up or opens something in
  // it, and again once they move it down onto its foot or close what they
  // opened; where its top last stood tells their move from the page's. It
  // opens at its foot.
  const laterRef = useRef(pages?.later ?? false);
  useLayoutEffect(() => {
    laterRef.current = pages?.later ?? false;
  });
  const followRef = useRef<RunScrollFollow>({
    follows: !opensAtStart,
    stood: opensAtStart ? 0 : Number.POSITIVE_INFINITY,
    opened: NOTHING_OPENED,
    resumes: false,
    reach: null,
    foot: null,
  });
  const follow = useMemo(() => {
    // Its furthest top as it last stood: what a clamp since can take it up by.
    const stoodAt = { max: 0 };
    const heard = (event: RunScrollEvent) => {
      const stood = followRef.current.stood;
      followRef.current = followAfter(followRef.current, event);
      // Its foot is not its run's end while later lines are still to read: what pages in joins
      // under what the person reads, and the scroll never follows it there.
      if (laterRef.current && followRef.current.follows)
        followRef.current = { ...followRef.current, follows: false };
      const element = scrollRef.current;
      if (element !== null && (event.kind === "set" || followRef.current.stood !== stood)) {
        stoodAt.max = element.scrollHeight - element.clientHeight;
      }
      const { follows } = followRef.current;
      // Said on it, as its cut edges are, for what looks at the page.
      scrollRef.current?.toggleAttribute("data-follows", follows);
      if (event.kind !== "set" && readingRef !== undefined) readingRef.current = !follows;
    };
    /** Whether a box holding it eases this moment (`easeRooms`): its height is that ease's. */
    const heldAbove = () =>
      typeof scrollRef.current?.parentElement?.closest === "function" &&
      scrollRef.current.parentElement.closest("[data-room-easing]") !== null;
    /**
     * Whether the live slot beside it eases this moment: its box gives that
     * ease its room, and the browser clamps its top as it does (a phone's
     * slot easing beside a 5 px history moved it 2 px up between two reads;
     * read as the person's, the run stopped following).
     */
    const slotEases = () => motionRef?.current.slot?.easing() ?? false;
    /** The page puts its top at `top`, and remembers where the browser took it. */
    const putAt = (element: HTMLElement, top: number) => {
      followScrollTo(element, top);
      noteScrollTop(element);
      heard({ kind: "set", top: element.scrollTop });
    };
    /**
     * Where its foot will stand once its room has eased: a room still growing
     * uncovers what joined, and the scroll stays.
     */
    const footOf = (position: RunScrollPosition) =>
      Math.max(0, footTop(position) - Math.max(0, roomRef.current?.pending() ?? 0));
    // The glide to the foot, while one runs: where it stands (the browser
    // rounds what it is given), and the frame it waits for.
    const gliding = { frame: 0, at: 0, last: 0, foot: 0 };
    /**
     * Glides it to its foot on the room's curve, retargeted each frame as the
     * foot moves on; a move of the person's up stops it (`followAfter`).
     */
    const glide = () => {
      const element = scrollRef.current;
      if (element === null || gliding.frame !== 0) return;
      // Drawn outside a page (a test's renderer), or under reduced motion, it
      // stands there at once.
      if (typeof requestAnimationFrame !== "function" || prefersReducedMotion()) {
        putAt(element, footOf(positionOf(element)));
        return;
      }
      gliding.at = element.scrollTop;
      gliding.last = 0;
      gliding.foot = footOf(positionOf(element));
      const tick = (now: number) => {
        gliding.frame = 0;
        const element = scrollRef.current;
        if (element === null || !followRef.current.follows) return;
        // Moved since by something else: it glides on from there.
        if (Math.abs(element.scrollTop - gliding.at) > 2) gliding.at = element.scrollTop;
        const target = footOf(positionOf(element));
        // The foot's own move since — a height easing as it glides — is
        // taken at once; only the glide's way eases (`glideStep`).
        gliding.at = glideStep({
          at: gliding.at,
          lastFoot: gliding.foot,
          foot: target,
          dtMs: gliding.last === 0 ? 1000 / 60 : now - gliding.last,
        });
        gliding.foot = target;
        gliding.last = now;
        putAt(element, gliding.at);
        markEdges(element);
        if (gliding.at !== target) gliding.frame = requestAnimationFrame(tick);
      };
      gliding.frame = requestAnimationFrame(tick);
    };
    // Its box and its lines as they stood at the last read.
    const sized: { box: number | null; lines: number | null } = { box: null, lines: null };
    /**
     * Where it stands, read: while its room eases or it glides, or as its box
     * or its lines change size, a move with no input of the person's is that
     * motion's or that change's — the browser clamping it — and never their
     * move up.
     */
    const read = (position: RunScrollPosition) => {
      const boxResized = sized.box !== null && Math.abs(position.clientHeight - sized.box) > 0.5;
      const linesResized =
        sized.lines !== null && Math.abs(position.scrollHeight - sized.lines) > 0.5;
      sized.box = position.clientHeight;
      sized.lines = position.scrollHeight;
      const element = scrollRef.current;
      // A motion of the card's own — its glide, its boxes easing, the card
      // around it or the slot beside it — or a resize moves it only as far as
      // the clamp explains, its lines or its box resizing a frame's speed past it (run
      // 12: 6 px taller, the top set 14 px up): further up is the person's,
      // whatever took it there with no input on it (find in page, Tab, a
      // drag-select, a screen reader).
      const explained =
        element !== null &&
        movedByClamp({
          stood: followRef.current.stood,
          top: position.scrollTop,
          stoodMax: stoodAt.max,
          max: element.scrollHeight - element.clientHeight,
          linesResized,
          boxResized,
        });
      const person = movesAsPerson({
        moving:
          explained &&
          (gliding.frame !== 0 ||
            (roomRef.current?.easing() ?? false) ||
            heldAbove() ||
            slotEases()),
        resized: (linesResized || boxResized) && explained,
        msSinceInput:
          holdsRef.current.pointer || holdsRef.current.touch
            ? 0
            : performance.now() - personAtRef.current,
        atFoot: standsAtFoot(position),
        follows: followRef.current.follows,
      });
      if (person) heard({ kind: "scrolled", position });
      else heard({ kind: "set", top: position.scrollTop });
      if (scrollRef.current !== null) noteScrollTop(scrollRef.current);
    };
    // How tall its lines stood at the last keep: lines joining glide it on,
    // its own box changing keeps its foot where it is.
    const laid: { height: number | null; again: number } = { height: null, again: 0 };
    /**
     * Read where it stands — a move up not heard yet (a scroll event comes a
     * frame late) is the person's — and, while it follows, keep it at its
     * foot: gliding there as lines join it, at once as its box changes.
     */
    const keep = () => {
      const element = scrollRef.current;
      if (element === null) return;
      // A draw laid out before its boxes held their heights (a row leaving
      // the slot) clamped it, and the rooms put that clamp back only once
      // every set has heard the draw: keeping it, a landing puts it back
      // first — that clamp alone, never a move the page made with no input.
      unclamp(element);
      const position = positionOf(element);
      read(position);
      const grew = laid.height !== null && position.scrollHeight > laid.height + 0.5;
      laid.height = position.scrollHeight;
      const foot = footOf(position);
      const keeps = keepsFoot({
        follows: followRef.current.follows,
        heldAbove: followRef.current.follows && heldAbove(),
        grew,
        below: foot > element.scrollTop + 0.5,
        eases: easesRef.current,
        // Its own boxes, or the slot squeezing it as it eases taller.
        roomEases: (roomRef.current?.easing() ?? false) || slotEases(),
        gliding: gliding.frame !== 0,
      });
      // The card around it easing taller gives it the room it needs: it
      // stays, and keeps to its foot again once that ease is over.
      if (keeps === "waits") {
        if (laid.again === 0) {
          laid.again = requestAnimationFrame(() => {
            laid.again = 0;
            keep();
          });
        }
      } else if (keeps === "glides") glide();
      else if (keeps === "puts") putAt(element, foot);
      markEdges(element);
    };
    return {
      heard,
      read,
      putAt,
      keep,
      glide,
      hold: (key: string, opens: boolean) => {
        const element = scrollRef.current;
        // A move of theirs not heard yet is theirs, before the press counts.
        if (element !== null) heard({ kind: "scrolled", position: positionOf(element) });
        heard({ kind: opens ? "opened" : "closed", key });
        if (opens) return;
        // Once a closing kept what they pressed in place, that keeping is
        // the page's move, never read as their move up: closing
        // the last thing they opened, it catches up to its foot; else it
        // stands where the keeping put it.
        queueMicrotask(() => {
          const element = scrollRef.current;
          if (element === null) return;
          if (followRef.current.follows) putAt(element, footTop(positionOf(element)));
          else heard({ kind: "set", top: element.scrollTop });
          markEdges(element);
        });
      },
    };
  }, [readingRef, motionRef]);
  // Its node re-inserted puts it back at 0, silently: following, it stands at its foot again.
  const endRef = useRef<HTMLDivElement>(null);
  useRunScrollResettle({ scrollRef, endRef, followRef, positionOf, putAt: follow.putAt });
  useLayoutEffect(() => {
    if (keepRef === undefined) return;
    keepRef.current = follow.keep;
    return () => {
      keepRef.current = null;
    };
  }, [follow, keepRef]);
  // How far above its foot the scroll stood before earlier lines were drawn
  // over the ones in view.
  const keepFromFootRef = useRef<number | null>(null);
  const drawEarlier = (position: RunScrollPosition) => {
    if (!reachesEarlier(position, from)) return;
    drawingEarlierRef.current = true;
    keepFromFootRef.current = position.scrollHeight - position.scrollTop;
    setFrom(earlierShown(from).next);
  };
  // It opens at its foot — or its start — before the first paint.
  const opensAtStartRef = useRef(opensAtStart);
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element === null) return;
    follow.putAt(element, opensAtStartRef.current ? 0 : footTop(positionOf(element)));
    markEdges(element);
  }, [follow]);
  // Earlier lines drawn above the ones in view keep those where they stood;
  // a chat too short to scroll draws them at once, as nothing reaches them.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    const keep = keepFromFootRef.current;
    keepFromFootRef.current = null;
    if (element === null) return;
    if (keep !== null) follow.putAt(element, positionOf(element).scrollHeight - keep);
    drawingEarlierRef.current = false;
    if (from > 0 && element.scrollHeight <= element.clientHeight) {
      drawingEarlierRef.current = true;
      setFrom(earlierShown(from).next);
    }
    markEdges(element);
  }, [from, follow]);
  // A page of earlier lines read in above the first one drawn keeps that one where it stood: the
  // scroll moves by what came in over it, before the frame paints. Never a glide: nothing moved.
  const firstDrawnRef = useRef<{ readonly key: string; readonly top: number } | null>(null);
  const prependedRef = useRef(false);
  useLayoutEffect(() => {
    prependedRef.current = false;
    const element = scrollRef.current;
    const list = listRef.current;
    if (pages === undefined || element === null || list === null) return;
    const was = firstDrawnRef.current;
    const first = from === 0 ? lines[0] : undefined;
    const topOf = (row: HTMLElement) =>
      row.getBoundingClientRect().top - list.getBoundingClientRect().top;
    if (was !== null && first !== undefined && first.key !== was.key) {
      const row = rowByKey(list, was.key);
      if (row !== null) {
        prependedRef.current = true;
        const moved = topOf(row) - was.top;
        if (Math.abs(moved) > 0.5) follow.putAt(element, element.scrollTop + moved);
      }
    }
    const row = first === undefined ? null : rowByKey(list, first.key);
    firstDrawnRef.current =
      first === undefined || row === null ? null : { key: first.key, top: topOf(row) };
  });
  // Near an end with lines past it still to read: the next page, before the person reaches it.
  const readPage = (position: RunScrollPosition) => {
    if (pages === undefined) return;
    const reached = pageReached(position, from, pages);
    if (reached !== null) pages.read(reached);
  };
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (pages !== undefined && element !== null) readPage(positionOf(element));
  });
  // A line joining above lines already there, or a call moving past the
  // ones still running (F3, run 9), glides what it moved from where it
  // stood, as a landing does; one joining at the foot makes its room there
  // by the history's ease.
  // Where its rows stood: read at each draw, and again as its lines resize
  // (a height easing moves the rows under it between two draws).
  const drawnRef = useRef<{
    readonly rows: ReadonlyMap<string, HolderRows>;
    readonly lines: ReadonlyArray<ChatLine>;
    readonly from: number;
    readonly landing: ReadonlyMap<string, number> | null;
  } | null>(null);
  // Read again as heights ease and as it scrolls: the rows near its view.
  const redraw = useCallback(() => {
    const scroll = scrollRef.current;
    const drawn = drawnRef.current;
    if (scroll === null || drawn === null || !easesRef.current) return;
    drawnRef.current = { ...drawn, rows: retopped(drawn.rows, scroll) };
  }, []);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (list === null || typeof list.querySelectorAll !== "function" || !easesRef.current) {
      drawnRef.current = null;
      return;
    }
    const drawn = drawnRef.current;
    // The same lines drawn again: its rows are the ones last read.
    if (
      drawn !== null &&
      drawn.from === from &&
      drawn.landing === landing &&
      sameLines(drawn.lines, lines)
    ) {
      return;
    }
    const rows = historyRows(list, drawn?.rows);
    drawnRef.current = { rows, lines, from, landing };
    // A landing glides the history itself, and plops what lands.
    if (drawn === null || drawn.landing !== landing || !shownRef.current) return;
    // Earlier lines drawn over the ones in view keep their place by the scroll.
    glideShifted(list, drawn.rows, rows, drawn.from === from && !prependedRef.current);
  });
  // A line arriving, a bubble growing as its words stream, a call opening,
  // the live slot under it growing into its room: a scroll that follows its
  // foot stays at it, moved before the frame paints, so no arrival is ever
  // drawn cut first.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    const list = listRef.current;
    if (element === null || list === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      forgetPadding(element);
      follow.keep();
      redraw();
    });
    observer.observe(list);
    observer.observe(element);
    return () => observer.disconnect();
  }, [follow, redraw]);
  // Where the browser never says a move ended (Safari before `scrollend`),
  // it ended once the scroll stood still a moment.
  const quietRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (quietRef.current !== null) clearTimeout(quietRef.current);
    },
    [],
  );
  const endsOnQuiet = () => {
    if (typeof window !== "undefined" && "onscrollend" in window) return;
    if (quietRef.current !== null) clearTimeout(quietRef.current);
    quietRef.current = setTimeout(() => {
      quietRef.current = null;
      follow.heard({ kind: "ended" });
    }, SCROLL_QUIET_MS);
  };
  const shown = gatherCalls(
    (from > 0 ? lines.slice(from) : lines).map((line) =>
      plopsIn(landing, line.key) ? { ...line, plops: true } : line,
    ),
  );
  return (
    <RunScrollHoldContext value={follow.hold}>
      <ChatShownContext value={shownRef}>
        <div
          ref={scrollRef}
          aria-label={label}
          className="run-scroll"
          data-run-scroll=""
          onScroll={(event) => {
            // One read of where it stands serves the whole event, and every
            // read comes before its fades are written: a write between two
            // reads restyled and laid out the page again, on every tick.
            const position = positionOf(event.currentTarget);
            const followed = followRef.current.follows;
            follow.read(position);
            redraw();
            const element = scrollRef.current;
            if (element !== null) {
              // Brought back to the foot it set out for, it glides on to
              // where the foot moved on since — at once under reduced
              // motion, which moves it: then it is read anew.
              if (!followed && followRef.current.follows) {
                follow.glide();
                markEdges(element);
              } else markEdges(element, position);
            }
            drawEarlier(position);
            readPage(position);
            endsOnQuiet();
          }}
          onScrollEnd={() => follow.heard({ kind: "ended" })}
          role="region"
          tabIndex={0}
        >
          <ol ref={listRef} className="flex min-w-0 flex-col gap-3">
            {shown.map((entry) =>
              "calls" in entry ? (
                <CallsCard key={entry.key} entry={entry} />
              ) : (
                <PlopsContext key={entry.key} value={entry.plops === true}>
                  <ChatRow
                    across={entry.across === true}
                    lineKey={entry.key}
                    mark={entry.mark}
                    markLine={entry.markLine}
                    pairs={entry.pairs === true}
                    theirs={entry.theirs === true}
                  >
                    {entry.bubble}
                  </ChatRow>
                </PlopsContext>
              ),
            )}
          </ol>
          <div ref={endRef} aria-hidden="true" data-run-scroll-end="" />
        </div>
      </ChatShownContext>
    </RunScrollHoldContext>
  );
}

/** Where an element stands on screen; null drawn outside a page (a test's renderer). */
function boxOf(element: HTMLElement | null): DOMRect | null {
  return typeof element?.getBoundingClientRect === "function"
    ? element.getBoundingClientRect()
    : null;
}

/** The history's scroll under `above`, if it is drawn. */
function scrollIn(above: HTMLElement | null): HTMLElement | null {
  if (typeof above?.querySelector !== "function") return null;
  return above.querySelector<HTMLElement>("[data-run-scroll]");
}

/** The list's row a run's chat stands in: its card's slice. */
function cardRowOf(chat: HTMLElement | null): HTMLElement | null {
  if (typeof chat?.closest !== "function") return null;
  return chat.closest<HTMLElement>("[data-card-slice]");
}

/**
 * Stops what moves an element by a translate — a plop or a glide in flight —
 * so its place is read where the layout has it: a new move starts from where
 * it shows, never from a place the one it replaces held it off.
 */
function stopGliding(element: HTMLElement): void {
  if (typeof element.getAnimations !== "function") return;
  // Only its own: a row's rise in (`run-rise`) moves it by a translate too.
  for (const animation of element.getAnimations()) {
    if (animation.id === GLIDE_ID) animation.cancel();
  }
}

/** What names a plop's or a glide's animation, so a new move stops only those. */
const GLIDE_ID = "run-glide";

/**
 * An element gliding to its place from where it showed (`stood`, its top on
 * screen) on the plop's curve; how far it glides. One in flight is taken over
 * from where it shows.
 */
function glideFrom(element: HTMLElement, stood: number): number {
  stopGliding(element);
  return glideBy(element, stood - element.getBoundingClientRect().top);
}

/** A translated row stays inside the scroll that clips it, including its first frame. */
function visibleTravel(element: HTMLElement, moved: number): number {
  if (typeof getComputedStyle !== "function") return moved;
  const box = element.getBoundingClientRect();
  let lower = Number.NEGATIVE_INFINITY;
  let upper = Number.POSITIVE_INFINITY;
  for (let parent = element.parentElement; parent !== null; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (
      style.clipPath === "none" &&
      !["auto", "scroll", "hidden", "clip"].includes(style.overflowY)
    )
      continue;
    const view = parent.getBoundingClientRect();
    lower = Math.max(lower, Math.min(0, view.top - box.top));
    upper = Math.min(upper, Math.max(0, view.bottom - box.bottom));
  }
  return Math.max(lower, Math.min(upper, moved));
}

/** An element gliding from `moved` px off its place to it, on the plop's curve. */
function glideBy(element: HTMLElement, moved: number): number {
  moved = visibleTravel(element, moved);
  if (Math.abs(moved) < 0.5) return 0;
  // Added to what moves it already: a call's rise keeps the rest of its way.
  element.animate([{ translate: `0 ${moved}px` }, { translate: "0 0" }], {
    id: GLIDE_ID,
    composite: "add",
    duration: PLOP_MS,
    easing: "cubic-bezier(0.23, 1, 0.32, 1)",
  }).currentTime = 0;
  return moved;
}

/**
 * The lines in the scroll's view that moved on screen since `before`, gliding
 * from where they stood on the plop's curve — the room a plop takes moves them,
 * and they move as it does, never in one frame.
 */
function glideLines(
  scroll: HTMLElement,
  list: HTMLElement,
  before: ReadonlyMap<string, number>,
  /** Where the view ended before: a slot that grew took room a line stood in. */
  stoodBottom: number | null = null,
): void {
  if (before.size === 0 || prefersReducedMotion()) return;
  const shown = scroll.getBoundingClientRect();
  const view = { top: shown.top, bottom: Math.max(shown.bottom, stoodBottom ?? shown.bottom) };
  for (const line of list.children) {
    if (!(line instanceof HTMLElement)) continue;
    const stood = line.dataset.runKey === undefined ? undefined : before.get(line.dataset.runKey);
    if (stood === undefined) continue;
    stopGliding(line);
    const box = line.getBoundingClientRect();
    const moved = stood - box.top;
    if (Math.abs(moved) < 0.5 || box.bottom + moved < view.top || box.top + moved > view.bottom) {
      continue;
    }
    glideFrom(line, stood);
  }
}

/** The rows of one holder of a run's history — its list, or a card of calls — as drawn, each by its top in it. */
interface HolderRows {
  readonly holder: HTMLElement;
  readonly rows: ReadonlyArray<DrawnRow & { readonly row: HTMLElement }>;
}

/** A card's calls in its row of the history: two levels under it, never a search of it. */
function callsIn(line: Element): HTMLElement | null {
  for (const part of line.children) {
    for (const inner of part.children) {
      if (inner instanceof HTMLElement && inner.hasAttribute("data-chat-calls")) return inner;
    }
  }
  return null;
}

/** The rows a holder draws, each by its top in the holder as laid out (a glide's translate left out). */
function rowsIn(holder: HTMLElement, was: HolderRows | undefined): HolderRows {
  const found: Array<{ readonly key: string; readonly row: HTMLElement }> = [];
  for (const row of holder.children) {
    const key = row.getAttribute("data-run-key");
    if (key !== null && row instanceof HTMLElement) found.push({ key, row });
  }
  // Grown only at its foot: what stood keeps the place last read, and only
  // what joined is read — a long history's every row would take milliseconds.
  const grew =
    was !== undefined &&
    was.rows.length <= found.length &&
    was.rows.every((row, index) => found[index]!.key === row.key);
  return {
    holder,
    rows: found.map(({ key, row }, index) => ({
      key,
      row,
      top: grew && index < was.rows.length ? was.rows[index]!.top : topIn(holder, row),
    })),
  };
}

/** The longest a pointer or finger held on a run's history counts as input with no end heard. */
const HOLD_LONGEST_MS = 4000;

/** Whether two draws of a run's history hold the same lines, each a call or not alike. */
function sameLines(left: ReadonlyArray<ChatLine>, right: ReadonlyArray<ChatLine>): boolean {
  return (
    left.length === right.length &&
    left.every((line, index) => line.key === right[index]!.key && line.call === right[index]!.call)
  );
}

/** A row's top in what holds it, as laid out: a glide's translate left out. */
function topIn(holder: HTMLElement, row: HTMLElement): number {
  return row.offsetParent === holder.offsetParent
    ? row.offsetTop - holder.offsetTop
    : row.offsetTop;
}

/** The rows of a run's history by what holds them: its lines (""), and each card's calls by its key. */
function historyRows(
  list: HTMLElement,
  was: ReadonlyMap<string, HolderRows> | undefined,
): ReadonlyMap<string, HolderRows> {
  const lines = rowsIn(list, was?.get(""));
  const rows = new Map([["", lines]]);
  for (const { key, row } of lines.rows) {
    const calls = callsIn(row);
    if (calls !== null) rows.set(key, rowsIn(calls, was?.get(key)));
  }
  return rows;
}

/** How far past the scroll's view a row's place is read again as heights ease. */
const RETOP_MARGIN_PX = 400;

/**
 * The rows as they stand now, what holds them unchanged since they were
 * drawn: a height easing moved the rows under it. Only the rows near the
 * scroll's view are read again — a long history's thousands would take
 * milliseconds a frame — by where each last stood; one far from it, or one
 * whose place is unknown since a scroll took the view away, is unknown,
 * and is never glided (`rowShifts`).
 */
function retopped(
  drawn: ReadonlyMap<string, HolderRows>,
  scroll: HTMLElement,
): ReadonlyMap<string, HolderRows> {
  const near = {
    top: scroll.scrollTop - RETOP_MARGIN_PX,
    bottom: scroll.scrollTop + scroll.clientHeight + RETOP_MARGIN_PX,
  };
  const lines = drawn.get("");
  if (lines === undefined) return drawn;
  const rows = new Map<string, HolderRows>([["", nearRows(lines, 0, near)]]);
  // Where each card of calls stands in the list: its calls stand under it.
  const cardTops = new Map(rows.get("")!.rows.map(({ key, top }) => [key, top] as const));
  for (const [holderKey, held] of drawn) {
    if (holderKey === "") continue;
    const base = cardTops.get(holderKey) ?? null;
    rows.set(
      holderKey,
      base === null
        ? { holder: held.holder, rows: held.rows.map((row) => ({ ...row, top: null })) }
        : nearRows(held, base, near),
    );
  }
  return rows;
}

/**
 * The rows of one holder near the view, read where they stand — the first
 * found by halves, the rest until one stands past it — and the others
 * unknown: whatever the view did since, a scroll included, the rows it
 * reaches are read anew (`base`: the holder's top in the list).
 */
function nearRows(
  held: HolderRows,
  base: number,
  near: { readonly top: number; readonly bottom: number },
): HolderRows {
  const { holder, rows } = held;
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    const row = rows[middle]!.row;
    if (base + topIn(holder, row) + row.offsetHeight < near.top) low = middle + 1;
    else high = middle;
  }
  const read = rows.map((row) => ({ ...row, top: null as number | null }));
  for (let index = low; index < rows.length; index += 1) {
    const top = topIn(holder, rows[index]!.row);
    if (base + top > near.bottom) break;
    read[index] = { ...rows[index]!, top };
  }
  return { holder, rows: read };
}

/**
 * The rows in view that the rows around them moved since the last draw —
 * what joined above them, what left — gliding from where they stood on the
 * plop's curve (`rowShifts`), a glide in flight taken over from where it
 * shows; a call in a card rides its card. The lines themselves only when
 * `lines`.
 */
function glideShifted(
  list: HTMLElement,
  before: ReadonlyMap<string, HolderRows>,
  after: ReadonlyMap<string, HolderRows>,
  lines: boolean,
): void {
  if (prefersReducedMotion()) return;
  const scroll = list.parentElement;
  if (scroll === null) return;
  let view: DOMRect | null = null;
  for (const [holderKey, { rows }] of after) {
    const was = before.get(holderKey);
    if (was === undefined || (holderKey === "" && !lines)) continue;
    const shifts = rowShifts(was.rows, rows);
    if (shifts.size === 0) continue;
    view ??= scroll.getBoundingClientRect();
    for (const { key, row } of rows) {
      const shift = shifts.get(key);
      if (shift === undefined) continue;
      const box = row.getBoundingClientRect();
      if (box.bottom - shift < view.top || box.top - shift > view.bottom) continue;
      glideFrom(row, box.top - shift);
    }
  }
}

/**
 * A card of calls in the history. One that a call starting it lands with
 * plops as that call does, and never rises in on top of the plop.
 */
function CallsCard({ entry }: { readonly entry: Extract<ChatEntry, { calls: unknown }> }) {
  const plops = entry.calls.some((line) => line.plops === true);
  return (
    <PlopsContext value={plops}>
      <ChatRow across={false} lineKey={entry.key} theirs={false}>
        <CallGroup>
          {entry.calls.map((line) => (
            <ChatLineContext key={line.key} value={line.key}>
              <PlopsContext value={line.plops === true}>
                <RidesContext value={plops && line.plops !== true}>{line.bubble}</RidesContext>
              </PlopsContext>
            </ChatLineContext>
          ))}
        </CallGroup>
      </ChatRow>
    </PlopsContext>
  );
}

/** Whether a line lands by a plop: it stood in the slot (a rider rises in on its own). */
function plopsIn(landing: ReadonlyMap<string, number> | null, key: string): boolean {
  const from = landing?.get(key);
  return from !== undefined && Number.isFinite(from);
}

/** A landed row uses the same bounded travel as every other line moving in a scroll. */
const PLOP_MS = 340;
function plop(row: HTMLElement, from: number) {
  if (prefersReducedMotion() || !Number.isFinite(from)) return;
  glideFrom(row, from);
}

/**
 * Marks the edges the scroll has more past — a fade there says so — straight
 * on the element: a scroll never redraws the chat.
 */
function markEdges(element: HTMLElement, position: RunScrollPosition = positionOf(element)): void {
  const cut = cutEdges(position);
  element.toggleAttribute("data-more-above", cut.above);
  element.toggleAttribute("data-more-below", cut.below);
}

/**
 * Each run scroll's padding, top and bottom together: read once, and again
 * after it resizes (`forgetPadding`). Read through its computed style on
 * every scroll event, it restyled the page first each time.
 */
const paddings = new WeakMap<HTMLElement, number>();

/** The scroll resized: its padding is read anew. */
function forgetPadding(scroll: HTMLElement): void {
  paddings.delete(scroll);
}

function paddingOf(scroll: HTMLElement): number {
  let pad = paddings.get(scroll);
  if (pad === undefined) {
    const style = getComputedStyle(scroll);
    pad =
      (Number.parseFloat(style.paddingTop) || 0) + (Number.parseFloat(style.paddingBottom) || 0);
    paddings.set(scroll, pad);
  }
  return pad;
}

/**
 * Where the run's scroll stands, its foot where its lines end as laid out: a
 * row travelling into its place paints past it (`laidOutPosition`).
 */
function positionOf(scroll: HTMLElement): RunScrollPosition {
  const list = scroll.firstElementChild as HTMLElement | null | undefined;
  // Drawn outside a page (a test's renderer), it is as it says.
  if (list === null || list === undefined || typeof getComputedStyle !== "function") return scroll;
  const pad = paddingOf(scroll);
  return laidOutPosition({
    scrollTop: scroll.scrollTop,
    scrollHeight: scroll.scrollHeight,
    clientHeight: scroll.clientHeight,
    laidHeight: list.offsetHeight + pad,
  });
}

// ---------------------------------------------------------------------------
// Background work, outside any card
// ---------------------------------------------------------------------------

/**
 * Background work as one quiet line (`backgroundLine.logic`): what a turn
 * sent to the background, on its own card, or what woke the run under it —
 * what runs, what finished, what failed — and, opened, each task once, a
 * failure first, with what it reported; never the line's own words again.
 */
export function BackgroundLine({ line }: { readonly line: BackgroundLineModel }) {
  const hold = useHoldReading();
  const [open, setOpen] = useState(false);
  const { words, where, failed, items, single: lone } = line;
  const opens = items.length > 0;
  const head = (
    <span className="flex min-w-0 items-center text-line">
      {/* The page's mark column: its dot where an event's icon stands, its
          words on the edge the answer's list items start on. */}
      <span aria-hidden="true" className="flex w-5 shrink-0">
        <span className="flex size-3.5 items-center justify-center">
          <span
            className={cn(
              "size-1.5 rounded-full",
              failed ? "bg-status-failed" : "bg-muted-foreground/35",
            )}
          />
        </span>
      </span>
      <span
        className={cn(
          "min-w-0 truncate",
          // Several: the dot says one failed, the words say which in their own.
          failed && lone ? "text-status-failed-text" : "text-foreground/85",
        )}
      >
        {words}
      </span>
      {where === null ? null : (
        <span className="ms-2.5 shrink-0 text-line text-muted-foreground">{where}</span>
      )}
      {opens ? (
        <ChevronDownIcon
          aria-hidden="true"
          className="ms-2.5 size-3 shrink-0 text-muted-foreground/70 opacity-0 transition-[opacity,rotate] duration-150 group-hover/disclose:opacity-100 group-aria-expanded/disclose:rotate-180 group-aria-expanded/disclose:opacity-100"
        />
      ) : null}
    </span>
  );
  const said = where === null ? words : `${words}, ${where}`;
  return (
    <div className="grid min-w-0 gap-2" data-background-line>
      {opens ? (
        <button
          aria-expanded={open}
          aria-label={`${said}. ${open ? "Hide" : "Show"} ${lone ? "what it reported" : "each one"}`}
          className="group/disclose -mx-1.5 flex min-h-7 w-[calc(100%+0.75rem)] cursor-pointer items-center rounded-md px-1.5 text-start transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-inset"
          onClick={() => {
            hold(!open);
            setOpen((value) => !value);
          }}
          type="button"
        >
          {head}
        </button>
      ) : (
        <div className="flex min-h-7 items-center">{head}</div>
      )}
      {open ? (
        <ul
          className="grid min-w-0 animate-detail-in gap-3 ps-5 motion-reduce:animate-none"
          data-chat-detail
        >
          {items.map((item) => (
            <li key={item.key} className="grid min-w-0 gap-1">
              {/* One task's line says its title and state: only its report opens. */}
              {lone ? null : (
                <span className="text-line text-foreground/85">
                  {item.title}
                  <span
                    className={
                      item.state === "failed" ? "text-status-failed-text" : "text-muted-foreground"
                    }
                  >
                    {` · ${backgroundItemWord(item)}`}
                    {/* A one-line report reads on the row: "· failed · Exit code 3". */}
                    {item.report !== null && !lone && reportsInline(item.report)
                      ? ` · ${item.report}`
                      : null}
                  </span>
                </span>
              )}
              {item.report === null || (!lone && reportsInline(item.report)) ? null : (
                <OutputBlock mono={item.mono} text={item.report} />
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
