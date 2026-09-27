/**
 * A run's card, as a chat (the owner, 2026-09-27: "have the whole thing look
 * like a chat, treat it like my messages … different font style / bubble
 * color / special components depending on what kind of call it is").
 *
 * The card keeps its heading, its own scroll and the bars under it; inside the
 * scroll, everything the Mate said and did is a bubble of its own, in the
 * order it happened, on one spine — the Mate's face beside the newest while it
 * works:
 * - its words to the person: a bubble in the Mate's fill, at the prose size;
 * - its thinking: no fill, a hairline, in muted italics — talking to itself;
 * - each call: one lighter fill for them all — a command says what it is for
 *   and shows the code under it, a read or a search is one line with its
 *   names in mono, a picture it looked at is the picture;
 * - what went wrong: the failed surface; what waits on the person: the
 *   attention surface; what merely happened (a context condensed, a change
 *   landed): a caption between hairlines, no bubble.
 *
 * A bubble folds as the person's own messages do — past 8 lines or 600
 * characters, its top, a fade and "Show full message" — but never while it is
 * the newest, and only once it has scrolled out of sight, so nothing the
 * person is reading shrinks under them. What a bubble holds besides its words
 * — what a command printed, a deploy's pipeline, a helper's report — opens
 * inline under them; nothing opens a dialog.
 */
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import {
  isActiveSubagentStatus,
  type AgentPanelModel,
  type RuntimeSubagent,
} from "@t3tools/client-runtime/state/subagentRuntime";
import { ChevronDownIcon } from "lucide-react";
import {
  createContext,
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
import type { ChatMessage } from "../../types";
import ChatMarkdown from "../ChatMarkdown";
import { Button } from "../ui/button";
import { ChangeChipMomentContext } from "../zerops/ZeropsChangeLinkChip";
import { ZeropsOperationCard } from "../zerops/ZeropsOperationCard";
import { MateFace } from "../zerops/primitives";
import { useOperationCard } from "../../zerops/activity/useOperationCard";
import { deriveAgentSpawnSummary } from "./agentSpawnSummary";
import { BrowserStrip, BrowserTakes } from "./BrowserStrip";
import {
  browserCheckCaption,
  formatWorkDuration,
  operationLineWords,
  type BrowserStripModel,
  type IncidentModel,
} from "./conversation.logic";
import { StatusBar, type BarTone } from "./ConversationPills";
import { ElapsedSince, MATE_BUBBLE_FILL } from "./ConversationRows";
import type { ExpandedImagePreview } from "./ExpandedImagePreview";
import {
  normalizeCompactToolLabel,
  shouldPreserveAssistantLineBreaks,
  thoughtParagraphs,
  type ConversationEvent,
  type MessagesTimelineRow,
  type RecordItem,
  type TurnHeaderActivity,
} from "./MessagesTimeline.logic";
import { TimelineRowActivityCtx, TimelineRowCtx } from "./timelineContext";
import { stepOf, type StepKind, type StepPhrase, type WorkStep } from "./workSteps.logic";

// ---------------------------------------------------------------------------
// Shared with the rest of the card
// ---------------------------------------------------------------------------

/** The card's time column: the heading's time and every bar's, on one right edge. */
export const TIME_COLUMN = "w-14 shrink-0 text-end text-xs tabular-nums text-muted-foreground";

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
            className="flex min-h-7 min-w-0 items-start gap-2.5 text-line"
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
  readonly hold: (element: HTMLElement, reveal: boolean) => void;
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
  children,
}: {
  readonly live: boolean;
  readonly label: string;
  readonly children: ReactNode;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLOListElement>(null);
  const followingRef = useRef(true);
  const gestureAtRef = useRef(Number.NEGATIVE_INFINITY);
  const tallestRef = useRef(0);
  const heldRef = useRef<{
    readonly element: HTMLElement;
    readonly top: number;
    readonly reveal: boolean;
  } | null>(null);
  const shownRef = useRef(false);
  const [minHeight, setMinHeight] = useState<number | undefined>(undefined);
  const [above, setAbove] = useState(false);

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
    return () => observer.disconnect();
  }, [live]);

  useEffect(() => {
    shownRef.current = true;
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
            "-mx-1.5 overflow-x-hidden overflow-y-auto overscroll-contain px-1.5 scrollbar-none",
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
            className="flex min-w-0 flex-col justify-end gap-1 pt-1 pb-2"
          >
            {children}
          </ol>
        </div>
        {above ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-6 bg-gradient-to-b from-card to-transparent"
          />
        ) : null}
      </div>
    </ChatScrollContext>
  );
}

