/**
 * The Mate at work: one panel at the live stretch's tail, right under its
 * line — what is happening now, and nothing that runs pops out anywhere else.
 *
 * Its face speaks a stream of bubbles: the newest in full, popping in beside
 * it; the ones before it pushed up and away, fading out through the top. A
 * step that failed on the way streams as a red bubble where it failed, and
 * turns amber once a later attempt came back. Under the stream, a status bar
 * for each thing that runs — a deploy stepping through its pipeline in the
 * Zerops GUI's words, a service in trouble, the task list, the helpers, the
 * background tasks — each opening its detail in place. While the Mate checks
 * pages, the browser slides out from under the panel.
 *
 * It is the conversation's bottom, so it may change shape; while live it only
 * grows — a click that closes a detail is the one way it shrinks — so a
 * shorter bubble never pulls the conversation down. Settling turns it into
 * the turn's report, made of the same parts; work that outlives the turn
 * keeps it at the bottom, smaller, until the work ends.
 */
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import type { PipelineSpokenState } from "@t3tools/client-runtime/zerops/activity/pipelineReadout";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import type { ServiceStatusToneId } from "@t3tools/shared/brand";
import {
  ActivityIcon,
  ArrowDownIcon,
  BotIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleDotIcon,
  CircleIcon,
  LayersIcon,
  ListTodoIcon,
  RocketIcon,
  RotateCcwIcon,
  XIcon,
} from "lucide-react";
import {
  createContext,
  use,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { cn } from "~/lib/utils";
import { useOperationCard } from "../../zerops/activity/useOperationCard";
import { Button } from "../ui/button";
import { MateFace } from "../zerops/primitives";
import { ZeropsOperationCard } from "../zerops/ZeropsOperationCard";
import { formatWorkDuration, type IncidentModel } from "./conversation.logic";
import { StatusBar, StatusDisc, type BarTone, type DiscTone } from "./ConversationPills";
import type { DockBackgroundTask, DockModel } from "./conversationDock.logic";
import type { WorkingFailure } from "./MessagesTimeline.logic";
import { ElapsedSince, type ConversationSpeaker } from "./ConversationRows";

/**
 * A bubble in the Mate's stream: what it thinks, its words, rendered; a step
 * that failed on the way; or the question it asked and waits on.
 */
export type WorkingBubble =
  | { readonly kind: "thought"; readonly key: string; readonly body: ReactNode }
  | { readonly kind: "note"; readonly key: string; readonly body: ReactNode }
  | { readonly kind: "failure"; readonly key: string; readonly failure: WorkingFailure }
  /** Its question, rendered, as its words are. */
  | { readonly kind: "question"; readonly key: string; readonly body: ReactNode };

/**
 * What the Mate's hands are on right now, under its newest words: thinking,
 * a few words for the call it is making, or the person's answer it waits on.
 */
export type WorkingActivity =
  | { readonly kind: "thinking" }
  | { readonly kind: "doing"; readonly words: string }
  | { readonly kind: "waiting" };

// ---------------------------------------------------------------------------
// Arriving live
// ---------------------------------------------------------------------------

/** Whether the panel has been drawn once: set after its first commit. */
const PanelShownContext = createContext<{ readonly current: boolean }>({ current: true });

/**
 * Whether something drawn now arrived while the person watched: what a
 * conversation opens onto is simply there, and only what arrives after the
 * panel was first drawn pops in. A panel that replayed every entrance when a
 * thread opened grew after the conversation had already scrolled to its end
 * (the owner, 2026-09-26: "retriggering animation of existing items" — "when
 * opening the page it doesn't properly scroll to the very bottom").
 */
function useArrivedLive(): boolean {
  const shown = use(PanelShownContext);
  const [arrived] = useState(() => shown.current);
  return arrived;
}

// ---------------------------------------------------------------------------
// The stream
// ---------------------------------------------------------------------------

/** Room above the newest bubble for the one before it, drifting away through the fade. */
const PEEK_PX = 56;

/** How a bubble recedes as newer ones push it up: dimmer and a little smaller each step. */
const AGE_CLASS = [
  "",
  "scale-98 opacity-55",
  "scale-96 opacity-30",
  "scale-94 opacity-15",
  "scale-92 opacity-10",
];

function TypingDots({ className }: { readonly className?: string }) {
  return (
    <span aria-hidden="true" className={cn("flex items-center gap-1", className)}>
      <span className="size-1.5 animate-typing-first rounded-full bg-muted-foreground motion-reduce:animate-none" />
      <span className="size-1.5 animate-typing-second rounded-full bg-muted-foreground motion-reduce:animate-none" />
      <span className="size-1.5 animate-typing-third rounded-full bg-muted-foreground motion-reduce:animate-none" />
    </span>
  );
}

/**
 * The Mate's thinking and its words as bubbles — the panel's and the opened
 * log's alike, so what it thought and said reads the same live and after. A
 * thought is the same bubble, lighter, in the muted ink.
 */
export const MATE_BUBBLE_CLASS: Record<"thought" | "note", string> = {
  thought:
    "w-fit max-w-full origin-bottom-left rounded-2xl rounded-es-md bg-muted/45 px-3.5 py-2 text-muted-foreground",
  note: "w-fit max-w-full origin-bottom-left rounded-2xl rounded-es-md bg-muted px-3.5 py-2 text-foreground",
};

function StreamBubble({ bubble }: { readonly bubble: WorkingBubble }) {
  const pop = useArrivedLive() ? "animate-bubble-pop motion-reduce:animate-none" : null;
  if (bubble.kind === "thought" || bubble.kind === "note" || bubble.kind === "question") {
    return (
      <div
        className={cn(MATE_BUBBLE_CLASS[bubble.kind === "thought" ? "thought" : "note"], pop)}
        data-stream-bubble={bubble.kind}
      >
        {bubble.body}
      </div>
    );
  }
  const { failure } = bubble;
  const recovered = failure.recovered !== null;
  return (
    <div
      className={cn(
        "inline-flex max-w-full origin-bottom-left items-center gap-1.5 rounded-2xl rounded-es-md border px-3 py-1.5 text-line transition-colors duration-500",
        pop,
        recovered
          ? "border-status-attention/30 bg-status-attention-surface text-status-attention-text"
          : "border-status-failed/30 bg-status-failed-surface text-status-failed-text",
      )}
      data-stream-bubble={recovered ? "recovered" : "failed"}
    >
      {recovered ? (
        <RotateCcwIcon aria-hidden="true" className="size-3.5 shrink-0" />
      ) : (
        <XIcon aria-hidden="true" className="size-3.5 shrink-0" />
      )}
      {failure.subject ? <span className="shrink-0 font-medium">{failure.subject}</span> : null}
      <span className="min-w-0 truncate">{failure.words}</span>
      {recovered ? <span className="shrink-0">· {failure.recovered}</span> : null}
    </div>
  );
}

/**
 * What the Mate is on, under its newest words — never a bubble of its own
 * words: the dots while it thinks, a quiet outline naming the call it is
 * making, the amber of a question that waits on the person. One height for
 * all three, so a change of what it does never moves the bubbles above.
 */
function StreamActivity({ activity }: { readonly activity: WorkingActivity }) {
  if (activity.kind === "thinking") {
    return (
      <div
        aria-label="Thinking"
        className="flex h-8 w-fit items-center rounded-2xl rounded-es-md bg-muted px-3.5"
        data-stream-activity="thinking"
        role="img"
      >
        <TypingDots />
      </div>
    );
  }
  if (activity.kind === "waiting") {
    return (
      <div
        className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-2xl rounded-es-md bg-status-attention-surface px-3 text-line text-status-attention-text"
        data-stream-activity="waiting"
      >
        <ArrowDownIcon aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="min-w-0 truncate">Waiting for your answer</span>
      </div>
    );
  }
  return (
    <div
      className="inline-flex h-8 max-w-full items-center gap-2 rounded-2xl rounded-es-md border border-border/70 border-dashed px-3 text-line text-muted-foreground"
      data-stream-activity="doing"
    >
      <TypingDots className="shrink-0 scale-75" />
      <span className="min-w-0 truncate">{activity.words}</span>
    </div>
  );
}

/** A place in the stream: it opens its room when what it holds arrived live. */
function StreamRoom({
  age,
  children,
}: {
  readonly age: number | "activity";
  readonly children: ReactNode;
}) {
  const arrived = useArrivedLive();
  return (
    <div
      className={cn("grid", arrived && "animate-room-in motion-reduce:animate-none")}
      data-stream-age={age}
    >
      <div className="min-h-0">{children}</div>
    </div>
  );
}

/** The face beside the newest words: it nods when words arrive live. */
function NoddingFace({ tint }: { readonly tint: ConversationSpeaker["tint"] }) {
  const nod = useArrivedLive();
  return (
    <span
      aria-hidden="true"
      className={cn(
        "mb-0.5 shrink-0 origin-bottom",
        nod && "animate-face-nod motion-reduce:animate-none",
      )}
    >
      <MateFace size="md" state="working" tint={tint} />
    </span>
  );
}

/**
 * The face and what it says: a window on the stream, anchored at its
 * bottom. A new bubble opens its room there — pushing the ones before it up
 * and out through the fading top — and pops in beside the face, which nods;
 * what the Mate is on sits under the newest. The window keeps the newest
 * bubble in full with room for the one before it to peek, and only ever
 * grows, so a short bubble after a long one never pulls the conversation
 * down. Everything the stretch said stays in it: scrolled back, the stream
 * holds still and every bubble reads at full strength; scrolled to the
 * bottom again, it follows the newest.
 */
function Stream({
  speaker,
  bubbles,
  activity,
  answering,
}: {
  readonly speaker: ConversationSpeaker;
  readonly bubbles: ReadonlyArray<WorkingBubble>;
  readonly activity: WorkingActivity | null;
  /** Its answer streams under the card: nothing of its own to say here. */
  readonly answering: boolean;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [newest, setNewest] = useState<HTMLDivElement | null>(null);
  const [trailing, setTrailing] = useState<HTMLDivElement | null>(null);
  const tallestRef = useRef(0);
  const followingRef = useRef(true);
  const [reading, setReading] = useState(false);
  const newestKey = bubbles.at(-1)?.key ?? "none";
  const older = bubbles.length > 1;
  // Nothing said and nothing named yet: the Mate is composing.
  const shown: WorkingActivity | null = answering
    ? null
    : (activity ?? (bubbles.length === 0 ? { kind: "thinking" } : null));

  const grownForKeyRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller === null) return;
    // Measured at the bubbles' own boxes, never the rooms opening around
    // them: the window takes its final height at once and eases to it, and
    // the conversation glides up with it — for a bubble arriving. Words
    // already there settling into their lines take their height at once, so
    // a conversation opened onto the Mate at work is at its end when it opens.
    const measure = () => {
      const wanted =
        Math.ceil(
          (newest?.getBoundingClientRect().height ?? 0) +
            (trailing?.getBoundingClientRect().height ?? 0),
        ) + (older ? PEEK_PX : 0);
      if (wanted <= tallestRef.current) return;
      tallestRef.current = wanted;
      const arriving = grownForKeyRef.current !== null && grownForKeyRef.current !== newestKey;
      grownForKeyRef.current = newestKey;
      scroller.style.transitionDuration = arriving ? "" : "0s";
      scroller.style.height = `${wanted}px`;
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (newest !== null) observer.observe(newest);
    if (trailing !== null) observer.observe(trailing);
    return () => observer.disconnect();
  }, [newest, trailing, older, newestKey]);

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const content = contentRef.current;
    if (scroller === null || content === null) return;
    // Following the newest: held at the bottom as words arrive and the
    // window grows, unless the person scrolled back to read.
    const pin = () => {
      if (followingRef.current) scroller.scrollTop = scroller.scrollHeight;
    };
    pin();
    const observer = new ResizeObserver(pin);
    observer.observe(content);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, []);

  // Only the person leaves the bottom: a wheel, a touch or a key. The window
  // easing to a new height and the rooms opening move the scroll position
  // too, and those must never read as reading back.
  const gestureAtRef = useRef(Number.NEGATIVE_INFINITY);
  const markGesture = () => {
    gestureAtRef.current = performance.now();
  };
  const onScroll = () => {
    const scroller = scrollerRef.current;
    if (scroller === null) return;
    const atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 2;
    if (atBottom) {
      followingRef.current = true;
      setReading(false);
    } else if (performance.now() - gestureAtRef.current < 400) {
      followingRef.current = false;
      setReading(true);
    } else if (followingRef.current) {
      scroller.scrollTop = scroller.scrollHeight;
    }
  };

  return (
    <div className="flex min-w-0 items-end gap-2.5" data-working-stream>
      <NoddingFace key={newestKey} tint={speaker.tint} />
      <div
        ref={scrollerRef}
        aria-label={`What ${speaker.name} said while working`}
        aria-live="polite"
        className={cn(
          "min-w-0 flex-1 overflow-y-auto scrollbar-none transition-[height] duration-500 ease-out motion-reduce:transition-none",
          older && !reading && "stream-fade",
        )}
        data-stream-reading={reading ? "true" : undefined}
        onKeyDown={markGesture}
        onScroll={onScroll}
        onTouchMove={markGesture}
        onWheel={markGesture}
        role="log"
        tabIndex={older ? 0 : -1}
      >
        <div ref={contentRef} className="flex min-h-full flex-col justify-end">
          {bubbles.map((bubble, index) => {
            const age = bubbles.length - 1 - index;
            return (
              <StreamRoom key={bubble.key} age={age}>
                <div
                  ref={age === 0 ? setNewest : undefined}
                  className={cn(
                    "origin-bottom-left pt-2 transition duration-500",
                    !reading && AGE_CLASS[Math.min(age, AGE_CLASS.length - 1)],
                  )}
                >
                  <StreamBubble bubble={bubble} />
                </div>
              </StreamRoom>
            );
          })}
          {shown !== null ? (
            <StreamRoom key="activity" age="activity">
              <div ref={setTrailing} className="pt-2">
                <StreamActivity activity={shown} />
              </div>
            </StreamRoom>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The status bars
// ---------------------------------------------------------------------------

const PIPELINE_BAR: Record<PipelineSpokenState, BarTone> = {
  finished: "done",
  running: "running",
  activating: "running",
  failed: "failed",
  waiting: "waiting",
  cancelled: "waiting",
};

const STEP_BAR: Record<string, BarTone> = {
  done: "done",
  running: "running",
  failed: "failed",
  queued: "waiting",
};

const HELPER_BAR: Record<ServiceStatusToneId, BarTone> = {
  ok: "done",
  busy: "running",
  attention: "attention",
  failed: "failed",
  off: "waiting",
};

const INCIDENT_BAR: Record<IncidentModel["tone"], BarTone> = {
  attention: "attention",
  ok: "done",
  failed: "failed",
};

const TONE_DOT: Record<ServiceStatusToneId, string> = {
  ok: "bg-status-ok",
  busy: "bg-status-busy",
  attention: "bg-status-attention",
  failed: "bg-status-failed",
  off: "bg-status-off",
};

/**
 * One status bar: its mark in a disc of its state's tone, its name, the bar,
 * where it is now in words, and a figure — a time, a count. Given
 * `onToggle`, a click opens its detail under it.
 */
function Instrument({
  icon,
  tone,
  subject,
  bar,
  words,
  figure = null,
  failed = false,
  label,
  open = false,
  onToggle = null,
}: {
  readonly icon: ReactNode;
  readonly tone: DiscTone;
  readonly subject: string;
  readonly bar: ReadonlyArray<{ readonly key: string; readonly tone: BarTone }>;
  readonly words: ReactNode;
  readonly figure?: ReactNode;
  readonly failed?: boolean;
  readonly label: string;
  readonly open?: boolean;
  readonly onToggle?: (() => void) | null;
}) {
  const body = (
    <>
      <StatusDisc tone={tone}>{icon}</StatusDisc>
      <span className="w-28 shrink-0 truncate text-start font-medium text-foreground">
        {subject}
      </span>
      <StatusBar className="w-14 shrink-0 @md/panel:w-32" segments={bar} />
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-start",
          failed ? "text-status-failed-text" : "text-muted-foreground",
        )}
      >
        {words}
      </span>
      {figure !== null ? (
        <span className="shrink-0 text-muted-foreground text-xs tabular-nums">{figure}</span>
      ) : null}
      {onToggle !== null ? (
        <ChevronDownIcon
          aria-hidden="true"
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      ) : null}
    </>
  );
  const className = "flex h-9 w-full min-w-0 items-center gap-3 rounded-xl px-2 text-line";
  if (onToggle === null) {
    return (
      <div aria-label={label} className={className} data-instrument={tone} role="group">
        {body}
      </div>
    );
  }
  return (
    <button
      aria-expanded={open}
      aria-label={label}
      className={cn(
        className,
        "cursor-pointer transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-inset",
        open && "bg-accent/40",
      )}
      data-instrument={tone}
      data-scroll-anchor-ignore
      onClick={onToggle}
      type="button"
    >
      {body}
    </button>
  );
}

/**
 * A deploy's status bar: a segment per step of its pipeline, the step running
 * now in the Zerops GUI's own sentence, and how long. Open, the full pipeline
 * with its build log.
 */
function DeployInstrument({
  operation,
  environmentId,
  open,
  onToggle,
}: {
  readonly operation: ZeropsOperation;
  readonly environmentId: EnvironmentId | null;
  readonly open: boolean;
  readonly onToggle: () => void;
}) {
  const regions = useOperationCard(operation, environmentId);
  const pipeline = regions.observed?.pipeline;
  const steps = regions.observed?.steps ?? operation.steps;
  const running = operation.phase === "running";
  const failed = operation.phase === "failed";
  const pipelineStep =
    pipeline === undefined
      ? undefined
      : (pipeline.steps.find((step) => step.id === pipeline.currentStepId) ??
        pipeline.steps.at(-1));
  const fallbackStep =
    steps.find((step) => step.state === "running") ??
    steps.find((step) => step.state === "failed") ??
    steps.findLast((step) => step.state === "done");
  // A service of a batch has one step, named by the service: its state is
  // the words, never its name a second time.
  const words = !running
    ? operation.statusWord
    : pipeline?.calculating
      ? "Calculating steps"
      : pipelineStep !== undefined
        ? pipelineStep.sentence
        : fallbackStep !== undefined && fallbackStep.label !== operation.subject
          ? fallbackStep.label
          : operation.statusWord;
  const settledMs =
    operation.settledAt === undefined
      ? null
      : Date.parse(operation.settledAt) - Date.parse(operation.anchorAt);
  const live =
    pipeline !== undefined && pipeline.steps.length > 0
      ? pipeline.steps.map((step) => ({ key: step.id, tone: PIPELINE_BAR[step.state] }))
      : steps.length > 0
        ? steps.map((step) => ({ key: step.id, tone: STEP_BAR[step.state] ?? "waiting" }))
        : [{ key: "whole", tone: "running" as const }];
  // Settled, the bar says how it ended even when the feed has not caught up:
  // a deploy that finished is whole, one that failed stops where it failed.
  const bar = live.map((segment) => ({
    key: segment.key,
    tone: running
      ? segment.tone
      : failed
        ? segment.tone === "running"
          ? ("failed" as const)
          : segment.tone
        : ("done" as const),
  }));
  return (
    <Instrument
      bar={bar}
      failed={failed}
      figure={
        running ? (
          <ElapsedSince since={operation.anchorAt} />
        ) : settledMs !== null && Number.isFinite(settledMs) ? (
          formatWorkDuration(settledMs)
        ) : null
      }
      icon={
        failed ? (
          <XIcon aria-hidden="true" className="size-3.5" />
        ) : operation.phase === "done" ? (
          <CheckIcon aria-hidden="true" className="size-3.5" />
        ) : (
          <RocketIcon aria-hidden="true" className="size-3.5" />
        )
      }
      label={`${operation.subject}: ${words}. ${open ? "Hide" : "Show"} the pipeline`}
      onToggle={onToggle}
      open={open}
      subject={operation.subject}
      tone={failed ? "failed" : operation.phase === "done" ? "ok" : "busy"}
      words={words}
    />
  );
}

function OperationDetail({
  operation,
  environmentId,
  threadRef,
}: {
  readonly operation: ZeropsOperation;
  readonly environmentId: EnvironmentId | null;
  readonly threadRef: ScopedThreadRef | null;
}) {
  const regions = useOperationCard(operation, environmentId);
  return <ZeropsOperationCard operation={operation} threadRef={threadRef} {...regions} />;
}

/** A step's key: its words, and how many times the same words came before it. */
function keyedSteps<T extends { readonly step: string }>(steps: ReadonlyArray<T>) {
  const seen = new Map<string, number>();
  return steps.map((step) => {
    const occurrence = seen.get(step.step) ?? 0;
    seen.set(step.step, occurrence + 1);
    return { key: `${step.step}:${occurrence}`, step };
  });
}

/** A status bar arriving: it opens its room in the panel, once, when it arrived live. */
function Arriving({ children }: { readonly children: ReactNode }) {
  const arrived = useArrivedLive();
  return (
    <li className={cn("grid", arrived && "animate-room-in motion-reduce:animate-none")}>
      <div className="min-h-0 overflow-hidden">{children}</div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

/**
 * The reserved height of the Mate at work: it follows the content up and
 * never back down while live, so a finished bar leaves room at the very
 * bottom instead of pulling the conversation down. `remeasure` starts it
 * afresh from the next measurement — for a click that opens or closes a
 * detail: the person moved it.
 */
function useGrowOnlyHeight() {
  const contentRef = useRef<HTMLDivElement>(null);
  const tallestRef = useRef(0);
  const [minHeight, setMinHeight] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const content = contentRef.current;
    if (content === null) return;
    const measure = () => {
      const height = content.getBoundingClientRect().height;
      if (height > tallestRef.current) {
        tallestRef.current = height;
        setMinHeight(height);
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);
  const remeasure = () => {
    tallestRef.current = 0;
  };
  return { contentRef, minHeight, remeasure };
}

const TASK_BAR: Record<DockBackgroundTask["state"], BarTone> = {
  running: "running",
  done: "done",
  failed: "failed",
  stopped: "waiting",
};

const TASK_STATE: Record<
  DockBackgroundTask["state"],
  { readonly tone: ServiceStatusToneId; readonly word: string }
> = {
  running: { tone: "busy", word: "Running" },
  done: { tone: "ok", word: "Done" },
  failed: { tone: "failed", word: "Failed" },
  stopped: { tone: "off", word: "Stopped" },
};

function spanOf(startedAt: string, endedAt: string | null): ReactNode {
  return endedAt === null ? (
    <ElapsedSince since={startedAt} />
  ) : (
    formatWorkDuration(Date.parse(endedAt) - Date.parse(startedAt))
  );
}

/**
 * A status bar for each thing that runs — the deploys, a service in trouble,
 * the task list, the helpers, the background tasks — each opening its detail
 * under it.
 */
function Instruments({
  dock,
  incidents,
  environmentId,
  threadRef,
  onOpenAgents,
  open,
  onToggle,
}: {
  readonly dock: DockModel | null;
  readonly incidents: ReadonlyArray<IncidentModel>;
  readonly environmentId: EnvironmentId | null;
  readonly threadRef: ScopedThreadRef | null;
  readonly onOpenAgents: () => void;
  readonly open: string | null;
  readonly onToggle: (key: string) => void;
}) {
  const operations = dock?.operations ?? [];
  const helpers = dock?.helpers ?? null;
  const tasks = dock?.tasks ?? null;
  const background = dock?.background ?? null;
  if (
    operations.length === 0 &&
    incidents.length === 0 &&
    tasks === null &&
    helpers === null &&
    background === null
  ) {
    return null;
  }
  const runningTask = background?.tasks.findLast((task) => task.state === "running");
  return (
    <ul className="-mx-4 grid border-border/60 border-t px-2 pt-2" data-working-instruments>
      {operations.map((operation) => (
        <Arriving key={operation.key}>
          <DeployInstrument
            environmentId={environmentId}
            onToggle={() => onToggle(operation.key)}
            open={open === operation.key}
            operation={operation}
          />
          {open === operation.key ? (
            <div className="px-2 pt-1 pb-2" data-working-detail="operation">
              <OperationDetail
                environmentId={environmentId}
                operation={operation}
                threadRef={threadRef}
              />
            </div>
          ) : null}
        </Arriving>
      ))}
      {incidents.map((incident) => (
        <Arriving key={incident.key}>
          <Instrument
            bar={[{ key: "whole", tone: INCIDENT_BAR[incident.tone] }]}
            failed={incident.tone === "failed"}
            icon={<ActivityIcon aria-hidden="true" className="size-3.5" />}
            label={`${incident.hostname}: ${incident.phases.join(", ")}`}
            subject={incident.hostname}
            tone={incident.tone}
            words={incident.phases.join(" · ")}
          />
        </Arriving>
      ))}
      {tasks !== null ? (
        <Arriving>
          <Instrument
            bar={keyedSteps(tasks.steps).map(({ key, step }) => ({
              key,
              tone:
                step.status === "completed"
                  ? "done"
                  : step.status === "inProgress"
                    ? "running"
                    : "waiting",
            }))}
            figure={`${tasks.done}/${tasks.steps.length}`}
            icon={<ListTodoIcon aria-hidden="true" className="size-3.5" />}
            label={`Tasks: ${tasks.done} of ${tasks.steps.length} done. ${open === "tasks" ? "Hide" : "Show"} the list`}
            onToggle={() => onToggle("tasks")}
            open={open === "tasks"}
            subject="Tasks"
            tone={tasks.done === tasks.steps.length ? "ok" : "busy"}
            words={tasks.current ?? "All done"}
          />
          {open === "tasks" ? (
            <ol className="grid gap-px px-2 pt-1 pb-2" data-working-detail="tasks">
              {keyedSteps(tasks.steps).map(({ key, step }) => {
                const Icon =
                  step.status === "completed"
                    ? CheckIcon
                    : step.status === "inProgress"
                      ? CircleDotIcon
                      : CircleIcon;
                return (
                  <li key={key} className="flex min-h-6 min-w-0 items-start gap-2 ps-10 text-line">
                    <Icon
                      aria-hidden="true"
                      className={cn(
                        "mt-0.5 size-3.5 shrink-0",
                        step.status === "completed"
                          ? "text-status-ok"
                          : step.status === "inProgress"
                            ? "text-status-busy"
                            : "text-muted-foreground/50",
                      )}
                    />
                    <span
                      className={cn(
                        "min-w-0",
                        step.status === "completed" ? "text-muted-foreground" : "text-foreground",
                      )}
                    >
                      {step.step}
                    </span>
                  </li>
                );
              })}
            </ol>
          ) : null}
        </Arriving>
      ) : null}
      {helpers !== null ? (
        <Arriving>
          <Instrument
            bar={helpers.rows.map((helper) => ({ key: helper.id, tone: HELPER_BAR[helper.tone] }))}
            icon={<BotIcon aria-hidden="true" className="size-3.5" />}
            label={`Helpers. ${open === "helpers" ? "Hide" : "Show"} each one`}
            onToggle={() => onToggle("helpers")}
            open={open === "helpers"}
            subject={helpers.rows.length === 1 ? "1 helper" : `${helpers.rows.length} helpers`}
            tone={helpers.working > 0 ? "busy" : helpers.failed > 0 ? "failed" : "ok"}
            words={[
              helpers.working > 0 ? `${helpers.working} working` : null,
              helpers.done > 0 ? `${helpers.done} done` : null,
              helpers.failed > 0 ? `${helpers.failed} failed` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          />
          {open === "helpers" ? (
            <ul className="grid gap-px px-2 pt-1 pb-2" data-working-detail="helpers">
              {helpers.rows.map((helper) => (
                <li
                  key={helper.id}
                  className="flex min-h-6 min-w-0 items-center gap-2 ps-10 text-line"
                >
                  <span className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT[helper.tone])} />
                  <span className="min-w-0 flex-1 truncate text-foreground">{helper.title}</span>
                  <span className="shrink-0 text-muted-foreground text-xs">{helper.word}</span>
                  <span className="w-14 shrink-0 text-right text-muted-foreground text-xs tabular-nums">
                    {spanOf(helper.startedAt, helper.endedAt)}
                  </span>
                </li>
              ))}
              <li className="ps-10 pt-0.5">
                <button
                  className="cursor-pointer text-info-foreground text-xs hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
                  onClick={onOpenAgents}
                  type="button"
                >
                  Open the helpers panel
                </button>
              </li>
            </ul>
          ) : null}
        </Arriving>
      ) : null}
      {background !== null ? (
        <Arriving>
          <Instrument
            bar={background.tasks.map((task) => ({ key: task.id, tone: TASK_BAR[task.state] }))}
            failed={background.running === 0 && background.failed > 0}
            figure={
              background.tasks.length > 1
                ? `${background.done}/${background.tasks.length}`
                : runningTask !== undefined
                  ? spanOf(runningTask.startedAt, null)
                  : null
            }
            icon={<LayersIcon aria-hidden="true" className="size-3.5" />}
            label={`Background tasks: ${background.running} running, ${background.done} done, ${background.failed} failed. ${open === "background" ? "Hide" : "Show"} each one`}
            onToggle={() => onToggle("background")}
            open={open === "background"}
            subject="Background"
            tone={background.running > 0 ? "busy" : background.failed > 0 ? "failed" : "ok"}
            words={
              runningTask?.title ??
              (background.failed > 0
                ? background.failed === 1
                  ? "1 failed"
                  : `${background.failed} failed`
                : "All done")
            }
          />
          {open === "background" ? (
            <ul className="grid gap-px px-2 pt-1 pb-2" data-working-detail="background">
              {background.tasks.map((task) => (
                <li
                  key={task.id}
                  className="flex min-h-6 min-w-0 items-center gap-2 ps-10 text-line"
                >
                  <span
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      TONE_DOT[TASK_STATE[task.state].tone],
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate text-foreground">{task.title}</span>
                  <span className="shrink-0 text-muted-foreground text-xs">
                    {TASK_STATE[task.state].word}
                  </span>
                  <span className="w-14 shrink-0 text-right text-muted-foreground text-xs tabular-nums">
                    {spanOf(task.startedAt, task.endedAt)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </Arriving>
      ) : null}
    </ul>
  );
}

export function ConversationWorking({
  speaker,
  bubbles,
  activity,
  answering,
  incidents,
  dock,
  browser,
  environmentId,
  threadRef,
  onOpenAgents,
}: {
  readonly speaker: ConversationSpeaker;
  /** The Mate's words and the steps that failed on the way, oldest first. */
  readonly bubbles: ReadonlyArray<WorkingBubble>;
  /** What it is on right now; null while it writes. */
  readonly activity: WorkingActivity | null;
  /** Its answer streams under the card. */
  readonly answering: boolean;
  readonly incidents: ReadonlyArray<IncidentModel>;
  readonly dock: DockModel | null;
  /** The browser while the stretch checks pages. */
  readonly browser: ReactNode;
  readonly environmentId: EnvironmentId | null;
  readonly threadRef: ScopedThreadRef | null;
  readonly onOpenAgents: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const { contentRef, minHeight, remeasure } = useGrowOnlyHeight();
  const toggle = (key: string) => {
    remeasure();
    setOpen((current) => (current === key ? null : key));
  };
  // Drawn once: from here on, what arrives arrives live.
  const shownRef = useRef(false);
  useEffect(() => {
    shownRef.current = true;
  }, []);

  return (
    <PanelShownContext value={shownRef}>
      <div
        className="@container/panel"
        data-conversation-working
        style={minHeight === undefined ? undefined : { minHeight }}
      >
        <div ref={contentRef}>
          {/* The stretch's card is the frame: the Mate at work is its body, on its inner edge. */}
          <section aria-label={`${speaker.name} at work`} className="text-card-foreground">
            <div className="pt-1 pb-2">
              <Stream
                activity={activity}
                answering={answering}
                bubbles={bubbles}
                speaker={speaker}
              />
            </div>
            <Instruments
              dock={dock}
              environmentId={environmentId}
              incidents={incidents}
              onOpenAgents={onOpenAgents}
              onToggle={toggle}
              open={open}
              threadRef={threadRef}
            />
            {browser !== null ? (
              // The browser opens inside the card, under what runs.
              <div className="-mx-4 border-border/60 border-t px-4 pt-3" data-working-tray>
                {browser}
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </PanelShownContext>
  );
}

/**
 * The Mate at work once its turn is over and work runs on — a helper still at
 * it, a background task, a watch loop: the same panel, smaller, at the
 * conversation's bottom, with its face, what still runs and a way to stop it.
 * When the work ends it leaves, and what the work did lands in the
 * conversation as its own quiet line.
 */
export function ConversationAfterWork({
  speaker,
  state,
  dock,
  stopping,
  onStop,
  environmentId,
  threadRef,
  onOpenAgents,
}: {
  readonly speaker: ConversationSpeaker;
  readonly state: "working" | "monitoring";
  readonly dock: DockModel | null;
  readonly stopping: boolean;
  readonly onStop: () => void;
  readonly environmentId: EnvironmentId | null;
  readonly threadRef: ScopedThreadRef | null;
  readonly onOpenAgents: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const toggle = (key: string) => setOpen((current) => (current === key ? null : key));
  // The server says "monitoring" for any shell; only a watch loop watches.
  const running = dock?.background?.tasks.filter((task) => task.state === "running") ?? [];
  const watching =
    (dock?.helpers ?? null) === null &&
    (running.length > 0 ? running.every((task) => task.watch) : state === "monitoring");
  return (
    <section
      aria-label={`${speaker.name} at work in the background`}
      className="@container/panel animate-panel-in rounded-3xl bg-card text-card-foreground shadow-sm ring-1 ring-border/60 motion-reduce:animate-none"
      data-conversation-after-work={state}
    >
      <div className="flex min-h-12 min-w-0 items-center gap-2.5 px-4 py-2">
        <MateFace size="md" state="working" tint={speaker.tint} />
        <span className="min-w-0 flex-1 truncate text-line text-foreground">
          {watching ? "Watching in the background" : "Still working in the background"}
        </span>
        <Button disabled={stopping} onClick={onStop} size="xs" variant="ghost">
          {stopping ? "Stopping…" : "Stop"}
        </Button>
      </div>
      <Instruments
        dock={dock}
        environmentId={environmentId}
        incidents={EMPTY_INCIDENTS}
        onOpenAgents={onOpenAgents}
        onToggle={toggle}
        open={open}
        threadRef={threadRef}
      />
    </section>
  );
}

const EMPTY_INCIDENTS: ReadonlyArray<IncidentModel> = [];
