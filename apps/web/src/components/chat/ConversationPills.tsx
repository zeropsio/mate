/**
 * What the Mate at work and its result are made of: a status bar per thing
 * that runs, and a pill per thing a run did — a service left live, the
 * checks, a change that landed, what its calls came to — a dot where it has a
 * state, its name and a few words. The live panel and the result share them,
 * so the result a run settles into is visibly what the person watched run.
 */
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";

export type PillTone = "plain" | "failed" | "attention";

const TONE_CLASS: Record<PillTone, string> = {
  plain: "border-border/60 bg-card",
  failed: "border-status-failed/40 bg-status-failed-surface text-status-failed-text",
  attention: "border-status-attention/40 bg-status-attention-surface text-status-attention-text",
};

/** One thing, as a pill; given `onClick`, a click opens what it stands for. */
export function Pill({
  onClick = null,
  label,
  tone = "plain",
  children,
}: {
  readonly onClick?: (() => void) | null;
  readonly label: string;
  readonly tone?: PillTone;
  readonly children: ReactNode;
}) {
  // The live status bars' size: a 20 px line in the 28 px pill.
  const className = cn(
    "inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-full border ps-1 pe-2.5 text-line transition-colors",
    TONE_CLASS[tone],
  );
  if (onClick === null) {
    return (
      <span aria-label={label} className={className} data-pill={tone}>
        {children}
      </span>
    );
  }
  return (
    <button
      aria-label={label}
      className={cn(
        className,
        "cursor-pointer hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70",
      )}
      data-pill={tone}
      data-scroll-anchor-ignore
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

export type BarTone = "done" | "running" | "failed" | "waiting" | "attention";

const BAR_TONE: Record<BarTone, string> = {
  done: "bg-status-ok",
  running: "animate-status-pulse bg-status-busy motion-reduce:animate-none",
  failed: "bg-status-failed",
  waiting: "bg-muted-foreground/20",
  attention: "bg-status-attention",
};

/**
 * A status bar: one segment per step, helper or task, each in its state's
 * tone — a deploy's pipeline, a task list, the helpers at work. A segment
 * changes its colour in place as its step moves on; the bar never moves.
 */
export function StatusBar({
  segments,
  className,
}: {
  readonly segments: ReadonlyArray<{ readonly key: string; readonly tone: BarTone }>;
  readonly className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn("flex h-1.5 min-w-0 items-center gap-0.5", className)}
      data-status-bar
    >
      {segments.map((segment) => (
        <span
          key={segment.key}
          className={cn(
            "h-full min-w-0 flex-1 rounded-full transition-colors duration-500",
            BAR_TONE[segment.tone],
          )}
          data-status-bar-segment={segment.tone}
        />
      ))}
    </span>
  );
}
