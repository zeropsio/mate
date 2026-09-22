/**
 * Live progress for a Mate still coming to life — the birth-progress
 * checklist's two faces. `ZeropsBirthLine` fits the Mate card's `line` slot
 * (`ZeropsMateCard`): a compact 6-segment meter, the active or failed step's
 * own sentence, and the birth's own elapsed time, opening `ZeropsBirthChecklist`
 * in a popover so the card never changes height for it. Both read a
 * `BirthProgress` (`@t3tools/client-runtime/zerops/birthProgress`) and the
 * clock `useZeropsBirthProgress` ticks once a second — nothing here derives
 * anything on its own (R5).
 */
import type { BirthProgress, BirthStep } from "@t3tools/client-runtime/zerops/birthProgress";
import type { ServiceStatusToneId } from "@t3tools/shared/brand";

import { cn } from "~/lib/utils";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import {
  useZeropsBirthProgress,
  type UseZeropsBirthProgressInput,
} from "~/zerops/useZeropsBirthProgress";

import {
  BIRTH_STEP_TONE,
  birthLineDetailStep,
  birthStepToProcessStep,
  formatBirthElapsed,
} from "./ZeropsBirthProgress.logic";
import { ProcessSteps } from "./primitives";

const SEGMENT_TONE_CLASS: Readonly<Record<ServiceStatusToneId, string>> = {
  ok: "bg-[var(--zerops-status-ok)]",
  busy: "bg-[var(--zerops-status-busy)]",
  attention: "bg-[var(--zerops-status-attention)]",
  failed: "bg-[var(--zerops-status-failed)]",
  off: "bg-[var(--zerops-status-off)]",
};

export interface ZeropsBirthLineProps {
  readonly progress: BirthProgress;
  readonly nowMs: number;
  readonly className?: string;
}

/**
 * A Mate card's line while its Mate is being born — the hook and the line in
 * one component, so a list of cards can render one per card.
 */
export function ZeropsMateBirthLine({ input }: { readonly input: UseZeropsBirthProgressInput }) {
  const birth = useZeropsBirthProgress(input);
  return birth === null ? null : <ZeropsBirthLine nowMs={birth.nowMs} progress={birth.progress} />;
}

/** The Mate card's line while it is still coming to life. */
export function ZeropsBirthLine({ progress, nowMs, className }: ZeropsBirthLineProps) {
  const detailStep = birthLineDetailStep(progress);
  const valueText = detailStep?.detail ?? (progress.complete ? "Done" : undefined);
  const elapsedMs =
    progress.startedAt === undefined ? undefined : nowMs - Date.parse(progress.startedAt);

  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          "inline-flex min-w-0 items-center gap-1.5 rounded-sm text-xs leading-4 text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
        data-zerops-surface="birth-line"
      >
        <span
          aria-valuemax={progress.total}
          aria-valuenow={progress.doneCount}
          className="inline-flex shrink-0 items-center gap-0.5"
          role="progressbar"
          {...(valueText === undefined ? {} : { "aria-valuetext": valueText })}
        >
          {progress.steps.map((step) => (
            <span
              aria-hidden="true"
              className={cn(
                "h-1.5 w-2.5 rounded-full",
                SEGMENT_TONE_CLASS[BIRTH_STEP_TONE[step.state]],
                step.state === "active" && "animate-status-pulse motion-reduce:animate-none",
              )}
              data-zerops-birth-step-state={step.state}
              key={step.id}
            />
          ))}
        </span>
        {detailStep?.detail === undefined ? null : (
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-left",
              detailStep === progress.failed && "text-[var(--zerops-status-failed-text)]",
            )}
          >
            {detailStep.detail}
          </span>
        )}
        {elapsedMs === undefined ? null : (
          <span className="shrink-0 font-mono text-[11px] tabular-nums">
            {formatBirthElapsed(elapsedMs)}
          </span>
        )}
      </PopoverTrigger>
      <PopoverPopup align="start" className="w-80" side="bottom">
        <ZeropsBirthChecklist nowMs={nowMs} progress={progress} />
      </PopoverPopup>
    </Popover>
  );
}

export interface ZeropsBirthChecklistProps {
  readonly progress: BirthProgress;
  readonly nowMs: number;
}

function hasSubsteps(step: BirthStep): boolean {
  return step.substeps !== undefined && step.substeps.length > 0;
}

/** The full ordered checklist behind the line's popover — one row per step, the container's own build pipeline nested under it. */
export function ZeropsBirthChecklist({ progress, nowMs }: ZeropsBirthChecklistProps) {
  return (
    <div className="space-y-3" data-zerops-surface="birth-checklist">
      {progress.steps.map((step) => (
        <div key={step.id}>
          <ProcessSteps aria-label={step.label} steps={[birthStepToProcessStep(step, nowMs)]} />
          {hasSubsteps(step) ? (
            <div
              className="mt-2 ms-[calc(var(--zerops-process-step-glyph-size)/2)] border-s border-border/60 ps-3"
              data-zerops-surface="birth-build-substeps"
            >
              <ProcessSteps aria-label={`${step.label} pipeline`} steps={step.substeps!} />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
