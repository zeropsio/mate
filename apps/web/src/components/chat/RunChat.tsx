/**
 * A run's card, as a chat (the owner, 2026-09-27: "have the whole thing look
 * like a chat, treat it like my messages … different font style / bubble
 * color / special components depending on what kind of call it is").
 *
 * The card is its own scroll, the bars under it, and between them the Mate's
 * status: its face, what it is doing and its clock — the "is typing" line of a
 * chat, never a heading over the card (the owner, 2026-09-28: "it doesn't
 * need to be at the top"). Inside the scroll, everything the Mate said and did
 * stands in the order it happened, in three hands that cannot be mistaken for
 * one another (the owner, 2026-09-28: "command looks exactly like responses,
 * thinking is hugely prominent"):
 * - what it said to the person: the one filled, round bubble, at the prose size;
 * - what it did: an outlined box led by what kind of call it was — a command
 *   is a block of code under what it was for, a read or a search one line
 *   with its names in mono, a deploy its pipeline as a bar;
 * - what it thought: small, faint italics on a hairline, no box — talking to
 *   itself.
 * What went wrong is the failed surface; what merely happened (a context
 * condensed, a change landed) a caption between hairlines; where the person's
 * words reached it, a line in their bubble on their side — the words
 * themselves stand on the page above the card.
 *
 * Nothing long prints whole. A command shows four lines of its code and the
 * way to the rest from its first frame; a thought past eight lines scrolls
 * inside itself, its newest words in sight, while it is thought, and folds to
 * its top and "Show more" once it is; the Mate's words stand whole while they
 * are the newest and fold as the person's own messages do once they are out of
 * sight. What a bubble holds besides — what a command printed, a deploy's
 * pipeline, a helper's report — opens inline under it; nothing opens a dialog.
 */
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import type { MateMarkState } from "@t3tools/shared/brand";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import {
  isActiveSubagentStatus,
  type AgentPanelModel,
  type RuntimeSubagent,
} from "@t3tools/client-runtime/state/subagentRuntime";
import {
  ActivityIcon,
  AppWindowIcon,
  BotIcon,
  BrainIcon,
  ChevronDownIcon,
  FilePenLineIcon,
  FileTextIcon,
  GlobeIcon,
  ImageIcon,
  ListTodoIcon,
  OctagonAlertIcon,
  SearchIcon,
  SquareTerminalIcon,
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
  type ReactNode,
  type UIEvent,
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
import { MateFace, type MateFaceGaze } from "../zerops/primitives";
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
  type WorkLineFace,
} from "./conversation.logic";
import { StatusBar, type BarTone } from "./ConversationPills";
import { ElapsedSince, MATE_BUBBLE_FILL, RunClock, settledRunVerb } from "./ConversationRows";
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
import { TimelineRowActivityCtx, TimelineRowCtx } from "./timelineContext";
import { stepOf, type StepKind, type StepPhrase, type WorkStep } from "./workSteps.logic";

// ---------------------------------------------------------------------------
// Shared with the rest of the card
// ---------------------------------------------------------------------------

/** The card's time column: the heading's time and every bar's, on one right edge. */
export const TIME_COLUMN = "w-14 shrink-0 text-end text-line tabular-nums text-muted-foreground";

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

/** A thought's surface: the Mate's own fill, halved. */
const THOUGHT_FILL = "bg-foreground/4";

/** What the Mate did: a hairline drawn outside the box, so it takes no room — outlined on the tray, never filled. */
const CALL_SURFACE = "ring-1 ring-foreground/12";

// ---------------------------------------------------------------------------
// The chat's scroll
// ---------------------------------------------------------------------------

interface ChatScrollApi {
  /** The scroll, for a bubble to watch whether it is still in sight. */
  readonly scroller: () => HTMLElement | null;
  /**
   * Keeps `element` where it stands on screen while the bubble it sits in
   * opens, closes or folds — `reveal`, for what the person opened: show its
   * end too, as far as its top can stay in sight.
   */
  readonly hold: (element: Element, reveal: boolean) => void;
  /** Whether the chat has been drawn once: a bubble mounting after it arrived live. */
  readonly shown: { readonly current: boolean };
}

const ChatScrollContext = createContext<ChatScrollApi | null>(null);

/** Whether this bubble arrived while the person watched: what the chat opened onto is simply there. */
function useArrivedLive(): boolean {
  const api = use(ChatScrollContext);
  const [arrived] = useState(() => api?.shown.current ?? false);
  return arrived;
}

/** The chat's height at most: a long newest bubble fits whole (it was 22 rem as a list of lines). */
const CHAT_MAX_HEIGHT = "max-h-110";

/**
 * The chat's scroll: at its newest when it opens, following its end as it
 * grows, and holding still while the person reads back — only a wheel, a
 * touch or a key leaves the end, and so does opening a bubble above the
 * newest. While the run goes on it never grows shorter, so a long bubble
 * giving way to a one-line step never pulls the conversation down; it scrolls
 * up and down, never sideways.
 */
