/**
 * The two one-row forms a card draws its steps in, instead of a list:
 *
 * - `PipelineSegments` — a deploy's (or import's) pipeline as equal-width
 *   segments, each a glyph in its tone and its label (wrapping, never cut)
 *   over its duration — or "Failed"; the running segment in the busy tint, a
 *   failed one in the failed tint. The slots exist from birth, so a result
 *   only recolours them.
 * - `CheckChips` — a verify's checks as one wrapping row of chips, each a
 *   glyph in its tone beside the check's name and result.
 *
 * Presentational, props only (R2): every word is the reducer's.
 */
import type { JSX } from "react";
import { CheckIcon, ClockIcon, PlayIcon, XIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { formatStepDuration, type ProcessStep, type ProcessStepState } from "../primitives";

const STEP_GLYPH: Record<
  ProcessStepState,
  { readonly Icon: typeof CheckIcon; readonly className: string }
> = {
  queued: { Icon: ClockIcon, className: "text-[var(--zerops-status-off)]" },
  running: { Icon: PlayIcon, className: "text-[var(--zerops-status-busy)]" },
  done: { Icon: CheckIcon, className: "text-[var(--zerops-status-ok-text)]" },
  failed: { Icon: XIcon, className: "text-[var(--zerops-status-failed-text)]" },
};

const SEGMENT_BOX: Record<ProcessStepState, string> = {
  queued: "bg-muted/60 text-muted-foreground",
  running: "bg-[var(--zerops-status-busy-surface)] text-[var(--zerops-status-busy-text)]",
  done: "bg-muted/60 text-foreground",
  failed: "bg-[var(--zerops-status-failed-surface)] text-[var(--zerops-status-failed-text)]",
};

/** Up to this many segments share one row, however narrow; more wrap at a readable width. */
const ONE_ROW_SEGMENTS = 6;

/**
 * What a segment says under its label: a failed step its state word; any
 * other its duration once one is known (a running one ticks) — never "Done",
 * which the glyph already says.
 */
function segmentFootnote(step: ProcessStep): string | undefined {
  if (step.state === "failed") {
    return step.stateLabel;
  }
  return step.durationMs !== undefined ? formatStepDuration(step.durationMs) : undefined;
}

export function PipelineSegments({
  "aria-label": ariaLabel,
  steps,
}: {
  readonly "aria-label": string;
  readonly steps: ReadonlyArray<ProcessStep>;
}): JSX.Element {
  return (
    <ol
      aria-label={ariaLabel}
      className={cn(
        "grid gap-1.5",
        steps.length > ONE_ROW_SEGMENTS && "grid-cols-[repeat(auto-fit,minmax(5.5rem,1fr))]",
      )}
      data-zerops-pipeline-segments
      style={
        steps.length > ONE_ROW_SEGMENTS
          ? undefined
          : { gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }
      }
    >
      {steps.map((step) => {
        const { Icon, className } = STEP_GLYPH[step.state];
        const footnote = segmentFootnote(step);
        return (
          <li
            aria-current={step.state === "running" ? "step" : undefined}
            className={cn(
              "grid min-w-0 content-start gap-px rounded-md px-2 py-1",
              SEGMENT_BOX[step.state],
            )}
            data-zerops-process-state={step.state}
            key={step.id}
          >
            <span className="min-w-0 break-words font-medium text-xs leading-4">
              <Icon
                aria-hidden="true"
                className={cn("me-1 inline size-3 align-[-1px]", className)}
                data-zerops-segment-glyph={step.state}
              />
              {step.label}
            </span>
            {footnote !== undefined ? (
              <span className="text-[11px] text-muted-foreground tabular-nums">{footnote}</span>
            ) : (
              <span className="sr-only">{step.stateLabel}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function CheckChips({
  "aria-label": ariaLabel,
  steps,
}: {
  readonly "aria-label": string;
  readonly steps: ReadonlyArray<ProcessStep>;
}): JSX.Element {
  return (
    <ul aria-label={ariaLabel} className="flex flex-wrap gap-1.5" data-zerops-verify-checks>
      {steps.map((step) => {
        const { Icon, className } = STEP_GLYPH[step.state];
        return (
          <li
            className="inline-flex min-w-0 items-center gap-1 rounded-md bg-muted/60 px-1.5 py-0.5 text-foreground text-xs"
            data-zerops-process-state={step.state}
            key={step.id}
          >
            <Icon aria-hidden="true" className={cn("size-3 shrink-0", className)} />
            <span className="truncate">{step.label}</span>
            <span className="sr-only">{step.stateLabel}</span>
            {step.note !== undefined ? (
              <span className="shrink-0 text-muted-foreground tabular-nums">{step.note}</span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
