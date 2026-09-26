/**
 * A deploy's pipeline as the Zerops GUI's pipeline detail lists it: one row
 * per step the pipeline has — a 16 px state glyph, the step's sentence, its
 * duration at the right in tabular figures. The step that is running or
 * failed reads in the foreground, every other one muted. Before the platform
 * has worked the steps out of zerops.yml, one row says so.
 *
 * Presentational, props only (R2): every sentence is `readPipeline`'s, every
 * duration `formatDuration`'s. A running step's glyph is the busy dot, whose
 * only motion is the stepped `status-pulse` (R6).
 */
import type { JSX, ReactNode } from "react";
import { CheckIcon, CircleAlertIcon, CircleIcon, XIcon, type LucideIcon } from "lucide-react";

import {
  CALCULATING_SENTENCE,
  type PipelineReadoutStep,
  type PipelineSpokenState,
  formatDuration,
} from "@t3tools/client-runtime/zerops/activity/pipelineReadout";

import { cn } from "~/lib/utils";
import { StatusDot } from "../primitives";

/** The row's state for a reader who does not see the glyph. */
const STATE_WORD: Readonly<Record<PipelineSpokenState, string>> = {
  waiting: "Waiting",
  running: "Running",
  activating: "Activating",
  finished: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

const ICON_GLYPH: Readonly<
  Record<Exclude<PipelineSpokenState, "running" | "activating">, { Icon: LucideIcon; tone: string }>
> = {
  waiting: { Icon: CircleIcon, tone: "text-muted-foreground" },
  finished: { Icon: CheckIcon, tone: "text-success-foreground" },
  failed: { Icon: CircleAlertIcon, tone: "text-destructive-foreground" },
  cancelled: { Icon: XIcon, tone: "text-muted-foreground" },
};

const isInFlight = (state: PipelineSpokenState): state is "running" | "activating" =>
  state === "running" || state === "activating";

function StepGlyph({ state }: { readonly state: PipelineSpokenState }) {
  if (isInFlight(state)) {
    return (
      <span
        aria-hidden="true"
        className="flex size-4 shrink-0 items-center justify-center"
        data-zerops-pipeline-glyph={state}
      >
        <StatusDot dotOnly label={STATE_WORD[state]} tone="busy" />
      </span>
    );
  }
  const { Icon, tone } = ICON_GLYPH[state];
  return (
    <Icon
      aria-hidden="true"
      className={cn("size-4 shrink-0", tone)}
      data-zerops-pipeline-glyph={state}
    />
  );
}

function Row({
  beneath,
  duration,
  emphasised,
  id,
  sentence,
  state,
}: {
  /** What belongs to this step — the build's log under the build — on its words' edge. */
  readonly beneath?: ReactNode;
  readonly duration: string | undefined;
  readonly emphasised: boolean;
  readonly id: string;
  readonly sentence: string;
  readonly state: PipelineSpokenState;
}) {
  return (
    <li
      aria-current={isInFlight(state) ? "step" : undefined}
      className="flex items-start gap-2"
      data-zerops-pipeline-step={id}
      data-zerops-pipeline-state={state}
    >
      <span className="flex h-5 shrink-0 items-center">
        <StepGlyph state={state} />
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block text-sm leading-5",
            emphasised ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {sentence}
          <span className="sr-only"> · {STATE_WORD[state]}</span>
        </span>
        {beneath}
      </span>
      {duration !== undefined ? (
        <span className="shrink-0 text-muted-foreground text-xs leading-5 tabular-nums">
          {duration}
        </span>
      ) : null}
    </li>
  );
}

/** What a row reads off a step: a readout's, or the one a settled result names as failed. */
export type PipelineStepRow = Pick<PipelineReadoutStep, "id" | "state" | "sentence"> &
  Partial<Pick<PipelineReadoutStep, "note" | "durationMs">>;

export function PipelineStepList({
  "aria-label": ariaLabel,
  steps,
  beneath,
}: {
  readonly "aria-label": string;
  readonly steps: ReadonlyArray<PipelineStepRow>;
  /** What belongs under a step, by the step's id. */
  readonly beneath?: Readonly<Partial<Record<string, ReactNode>>> | undefined;
}): JSX.Element {
  return (
    <ol aria-label={ariaLabel} className="space-y-1" data-zerops-pipeline-steps>
      {steps.map((step) => (
        <Row
          beneath={beneath?.[step.id]}
          duration={step.durationMs === undefined ? undefined : formatDuration(step.durationMs)}
          emphasised={isInFlight(step.state) || step.state === "failed"}
          id={step.id}
          key={step.id}
          sentence={step.note === undefined ? step.sentence : `${step.sentence} · ${step.note}`}
          state={step.state}
        />
      ))}
    </ol>
  );
}

/** The one row a deploy shows before its steps are known. */
export function PipelineCalculating({
  "aria-label": ariaLabel,
}: {
  readonly "aria-label": string;
}): JSX.Element {
  return (
    <ol aria-label={ariaLabel} className="space-y-1" data-zerops-pipeline-steps>
      <Row
        duration={undefined}
        emphasised
        id="calculating"
        sentence={CALCULATING_SENTENCE}
        state="running"
      />
    </ol>
  );
}