function ChatScroll({
  live,
  label,
  empty,
  children,
}: {
  readonly live: boolean;
  readonly label: string;
  /**
   * Nothing in it yet: the card is its status line alone, the face as far
   * from the card's top as from its foot — the list's own room stood it
   * 31 px down and 22 px up (Nova, 2026-09-28).
   */
  readonly empty: boolean;
  readonly children: ReactNode;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLOListElement>(null);
  const followingRef = useRef(true);
  const gestureAtRef = useRef(Number.NEGATIVE_INFINITY);
  const tallestRef = useRef(0);
  const heldRef = useRef<{
    readonly element: Element;
    readonly top: number;
    readonly reveal: boolean;
  } | null>(null);
  const shownRef = useRef(false);
  const [minHeight, setMinHeight] = useState<number | undefined>(undefined);
  const [above, setAbove] = useState(false);
  const [below, setBelow] = useState(false);

  const settleRef = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const content = contentRef.current;
    if (scroller === null || content === null) return;
    tallestRef.current = 0;
    const settle = () => {
      const held = heldRef.current;
      heldRef.current = null;
      if (held !== null && held.element.isConnected) {
        const box = scroller.getBoundingClientRect();
        const top = held.element.getBoundingClientRect().top - box.top;
        scroller.scrollTop += top - held.top;
        if (held.reveal) {
          // Its end in sight too, as far as its top can stay there.
          const shown = held.element.getBoundingClientRect();
          const past = shown.bottom - box.bottom;
          const room = shown.top - box.top;
          if (past > 0 && room > 0) scroller.scrollTop += Math.min(past, room);
        }
      } else if (followingRef.current) {
        scroller.scrollTop = scroller.scrollHeight;
      }
      setAbove(scroller.scrollTop > 1);
      setBelow(scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight > 1);
      if (live) {
        const height = scroller.getBoundingClientRect().height;
        if (height > tallestRef.current) {
          tallestRef.current = height;
          setMinHeight(height);
        }
      }
    };
    settleRef.current = settle;
    settle();
    const observer = new ResizeObserver(settle);
    observer.observe(content);
    // Its own box too: a chat drawn before the page laid it out — the page
    // opening where the person last read, the card still below — had nothing
    // to follow yet, and its content never changed size once it had.
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [live]);

  useEffect(() => {
    shownRef.current = true;
  }, []);

  // The list the chat stands in moves its rows' nodes as it lays them out,
  // and the browser forgets a moved node's scroll without a scroll event: a
  // chat that was at its newest opened at its first bubble (2026-09-28, a
  // reload into a run three hours back). Its end leaving sight while it
  // follows is the one sign of that, so the end is watched and taken back.
  const endRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const scroller = scrollerRef.current;
    const end = endRef.current;
    if (scroller === null || end === null || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry === undefined || entry.isIntersecting) return;
        if (followingRef.current && heldRef.current === null) settleRef.current();
      },
      { root: scroller },
    );
    observer.observe(end);
    return () => observer.disconnect();
  }, []);

  const [api] = useState<ChatScrollApi>(() => ({
    scroller: () => scrollerRef.current,
    hold: (element, reveal) => {
      const scroller = scrollerRef.current;
      if (scroller === null) return;
      const top = element.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      heldRef.current = { element, top, reveal };
      // What the person opened is theirs to read: the chat stops following
      // its end unless opening it brings the end back into sight.
      if (reveal) followingRef.current = false;
      // Nothing may have changed size: the hold must not wait for a resize.
      requestAnimationFrame(() => {
        if (heldRef.current?.element === element) settleRef.current();
      });
    },
    shown: shownRef,
  }));

  const markGesture = () => {
    gestureAtRef.current = performance.now();
  };
  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const scroller = event.currentTarget;
    setAbove(scroller.scrollTop > 1);
    setBelow(scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight > 1);
    const atEnd = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 2;
    if (atEnd) followingRef.current = true;
    else if (performance.now() - gestureAtRef.current < 400) followingRef.current = false;
    else if (followingRef.current && heldRef.current === null) {
      scroller.scrollTop = scroller.scrollHeight;
    }
  };

  return (
    <ChatScrollContext value={api}>
      <div className="relative min-w-0" data-run-chat>
        <div
          ref={scrollerRef}
          className={cn(
            CHAT_MAX_HEIGHT,
            // A column, so the bubbles stand at its foot beside the face when
            // the room it keeps is taller than they are. The page scrolls on
            // past its ends: contained, a wheel over a long run stopped dead
            // at the chat's top, and the page stood still under the pointer
            // until it left the card. A gesture begun inside stays inside
            // (the browser latches it), so a flick never throws the page.
            "-mx-1.5 flex flex-col overflow-x-hidden overflow-y-auto px-1.5 scrollbar-none",
          )}
          onKeyDown={markGesture}
          onScroll={onScroll}
          onTouchMove={markGesture}
          onWheel={markGesture}
          // The chat keeps its own place when a bubble above folds or opens;
          // the browser's anchoring would move it a second time.
          style={{
            overflowAnchor: "none",
            ...(live && minHeight !== undefined ? { minHeight } : {}),
          }}
        >
          <ol
            ref={contentRef}
            aria-label={label}
            className={cn("mt-auto flex min-w-0 flex-col gap-4", empty ? "pt-3" : "pt-2 pb-4")}
          >
            {children}
          </ol>
          <span ref={endRef} aria-hidden="true" className="-mt-px block h-px shrink-0" />
        </div>
        {/* The fades ease in and out with the scroll rather than snapping on
            at its first pixel. */}
        <div
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-x-0 top-0 h-6 bg-gradient-to-b from-run-tray to-transparent transition-opacity duration-200 ease-out",
            above ? "opacity-100" : "opacity-0",
          )}
          data-chat-fade="above"
        />
        {/* Read back, the chat fades into the status line under it rather
            than being cut off against it. */}
        <div
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-run-tray to-transparent transition-opacity duration-200 ease-out",
            below ? "opacity-100" : "opacity-0",
          )}
          data-chat-fade="below"
        />
      </div>
    </ChatScrollContext>
  );
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
 * The chat's two sizes. Everything said or done reads at the prose size, 14 px
 * — the person's words, the Mate's, its thoughts, every call — and only what
 * is about them, at 13 px: a time, a caption, the way to more, code (mono
 * at 13 px stands as tall as the words at 14).
 */
