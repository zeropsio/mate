/**
 * A creation's progress row while it runs — and what it leaves behind when it
 * fails.
 *
 * A real import took two minutes end to end (`verified.md`, 2026-09-05), so
 * this is the kit's progress row, its step words replaced in place, not a
 * spinner. On failure it says which step, keeps what the platform said under
 * Details, and — because a half-built environment is a real project on the
 * account — that the project exists, so nobody creates it twice.
 */
import {
  environmentCreationStepLabel,
  type EnvironmentCreationStepProgress,
  type ServiceDeployment,
} from "@t3tools/client-runtime/zerops";
import { CHECKING_WHAT_RUNS, DEPLOYMENT_SURFACE } from "@t3tools/client-runtime/zerops/flow";
import { knownPresentation } from "@t3tools/client-runtime/zerops/knowledge";

import { Button } from "../ui/button";
import { Progress } from "../ui/progress";
import type { ProcessStep } from "./primitives";

export interface ZeropsEnvironmentCreationProps {
  /** What is being created, e.g. "Beviro CRM - production". */
  readonly name: string;
  readonly progress: ReadonlyArray<EnvironmentCreationStepProgress>;
  /** Set once the run has stopped, however it stopped. */
  readonly outcome?:
    | { readonly kind: "handed-off" }
    | {
        readonly kind: "done";
        readonly deployments: ReadonlyArray<ServiceDeployment>;
        /** The project it made, whose line on the card goes on saying what runs there. */
        readonly projectId?: string | undefined;
      }
    | { readonly kind: "failed"; readonly error: string; readonly projectExists: boolean };
  readonly onDismiss: () => void;
  /**
   * What is being created, so an undeployed service can say where its first
   * deploy comes from instead of handing the reader to another product.
   */
  readonly tier?: "mate" | "stage" | "production";
  /** The clock, so a running step's duration ticks; the caller owns the timer. */
  readonly nowMs: number;
  /**
   * Something runs or builds there now, as the platform says it: what the services were set up
   * without is past, and the place's own line says the rest.
   */
  readonly deployed?: boolean | undefined;
}

/**
 * What the environment runs, once it is set up. The one negative, "nothing
 * deployed yet", is earned only when every service's deployment is known
 * (DESIGN §3.4): a service not yet read, or whose read failed, is what the
 * sentence says instead.
 */
function upNote(
  tier: ZeropsEnvironmentCreationProps["tier"],
  deployments: ReadonlyArray<ServiceDeployment>,
  nowMs: number,
  deployed: boolean,
): string {
  if (tier === "production" && deployments.length === 0)
    return "Production and its access are reserved. Its services arrive with the first approved release.";
  // The done card stays until dismissed: its first answer must not outlive the place's own line.
  if (deployed) return "The environment is set up.";
  const unknown = deployments.find(({ deployment }) => deployment.state !== "known");
  if (unknown !== undefined) {
    const presentation = knownPresentation(unknown.deployment, DEPLOYMENT_SURFACE, {
      nowMs,
      updateOffered: false,
    });
    return `The environment is set up. ${presentation.message?.text ?? CHECKING_WHAT_RUNS}`;
  }
  const undeployed = deployments
    .filter(({ deployment }) => deployment.state === "known" && deployment.value.kind === "none")
    .map(({ service }) => service);
  return undeployed.length === 0 ? "The environment is set up." : undeployedNote(tier, undeployed);
}

/**
 * What to say about services an environment came up without.
 *
 * Every tier fills itself, and each from somewhere different: a stage tracks
 * `main` and HQ deploys the difference on its own; a production runs
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
    // The card does not see HQ's deploy of it, nor what holds that deploy (run 4: 4.6 min under
    // "within a few minutes"); the stage's own line does.
    case "stage":
      return `The environment is set up. ${subject} — its first deploy of main shows on its line above.`;
    case "production":
      return `The environment is set up. ${subject}: a production runs what a release names, so it fills on the next release.`;
    default:
      return `The environment is set up. ${subject} — the agent sets the application up.`;
  }
}

/**
 * Whether a set-up card has said all it had to: it set the place up, and the place runs at its
 * address — its own line on the card says that, so the card goes by itself. A failure stays.
 */
export function creationSettled(input: {
  readonly outcome: "done" | "failed" | "handed-off" | undefined;
  readonly runs: boolean;
  readonly addressed: boolean;
}): boolean {
  return input.outcome === "done" && input.runs && input.addressed;
}

/** Creating it while it runs, then what became of it: up, or not. */
function creationTitle(name: string, outcome: ZeropsEnvironmentCreationProps["outcome"]): string {
  switch (outcome?.kind) {
    case "done":
      return `${name} is set up`;
    case "failed":
      return `${name} didn’t come up`;
    default:
      return `Creating ${name}`;
  }
}

const STATE_LABEL = {
  queued: "Waiting",
  running: "In progress",
  done: "Done",
  failed: "Failed",
} as const;