// ---------------------------------------------------------------------------
// A bubble
// ---------------------------------------------------------------------------

/** How a bubble reads: whose voice, or what state. */
type BubbleTone = "speech" | "thought" | "tool" | "failed" | "attention";

const BUBBLE_TONE: Record<BubbleTone, string> = {
  speech: `${MATE_BUBBLE_FILL} text-foreground`,
  thought: "border border-foreground/12 text-muted-foreground",
  tool: "bg-foreground/5 text-foreground",
  failed: "bg-status-failed-surface text-foreground",
  attention: "bg-status-attention-surface text-status-attention-text",
};

/**
 * Where a bubble stands on the chat's spine: the first keeps its top corner
 * round, and every corner where two bubbles meet is small, so the Mate's
 * bubbles read as one voice down the card's left edge.
 */
const BubbleFirstContext = createContext(false);

function Bubble({
  tone,
  kind,
  wide = false,
  text = false,
  className,
  children,
}: {
  readonly tone: BubbleTone;
  /** What the bubble stands for, for the page's own tests and probes. */
  readonly kind: string;
  /** Opened: as wide as the chat, for what it shows under its words. */
  readonly wide?: boolean;
  /** Words to read: no wider than a comfortable line. */
  readonly text?: boolean;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  const first = use(BubbleFirstContext);
  return (
    <div
      className={cn(
        "min-w-0 overflow-hidden rounded-2xl",
        first ? "rounded-es-md" : "rounded-s-md",
        wide ? "w-full" : text ? "w-fit max-w-xl" : "w-fit max-w-full",
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
        const row = element.closest<HTMLElement>("[data-chat-row]");
        const below = row?.nextElementSibling;
        if (below instanceof HTMLElement) api?.hold(below, false);
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
    <div className="-ms-1.5 mt-1 flex">
      <Button
        aria-expanded={!fold.folded}
        data-scroll-anchor-ignore
        onClick={fold.toggle}
        size="xs"
        type="button"
        variant="ghost-muted"
      >
        {fold.folded ? more : "Show less"}
      </Button>
    </div>
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
 * The part of a bubble that opens what it holds: its whole face, pressable,
 * the bubble's fill deepening under the pointer; a chevron by its time says it
 * opens, on hover and while it is open.
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
        "group/disclose block w-full min-w-0 cursor-pointer text-start transition-colors hover:bg-foreground/4 active:bg-foreground/6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-inset",
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

/** The chevron a bubble that opens wears by its time: on hover, and while open. */
function OpensMark() {
  return (
    <ChevronDownIcon
      aria-hidden="true"
      className="size-3 shrink-0 text-muted-foreground/70 opacity-0 transition-[opacity,rotate] duration-150 group-hover/disclose:opacity-100 group-aria-expanded/disclose:rotate-180 group-aria-expanded/disclose:opacity-100"
    />
  );
}

/** What a bubble's detail says, in its own inset: a command's output, a report, an error. */
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
      {label === null ? null : <h4 className="text-muted-foreground text-xs">{label}</h4>}
      <pre
        className={cn(
          "max-h-64 min-w-0 overflow-auto overscroll-contain whitespace-pre-wrap break-words rounded-xl bg-card/70 px-3 py-2 text-foreground/85 leading-relaxed select-text",
          mono ? "font-mono text-xs" : "font-sans text-line",
        )}
      >
        {children}
      </pre>
    </section>
  );
}

/** A bubble's first line: what it is, and at the right edge its time and the chevron. */
function Headline({
  children,
  time = null,
  timeTone = "muted",
  opens = false,
}: {
  readonly children: ReactNode;
  readonly time?: ReactNode;
  readonly timeTone?: "muted" | "busy" | "failed";
  readonly opens?: boolean;
}) {
  return (
    <span className="flex min-w-0 items-baseline gap-3">
      <span className="min-w-0 flex-1">{children}</span>
      {time !== null || opens ? (
        <span
          className={cn(
            "flex shrink-0 items-center gap-1 self-center text-xs tabular-nums",
            timeTone === "busy"
              ? "text-status-busy-text"
              : timeTone === "failed"
                ? "text-status-failed-text"
                : "text-muted-foreground",
          )}
        >
          {time}
          {opens ? <OpensMark /> : null}
        </span>
      ) : null}
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

/** A stretch of thinking, a paragraph at a time, the newest still coming. */
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
    <div className="grid gap-2 italic">
      {paragraphs.map((paragraph) => (
        <ChatMarkdown
          key={paragraph.key}
          className="text-line leading-5 text-muted-foreground"
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

/** Its words to the person on the way: its own bubble, at the prose size. */
function NoteBubble({ message }: { readonly message: ChatMessage }) {
  const [fold, watch] = useFold(foldsLikeAMessage(message.text), false);
  return (
    <Bubble kind="note" text tone="speech" className="px-3.5 py-2">
      <FoldBody fold={fold} height="max-h-44" watch={watch}>
        <NoteWords message={message} />
      </FoldBody>
      <FoldToggle fold={fold} />
    </Bubble>
  );
}

/**
 * A stretch of its thinking: the Mate talking to itself — no fill, a
 * hairline, muted italics. The one it is thinking now grows whole beside its
 * face; once it ends it is the same bubble, and it folds like any other once
 * it is out of sight.
 */
function ThoughtBubble({
  messages,
  newest = false,
}: {
  readonly messages: ReadonlyArray<ChatMessage>;
  readonly newest?: boolean;
}) {
  const text = messages.map((message) => message.text).join("\n\n");
  const [fold, watch] = useFold(foldsLikeAMessage(text), newest);
  if (text.trim().length === 0) return null;
  return (
    <Bubble kind="thought" text tone="thought" className="px-3 py-1.5">
      <FoldBody fold={fold} height="max-h-40" watch={watch}>
        <ThoughtParagraphs messages={messages} />
      </FoldBody>
      <FoldToggle fold={fold} />
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
        phrase.code ? "font-mono text-xs" : "text-line",
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
    <span className="text-line">
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
    <span className="flex min-w-0 flex-wrap gap-1.5 px-3 pb-2">
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
    return <span className="text-muted-foreground text-xs">{name} is not there any more</span>;
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

/**
 * A call the Mate made, as its bubble. A command says what it is for, then
 * the code whole — folded past its eighth line — and its time; anything else
 * is one line, its names in mono. What it printed opens under it. The one it
 * is making now wears its clock in the busy blue beside the face.
 */
export function StepBubble({
  step,
  newest = false,
}: {
  readonly step: WorkStep;
  readonly newest?: boolean;
}) {
  const disclosure = useDisclosure();
  const outputs = stepOutput(step);
  const opens = outputs.length > 0;
  const failed = step.state === "failed";
  const running = step.state === "running";
  const time = stepTime(step);
  const timeWords = failed && time !== null ? <>Failed · {time}</> : failed ? "Failed" : time;
  const script = step.kind === "command" ? (step.script ?? step.code) : null;
  const [fold, watch] = useFold(script !== null && foldsLikeAMessage(script), newest);
  const title = step.words ?? step.code ?? "A command";

  const headline = (
    <Headline
      opens={opens}
      time={timeWords}
      timeTone={running ? "busy" : failed ? "failed" : "muted"}
    >
      {step.kind === "command" ? (
        step.words !== null ? (
          <span
            className={cn("text-line", failed ? "text-status-failed-text" : "text-foreground/90")}
          >
            {step.words}
          </span>
        ) : (
          <FoldBody fold={fold} height="max-h-40" watch={watch}>
            <code
              className={cn(
                "block whitespace-pre-wrap break-words font-mono text-xs leading-5",
                failed ? "text-status-failed-text" : "text-foreground/90",
              )}
            >
              {script}
            </code>
          </FoldBody>
        )
      ) : step.phrase !== null ? (
        <PhraseWords phrase={step.phrase} />
      ) : (
        <span
          className={cn("text-line", failed ? "text-status-failed-text" : "text-foreground/90")}
        >
          {title}
        </span>
      )}
    </Headline>
  );
  const code =
    step.kind === "command" && step.words !== null && script !== null ? (
      <FoldBody fold={fold} height="max-h-40" watch={watch}>
        <code className="mt-0.5 block whitespace-pre-wrap break-words font-mono text-muted-foreground text-xs leading-5">
          {script}
        </code>
      </FoldBody>
    ) : null;
  const suffix =
    step.kind === "edit" && step.entries.length > 1 ? `${step.entries.length} edits` : null;
  const face = (
    <>
      {headline}
      {code}
      {suffix !== null ? (
        <span className="mt-0.5 block text-muted-foreground text-xs">{suffix}</span>
      ) : null}
    </>
  );
  const pad = step.kind === "command" ? "px-3 pt-1.5 pb-2" : "px-3 py-1";
  return (
    <Bubble kind={`step:${step.kind}`} tone={failed ? "failed" : "tool"} wide={disclosure.open}>
      {opens ? (
        <DisclosureButton
          className={pad}
          label={`${title}. ${disclosure.open ? "Hide" : "Show"} what it returned`}
          onToggle={disclosure.toggle}
          open={disclosure.open}
        >
          {face}
        </DisclosureButton>
      ) : (
        <div className={pad}>{face}</div>
      )}
      {fold.offered ? (
        <div className="px-3 pb-1.5">
          <FoldToggle fold={fold} more={`Show all ${step.codeLines} lines`} />
        </div>
      ) : null}
      <StepPictures paths={step.images} />
      {disclosure.open ? (
        <div className="grid gap-2 px-3 pb-3" data-chat-detail>
          {outputs.map((output) => (
            <OutputBlock key={output.key} label={output.label}>
              {output.text}
            </OutputBlock>
          ))}
        </div>
      ) : null}
    </Bubble>
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
    <Bubble
      kind={`operation:${operation.kind}`}
      tone={failed ? "failed" : "tool"}
      wide={disclosure.open}
    >
      <DisclosureButton
        className="px-3 py-1.5"
        label={`${words}. ${disclosure.open ? "Hide" : "Show"} it`}
        onToggle={disclosure.toggle}
        open={disclosure.open}
      >
        <Headline
          opens
          time={running && newest ? null : operationTime(operation)}
          timeTone={failed ? "failed" : "muted"}
        >
          <span className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5 text-line">
            <span className={failed ? "text-status-failed-text" : "text-foreground/90"}>
              {words}
            </span>
            {running ? null : <StatusBar className="w-12" segments={settledBar(operation)} />}
            {detail !== null ? (
              <span className="min-w-0 truncate font-mono text-muted-foreground text-xs">
                {detail}
              </span>
            ) : null}
          </span>
        </Headline>
      </DisclosureButton>
      {disclosure.open ? (
        <div className="px-3 pb-3" data-chat-detail>
          <OperationDetail
            environmentId={ctx.activeThreadEnvironmentId}
            operation={operation}
            threadRef={ctx.threadRef}
          />
        </div>
      ) : null}
    </Bubble>
  );
}

/**
 * The pages it checked in the browser, as the pictures it took: each take in
 * its device's shape, opening the picture viewer; the stage with every take
 * opens under them.
 */
function ChecksBubble({ strip }: { readonly strip: BrowserStripModel }) {
  const ctx = use(TimelineRowCtx);
  const disclosure = useDisclosure();
  const latest = strip.checks.at(-1)!;
  const words =
    strip.views === 1 ? `Checked ${browserCheckCaption(latest)}` : `Checked ${strip.views} pages`;
  const verdict =
    strip.failures > 0
      ? strip.failures === 1
        ? "1 check failed"
        : `${strip.failures} checks failed`
      : strip.checks.length === 1
        ? "passed"
        : `${strip.checks.length} checks passed`;
  const startedMs = Date.parse(strip.checks[0]!.anchorAt);
  const endedMs = Date.parse(latest.settledAt ?? latest.anchorAt);
  const tookMs = endedMs - startedMs;
  const failed = strip.failures > 0;
  return (
    <Bubble kind="checks" tone={failed ? "failed" : "tool"} wide={disclosure.open}>
      <DisclosureButton
        className="px-3 py-1.5"
        label={`${words}, ${verdict}. ${disclosure.open ? "Hide" : "Show"} the checks`}
        onToggle={disclosure.toggle}
        open={disclosure.open}
      >
        <Headline
          opens
          time={Number.isFinite(tookMs) && tookMs >= 1000 ? formatWorkDuration(tookMs) : null}
          timeTone={failed ? "failed" : "muted"}
        >
          <span className="text-line">
            <span className="text-foreground/90">{words}</span>
            <span className={failed ? "text-status-failed-text" : "text-muted-foreground"}>
              {` · ${verdict}`}
            </span>
          </span>
        </Headline>
      </DisclosureButton>
      {disclosure.open || !strip.checks.some((check) => check.screenshot) ? null : (
        <div className="px-3 pb-2">
          <BrowserTakes onOpenImage={ctx.onImageExpand} takes={strip.checks} />
        </div>
      )}
      {disclosure.open ? (
        <div className="px-3 pb-3" data-chat-detail>
          <BrowserStrip
            bare
            environmentId={ctx.activeThreadEnvironmentId}
            onOpenImage={ctx.onImageExpand}
            strip={strip}
            threadRef={ctx.threadRef}
          />
        </div>
      ) : null}
    </Bubble>
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
      className="px-3 py-1"
    >
      <span className="text-line">
        <span className="font-medium">{incident.hostname}</span>
        <span className="text-muted-foreground">{` ${incident.phases.join(" → ")}`}</span>
      </span>
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
    <span className="flex min-w-0 items-baseline gap-3 text-line">
      <span
        className={cn(
          "min-w-0 flex-1 truncate",
          agent.status === "failed" ? "text-status-failed-text" : "text-foreground/90",
        )}
      >
        {agent.title}
      </span>
      <span className="shrink-0 text-muted-foreground text-xs tabular-nums">{state}</span>
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
            <span className="truncate text-muted-foreground text-xs">{firstLine}</span>
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
    <Bubble kind="helpers" tone={failed ? "failed" : "tool"} wide={disclosure.open}>
      <DisclosureButton
        className="px-3 py-1.5"
        label={`${words}. ${disclosure.open ? "Hide" : "Show"} them`}
        onToggle={disclosure.toggle}
        open={disclosure.open}
      >
        <Headline
          opens
          timeTone={summary.live ? "busy" : "muted"}
          time={summary.live ? "Working" : null}
        >
          <span className="text-line">
            <span className="text-foreground/90">{words}</span>
            {what ? <span className="text-muted-foreground">{` · ${what}`}</span> : null}
          </span>
        </Headline>
      </DisclosureButton>
      {disclosure.open ? (
        <div className="grid gap-2 px-1.5 pb-2" data-chat-detail>
          <ul className="grid gap-0.5">
            {agents.map((agent) => (
              <HelperRow key={agent.id} agent={agent} />
            ))}
          </ul>
          <button
            className="cursor-pointer justify-self-start rounded px-1.5 text-info-foreground text-xs hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
            onClick={ctx.onOpenAgents}
            type="button"
          >
            Open the helpers panel
          </button>
        </div>
      ) : null}
    </Bubble>
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
    <Headline opens={reported}>
      <span className="text-line">
        <span className={failed ? "text-status-failed-text" : "text-foreground/90"}>{words}</span>
        <span className="text-muted-foreground">{` · ${where}`}</span>
      </span>
    </Headline>
  );
  return (
    <Bubble kind="task" tone={failed ? "failed" : "tool"} wide={disclosure.open}>
      {reported ? (
        <DisclosureButton
          className="px-3 py-1"
          label={`${words}. ${disclosure.open ? "Hide" : "Show"} what it reported`}
          onToggle={disclosure.toggle}
          open={disclosure.open}
        >
          {line}
        </DisclosureButton>
      ) : (
        <div className="px-3 py-1">{line}</div>
      )}
      {disclosure.open ? (
        <div className="px-3 pb-3" data-chat-detail>
          <TaskReport entry={entry} />
        </div>
      ) : null}
    </Bubble>
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
    <Bubble kind="plan" tone="tool" wide={disclosure.open}>
      <DisclosureButton
        className="px-3 py-1"
        label={`To-do list, ${done} of ${steps.length} done. ${disclosure.open ? "Hide" : "Show"} it`}
        onToggle={disclosure.toggle}
        open={disclosure.open}
      >
        <Headline opens time={`${done}/${steps.length}`}>
          <span className="text-line">
            <span className="text-foreground/90">To-do list</span>
            {current !== null ? (
              <span className="text-muted-foreground">{` · ${current}`}</span>
            ) : null}
          </span>
        </Headline>
      </DisclosureButton>
      {disclosure.open ? (
        <div className="px-2.5 pb-2" data-chat-detail>
          <PlanSteps steps={steps} />
        </div>
      ) : null}
    </Bubble>
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
      <span className="text-line text-status-failed-text">{label}</span>
    </Headline>
  );
  return (
    <Bubble kind="error" tone="failed" wide={disclosure.open}>
      {more === null ? (
        <div className="px-3 py-1">{line}</div>
      ) : (
        <DisclosureButton
          className="px-3 py-1"
          label={`${label}. ${disclosure.open ? "Hide" : "Show"} the whole error`}
          onToggle={disclosure.toggle}
          open={disclosure.open}
        >
          {line}
        </DisclosureButton>
      )}
      {disclosure.open && more !== null ? (
        <div className="px-3 pb-3" data-chat-detail>
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
    <div className="flex min-w-0 items-center gap-3 py-1.5 text-xs" data-chat-kind="event">
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

/** It composes what comes next: dots in its thinking's hairline, or in its speech's fill. */
function TypingBubble({
  voice,
  said,
}: {
  readonly voice: "thought" | "speech";
  readonly said: string;
}) {
  return (
    <Bubble kind={`typing:${voice}`} tone={voice} className="flex h-7 items-center px-3.5">
      <span aria-label={said} role="status">
        <TypingDots />
      </span>
    </Bubble>
  );
}

// ---------------------------------------------------------------------------
// The chat
// ---------------------------------------------------------------------------

type RecordRow = Extract<MessagesTimelineRow, { kind: "record" }>;

/** A line of the chat: its key, stable from its first sight, and whether it stands on the spine. */
interface ChatLine {
  readonly key: string;
  readonly bubble: ReactNode;
  /** A caption across the chat, off the spine. */
  readonly across?: boolean;
  /** What the Mate is on now: the face stands beside it. */
  readonly now?: "working" | "needs";
}

/** A record's item as its line of the chat. */
function itemLine(item: RecordItem): ChatLine | null {
  switch (item.kind) {
    case "step":
      return { key: item.key, bubble: <StepBubble step={item.step} /> };
    case "call":
      return { key: item.key, bubble: <StepBubble step={stepOf(item.entry, undefined, false)} /> };
    case "thought":
      return { key: item.key, bubble: <ThoughtBubble messages={item.messages} /> };
    case "note":
      return { key: item.key, bubble: <NoteBubble message={item.message} /> };
    case "person":
      // Where the person spoke into the run the card breaks: their words
      // stand on the page, never in the chat.
      return null;
    case "operation":
      return { key: item.key, bubble: <OperationBubble operation={item.operation} /> };
    case "helpers":
      return { key: item.key, bubble: <HelpersBubble entry={item.entry} /> };
    case "task":
      return { key: item.key, bubble: <TaskBubble entry={item.entry} /> };
    case "plan":
      return { key: item.key, bubble: <PlanBubble plan={item.plan} /> };
    case "strip":
      return { key: item.key, bubble: <ChecksBubble strip={item.strip} /> };
    case "incident":
      return { key: item.key, bubble: <IncidentBubble incident={item.incident} /> };
    case "event":
      return { key: item.key, bubble: <EventCaption event={item.event} />, across: true };
    case "error":
      return { key: item.key, bubble: <ErrorBubble entry={item.entry} /> };
  }
}

/**
 * What the Mate is on now, as the newest line: the thought it is thinking,
 * keyed as the record will key it so it stays the same bubble once it ends;
 * the call it is making, the same way; its words on their way; the answer it
 * waits on; or the dots while it composes.
 */
function nowLine(now: TurnHeaderActivity | null, compacting: boolean): ChatLine {
  if (compacting) {
    return {
      key: "now:compacting",
      now: "working",
      bubble: (
        <Bubble kind="compacting" tone="thought" className="px-3 py-1.5">
          <span className="flex items-center gap-2.5 text-line not-italic">
            Condensing the context
            <TypingDots className="scale-75" />
          </span>
        </Bubble>
      ),
    };
  }
  if (now === null) {
    return {
      key: "now:thinking",
      now: "working",
      bubble: <TypingBubble said="Thinking" voice="thought" />,
    };
  }
  switch (now.kind) {
    case "waiting":
      return {
        key: "now:waiting",
        now: "needs",
        bubble: (
          <Bubble kind="waiting" tone="attention" className="px-3 py-1.5">
            <span className="text-line" role="status">
              Waiting for your answer
            </span>
          </Bubble>
        ),
      };
    case "writing":
      return {
        key: "now:writing",
        now: "working",
        bubble: <TypingBubble said="Writing" voice="speech" />,
      };
    case "thinking":
      return now.key === null || now.messages.length === 0
        ? {
            key: "now:thinking",
            now: "working",
            bubble: <TypingBubble said="Thinking" voice="thought" />,
          }
        : {
            key: now.key,
            now: "working",
            bubble: <ThoughtBubble messages={now.messages} newest />,
          };
    case "step":
      return {
        key: `step:${now.step.key}`,
        now: "working",
        bubble: <StepBubble newest step={now.step} />,
      };
    case "operation":
      return {
        key: `operation:${now.operation.key}`,
        now: "working",
        bubble: <OperationBubble newest operation={now.operation} />,
      };
  }
}

/** A line of the chat: the face's column, then its bubble — or a caption across both. */
function ChatRow({
  first,
  face,
  across,
  children,
}: {
  readonly first: boolean;
  readonly face: ReactNode;
  readonly across: boolean;
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
    <li className="flex min-w-0 items-end gap-2.5" data-chat-row>
      <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center">
        {face}
      </span>
      {/* Only what arrives while the person watches rises in; the face never moves. */}
      <div
        className={cn(
          "flex min-w-0 flex-1",
          arrived && "origin-bottom-left animate-bubble-in motion-reduce:animate-none",
        )}
      >
        <BubbleFirstContext value={first}>{children}</BubbleFirstContext>
      </div>
    </li>
  );
}

/**
 * A run's chat in its card: every bubble in one scroll, and, while the Mate
 * works, its face beside what it is on at the end — the present shown once.
 */
export function RunChat({ row }: { readonly row: RecordRow }) {
  const ctx = use(TimelineRowCtx);
  const { isCompacting } = use(TimelineRowActivityCtx);
  const lines: ChatLine[] = row.items.flatMap((item) => {
    const line = itemLine(item);
    return line === null ? [] : [line];
  });
  if (row.live && !row.answering) lines.push(nowLine(row.now, isCompacting));
  const firstOnSpine = lines.findIndex((line) => line.across !== true);
  return (
    <ChatScroll label={`${ctx.speaker.name}'s work`} live={row.live}>
      {lines.map((line, index) => (
        <ChatRow
          key={line.key}
          across={line.across === true}
          face={
            line.now !== undefined ? (
              <MateFace size="md" state={line.now} tint={ctx.speaker.tint} />
            ) : null
          }
          first={index === firstOnSpine}
        >
          {line.bubble}
        </ChatRow>
      ))}
    </ChatScroll>
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
    <span className="flex min-w-0 items-center gap-2.5 text-line">
      <span aria-hidden="true" className="flex w-4 shrink-0 justify-center">
        <span
          className={cn(
            "size-1.5 rounded-full",
            failed ? "bg-status-failed" : "bg-muted-foreground/35",
          )}
        />
      </span>
      <span
        className={cn(
          "min-w-0 truncate",
          failed ? "text-status-failed-text" : "text-foreground/85",
        )}
      >
        {words}
      </span>
      <span className="shrink-0 text-muted-foreground text-xs">{where}</span>
      {reported.length > 0 ? (
        <ChevronDownIcon
          aria-hidden="true"
          className="size-3 shrink-0 text-muted-foreground/70 opacity-0 transition-[opacity,rotate] duration-150 group-hover/disclose:opacity-100 group-aria-expanded/disclose:rotate-180 group-aria-expanded/disclose:opacity-100"
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
        <ul className="grid min-w-0 gap-3 ps-6.5" data-chat-detail>
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
