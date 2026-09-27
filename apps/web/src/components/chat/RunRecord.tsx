/**
 * A run's record, as the card draws it: one line per thing the Mate did, in
 * one scroll that follows its end — the same while it works and once it is
 * done (the owner, 2026-09-27: "after the work is done I'd leave it on the
 * page, with the same inner scroll it has while working").
 *
 * Every line is one grammar — a dot in its state's tone, the words, a detail
 * (the command, a count, the stage), and the time in the card's time column
 * — so a step, a thought, an operation and a helper read as one list. No
 * mark says what kind a line is: its words do ("no unnecessary icons, make
 * the use obvious from the component"). A line with more behind it opens it
 * in a modal; nothing opens in place. The scroll never moves sideways: a
 * long command ends in an ellipsis and opens whole.
 */
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import { useLayoutEffect, useRef, useState, type ReactNode, type UIEvent } from "react";

import { cn } from "~/lib/utils";
import { formatWorkDuration } from "./conversation.logic";
import { ElapsedSince, MATE_BUBBLE_FILL } from "./ConversationRows";
import type { StepKind, WorkStep } from "./workSteps.logic";

/** The record's height at most, and the Mate at work's panel's at its tallest. */
const RECORD_MAX_HEIGHT = "max-h-88";

/** A line's state: its dot's tone. */
export type LineState = "done" | "running" | "failed" | "attention";

const DOT_CLASS: Record<LineState, string> = {
  done: "bg-muted-foreground/35",
  running: "bg-status-busy animate-status-pulse motion-reduce:animate-none",
  failed: "bg-status-failed",
  attention: "bg-status-attention",
};

/** The column a line's dot stands in, and the Mate's face beside what it is doing now. */
export const RECORD_GUTTER = "flex w-5 shrink-0 justify-center";

/** Where a record's words start: past the gutter and the gap after it. */
export const RECORD_TEXT_INSET = "ms-7.5";

/**
 * The Mate's words to the person, in its record: a chat bubble, its corner
 * toward the face, in a fill both palettes show. Its thinking is no bubble at
 * all: muted italics, the Mate talking to itself.
 */
export const MATE_NOTE_CLASS = `w-fit max-w-full rounded-2xl rounded-es-md ${MATE_BUBBLE_FILL} px-3.5 py-2 text-foreground`;

/** A thought's words: a size under the Mate's words to the person, in the muted ink. */
export const THOUGHT_WORDS_CLASS = "text-line leading-5 text-muted-foreground";

/** The card's time column: every line's time and the heading's, on one right edge. */
export const TIME_COLUMN = "w-14 shrink-0 text-end text-xs tabular-nums text-muted-foreground";

export function RecordDot({ state }: { readonly state: LineState }) {
  return (
    <span aria-hidden="true" className={RECORD_GUTTER}>
      <span className={cn("size-1.5 rounded-full", DOT_CLASS[state])} />
    </span>
  );
}

/**
 * One line of the record: its dot, its words, a detail after them and its
 * time. Given `onOpen`, the line is a button that opens its detail.
 */
