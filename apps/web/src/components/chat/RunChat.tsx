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
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import {
  isActiveSubagentStatus,
  type AgentPanelModel,
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

import { cn } from "~/lib/utils";
import { useAssetUrls, useAssetUrlState } from "../../assets/assetUrls";
import {
  selectMessageImageResources,
  workEntryDisplayIndicatesToolFailure,
  type TurnPlanEntry,
  type WorkLogEntry,
} from "../../session-logic";
import type { ChatImageAttachment, ChatMessage } from "../../types";
import { echoOfMessage } from "./messagePictures.logic";
import ChatMarkdown from "../ChatMarkdown";
import { ChangeChipMomentContext } from "../zerops/ZeropsChangeLinkChip";
import { CrewSeamActivity } from "../zerops/crew/CrewTaskCard";
import { KindGlyph, ZeropsOperationCard } from "../zerops/ZeropsOperationCard";
import { MateFace } from "../zerops/primitives";
import { useChangedSinceShown } from "~/hooks/useChangedSinceShown";
import {
  useOperationCard,
  type OperationCardRegions,
} from "../../zerops/activity/useOperationCard";
import { deriveAgentSpawnSummary } from "./agentSpawnSummary";
import { BrowserStrip, BrowserTakes } from "./BrowserStrip";
import {
  browserCheckCaption,
  browserTakeState,
  formatWorkDuration,
  operationLineWords,
  operationUnreturnedWords,
  type BrowserStripModel,
  type IncidentModel,
  type OutcomeModel,
} from "./conversation.logic";
import { calmClockMs } from "./nowLineCalm.logic";
import { useCalmLine } from "./useCalmLine";
import {
  SLOT_MAX_ROWS,
  slotHolds,
  slotHoldsIn,
  slotRunningPast,
  type LiveSlot as LiveSlotState,
} from "./liveSlot.logic";
import { useLiveSlot } from "./useLiveSlot";
import { backgroundItemWord, type BackgroundLineModel } from "./backgroundLine.logic";
import { useRunEffortWords } from "./runResultFacts";
import { drawerEase, LIST_LAYS_OUT_FRAMES, stepHeight } from "./stepHeight";
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
import { HELPER_LINE_CHARS, helperReportPreview, opensOnto, stepOutput } from "./opens.logic";
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
  formatClock,
  laidOutPosition,
  type RunScrollEvent,
  type RunScrollFollow,
  recoveredFailures,
  nowLineFace,
  nowLineOf,
  nowLineWords,
  operationNowWords,
  reachesEarlier,
  runCardShows,
  runFoldOf,
  setRunFold,
  severalCallsWords,
  slotModelOf,
  type SlotFiller,
  stepNowWords,
  subscribeRunFolds,
  thoughtRunText,
  type NowLine as NowLineModel,
  type RunFold,
  type RunScrollPosition,
} from "./runCard.logic";
import { keepInPlace, scrollerOf } from "./keepInPlace";
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

/** How long a step took; one still running says so, one that never returned says that. */
function stepTime(step: WorkStep): ReactNode {
  if (step.noResult === "closed") return NO_RESULT;
  if (step.noResult === "stale") return null;
  if (step.state === "running") return STILL_RUNNING;
  if (step.background?.state === "running") return IN_THE_BACKGROUND;
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

/** A fold's state: whether it folds at all, whether it is folded now, and its switch. */
interface Fold {
  readonly eligible: boolean;
  readonly folded: boolean;
  /**
   * Whether its switch shows: folded, the way to the rest; opened by the
   * person, the way back. A bubble that simply stands whole — one that
   * arrived while the person watched — offers nothing, so none appears
   * under it later.
   */
  readonly offered: boolean;
  readonly toggle: () => void;
}

/**
 * Whether a bubble is folded. Past the fold's limits it opens folded when the
 * chat opens onto it; one that arrived while the person watched stays whole —
 * nothing folds while the person is looking (K12). Once the person opened or
 * closed it, it stays as they left it.
 */
function useFold(eligible: boolean, foldsLive = false): Fold {
  const arrived = useArrivedLive();
  const hold = useHoldReading("folded");
  const [folded, setFolded] = useCarried("folded", () => eligible && (foldsLive || !arrived));
  const [opened, setOpened] = useCarried("opened", () => false);
  return {
    eligible,
    folded: eligible && folded,
    offered: eligible && (folded || opened),
    toggle: () => {
      hold(folded);
      setOpened(folded);
      setFolded(!folded);
    },
  };
}

/** What folds: its top only while folded, fading into the bubble. */
function FoldBody({
  fold,
  height,
  children,
}: {
  readonly fold: Fold;
  /** How tall it stands folded: eight of its lines. */
  readonly height: "max-h-44" | "max-h-40";
  readonly children: ReactNode;
}) {
  return (
    <div
      className={cn("min-w-0", fold.folded && cn(height, "overflow-hidden"))}
      data-chat-folded={fold.eligible ? String(fold.folded) : undefined}
      style={
        fold.folded ? { WebkitMaskImage: FOLD_FADE_MASK, maskImage: FOLD_FADE_MASK } : undefined
      }
    >
      {children}
    </div>
  );
}

/**
 * The way to more of a bubble, or back: its words in the quiet size, on the
 * bubble's one text edge — every bubble's the same, a thought's, a command's
 * or a message's.
 */
function MoreToggle({
  open,
  onToggle,
  ref,
  children,
}: {
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly ref?: Ref<HTMLButtonElement>;
  readonly children: ReactNode;
}) {
  // The slot draws it as the history does, so a row lands as it stood.
  return (
    <button
      ref={ref}
      aria-expanded={open}
      className={cn(
        META,
        "mt-1 block cursor-pointer rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70",
      )}
      // It stands at the foot of what it opened: closing folds what stands
      // above it, and it stays under the pointer (K12).
      onClick={(event) => (open ? collapseInPlace(event.currentTarget, onToggle) : onToggle())}
      type="button"
    >
      {children}
    </button>
  );
}

/**
 * Closes what `pressed` opened, keeping `pressed` where it stands on screen
 * — or, where it is gone once closed, the foot of the bubble it stood in.
 */
function collapseInPlace(pressed: HTMLElement, close: () => void) {
  keepInPlace({
    anchor: pressed,
    fallback: pressed.closest<HTMLElement>("[data-chat-bubble], [data-chat-row]"),
    scroller: scrollerOf(pressed),
    change: () => flushSync(close),
  });
}

/** The way to the rest of a folded bubble, in the person's own words for it. */
function FoldToggle({
  fold,
  more = "Show full message",
}: {
  readonly fold: Fold;
  readonly more?: string;
}) {
  if (!fold.offered) return null;
  return (
    <MoreToggle onToggle={fold.toggle} open={!fold.folded}>
      {fold.folded ? more : "Show less"}
    </MoreToggle>
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
 * What a call's detail says, in its own inset on the code's left edge — a
 * command's output, a report, an error: a well under what was run, never
 * text that drifts left of it.
 */
function OutputBlock({
  label = null,
  mono = true,
  text,
}: {
  readonly label?: string | null;
  readonly mono?: boolean;
  readonly text: string;
}) {
  const hold = useHoldReading();
  const lines = text.split("\n").length;
  const [taller, watch] = useTallerThan(OUTPUT_CAP_PX, lines > OUTPUT_CAP_LINES);
  const [open, setOpen] = useState(false);
  // No scroll inside the run's scroll: past twelve lines it folds, and the
  // way to the rest opens it in place (D4).
  const folded = taller && !open;
  return (
    <section aria-label={label ?? undefined} className="grid min-w-0 gap-1">
      {label === null ? null : <h4 className={cn(META, "text-muted-foreground")}>{label}</h4>}
      <pre
        className={cn(
          "min-w-0 whitespace-pre-wrap break-words rounded-xl bg-foreground/4 px-3 py-2 text-foreground/80 select-text",
          META,
          mono ? "font-mono" : "font-sans",
          folded && "max-h-64 overflow-hidden",
        )}
        data-chat-folded={taller ? String(folded) : undefined}
        style={folded ? { WebkitMaskImage: FOLD_FADE_MASK, maskImage: FOLD_FADE_MASK } : undefined}
      >
        <span ref={watch} className="block">
          {text}
        </span>
      </pre>
      {taller ? (
        <MoreToggle
          onToggle={() => {
            hold(!open);
            setOpen((value) => !value);
          }}
          open={open}
        >
          {open
            ? "Show less"
            : lines > OUTPUT_CAP_LINES
              ? `Show all ${lines} lines`
              : "Show the rest"}
        </MoreToggle>
      ) : null}
    </section>
  );
}

/** Twelve of an output's 20 px lines: past them it folds. */
const OUTPUT_CAP_PX = 240;
const OUTPUT_CAP_LINES = 12;

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
        <span className="min-w-0 flex-1 break-words" data-run-shimmer={running ? "" : undefined}>
          {children}
        </span>
        <span aria-hidden="true" className="run-slot-clock-room" />
      </span>
    );
  }
  return (
    <span className={cn("flex min-w-0 items-start gap-2", META)}>
      <span className="min-w-0 flex-1 break-words" data-run-shimmer={running ? "" : undefined}>
        {children}
      </span>
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
        text={message.text}
        threadRef={ctx.threadRef ?? undefined}
      />
    </ChangeChipMomentContext>
  );
}

