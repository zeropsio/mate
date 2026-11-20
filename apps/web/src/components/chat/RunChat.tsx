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
 * once a later step undid it, or once its run ended well — never a pink row
 * (K9); what merely happened (a context condensed, a change landed) a caption
 * between hairlines.
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
import type { TimestampFormat } from "@t3tools/contracts/settings";
import { releaseEndedWords } from "@t3tools/client-runtime/zerops";
import {
  AsteriskIcon,
  CheckIcon,
  ChevronDownIcon,
  OctagonAlertIcon,
  TriangleAlertIcon,
} from "lucide-react";
import {
  memo,
  use,
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from "react";

import { afterLayout } from "~/lib/afterLayout";
import { prefersReducedMotion } from "~/lib/reducedMotion";
import { cn } from "~/lib/utils";
import { Bubble, META, rises } from "./RunBubble";
import { MARK_COLUMN, MARK_GAP, type MarkLine, Mark, HelperFace } from "./RunMarks";
import { NowLine } from "./RunNowLine";
import { AnswerFiles, PersonMark } from "./RunPersonMark";
import { TypingDots } from "./RunTypingDots";
import { DisclosureButton, Headline, OutputBlock, useDisclosure } from "./RunDisclosure";
import { CallGroup } from "./RunCallRow";
import { NoteBubble, QuestionBubble, ThoughtBubble } from "./RunWordsBubbles";
import { QuickCallsBubble, StepBubble } from "./RunCallBubbles";
import {
  StandupBubble,
  OperationBubble,
  ChecksBubble,
  IncidentMark,
  IncidentBubble,
} from "./RunOperationBubbles";
import { HelpersBubble, TaskBubble, PlanBubble } from "./RunHelperBubbles";
import { easeFeedHeight, type FeedRoom, roomOf, shutFeed } from "./runFeedFold";
import {
  bubbleHeights,
  heightOf,
  lineTops,
  placeSlot,
  rowByKey,
  rowInView,
  rowTops,
  selectionTouches,
  topAmongLines,
} from "./runSlotGeometry";
import {
  type HolderRows,
  glideBy,
  glideLines,
  glideShifted,
  historyRows,
  retopped,
  stopGliding,
  visibleTravel,
} from "./runGlide";
import { type WorkLogEntry } from "../../session-logic";
import { CrewSeamActivity } from "../zerops/crew/CrewTaskCard";
import { MateFace } from "../zerops/primitives";
import { foldQuickCalls, quickCallsAtEnd } from "./quickCalls.logic";
import { AsPainted } from "./AsPainted";
import { Spinner } from "../ui/spinner";
import { useCalmLine } from "./useCalmLine";
import {
  headStood,
  headStoodJustNow,
  watchPainted,
  wordsCutUnder,
  wordsStoodUnder,
} from "./wordsLanding";
import {
  SLOT_MAX_ROWS,
  slotBurst,
  slotHoldsIn,
  slotRunningPast,
  type LiveSlot as LiveSlotState,
} from "./liveSlot.logic";
import { useLiveSlot } from "./useLiveSlot";
import { useRunFold } from "./useRunFold";
import { foldWork } from "./foldWork";
import { usePace } from "./usePace";
import { KeptTimelineContext } from "./keptTimelineContext";
import { landingHosts, slotMoves } from "./slotMoves.logic";
import { resultPictures as allResultPictures, stripShowsFiles } from "./runResult.logic";
import { useStripFiles } from "./resultStripFiles";
import {
  backgroundItemWord,
  backgroundLineOf,
  backgroundRowItems,
  reportsInline,
  type BackgroundLineModel,
} from "./backgroundLine.logic";
import { pageReached, type ScrollPages } from "./engineCardPaging.logic";
import { useEngineCardPages } from "./useEngineCardPaging";
import { glideStep, glidesTo, keepsFoot, movesAsPerson } from "./runMotion.logic";
import { easeRooms, forgetScrollTop, noteScrollTop, type Rooms, unclamp } from "./runRoom";
import { createTravels } from "./runTravel";
import { followScrollTo } from "~/lib/followScroll";
import { slotOpenDeployLine } from "./operationBar.logic";
import {
  sameRecordItem,
  type ConversationEvent,
  type RecordItem,
  type RunStatus,
  type TurnHeaderActivity,
} from "./MessagesTimeline.logic";
import {
  chatOpensAt,
  cutEdges,
  followAfter,
  NOTHING_OPENED,
  footTop,
  movedByClamp,
  laidOutPosition,
  type RunScrollEvent,
  type RunScrollFollow,
  recoveredFailures,
  runEndedWell,
  nowLineOf,
  nowLineWords,
  waitedWords,
  slotWords,
  reachesEarlier,
  stretchesAside,
  windowAside,
  windowEarlier,
  windowOver,
  logWindow,
  roomAside,
  KEPT_ABOVE_PX,
  SET_ASIDE_PAST_PX,
  type AsideStretch,
  type LogWindow,
  runCardShows,
  chooseLiveRunFold,
  setRunFold,
  type SlotFiller,
  type RunScrollPosition,
  standsAtFoot,
} from "./runCard.logic";
import { useRunScrollResettle } from "./useRunScrollResettle";
import { useEngineLiveNow } from "./useEngineLiveMessage";
import { TimelineRowActivityCtx, TimelineRowCtx } from "./timelineContext";
import { stepOf, type WorkStep } from "~/zerops/runSteps/steps";
import {
  type Carried,
  CarriedOpenContext,
  ChatLineContext,
  ChatShownContext,
  DrawnEarlierContext,
  InSlotContext,
  NO_PATHS,
  PlopsContext,
  ResultPicturesContext,
  RidesContext,
  RunScrollHoldContext,
  SlotStandsOpenContext,
  useHoldReading,
  useRisesIn,
} from "./runCardContext";
import {
  type ChatEntry,
  type ChatLine,
  EASED_BOXES,
  gatherCalls,
  type RecordRow,
  type RunMotion,
} from "./runChatLine";

// ---------------------------------------------------------------------------
// What stopped it, and what merely happened
// ---------------------------------------------------------------------------

/**
 * An engine notice keeps its severity, with its real reason available below its words.
 */
function NoticeBubble({
  entry,
  kind,
}: {
  readonly entry: WorkLogEntry;
  readonly kind: "error" | "warning";
}) {
  const disclosure = useDisclosure();
  const { label, detail } = entry;
  const more = detail !== undefined && detail.trim() !== label.trim() ? detail.trim() : null;
  const line = (
    <Headline opens={more !== null}>
      <span className={kind === "warning" ? "text-warning-foreground" : "text-status-failed-text"}>
        {label}
      </span>
    </Headline>
  );
  return (
    <Bubble kind={kind} tone="tool">
      {more === null ? (
        <div>{line}</div>
      ) : (
        <DisclosureButton
          label={`${label}. ${disclosure.open ? "Hide" : "Show"} the whole ${kind}`}
          onToggle={disclosure.toggle}
          open={disclosure.open}
        >
          {line}
        </DisclosureButton>
      )}
      {disclosure.open && more !== null ? (
        <div
          className={cn("pt-2", rises(disclosure.made))}
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
function recordEventWords(
  event: ConversationEvent,
  speaker: string,
  timestampFormat: TimestampFormat = "locale",
): { readonly words: string; readonly detail: string | null } {
  switch (event.type) {
    // Where its card waited for the usage limit and went on (B5): "· 12:31 – 1:05 PM".
    case "waited": {
      const [words, detail] = waitedWords(event.from, event.to, timestampFormat).split(" · ");
      return { words: words!, detail: detail ?? null };
    }
    case "landed":
      return {
        words: `${event.event.repository} #${event.event.number} landed`,
        detail: event.event.title,
      };
    case "release":
      return { words: releaseEndedWords(event.event), detail: null };
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
        words: `${what} ${(event.lost ?? 0) > 0 ? "didn't report back" : event.failed > 0 ? "failed" : "finished"}`,
        detail: `${speaker} went on`,
      };
    }
  }
}

/** What merely happened: no one's bubble — a caption between hairlines, across the chat. */
function EventCaption({ event }: { readonly event: ConversationEvent }) {
  const ctx = use(TimelineRowCtx);
  const { words, detail } = recordEventWords(event, ctx.speaker.name, ctx.timestampFormat);
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

/** A thought's mark: a small asterisk, fainter than a call's. */
const THOUGHT_MARK = (
  <AsteriskIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground/70" />
);

/**
 * A thought's mark where it stands: its asterisk in the log; in the working
 * row the Mate's own face at work, as every item there wears while it is
 * what the Mate does now (the board, 2026-11-10).
 */
function ThoughtMark() {
  const ctx = use(TimelineRowCtx);
  if (!use(InSlotContext)) return THOUGHT_MARK;
  if (ctx.speaker.helper) return <HelperFace />;
  return <MateFace shape={ctx.speaker.shape} size={20} state="working" tint={ctx.speaker.tint} />;
}

/** Its words' mark: its own face, at rest — who is speaking, beside what it said. */
function SpeakerMark() {
  const ctx = use(TimelineRowCtx);
  if (ctx.speaker.helper) return <HelperFace />;
  return <MateFace shape={ctx.speaker.shape} size={20} state="idle" tint={ctx.speaker.tint} />;
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
 * A record's item as its line of the chat; `undone` the failures that stand
 * quiet (`recoveredFailures`): a later step undid them, or their run ended well.
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
        mark: <ThoughtMark />,
        markLine: "thought",
      };
    case "note":
      return {
        key: item.key,
        bubble: <NoteBubble message={item.message} />,
        mark: <SpeakerMark />,
        said: true,
      };
    case "question":
      return {
        key: item.key,
        bubble: <QuestionBubble questions={item.questions} />,
        mark: <SpeakerMark />,
        asks: true,
        said: true,
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
      return {
        key: item.key,
        bubble: <TaskBubble entry={item.entry} undone={undone.has(item.key)} />,
        call: true,
      };
    case "plan":
      return { key: item.key, bubble: <PlanBubble plan={item.plan} />, call: true };
    case "strip":
      return { key: item.key, bubble: <ChecksBubble strip={item.strip} />, call: true };
    case "incident":
      return {
        key: item.key,
        bubble: <IncidentBubble incident={item.incident} />,
        mark: <IncidentMark incident={item.incident} />,
        markLine: "call",
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
    case "warning":
      return {
        key: item.key,
        bubble: <NoticeBubble entry={item.entry} kind={item.kind} />,
        markLine: "call",
        mark:
          item.kind === "warning" ? (
            <TriangleAlertIcon
              aria-hidden="true"
              className="size-4 shrink-0 text-warning-foreground"
            />
          ) : (
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
  said = false,
  mark,
  markLine,
  children,
}: {
  /** The line it draws: what its plop finds it by. */
  readonly lineKey: string;
  readonly across: boolean;
  readonly theirs: boolean;
  /** It answers the question right above it: 6 px under it, not 16. */
  readonly pairs?: boolean;
  /** The Mate's words: 22 px over and under them, where rows stand 16 px apart. */
  readonly said?: boolean;
  readonly mark?: ReactNode;
  readonly markLine?: MarkLine | undefined;
  readonly children: ReactNode;
}) {
  const rises = useRisesIn();
  // In the working row an item stands alone: the panel's own padding is its room.
  const roomy = said && !use(InSlotContext);
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
      className={cn("flex min-w-0 items-start", MARK_GAP, pairs ? "-mt-4" : roomy && "my-1.5")}
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

/**
 * The line of a run with no chat to end on — one that only asked for a plan's
 * approval, or paused before it did anything: the now line alone.
 */
export function RunLine({ status }: { readonly status: RunStatus }) {
  return <NowLine answering={false} now={null} outcome={null} status={status} />;
}

const NO_KEYS: ReadonlyArray<string> = [];
const NO_STRETCHES: ReadonlyArray<AsideStretch> = [];
const NO_TOPS: ReadonlyMap<string, number> = new Map();
const NO_HOLDS: ReadonlySet<string> = new Set();

/** Lines landing from the live slot: where each stood, and where the history's lines stood. */
interface Landing {
  /** Each line leaving the slot by its key, by where its row stood (NaN: it rode along unseen). */
  readonly from: ReadonlyMap<string, number>;
  /** The lines leaving that stood in the slot: they join the history at once (`usePace`). */
  readonly hosts: ReadonlySet<string>;
  /** Where the slot stood on screen. */
  readonly slot: number | null;
  /**
   * How far under the history's top its view ended, at the slot's top: a slot
   * that grew took room a line stood in.
   */
  readonly viewEnd: number | null;
  /** How tall the card's row stood: a list that follows its end moves it a frame late. */
  readonly card: number | null;
  /**
   * The history's lines by their key, by how far under the history's top each
   * stood: read against its own box, so the conversation scrolling the card
   * since — it follows a card that grows — is never a move of theirs (a card
   * of calls came down 35 px and went back up 70).
   */
  readonly rows: ReadonlyMap<string, number>;
  /**
   * Where the history's scroll stood as those were read. What it moved between
   * that read and the landing's draw the person saw happen — their own wheel
   * over a log that runs on — so it is no move of the landing's: read a few
   * frames before a landing, lines wheeled past since went back four rows and
   * glided down again (2026-11-10).
   */
  readonly scrollTop: number | null;
  /**
   * The slot's rows, by where each stood in it (from the slot's top): one that
   * stays keeps its place in the slot as a row above it leaves.
   */
  readonly staying: ReadonlyMap<string, number>;
  /** How tall each leaving line's bubble stood in the slot: it grows from there in the history. */
  readonly bubbles: ReadonlyMap<string, number>;
}

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
 * What the slot says when no item stands in it: "Thinking", muted, from its
 * first frame — a word fading in late left the Mate's face alone on the line
 * for half a second (run 5, E +0:23.6); a quick gap between two steps is
 * bridged by the step standing its minimum — its words on their way, a wait
 * on the person, the context condensing. It stands as the row that takes its
 * place does: its mark in the Mate's column, its words on the items' text
 * edge, so what comes next replaces it where it stands (2026-11-10: a bare
 * word 12 px left of every item, no mark beside it).
 */
function SlotFillerWords({ filler }: { readonly filler: SlotFiller }) {
  switch (filler.kind) {
    case "thinking":
      return <span className="run-slot-word">Thinking</span>;
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
    case "away":
      return <span className="run-slot-word">{filler.words}</span>;
    case "paused":
      return <span className="run-slot-word">{slotWords(null, filler)}</span>;
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
 * The working row, the card's foot while the run goes on (pass 35; the board,
 * 2026-11-10): the one panel inside the card, holding what the Mate is doing
 * this moment with its body — its face at work, its words in ink, a
 * command's code, a spinner while a call runs — and nothing to open: it
 * shows the thing up to its cap, and lands in the log as its row. Several at
 * once are a row each, three at most, then "+N more running". In a burst it
 * is one compact line of one height. Nothing standing in it, it says what
 * the Mate does between things: "Thinking", "Writing", a wait.
 */
const NO_ITEMS: ReadonlyMap<string, RecordItem> = new Map();

/** A wait the card's head says, never the slot. */
function headSays(filler: SlotFiller): boolean {
  return (
    filler.kind === "waiting" ||
    filler.kind === "after" ||
    filler.kind === "starting" ||
    filler.kind === "paused"
  );
}

/** What the empty slot says, as a key: the same words are no change. */
function fillerKey(filler: SlotFiller): string {
  return filler.kind === "waiting" ? `${filler.kind}:${filler.on}` : filler.kind;
}

function LiveSlot({
  ref,
  folded,
  burst,
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
  /** The burst it is in (`slotBurst`): which of how many passes through it. */
  readonly burst: { readonly at: number; readonly of: number } | null;
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
  const { isCompacting, isStopping } = use(TimelineRowActivityCtx);
  // What the face and a screen reader say stands its dwell, as the slot's
  // items do: a call of 180 ms between two thoughts never flips them.
  const doing = nowLineOf({
    status,
    now,
    answering,
    compacting: isCompacting,
    speaker: ctx.speaker.name,
    effort: null,
    stopping: isStopping === true,
  });
  const latest = useCalmLine(doing, nowLineWords(doing), !status.live);
  // "Thinking", "Writing": what the empty slot says stands its dwell too. A wait is the head's to
  // say, at once: the slot leaves with the turn's last words, never saying "Writing" a second more.
  const said = useCalmLine(filler, fillerKey(filler), !status.live || headSays(filler));
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
  const firstDrawn = lines.length === 0 ? undefined : drawn[0];
  // A wait with nothing standing in the slot is the card's head's to say: never twice.
  const saysHead = lines.length === 0 && headSays(said);
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
    const motion = motionRef.current;
    const rooms = easeRooms({
      root: slotBox,
      selector: EASED_BOXES,
      eases: () => shownRef.current && !syncingRef.current,
      rootClips: true,
      // The working row grows as it shrinks: a thought gaining lines, a
      // command's body arriving, the next thing taller than the last.
      grows: () => true,
      travels: motion.travels,
      afterStep: () => motion.keep?.(),
    });
    slotRoomsRef.current = rooms;
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
  // Folded, the card is its head alone: the working row is the hidden work's
  // too, and the head says what it shows under its line (`underHeadWords`).
  // What waits on the person stays in sight: a question it asked, their
  // answer under it.
  const asksPerson = drawn.some(({ item }) => item.kind === "question" || item.kind === "person");
  const shut = (folded && !asksPerson) || saysHead;
  return (
    <div
      ref={ref}
      className="run-slot"
      hidden={shut}
      style={shut ? { display: "none" } : undefined}
      data-run-now={lines.length === 0 ? said.kind : "items"}
      data-run-status={latest.kind === "waiting" ? "waiting" : "working"}
      data-slot-compact={burst === null ? undefined : ""}
      data-work-line={status.face}
    >
      <InSlotContext value>
        <SlotStandsOpenContext value={standsOpen}>
          <ChatShownContext value={shownRef}>
            <ol ref={listRef} className="run-slot-list">
              {burst !== null ? (
                // A burst: one line of one height, whatever passes through it — what it is,
                // and which of how many (the board, 2026-11-10).
                <li key="compact" className="run-slot-compact">
                  <Mark line="call">
                    {ctx.speaker.helper ? (
                      <HelperFace />
                    ) : (
                      <MateFace
                        shape={ctx.speaker.shape}
                        size={20}
                        state="working"
                        tint={ctx.speaker.tint}
                      />
                    )}
                  </Mark>
                  <span className="run-slot-compact-words">
                    {slotWords(firstDrawn?.item ?? null, said)}
                  </span>
                  <span className="run-slot-compact-count">{`${burst.at} of ${burst.of}`}</span>
                  <span className="run-slot-compact-mark">
                    {burst.at === burst.of && firstDrawn?.entry.endedAt != null ? (
                      <CheckIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />
                    ) : (
                      <Spinner aria-hidden="true" role="presentation" size="xs" tone="muted" />
                    )}
                  </span>
                </li>
              ) : lines.length === 0 ? (
                <li
                  key={`filler:${said.kind}`}
                  className="run-slot-filler"
                  data-slot-filler={said.kind}
                >
                  {/* "Thinking" wears the thought's mark: the thought that follows
                      keeps it where it is. The card's head has the one face. */}
                  <Mark line={said.kind === "thinking" ? "thought" : "call"}>
                    {said.kind === "thinking" ? THOUGHT_MARK : null}
                  </Mark>
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
                      said={entry.said === true}
                      theirs={entry.theirs === true}
                    >
                      {entry.bubble}
                    </ChatRow>
                  ),
                )
              )}
              {more > 0 && burst === null ? (
                <li className="run-slot-more">{`+${more} more running`}</li>
              ) : null}
            </ol>
          </ChatShownContext>
        </SlotStandsOpenContext>
      </InSlotContext>
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
  // Its log's lines as last built: one that draws the same is the same line (`chatLines`).
  const [lineCache] = useState<LineCache>(() => new Map());
  const ctx = use(TimelineRowCtx);
  // An engine run too long to read whole: its effort from its summary, its lines a page at a time.
  const paging = row.paging;
  const pages = useEngineCardPages(paging);
  const outcome = row.outcome;
  const hold = useHoldReading();
  const rootRef = useRef<HTMLDivElement>(null);
  const aboveRef = useRef<HTMLDivElement>(null);
  // How tall the card stood in its last draw while live: its settle's fold starts there.
  const liveHeightRef = useRef<number | null>(null);
  // Whether the person reads the work this moment — scrolled up in it, or
  // something in it opened: a run settling then stays open.
  const readingRef = useRef(false);
  // How the history's scroll keeps to its foot, for a line landing in it.
  const keepScrollRef = useRef<((lands?: boolean) => void) | null>(null);
  // How its boxes ease (`easeRooms`), for a line landing in it.
  const historyRoomsRef = useRef<Rooms | null>(null);
  // What its parts' motions share (`RunMotion`).
  const [travels] = useState(createTravels);
  const motionRef = useRef<RunMotion>({ slot: null, travels, keep: null });
  // What in it involves the person: a question it asked, their words in it.
  const personKeys = useMemo(
    () =>
      row.items.flatMap((item) =>
        item.kind === "question" || item.kind === "person" ? [item.key] : [],
      ),
    [row.items],
  );
  const cardRoomsRef = useRef<Rooms | null>(null);
  const { fold, foldNow, settling, motionAllowed, foldShutsRef } = useRunFold({
    conversation: ctx.routeThreadKey,
    run: row.turnKey,
    live: row.live,
    asks: row.now?.kind === "waiting",
    personKeys,
    readingRef,
    rootRef,
    aboveRef,
    liveHeightRef,
    roomsRef: cardRoomsRef,
    onFoldWork: ctx.onFoldWork ?? foldWork,
  });
  // The card's own height eases (`easeRooms`) as its parts come and go — the
  // history's scroll arriving with its first line — for a run watched live
  // here; what changes inside the history and the slot is theirs to ease. Its
  // turn over, the slot leaves at once: the answer lands under the card in the
  // frame its words leave it (engine-final, seg E: they stood in both for 1.1 s,
  // then the card eased shut and the page moved).
  const watchedRef = useRef(false);
  const cardEasesRef = useRef(false);
  const turnOver = !row.live || row.status?.waitingOnHelpers === true;
  // Unless nothing in the slot becomes the answer — it came with the run's end, the slot said
  // Thinking — then the card eases shut as anything else in it: the strip under it travels,
  // never a 124 px cut (recheck on 0.15.45, +4:14.0).
  const swapsRef = useRef(false);
  const endedRef = useRef(turnOver);
  useLayoutEffect(() => {
    if (row.live && !ctx.syncing) watchedRef.current = true;
    if (turnOver && !endedRef.current) {
      const root = rootRef.current;
      // Drawn outside a page (a test's renderer), it has no head to find.
      const head =
        typeof root?.querySelector === "function"
          ? root.querySelector<HTMLElement>(":scope > [data-run-head]")
          : null;
      swapsRef.current = head !== null && wordsStoodUnder(head);
    }
    endedRef.current = turnOver;
    cardEasesRef.current =
      watchedRef.current &&
      !ctx.syncing &&
      (!turnOver || !swapsRef.current) &&
      !foldShutsRef.current;
  });
  // Its turn ends under the person's eyes: the list holds its head where it stood as last painted,
  // from this commit — before anything under it moves (`onTurnLands`) — whatever its slot said
  // last (recheck on 0.15.41: a slot saying Thinking as the answer came with the end held
  // nothing, and the head travelled 120 px). Only words the slot's cap cut keep their last line
  // instead (`onAnswerLands`).
  const turnOverRef = useRef(turnOver);
  // How tall the card stood as last painted while its turn went on.
  const paintedHeightRef = useRef<number | null>(null);
  // Where its history's scroll stood as last painted, while the run goes on: a landing's lines
  // glide from where they stood then (`Landing.scrollTop`).
  const paintedScrollRef = useRef<number | null>(null);
  // Read as painted before each commit that draws the card or its conversation again
  // (`AsPainted`): never in every frame, which ran the page's main thread sixty times a second
  // for as long as a run went on.
  const live = row.live;
  useEffect(() => {
    const root = rootRef.current;
    // Drawn outside a page (a test's renderer), it has no head to find.
    if (!live || root === null || typeof root.querySelector !== "function") return;
    return watchPainted(root, () => {
      paintedScrollRef.current = scrollIn(aboveRef.current)?.scrollTop ?? null;
      // Its turn over while what it started runs on, the card stands at the height it showed then.
      if (turnOver) return;
      const head = root.querySelector<HTMLElement>(":scope > [data-run-head]");
      if (head !== null) headStood(head, head.getBoundingClientRect().top);
      paintedHeightRef.current = heightOf(root);
    });
  }, [live, turnOver]);
  // Its turn over while what it started runs on, the card stands at the height it showed without
  // its slot: its history never grows into the room the slot gave back, which pushed the answer
  // landing under it a slot's height down (recheck on 0.15.44, +15:38: 305 px).
  const [waitCap, setWaitCap] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!turnOver || !row.live) {
      if (waitCap !== null) setWaitCap(null);
      return;
    }
    if (waitCap === null && liveHeightRef.current !== null) setWaitCap(liveHeightRef.current);
  }, [turnOver, row.live, waitCap]);
  // Capped with nothing of its slot becoming the answer, the card travels to its new height from
  // the one it was last painted at (recheck on 0.15.45: the strip under it moved 124 px in a frame).
  useLayoutEffect(() => {
    const root = rootRef.current;
    const from = paintedHeightRef.current;
    if (waitCap === null || swapsRef.current || root === null || from === null) return;
    if (!motionAllowedNow() || typeof root.animate !== "function") return;
    const to = heightOf(root);
    if (to === null || from - to < 2) return;
    root.animate(
      [
        { height: `${from}px`, maxHeight: `${from}px`, overflow: "hidden" },
        { height: `${to}px`, maxHeight: `${to}px`, overflow: "hidden" },
      ],
      { duration: CARD_SHUT_MS, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
    );
  }, [waitCap]);
  const { onTurnLands } = ctx;
  useLayoutEffect(() => {
    const was = turnOverRef.current;
    turnOverRef.current = turnOver;
    if (was || !turnOver || onTurnLands === undefined || !watchedRef.current || ctx.syncing) return;
    const head = rootRef.current?.querySelector<HTMLElement>(":scope > [data-run-head]") ?? null;
    const stood = head === null ? null : headStoodJustNow(head);
    if (head === null || stood === null) return;
    if (!wordsCutUnder(head)) onTurnLands(head, stood, !swapsRef.current);
  }, [turnOver, onTurnLands, ctx.syncing]);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    const motion = motionRef.current;
    const rooms = easeRooms({
      root,
      selector: ":not(*)",
      eases: () => cardEasesRef.current,
      rootClips: true,
      attributes: ["data-run-live"],
      // Its history arriving with its first line: the card's bottom edge
      // travels to uncover what stands under it, laid out where it will stand.
      grows: () => true,
      travels: motion.travels,
      afterStep: () => motion.keep?.(),
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
  // The failures that stand quiet (K9) — what a later step undid, and, once the run ended well,
  // every command, call and background job of it that failed — read once per record, not once
  // per redraw. While it runs, and where it ended any other way, they stay red.
  const endedWell = runEndedWell(row.status);
  const undone = useMemo(() => recoveredFailures(row.items, endedWell), [row.items, endedWell]);
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
    turnOver: row.status?.waitingOnHelpers === true,
    // Kept out of sight, nobody watches either: what arrives is history at once, so coming back
    // shows it, never a backlog still playing one line at a time.
    syncing: ctx.syncing || outOfSight,
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
        scrollTop: slotted ? painted.scrollTop : null,
        slot: slotted ? painted.slot : null,
        viewEnd: slotted ? painted.viewEnd : null,
        card: painted.card,
        staying: slotted ? painted.slotRows : new Map(),
        bubbles: slotted ? painted.slotBubbles : new Map(),
      });
    },
  });
  /** Where the history's lines, the slot and its rows stand on screen now. */
  const paintedNow = () => {
    const slotTop = boxOf(slotRef.current)?.top ?? null;
    const scroll = scrollIn(aboveRef.current);
    const historyTop = boxOf(scroll)?.top ?? null;
    return {
      rows: historyTop === null ? NO_TOPS : lineTops(aboveRef.current, historyTop),
      scrollTop: scroll?.scrollTop ?? null,
      slot: slotTop,
      viewEnd: slotTop === null || historyTop === null ? null : slotTop - historyTop,
      slotRows: rowTops(slotRef.current, slotTop ?? 0),
      slotBubbles: bubbleHeights(slotRef.current),
      card: boxOf(cardRowOf(rootRef.current))?.height ?? null,
    };
  };
  const paintedRef = useRef<ReturnType<typeof paintedNow> | null>(null);
  // What left the slot lands, and everything it moves goes by one travel
  // (`runTravel`): the history makes its room at its foot as the slot gives
  // or takes its own, each by its height; the history's lines glide from
  // where they stood to where the landing put them, and the landed line comes
  // up with them from under the history's edge. Nothing else moves the slot:
  // it rides the history's edge, and a card that grows grows at its bottom.
  useLayoutEffect(() => {
    // Each landing once: it stays the last one heard until the next.
    if (landing === null) return;
    if (prefersReducedMotion()) return;
    const travel = motionRef.current.travels.current();
    // A history that follows its foot stands where the landed line ends, at
    // once: its lines glide there from where they stood, by the travel. A
    // move up the person made just before is read first, and stops it.
    keepScrollRef.current?.(true);
    const scroll = scrollIn(aboveRef.current);
    const list = scroll?.querySelector<HTMLElement>(":scope > ol") ?? null;
    const landed = new Set<HTMLElement>();
    for (const [key, from] of landing.from) {
      // One that rode along unseen rises in as it arrives (`useRisesIn`).
      if (!Number.isFinite(from)) continue;
      const line = rowByKey(list, key);
      if (line === null) continue;
      // A call that opened a card of its own lands with its card.
      const card = line.closest<HTMLElement>("[data-chat-calls]");
      const alone = card !== null && card.childElementCount === 1;
      landed.add(alone ? (card.closest<HTMLElement>("[data-chat-row]") ?? line) : line);
      // Its bubble grows from the height it showed in the slot (a thought
      // the slot showed four lines of, the history in full).
      const stoodHeight = landing.bubbles.get(key);
      const bubble = line.matches("[data-chat-bubble]")
        ? line
        : line.querySelector<HTMLElement>("[data-chat-bubble]");
      // One that lands shorter than it stood — a thought of five lines to its two, a
      // command's code to its one — is simply its row: easing it shut held its
      // words over an emptying box, and the log's edge went by both at once.
      if (
        stoodHeight !== undefined &&
        bubble !== null &&
        stoodHeight < bubble.getBoundingClientRect().height - 0.5
      ) {
        historyRoomsRef.current?.easeFrom(bubble, stoodHeight);
      }
    }
    if (scroll !== null && list !== null) {
      // The room the history still gives the slot as it glides: its lines go
      // by both, and the travel is timed for what they come to.
      const gives = Math.max(0, -(historyRoomsRef.current?.pending() ?? 0));
      // What its scroll moved from the read of its lines to this draw was seen as it happened.
      const painted = paintedScrollRef.current;
      const scrolled =
        landing.scrollTop === null || painted === null ? 0 : painted - landing.scrollTop;
      glideLines(scroll, list, landing.rows, scrolled, landed, landing.viewEnd, travel, gives);
    }
    const element = slotRef.current;
    if (landing.slot === null || landing.card === null || element === null) return;
    // A row that stays in the slot keeps its place in it as a row above it
    // leaves, and travels to its new one by the same travel: read from what
    // holds it — the slot, or its card of calls — so the slot's own move, the
    // history's edge or the list's, is never added to it.
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
      glideBy(
        row,
        visibleTravel(row, stood - holderStood - (row.getBoundingClientRect().top - base)),
        travel,
      );
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
  // The history arrives with its first line, where that line stood in the
  // slot: the slot takes its new place under it at once, and the card's own
  // edge uncovers it there (its flush, next) — a slot easing shut from the
  // height it showed stood past the card's edge all the way.
  const loggedRef = useRef(false);
  useLayoutEffect(() => {
    const logged = aboveRef.current !== null;
    if (logged && !loggedRef.current) motionRef.current.slot?.settle();
    loggedRef.current = logged;
  });
  // Every commit, before the list's row measures the card in its own.
  useLayoutEffect(() => cardRoomsRef.current?.flush());
  // While live, how tall the card stands without its slot, which leaves with the turn's last words
  // as the answer lands under the card: read after the room's flush, in each draw. Its history
  // folds from the height it showed, never first growing into the room the slot gave back.
  useLayoutEffect(() => {
    if (!row.live) return;
    const height = heightOf(rootRef.current);
    const slotBox = slotRef.current;
    liveHeightRef.current =
      height === null || slotBox === null || typeof getComputedStyle !== "function"
        ? height
        : height -
          slotBox.getBoundingClientRect().height -
          parseFloat(getComputedStyle(slotBox).marginTop || "0");
  });
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
  const fromHeightRef = useRef<FeedRoom | null>(null);
  // A toggle leaves the room the work stood in: once the new fold is laid
  // out, the room eases from it to its own.
  useLayoutEffect(() => {
    const from = fromHeightRef.current;
    fromHeightRef.current = null;
    const feed = feedRef.current;
    if (from === null || feed === null) return;
    easeFeedHeight(feed, from);
  });
  // "Hide work": the work eases shut still drawn, and folds once it is shut — its line says so at
  // once. Folded at the press, its rows went in one frame and an empty room eased shut.
  const [shutting, setShutting] = useState(false);
  const shutRef = useRef<Animation | null>(null);
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
  // A burst (`slotBurst`): quick calls land folded into one row. The first of
  // them is no row on its own — it waits for the second, and they enter as
  // the one row whose count then ticks, so the log moves once for the batch
  // and never once per row. What the log held as the burst began stays.
  const burst = slotted ? slotBurst(slot) : null;
  const [burstBase, setBurstBase] = useState<ReadonlySet<string> | null>(null);
  if (burst === null && burstBase !== null) setBurstBase(null);
  if (burst !== null && burstBase === null) {
    setBurstBase(new Set(entered.map(({ item }) => item.key)));
  }
  const landedQuick = burst === null ? 0 : quickCallsAtEnd(entered, stepOfSelected);
  const lone =
    burst !== null && burstBase !== null && landedQuick === 1 ? entered.at(-1) : undefined;
  // Which of how many the working row says: counted with the calls the folded
  // row already holds, so the row's count and the working row's agree.
  const passedBefore = burst === null ? 0 : Math.max(landedQuick, burst.at - 1);
  const passingOf = burst === null ? 0 : passedBefore + burst.of - (burst.at - 1);
  const passing =
    burst === null ? null : { at: Math.min(passedBefore + 1, passingOf), of: passingOf };
  const logged =
    lone !== undefined && !burstBase?.has(lone.item.key) ? entered.slice(0, -1) : entered;
  const lines = above || !folded ? chatLines(logged, undone, burst !== null, lineCache) : [];
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
        eases={!ctx.syncing}
        opensAtStart={!above}
        {...(above ? { readingRef } : {})}
        {...(pages === null ? {} : { pages })}
      />
    );
  const settledOutcome = settled ? row.outcome : null;
  const toggleWork = () => {
    hold(folded || shutting);
    // Watched to its end and still open over its line: it
    // folds into the line as a run settling does.
    if (fold === "watched") {
      foldNow();
      return;
    }
    const feed = feedRef.current;
    const room = feed === null ? null : roomOf(feed);
    // Pressed again as it shuts: it eases open again from where it stood.
    if (shutting) {
      shutRef.current?.cancel();
      shutRef.current = null;
      fromHeightRef.current = room;
      setShutting(false);
      return;
    }
    if (!folded && feed !== null && room !== null && !prefersReducedMotion()) {
      setShutting(true);
      shutRef.current = shutFeed(feed, room, () => {
        shutRef.current = null;
        setRunFold(ctx.routeThreadKey, row.turnKey, "folded");
        setShutting(false);
      });
      return;
    }
    fromHeightRef.current = room;
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
  // The card's head toggles its work: live, the history over what it does now; settled, the run
  // under its line. Its lines not read yet, it opens once their first page is held.
  const headToggle =
    shows.toggle === null
      ? null
      : row.live
        ? {
            open: !liveFolded,
            onToggle: () => {
              hold(!liveFolded);
              chooseLiveRunFold(ctx.routeThreadKey, row.turnKey, liveFolded ? "watched" : "folded");
            },
          }
        : {
            open: !folded && !shutting,
            onToggle: () => {
              if (folded && pages !== null && paging !== null && !paging.holdsLines) {
                if (openingRef.current !== null) return;
                hold(folded);
                openingRef.current = { reading: false };
                pages.read("later");
                return;
              }
              toggleWork();
            },
            ...(pages !== null && paging !== null && !paging.holdsLines
              ? { onIntent: () => pages.read("later") }
              : {}),
          };
  return (
    // One container for the card's head, its chat and what the Mate does now: the Mate's column
    // keeps one gap for them all. Its words wear its tint (`.run-speech`). Keyed, so the scroll
    // the person watched is the one that folds away.
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
              ...(waitCap === null ? {} : { maxHeight: `${waitCap}px` }),
            } as CSSProperties
          }
        >
          {/* The card's head: the same line in every state, its words changed in place as the
              run settles — it never moves, and the work folds under it. */}
          {row.status === null ? null : (
            <NowLine
              key="head"
              answering={row.answering}
              head={{
                steps: row.chatItems.length,
                toggle: headToggle,
                ...(row.opener === undefined
                  ? {}
                  : {
                      title: backgroundLineOf(backgroundRowItems(row.opener), row.opener.helpers)
                        .words,
                    }),
              }}
              now={row.live ? now : null}
              outcome={settled ? outcome : null}
              settledHere={watchedLive && motionAllowed}
              status={row.status}
            />
          )}
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
            </div>
          ) : null}
          {row.status === null || settled ? null : (
            <LiveSlot
              key="slot"
              folded={liveFolded}
              ref={slotRef}
              items={model.record}
              live={model.live}
              filler={model.filler}
              now={now}
              answering={row.answering}
              burst={passing}
              slot={slot}
              status={row.status}
              undone={undone}
              motionRef={motionRef}
            />
          )}
          <div key="below" ref={feedRef} className="run-later-feed">
            {above ? null : scroll}
          </div>
          {/* A landing is drawn in a commit of its own, its row the same: read before that one too. */}
          <AsPainted key="painted" of={row} and={landing} />
        </div>
      </ResultPicturesContext>
    </CarriedOpenContext>
  );
}

/** A line's step where the line is a call of the Mate's own: what may be a quick call. */
function stepOfSelected({ item }: RecordRow["chatItems"][number]): WorkStep | null {
  return item.kind === "step" ? item.step : null;
}

/**
 * A run's lines as they were last built, by key: what each was built from,
 * and the line. An item that draws the same keeps its line — the same object,
 * so React leaves its row alone. Every event of a run rebuilds its record's
 * items; built anew each time, every row of the log was drawn again for one
 * word streamed into the working row (at 1000 rows, a fifth of every second).
 */
type LineCache = Map<
  string,
  {
    readonly items: ReadonlyArray<RecordItem>;
    readonly undone: boolean;
    readonly pairs: boolean;
    readonly ticks: boolean;
    readonly line: ChatLine;
  }
>;

/**
 * Build bubbles only for the selected history once its work is drawn: each
 * item its line, quick calls in a row folded into one (`foldQuickCalls`).
 * `ticks`: a burst goes on, and the folded row at the log's foot counts it.
 * A line whose items draw as they did is the line `cache` holds.
 */
function chatLines(
  items: RecordRow["chatItems"],
  undone: ReadonlySet<string>,
  ticks: boolean,
  cache: LineCache,
): ChatLine[] {
  const folded = foldQuickCalls(items, stepOfSelected, ({ item }) => item.key);
  const drawn = new Set<string>();
  const lines = folded.map((entry, index) => {
    const quick = "quick" in entry;
    const key = quick ? `quick:${entry.key}` : entry.item.key;
    const made = quick ? entry.quick.map(({ item }) => item) : [entry.item];
    const fails = made.some((item) => undone.has(item.key));
    const pairs = quick ? false : entry.pairs;
    const counts = quick && ticks && index === folded.length - 1;
    drawn.add(key);
    const held = cache.get(key);
    if (
      held !== undefined &&
      held.undone === fails &&
      held.pairs === pairs &&
      held.ticks === counts &&
      held.items.length === made.length &&
      held.items.every((item, at) => sameRecordItem(item, made[at]!))
    ) {
      return held.line;
    }
    const line: ChatLine = quick
      ? {
          key: entry.key,
          bubble: (
            <QuickCallsBubble
              lines={made.map((item) => itemLine(item, undone))}
              steps={entry.quick.flatMap((selected) => stepOfSelected(selected) ?? [])}
              ticks={counts}
            />
          ),
          call: true,
        }
      : { ...itemLine(entry.item, undone), pairs };
    cache.set(key, { items: made, undone: fails, pairs, ticks: counts, line });
    return line;
  });
  // What left the log is not kept: the cache holds one run's lines as drawn.
  if (cache.size > drawn.size)
    for (const key of cache.keys()) if (!drawn.has(key)) cache.delete(key);
  return lines;
}

/** How long a card whose turn ended takes to stand at its new height. */
const CARD_SHUT_MS = 220;

/** Whether motion plays: never under reduced motion, nor in a hidden tab. */
function motionAllowedNow(): boolean {
  return (
    !prefersReducedMotion() &&
    (typeof document === "undefined" || document.visibilityState !== "hidden")
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
  readonly keepRef?: { current: ((lands?: boolean) => void) | null };
  /** The lines landing from the live slot this draw: they plop into place, never rise in. */
  readonly landing?: ReadonlyMap<string, number> | null;
  /**
   * Whether its room eases as lines join it, and it glides to its foot: any
   * run, except on a resync or with reduced motion.
   */
  readonly eases?: boolean;
  /**
   * Whether it opens at its first line: a settled run's work opened by "Show
   * work" reads from the start; a live one, or one watched to its end, opens
   * at its foot.
   */
  readonly opensAtStart?: boolean;
  /** Given how its boxes ease, for a line landing in it. */
  readonly roomsRef?: { current: Rooms | null };
  /** Its card's motion: the live slot's ease beside it, and the travels they share. */
  readonly motionRef: { readonly current: RunMotion };
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
  // With it, the lines set aside over the first one drawn, far above the view
  // (`stretchesAside`), and the room they took: kept over the first line
  // drawn, so nothing drawn moves and the scroll is as long. Lines joining or
  // leaving before the first one drawn leave the same lines drawn
  // (`windowOver`).
  const [held, setHeld] = useState<LogWindow>(() =>
    logWindow(lines, opensAtStart ? 0 : chatOpensAt(lines.length), NO_STRETCHES),
  );
  const win = windowOver(held, lines);
  const { from, aside } = win;
  const spacer = useMemo(() => roomAside(aside), [aside]);
  // The rows it draws: its lines from the first one drawn, each run of calls in one card.
  const shown = gatherCalls(
    (from > 0 ? lines.slice(from) : lines).map((line) =>
      plopsIn(landing, line.key) ? { ...line, plops: true } : line,
    ),
  );
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
    const motion = motionRef.current;
    const rooms = easeRooms({
      root: element,
      selector: `[data-run-scroll] > ol, ${EASED_BOXES}`,
      // Earlier lines drawn over the ones in view take their room at once:
      // where the person reads is kept by the scroll (`keptRowRef`).
      eases: () => easesRef.current && shownRef.current && !drawingEarlierRef.current,
      // Its own box grows by a travel as a line joins it, uncovering the line
      // at its foot while the slot under it rides its edge. What it holds
      // takes its room at once: a line held at an older height would be cut.
      grows: (box) => box === element,
      travels: motion.travels,
      afterStep: () => motion.keep?.(),
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
    const slotEases = () => motionRef.current.slot?.easing() ?? false;
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
      // A way longer than a screen is not watched go by: it stands at its foot at once.
      if (!glidesTo(gliding.foot - gliding.at, element.clientHeight)) {
        putAt(element, gliding.foot);
        return;
      }
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
    const laid: { height: number | null } = { height: null };
    /**
     * Read where it stands — a move up not heard yet (a scroll event comes a
     * frame late) is the person's — and, while it follows, keep it at its
     * foot: gliding there as lines join it, at once as its box changes — and
     * at once as a line `lands` from the slot, whose travel glides its lines
     * there (a glide of its own beside it went 14 px in its first frame).
     */
    const keep = (lands = false) => {
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
        grew,
        below: foot > element.scrollTop + 0.5,
        eases: easesRef.current,
        // Its own boxes, the slot squeezing it as it eases taller, or the
        // card around it uncovering it.
        roomEases: (roomRef.current?.easing() ?? false) || slotEases() || heldAbove(),
        gliding: gliding.frame !== 0,
      });
      if (keeps === "glides" && !lands) glide();
      else if (keeps !== "stays") putAt(element, foot);
      markEdges(element);
    };
    return {
      heard,
      read,
      putAt,
      keep,
      glide,
      /** Whether anything of the card moves it this moment: its glide, a room easing in it, beside it or around it. */
      moving: () =>
        gliding.frame !== 0 || (roomRef.current?.easing() ?? false) || slotEases() || heldAbove(),
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
  // Its node re-inserted puts it back at 0, silently: following, it stands at
  // its foot again; read above the foot, where the person read.
  const startRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const resettle = useRunScrollResettle({
    scrollRef,
    startRef,
    endRef,
    followRef,
    positionOf,
    putAt: follow.putAt,
  });
  useLayoutEffect(() => {
    if (keepRef === undefined) return;
    keepRef.current = follow.keep;
    return () => {
      keepRef.current = null;
    };
  }, [follow, keepRef]);
  // In each frame a box of its card eased, it keeps to its foot before the
  // frame is read again (`afterStep`): its foot rides the slot's top.
  useLayoutEffect(() => {
    const motion = motionRef.current;
    const keep = () => follow.keep();
    motion.keep = keep;
    return () => {
      if (motion.keep === keep) motion.keep = null;
    };
  }, [follow, motionRef]);
  // A drawn row in view, and where it stood among the scroll's lines, before
  // earlier lines were drawn over it: what keeps it there after.
  const keptRowRef = useRef<{ readonly key: string; readonly top: number } | null>(null);
  const drawEarlier = (position: RunScrollPosition) => {
    // Off the page (its work hidden) nothing is near its view.
    if (position.clientHeight === 0) return;
    // How far under the first drawn line the view stands: the room of the lines set aside is not it.
    const above = position.scrollTop - spacer;
    if (!reachesEarlier({ scrollTop: above }, from)) return;
    drawingEarlierRef.current = true;
    keptRowRef.current = rowInView(scrollRef.current, listRef.current);
    // The lines set aside come back first, the newest stretch of them: as tall
    // as they stood, so the scroll is as long. Then the ones never drawn.
    setHeld(windowEarlier(win, lines, above));
  };
  // The view may come to stand over lines set aside with no scroll heard — its
  // box shown again after "Hide work": asked as its box changes size, while
  // it does not follow its foot (following, it is put back there).
  const drawEarlierHere = useEffectEvent(() => {
    const element = scrollRef.current;
    if (element === null || followRef.current.follows) return;
    drawEarlier(positionOf(element));
  });
  // Lines far above the view are set aside (`stretchesAside`): asked as the
  // scroll moves and as its lines or its box change size, answered at once
  // while they do not reach that far. Never while anything of the card moves
  // — a row's place is read — nor a row the person holds: the focus in it, a
  // selection that touches the log.
  const setLinesAside = useEffectEvent(() => {
    const element = scrollRef.current;
    const list = listRef.current;
    if (element === null || list === null || drawingEarlierRef.current) return;
    // Drawn outside a page (a test's renderer), it has no rows to read; off
    // the page (its work hidden), no row has a place.
    if (typeof list.getBoundingClientRect !== "function" || list.children === undefined) return;
    if (element.clientHeight === 0) return;
    const above = element.scrollTop - spacer;
    if (!(above >= KEPT_ABOVE_PX + SET_ASIDE_PAST_PX) || follow.moving()) return;
    if (selectionTouches(list)) return;
    const rows = list.children;
    if (rows.length === 0) return;
    // A row's room starts where its margin does: one that keeps more air over
    // it, or draws into the row before it, takes that with it.
    const startOf = (row: Element) =>
      row.getBoundingClientRect().top - (Number.parseFloat(getComputedStyle(row).marginTop) || 0);
    const first = startOf(rows[0]!);
    const focused = document.activeElement;
    const over: Array<{ readonly lines: number; readonly nextTop: number }> = [];
    // The last row always stays; read only as far as rows go.
    for (let index = 0; index < rows.length - 1 && index < shown.length - 1; index += 1) {
      if (focused !== null && rows[index]!.contains(focused)) break;
      const entry = shown[index]!;
      const nextTop = startOf(rows[index + 1]!) - first;
      over.push({ lines: "calls" in entry ? entry.calls.length : 1, nextTop });
      if (nextTop > above - KEPT_ABOVE_PX) break;
    }
    const stretches = stretchesAside(over, above);
    if (stretches.length === 0) return;
    // They take no room they did not take: nothing eases for it.
    drawingEarlierRef.current = true;
    setHeld(windowAside(win, lines, stretches));
  });
  // It opens at its foot — or its start — before the first paint.
  const opensAtStartRef = useRef(opensAtStart);
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element === null) return;
    follow.putAt(element, opensAtStartRef.current ? 0 : footTop(positionOf(element)));
    markEdges(element);
  }, [follow]);
  // Lines joined or left before the first one drawn: the window over them is
  // held from here on, and the scroll moves up by the room of the lines set
  // aside that are gone, so the drawn ones stand where they stood — from
  // where it last stood, as the browser has clamped it to its shorter lines
  // by the time it is read here.
  useLayoutEffect(() => {
    if (win === held) return;
    setHeld(win);
    const element = scrollRef.current;
    const gone = roomAside(held.aside) - roomAside(win.aside);
    if (element === null || !(gone > 0.5)) return;
    const { stood } = followRef.current;
    follow.putAt(element, Math.max(0, (Number.isFinite(stood) ? stood : element.scrollTop) - gone));
  }, [win, held, follow]);
  // Earlier lines drawn above the ones in view keep those where they stood:
  // the scroll moves by what the row read before moved among its lines, and
  // not at all when the lines set aside came back as tall as they stood — a
  // write cuts the person's own scroll short. A chat too short to scroll
  // draws them at once, as nothing reaches them: never off the page (its work
  // hidden), where it has no height to be short of.
  const drawEarlierYet = useEffectEvent(() => {
    drawingEarlierRef.current = true;
    setHeld(windowEarlier(win, lines, 0));
  });
  useLayoutEffect(() => {
    const element = scrollRef.current;
    const kept = keptRowRef.current;
    keptRowRef.current = null;
    if (element === null) return;
    const row = kept === null ? null : rowByKey(listRef.current, kept.key);
    if (kept !== null && row !== null) {
      const moved = topAmongLines(element, row) - kept.top;
      if (Math.abs(moved) > 0.5) follow.putAt(element, element.scrollTop + moved);
    }
    drawingEarlierRef.current = false;
    if (from > 0 && element.clientHeight > 0 && element.scrollHeight <= element.clientHeight) {
      drawEarlierYet();
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
    glideShifted(
      list,
      drawn.rows,
      rows,
      drawn.from === from && !prependedRef.current,
      motionRef.current.travels.current(),
    );
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
      // Put back at its start by nobody as its box changed, a reader's place
      // is theirs before anything reads where it stands as a move.
      if (!followRef.current.follows) resettle();
      follow.keep();
      redraw();
      drawEarlierHere();
      setLinesAside();
    });
    observer.observe(list);
    observer.observe(element);
    return () => observer.disconnect();
  }, [follow, redraw, resettle]);
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
  return (
    <RunScrollHoldContext value={follow.hold}>
      <ChatShownContext value={shownRef}>
        <DrawnEarlierContext value={drawingEarlierRef}>
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
              setLinesAside();
              endsOnQuiet();
            }}
            onScrollEnd={() => follow.heard({ kind: "ended" })}
            role="region"
            tabIndex={0}
          >
            <div ref={startRef} aria-hidden="true" data-run-scroll-start="" />
            <ol
              ref={listRef}
              className="flex min-w-0 flex-col gap-4"
              // The room of the lines set aside over the first one drawn.
              style={spacer > 0 ? { paddingTop: spacer } : undefined}
            >
              {shown.map((entry) =>
                "calls" in entry ? (
                  <CallsCard key={entry.key} entry={entry} />
                ) : (
                  <LogLine key={entry.key} line={entry} />
                ),
              )}
            </ol>
            <div ref={endRef} aria-hidden="true" data-run-scroll-end="" />
          </div>
        </DrawnEarlierContext>
      </ChatShownContext>
    </RunScrollHoldContext>
  );
}

