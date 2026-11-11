/**
 * A pipeline's steps as its dialog tells them, one under another on a thread: each in the
 * platform's own words — what it does, did or failed to do, the sentences the Zerops GUI speaks —
 * with its duration at the right, ticking while it runs. Under the step that failed stands why:
 * the command that failed and how it ended, the platform's words where they say more, and its
 * code; a failed deploy offers the service's own log around the failure. The compact run card
 * keeps its step names (`PipelineStepList`); this is the pipeline's whole account.
 */
import {
  processFailureWords,
  type ActivityProcess,
} from "@t3tools/client-runtime/zerops/activity/dto";
import {
  formatDuration,
  type PipelineReadout,
  type PipelineReadoutStep,
  type PipelineSpokenState,
} from "@t3tools/client-runtime/zerops/activity/pipelineReadout";
import type { JSX } from "react";

import { cn } from "~/lib/utils";

import { InlineButton } from "../../ui/button";
import { StepGlyph, type StepGlyphState } from "../primitives";
import { PipelineCalculating } from "../operation/PipelineStepList";

const GLYPH_STATE: Readonly<Record<PipelineSpokenState, StepGlyphState>> = {
  waiting: "waiting",
  running: "running",
  activating: "running",
  finished: "done",
  failed: "failed",
  cancelled: "stopped",
};

/** For a reader who does not see the mark. */
const STATE_WORD: Readonly<Record<PipelineSpokenState, string>> = {
  waiting: "Waiting",
  running: "Running",
  activating: "Activating",
  finished: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function PipelineTimeline({
  readout,
  live,
  process,
  service,
  onServiceLog,
}: {
  readonly readout: PipelineReadout;
  readonly live: boolean;
  readonly process: ActivityProcess | undefined;
  readonly service: string;
  /** Shows the service's own log around a deploy's failure, where there is one to show. */
  readonly onServiceLog: (() => void) | undefined;
}): JSX.Element {
  const label = `${service} pipeline steps`;
  if (readout.calculating || readout.steps.length === 0) {
    return live ? (
      <PipelineCalculating aria-label={label} />
    ) : (
      <p className="text-muted-foreground text-sm">Zerops keeps no steps for this pipeline.</p>
    );
  }
  return (
    <ol aria-label={label} className="flex flex-col" data-zerops-pipeline-timeline>
      {readout.steps.map((step, index) => (
        <TimelineStep
          key={step.id}
          last={index === readout.steps.length - 1}
          onServiceLog={step.id === "DEPLOY" ? onServiceLog : undefined}
          process={step.state === "failed" ? process : undefined}
          step={step}
        />
      ))}
    </ol>
  );
}

function TimelineStep({
  step,
  last,
  process,
  onServiceLog,
}: {
  readonly step: PipelineReadoutStep;
  readonly last: boolean;
  readonly process: ActivityProcess | undefined;
  readonly onServiceLog: (() => void) | undefined;
}): JSX.Element {
  const duration = step.durationMs === undefined ? undefined : formatDuration(step.durationMs);
  const quiet = step.state === "waiting" || step.state === "cancelled";
  return (
    <li
      aria-current={step.state === "running" || step.state === "activating" ? "step" : undefined}
      className={cn("relative flex gap-3", !last && "pb-5")}
      data-zerops-pipeline-step={step.id}
      data-zerops-pipeline-state={step.state}
    >
      {last ? null : (
        // The thread from this step's mark down to the next one's.
        <span aria-hidden="true" className="absolute top-6 bottom-1 left-2.5 w-px bg-border" />
      )}
      <span className="flex size-5 shrink-0 items-center justify-center">
        <StepGlyph state={GLYPH_STATE[step.state]} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-3">
          <p
            className={cn(
              "min-w-0 flex-1 text-sm leading-5",
              quiet ? "text-muted-foreground" : "text-foreground",
            )}
          >
            {step.sentence}
            <span className="sr-only"> · {STATE_WORD[step.state]}</span>
          </p>
          {duration === undefined ? null : (
            <span className="shrink-0 text-muted-foreground text-xs leading-5 tabular-nums">
              {duration}
            </span>
          )}
        </div>
        {step.note === undefined ? null : (
          <p className="mt-0.5 text-muted-foreground text-xs">{step.note}</p>
        )}
        {step.state === "failed" ? (
          <FailureCause onServiceLog={onServiceLog} process={process} />
        ) : null}
      </div>
    </li>
  );
}

/** Why the step failed, as the platform said it. Nothing where it said nothing. */
function FailureCause({
  process,
  onServiceLog,
}: {
  readonly process: ActivityProcess | undefined;
  readonly onServiceLog: (() => void) | undefined;
}): JSX.Element | null {
  const error = process?.error;
  const said = process === undefined ? undefined : processFailureWords(process);
  // The platform's generic words ("build command failed") add nothing to the command's own end.
  const words = error?.command !== undefined && said === error.message ? undefined : said;
  if (error?.command === undefined && words === undefined && onServiceLog === undefined) {
    return null;
  }
  return (
    <div
      className="mt-2 flex flex-col gap-1 rounded-lg bg-destructive/8 px-3 py-2 text-sm"
      data-zerops-pipeline-cause
    >
      {error?.command === undefined ? null : (
        <p>
          <code className="font-mono">{error.command}</code>
          {error.exit === undefined ? " failed." : ` ended with ${error.exit}.`}
        </p>
      )}
      {words === undefined ? null : <p className="wrap-anywhere">{words}</p>}
      {error === undefined || error.code === "" ? null : (
        <p className="font-mono text-muted-foreground text-xs">{error.code}</p>
      )}
      {onServiceLog === undefined ? null : (
        <p>
          <InlineButton onClick={onServiceLog}>
            Show the service's log around the failure
          </InlineButton>
        </p>
      )}
    </div>
  );
}
