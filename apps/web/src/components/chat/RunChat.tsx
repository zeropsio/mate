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
 * The card has no scroll of its own (K8), and nothing in it is cut without a
 * way to the rest (D4): a long run's earlier lines fold behind "Show N
 * earlier", a command at four lines and what it printed at twelve behind
 * "Show all N lines", a thought behind a click, a long message of the Mate's
 * behind "Show full message" — each opening in place, under the line the
 * person clicked, which stays where it is. A run the person comes back to
 * opens folded (K7): its worked line on top, what it said to them under it,
 * its thoughts and calls behind "Show work". Nothing opens a dialog.
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
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";

import { cn } from "~/lib/utils";
import { useAssetUrlState } from "../../assets/assetUrls";
import {
  workEntryDisplayIndicatesToolFailure,
  type TurnPlanEntry,
  type WorkLogEntry,
} from "../../session-logic";
import { isImageAttachment, type ChatMessage } from "../../types";
import ChatMarkdown from "../ChatMarkdown";
import { ChangeChipMomentContext } from "../zerops/ZeropsChangeLinkChip";
import { CrewSeamActivity } from "../zerops/crew/CrewTaskCard";
import { KindGlyph, ZeropsOperationCard } from "../zerops/ZeropsOperationCard";
import { MateFace } from "../zerops/primitives";
import { useChangedSinceShown } from "~/hooks/useChangedSinceShown";
import { useOperationCard } from "../../zerops/activity/useOperationCard";
import { deriveAgentSpawnSummary } from "./agentSpawnSummary";
import { BrowserStrip, BrowserTakes } from "./BrowserStrip";
import {
  browserCheckCaption,
  browserTakeState,
  formatWorkDuration,
  operationLineWords,
  type BrowserStripModel,
  type IncidentModel,
  type OutcomeModel,
} from "./conversation.logic";
import { useRunEffortWords } from "./runResultFacts";
import { StatusBar, type BarTone } from "./ConversationPills";
import { ElapsedSince } from "./ConversationRows";
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
  earlierShown,
  foldsOnReturn,
  formatClock,
  recoveredFailures,
  LONG_STEP_MS,
  nowLineFace,
  nowLineOf,
  nowLineWords,
  operationNowWords,
  runFoldOf,
  setRunFold,
  severalWords,
  stepNowWords,
  subscribeRunFolds,
  thoughtRunText,
  type NowLine as NowLineModel,
  type RunFold,
} from "./runCard.logic";
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

/** How long a step took, or how long it has run so far. */
export function stepTime(step: WorkStep): ReactNode {
  if (step.state === "running") return <ElapsedSince since={step.startedAt} />;
  if (!TIMED.has(step.kind) || step.endedAt === null) return null;
  const ms = Date.parse(step.endedAt) - Date.parse(step.startedAt);
  return Number.isFinite(ms) && ms >= 1000 ? formatWorkDuration(ms) : null;
}

