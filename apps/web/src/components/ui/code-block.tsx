"use client";

import { cva } from "class-variance-authority";
import { type ComponentProps, type ReactNode, useLayoutEffect, useRef } from "react";

import { cn } from "~/lib/utils";

import { CopyButton } from "./copy-button";
import { Skeleton } from "./skeleton";

/**
 * The ground every block of machine text stands on: the code ground and ink, a hairline, a
 * control's corner. `error` is the failed run's own words (a refusal's answer, a failed command's
 * output): the failed surface under the same ink, so it reads as what broke without turning red.
 */
const codeFrameVariants = cva(
  "relative flex min-w-0 flex-col overflow-hidden rounded-control border text-code-foreground",
  {
    defaultVariants: { tone: "default" },
    variants: {
      tone: {
        default: "border-border/60 bg-code",
        error: "border-destructive/20 bg-status-failed-surface",
      },
    },
  },
);

/**
 * How tall a block stands: `auto` as tall as its text; `sm` up to about nine lines (a source's
 * answer under Details); `md` up to fourteen (a config, an import, a command's output); `pane` a
 * fixed tall pane that never moves while its text grows (a build's log, a pipeline's config). Past
 * its height the text scrolls inside the block, never the page.
 */
const codeHeightVariants = cva("min-h-0 overflow-auto", {
  defaultVariants: { height: "auto" },
  variants: {
    height: {
      auto: "",
      sm: "max-h-48",
      md: "max-h-72",
      pane: "h-96 md:h-140",
    },
  },
});

type CodeTone = "default" | "error";

/**
 * The frame alone, for machine text another renderer draws inside it: a highlighter's lines under
 * the header it draws (an answer's code block), a terminal (the sign-in's login). Its ground,
 * hairline and corner are `CodeBlock`'s, so every block of machine text stands alike; text the
 * page draws itself is a `CodeBlock`, never this.
 */
function CodeFrame({
  tone = "default",
  className,
  ...props
}: ComponentProps<"div"> & { readonly tone?: CodeTone }) {
  return (
    <div
      className={cn(codeFrameVariants({ tone }), className)}
      data-slot="code-frame"
      data-tone={tone}
      {...props}
    />
  );
}
type CodeHeight = "auto" | "sm" | "md" | "pane";

/**
 * A block of literal text that stands on its own: code, a config, YAML, JSON, a command's output,
 * a source's own answer behind Details. Monospace on the code ground, at the person's code size
 * (Settings › Appearance, 13 px unless they chose another) on a 20 px line. `wrap` (the default)
 * breaks long lines anywhere so nothing scrolls sideways; `wrap={false}` keeps each line whole and
 * scrolls sideways, for text whose indent is its meaning (YAML, code). `title` names it on a
 * header line (a file's path, `zerops.yaml`); `copy` adds the one Copy press, in the header or in
 * the block's corner, copying the text whole (`value`, or the children when they are the text).
 *
 * Code inside a sentence is `Text variant="code"`; one value to copy on its own line (a command,
 * an address) is `CopyLine`; lines that arrive one by one (a build's log) are `LogView`.
 */
function CodeBlock({
  children,
  title,
  actions,
  copy,
  value,
  tone = "default",
  height = "auto",
  wrap = true,
  className,
  ...props
}: Omit<ComponentProps<"div">, "title" | "children"> & {
  /** The text; a string unless it is drawn in parts (a change's marks), then `value` is copied. */
  readonly children: ReactNode;
  /** Its name on a header line: a path, a file, a language. */
  readonly title?: ReactNode;
  /** Further presses on the header line, before Copy (wrap, run, open). */
  readonly actions?: ReactNode;
  /** What Copy copies, after "Copy" ("zerops.yaml", "the answer"): a Copy press when given. */
  readonly copy?: string;
  /** The text Copy copies, where the children are not a plain string. */
  readonly value?: string;
  readonly tone?: CodeTone;
  readonly height?: CodeHeight;
  /** Break long lines (the default), or keep each whole and scroll sideways. */
  readonly wrap?: boolean;
}) {
  const copied = value ?? (typeof children === "string" ? children : null);
  const press = copy === undefined ? null : <CopyButton label={copy} value={copied ?? ""} />;
  const header = title !== undefined || actions !== undefined;
  return (
    <div
      className={cn(codeFrameVariants({ tone }), className)}
      data-slot="code-block"
      data-tone={tone}
      {...props}
    >
      {header ? (
        <div className="flex min-h-9 shrink-0 items-center gap-2 border-border/60 border-b ps-3 pe-1">
          <span className="min-w-0 flex-1 truncate font-mono text-caption text-muted-foreground">
            {title}
          </span>
          {actions}
          {press}
        </div>
      ) : null}
      <pre
        className={cn(
          codeHeightVariants({ height }),
          "m-0 px-3 py-2 font-mono text-(length:--font-size-code,var(--text-line)) leading-5 [tab-size:2] select-text",
          wrap ? "whitespace-pre-wrap wrap-anywhere" : "whitespace-pre",
          !header && press !== null && "pe-10",
        )}
        data-slot="code-block-text"
      >
        {children}
      </pre>
      {header || press === null ? null : (
        <span className="absolute end-1 top-1" data-slot="code-block-corner">
          {press}
        </span>
      )}
    </div>
  );
}

