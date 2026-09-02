/**
 * Port of frontend-legacy's `getPipelineState`
 * (`libs/zui/src/build-state-steps/build-state-steps.utils.ts`) — a pure
 * function of one `appVersion` reading into the same five build/prepare/deploy
 * steps the Zerops GUI shows, no percent, driven by status + timestamp
 * presence only.
 *
 * Field names are camelCased to match {@link ActivityAppVersion}; the branch
 * structure and step keys are otherwise unchanged from the FE source so this
 * stays diffable against it.
 */
import type { ActivityAppVersion } from "./dto.ts";

export type PipelineStepStatus =
  | "waiting"
  | "running"
  | "finished"
  | "failed"
  | "noop"
  | "cancelled"
  | "activating";

export interface PipelineState {
  readonly INIT_BUILD_CONTAINER: PipelineStepStatus;
  readonly RUN_BUILD_COMMANDS: PipelineStepStatus;
  readonly INIT_PREPARE_CONTAINER: PipelineStepStatus;
  readonly RUN_PREPARE_COMMANDS: PipelineStepStatus;
  readonly DEPLOY: PipelineStepStatus;
}

/** Rendering order + label for each step, for callers building a step list. */
export const PIPELINE_STEPS: ReadonlyArray<{
  readonly id: keyof PipelineState;
  readonly label: string;
}> = [
  { id: "INIT_BUILD_CONTAINER", label: "Init build container" },
  { id: "RUN_BUILD_COMMANDS", label: "Run build commands" },
  { id: "INIT_PREPARE_CONTAINER", label: "Init prepare container" },
  { id: "RUN_PREPARE_COMMANDS", label: "Run prepare commands" },
  { id: "DEPLOY", label: "Deploy" },
];

const ALL = (status: PipelineStepStatus): PipelineState => ({
  INIT_BUILD_CONTAINER: status,
  RUN_BUILD_COMMANDS: status,
  INIT_PREPARE_CONTAINER: status,
  RUN_PREPARE_COMMANDS: status,
  DEPLOY: status,
});

