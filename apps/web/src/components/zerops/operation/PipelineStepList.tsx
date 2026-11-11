/**
 * A deploy's pipeline: one row per step the pipeline has, every one of them
 * from its first frame — the state's mark (`StepGlyph`, the one every step
 * list in the card uses), the step's plain name at the card's row size, and
 * once it ended its duration at the right in tabular figures, at the size and
 * on the edge of the time of the line it stands under. The marks are
 * the progress (the owner, 2026-10-05: "it should be steps, but they should
 * be visible … without a premade space for logs and … long
 * texts"): a name never changes with the state, and nothing under a step
 * holds room for what may come. The step that is running or failed reads in
 * the ink, a finished one muted with its mark (three green rings under a line
 * that already says "Deployed" said nothing more), one still to come fainter. Before the
 * platform has worked the steps out of zerops.yml, one row says so. A batch deploy draws one such
 * list per service (`BatchServiceRows`).
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
  /** What belongs to this step on its own line, after its name — the way to the build's log. */
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
        {/* A step that went through is the list's quiet: only the one running and one that broke wear a colour. */}
        <StepGlyph
          state={GLYPH_STATE[state]}
          {...(state === "finished" ? { className: "text-muted-foreground" } : {})}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2.5">
          <span
            className={cn(
              "min-w-0 text-line leading-5",
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
          {after}
        </span>
        {beneath}
      </span>
      {duration !== undefined ? (
        // Under a line of the run's log the times end where the line's own does (`.line-time`).
        <span
          className="line-time shrink-0 text-line text-muted-foreground leading-5 tabular-nums"
          data-zerops-pipeline-duration
        >
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
  ticking = false,
}: {
  readonly "aria-label": string;
  readonly steps: ReadonlyArray<PipelineStepRow>;
  /**
   * The step under way says how long it has run. A single deploy's line carries that clock; in a
   * batch each service's list has its own.
   */
  readonly ticking?: boolean;
  /** What stands after a step's name on its line, by the step's id. */
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
            step.durationMs === undefined ||
            step.state === "waiting" ||
            (isInFlight(step.state) && !ticking)
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
