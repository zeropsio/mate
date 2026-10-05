/**
 * A deploy's pipeline: one row per step the pipeline has, every one of them
 * from its first frame — the state's mark (`StepGlyph`, the one every step
 * list in the card uses), the step's plain name at the card's row size, and
 * once it ended its duration at the right in tabular figures. The marks are
 * the progress (the owner, 2026-10-05: "it should be steps, but they should
 * be visible … without a premade space for logs and … long
 * texts"): a name never changes with the state, and nothing under a step
 * holds room for what may come. The step that is running or failed reads in
 * the ink, a finished one muted, one still to come fainter. Before the
 * platform has worked the steps out of zerops.yml, one row says so.
 *
 * Presentational, props only (R2): every sentence is `readPipeline`'s, every
 * duration `formatDuration`'s. A running step's mark steps in the busy blue,
 * its only motion (R6).
 */
import type { JSX, ReactNode } from "react";

import {
  type PipelineReadoutStep,
  type PipelineSpokenState,
  formatDuration,
} from "@t3tools/client-runtime/zerops/activity/pipelineReadout";

import { cn } from "~/lib/utils";
import { StepGlyph, type StepGlyphState } from "../primitives";

/** The row's state for a reader who does not see the glyph. */
const STATE_WORD: Readonly<Record<PipelineSpokenState, string>> = {
  waiting: "Waiting",
  running: "Running",
  activating: "Activating",
  finished: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

const GLYPH_STATE: Readonly<Record<PipelineSpokenState, StepGlyphState>> = {
  waiting: "waiting",
  running: "running",
  activating: "running",
  finished: "done",
  failed: "failed",
  cancelled: "stopped",
};

const isInFlight = (state: PipelineSpokenState): state is "running" | "activating" =>
  state === "running" || state === "activating";

/** A step by its plain name, the same in every state: its mark says how it stands. */
const STEP_NAME: Readonly<Record<string, string>> = {
  INIT_BUILD_CONTAINER: "Build container",
  RUN_BUILD_COMMANDS: "Build",
  INIT_PREPARE_CONTAINER: "Prepare container",
  RUN_PREPARE_COMMANDS: "Prepare runtime",
  DEPLOY: "Deploy",
};

function Row({
  after,
  beneath,
  duration,
  emphasised,
  id,
  sentence,
  state,
}: {
  /** What belongs to this step on its own line, at its end — the way to the build's log. */
  readonly after?: ReactNode;
  /** What only a failure adds under its step: why, in one line. */
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
      <span className="flex h-5 shrink-0 items-center" data-zerops-pipeline-glyph={state}>
        <StepGlyph state={GLYPH_STATE[state]} />
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block text-line leading-5",
            emphasised
              ? "text-foreground"
              : state === "waiting"
                ? "text-muted-foreground/70"
                : "text-muted-foreground",
          )}
        >
          {sentence}
          {/* Its name never says how it stands: its mark does, and this for a reader without it. */}
          <span className="sr-only"> · {STATE_WORD[state]}</span>
        </span>
        {beneath}
      </span>
      {after}
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
  after,
  beneath,
}: {
  readonly "aria-label": string;
  readonly steps: ReadonlyArray<PipelineStepRow>;
  /** What stands at the end of a step's line, by the step's id. */
  readonly after?: Readonly<Partial<Record<string, ReactNode>>> | undefined;
  /** What stands under a step, by the step's id. */
  readonly beneath?: Readonly<Partial<Record<string, ReactNode>>> | undefined;
}): JSX.Element {
  return (
    <ol aria-label={ariaLabel} className="space-y-1" data-zerops-pipeline-steps>
      {steps.map((step) => (
        <Row
          after={after?.[step.id]}
          beneath={beneath?.[step.id]}
          // One clock ticks, the line's: a step says how long it took once it ended.
          duration={
            step.durationMs === undefined || isInFlight(step.state) || step.state === "waiting"
              ? undefined
              : formatDuration(step.durationMs)
          }
          emphasised={isInFlight(step.state) || step.state === "failed"}
          id={step.id}
          key={step.id}
          sentence={STEP_NAME[step.id] ?? step.sentence}
          state={step.state}
        />
      ))}
    </ol>
  );
}

/** What the one row says while the platform works the steps out of zerops.yml. */
const CALCULATING_WORDS = "Reading zerops.yml";

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
        sentence={CALCULATING_WORDS}
        state="running"
      />
    </ol>
  );
}
