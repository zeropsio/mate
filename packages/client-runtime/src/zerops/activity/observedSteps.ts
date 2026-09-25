/**
 * `getPipelineState`'s five steps, with the copy and per-step durations a
 * card renders — `../plans/mate-chat-output-concept-2026-09-03.md` §3
 * "Observation", §5 (the deploy card). A `noop` step (nothing to show for
 * it, e.g. a start-without-code deploy with no build) is omitted rather than
 * rendered as an empty row.
 */
import { processActionWord, statusWord } from "../operations/phrases.ts";
import { type PipelineState, type PipelineStepStatus, getPipelineState } from "./pipelineState.ts";
import type { ActivityAppVersion, ActivityProcess } from "./dto.ts";

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

/**
 * The five pipeline slots a deploy card holds from its first frame, so the
 * steps fill in place instead of appearing: nothing observed yet → every slot
 * queued; once the pipeline has spoken, a slot `observedSteps` omitted (a
 * `noop` — no build, no prepare) reads skipped rather than vanishing.
 */
export function pipelineStepSlots(steps: ReadonlyArray<ObservedStep>): ReadonlyArray<ObservedStep> {
  const byId = new Map(steps.map((step) => [step.id, step]));
  return STEP_ORDER.map(
    (id) =>
      byId.get(id) ??
      (steps.length === 0
        ? { id, label: LABELS[id], state: STATE.waiting, stateLabel: STATE_LABEL.waiting }
        : { id, label: LABELS[id], state: "done", stateLabel: statusWord("skipped") }),
  );
}

/** The five slots in order, with their labels. */
export const PIPELINE_SLOTS: ReadonlyArray<{
  readonly id: keyof PipelineState;
  readonly label: string;
}> = STEP_ORDER.map((id) => ({ id, label: LABELS[id] }));

/**
 * The five slots of a pipeline that stopped at `failedAt`, read the way the
 * platform reads a failed pipeline (`getPipelineState`): every slot before it
 * done, it failed, every later one cancelled.
 */
export function failedPipelineSlots(failedAt: keyof PipelineState): ReadonlyArray<ObservedStep> {
  const at = STEP_ORDER.indexOf(failedAt);
  return STEP_ORDER.map((id, index) => {
    const raw = index < at ? "finished" : index === at ? "failed" : "cancelled";
    return { id, label: LABELS[id], state: STATE[raw], stateLabel: STATE_LABEL[raw] };
  });
}

/** A secondary process (an observation's chip) as one compact row. */
export interface ObservedProcessStep {
  readonly id: string;
  readonly label: string;
  readonly state: ObservedStep["state"];
  readonly stateLabel: string;
}

/** `ProcessStatusEnum` → row state + word; a status the platform adds later reads queued, in its own words. */
const PROCESS_STATE: Readonly<
  Record<string, { readonly state: ObservedStep["state"]; readonly stateLabel: string }>
> = {
  PENDING: { state: "queued", stateLabel: "Queued" },
  RUNNING: { state: "running", stateLabel: "Running" },
  ROLLBACKING: { state: "running", stateLabel: "Rolling back" },
  CANCELING: { state: "running", stateLabel: "Cancelling" },
  FINISHED: { state: "done", stateLabel: "Done" },
  FAILED: { state: "failed", stateLabel: "Failed" },
  CANCELED: { state: "failed", stateLabel: "Cancelled" },
};

export function observedProcessStep(process: ActivityProcess): ObservedProcessStep {
  const known = PROCESS_STATE[process.status];
  return {
    id: process.id,
    label: processActionWord(process.actionName),
    state: known?.state ?? "queued",
    stateLabel: known?.stateLabel ?? statusWord(process.status),
  };
}