/**
 * A stretch of thinking. Settled, its words are read once, whole; still
 * coming, a paragraph at a time, each keyed where it stands, so the ones
 * written keep their place as the newest grows.
 */
function ThoughtParagraphs({ messages }: { readonly messages: ReadonlyArray<ChatMessage> }) {
  const ctx = use(TimelineRowCtx);
  if (!messages.some((message) => message.streaming)) {
    return (
      <div className="italic">
        <ChatMarkdown
          className={THOUGHT_TEXT}
          cwd={ctx.markdownCwd}
          headingLevelOffset={MESSAGE_HEADING_LEVEL}
          skills={ctx.skills}
          text={messages.flatMap((message) => thoughtParagraphs(message.text)).join("\n\n")}
          threadRef={ctx.threadRef ?? undefined}
        />
      </div>
    );
  }
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
      {keyedByOccurrence(questions).map(({ key, value }) => (
        <p key={key} className="whitespace-pre-wrap break-words">
          {value}
        </p>
      ))}
    </Bubble>
  );
}

/** Its words to the person on the way: the chat's bubble in its fullest fill. */
function NoteBubble({ message }: { readonly message: ChatMessage }) {
  // One cap live and in the history: a note past it stands folded in both,
  // so its plop moves it and never resizes it.
  const fold = useFold(foldsLikeAMessage(message.text), true);
  return (
    <Bubble className={BUBBLE_PAD} kind="note" tone="speech">
      <FoldBody fold={fold} height="max-h-44">
        <NoteWords message={message} />
      </FoldBody>
      <FoldToggle fold={fold} />
    </Bubble>
  );
}

/** A thought's hand: small, faint and italic — its code and file names too. */
const THOUGHT_TEXT = "chat-markdown-aside text-muted-foreground";

/** About two of a thought's lines on a desktop card: what a first frame guesses runs past them. */
const THOUGHT_GUESS_CHARS = 180;

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

/** How many lines of a thought show, live and in the history alike (pass 35): a whole sentence. */
const THOUGHT_CAP_LINES = 4;

/**
 * A thought as it streams in the live slot: its newest lines in view, four
 * at most — the history's cap, so its plop never resizes it — and a fade at
 * its top once its words run past them.
 */
function LiveThought({ run }: { readonly run: string }) {
  const [over, watch] = useTallerThan(THOUGHT_CAP_LINES * 20, run.length > THOUGHT_GUESS_CHARS * 2);
  return (
    <div className="run-thought-live" data-over={over ? "" : undefined}>
      <span ref={watch} className="block italic">
        {run}
      </span>
    </div>
  );
}

/**
 * A stretch of its thinking, the quietest thing in the card (K14): 13 px,
 * faint and italic on the faintest fill, four lines of it at most, read from
 * its head. One that runs on says "Show full thought" — a click opens the
 * whole thought in place, and "Show less" closes it (D4: nothing is cut
 * without a way to reach it). In the live slot it shows its newest lines.
 */
