/**
 * A status bar per thing that runs alongside the Mate at work — a deploy's
 * pipeline, a task list, the helpers at work — each segment in its state's
 * tone. Nothing about it opens a dialog.
 */
import { cn } from "~/lib/utils";

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