/**
 * A line of the log on its own row. Drawn again only when its line is another
 * (`chatLines` keeps the line of an item that draws the same): the log's
 * other rows stand as they are while one word streams into the working row.
 */
const LogLine = memo(function LogLine({ line }: { readonly line: ChatLine }) {
  return (
    <PlopsContext value={line.plops === true}>
      <ChatRow
        across={line.across === true}
        lineKey={line.key}
        mark={line.mark}
        markLine={line.markLine}
        pairs={line.pairs === true}
        said={line.said === true}
        theirs={line.theirs === true}
      >
        {line.bubble}
      </ChatRow>
    </PlopsContext>
  );
});

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

/** The longest a pointer or finger held on a run's history counts as input with no end heard. */
const HOLD_LONGEST_MS = 4000;

/** Whether two draws of a run's history hold the same lines, each a call or not alike. */
function sameLines(left: ReadonlyArray<ChatLine>, right: ReadonlyArray<ChatLine>): boolean {
  return (
    left.length === right.length &&
    left.every((line, index) => line.key === right[index]!.key && line.call === right[index]!.call)
  );
}

/**
 * A card of calls in the history. One that a call starting it lands with
 * plops as that call does, and never rises in on top of the plop. Drawn again
 * only when a call of it is another line, or one joined it (`LogLine`).
 */
const CallsCard = memo(
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
  },
  (was, now) =>
    was.entry.key === now.entry.key &&
    was.entry.calls.length === now.entry.calls.length &&
    was.entry.calls.every((line, index) => line === now.entry.calls[index]),
);

/** Whether a line lands by a plop: it stood in the slot (a rider rises in on its own). */
function plopsIn(landing: ReadonlyMap<string, number> | null, key: string): boolean {
  const from = landing?.get(key);
  return from !== undefined && Number.isFinite(from);
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
  // Its lines' list: after the mark at its start.
  const list = scroll.firstElementChild?.nextElementSibling as HTMLElement | null | undefined;
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
 * Red is a failure that still stands (`line.failed`): a run that ended well
 * says what failed of its jobs in the same words, as quiet as the rest (K9).
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
                      failed && item.state === "failed"
                        ? "text-status-failed-text"
                        : "text-muted-foreground"
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