export function getPipelineState(appVersion?: ActivityAppVersion): PipelineState {
  if (appVersion) {
    const build = appVersion.build;
    const prepare = appVersion.prepareCustomRuntime;
    const status = appVersion.status;

    if (status === "WAITING_TO_BUILD" && !build?.pipelineStart) {
      return ALL("waiting");
    }

    if (
      (status === "BUILDING" || (!!build?.pipelineStart && status === "WAITING_TO_BUILD")) &&
      !build?.startDate
    ) {
      return {
        INIT_BUILD_CONTAINER: "running",
        RUN_BUILD_COMMANDS: "waiting",
        INIT_PREPARE_CONTAINER: "waiting",
        RUN_PREPARE_COMMANDS: "waiting",
        DEPLOY: "waiting",
      };
    }

    if (status === "CANCELLED" && !build?.startDate && !build?.endDate && !!build?.pipelineFailed) {
      return ALL("cancelled");
    }

    if (status === "BUILDING" && !!build?.startDate && !build?.endDate) {
      return {
        INIT_BUILD_CONTAINER: "finished",
        RUN_BUILD_COMMANDS: "running",
        INIT_PREPARE_CONTAINER: "waiting",
        RUN_PREPARE_COMMANDS: "waiting",
        DEPLOY: "waiting",
      };
    }

    if (
      (status === "PREPARING_RUNTIME" ||
        (status === "BUILDING" && !!build?.endDate) ||
        (status === "DEPLOYING" && !!build?.endDate && !!prepare)) &&
      !prepare?.startDate
    ) {
      return {
        INIT_BUILD_CONTAINER: "finished",
        RUN_BUILD_COMMANDS: "finished",
        INIT_PREPARE_CONTAINER: "running",
        RUN_PREPARE_COMMANDS: "waiting",
        DEPLOY: "waiting",
      };
    }

    if (status === "PREPARING_RUNTIME" && !!prepare?.startDate) {
      return {
        INIT_BUILD_CONTAINER: "finished",
        RUN_BUILD_COMMANDS: "finished",
        INIT_PREPARE_CONTAINER: "finished",
        RUN_PREPARE_COMMANDS: prepare.endDate ? "finished" : "running",
        DEPLOY: "waiting",
      };
    }

    if (status === "WAITING_TO_DEPLOY") {
      return {
        INIT_BUILD_CONTAINER: "finished",
        RUN_BUILD_COMMANDS: "finished",
        INIT_PREPARE_CONTAINER: "finished",
        RUN_PREPARE_COMMANDS: "finished",
        DEPLOY: "waiting",
      };
    }

    if (status === "DEPLOYING" && (!prepare || prepare.endDate)) {
      return {
        INIT_BUILD_CONTAINER: "finished",
        RUN_BUILD_COMMANDS: "finished",
        INIT_PREPARE_CONTAINER: "finished",
        RUN_PREPARE_COMMANDS: "finished",
        DEPLOY: appVersion.activationDate ? "activating" : "running",
      };
    }

    if (status === "BUILD_FAILED" && !build?.startDate) {
      return {
        INIT_BUILD_CONTAINER: "failed",
        RUN_BUILD_COMMANDS: "cancelled",
        INIT_PREPARE_CONTAINER: "cancelled",
        RUN_PREPARE_COMMANDS: "cancelled",
        DEPLOY: "cancelled",
      };
    }

    if (status === "BUILD_FAILED" && !!build?.startDate) {
      return {
        INIT_BUILD_CONTAINER: "finished",
        RUN_BUILD_COMMANDS: "failed",
        INIT_PREPARE_CONTAINER: "cancelled",
        RUN_PREPARE_COMMANDS: "cancelled",
        DEPLOY: "cancelled",
      };
    }

    if (status === "PREPARING_RUNTIME_FAILED" && !prepare?.startDate) {
      return {
        INIT_BUILD_CONTAINER: "finished",
        RUN_BUILD_COMMANDS: "finished",
        INIT_PREPARE_CONTAINER: "failed",
        RUN_PREPARE_COMMANDS: "cancelled",
        DEPLOY: "cancelled",
      };
    }

    if (status === "PREPARING_RUNTIME_FAILED" && !!prepare?.startDate) {
      return {
        INIT_BUILD_CONTAINER: "finished",
        RUN_BUILD_COMMANDS: "finished",
        INIT_PREPARE_CONTAINER: "finished",
        RUN_PREPARE_COMMANDS: "failed",
        DEPLOY: "cancelled",
      };
    }

    if (status === "DEPLOY_FAILED") {
      return {
        INIT_BUILD_CONTAINER: "finished",
        RUN_BUILD_COMMANDS: "finished",
        INIT_PREPARE_CONTAINER: "finished",
        RUN_PREPARE_COMMANDS: "finished",
        DEPLOY: "failed",
      };
    }

    if (status === "ACTIVE" || status === "BACKUP") {
      return {
        INIT_BUILD_CONTAINER: build ? "finished" : "noop",
        RUN_BUILD_COMMANDS: build ? "finished" : "noop",
        INIT_PREPARE_CONTAINER: prepare ? "finished" : "noop",
        RUN_PREPARE_COMMANDS: prepare ? "finished" : "noop",
        DEPLOY: "finished",
      };
    }
  }

  return ALL("noop");
}

/**
 * The DEPLOY step is the pipeline's last step, so it is the one whose state
 * says whether the whole pipeline has settled. `undefined` covers both "still
 * running" and the `noop` fallback for missing/unrecognised data — neither is
 * a terminal reading, so a caller must not mistake it for one.
 */
export function pipelineTerminalOutcome(
  pipeline: PipelineState,
): "finished" | "failed" | "cancelled" | undefined {
  return pipeline.DEPLOY === "finished" ||
    pipeline.DEPLOY === "failed" ||
    pipeline.DEPLOY === "cancelled"
    ? pipeline.DEPLOY
    : undefined;
}
