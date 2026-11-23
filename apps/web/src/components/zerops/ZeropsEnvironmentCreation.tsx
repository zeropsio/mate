/**
 * A stage's or a production's setup as HQ runs it: its application's `environment` operation, or
 * the `deploy_key` operation that finishes an attached one, as
 * navigation shows it on every device (`hqOperationOf`) — how far it got, where it stopped and in
 * whose words, and while its maker's sign-in ran out, their Continue, or an Owner's or an Admin's
 * End where HQ offers it, its maker being unable to continue it. Nothing of it runs in this
 * tab: a closed tab changes nothing, and another device shows the same card.
 */
import {
  operationFailureDetails,
  operationFailureWords,
  type HqOperationStanding,
} from "@t3tools/client-runtime/data";
import type { ReactNode } from "react";

import { Button } from "../ui/button";
import { Progress } from "../ui/progress";
import { ZeropsAnswerDetails } from "./ZeropsAnswerDetails";
import { ZeropsOperationEnd } from "./ZeropsOperationEnd";

/** The steps an `environment` operation goes through, as a person names them. */
const STEPS = [
  "Creating the project",
  "Giving people access",
  "Setting up its deploy key",
  "Adding its services",
] as const;

/** Each phase HQ records (`mate-hq` _Environments are operations_), by the step it is on. */
const PHASE_STEP: Readonly<Record<string, number>> = {
  accepted: 0,
  project_requested: 0,
  project_created: 0,
  project_ready: 1,
  grants_requested: 1,
  key_requested: 2,
  key_kept: 2,
  retire_requested: 2,
  services_requested: 3,
};

/**
 * The step an operation at `phase` is on, by its words; the first for a phase this build does not
 * know, so a newer HQ never takes the card away.
 */
export function environmentSetupStep(phase: string): string {
  return STEPS[PHASE_STEP[phase] ?? 0]!;
}

/** A deploy key's setup: its one step. */
const KEY_STEPS = ["Setting up its deploy key"] as const;

/** A first import as measured end to end (about two minutes): what the row promises. */
const ENVIRONMENT_CREATION_ESTIMATE_MS = 2 * 60_000;

export function ZeropsEnvironmentCreation({
  name,
  kind,
  standing,
  phase,
  startedAtMs,
  nowMs,
  waitingFor,
  onContinue,
  onEnd,
  onStartAgain,
  onDismiss,
}: {
  /** What is being set up, e.g. "Beviro CRM - production", or its application where unknown. */
  readonly name: string;
  /** The operation's kind: `environment`, or `deploy_key` for a key alone. */
  readonly kind: string;
  /** How HQ's `environment` operation on the application stands (`hqOperationOf`). */
  readonly standing: Exclude<HqOperationStanding, { readonly kind: "none" }>;
  /** The phase HQ recorded last. */
  readonly phase: string;
  /** When HQ accepted it, wall ms. */
  readonly startedAtMs: number | null;
  /** The clock, so the running step's duration ticks; the caller owns the timer. */
  readonly nowMs: number;
  /** Whom a stopped setup waits for, by name (`waiting`). */
  readonly waitingFor?: ReactNode;
  /** Gives HQ the person's fresh sign-in: their own setup only. */
  readonly onContinue?: (() => void) | undefined;
  /** Ends it at HQ; given only where HQ offers its end (`endOperationIntent`). */
  readonly onEnd?: (() => void) | undefined;
  /** Opens the form again, for a setup that failed. */
  readonly onStartAgain?: (() => void) | undefined;
  readonly onDismiss: () => void;
}) {
  const keyOnly = kind === "deploy_key";
  const at = keyOnly ? 0 : (PHASE_STEP[phase] ?? 0);
  return (
    <section
      className="space-y-3 rounded-xl border border-border/55 bg-card/20 px-4 py-4"
      data-zerops-surface="environment-creation"
      data-zerops-creation-outcome={standing.kind}
    >
      <h2 className="text-sm font-semibold text-foreground">
        {standing.kind === "failed" ? `${name} didn’t come up` : `Setting up ${name}`}
      </h2>
      <Progress
        at={at}
        endedAtMs={null}
        estimateMs={ENVIRONMENT_CREATION_ESTIMATE_MS}
        label={`Setting up ${name}`}
        nowMs={nowMs}
        startedAtMs={startedAtMs}
        steps={keyOnly ? KEY_STEPS : STEPS}
        view={
          standing.kind === "failed"
            ? {
                state: "failed",
                cause: operationFailureWords(standing.failure),
                details: <FailureDetails standing={standing} />,
              }
            : undefined
        }
      />
      {standing.kind === "waiting" ? (
        <p className="text-xs text-muted-foreground">
          {standing.yours
            ? "Your Zerops sign-in ran out before it finished. Continue gives HQ your current one."
            : waitingFor}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        {standing.kind === "waiting" && onContinue !== undefined ? (
          <Button onClick={onContinue} size="sm">
            Continue
          </Button>
        ) : null}
        {onEnd === undefined ? null : <ZeropsOperationEnd kind={kind} name={name} onEnd={onEnd} />}
        {standing.kind === "failed" && onStartAgain !== undefined ? (
          <Button onClick={onStartAgain} size="sm">
            Start again
          </Button>
        ) : null}
        {standing.kind === "failed" ? (
          <Button onClick={onDismiss} size="sm" variant="secondary">
            Dismiss
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function FailureDetails({
  standing,
}: {
  readonly standing: Extract<HqOperationStanding, { readonly kind: "failed" }>;
}) {
  const details = operationFailureDetails(standing.failure);
  return details === null ? null : <ZeropsAnswerDetails text={details} />;
}
