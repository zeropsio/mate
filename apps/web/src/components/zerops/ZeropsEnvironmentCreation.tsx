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
  type ServiceDeployment,
} from "@t3tools/client-runtime/zerops";
import { CHECKING_WHAT_RUNS, DEPLOYMENT_SURFACE } from "@t3tools/client-runtime/zerops/flow";
import { knownPresentation } from "@t3tools/client-runtime/zerops/knowledge";

import { Button } from "../ui/button";
import { ProcessSteps, type ProcessStep } from "./primitives";

export interface ZeropsEnvironmentCreationProps {
  /** What is being created, e.g. "Beviro CRM - production". */
  readonly name: string;
  readonly progress: ReadonlyArray<EnvironmentCreationStepProgress>;
  /** Set once the run has stopped, however it stopped. */
  readonly outcome?:
    | { readonly kind: "handed-off" }
    | { readonly kind: "done"; readonly deployments: ReadonlyArray<ServiceDeployment> }
    | { readonly kind: "failed"; readonly error: string; readonly projectExists: boolean };
  readonly onDismiss: () => void;
  /**
   * What is being created, so an undeployed service can say where its first
   * deploy comes from instead of handing the reader to another product.
   */
  readonly tier?: "mate" | "stage" | "production";
  /** The clock, so a running step's duration ticks; the caller owns the timer. */
  readonly nowMs: number;
}

/**
 * What the environment runs, once it is up. The one negative, "nothing
 * deployed yet", is earned only when every service's deployment is known
 * (DESIGN §3.4): a service not yet read, or whose read failed, is what the
 * sentence says instead.
 */
function upNote(
  tier: ZeropsEnvironmentCreationProps["tier"],
  deployments: ReadonlyArray<ServiceDeployment>,
  nowMs: number,
): string {
  const unknown = deployments.find(({ deployment }) => deployment.state !== "known");
  if (unknown !== undefined) {
    const presentation = knownPresentation(unknown.deployment, DEPLOYMENT_SURFACE, {
      nowMs,
      updateOffered: false,
    });
    return `The environment is up. ${presentation.message?.text ?? CHECKING_WHAT_RUNS}`;
  }
  const undeployed = deployments
    .filter(({ deployment }) => deployment.state === "known" && deployment.value.kind === "none")
    .map(({ service }) => service);
  return undeployed.length === 0 ? "The environment is up." : undeployedNote(tier, undeployed);
}

/**
 * What to say about services an environment came up without.
 *
 * Every tier fills itself, and each from somewhere different: a stage tracks
 * `main` and the broker deploys the difference on its own; a production runs
 * what a release names; a Mate's own services are the agent's to set up. The
 * one sentence for all three sent the reader to the Zerops dashboard for work
 * that was already on its way (measured 2026-09-20).
 */
export function undeployedNote(
  tier: ZeropsEnvironmentCreationProps["tier"],
  undeployed: ReadonlyArray<string>,
): string {
  const subject = `${undeployed.join(", ")} ${undeployed.length === 1 ? "has" : "have"} nothing deployed yet`;
  switch (tier) {
    case "stage":
      return `The environment is up. ${subject} — main lands here on its own, usually within a few minutes.`;
    case "production":
      return `The environment is up. ${subject}: a production runs what a release names, so it fills on the next release.`;
    default:
      return `The environment is up. ${subject} — the agent sets the application up.`;
  }
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
  tier,
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
                : upNote(tier, outcome.deployments, nowMs)}
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
