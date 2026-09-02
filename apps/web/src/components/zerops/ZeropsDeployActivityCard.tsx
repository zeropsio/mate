/**
 * The platform-activity overlay for a `zerops_deploy` card — the pending row
 * while the tool call is still running, and the continuation strip appended
 * below a resolved `BUILD_TRIGGERED` verdict (§4's one allowlisted exception).
 *
 * Every string this renders carries the word "Platform": the overlay is
 * advisory observation, never the card's verdict — `../../../../zcp/plans/mate-live-activity-2026-09-02.md` §0, §5.
 */
import type { ActivityState } from "@t3tools/client-runtime/zerops/activity/reducer";
import {
  PIPELINE_STEPS,
  pipelineTerminalOutcome,
  type PipelineState,
  type PipelineStepStatus,
} from "@t3tools/client-runtime/zerops/activity/pipelineState";
import type { ActivityProcess } from "@t3tools/client-runtime/zerops/activity/dto";

import {
  Chip,
  FlatCard,
  MicroLabel,
  ProcessSteps,
  StatusDot,
  type ProcessStep,
} from "./primitives";

function elapsedLabel(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.round(seconds / 60)}m`;
}

const STEP_STATE: Record<PipelineStepStatus, ProcessStep["state"]> = {
  waiting: "queued",
  running: "running",
  activating: "running",
  finished: "done",
  cancelled: "failed",
  failed: "failed",
  noop: "queued",
};

function pipelineSteps(pipeline: PipelineState): ReadonlyArray<ProcessStep> {
  return PIPELINE_STEPS.filter((step) => pipeline[step.id] !== "noop").map((step) => ({
    id: step.id,
    label: step.label,
    state: STEP_STATE[pipeline[step.id]],
    stateLabel: pipeline[step.id],
  }));
}

function chipLabel(process: ActivityProcess): string {
  return `${process.actionName} · ${process.status}`;
}

/**
 * The overlay body for one activity state, or `null` for `idle`/`unavailable`
 * — those two render nothing here; the caller falls back to the ordinary row
 * (§5's table: "today's generic pending tool row, byte-identical").
 */
export function DeployPlatformOverlayBody({
  hostname,
  state,
}: {
  readonly hostname: string;
  readonly state: ActivityState;
}): React.ReactElement | null {
  switch (state.kind) {
    case "idle":
    case "unavailable":
      return null;

    case "resolved": {
      // §4's one exception: BUILD_TRIGGERED keeps this below the card's own
      // verdict while the platform continues. Every other resolved status —
      // no `continuation` — renders nothing; the overlay is frozen (§4).
      //
      // The agent's OWN result has already landed here (that is what makes
      // this `resolved`), so — unlike `settledOnPlatform` on the pending
      // path — this copy never says "waiting for the agent's result": there
      // is nothing left to wait for. It uses the same "as of Ns ago" /
      // "Platform reports X" lines as the still-running observed state.
      if (state.continuation === undefined) {
        return null;
      }
      const outcome = pipelineTerminalOutcome(state.continuation.pipeline);
      return (
        <div className="space-y-2" data-zerops-activity-overlay="continuation">
          <ProcessSteps
            aria-label={`Platform build steps for ${hostname}`}
            steps={pipelineSteps(state.continuation.pipeline)}
          />
          <p className="text-muted-foreground text-xs">
            {outcome === undefined
              ? `Platform · as of ${elapsedLabel(Date.now() - state.continuation.atMs)} ago`
              : `Platform reports ${outcome}`}
          </p>
        </div>
      );
    }

    case "searching":
      return (
        <p className="text-muted-foreground" data-zerops-activity-overlay="searching">
          Platform: no activity for {hostname} yet · {elapsedLabel(state.elapsedMs)}
        </p>
      );

    case "observed":
      return (
        <div className="space-y-2" data-zerops-activity-overlay="observed">
          <ProcessSteps
            aria-label={`Platform build steps for ${hostname}`}
            steps={pipelineSteps(state.observation.pipeline)}
          />
          <p className="text-muted-foreground text-xs">
            Platform · as of {elapsedLabel(Date.now() - state.observation.atMs)} ago
          </p>
          {state.observation.chips.length === 0 ? null : (
            <div aria-label="Platform activity" className="flex flex-wrap gap-1.5">
              {state.observation.chips.map((chip) => (
                <Chip
                  key={chip.id}
                  data-zerops-chip-kind="info"
                  label={chipLabel(chip)}
                  tone="off"
                />
              ))}
            </div>
          )}
        </div>
      );

    case "settledOnPlatform":
      return (
        <div className="space-y-2" data-zerops-activity-overlay="settled">
          <ProcessSteps
            aria-label={`Platform build steps for ${hostname}`}
            steps={pipelineSteps(state.observation.pipeline)}
          />
          <p className="text-muted-foreground text-xs">
            Platform reports {state.outcome} · waiting for the agent's result
          </p>
        </div>
      );

    case "stale":
      return (
        <div className="space-y-2 opacity-60" data-zerops-activity-overlay="stale">
          <ProcessSteps
            aria-label={`Platform build steps for ${hostname}`}
            steps={pipelineSteps(state.observation.pipeline)}
          />
          <p className="text-muted-foreground text-xs">
            Platform: stale ({elapsedLabel(state.staleMs)})
          </p>
        </div>
      );
  }
}

/**
 * Whether `ZeropsDeployPendingCard` has anything to draw for this state.
 *
 * A POSITIVE list on purpose: `idle` and `unavailable` fall back to the
 * ordinary generic pending row by design, and so must every OTHER state not
 * yet named here — notably `resolved`, reachable when a result lands with an
 * undecodable body while the row still reads `toolLifecycleStatus ===
 * "inProgress"` (event ordering). A negative list (`!== "idle" && !==
 * "unavailable"`) would let that `resolved` case through and render an empty
 * "Deploy · hostname / Running" shell with no body content.
 */
export function activityStateHasPendingOverlayContent(
  state: ActivityState,
): state is Extract<
  ActivityState,
  { kind: "searching" | "observed" | "settledOnPlatform" | "stale" }
> {
  return (
    state.kind === "searching" ||
    state.kind === "observed" ||
    state.kind === "settledOnPlatform" ||
    state.kind === "stale"
  );
}

/**
 * The standalone pending-deploy card. The caller renders this only when
 * {@link activityStateHasPendingOverlayContent} says there is something to
 * show — `idle`/`unavailable`/`resolved` fall back to the ordinary generic
 * pending tool row instead of this component, so that row stays
 * byte-identical to today's.
 */
export function ZeropsDeployPendingCard({
  hostname,
  state,
}: {
  readonly hostname: string;
  readonly state: ActivityState;
}) {
  return (
    <FlatCard className="overflow-hidden" data-zerops-card data-zerops-card-kind="deploy-pending">
      <header className="bg-[var(--zerops-status-busy-surface)] px-3 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <MicroLabel>{`Deploy · ${hostname}`}</MicroLabel>
          <span aria-label="Result status" role="status">
            <StatusDot label="Running" pulse tone="busy" />
          </span>
        </div>
      </header>
      <div className="space-y-3 px-3 py-3 text-xs leading-relaxed">
        <DeployPlatformOverlayBody hostname={hostname} state={state} />
      </div>
    </FlatCard>
  );
}
