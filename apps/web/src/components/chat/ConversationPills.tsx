/**
 * The pills the Mate at work and its report are made of: one thing each — a
 * deploy, the checks, a failure, a change that landed — its mark, its name
 * and a few words. The live group and the report share them, so the report a
 * turn settles into is visibly what the person watched run.
 */
import { ChevronDownIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";

export type PillTone = "plain" | "failed" | "attention";

const TONE_CLASS: Record<PillTone, string> = {
  plain: "border-border/70 bg-background",
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
    "inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors",
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

/** A pipeline's steps as short segments, in the step's status colour. */
export function Segments({
  segments,
}: {
  readonly segments: ReadonlyArray<{ readonly key: string; readonly className: string }>;
}) {
  return (
    <span aria-hidden="true" className="flex w-10 shrink-0 items-center gap-0.5">
      {segments.map((segment) => (
        <span
          key={segment.key}
          className={cn("h-1 min-w-0 flex-1 rounded-full", segment.className)}
        />
      ))}
    </span>
  );
}
