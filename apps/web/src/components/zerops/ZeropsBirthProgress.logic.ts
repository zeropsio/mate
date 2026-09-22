/**
 * The pure half of the birth-progress checklist: formatting and the mapping
 * from `BirthStep` (`@t3tools/client-runtime/zerops/birthProgress`) onto the
 * `ProcessStep` shape the `ProcessSteps` primitive already renders — so the
 * checklist reuses the same glyphs, tones and layout a build's own pipeline
 * steps use, rather than inventing a second one.
 */
import type {
  BirthProgress,
  BirthStep,
  BirthStepState,
} from "@t3tools/client-runtime/zerops/birthProgress";
import type { ServiceStatusToneId } from "@t3tools/shared/brand";

import type { ProcessStep, ProcessStepState } from "./primitives";

/** `m:ss`, tabular-nums; a tick landing before the start reads as the floor, never negative. */
export function formatBirthElapsed(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** A birth step's meter-segment tone: waiting reads off, active busy, done ok, failed failed. */
export const BIRTH_STEP_TONE: Readonly<Record<BirthStepState, ServiceStatusToneId>> = {
  waiting: "off",
  active: "busy",
  done: "ok",
  failed: "failed",
};

const PROCESS_STEP_STATE: Readonly<Record<BirthStepState, ProcessStepState>> = {
  waiting: "queued",
  active: "running",
  done: "done",
  failed: "failed",
};

// "Done" and "Waiting" are redundant with their glyph (`ProcessSteps`'
// own `REDUNDANT_STATE_LABELS`) and so never shown; "Active" and "Failed"
// read as the checklist's own state words.
const PROCESS_STEP_STATE_LABEL: Readonly<Record<BirthStepState, string>> = {
  waiting: "Waiting",
  active: "Active",
  done: "Done",
  failed: "Failed",
};

/**
 * `endedAt − startedAt` once a step has ended, `now − startedAt` while it is
 * still running, and no duration at all otherwise — never guessed for a
 * waiting step that merely inherited an earlier step's timestamps, and never
 * negative.
 */
function birthStepDurationMs(step: BirthStep, nowMs: number): number | undefined {
  if (step.startedAt === undefined) return undefined;
  const startedAtMs = Date.parse(step.startedAt);
  if (Number.isNaN(startedAtMs)) return undefined;
  if (step.endedAt !== undefined) {
    const endedAtMs = Date.parse(step.endedAt);
    return Number.isNaN(endedAtMs) ? undefined : Math.max(0, endedAtMs - startedAtMs);
  }
  return step.state === "active" ? Math.max(0, nowMs - startedAtMs) : undefined;
}

/** A `BirthStep`, read as one `ProcessSteps` row. */
export function birthStepToProcessStep(step: BirthStep, nowMs: number): ProcessStep {
  const durationMs = birthStepDurationMs(step, nowMs);
  return {
    id: step.id,
    label: step.label,
    state: PROCESS_STEP_STATE[step.state],
    stateLabel: PROCESS_STEP_STATE_LABEL[step.state],
    ...(step.detail === undefined ? {} : { note: step.detail }),
    ...(durationMs === undefined ? {} : { durationMs }),
  };
}

/** The one step the line's detail text and `aria-valuetext` read from: the failed step outranks the active one. */
export function birthLineDetailStep(
  progress: Pick<BirthProgress, "active" | "failed">,
): BirthStep | null {
  return progress.failed ?? progress.active;
}