/** What a tier's steps call it: a stage and production by name, a Mate's as "it". */
const STEP_SUBJECT = { stage: "the stage", production: "production", mate: undefined } as const;

export function environmentCreationSteps(
  progress: ReadonlyArray<EnvironmentCreationStepProgress>,
  nowMs: number,
  tier?: ZeropsEnvironmentCreationProps["tier"],
): ReadonlyArray<ProcessStep> {
  const subject = tier === undefined ? undefined : STEP_SUBJECT[tier];
  return progress.map((entry, index) => {
    const durationMs =
      entry.startedAtMs === undefined
        ? undefined
        : (entry.finishedAtMs ?? nowMs) - entry.startedAtMs;
    return {
      id: `${index}:${entry.step.kind}`,
      label: environmentCreationStepLabel(entry.step, { subject }),
      state: entry.state,
      stateLabel: STATE_LABEL[entry.state],
      ...(entry.error === undefined ? {} : { note: entry.error }),
      ...(durationMs === undefined ? {} : { durationMs }),
    };
  });
}

/**
 * Where a creation has got, in one line: the step that failed, or the one under way, or the next —
 * the last once all are done — by its words, and when the first began. A stage being added says it
 * on its card's Stage line, where the stage will stand; `undefined` before its plan is known.
 */
export function creationNow(
  progress: ReadonlyArray<EnvironmentCreationStepProgress>,
  tier: ZeropsEnvironmentCreationProps["tier"],
): { readonly step: string | undefined; readonly startedAtMs: number | null } {
  const steps = environmentCreationSteps(progress, 0, tier);
  const now =
    steps.find((step) => step.state === "failed") ??
    steps.find((step) => step.state === "running") ??
    steps.find((step) => step.state === "queued") ??
    steps.at(-1);
  return {
    step: now?.label,
    startedAtMs: progress.find((entry) => entry.startedAtMs !== undefined)?.startedAtMs ?? null,
  };
}

/** A first import as measured end to end (about two minutes): what the row promises. */
export const ENVIRONMENT_CREATION_ESTIMATE_MS = 2 * 60_000;

export function ZeropsEnvironmentCreation({
  name,
  progress,
  outcome,
  onDismiss,
  tier,
  nowMs,
  deployed = false,
}: ZeropsEnvironmentCreationProps) {
  const steps = environmentCreationSteps(progress, nowMs, tier);
  const failedAt = steps.findIndex((step) => step.state === "failed");
  const runningAt = steps.findIndex((step) => step.state === "running");
  const queuedAt = steps.findIndex((step) => step.state === "queued");
  const at =
    failedAt !== -1
      ? failedAt
      : runningAt !== -1
        ? runningAt
        : queuedAt !== -1
          ? queuedAt
          : steps.length - 1;
  const startedAtMs =
    progress.find((entry) => entry.startedAtMs !== undefined)?.startedAtMs ?? null;
  const endedAtMs =
    progress.findLast((entry) => entry.finishedAtMs !== undefined)?.finishedAtMs ?? null;
  const line =
    outcome === undefined
      ? null
      : outcome.kind === "failed"
        ? outcome.projectExists
          ? "The project exists; the rest did not happen. Fix it from the Zerops dashboard or delete it and try again."
          : "Nothing was created."
        : outcome.kind === "handed-off"
          ? "Its Mate is on its way — the wait continues below."
          : null;
  const failedStep = failedAt === -1 ? undefined : steps[failedAt];
  return (
    <section
      className="space-y-3 rounded-xl border border-border/55 bg-card/20 px-4 py-4"
      data-zerops-surface="environment-creation"
      data-zerops-creation-outcome={outcome?.kind ?? "running"}
    >
      <h2 className="text-sm font-semibold text-foreground">{creationTitle(name, outcome)}</h2>
      <Progress
        at={at}
        endedAtMs={outcome === undefined || outcome.kind === "handed-off" ? null : endedAtMs}
        estimateMs={ENVIRONMENT_CREATION_ESTIMATE_MS}
        label={`Creating ${name}`}
        nowMs={nowMs}
        startedAtMs={startedAtMs}
        steps={steps.map((step) => step.label)}
        view={
          outcome?.kind === "failed"
            ? {
                state: "failed",
                cause:
                  failedStep === undefined
                    ? `${name} didn’t come up.`
                    : `${failedStep.label} didn’t finish.`,
                details: failedStep?.note ?? outcome.error,
              }
            : outcome?.kind === "done"
              ? { state: "done", result: upNote(tier, outcome.deployments, nowMs, deployed) }
              : undefined
        }
      />
      {line === null ? null : <p className="text-xs text-muted-foreground">{line}</p>}
      {outcome === undefined ? null : (
        <div className="flex justify-end">
          <Button onClick={onDismiss} size="sm" variant="secondary">
            {/* It stands on the projects page: closing it goes nowhere else. */}
            Dismiss
          </Button>
        </div>
      )}
    </section>
  );
}