/** How long a platform operation took, or how long it has run so far. */
export function operationTime(operation: ZeropsOperation): ReactNode {
  if (operation.phase === "running") return <ElapsedSince since={operation.anchorAt} />;
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
 * while the person watched. The chat has no scroll of its own (K8, D4): the
 * conversation is the one scroll, and what the chat does not draw folds
 * behind a control that draws it.
 */
const ChatShownContext = createContext<{ readonly current: boolean } | null>(null);

/** Whether this bubble arrived while the person watched: what the chat opened onto is simply there. */
function useArrivedLive(): boolean {
  const shown = use(ChatShownContext);
  const [arrived] = useState(() => shown?.current ?? false);
  return arrived;
}

const HOLD_NOTHING = () => {};

/**
 * What the person opened or closed is theirs to read (K12): the conversation
 * stops following its end, so the line they clicked stays where it is and
 * only what is under it moves. Drawn outside a conversation, it holds nothing.
 */
function useHoldReading(): () => void {
  const ctx = use(TimelineRowCtx) as TimelineRowSharedState | null;
  return ctx?.onHoldReading ?? HOLD_NOTHING;
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
function useFold(eligible: boolean): Fold {
  const arrived = useArrivedLive();
  const hold = useHoldReading();
  const [folded, setFolded] = useState(() => eligible && !arrived);
  const [opened, setOpened] = useState(false);
  return {
    eligible,
    folded: eligible && folded,
    offered: eligible && (folded || opened),
    toggle: () => {
      hold();
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
  children,
}: {
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly children: ReactNode;
}) {
  return (
    <button
      aria-expanded={open}
      className={cn(
        META,
        "mt-1 block cursor-pointer rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70",
      )}
      data-scroll-anchor-ignore
      onClick={onToggle}
      type="button"
    >
      {children}
    </button>
  );
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

/** A bubble's detail: open or not, and its switch — the person's reading held while it opens. */
function useDisclosure() {
  const hold = useHoldReading();
  const [open, setOpen] = useState(false);
  return {
    open,
    toggle: () => {
      hold();
      setOpen((value) => !value);
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
  return (
    <button
      aria-expanded={open}
      aria-label={label}
      className={cn(
        "group/disclose block w-full min-w-0 cursor-pointer text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-inset",
        className,
      )}
      data-chat-disclose
      data-scroll-anchor-ignore
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
  // No scroll inside the card (K8): past twelve lines it folds, and the way
  // to the rest opens it in place (D4).
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
            hold();
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
  return (
    <span className={cn("flex min-w-0 items-start gap-2", META)}>
      <span className="min-w-0 flex-1" data-run-shimmer={running ? "" : undefined}>
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
  return (
    <span aria-hidden="true" className={cn(MARK_COLUMN, "flex justify-center", MARK_LINE[line])}>
      <span className="flex h-[1lh] items-center">{children}</span>
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
  const fold = useFold(foldsLikeAMessage(message.text));
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
 * Whether what `watch` is given runs past the lines it is clamped to. Until
 * it is measured — the first render, before the page paints it — `guess`.
 */
function useRunsPast(guess: boolean): readonly [boolean, (element: HTMLElement | null) => void] {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [past, setPast] = useState(guess);
  useLayoutEffect(() => {
    if (element === null) return;
    const measure = () => setPast(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  const [watch] = useState(() => (node: HTMLElement | null) => setElement(node));
  return [past, watch];
}

/**
 * A stretch of its thinking, the quietest thing in the card (K14): 13 px,
 * faint and italic on the faintest fill, two lines of it at most. One that
 * runs on is the way to the rest of itself — a click opens the whole thought
 * in place, and "Show less" closes it (D4: nothing is cut without a way to
 * reach it).
 */
function ThoughtBubble({ messages }: { readonly messages: ReadonlyArray<ChatMessage> }) {
  const text = messages.map((message) => message.text).join("\n\n");
  const run = thoughtRunText(text);
  const hold = useHoldReading();
  const [open, setOpen] = useState(false);
  const [past, watch] = useRunsPast(run.length > THOUGHT_GUESS_CHARS);
  if (text.trim().length === 0) return null;
  const clamped = (
    <span ref={watch} className="line-clamp-2 italic" data-chat-folded={past ? "true" : undefined}>
      {run}
    </span>
  );
  return (
    <Bubble className={THOUGHT_PAD} kind="thought" size={META} tone="thought">
      {open ? (
        <>
          <ThoughtParagraphs messages={messages} />
          <MoreToggle
            onToggle={() => {
              hold();
              setOpen(false);
            }}
            open
          >
            Show less
          </MoreToggle>
        </>
      ) : past ? (
        <button
          aria-expanded={false}
          aria-label={`${run.slice(0, 80)}… Show the whole thought`}
          className="block w-full min-w-0 cursor-pointer rounded-sm text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
          data-chat-disclose
          data-scroll-anchor-ignore
          onClick={() => {
            hold();
            setOpen(true);
          }}
          type="button"
        >
          {clamped}
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

/** The runtime's `Name: {json}` detail of a call: its arguments, never output to show. */
const CALL_ARGUMENTS = /^[A-Za-z][\w-]*:\s*[{[]/;

interface StepOutput {
  readonly key: string;
  readonly label: string | null;
  readonly text: string;
}

/**
 * What a step holds besides what its bubble says: what it printed or
 * returned, the files an edit touched where they are, what a search or a read
 * of the web was asked. Nothing for a call that returned nothing to read.
 */
export function stepOutput(step: WorkStep): ReadonlyArray<StepOutput> {
  const blocks: StepOutput[] = [];
  step.entries.forEach((entry, index) => {
    const command = (entry.rawCommand ?? entry.command)?.trim();
    if (step.kind === "edit") {
      const files = [
        ...new Set([
          ...(entry.changedFiles ?? []),
          ...(entry.callInput?.filePath ? [entry.callInput.filePath] : []),
        ]),
      ];
      if (files.length > 0)
        blocks.push({ key: `${index}:files`, label: "Files", text: files.join("\n") });
    }
    const asked = [
      entry.callInput?.pattern ? `pattern  ${entry.callInput.pattern}` : null,
      entry.callInput?.glob ? `glob     ${entry.callInput.glob}` : null,
      entry.callInput?.path ? `in       ${entry.callInput.path}` : null,
      entry.callInput?.url ? `address  ${entry.callInput.url}` : null,
      entry.callInput?.query ? `query    ${entry.callInput.query}` : null,
    ].filter((line): line is string => line !== null);
    if (asked.length > 0 && (step.kind === "search" || step.kind === "web")) {
      blocks.push({ key: `${index}:asked`, label: "Asked", text: asked.join("\n") });
    }
    const detail = entry.detail?.trim();
    if (
      detail &&
      detail !== command &&
      !CALL_ARGUMENTS.test(detail) &&
      !(step.kind === "look" && step.images.includes(detail))
    ) {
      blocks.push({
        key: `${index}:output`,
        label: step.kind === "command" && blocks.length === 0 ? null : "Returned",
        text: detail,
      });
    }
  });
  return blocks;
}

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
export function CallGroup({ children }: { readonly children: ReactNode }) {
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
  const [joined] = useState(() => group?.current ?? false);
  return (
    <div
      className={cn(
        "relative min-w-0 first:rounded-t-2xl last:rounded-b-2xl",
        joined && "run-rise",
      )}
      data-chat-bubble={failure === null ? "tool" : "failed"}
      data-chat-failed={failure ?? undefined}
      data-chat-kind={kind}
      data-chat-row
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
export function StepBubble({
  step,
  undone = false,
}: {
  readonly step: WorkStep;
  /** It failed, and a later step undid it: quiet, not red (K9). */
  readonly undone?: boolean;
}) {
  const disclosure = useDisclosure();
  const outputs = stepOutput(step);
  const failure: Failure | null = step.state !== "failed" ? null : undone ? "undone" : "broken";
  const running = step.state === "running";
  const time = stepTime(step);
  const script = step.kind === "command" ? (step.script ?? step.code) : null;
  // A command that said nothing of itself is its own title (K4): its first
  // line, in mono, and the rest of it opens under it.
  const bare = script !== null && step.words === null;
  const [taller, watchCode] = useTallerThan(CODE_CAP_PX, step.codeLines > CODE_CAP_LINES);
  const cut = script !== null && (bare ? step.codeLines > 1 : taller);
  const showsCode = script !== null && (!bare || disclosure.open);
  const opens = outputs.length > 0 || cut;
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
            folded={cut && !bare ? !disclosure.open : null}
            script={script}
            watch={watchCode}
          />
        </div>
      ) : null}
      <StepPictures paths={step.images} />
      {disclosure.open && outputs.length > 0 ? (
        <div
          className="grid animate-detail-in gap-2 px-3 pb-2 motion-reduce:animate-none"
          data-chat-detail
        >
          {outputs.map((output) => (
            <OutputBlock key={output.key} label={output.label} text={output.text} />
          ))}
        </div>
      ) : null}
      {cut ? (
        <div className="px-3 pb-1.75">
          <MoreToggle onToggle={disclosure.toggle} open={disclosure.open}>
            {disclosure.open
              ? "Show less"
              : bare || step.codeLines > CODE_CAP_LINES
                ? `Show all ${step.codeLines} lines`
                : "Show the whole command"}
          </MoreToggle>
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
}: {
  readonly operation: ZeropsOperation;
  readonly environmentId: EnvironmentId | null;
  readonly threadRef: ScopedThreadRef | null;
}) {
  const regions = useOperationCard(operation, environmentId);
  return <ZeropsOperationCard headless operation={operation} threadRef={threadRef} {...regions} />;
}

/**
 * A settled operation's bar, from what it knew of its steps: whole, or cut
 * where it failed — in red while that still stands, quiet once undone (K9).
 */
function settledBar(
  operation: ZeropsOperation,
  undone: boolean,
): ReadonlyArray<{ readonly key: string; readonly tone: BarTone }> {
  const failed = operation.phase === "failed";
  const cut: BarTone = undone ? "waiting" : "failed";
  if (operation.steps.length === 0) return [{ key: "whole", tone: failed ? cut : "done" }];
  return operation.steps.map((step) => ({
    key: step.id,
    tone: failed
      ? step.state === "done"
        ? "done"
        : step.state === "failed" || step.state === "running"
          ? cut
          : "waiting"
      : "done",
  }));
}

/**
 * A platform operation as its bubble — a deploy, a subdomain, a restart:
 * what it did in a sentence, its pipeline as a bar, and its time; while it
 * runs, what the Mate waits on beside its face (the bar under the chat has
 * its clock). Its card — the pipeline, the build log — opens under it.
 */
function OperationBubble({
  operation,
  undone = false,
}: {
  readonly operation: ZeropsOperation;
  /** It failed, and a later one on the same service went through: quiet (K9). */
  readonly undone?: boolean;
}) {
  const ctx = use(TimelineRowCtx);
  const disclosure = useDisclosure();
  const failed = operation.phase === "failed";
  const failure: Failure | null = !failed ? null : undone ? "undone" : "broken";
  const running = operation.phase === "running";
  const words = operationLineWords(operation);
  const version = operation.version?.name ?? null;
  const detail = failed
    ? (operation.explanation?.reason ?? operation.closing ?? null)
    : operation.kind === "deploy" && version !== null
      ? /^[0-9a-f]{12,40}$/i.test(version)
        ? version.slice(0, 7)
        : version
      : null;
  return (
    <CallRow
      failure={failure}
      kind={`operation:${operation.kind}`}
      mark={
        failure === null ? <KindGlyph kind={operation.kind} /> : <FailedMark failure={failure} />
      }
    >
      <DisclosureButton
        className={CALL_PAD}
        label={`${words}. ${disclosure.open ? "Hide" : "Show"} it`}
        onToggle={disclosure.toggle}
        open={disclosure.open}
      >
        <Headline
          column
          opens
          time={operationTime(operation)}
          timeTone={failure === "broken" ? "failed" : "muted"}
        >
          <span className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5">
            <span className="text-foreground/75">{words}</span>
            {running ? null : (
              <StatusBar className="w-12" segments={settledBar(operation, undone)} />
            )}
            {detail !== null ? (
              <span className="min-w-0 truncate font-mono text-muted-foreground">{detail}</span>
            ) : null}
          </span>
        </Headline>
      </DisclosureButton>
      {disclosure.open ? (
        <div className="animate-detail-in px-3 pb-2 motion-reduce:animate-none" data-chat-detail>
          <OperationDetail
            environmentId={ctx.activeThreadEnvironmentId}
            operation={operation}
            threadRef={ctx.threadRef}
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
  // One clock for the row, from its first check: a second check running
  // never starts it again from nothing.
  const time = running ? (
    <ElapsedSince since={strip.checks[0]!.anchorAt} />
  ) : Number.isFinite(tookMs) && tookMs >= 1000 ? (
    formatWorkDuration(tookMs)
  ) : null;
  const failed = strip.failures > 0;
  const takes = strip.checks.some(
    (check) =>
      check.screenshot ||
      check.phase === "running" ||
      browserTakeState(check, strip.checks) === "failed",
  );
  return (
    <CallRow
      failure={failed ? "broken" : null}
      kind="checks"
      mark={failed ? <FailedMark failure="broken" /> : <DidMark icon={AppWindowIcon} />}
    >
      <DisclosureButton
        className={CALL_PAD}
        label={`${words}${verdict === null ? "" : `, ${verdict}`}. ${disclosure.open ? "Hide" : "Show"} the checks`}
        onToggle={disclosure.toggle}
        open={disclosure.open}
      >
        <Headline column opens time={time} timeTone={failed ? "failed" : "muted"}>
          <span>
            <span className="text-foreground/75">{words}</span>
            {verdict === null ? null : (
              <span className={failed ? "text-status-failed-text" : "text-muted-foreground"}>
                {` · ${verdict}`}
              </span>
            )}
          </span>
        </Headline>
      </DisclosureButton>
      {disclosure.open || !takes ? null : (
        <div className="px-3 pb-2">
          <BrowserTakes
            environmentId={ctx.activeThreadEnvironmentId}
            onOpenImage={ctx.onImageExpand}
            takes={strip.checks}
          />
        </div>
      )}
      {disclosure.open ? (
        <div className="animate-detail-in px-3 pb-2 motion-reduce:animate-none" data-chat-detail>
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
  const firstLine = said?.split("\n").find((line) => line.trim().length > 0) ?? null;
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
      {said ? (
        <button
          aria-expanded={open}
          className="grid min-w-0 cursor-pointer gap-0.5 rounded-lg px-1.5 py-1 text-start transition-colors hover:bg-foreground/4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
          onClick={() => setOpen((value) => !value)}
          type="button"
        >
          {line}
          {open || firstLine === null ? null : (
            <span className={cn("truncate text-muted-foreground", META)}>{firstLine}</span>
          )}
        </button>
      ) : (
        <div className="px-1.5 py-1">{line}</div>
      )}
      {open && said ? <OutputBlock mono={false} text={said} /> : null}
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
export function HelpersBubble({ entry }: { readonly entry: WorkLogEntry }) {
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
  return (
    <CallRow
      failure={failed ? "broken" : null}
      kind="helpers"
      mark={failed ? <FailedMark failure="broken" /> : <DidMark icon={BotIcon} />}
    >
      <DisclosureButton
        className={CALL_PAD}
        label={`${words}. ${disclosure.open ? "Hide" : "Show"} them`}
        onToggle={disclosure.toggle}
        open={disclosure.open}
      >
        <Headline column opens timeTone="muted" time={summary.live ? "Working" : null}>
          <span>
            <span className="text-foreground/75">{words}</span>
            {what ? <span className="text-muted-foreground">{` · ${what}`}</span> : null}
          </span>
        </Headline>
      </DisclosureButton>
      {disclosure.open ? (
        // Its helpers' words on the bubble's text edge: 8 px in, and their own 6.
        <div
          className="grid animate-detail-in gap-2 px-2 pb-2.5 motion-reduce:animate-none"
          data-chat-detail
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
        <div className="animate-detail-in px-3 pb-2 motion-reduce:animate-none" data-chat-detail>
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
  return (
    <CallRow kind="plan" mark={<DidMark icon={ListTodoIcon} />}>
      <DisclosureButton
        className={CALL_PAD}
        label={`To-do list, ${done} of ${steps.length} done. ${disclosure.open ? "Hide" : "Show"} it`}
        onToggle={disclosure.toggle}
        open={disclosure.open}
      >
        <Headline column opens time={`${done}/${steps.length}`}>
          <span>
            <span className="text-foreground/75">To-do list</span>
            {current !== null ? (
              <span className="text-muted-foreground">{` · ${current}`}</span>
            ) : null}
          </span>
        </Headline>
      </DisclosureButton>
      {disclosure.open ? (
        <div className="animate-detail-in px-3 pb-2 motion-reduce:animate-none" data-chat-detail>
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
        <div className="animate-detail-in px-3 pb-2 motion-reduce:animate-none" data-chat-detail>
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
}

/** A thought's mark: a small asterisk, fainter than a call's. */
const THOUGHT_MARK = (
  <AsteriskIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground/70" />
);

/** Its words' mark: its own face, at rest — who is speaking, beside what it said. */
function SpeakerMark() {
  const ctx = use(TimelineRowCtx);
  return <MateFace size="sm" state="idle" tint={ctx.speaker.tint} />;
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
 * Where the person's words reached the Mate, on their side, in their bubble:
 * an answer to its question whole — it stands nowhere else; a message they
 * sent into the run in one line — the message itself stands on the page above
 * the card (the owner, 2026-09-28: "shown the user message in short inside
 * the working group, printed it in the chat at the same time").
 */
function PersonMark({ item }: { readonly item: Extract<RecordItem, { kind: "person" }> }) {
  const words =
    item.words ?? (item.imageOnly ? "" : (item.message?.text.trim().split("\n")[0] ?? ""));
  const images = item.message?.attachments?.filter(isImageAttachment).length ?? 0;
  return (
    <p
      className={cn(
        "max-w-4/5 bg-message text-message-foreground",
        item.words === undefined ? "truncate" : "whitespace-pre-wrap break-words",
        BUBBLE_SHAPE,
        BUBBLE_PAD,
        WORDS,
      )}
      data-chat-kind="person"
    >
      {words.length > 0 ? words : images > 1 ? `${images} images` : "An image"}
    </p>
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
        bubble: <OperationBubble operation={item.operation} undone={undone.has(item.key)} />,
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
  across,
  theirs,
  pairs = false,
  mark,
  markLine,
  children,
}: {
  readonly across: boolean;
  readonly theirs: boolean;
  /** It answers the question right above it: 6 px under it, not 12. */
  readonly pairs?: boolean;
  readonly mark?: ReactNode;
  readonly markLine?: MarkLine | undefined;
  readonly children: ReactNode;
}) {
  const arrived = useArrivedLive();
  if (across) {
    return (
      <li className="min-w-0" data-chat-row>
        {children}
      </li>
    );
  }
  return (
    <li className={cn("flex min-w-0 items-start", MARK_GAP, pairs && "-mt-1.5")} data-chat-row>
      {/* The Mate's column, on a phone's card too: it holds the marks that
          tell the bubbles apart, so every bubble keeps one edge. */}
      {mark === undefined ? (
        <span aria-hidden="true" className={MARK_COLUMN} />
      ) : (
        <Mark line={markLine}>{mark}</Mark>
      )}
      {/* Only what arrives while the person watches rises in. */}
      <div className={cn("flex min-w-0 flex-1", theirs && "justify-end", arrived && "run-rise")}>
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
  const read = () => {
    const start = Date.parse(status.startedAt);
    const now = status.waitingSince === null ? Date.now() : Date.parse(status.waitingSince);
    return formatClock(now - start - status.waitedMs);
  };
  useEffect(() => {
    const update = () => {
      if (ref.current) ref.current.textContent = read();
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  });
  return (
    <span ref={ref} className="run-now-clock" data-work-line-clock>
      {read()}
    </span>
  );
}

/**
 * How long the step on the now line has run, once that passes 30 s: words on
 * the same line — "· 0:31" — never a second clock (K3). Nothing before.
 */
function LongStepTime({ since }: { readonly since: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const read = () => {
    const took = Date.now() - Date.parse(since);
    return took >= LONG_STEP_MS ? `· ${formatClock(took)}` : "";
  };
  useEffect(() => {
    const update = () => {
      if (ref.current) ref.current.textContent = read();
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  });
  return (
    <span ref={ref} className="run-now-long">
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
}: {
  readonly step: WorkStep;
  /** The one step on the line sweeps; a line each of several at once stands still. */
  readonly sweeps?: boolean;
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
      {step.kind === "command" && step.code !== null ? (
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
      return (
        <>
          <StepNowWords step={line.step} />
          <LongStepTime since={line.step.startedAt} />
        </>
      );
    case "operation":
      return (
        <>
          <span className="run-now-verb" data-run-shimmer="">
            {operationNowWords(line.operation)}
          </span>
          <LongStepTime since={line.operation.anchorAt} />
        </>
      );
    case "several":
      return <span className="run-now-verb">{severalWords(line.steps)}</span>;
    case "waiting":
      return <span className="run-now-verb">Waiting for your answer</span>;
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
  const line = nowLineOf({
    status,
    now,
    answering,
    compacting: isCompacting,
    speaker: ctx.speaker.name,
    effort,
  });
  const face = nowLineFace(line, status);
  const words = nowLineWords(line);
  // The line's words change in place as the run goes: the new ones rise into
  // it, so a change reads as the same line saying something new.
  const wordsChanged = useChangedSinceShown(words);
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
        size="md"
        state={face.state}
        tint={ctx.speaker.tint}
      />
      <div
        className="run-now-words"
        data-work-line={status.face}
        role={status.live ? "status" : undefined}
      >
        <span
          key={words}
          className={cn(
            "run-now-head",
            wordsChanged && "animate-words-in motion-reduce:animate-none",
          )}
        >
          <NowWords line={line} />
        </span>
        {line.kind === "several" ? (
          <ul className="run-now-several">
            {line.steps.map((step) => (
              <li key={step.key}>
                <StepNowWords step={step} sweeps={false} />
              </li>
            ))}
          </ul>
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

/**
 * A run's chat in its card: what the Mate said and did, in the order it
 * happened, and under it the Mate's status — the present said once. The
 * card has no scroll of its own (K8): the conversation is the one scroll,
 * and a long run's earlier lines fold behind "Show N earlier" at its top.
 */
export function RunChat({ row }: { readonly row: RecordRow }) {
  const ctx = use(TimelineRowCtx);
  const hold = useHoldReading();
  const fold = useRunFold(ctx.routeThreadKey, row.turnKey, row.live);
  // A run the person comes back to (K7): its worked line on top, what it
  // said to them under it, and its work — its thoughts and calls — folded
  // behind "Show work", which opens it under the line (K12).
  const later = row.status !== null && !row.live && fold !== "watched";
  const folded = later && fold === "folded";
  const lines = chatLines(
    folded ? row.items.filter((item) => !foldsOnReturn(item)) : row.items,
    row.items,
  );
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
  const feed = (
    <ChatFeed key={folded ? "kept" : "all"} label={`${ctx.speaker.name}'s work`} lines={lines} />
  );
  return (
    // One container for the chat and its now line: the Mate's column keeps
    // one gap for both. Its words wear its tint (`.run-speech`).
    <div
      className="@container/chat min-w-0"
      data-run-chat
      data-run-fold={later ? fold : undefined}
      style={
        { "--run-speaker-tint": `var(--zerops-mate-tint-${ctx.speaker.tint})` } as CSSProperties
      }
    >
      {later && row.status !== null ? (
        <>
          <NowLine
            answering={false}
            outcome={row.outcome}
            end={
              row.items.some(foldsOnReturn) ? (
                <WorkToggle
                  onToggle={() => {
                    hold();
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
          <div ref={feedRef} className="run-later-feed">
            {feed}
          </div>
        </>
      ) : (
        <>
          {feed}
          {row.status === null ? null : (
            <NowLine
              answering={row.answering}
              outcome={row.outcome}
              now={row.now}
              status={row.status}
            />
          )}
        </>
      )}
    </div>
  );
}

/**
 * A record's items as the chat's lines, from the first thing the Mate did;
 * `all` the whole record, which says what a later step undid.
 */
function chatLines(
  items: ReadonlyArray<RecordItem>,
  all: ReadonlyArray<RecordItem> = items,
): ChatLine[] {
  const undone = recoveredFailures(all);
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
 * How a run's card stands in this conversation: a live run is watched, and
 * stays open once it settles until the person leaves (`forgetRunFolds`); a
 * settled run they come back to is folded.
 */
function useRunFold(conversation: string, run: string, live: boolean): RunFold {
  const read = () => runFoldOf(conversation, run);
  const fold = useSyncExternalStore(subscribeRunFolds, read, read);
  useEffect(() => {
    if (live) setRunFold(conversation, run, "watched");
  }, [conversation, run, live]);
  return live ? "watched" : fold;
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

/** "Show work" on a folded run's line, "Hide work" once it is open: its chevron turns over. */
function WorkToggle({ open, onToggle }: { readonly open: boolean; readonly onToggle: () => void }) {
  return (
    <button
      aria-expanded={open}
      className="run-now-fold"
      data-scroll-anchor-ignore
      onClick={onToggle}
      type="button"
    >
      {open ? "Hide work" : "Show work"}
      <ChevronDownIcon aria-hidden="true" className="run-now-fold-icon" />
    </button>
  );
}

/**
 * The chat's lines, in the order they happened: the newest where it opens,
 * a long run's earlier lines behind "Show N earlier" at its top. What
 * arrives after it was first drawn arrived while the person watched, and
 * rises in.
 */
function ChatFeed({
  label,
  lines,
}: {
  readonly label: string;
  readonly lines: ReadonlyArray<ChatLine>;
}) {
  // Drawn once: from here on, what arrives arrives while the person watches.
  const shownRef = useRef(false);
  useEffect(() => {
    shownRef.current = true;
  }, []);
  // Where the chat starts, fixed when it opens: what arrives after it only
  // ever joins at the end, so the window grows and never slides.
  const [from, setFrom] = useState(() => chatOpensAt(lines.length));
  const shown = gatherCalls(from > 0 ? lines.slice(from) : lines);
  if (shown.length === 0 && from === 0) return null;
  return (
    <ChatShownContext value={shownRef}>
      <ol aria-label={label} className="flex min-w-0 flex-col gap-3">
        {from > 0 ? (
          <EarlierLine
            count={earlierShown(from).shows}
            onShow={() => setFrom((start) => earlierShown(start).next)}
          />
        ) : null}
        {shown.map((entry) =>
          "calls" in entry ? (
            <ChatRow key={entry.key} across={false} theirs={false}>
              <CallGroup>
                {entry.calls.map((line) => (
                  <Fragment key={line.key}>{line.bubble}</Fragment>
                ))}
              </CallGroup>
            </ChatRow>
          ) : (
            <ChatRow
              key={entry.key}
              across={entry.across === true}
              mark={entry.mark}
              markLine={entry.markLine}
              pairs={entry.pairs === true}
              theirs={entry.theirs === true}
            >
              {entry.bubble}
            </ChatRow>
          ),
        )}
      </ol>
    </ChatShownContext>
  );
}

/**
 * The lines a long chat has not drawn yet, above the ones it opened with: a
 * caption between hairlines that draws the chunk just before them — the
 * button stays where it was clicked, and what it draws opens under it.
 */
function EarlierLine({ count, onShow }: { readonly count: number; readonly onShow: () => void }) {
  const hold = useHoldReading();
  return (
    <li className={cn("flex min-w-0 items-center gap-3", META)} data-chat-row>
      <span aria-hidden="true" className="h-px min-w-4 flex-1 bg-border/70" />
      <button
        className="shrink-0 cursor-pointer rounded-md px-1.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
        data-chat-earlier
        data-scroll-anchor-ignore
        onClick={() => {
          hold();
          onShow();
        }}
        type="button"
      >
        {count === 1 ? "Show 1 earlier" : `Show ${count} earlier`}
      </button>
      <span aria-hidden="true" className="h-px min-w-4 flex-1 bg-border/70" />
    </li>
  );
}

// ---------------------------------------------------------------------------
// Background work, outside any card
// ---------------------------------------------------------------------------

/**
 * Background work that finished after its turn, or that woke the run under
 * it: one quiet line saying what finished and where — a helper, a task, or
 * how many — and what each reported, opened under it.
 */
export function BackgroundLine({
  words,
  where,
  failed,
  entries,
}: {
  readonly words: string;
  readonly where: string;
  readonly failed: boolean;
  readonly entries: ReadonlyArray<WorkLogEntry>;
}) {
  const [open, setOpen] = useState(false);
  const lastByTask = new Map<string, WorkLogEntry>();
  for (const entry of entries) lastByTask.set(entry.taskId ?? entry.id, entry);
  const reported = [...lastByTask.values()].filter((entry) => entry.detail?.trim());
  const line = (
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
      <span className="ms-2.5 shrink-0 text-line text-muted-foreground">{where}</span>
      {reported.length > 0 ? (
        <ChevronDownIcon
          aria-hidden="true"
          className="ms-2.5 size-3 shrink-0 text-muted-foreground/70 opacity-0 transition-[opacity,rotate] duration-150 group-hover/disclose:opacity-100 group-aria-expanded/disclose:rotate-180 group-aria-expanded/disclose:opacity-100"
        />
      ) : null}
    </span>
  );
  return (
    <div className="grid min-w-0 gap-2" data-background-line>
      {reported.length > 0 ? (
        <button
          aria-expanded={open}
          aria-label={`${words}, ${where}. ${open ? "Hide" : "Show"} what it reported`}
          className="group/disclose -mx-1.5 flex min-h-7 w-[calc(100%+0.75rem)] cursor-pointer items-center rounded-md px-1.5 text-start transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-inset"
          onClick={() => setOpen((value) => !value)}
          type="button"
        >
          {line}
        </button>
      ) : (
        <div className="flex min-h-7 items-center">{line}</div>
      )}
      {open ? (
        <ul
          className="grid min-w-0 animate-detail-in gap-3 ps-5 motion-reduce:animate-none"
          data-chat-detail
        >
          {reported.map((entry) => (
            <li key={entry.id} className="grid min-w-0 gap-1">
              <span className="text-line text-foreground/85">
                {taskTitle(entry)}
                <span className="text-muted-foreground">
                  {workEntryDisplayIndicatesToolFailure(entry) ? " · failed" : " · finished"}
                </span>
              </span>
              <TaskReport entry={entry} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