const WORDS = "text-prose";
const META = "text-line";

/** How a bubble reads: its words to the person, a thought, a thing it did — and in what state. */
type BubbleTone = "speech" | "thought" | "tool" | "failed" | "attention";

const BUBBLE_TONE: Record<BubbleTone, string> = {
  // Its words to the person: the fullest fill.
  speech: `${MATE_BUBBLE_FILL} text-foreground`,
  // Talking to itself: the same bubble, half the fill, the words italic and faint.
  thought: `${THOUGHT_FILL} text-muted-foreground`,
  // A thing it did: a hairline on the tray, never a fill, so a call never
  // reads as something said.
  tool: `${CALL_SURFACE} text-foreground`,
  failed: "bg-status-failed-surface text-foreground ring-1 ring-status-failed/30",
  attention: "bg-status-attention-surface text-status-attention-text",
};

/**
 * A bubble in the Mate's column: as wide as the column, as a card of calls is,
 * so every bubble shares its right edge as well as its left.
 */
function Bubble({
  tone,
  kind,
  className,
  children,
}: {
  readonly tone: BubbleTone;
  /** What the bubble stands for, for the page's own tests and probes. */
  readonly kind: string;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "w-full min-w-0 overflow-hidden",
        BUBBLE_SHAPE,
        WORDS,
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
   * person, the way back. A bubble that simply stands whole — the newest,
   * one still in sight — offers nothing, so none appears under it later.
   */
  readonly offered: boolean;
  readonly toggle: () => void;
}

/** Where a fold watches its bubble from: the element it folds. */
type FoldWatch = (element: HTMLElement | null) => void;

/**
 * Whether a bubble is folded. Past the fold's limits it opens folded when the
 * chat opens onto it; one that arrived while the person watched stays whole
 * until it has scrolled out of sight, and the newest never folds. Once the
 * person opened or closed it, it stays as they left it.
 */
function useFold(eligible: boolean, newest: boolean): readonly [Fold, FoldWatch] {
  const api = use(ChatScrollContext);
  const arrived = useArrivedLive();
  const [folded, setFolded] = useState(() => eligible && !arrived && !newest);
  const [opened, setOpened] = useState(false);
  const touchedRef = useRef(false);
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [watch] = useState(() => {
    const follow: FoldWatch = (node) => {
      setElement(node);
    };
    return follow;
  });

  useEffect(() => {
    const root = api?.scroller() ?? null;
    if (!eligible || folded || newest || touchedRef.current || element === null || root === null)
      return;
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry === undefined || entry.isIntersecting || entry.rootBounds === null) return;
        // Wholly above what the person sees: folding it moves nothing in sight.
        if (entry.boundingClientRect.bottom > entry.rootBounds.top) return;
        const below = element.closest("[data-chat-row]")?.nextElementSibling ?? null;
        if (below !== null) api?.hold(below, false);
        setFolded(true);
      },
      { root },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [api, eligible, element, folded, newest]);

  const fold: Fold = {
    eligible,
    folded: eligible && folded,
    offered: eligible && (folded || opened),
    toggle: () => {
      touchedRef.current = true;
      const row = element?.closest<HTMLElement>("[data-chat-row]");
      if (row) api?.hold(row, true);
      setOpened(folded);
      setFolded(!folded);
    },
  };
  return [fold, watch];
}

