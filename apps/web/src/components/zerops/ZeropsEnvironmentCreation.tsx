/**
 * The checklist a creation shows while it runs — and what it leaves behind
 * when it fails.
 *
 * A real import took two minutes end to end (`verified.md`, 2026-09-05), so
 * this is a list of steps with the one in progress marked, not a spinner. On
 * failure it says which step, what the platform said, and — because a
 * half-built environment is a real project on the account — that the project
 * exists, so nobody creates it twice.
 */
import {
  environmentCreationStepLabel,
  type EnvironmentCreationStepProgress,
} from "@t3tools/client-runtime/zerops";

import { Button } from "../ui/button";
import { ProcessSteps, type ProcessStep } from "./primitives";

export interface ZeropsEnvironmentCreationProps {
  /** What is being created, e.g. "Beviro CRM - production". */
  readonly name: string;
  readonly progress: ReadonlyArray<EnvironmentCreationStepProgress>;
  /** Set once the run has stopped, however it stopped. */
  readonly outcome?:
    | { readonly kind: "handed-off" }
    | { readonly kind: "done" }
    | { readonly kind: "failed"; readonly error: string; readonly projectExists: boolean };
  readonly onDismiss: () => void;
  /** The clock, so a running step's duration ticks; the caller owns the timer. */
  readonly nowMs: number;
}

const STATE_LABEL = {
  queued: "Waiting",
  running: "In progress",
  done: "Done",
  failed: "Failed",
} as const;

export function environmentCreationSteps(
  progress: ReadonlyArray<EnvironmentCreationStepProgress>,
  nowMs: number,
): ReadonlyArray<ProcessStep> {
  return progress.map((entry, index) => {
    const durationMs =
      entry.startedAtMs === undefined
        ? undefined
        : (entry.finishedAtMs ?? nowMs) - entry.startedAtMs;
    return {
      id: `${index}:${entry.step.kind}`,
      label: environmentCreationStepLabel(entry.step),
      state: entry.state,
      stateLabel: STATE_LABEL[entry.state],
      ...(entry.error === undefined ? {} : { note: entry.error }),
      ...(durationMs === undefined ? {} : { durationMs }),
    };
  });
}

export function ZeropsEnvironmentCreation({
  name,
  progress,
  outcome,
  onDismiss,
  nowMs,
}: ZeropsEnvironmentCreationProps) {
  return (
    <section
      className="space-y-3 rounded-xl border border-border/55 bg-card/20 px-4 py-4"
      data-zerops-surface="environment-creation"
      data-zerops-creation-outcome={outcome?.kind ?? "running"}
    >
      <div>
        <h2 className="text-sm font-semibold text-foreground">Creating {name}</h2>
        <p className="text-xs text-muted-foreground">
          {outcome === undefined
            ? "Each step is a platform call with your own token. A first import takes a couple of minutes."
            : outcome.kind === "failed"
              ? outcome.projectExists
                ? "The project exists; the rest did not happen. Fix it from the Zerops dashboard or delete it and try again."
                : "Nothing was created."
              : outcome.kind === "handed-off"
                ? "The agent's container is on its way — the wait continues below."
                : "The environment is up."}
        </p>
      </div>
      <ProcessSteps
        aria-label={`Creating ${name}`}
        steps={environmentCreationSteps(progress, nowMs)}
      />
      {outcome === undefined ? null : (
        <div className="flex justify-end">
          <Button onClick={onDismiss} size="sm" variant="outline">
            {outcome.kind === "failed" ? "Dismiss" : "Back to projects"}
          </Button>
        </div>
      )}
    </section>
  );
}
