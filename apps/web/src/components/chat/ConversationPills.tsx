/**
 * What the Mate at work and its report are made of: a status bar per thing
 * that runs, and a pill per thing a turn did — a service left live, the
 * checks, a change that landed — its mark, its name and a few words. The
 * live panel and the report share them, so the report a turn settles into is
 * visibly what the person watched run.
 */
import { ChevronDownIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";

export type PillTone = "plain" | "failed" | "attention";

const TONE_CLASS: Record<PillTone, string> = {
  plain: "border-border/60 bg-card",
  failed: "border-status-failed/40 bg-status-failed-surface text-status-failed-text",
  attention: "border-status-attention/40 bg-status-attention-surface text-status-attention-text",
};

/** One thing, as a pill; given `onToggle`, a click opens its detail in place. */
export function Pill({
  open = false,
  onToggle = null,
  onClick = null,
  label,
  tone = "plain",
  children,
}: {
  readonly open?: boolean;
  readonly onToggle?: (() => void) | null;
  /** A pill that goes somewhere rather than opening in place. */
  readonly onClick?: (() => void) | null;
  readonly label: string;
  readonly tone?: PillTone;
  readonly children: ReactNode;
}) {
  const className = cn(
    "inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-full border ps-1 pe-2.5 text-xs transition-colors",
    TONE_CLASS[tone],
  );
  const action = onToggle ?? onClick;
  if (action === null) {
    return (
      <span aria-label={label} className={className} data-pill={tone}>
        {children}
      </span>
    );
  }
  return (
    <button
      aria-expanded={onToggle !== null ? open : undefined}
      aria-label={label}
      className={cn(
        className,
        "cursor-pointer hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70",
        open && "border-ring/60 bg-accent/60",
      )}
      data-pill={tone}
      data-scroll-anchor-ignore
      onClick={action}
      type="button"
    >
      {children}
      {onToggle !== null ? (
        <ChevronDownIcon
          aria-hidden="true"
          className={cn(
            "size-3 shrink-0 opacity-60 transition-transform duration-150",
            open && "rotate-180",
          )}
        />
      ) : null}
    </button>
  );
}

export type DiscTone = "busy" | "ok" | "failed" | "attention" | "idle";

const DISC_CLASS: Record<DiscTone, string> = {
  busy: "bg-status-busy-surface text-status-busy-text",
  ok: "bg-status-ok-surface text-status-ok-text",
  failed: "bg-status-failed-surface text-status-failed-text",
  attention: "bg-status-attention-surface text-status-attention-text",
  idle: "bg-muted text-muted-foreground",
};

/**
 * A thing's mark in a disc of its state's tone — the same disc on a status
 * bar while it runs and on its pill once the turn is done, so a finished
 * deploy's green check is visibly what its blue rocket became.
 */
export function StatusDisc({
  tone,
  size = "md",
  children,
}: {
  readonly tone: DiscTone;
  readonly size?: "sm" | "md";
  readonly children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full transition-colors duration-500",
        size === "md" ? "size-6" : "size-5",
        DISC_CLASS[tone],
      )}
      data-status-disc={tone}
    >
      {children}
    </span>
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