/** What folds: its top only while folded, fading into the bubble. */
function FoldBody({
  fold,
  watch,
  height,
  children,
}: {
  readonly fold: Fold;
  readonly watch: FoldWatch;
  /** How tall it stands folded: eight of its lines. */
  readonly height: "max-h-44" | "max-h-40";
  readonly children: ReactNode;
}) {
  return (
    <div
      ref={watch}
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
  readonly onToggle: (event: { readonly currentTarget: HTMLElement }) => void;
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

/** A bubble's detail: open or not, and the switch that keeps it where the person opened it. */
function useDisclosure() {
  const api = use(ChatScrollContext);
  const [open, setOpen] = useState(false);
  return {
    open,
    toggle: (event: { readonly currentTarget: HTMLElement }) => {
      const row = event.currentTarget.closest<HTMLElement>("[data-chat-row]");
      if (row) api?.hold(row, true);
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
  readonly onToggle: (event: { readonly currentTarget: HTMLElement }) => void;
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
      className="size-3.5 shrink-0 text-muted-foreground/60 transition-[color,rotate] duration-150 group-hover/disclose:text-foreground group-aria-expanded/disclose:rotate-180"
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
  children,
}: {
  readonly label?: string | null;
  readonly mono?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <section aria-label={label ?? undefined} className="grid min-w-0 gap-1">
      {label === null ? null : <h4 className={cn(META, "text-muted-foreground")}>{label}</h4>}
      <pre
        className={cn(
          // Past its ends the page scrolls on, as it does past the chat's.
          "max-h-64 min-w-0 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-foreground/4 px-3 py-2 text-foreground/80 select-text",
          META,
          mono ? "font-mono" : "font-sans",
        )}
      >
        {children}
      </pre>
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
  readonly timeTone?: "muted" | "busy" | "failed";
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
    <span className={cn("flex min-w-0 items-start gap-2", WORDS)}>
      <span className="min-w-0 flex-1" data-run-shimmer={running ? "" : undefined}>
        {children}
      </span>
      {time !== null || opens || column ? (
        <span className="flex h-[1lh] shrink-0 items-center gap-1.5 ps-2">
          <span
            className={cn(
              META,
              "tabular-nums",
              timeTone === "busy"
                ? "text-status-busy-text"
                : timeTone === "failed"
                  ? "text-status-failed-text"
                  : "text-muted-foreground",
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
function DidMark({
  icon: Icon,
  failed = false,
}: {
  readonly icon: LucideIcon;
  readonly failed?: boolean;
}) {
  return (
    <Icon
      aria-hidden="true"
      className={cn(
        "size-3.5 shrink-0",
        failed ? "text-status-failed-text" : "text-muted-foreground",
      )}
    />
  );
}

/**
 * The Mate's column, beside a bubble: 28 px, the width of its face at the
 * chat's foot, 10 px off the bubbles (8 on a phone's card). A bubble's mark
 * stands in it centred on the bubble's first line of words.
 */
const MARK_COLUMN = "w-7 shrink-0";
const MARK_GAP = "gap-2 @md/chat:gap-2.5";

/**
 * A bubble's mark, where the Mate's column meets its first line: under the
 * bubble's 10 px top, one line of words tall.
 */
function Mark({ children }: { readonly children: ReactNode }) {
  return (
    <span aria-hidden="true" className={cn(MARK_COLUMN, "flex justify-center pt-2.5", WORDS)}>
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

/** Its words to the person on the way: the chat's bubble in its fullest fill. */
function NoteBubble({ message }: { readonly message: ChatMessage }) {
  const [fold, watch] = useFold(foldsLikeAMessage(message.text), false);
  return (
    <Bubble className={BUBBLE_PAD} kind="note" tone="speech">
      <FoldBody fold={fold} height="max-h-44" watch={watch}>
        <NoteWords message={message} />
      </FoldBody>
      <FoldToggle fold={fold} />
    </Bubble>
  );
}

/** A thought's hand: the words' size, faint and italic — its code and file names too. */
const THOUGHT_TEXT = "chat-markdown-aside text-muted-foreground";

/** Six of a thought's lines: past them it scrolls while it is thought, and folds once it is. */
const THOUGHT_CAP_PX = 136;

/** A thought scrolled inside itself: its older words fade out at the top. */
const THOUGHT_TOP_FADE = `linear-gradient(to bottom, transparent, black ${FOLD_FADE_HEIGHT_REM}rem)`;

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
 * A stretch of its thinking: the chat's bubble with half the Mate's fill and
 * its words faint and italic — the same shape as everything else in the chat
 * (the owner, 2026-09-28: "thinking doesn't look like a bubble"), kept quiet
 * by its surface and ink rather than a smaller size ("thinking is hugely
 * prominent which it should be suppressed"). Past six lines, the one it is
 * thinking now scrolls inside itself, its newest words in sight and the older
 * ones fading at the top; once it ends, the same box shows its top, a fade and
 * "Show more", so it never changes height on the way (the owner: "the long
 * thinking blocks needs to start inner scrolling with fade at the same cutoff
 * then 'sent' version will break it into 'show more'").
 */
function ThoughtBubble({
  messages,
  live = false,
}: {
  readonly messages: ReadonlyArray<ChatMessage>;
  readonly live?: boolean;
}) {
  const api = use(ChatScrollContext);
  const text = messages.map((message) => message.text).join("\n\n");
  const [taller, watch] = useTallerThan(THOUGHT_CAP_PX, foldsLikeAMessage(text));
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  // While it is thought its newest words stay in sight, unless the person
  // scrolled back inside it; once it ends it shows its top.
  const pinnedRef = useRef(true);
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (box === null) return;
    if (!live) box.scrollTop = 0;
    else if (pinnedRef.current) box.scrollTop = box.scrollHeight;
  });
  if (text.trim().length === 0) return null;
  const capped = live || (taller && !open);
  const mask = !capped
    ? undefined
    : live
      ? scrolled
        ? THOUGHT_TOP_FADE
        : undefined
      : FOLD_FADE_MASK;
  return (
    <Bubble className={BUBBLE_PAD} kind="thought" tone="thought">
      <div
        ref={boxRef}
        className={cn(
          "min-w-0",
          capped && "max-h-34",
          capped &&
            (live ? "overflow-y-auto overscroll-contain scrollbar-none" : "overflow-hidden"),
        )}
        data-chat-folded={taller && !live ? String(!open) : undefined}
        onScroll={(event) => {
          const box = event.currentTarget;
          pinnedRef.current = box.scrollHeight - box.scrollTop - box.clientHeight <= 2;
          setScrolled(box.scrollTop > 1);
        }}
        style={mask === undefined ? undefined : { WebkitMaskImage: mask, maskImage: mask }}
      >
        <div ref={watch}>
          <ThoughtParagraphs messages={messages} />
        </div>
      </div>
      {taller && !live ? (
        <MoreToggle
          onToggle={(event) => {
            const row = event.currentTarget.closest<HTMLElement>("[data-chat-row]");
            if (row) api?.hold(row, true);
            setOpen((value) => !value);
          }}
          open={open}
        >
          {open ? "Show less" : "Show more"}
        </MoreToggle>
      ) : null}
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

/** A call said plainly: the verb in the muted ink, the names it took in mono. */
function PhraseWords({ phrase }: { readonly phrase: StepPhrase }) {
  const name = (target: string) => (
    <span
      className={cn(
        "min-w-0 break-words text-foreground/90",
        phrase.code ? cn("font-mono", META) : WORDS,
      )}
    >
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
          <span className="text-muted-foreground">
            {last && phrase.more === 0 ? " and " : ", "}
          </span>
        ) : null}
        {name(target)}
      </span>,
    );
  });
  return (
    <span className={WORDS}>
      <span className="text-muted-foreground">{phrase.verb}</span>
      {phrase.targets.length > 0 ? " " : null}
      {parts}
      {phrase.more > 0 ? (
        <span className="text-muted-foreground"> and {phrase.more} more</span>
      ) : null}
    </span>
  );
}

/** The pictures a step looked at, as themselves: small, each one opening the picture viewer. */
function StepPictures({ paths }: { readonly paths: ReadonlyArray<string> }) {
  if (paths.length === 0) return null;
  const { threadRef, onImageExpand } = use(TimelineRowCtx);
  if (threadRef === null) return null;
  return (
    <span className="flex min-w-0 flex-wrap gap-1.5 px-3.5 pb-2.5">
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
        className={cn("w-full min-w-0 divide-y divide-foreground/8", BUBBLE_SHAPE, CALL_SURFACE)}
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
 * One call, as its row of the bubble: in the failed surface where it failed,
 * its mark in the Mate's column beside it — out of the bubble, in the column
 * the chat's row keeps for it. A call joining a bubble already there rises in
 * on its own; one that came with its bubble rises in with it.
 */
function CallRow({
  kind,
  mark,
  failed = false,
  children,
}: {
  /** What the call stands for, for the page's own tests and probes. */
  readonly kind: string;
  /** What kind of call it is, in the Mate's column. */
  readonly mark: ReactNode;
  readonly failed?: boolean;
  readonly children: ReactNode;
}) {
  const group = use(CallGroupContext);
  const [joined] = useState(() => group?.current ?? false);
  return (
    <div
      className={cn(
        "relative min-w-0 first:rounded-t-2xl last:rounded-b-2xl",
        failed && "bg-status-failed-surface",
        joined && "origin-top animate-bubble-in motion-reduce:animate-none",
      )}
      data-chat-bubble={failed ? "failed" : "tool"}
      data-chat-kind={kind}
      data-chat-row
    >
      {/* Its mark stands off the bubble, over the row's empty column. */}
      <span className="absolute end-full top-0 me-2 @md/chat:me-2.5">
        <Mark>{mark}</Mark>
      </span>
      {children}
    </div>
  );
}

/**
 * A command's code, in mono: four lines of it from its first frame and a fade
 * where it goes on — a script never prints whole into the chat (the owner,
 * 2026-09-28: "I see 100s of LoC printed directly"). It is how, under what the
 * command was for, on the words' own edge: in the muted ink, failed too — the
 * headline, the surface and the time say that it failed.
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
 * back. The one it is making now keeps its clock in the busy blue.
 */
export function StepBubble({ step }: { readonly step: WorkStep }) {
  const disclosure = useDisclosure();
  const outputs = stepOutput(step);
  const failed = step.state === "failed";
  const running = step.state === "running";
  const time = stepTime(step);
  const timeWords = failed && time !== null ? <>Failed · {time}</> : failed ? "Failed" : time;
  const script = step.kind === "command" ? (step.script ?? step.code) : null;
  const [taller, watchCode] = useTallerThan(CODE_CAP_PX, step.codeLines > CODE_CAP_LINES);
  const cut = script !== null && taller;
  const opens = outputs.length > 0 || cut;
  const title = step.words ?? step.code ?? "A command";
  const headline = (
    <Headline
      column
      opens={opens}
      running={running}
      time={timeWords}
      timeTone={running ? "busy" : failed ? "failed" : "muted"}
    >
      {step.kind === "command" ? (
        <span className={failed ? "text-status-failed-text" : "text-foreground/90"}>
          {step.words ?? <span className="text-muted-foreground">Ran a command</span>}
        </span>
      ) : step.phrase !== null ? (
        <PhraseWords phrase={step.phrase} />
      ) : (
        <span className={failed ? "text-status-failed-text" : "text-foreground/90"}>{title}</span>
      )}
      {step.kind === "edit" && step.entries.length > 1 ? (
        <span className="text-muted-foreground">{` · ${step.entries.length} edits`}</span>
      ) : null}
    </Headline>
  );
  const pad = script !== null ? "px-3.5 pt-2.5 pb-1" : BUBBLE_PAD;
  return (
    <CallRow
      failed={failed}
      kind={`step:${step.kind}`}
      mark={<DidMark failed={failed} icon={STEP_GLYPH[step.kind]} />}
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
      {script !== null ? (
        <div className={cn("px-3.5", cut ? "pb-1" : "pb-2.5")}>
          <CommandCode folded={cut ? !disclosure.open : null} script={script} watch={watchCode} />
        </div>
      ) : null}
      <StepPictures paths={step.images} />
      {disclosure.open && outputs.length > 0 ? (
        <div
          className="grid animate-detail-in gap-2 px-3.5 pb-2.5 motion-reduce:animate-none"
          data-chat-detail
        >
          {outputs.map((output) => (
            <OutputBlock key={output.key} label={output.label}>
              {output.text}
            </OutputBlock>
          ))}
        </div>
      ) : null}
      {cut ? (
        <div className="px-3.5 pb-2.5">
          <MoreToggle onToggle={disclosure.toggle} open={disclosure.open}>
            {disclosure.open
              ? "Show less"
              : step.codeLines > CODE_CAP_LINES
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

/** A settled operation's bar, from what it knew of its steps: whole, or cut where it failed. */
function settledBar(
  operation: ZeropsOperation,
): ReadonlyArray<{ readonly key: string; readonly tone: BarTone }> {
  const failed = operation.phase === "failed";
  if (operation.steps.length === 0) return [{ key: "whole", tone: failed ? "failed" : "done" }];
  return operation.steps.map((step) => ({
    key: step.id,
    tone: failed
      ? step.state === "done"
        ? "done"
        : step.state === "failed" || step.state === "running"
          ? "failed"
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
  newest = false,
}: {
  readonly operation: ZeropsOperation;
  readonly newest?: boolean;
}) {
  const ctx = use(TimelineRowCtx);
  const disclosure = useDisclosure();
  const failed = operation.phase === "failed";
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
      failed={failed}
      kind={`operation:${operation.kind}`}
      mark={<KindGlyph kind={operation.kind} />}
    >
      <DisclosureButton
        className={BUBBLE_PAD}
        label={`${words}. ${disclosure.open ? "Hide" : "Show"} it`}
        onToggle={disclosure.toggle}
        open={disclosure.open}
      >
        <Headline
          column
          opens
          time={running && newest ? null : operationTime(operation)}
          timeTone={failed ? "failed" : "muted"}
        >
          <span className={cn("flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5", WORDS)}>
            <span className={failed ? "text-status-failed-text" : "text-foreground/90"}>
              {words}
            </span>
            {running ? null : <StatusBar className="w-12" segments={settledBar(operation)} />}
            {detail !== null ? (
              <span className={cn("min-w-0 truncate font-mono text-muted-foreground", META)}>
                {detail}
              </span>
            ) : null}
          </span>
        </Headline>
      </DisclosureButton>
      {disclosure.open ? (
        <div
          className="animate-detail-in px-3.5 pb-2.5 motion-reduce:animate-none"
          data-chat-detail
        >
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
  const words = running
    ? `Checking ${browserCheckCaption(latest)}`
    : strip.views === 1
      ? `Checked ${browserCheckCaption(latest)}`
      : strip.views === 2 && pages.length === 2 && hosts.size === 1
        ? `Checked ${pages[0]} and ${pages[1]}`
        : `Checked ${strip.views} pages`;
  const verdict = running
    ? null
    : strip.failures > 0
      ? strip.failures === 1
        ? "1 check failed"
        : `${strip.failures} checks failed`
      : settled.length === 1
        ? "passed"
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
    <CallRow failed={failed} kind="checks" mark={<DidMark failed={failed} icon={AppWindowIcon} />}>
      <DisclosureButton
        className={BUBBLE_PAD}
        label={`${words}${verdict === null ? "" : `, ${verdict}`}. ${disclosure.open ? "Hide" : "Show"} the checks`}
        onToggle={disclosure.toggle}
        open={disclosure.open}
      >
        <Headline
          column
          opens
          time={time}
          timeTone={running ? "busy" : failed ? "failed" : "muted"}
        >
          <span className={WORDS}>
            <span className="text-foreground/90">{words}</span>
            {verdict === null ? null : (
              <span className={failed ? "text-status-failed-text" : "text-muted-foreground"}>
                {` · ${verdict}`}
              </span>
            )}
          </span>
        </Headline>
      </DisclosureButton>
      {disclosure.open || !takes ? null : (
        <div className="px-3.5 pb-2.5">
          <BrowserTakes
            environmentId={ctx.activeThreadEnvironmentId}
            onOpenImage={ctx.onImageExpand}
            takes={strip.checks}
          />
        </div>
      )}
      {disclosure.open ? (
        <div
          className="animate-detail-in px-3.5 pb-2.5 motion-reduce:animate-none"
          data-chat-detail
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

/** A service that stopped answering, and what became of it: its phases in order. */
function IncidentBubble({ incident }: { readonly incident: IncidentModel }) {
  return (
    <Bubble
      kind="incident"
      tone={
        incident.tone === "failed" ? "failed" : incident.tone === "attention" ? "attention" : "tool"
      }
      className={BUBBLE_PAD}
    >
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
    <span className={cn("flex min-w-0 items-baseline gap-3", WORDS)}>
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
      {open && said ? <OutputBlock mono={false}>{said}</OutputBlock> : null}
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
    <CallRow failed={failed} kind="helpers" mark={<DidMark failed={failed} icon={BotIcon} />}>
      <DisclosureButton
        className={BUBBLE_PAD}
        label={`${words}. ${disclosure.open ? "Hide" : "Show"} them`}
        onToggle={disclosure.toggle}
        open={disclosure.open}
      >
        <Headline
          column
          opens
          timeTone={summary.live ? "busy" : "muted"}
          time={summary.live ? "Working" : null}
        >
          <span className={WORDS}>
            <span className="text-foreground/90">{words}</span>
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
  return <OutputBlock mono={entry.agentRole === undefined}>{report}</OutputBlock>;
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
      <span className={failed ? "text-status-failed-text" : "text-foreground/90"}>{words}</span>
      <span className="text-muted-foreground">{` · ${where}`}</span>
    </Headline>
  );
  return (
    <CallRow
      failed={failed}
      kind="task"
      mark={
        <DidMark
          failed={failed}
          icon={entry.agentRole !== undefined ? BotIcon : SquareTerminalIcon}
        />
      }
    >
      {reported ? (
        <DisclosureButton
          className={BUBBLE_PAD}
          label={`${words}. ${disclosure.open ? "Hide" : "Show"} what it reported`}
          onToggle={disclosure.toggle}
          open={disclosure.open}
        >
          {line}
        </DisclosureButton>
      ) : (
        <div className={BUBBLE_PAD}>{line}</div>
      )}
      {disclosure.open ? (
        <div
          className="animate-detail-in px-3.5 pb-2.5 motion-reduce:animate-none"
          data-chat-detail
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
  return (
    <CallRow kind="plan" mark={<DidMark icon={ListTodoIcon} />}>
      <DisclosureButton
        className={BUBBLE_PAD}
        label={`To-do list, ${done} of ${steps.length} done. ${disclosure.open ? "Hide" : "Show"} it`}
        onToggle={disclosure.toggle}
        open={disclosure.open}
      >
        <Headline column opens time={`${done}/${steps.length}`}>
          <span className={WORDS}>
            <span className="text-foreground/90">To-do list</span>
            {current !== null ? (
              <span className="text-muted-foreground">{` · ${current}`}</span>
            ) : null}
          </span>
        </Headline>
      </DisclosureButton>
      {disclosure.open ? (
        <div
          className="animate-detail-in px-3.5 pb-2.5 motion-reduce:animate-none"
          data-chat-detail
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

/** Something that stopped it: the failed surface, the whole error under it. */
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
    <Bubble kind="error" tone="failed">
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
          className="animate-detail-in px-3.5 pb-2.5 motion-reduce:animate-none"
          data-chat-detail
        >
          <OutputBlock>{more}</OutputBlock>
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
  /** A caption across the chat, off the Mate's column. */
  readonly across?: boolean;
  /** The person's words, on their side of the chat. */
  readonly theirs?: boolean;
  /** A thing it did: a row of the card its run of calls shares. */
  readonly call?: boolean;
}

/** A thought's mark. */
const THOUGHT_MARK = <DidMark icon={BrainIcon} />;

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
 * Where the person's words reached the Mate: one line in their bubble, on
 * their side — the words themselves stand on the page above the card (the
 * owner, 2026-09-28: "shown the user message in short inside the working
 * group, printed it in the chat at the same time").
 */
function PersonMark({ item }: { readonly item: Extract<RecordItem, { kind: "person" }> }) {
  const words =
    item.words ?? (item.imageOnly ? "" : (item.message?.text.trim().split("\n")[0] ?? ""));
  const images = item.message?.attachments?.filter(isImageAttachment).length ?? 0;
  return (
    <p
      className={cn(
        "max-w-4/5 truncate bg-message text-message-foreground",
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

/** A record's item as its line of the chat. */
function itemLine(item: RecordItem): ChatLine | null {
  switch (item.kind) {
    case "step":
      return { key: item.key, bubble: <StepBubble step={item.step} />, call: true };
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
      };
    case "note":
      return { key: item.key, bubble: <NoteBubble message={item.message} /> };
    case "person":
      return { key: item.key, bubble: <PersonMark item={item} />, theirs: true };
    case "operation":
      return { key: item.key, bubble: <OperationBubble operation={item.operation} />, call: true };
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
        mark: <DidMark failed={item.incident.tone === "failed"} icon={ActivityIcon} />,
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
        mark: <DidMark failed icon={OctagonAlertIcon} />,
      };
  }
}

/**
 * What the Mate has its hands on now, as the newest bubble: the thought it is
 * thinking or the call it is making, keyed as the record will key it so it
 * stays the same bubble once it ends. Nothing else is a bubble — that it
 * thinks, writes, waits on the person or condenses its context is the status
 * line's to say, under the chat.
 */
function nowLine(now: TurnHeaderActivity | null): ChatLine | null {
  if (now === null) return null;
  switch (now.kind) {
    case "thinking":
      return now.key === null || now.messages.length === 0
        ? null
        : {
            key: now.key,
            bubble: <ThoughtBubble live messages={now.messages} />,
            mark: THOUGHT_MARK,
          };
    case "step":
      return { key: `step:${now.step.key}`, bubble: <StepBubble step={now.step} />, call: true };
    case "operation":
      // A check is its row of the chat from its start: it is there already.
      if (now.operation.kind === "browser") return null;
      return {
        key: `operation:${now.operation.key}`,
        bubble: <OperationBubble newest operation={now.operation} />,
        call: true,
      };
    case "writing":
    case "waiting":
      return null;
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
  mark,
  children,
}: {
  readonly across: boolean;
  readonly theirs: boolean;
  readonly mark?: ReactNode;
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
    <li className={cn("flex min-w-0 items-start", MARK_GAP)} data-chat-row>
      {/* The Mate's column, on a phone's card too: it holds the marks that
          tell the bubbles apart, so every bubble keeps one edge. */}
      {mark === undefined ? (
        <span aria-hidden="true" className={MARK_COLUMN} />
      ) : (
        <Mark>{mark}</Mark>
      )}
      {/* Only what arrives while the person watches rises in. */}
      <div
        className={cn(
          "flex min-w-0 flex-1",
          theirs && "justify-end",
          arrived && "animate-bubble-in motion-reduce:animate-none",
          arrived && (theirs ? "origin-bottom-right" : "origin-bottom-left"),
        )}
      >
        {children}
      </div>
    </li>
  );
}

/** A run that is over, as its face wears it. */
const SETTLED_FACE: Record<WorkLineFace, MateMarkState> = {
  working: "working",
  idle: "idle",
  produced: "done",
  failed: "idle",
  paused: "sleep",
  stopped: "idle",
};

/** What the Mate is doing this second, after its name on the status line. */
interface Doing {
  readonly verb: string;
  /** It is putting words together: the dots after the verb. */
  readonly composing: boolean;
  /** It waits on the person: the clock stands still, the line in the attention hand. */
  readonly waiting: boolean;
  /** Where its face looks while it does it: up and aside thinking, down along its line writing. */
  readonly gaze?: MateFaceGaze;
}

function liveDoing(now: TurnHeaderActivity | null, compacting: boolean, answering: boolean): Doing {
  if (compacting) return { verb: "is condensing the context", composing: true, waiting: false };
  if (answering) return { verb: "is writing", composing: true, waiting: false, gaze: "down" };
  if (now === null) return { verb: "is thinking", composing: true, waiting: false, gaze: "up" };
  switch (now.kind) {
    case "waiting":
      return { verb: "is waiting for your answer", composing: false, waiting: true };
    case "writing":
      return { verb: "is writing", composing: true, waiting: false, gaze: "down" };
    case "thinking":
      return {
        verb: "is thinking",
        composing: now.messages.length === 0,
        waiting: false,
        gaze: "up",
      };
    case "step":
    case "operation":
      return { verb: "is working", composing: false, waiting: false };
  }
}

/**
 * The Mate's status, under its chat: its face, what it is doing and for how
 * long — while it works, the chat's "is typing" line; once the run is over,
 * who worked and for how long. It stands in one place and only its words
 * change, so the run ending moves nothing (the owner, 2026-09-28, of the
 * heading that stood over the card: "it doesn't need to be at the top").
 */
function StatusLine({
  status,
  now,
  answering,
}: {
  readonly status: RunStatus;
  readonly now: TurnHeaderActivity | null;
  readonly answering: boolean;
}) {
  const ctx = use(TimelineRowCtx);
  const { isCompacting } = use(TimelineRowActivityCtx);
  const doing = status.live ? liveDoing(now, isCompacting, answering) : null;
  const face: MateMarkState =
    doing === null ? SETTLED_FACE[status.face] : doing.waiting ? "needs" : "working";
  const words = `${ctx.speaker.name} ${doing?.verb ?? settledRunVerb(status)}`;
  // The line's words change in place as the run goes: the new ones rise into
  // it, so a change reads as the same line saying something new, not a flicker.
  const wordsChanged = useChangedSinceShown(words);
  return (
    <div
      className={cn("flex min-w-0 items-center pb-1", MARK_GAP)}
      data-run-status={doing === null ? status.face : doing.waiting ? "waiting" : "working"}
    >
      <MateFace
        gaze={doing?.gaze}
        greets
        known={ctx.arrivedAfter !== null && !ctx.syncing}
        size="md"
        state={face}
        tint={ctx.speaker.tint}
      />
      <div
        className={cn(
          "flex min-h-7 min-w-0 flex-1 items-center gap-2.5 text-line",
          doing?.waiting ? "text-status-attention-text" : "text-muted-foreground",
        )}
        data-work-line={status.face}
        role={status.live ? "status" : undefined}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span
            className={cn(
              "min-w-0 truncate",
              wordsChanged && "animate-words-in motion-reduce:animate-none",
            )}
            key={words}
          >
            {words}
          </span>
          {doing?.composing ? <TypingDots className="shrink-0 scale-75" /> : null}
        </span>
        {/* The run's clock stands in the calls' time column — 14 px of the
            bubble's padding and the chevron's 20 px slot in from the edge —
            so every time in the card ends on one edge; it stood under the
            chevrons, 34 px right of the times it sums. */}
        <RunClock
          className={cn("me-8.5", doing !== null && !doing.waiting && "text-status-busy-text")}
          status={status}
          timestampFormat={ctx.timestampFormat}
        />
      </div>
    </div>
  );
}

/**
 * How many of a long run's bubbles its chat draws when it opens: the newest,
 * where the chat opens. The ones before them wait above, a click away — a
 * two-hour run drew nine hundred bubbles at once and froze the page for
 * 0.7 s as it opened (Juno, 2026-09-27).
 */
const CHAT_OPENS_WITH = 40;

/**
 * A run's chat in its card: every bubble in one scroll, and under it the
 * Mate's status — the present said once.
 */
export function RunChat({ row }: { readonly row: RecordRow }) {
  const ctx = use(TimelineRowCtx);
  const lines: ChatLine[] = row.items.flatMap((item) => {
    const line = itemLine(item);
    return line === null ? [] : [line];
  });
  // A mark says where in the run the person spoke; before anything the Mate
  // did it marks nothing — their words stand on the page right above the
  // card, and the card opened on a second copy of them.
  while (lines[0]?.theirs === true) lines.shift();
  if (row.live && !row.answering) {
    const line = nowLine(row.now);
    if (line !== null) lines.push(line);
  }
  // Where the chat starts, fixed when it opens: what arrives after it only
  // ever joins at the end, so the window grows and never slides.
  const [from, setFrom] = useState(() => Math.max(0, lines.length - CHAT_OPENS_WITH));
  const shown = gatherCalls(from > 0 ? lines.slice(from) : lines);
  return (
    // One container for the chat and its status line: the Mate's column keeps
    // one gap for both, the narrower on a phone's card.
    <div className="@container/chat min-w-0">
      <ChatScroll
        empty={shown.length === 0 && from === 0}
        label={`${ctx.speaker.name}'s work`}
        live={row.live}
      >
        {from > 0 ? <EarlierLine count={from} onShow={() => setFrom(0)} /> : null}
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
              theirs={entry.theirs === true}
            >
              {entry.bubble}
            </ChatRow>
          ),
        )}
      </ChatScroll>
      {row.status === null ? null : (
        <StatusLine answering={row.answering} now={row.now} status={row.status} />
      )}
    </div>
  );
}

/**
 * The bubbles a long chat has not drawn yet, above the ones it opened with:
 * a caption between hairlines that draws them, keeping in place what the
 * person was reading.
 */
function EarlierLine({ count, onShow }: { readonly count: number; readonly onShow: () => void }) {
  const api = use(ChatScrollContext);
  return (
    <li className={cn("flex min-w-0 items-center gap-3", META)} data-chat-row>
      <span aria-hidden="true" className="h-px min-w-4 flex-1 bg-border/70" />
      <button
        className="shrink-0 cursor-pointer rounded-md px-1.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
        data-chat-earlier
        data-scroll-anchor-ignore
        onClick={(event) => {
          const below = event.currentTarget.closest("li")?.nextElementSibling ?? null;
          if (below !== null) api?.hold(below, false);
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