function ThoughtBubble({ messages }: { readonly messages: ReadonlyArray<ChatMessage> }) {
  const text = messages.map((message) => message.text).join("\n\n");
  const run = thoughtRunText(text);
  const inSlot = use(InSlotContext);
  const hold = useHoldReading();
  const [open, setOpen] = useState(false);
  const [past, watch] = useRunsPast(run.length > THOUGHT_GUESS_CHARS * 2);
  // Opening swaps the thought's button for "Show less", and closing swaps it
  // back: the focus goes with the person's press to the one that stands —
  // scrolling nothing, or the card would read it as their move.
  const toggleRef = useRef<HTMLButtonElement>(null);
  const handOnRef = useRef(false);
  useLayoutEffect(() => {
    if (!handOnRef.current) return;
    handOnRef.current = false;
    toggleRef.current?.focus({ preventScroll: true });
  });
  const toggle = (next: boolean) => {
    handOnRef.current = true;
    hold(next);
    setOpen(next);
  };
  if (text.trim().length === 0) return null;
  if (inSlot) {
    return (
      <Bubble className={THOUGHT_PAD} kind="thought" size={META} tone="thought">
        <LiveThought run={run} />
      </Bubble>
    );
  }
  const clamped = (
    <span ref={watch} className="line-clamp-4 italic" data-chat-folded={past ? "true" : undefined}>
      {run}
    </span>
  );
  return (
    <Bubble className={THOUGHT_PAD} kind="thought" size={META} tone="thought">
      {open ? (
        <>
          <ThoughtParagraphs messages={messages} />
          <MoreToggle ref={toggleRef} onToggle={() => toggle(false)} open>
            Show less
          </MoreToggle>
        </>
      ) : past ? (
        <button
          ref={toggleRef}
          aria-expanded={false}
          aria-label={`${run.slice(0, 80)}… Show full thought`}
          className="relative block w-full min-w-0 cursor-pointer rounded-sm text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
          data-chat-disclose
          onClick={() => toggle(true)}
          type="button"
        >
          {clamped}
          <span aria-hidden="true" className="run-thought-more">
            Show full thought
          </span>
        </button>
      ) : (
        clamped
      )}
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

/** The pictures a step looked at, as themselves: small, each one opening the picture viewer. */
function StepPictures({ paths }: { readonly paths: ReadonlyArray<string> }) {
  if (paths.length === 0) return null;
  const { threadRef, onImageExpand } = use(TimelineRowCtx);
  if (threadRef === null) return null;
  return (
    <span className="flex min-w-0 flex-wrap gap-1.5 px-3 pb-1.75">
      {paths.map((path) => (
        <StepPicture key={path} onOpen={onImageExpand} path={path} threadRef={threadRef} />
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
      className="block h-20 cursor-zoom-in overflow-hidden rounded-lg border border-border/60 bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
      onClick={() => onOpen({ images: [{ src: asset.url, name }], index: 0 })}
      type="button"
    >
      <img
        alt={name}
        className="block h-full w-auto max-w-40 object-cover object-top"
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

/** Four of a command's 20 px lines: past them, the way to the rest. */
const CODE_CAP_PX = 80;
const CODE_CAP_LINES = 4;

/**
 * Whether what `watch` is given stands taller than `cap` pixels — measured on
 * the content, not the box that caps it, so it holds folded or open. Until it
 * is measured — the first render, before the page paints it — the words' own
 * length guesses.
 */
function useTallerThan(
  cap: number,
  guess: boolean,
): readonly [boolean, (element: HTMLElement | null) => void] {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [taller, setTaller] = useState(guess);
  useLayoutEffect(() => {
    if (element === null) return;
    const measure = () => setTaller(element.offsetHeight > cap + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, cap]);
  const [watch] = useState(() => (node: HTMLElement | null) => setElement(node));
  return [taller, watch];
}

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
 * A command's code, in mono: four lines of it from its first frame and a fade
 * where it goes on — a script never prints whole into the chat (the owner,
 * 2026-09-28: "I see 100s of LoC printed directly"). It is how, under what the
 * command was for, on the words' own edge: in the muted ink, failed too — its
 * mark and its right edge say that it failed.
 */
function CommandCode({
  script,
  folded,
  watch,
}: {
  readonly script: string;
  /** Cut to its first four lines. */
  readonly folded: boolean | null;
  readonly watch: (element: HTMLElement | null) => void;
}) {
  return (
    <div
      className={cn("min-w-0", folded === true && "max-h-20 overflow-hidden")}
      data-chat-folded={folded === null ? undefined : String(folded)}
      style={
        folded === true ? { WebkitMaskImage: FOLD_FADE_MASK, maskImage: FOLD_FADE_MASK } : undefined
      }
    >
      <code
        ref={watch}
        className={cn(
          "block whitespace-pre-wrap break-words font-mono text-muted-foreground",
          META,
        )}
      >
        {script}
      </code>
    </div>
  );
}

/**
 * A call the Mate made, as its row in the card of calls: led by what kind of
 * call it was, its time and a chevron on the card's right edge. A command
 * says what it was for, then four lines of its code. The row opens as one
 * thing: its first line or "Show all N lines" shows the whole code and what it
 * printed, in an inset on the code's own left edge, and "Show less" folds it
 * back. The one it is making now counts its time in the same quiet ink:
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
  // line, in mono, and the rest of it opens under it. In the live slot it
  // stands open to its cap, and lands so.
  const bare = script !== null && step.words === null;
  // In the slot it follows the code as it streams in, until the person sets it.
  const disclosure = useDisclosure(bare && inSlot && step.codeLines > 1, "open", true);
  // A bare command opened to its cap, then whole.
  const whole = useDisclosure(false, "whole");
  const outputs = stepOutput(step);
  const failure: Failure | null = step.state !== "failed" ? null : undone ? "undone" : "broken";
  const running = step.state === "running";
  const time = stepTime(step);
  const [taller, watchCode] = useTallerThan(CODE_CAP_PX, step.codeLines > CODE_CAP_LINES);
  const cut = script !== null && (bare ? step.codeLines > 1 : taller);
  const showsCode = script !== null && (!bare || disclosure.open);
  const bareCapped = bare && disclosure.open && step.codeLines > CODE_CAP_LINES && !whole.open;
  const opens = opensOnto({ control: "step", step, codeCut: cut });
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
  const pad = showsCode || cut ? "ps-3 pe-3.5 pt-1.75 pb-0.5" : CALL_PAD;
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
          label={`${title}. ${disclosure.open ? "Hide" : "Show"} ${
            outputs.length > 0 ? "what it returned" : "the whole command"
          }`}
          onToggle={disclosure.toggle}
          open={disclosure.open}
        >
          {headline}
        </DisclosureButton>
      ) : (
        <div className={pad}>{headline}</div>
      )}
      {showsCode ? (
        <div className={cn("px-3", cut ? "pb-0.5" : "pb-1.75")}>
          <CommandCode
            folded={cut && !bare ? !disclosure.open : bare && cut ? bareCapped : null}
            script={script}
            watch={watchCode}
          />
        </div>
      ) : null}
      <StepPictures paths={step.images} />
      {disclosure.open && outputs.length > 0 ? (
        <div
          className={cn("grid gap-2 px-3 pb-2", rises(disclosure.made))}
          data-chat-detail
          data-chat-detail-rises={disclosure.made ? "" : undefined}
        >
          {outputs.map((output) => (
            <OutputBlock key={output.key} label={output.label} text={output.text} />
          ))}
        </div>
      ) : null}
      {cut ? (
        <div className="px-3 pb-1.75">
          {bareCapped ? (
            <MoreToggle onToggle={() => whole.set(true)} open={false}>
              {`Show all ${step.codeLines} lines`}
            </MoreToggle>
          ) : (
            <MoreToggle
              onToggle={() => {
                if (bare && disclosure.open) whole.set(false);
                else if (bare) whole.set(true);
                disclosure.toggle();
              }}
              open={disclosure.open}
            >
              {disclosure.open
                ? "Show less"
                : bare || step.codeLines > CODE_CAP_LINES
                  ? `Show all ${step.codeLines} lines`
                  : "Show the whole command"}
            </MoreToggle>
          )}
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
  const lines = inBand ? 0 : (given ?? detailLines(operation, null, observed));
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
  const words =
    noResult === undefined ? operationLineWords(operation) : operationUnreturnedWords(operation);
  const reason = failed ? (operation.explanation?.reason ?? operation.closing ?? null) : null;
  const detail =
    reason ?? (operation.kind === "deploy" ? (versionText(operation.version?.name) ?? null) : null);
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
        <span className="text-foreground/75" data-run-shimmer={live === null ? undefined : ""}>
          {words}
        </span>
        {live !== null ? (
          <>
            <StatusBar className="w-12" segments={live.segments} />
            {live.word === null ? null : <span className="text-muted-foreground">{live.word}</span>}
          </>
        ) : running || noResult !== undefined ? null : (
          <StatusBar className="w-12" segments={settledOperationBar(operation, undone)} />
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
      {opens && disclosure.open && lines !== 0 ? (
        <div
          className={cn(
            "px-3 pb-2",
            // Only an open the person made moves; a carried or a landing one is simply there.
            rises(disclosure.made),
          )}
          data-chat-detail
          data-chat-detail-rises={disclosure.made ? "" : undefined}
        >
          <OperationDetail
            environmentId={ctx.activeThreadEnvironmentId}
            operation={operation}
            threadRef={ctx.threadRef}
            turnRuns={turnRuns}
            {...(regions === null ? {} : { regions })}
          />
        </div>
      ) : null}
    </CallRow>
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
function ChecksBubble({ strip }: { readonly strip: BrowserStripModel }) {
  const ctx = use(TimelineRowCtx);
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
 * One helper: its task in the words it was given, its state and how long it
 * ran — never the model or the harness's role name — and what it said, whole,
 * under it once opened.
 */
function HelperRow({ agent }: { readonly agent: RuntimeSubagent }) {
  const hold = useHoldReading();
  const [open, setOpen] = useState(false);
  const active = isActiveSubagentStatus(agent.status);
  const said = (
    active ? (agent.progress ?? null) : (agent.error ?? agent.result ?? agent.progress ?? null)
  )?.trim();
  const durationMs =
    agent.startedAt && agent.completedAt
      ? Date.parse(agent.completedAt) - Date.parse(agent.startedAt)
      : null;
  const state =
    !active && durationMs !== null && durationMs >= 1000
      ? `${AGENT_STATUS_WORD[agent.status]} · ${formatWorkDuration(durationMs)}`
      : AGENT_STATUS_WORD[agent.status];
  const word = AGENT_STATUS_WORD[agent.status];
  // Its report's first line under it, unless it says its state again; it
  // opens only onto more than that line says.
  const firstLine = helperReportPreview(said ?? null, word);
  // Cut short at the card's width, as measured — a first frame guesses by its length.
  const [previewCut, watchPreview] = useRunsPast(
    (firstLine?.length ?? 0) > HELPER_LINE_CHARS,
    true,
  );
  const opens = opensOnto({ control: "helper", report: said ?? null, state: word, previewCut });
  const line = (
    <span className={cn("flex min-w-0 items-baseline gap-3", META)}>
      <span
        className={cn(
          "min-w-0 flex-1 truncate",
          agent.status === "failed" ? "text-status-failed-text" : "text-foreground/90",
        )}
      >
        {agent.title}
      </span>
      <span className={cn("shrink-0 text-muted-foreground tabular-nums", META)}>{state}</span>
    </span>
  );
  return (
    <li className="grid min-w-0 gap-1">
      {opens ? (
        <button
          aria-expanded={open}
          className="grid min-w-0 cursor-pointer gap-0.5 rounded-lg px-1.5 py-1 text-start transition-colors hover:bg-foreground/4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
          onClick={() => {
            hold(!open);
            setOpen((value) => !value);
          }}
          type="button"
        >
          {line}
          {open || firstLine === null ? null : (
            <span ref={watchPreview} className={cn("truncate text-muted-foreground", META)}>
              {firstLine}
            </span>
          )}
        </button>
      ) : (
        <div className="grid min-w-0 gap-0.5 px-1.5 py-1">
          {line}
          {firstLine === null ? null : (
            <span ref={watchPreview} className={cn("truncate text-muted-foreground", META)}>
              {firstLine}
            </span>
          )}
        </div>
      )}
      {open && opens && said ? <OutputBlock mono={false} text={said} /> : null}
    </li>
  );
}

/** The helpers a launch started, as the agents panel knows them. */
function spawnAgents(model: AgentPanelModel, spawn: NonNullable<WorkLogEntry["agentSpawn"]>) {
  const memberIds = new Set(spawn.agentTaskIds);
  const workflowGroup = spawn.workflowId
    ? model.workflows.find((group) => group.workflow.id === spawn.workflowId)
    : undefined;
  const agents = workflowGroup
    ? [...workflowGroup.phases.flatMap((phase) => phase.members), ...workflowGroup.unphasedMembers]
    : model.directAgents.filter((agent) => memberIds.has(agent.id));
  const count = Math.max(
    agents.length,
    Math.max(memberIds.size - (spawn.workflowId ? 1 : 0), 0),
    1,
  );
  const summary = deriveAgentSpawnSummary({
    agents,
    agentCount: count,
    coordinatorStatus: workflowGroup?.workflow.status,
  });
  const workflowName =
    workflowGroup?.workflow.workflowName ?? workflowGroup?.workflow.title ?? null;
  return { agents, count, summary, workflowName };
}

/** Helpers it started: how many and what for; each one, its state and what it said, opened under it. */
function HelpersBubble({ entry }: { readonly entry: WorkLogEntry }) {
  const ctx = use(TimelineRowCtx);
  const disclosure = useDisclosure();
  const spawn = entry.agentSpawn;
  if (!spawn) return null;
  const { agents, count, summary, workflowName } = spawnAgents(ctx.agentPanelModel, spawn);
  const words = count === 1 ? "Started a helper" : `Started ${count} helpers`;
  const what =
    workflowName ??
    (agents.length === 1 ? agents[0]!.title : agents.map((agent) => agent.title).join(" · "));
  const failed = summary.tone === "failed";
  // Helpers not known yet: nothing to open onto.
  const opens = opensOnto({ control: "helpers", agents: agents.length });
  const head = (
    <Headline column opens={opens} timeTone="muted" time={summary.live ? "Working" : null}>
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
          <button
            className={cn(
              META,
              "cursor-pointer justify-self-start rounded px-1.5 text-info-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70",
            )}
            onClick={ctx.onOpenAgents}
            type="button"
          >
            Open the helpers panel
          </button>
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
  const where = entry.agentRole !== undefined ? "helper" : "in the background";
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
            className="block h-16 cursor-zoom-in overflow-hidden rounded-lg border border-border/60 bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
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
            <img
              alt={picture.name}
              className="block h-full w-auto max-w-32 object-cover"
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
function itemLine(item: RecordItem, undone: ReadonlySet<string>): ChatLine | null {
  switch (item.kind) {
    case "step":
      return {
        key: item.key,
        bubble: <StepBubble step={item.step} undone={undone.has(item.key)} />,
        call: true,
      };
    case "call":
      return {
        key: item.key,
        bubble: <StepBubble step={stepOf(item.entry, undefined, false)} />,
        call: true,
      };
    case "thought":
      // A thought with no words shows nothing: no line of the chat.
      if (item.messages.every((message) => message.text.trim().length === 0)) return null;
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
  const sweep = sweeps ? "" : undefined;
  if (step.kind === "command" && step.words === null) {
    return (
      <span className="run-now-verb run-now-mono" data-run-shimmer={sweep}>
        {step.code}
      </span>
    );
  }
  if (step.kind !== "command" && step.phrase !== null) {
    return (
      <span className="run-now-verb" data-run-shimmer={sweep}>
        {step.phrase.verb}
        {keyedByOccurrence(step.phrase.targets).map(({ key, value }, index, all) => (
          <Fragment key={key}>
            {index === 0 ? " " : index === all.length - 1 ? " and " : ", "}
            <span className="run-now-mono">{value}</span>
          </Fragment>
        ))}
        {step.phrase.more > 0 ? ` and ${step.phrase.more} more` : null}
      </span>
    );
  }
  return (
    <>
      <span className="run-now-verb" data-run-shimmer={sweep}>
        {stepNowWords(step)}
      </span>
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
          <span className="run-now-verb" data-run-shimmer="">
            {operationNowWords(line.operation)}
          </span>
        </>
      );
    case "several":
      return <span className="run-now-verb">{severalCallsWords(line.calls)}</span>;
    case "waiting":
      return <span className="run-now-verb">{nowLineWords(line)}</span>;
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
  now,
  answering,
  outcome,
  end = null,
}: {
  readonly status: RunStatus;
  readonly now: TurnHeaderActivity | null;
  readonly answering: boolean;
  /** What the run came to: its effort, on the worked line (`useRunEffortWords`). */
  readonly outcome: OutcomeModel | null;
  /** What stands in the right column once the run is over. */
  readonly end?: ReactNode;
}) {
  const ctx = use(TimelineRowCtx);
  const { isCompacting } = use(TimelineRowActivityCtx);
  const effort = useRunEffortWords(outcome);
  const latest = nowLineOf({
    status,
    now,
    answering,
    compacting: isCompacting,
    speaker: ctx.speaker.name,
    effort,
  });
  // A line once shown stands a moment, and a burst shows its latest only
  // (`nowLineCalm.logic`); the run's end shows at once.
  const line = useCalmLine(latest, nowLineWords(latest), !status.live);
  const face = nowLineFace(line, status);
  const words = nowLineWords(line);
  // The line's words change in place as the run goes: the old ones leave
  // where they stood as the new ones rise into it, so a change reads as the
  // same line saying something new.
  const wordsChanged = useChangedSinceShown(words);
  const leaving = useLeavingLine(line, words);
  const head = (
    <span key={words} className="run-now-head" data-run-now-change={wordsChanged ? "" : undefined}>
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
      <MateFace
        gaze={face.gaze}
        greets
        known={ctx.arrivedAfter !== null && !ctx.syncing}
        shape={ctx.speaker.shape}
        size="sm"
        state={face.state}
        tint={ctx.speaker.tint}
      />
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
      {status.live ? <RunTicker status={status} /> : (end ?? <span />)}
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

const NO_KEYS: ReadonlyArray<string> = [];
const NO_HOLDS: ReadonlySet<string> = new Set();

/** Lines landing from the live slot: where each stood, and where the history's lines stood. */
interface Landing {
  /** Each line leaving the slot by its key, by where its row stood (NaN: it rode along unseen). */
  readonly from: ReadonlyMap<string, number>;
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
  const line = mark?.getBoundingClientRect();
  const top = slotBox.getBoundingClientRect().top;
  const y = line === undefined ? null : line.top + line.height / 2 - top;
  if (y === null) slotBox.style.removeProperty("--run-slot-line");
  else slotBox.style.setProperty("--run-slot-line", `${y}px`);
  // The room the slot takes, its gap above it included: on a short page
  // the card holds it whole once the history has none left to give.
  const chat = slotBox.parentElement;
  if (chat !== null) {
    const above = slotBox.previousElementSibling ?? null;
    const from =
      above === null ? chat.getBoundingClientRect().top : above.getBoundingClientRect().bottom;
    chat.style.setProperty(
      "--run-slot-room",
      `${Math.ceil(slotBox.getBoundingClientRect().bottom - from)}px`,
    );
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
  return filler.kind === "waiting" ? `waiting:${filler.on}` : filler.kind;
}

function LiveSlot({
  ref,
  slot,
  live,
  items,
  filler,
  now,
  answering,
  status,
  undone,
}: {
  readonly ref: Ref<HTMLDivElement>;
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
}) {
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
    const answer =
      item.kind === "question"
        ? entry.riders.flatMap((key) => {
            const rider = byKey.get(key);
            return rider?.kind === "person" ? [{ entry, item: rider }] : [];
          })
        : [];
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
    .flatMap(({ item }) => {
      const line = itemLine(item, undone);
      return line === null ? [] : [line];
    })
    .map((line, index, all) =>
      line.theirs === true && all[index - 1]?.asks === true ? { ...line, pairs: true } : line,
    );
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
  // The face and the clock stand on the first line, whatever bubble it is in.
  useLayoutEffect(() => {
    placeSlot(listRef.current);
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
      data-run-now={lines.length === 0 ? said.kind : "items"}
      data-run-status={latest.kind === "waiting" ? "waiting" : "working"}
      data-work-line={status.face}
    >
      <span className="run-slot-face">
        <MateFace
          gaze={face.gaze}
          greets
          known={ctx.arrivedAfter !== null && !ctx.syncing}
          shape={ctx.speaker.shape}
          size="sm"
          state={face.state}
          tint={ctx.speaker.tint}
        />
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
      <span className="run-slot-clock">
        <RunTicker status={status} />
      </span>
      {/* What a screen reader hears: what the Mate is on, as it changes. */}
      <span className="sr-only" role="status">
        {nowLineWords(latest)}
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
  const hold = useHoldReading();
  const rootRef = useRef<HTMLDivElement>(null);
  const aboveRef = useRef<HTMLDivElement>(null);
  // Whether the person reads the work this moment — scrolled up in it, or
  // something in it opened: a run settling then stays open.
  const readingRef = useRef(false);
  // How the history's scroll keeps to its foot, for a line landing in it.
  const keepScrollRef = useRef<(() => void) | null>(null);
  const { fold, foldNow, settling } = useRunFold({
    conversation: ctx.routeThreadKey,
    run: row.turnKey,
    live: row.live,
    readingRef,
    rootRef,
    aboveRef,
  });
  // A run the person comes back to (D3), or one that just settled: its
  // worked line alone — the summary — and "Show work" opens the whole run
  // under it (K12).
  const settled = row.status !== null && !row.live;
  const shows = runCardShows(settled, fold);
  const folded = shows.toggle === "show";
  // The work stands over the line while the run goes on, while it stays open
  // for a reader, and while it folds away into the line.
  const above = shows.work === "above";
  // What a later step undid, read once per record, not once per redraw.
  const undone = useMemo(() => recoveredFailures(row.items), [row.items]);
  // The live slot (pass 35): what the Mate is doing this moment, each thing
  // as the row it becomes; it plops into the history once it ended and
  // stood its minimum. Only the run's last record, while it runs, has one.
  const { isCompacting } = use(TimelineRowActivityCtx);
  const slotted = row.live && row.status !== null;
  const model = useMemo(
    () =>
      slotModelOf({
        now: row.now,
        answering: row.answering,
        compacting: isCompacting,
        items: row.items,
      }),
    [row.now, row.answering, isCompacting, row.items],
  );
  // A folded line's own calls are the record's too (`parts`).
  const recordKeys = useMemo(
    () =>
      row.items.flatMap((item) =>
        item.kind === "step" && item.parts !== undefined
          ? [item.key, ...item.parts.map((part) => part.key).filter((key) => key !== item.key)]
          : [item.key],
      ),
    [row.items],
  );
  const slotRef = useRef<HTMLDivElement>(null);
  // Where each row leaving the slot stood, and each line of the history, read
  // before they move: the plop starts there, and the history glides from there.
  const [landing, setLanding] = useState<Landing | null>(null);
  const slot = useLiveSlot({
    live: slotted ? model.live.map((item) => item.key) : NO_KEYS,
    record: recordKeys,
    final: !slotted,
    syncing: ctx.syncing,
    onChange: (from, to, redrawn) => {
      const after = slotHolds(to);
      const before = slotHolds(from);
      const leaving = [...before].filter((key) => !after.has(key));
      // What enters makes its room too: the history glides as the slot grows.
      const entering = to.entries.some((entry) => !before.has(entry.key));
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
        rows: slotted ? painted.rows : new Map(),
        slot: slotted ? painted.slot : null,
        card: painted.card,
        staying: slotted ? painted.slotRows : new Map(),
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
    if (prefersReducedMotion()) {
      for (const key of landing.from.keys()) {
        // Faded from its first frame: never a frame at full opacity first.
        rowByKey(aboveRef.current, key)?.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: 200,
          easing: "ease",
          fill: "backwards",
        });
      }
      return;
    }
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
  useLayoutEffect(() => {
    paintedRef.current = slotted ? paintedNow() : null;
  });
  const holds = slotted ? slotHoldsIn(slot, recordKeys) : NO_HOLDS;
  // A folded line whose call the slot still holds stands unfolded, that call
  // left out: it folds in once the call lands.
  const history =
    holds.size === 0
      ? row.items
      : row.items.flatMap((item): RecordItem[] => {
          if (holds.has(item.key)) return [];
          if (item.kind !== "step" || item.parts === undefined) return [item];
          if (!item.parts.some((part) => holds.has(part.key))) return [item];
          return item.parts.filter((part) => !holds.has(part.key));
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
  const lines = above || !folded ? chatLines(history, undone) : [];
  // The scroll mounts with its first line, so its box is there from its
  // first frame for what keeps it at its foot.
  const scroll =
    lines.length === 0 ? null : (
      <RunScroll
        label={`${ctx.speaker.name}'s work`}
        landing={landing?.from ?? null}
        lines={lines}
        keepRef={keepScrollRef}
        {...(above ? { readingRef } : {})}
      />
    );
  return (
    // One container for the chat and its now line: the Mate's column keeps
    // one gap for both. Its words wear its tint (`.run-speech`). Keyed, so the
    // scroll the person watched is the one that folds away.
    <CarriedOpenContext value={carriedOpen}>
      <div
        ref={rootRef}
        className="@container/chat min-w-0"
        data-run-chat
        data-run-fold={settled ? fold : undefined}
        // The shared height holds through the settle's fold: dropped in the
        // commit the fold measures, the history jumped to its own height first.
        data-run-live={slotted || settling || fold === "folding" ? "" : undefined}
        style={
          { "--run-speaker-tint": `var(--zerops-mate-tint-${ctx.speaker.tint})` } as CSSProperties
        }
      >
        {above && scroll !== null ? (
          <div
            key="above"
            ref={aboveRef}
            className="run-above"
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
            outcome={row.outcome}
            end={
              // A chat opens from its first thing the Mate did (`chatLines`),
              // and only onto a line that shows something.
              shows.toggle !== null &&
              opensOnto({ control: "work", lines: chatLineCount(row.items) }) ? (
                <WorkToggle
                  onToggle={() => {
                    hold(folded);
                    // Watched to its end and still open over its line: it
                    // folds into the line as a run settling does.
                    if (fold === "watched") {
                      foldNow();
                      return;
                    }
                    fromHeightRef.current = feedRef.current?.getBoundingClientRect().height ?? null;
                    setRunFold(ctx.routeThreadKey, row.turnKey, folded ? "shown" : "folded");
                  }}
                  open={!folded}
                />
              ) : null
            }
            now={null}
            status={row.status}
          />
        ) : (
          <LiveSlot
            key="slot"
            ref={slotRef}
            items={row.items}
            live={model.live}
            filler={model.filler}
            now={row.now}
            answering={row.answering}
            slot={slot}
            status={row.status}
            undone={undone}
          />
        )}
        <div key="below" ref={feedRef} className="run-later-feed">
          {above ? null : scroll}
        </div>
      </div>
    </CarriedOpenContext>
  );
}

/** How many lines `chatLines` draws, counted without drawing them. */
function chatLineCount(items: ReadonlyArray<RecordItem>): number {
  let count = 0;
  for (const item of items) {
    // A thought with no words is no line; the person's words before anything
    // the Mate did mark nothing.
    if (item.kind === "thought" && item.messages.every((message) => !message.text.trim())) {
      continue;
    }
    if (count === 0 && item.kind === "person") continue;
    count += 1;
  }
  return count;
}

/**
 * A record's items as the chat's lines, from the first thing the Mate did;
 * `undone` the failures a later step undid (`recoveredFailures`).
 */
function chatLines(items: ReadonlyArray<RecordItem>, undone: ReadonlySet<string>): ChatLine[] {
  const lines = items.flatMap((item) => {
    const line = itemLine(item, undone);
    return line === null ? [] : [line];
  });
  // A mark says where in the run the person spoke; before anything the Mate
  // did it marks nothing — their words stand on the page right above the
  // card, and the card opened on a second copy of them.
  while (lines[0]?.theirs === true) lines.shift();
  // An answer pairs with the question right above it.
  return lines.map((line, index) =>
    line.theirs === true && lines[index - 1]?.asks === true ? { ...line, pairs: true } : line,
  );
}

/**
 * How a run's card stands in this conversation. A live run is watched; as it
 * settles its work eases shut into its line — unless the person is reading
 * it right then, when it stays open until they leave (`forgetRunFolds`) or it
 * is drawn again. A run that settled out of sight is simply folded, and so is
 * every run under reduced motion.
 */
function useRunFold({
  conversation,
  run,
  live,
  readingRef,
  rootRef,
  aboveRef,
}: {
  readonly conversation: string;
  readonly run: string;
  readonly live: boolean;
  readonly readingRef: { readonly current: boolean };
  readonly rootRef: { readonly current: HTMLElement | null };
  readonly aboveRef: { readonly current: HTMLElement | null };
}): { readonly fold: RunFold; readonly foldNow: () => void; readonly settling: boolean } {
  const read = () => runFoldOf(conversation, run);
  const stored = useSyncExternalStore(subscribeRunFolds, read, read);
  const fold = live ? "watched" : stored;
  const wasLiveRef = useRef(live);
  // The draw where the run settled, before its fold is measured: the card
  // holds its live height through it, or it jumps first.
  const [drawnLive, setDrawnLive] = useState(live);
  const settling = !live && drawnLive && stored === "watched";
  // Where the line's words stood as the run settled: the fold starts there.
  const settledAtRef = useRef<number | null>(null);
  // It folds from where its line's words stand now, easing the work shut
  // into the line — at once under reduced motion.
  const foldNow = () => {
    const words = nowWordsOf(rootRef.current);
    settledAtRef.current =
      words === null || prefersReducedMotion() ? null : words.getBoundingClientRect().top;
    setRunFold(conversation, run, settledAtRef.current === null ? "folded" : "folding");
  };
  const foldOnSettle = useEffectEvent(foldNow);
  useLayoutEffect(() => {
    const wasLive = wasLiveRef.current;
    wasLiveRef.current = live;
    setDrawnLive(live);
    if (live) {
      setRunFold(conversation, run, "watched");
      return;
    }
    if (runFoldOf(conversation, run) !== "watched") return;
    // It settled out of sight, or it is drawn again since: nobody reads it.
    if (!wasLive) {
      setRunFold(conversation, run, "folded");
      return;
    }
    if (readingRef.current) return;
    foldOnSettle();
  }, [conversation, run, live, readingRef]);
  useLayoutEffect(() => {
    if (fold !== "folding") return;
    const from = settledAtRef.current;
    settledAtRef.current = null;
    const above = aboveRef.current;
    const words = nowWordsOf(rootRef.current);
    const done = () => setRunFold(conversation, run, "folded");
    if (from === null || above === null || words === null) {
      done();
      return;
    }
    return foldAway(above, from - words.getBoundingClientRect().top, done);
  }, [conversation, run, fold, aboveRef, rootRef]);
  return { fold, foldNow, settling };
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
 * How a settled run's work folds into its line: a whole scroll's height that
 * nobody asked to move, so longer than a toggle's and on the drawer's gentler
 * start — the strong ease-out threw a fifth of it in the first frame.
 */
const SETTLE_FOLD_MS = 360;

/**
 * Folds the work over a run's line shut: from its height, less `shift` — how
 * much higher the line stands without its hairline and room, which the fold
 * starts by keeping — to nothing, its newest lines the last to go, fading as
 * it closes; `done` once it is shut.
 *
 * In a conversation that follows its end, the line keeps its place. The list
 * moves its rows a frame after a row changes height, so the line rode up by
 * each frame's step and back down by the last one's (±45 px on a real run,
 * 2026-09-29). Each step is taken once the list has moved the rows for the
 * last one, and the card's row is carried as far as this step takes, for the
 * frame until the list moves it; whatever else moves the list — the answer
 * arriving as the run settles — is the list's to do.
 */
function foldAway(above: HTMLElement, shift: number, done: () => void): () => void {
  const from = above.getBoundingClientRect().height + shift;
  if (from < 1) {
    done();
    return () => undefined;
  }
  const row = rowFollowingTheEnd(above);
  return stepHeight({
    element: above,
    from,
    to: 0,
    duration: SETTLE_FOLD_MS,
    ease: drawerEase,
    // The settle's own rows (the answer done, the result) land in the list
    // first: it lays those out at once, and would this fold's first steps too.
    wait: row === null ? 0 : LIST_LAYS_OUT_FRAMES,
    carried: row === null ? null : [{ row, direction: 1 }],
    each: (shut) => {
      above.style.opacity = String(Math.max(0, 1 - shut / 0.6));
    },
    done,
  });
}

/**
 * The card row a fold takes from, in a conversation that follows its end
 * (`data-timeline-follows-end`); else null. Read from the timeline, not the
 * scroll: the answer arriving as the run settles puts the scroll off its end
 * until the list catches up.
 */
function rowFollowingTheEnd(above: HTMLElement): HTMLElement | null {
  const row = above.closest<HTMLElement>("[data-card-slice]");
  return row?.closest("[data-timeline-follows-end]") ? row : null;
}

/** "Show work" on a folded run's line, "Hide work" once it is open: its chevron turns over. */
function WorkToggle({ open, onToggle }: { readonly open: boolean; readonly onToggle: () => void }) {
  return (
    <button aria-expanded={open} className="run-now-fold" onClick={onToggle} type="button">
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
}: {
  readonly label: string;
  readonly lines: ReadonlyArray<ChatLine>;
  /** Told whether the person reads the work: scrolled up in it, or something in it opened. */
  readonly readingRef?: { current: boolean };
  /** Given how to keep it at its foot while it follows, read first (`keep`). */
  readonly keepRef?: { current: (() => void) | null };
  /** The lines landing from the live slot this draw: they plop into place, never rise in. */
  readonly landing?: ReadonlyMap<string, number> | null;
}) {
  // Drawn once: from here on, what arrives arrives while the person watches.
  const shownRef = useRef(false);
  useEffect(() => {
    shownRef.current = true;
  }, []);
  // Where the chat starts: its newest lines when it opens. What arrives after
  // only ever joins at the end, so the window grows and never slides.
  const [from, setFrom] = useState(() => chatOpensAt(lines.length));
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  // It follows its foot until the person moves it up or opens something in
  // it, and again once they move it down onto its foot or close what they
  // opened; where its top last stood tells their move from the page's. It
  // opens at its foot.
  const followRef = useRef<RunScrollFollow>({
    follows: true,
    stood: Number.POSITIVE_INFINITY,
    opened: NOTHING_OPENED,
    resumes: false,
    reach: null,
    foot: null,
  });
  const follow = useMemo(() => {
    const heard = (event: RunScrollEvent) => {
      followRef.current = followAfter(followRef.current, event);
      const { follows } = followRef.current;
      // Said on it, as its cut edges are, for what looks at the page.
      scrollRef.current?.toggleAttribute("data-follows", follows);
      if (event.kind !== "set" && readingRef !== undefined) readingRef.current = !follows;
    };
    /** The page puts its top at `top`, and remembers where the browser took it. */
    const putAt = (element: HTMLElement, top: number) => {
      element.scrollTop = top;
      heard({ kind: "set", top: element.scrollTop });
    };
    /**
     * Read where it stands — a move up not heard yet (a scroll event comes a
     * frame late) is the person's — and, while it follows, put it at its foot.
     */
    const keep = () => {
      const element = scrollRef.current;
      if (element === null) return;
      const position = positionOf(element);
      heard({ kind: "scrolled", position });
      if (followRef.current.follows) putAt(element, footTop(position));
      markEdges(element);
    };
    return {
      heard,
      putAt,
      keep,
      hold: (key: string, opens: boolean) => {
        const element = scrollRef.current;
        // A move of theirs not heard yet is theirs, before the press counts.
        if (element !== null) heard({ kind: "scrolled", position: positionOf(element) });
        heard({ kind: opens ? "opened" : "closed", key });
        if (opens) return;
        // Once the press has kept itself in place (`collapseInPlace`), that
        // keeping is the page's move, never read as their move up: closing
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
  }, [readingRef]);
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
    keepFromFootRef.current = position.scrollHeight - position.scrollTop;
    setFrom(earlierShown(from).next);
  };
  // It opens at its foot, before the first paint.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element === null) return;
    follow.putAt(element, footTop(positionOf(element)));
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
    if (from > 0 && element.scrollHeight <= element.clientHeight) setFrom(earlierShown(from).next);
    markEdges(element);
  }, [from, follow]);
  // A line arriving, a bubble growing as its words stream, a call opening,
  // the live slot under it growing into its room: a scroll that follows its
  // foot stays at it, moved before the frame paints, so no arrival is ever
  // drawn cut first.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    const list = listRef.current;
    if (element === null || list === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(follow.keep);
    observer.observe(list);
    observer.observe(element);
    return () => observer.disconnect();
  }, [follow]);
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
            const position = positionOf(event.currentTarget);
            const followed = followRef.current.follows;
            follow.heard({ kind: "scrolled", position });
            const element = scrollRef.current;
            if (element !== null) {
              // Brought back to the foot it set out for, it catches up to
              // where the foot moved on since.
              if (!followed && followRef.current.follows) follow.putAt(element, footTop(position));
              markEdges(element);
            }
            drawEarlier(position);
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
  for (const animation of element.getAnimations()) {
    const effect = animation.effect;
    if (
      effect instanceof KeyframeEffect &&
      effect.getKeyframes().some((frame) => "translate" in frame)
    ) {
      animation.cancel();
    }
  }
}

/**
 * An element gliding to its place from where it showed (`stood`, its top on
 * screen) on the plop's curve; how far it glides. One in flight is taken over
 * from where it shows.
 */
function glideFrom(element: HTMLElement, stood: number): number {
  stopGliding(element);
  return glideBy(element, stood - element.getBoundingClientRect().top);
}

/** An element gliding from `moved` px off its place to it, on the plop's curve. */
function glideBy(element: HTMLElement, moved: number): number {
  if (Math.abs(moved) < 0.5) return 0;
  element.animate([{ translate: `0 ${moved}px` }, { translate: "0 0" }], {
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

/** The plop (pass 35, the board's "Plop"): a translate on the strong ease-out, then a 1.5 px settle. */
const PLOP_MS = 340;
const PLOP_SETTLE_PX = 1.5;
/** The settle starts this far into the plop, and swings once past the place and back. */
const PLOP_SETTLE_FROM = 0.42;
/** How many frames the plop is drawn in: WAAPI eases linearly between them. */
const PLOP_FRAMES = 24;

/** The strong ease-out, `cubic-bezier(0.23, 1, 0.32, 1)`, at progress `t`. */
function strongEaseOut(t: number): number {
  const [x1, y1, x2, y2] = [0.23, 1, 0.32, 1];
  const at = (a: number, b: number, u: number) =>
    3 * a * u * (1 - u) * (1 - u) + 3 * b * u * u * (1 - u) + u * u * u;
  let low = 0;
  let high = 1;
  for (let step = 0; step < 24; step += 1) {
    const middle = (low + high) / 2;
    if (at(x1, x2, middle) < t) low = middle;
    else high = middle;
  }
  return at(y1, y2, (low + high) / 2);
}

/**
 * A row that left the live slot lands where the history drew it: it starts
 * where it stood (`from`, its top on screen) and travels to its place on the
 * strong ease-out, settling 1.5 px past it and back; its kind's mark fades in
 * where the slot's face stood. Under reduced motion it fades in, in place.
 */
function plop(row: HTMLElement, from: number) {
  const mark = row.querySelector<HTMLElement>("[data-run-mark] > span");
  if (prefersReducedMotion() || !Number.isFinite(from)) {
    row.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 200,
      easing: "ease",
      fill: "backwards",
    }).currentTime = 0;
    return;
  }
  stopGliding(row);
  const travel = from - row.getBoundingClientRect().top;
  if (Math.abs(travel) < 0.5) {
    mark?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: "ease" });
    return;
  }
  // Past its place on the side it travels towards, and back.
  const past = travel > 0 ? -PLOP_SETTLE_PX : PLOP_SETTLE_PX;
  const frames = Array.from({ length: PLOP_FRAMES + 1 }, (_, frame) => {
    const progress = frame / PLOP_FRAMES;
    const settle =
      progress > PLOP_SETTLE_FROM
        ? Math.sin((Math.PI * (progress - PLOP_SETTLE_FROM)) / (1 - PLOP_SETTLE_FROM))
        : 0;
    return { translate: `0 ${travel * (1 - strongEaseOut(progress)) + past * settle}px` };
  });
  // In effect from this frame: a new animation waits a frame for its start
  // time, and the row would stand a frame at its place before travelling.
  row.animate(frames, { duration: PLOP_MS, easing: "linear" }).currentTime = 0;
  const fade = mark?.animate([{ opacity: 0 }, { opacity: 1 }], {
    duration: 240,
    delay: 60,
    easing: "ease",
    fill: "backwards",
  });
  if (fade !== undefined) fade.currentTime = 0;
}

/**
 * Marks the edges the scroll has more past — a fade there says so — straight
 * on the element: a scroll never redraws the chat.
 */
function markEdges(element: HTMLElement): void {
  const cut = cutEdges(positionOf(element));
  element.toggleAttribute("data-more-above", cut.above);
  element.toggleAttribute("data-more-below", cut.below);
}

/**
 * Where the run's scroll stands, its foot where its lines end as laid out: a
 * row travelling into its place paints past it (`laidOutPosition`).
 */
function positionOf(scroll: HTMLElement): RunScrollPosition {
  const list = scroll.firstElementChild as HTMLElement | null | undefined;
  // Drawn outside a page (a test's renderer), it is as it says.
  if (list === null || list === undefined || typeof getComputedStyle !== "function") return scroll;
  const style = getComputedStyle(scroll);
  const pad =
    (Number.parseFloat(style.paddingTop) || 0) + (Number.parseFloat(style.paddingBottom) || 0);
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
          failed ? "text-status-failed-text" : "text-foreground/85",
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
                  </span>
                </span>
              )}
              {item.report === null ? null : <OutputBlock mono={item.mono} text={item.report} />}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
