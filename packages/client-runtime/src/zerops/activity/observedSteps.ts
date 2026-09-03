/**
 * `getPipelineState`'s five steps, with the copy and per-step durations a
 * card renders — `../plans/mate-chat-output-concept-2026-09-03.md` §3
 * "Observation", §5 (the deploy card). A `noop` step (nothing to show for
 * it, e.g. a start-without-code deploy with no build) is omitted rather than
 * rendered as an empty row.
 */
import { type PipelineState, type PipelineStepStatus, getPipelineState } from "./pipelineState.ts";
import type { ActivityAppVersion } from "./dto.ts";

export interface ObservedStep {
  readonly id: keyof PipelineState;
  readonly label: string;
  readonly state: "queued" | "running" | "done" | "failed";
  readonly stateLabel: string;
  readonly startedAt?: string;
  readonly endedAt?: string;
  /** `endedAt − startedAt`, or `nowMs − startedAt` while the step is still running/activating. */
  readonly durationMs?: number;
}

const STEP_ORDER: ReadonlyArray<keyof PipelineState> = [
  "INIT_BUILD_CONTAINER",
  "RUN_BUILD_COMMANDS",
  "INIT_PREPARE_CONTAINER",
  "RUN_PREPARE_COMMANDS",
  "DEPLOY",
];

const LABELS: Record<keyof PipelineState, string> = {
  INIT_BUILD_CONTAINER: "Build container",
  RUN_BUILD_COMMANDS: "Build",
  INIT_PREPARE_CONTAINER: "Prepare container",
  RUN_PREPARE_COMMANDS: "Prepare runtime",
  DEPLOY: "Deploy",
};

/** `noop` is never looked up here — the caller skips it before rendering. */
const STATE: Record<Exclude<PipelineStepStatus, "noop">, ObservedStep["state"]> = {
  waiting: "queued",
  running: "running",
  finished: "done",
  failed: "failed",
  cancelled: "failed",
  activating: "running",
};

const STATE_LABEL: Record<Exclude<PipelineStepStatus, "noop">, string> = {
  waiting: "Queued",
  running: "Running",
  finished: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
  activating: "Activating",
};

interface StepTimestamps {
  readonly startedAt: string | undefined;
  readonly endedAt: string | undefined;
}

function timestampsFor(
  id: keyof PipelineState,
  appVersion: ActivityAppVersion | undefined,
): StepTimestamps {
  const build = appVersion?.build;
  const prepare = appVersion?.prepareCustomRuntime;
  switch (id) {
    case "INIT_BUILD_CONTAINER":
      return { startedAt: build?.pipelineStart, endedAt: build?.startDate };
    case "RUN_BUILD_COMMANDS":
      return { startedAt: build?.startDate, endedAt: build?.endDate };
    case "INIT_PREPARE_CONTAINER":
      return { startedAt: build?.endDate ?? build?.pipelineStart, endedAt: prepare?.startDate };
    case "RUN_PREPARE_COMMANDS":
      return { startedAt: prepare?.startDate, endedAt: prepare?.endDate };
    case "DEPLOY":
      return {
        startedAt: prepare?.endDate ?? build?.endDate,
        endedAt: appVersion?.activationDate ?? build?.pipelineFinish,
      };
  }
}

function parseMs(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : ms;
}

function durationFor(
  raw: PipelineStepStatus,
  startedAt: string | undefined,
  endedAt: string | undefined,
  nowMs: number,
): number | undefined {
  const startedAtMs = parseMs(startedAt);
  if (startedAtMs === undefined) {
    return undefined;
  }
  const endedAtMs = parseMs(endedAt);
  if (endedAtMs !== undefined) {
    return Math.max(0, endedAtMs - startedAtMs);
  }
  return raw === "running" || raw === "activating" ? Math.max(0, nowMs - startedAtMs) : undefined;
}

export function observedSteps(
  appVersion: ActivityAppVersion | undefined,
  nowMs: number,
): ReadonlyArray<ObservedStep> {
  const pipeline = getPipelineState(appVersion);
  const steps: ObservedStep[] = [];

  for (const id of STEP_ORDER) {
    const raw = pipeline[id];
    if (raw === "noop") {
      continue;
    }
    const { startedAt, endedAt } = timestampsFor(id, appVersion);
    const durationMs = durationFor(raw, startedAt, endedAt, nowMs);
    steps.push({
      id,
      label: LABELS[id],
      state: STATE[raw],
      stateLabel: STATE_LABEL[raw],
      ...(startedAt === undefined ? {} : { startedAt }),
      ...(endedAt === undefined ? {} : { endedAt }),
      ...(durationMs === undefined ? {} : { durationMs }),
    });
  }

  return steps;
}