export function RecordLine({
  state,
  words,
  code = null,
  detail = null,
  italic = false,
  suffix = null,
  time = null,
  label,
  onOpen = null,
  mark = null,
}: {
  readonly state: LineState;
  readonly words: ReactNode;
  /** A command, in mono: the rest of the line gives way to it before the words do. */
  readonly code?: string | null;
  readonly detail?: ReactNode;
  /** A thought: the Mate talking to itself, in muted italics. */
  readonly italic?: boolean;
  /** What the line cannot show of itself: a script's lines, a run of edits' count. */
  readonly suffix?: string | null;
  readonly time?: ReactNode;
  /** The line's accessible name, when its words are not all of it. */
  readonly label?: string;
  readonly onOpen?: (() => void) | null;
  /** In place of the dot: the Mate's face, on the line of what it is doing now. */
  readonly mark?: ReactNode;
}) {
  // With nothing after its words, what the line cannot show of itself follows
  // them; after a command it stands before the time, with the command's end.
  const after = code !== null || (detail !== null && detail !== undefined);
  const body = (
    <>
      {mark ?? <RecordDot state={state} />}
      <span
        className={cn(
          "min-w-0 truncate",
          italic
            ? "flex-1 text-muted-foreground italic"
            : state === "failed"
              ? "text-status-failed-text"
              : state === "running"
                ? "text-foreground"
                : "text-foreground/85",
        )}
      >
        {words}
      </span>
      {code !== null ? (
        <code className="min-w-0 flex-1 basis-0 truncate font-mono text-muted-foreground/80 text-xs">
          {code}
        </code>
      ) : after ? (
        <span className="min-w-0 flex-1 basis-0 truncate text-muted-foreground text-xs">
          {detail}
        </span>
      ) : italic ? null : (
        <span className="min-w-0 flex-1 basis-0 truncate text-muted-foreground/80 text-xs tabular-nums">
          {suffix}
        </span>
      )}
      {after && suffix !== null ? (
        <span className="shrink-0 text-muted-foreground/80 text-xs tabular-nums">{suffix}</span>
      ) : null}
      <span className={TIME_COLUMN}>{time}</span>
    </>
  );
  const className = "flex min-h-7 w-full min-w-0 items-center gap-2.5 text-start text-line";
  if (onOpen === null) {
    return (
      <div aria-label={label} className={className} data-record-line={state}>
        {body}
      </div>
    );
  }
  return (
    <button
      aria-haspopup="dialog"
      aria-label={label}
      className={cn(
        className,
        "-mx-1.5 w-[calc(100%+0.75rem)] cursor-pointer rounded-md px-1.5 transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-inset",
      )}
      data-record-line={state}
      onClick={onOpen}
      type="button"
    >
      {body}
    </button>
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
            <span className={cn(RECORD_GUTTER, "pt-2")}>
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

/**
 * The thought the Mate is thinking, beside its face: its newest three lines,
 * the ones before them fading out through the top as it goes on.
 */
export function ThoughtTail({ children }: { readonly children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [clipped, setClipped] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const measure = () => setClipped(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  }, []);
  return (
    <div className="relative min-w-0">
      <div
        ref={ref}
        className="flex max-h-15 min-w-0 flex-col-reverse overflow-hidden text-line text-muted-foreground italic leading-5"
        data-thought-tail
      >
        <div>{children}</div>
      </div>
      {clipped ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-5 bg-gradient-to-b from-card to-transparent"
        />
      ) : null}
    </div>
  );
}

/**
 * The record's scroll: at its newest when it opens, following its end as it
 * grows, and holding still while the person reads back — only a wheel, a
 * touch or a key leaves the end. While the run goes on it never grows
 * shorter, so a long thought giving way to a one-line step never pulls the
 * conversation down; it only ever scrolls up and down, never sideways.
 */
export function RecordScroll({
  live,
  children,
}: {
  readonly live: boolean;
  readonly children: ReactNode;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const followingRef = useRef(true);
  const gestureAtRef = useRef(Number.NEGATIVE_INFINITY);
  const tallestRef = useRef(0);
  const [minHeight, setMinHeight] = useState<number | undefined>(undefined);
  const [above, setAbove] = useState(false);

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const content = contentRef.current;
    if (scroller === null || content === null) return;
    tallestRef.current = 0;
    const hold = () => {
      if (followingRef.current) scroller.scrollTop = scroller.scrollHeight;
      setAbove(scroller.scrollTop > 1);
      if (live) {
        const shown = scroller.getBoundingClientRect().height;
        if (shown > tallestRef.current) {
          tallestRef.current = shown;
          setMinHeight(shown);
        }
      }
    };
    hold();
    const observer = new ResizeObserver(hold);
    observer.observe(content);
    return () => observer.disconnect();
  }, [live]);

  const markGesture = () => {
    gestureAtRef.current = performance.now();
  };
  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const scroller = event.currentTarget;
    setAbove(scroller.scrollTop > 1);
    const atEnd = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 2;
    if (atEnd) followingRef.current = true;
    else if (performance.now() - gestureAtRef.current < 400) followingRef.current = false;
    else if (followingRef.current) scroller.scrollTop = scroller.scrollHeight;
  };

  return (
    <div className="relative min-w-0" data-record>
      <div
        ref={scrollerRef}
        className={cn(
          RECORD_MAX_HEIGHT,
          "-mx-1.5 overflow-x-hidden overflow-y-auto overscroll-contain px-1.5 scrollbar-none",
        )}
        onKeyDown={markGesture}
        onScroll={onScroll}
        onTouchMove={markGesture}
        onWheel={markGesture}
        // Once the run is over the record is as tall as what it holds.
        style={live && minHeight !== undefined ? { minHeight } : undefined}
      >
        <div ref={contentRef} className="flex min-w-0 flex-col justify-end">
          {children}
        </div>
      </div>
      {above ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-6 bg-gradient-to-b from-card to-transparent"
        />
      ) : null}
    </div>
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