/** How a log line reads: `failed` tinted and in the error ink, `warning` in the warning ink, `quiet` muted. */
type LogTone = "default" | "failed" | "warning" | "quiet";

interface LogLine {
  readonly id: string;
  readonly text: string;
  /** The line's time, already worded; a column of its own when any line has one. */
  readonly time?: string;
  /** The machine-readable time, for `<time dateTime>`. */
  readonly at?: string;
  readonly tone?: LogTone;
}

const LOG_LINE_TONE: Record<LogTone, string> = {
  default: "",
  failed: "bg-status-failed/8 text-status-failed-text",
  warning: "text-warning-foreground",
  quiet: "text-muted-foreground",
};

/** The stand-in lines' widths while a log is read: two long, the last short. */
const PENDING_WIDTHS = ["w-5/6", "w-4/6", "w-1/2"] as const;

/** Within this many pixels of the end, the reader is at the newest line, and the log follows. */
const FOLLOW_SLACK_PX = 4;

/**
 * Lines a machine wrote, one by one: a build's log, a service's log, a failed phase's tail. The
 * code ground, monospace at the person's code size on a 20 px line, each line wrapped under itself; a failed line tinted across the
 * whole width so it stands out in a long scroll, a warning in its ink. Times, when the lines carry
 * them, stand in a column of their own. While its lines are read (`pending`), three stand-in lines
 * hold their room. A `live` log follows its newest line while the reader is at
 * the end, and stops following the moment they scroll up. `height` as `CodeBlock`'s; a streaming
 * log stands in a `pane` so arriving lines never move the page.
 *
 * Text that is read whole (a config, a command's output) is `CodeBlock`.
 */
function LogView({
  lines,
  label,
  pending = false,
  live = false,
  copy,
  tone = "default",
  height = "auto",
  className,
  ...props
}: Omit<ComponentProps<"div">, "children"> & {
  readonly lines: ReadonlyArray<LogLine>;
  /** What the log is, for the reader of the page: "Build log", "Log of api". */
  readonly label: string;
  /** Its lines are being read: stand-in lines hold their room. */
  readonly pending?: boolean;
  /** Lines still arrive: announced politely, and the end followed. */
  readonly live?: boolean;
  /** What Copy copies, after "Copy" ("the log"): a Copy press in the corner when given. */
  readonly copy?: string;
  readonly tone?: CodeTone;
  readonly height?: CodeHeight;
}) {
  const scrollerRef = useRef<HTMLOListElement>(null);
  const followingRef = useRef(true);
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller === null) return;
    // A line arriving is a row added, a pane resized is its end moved: held at the newest while followed.
    const pin = () => {
      if (followingRef.current) scroller.scrollTop = scroller.scrollHeight;
    };
    pin();
    const added = new MutationObserver(pin);
    added.observe(scroller, { childList: true });
    const resized = new ResizeObserver(pin);
    resized.observe(scroller);
    return () => {
      added.disconnect();
      resized.disconnect();
    };
  }, []);
  const timed = lines.some((line) => line.time !== undefined);
  return (
    <div
      className={cn(codeFrameVariants({ tone }), className)}
      data-slot="log-view"
      data-tone={tone}
      {...props}
    >
      <ol
        aria-label={label}
        aria-live={live ? "polite" : undefined}
        className={cn(
          codeHeightVariants({ height }),
          "m-0 list-none py-2 ps-0 font-mono text-(length:--font-size-code,var(--text-line)) leading-5 select-text",
        )}
        data-slot="log-view-lines"
        onScroll={(event) => {
          const scroller = event.currentTarget;
          followingRef.current =
            scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= FOLLOW_SLACK_PX;
        }}
        ref={scrollerRef}
      >
        {pending
          ? PENDING_WIDTHS.map((width) => (
              <li aria-hidden="true" className="flex h-5 items-center px-3" key={width}>
                <Skeleton className={cn("h-3", width)} />
              </li>
            ))
          : lines.map((line) => (
              <li
                className={cn(
                  "flex gap-3 px-3",
                  copy !== undefined && "pe-10",
                  LOG_LINE_TONE[line.tone ?? "default"],
                )}
                data-tone={line.tone ?? "default"}
                key={line.id}
              >
                {timed ? (
                  <time
                    className="shrink-0 text-muted-foreground tabular-nums select-none"
                    dateTime={line.at}
                  >
                    {line.time}
                  </time>
                ) : null}
                <span className="min-w-0 flex-1 whitespace-pre-wrap wrap-anywhere">
                  {line.text}
                </span>
              </li>
            ))}
      </ol>
      {copy === undefined ? null : (
        <span className="absolute end-1 top-1" data-slot="log-view-corner">
          <CopyButton label={copy} value={() => lines.map((line) => line.text).join("\n")} />
        </span>
      )}
    </div>
  );
}

export {
  CodeBlock,
  CodeFrame,
  LogView,
  type CodeHeight,
  type CodeTone,
  type LogLine,
  type LogTone,
};