/** What a step's line cannot show of it: a script's length, how many edits it folds. */
export function stepSuffix(step: WorkStep): string | null {
  if (step.kind === "command" && step.codeLines > 1) return `${step.codeLines} lines`;
  if (step.kind === "edit" && step.entries.length > 1) return `${step.entries.length} edits`;
  return null;
}

/** How long a platform operation took, or how long it has run so far. */
export function operationTime(operation: ZeropsOperation): ReactNode {
  if (operation.phase === "running") return <ElapsedSince since={operation.anchorAt} />;
  if (operation.settledAt === undefined) return null;
  const ms = Date.parse(operation.settledAt) - Date.parse(operation.anchorAt);
  return Number.isFinite(ms) && ms >= 1000 ? formatWorkDuration(ms) : null;
}

const DETAIL_BLOCK =
  "max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/50 px-3 py-2 font-mono text-xs leading-relaxed text-foreground/85 select-text";

/** The runtime's `Name: {json}` detail of a call: its arguments, never output to show. */
const CALL_ARGUMENTS = /^[A-Za-z][\w-]*:\s*[{[]/;

/**
 * What a step holds, in its modal: the whole command and what it printed,
 * the files it touched, the pictures it looked at, what a tool was asked —
 * each block under its own name.
 */
export function StepDetail({
  step,
  pictures = null,
}: {
  readonly step: WorkStep;
  /** The pictures it looked at, drawn as themselves: in place of their paths. */
  readonly pictures?: ReactNode;
}) {
  const blocks: Array<{ readonly key: string; readonly label: string; readonly text: string }> = [];
  step.entries.forEach((entry, index) => {
    const command = (entry.rawCommand ?? entry.command)?.trim();
    if (command) blocks.push({ key: `${index}:command`, label: "Command", text: command });
    const files = [
      ...new Set([
        ...(entry.changedFiles ?? []),
        ...(step.kind === "look"
          ? []
          : entry.callInput?.filePath
            ? [entry.callInput.filePath]
            : []),
      ]),
    ];
    if (files.length > 0)
      blocks.push({ key: `${index}:files`, label: "Files", text: files.join("\n") });
    const asked = [
      entry.callInput?.pattern ? `pattern  ${entry.callInput.pattern}` : null,
      entry.callInput?.glob ? `glob     ${entry.callInput.glob}` : null,
      entry.callInput?.path ? `in       ${entry.callInput.path}` : null,
      entry.callInput?.url ? `address  ${entry.callInput.url}` : null,
      entry.callInput?.query ? `query    ${entry.callInput.query}` : null,
    ].filter((line): line is string => line !== null);
    if (asked.length > 0)
      blocks.push({ key: `${index}:asked`, label: "Asked", text: asked.join("\n") });
    const detail = entry.detail?.trim();
    if (
      detail &&
      detail !== command &&
      !CALL_ARGUMENTS.test(detail) &&
      !(step.kind === "look" && step.images.includes(detail))
    ) {
      blocks.push({ key: `${index}:output`, label: "Printed", text: detail });
    }
  });
  const drawnPictures = step.images.length > 0 && pictures !== null;
  if (step.images.length > 0 && !drawnPictures) {
    blocks.push({ key: "images", label: "Pictures", text: step.images.join("\n") });
  }
  if (blocks.length === 0 && !drawnPictures) return null;
  return (
    <div className="grid min-w-0 gap-3" data-step-detail>
      {blocks.map((block) => (
        <section key={block.key} aria-label={block.label} className="grid min-w-0 gap-1">
          <h3 className="text-muted-foreground text-xs">{block.label}</h3>
          <pre className={DETAIL_BLOCK}>{block.text}</pre>
        </section>
      ))}
      {drawnPictures ? (
        <section aria-label="Pictures" className="grid min-w-0 gap-1">
          <h3 className="text-muted-foreground text-xs">Pictures</h3>
          {pictures}
        </section>
      ) : null}
    </div>
  );
}
