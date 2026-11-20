import type { ReactNode } from "react";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import { formatWorkDuration } from "./conversation.logic";
import type { StepKind, WorkStep } from "~/zerops/runSteps/steps";

// ---------------------------------------------------------------------------
// Shared with the rest of the card
// ---------------------------------------------------------------------------

/** Kinds whose time says something: a read or an edit is over before it can be read. */
const TIMED: ReadonlySet<StepKind> = new Set(["command", "web", "tool"]);

/**
 * What a line of the chat still running says in its time's place: that it
 * runs, never a second clock — what runs ticks once, in its bar or on the
 * now line (K3).
 */
export const STILL_RUNNING = "Running";

/** What a call that never returned says once its run settled, where its time would be. */
export const NO_RESULT = "No result";

/**
 * What a command sent to the background says where its time would be, while
 * its job runs on past the turn: where it runs, never a clock nobody ticks.
 */
const IN_THE_BACKGROUND = "In the background";

/** A job whose session is gone before it reported: it never will. */
const NO_REPORT = "Didn't report back";

/** A job stopped before it finished. */
const STOPPED = "Stopped";

/** How long a step took; one still running says so, one that never returned says that. */
export function stepTime(step: WorkStep): ReactNode {
  if (step.noResult === "closed") return NO_RESULT;
  if (step.noResult === "stale") return null;
  if (step.state === "running") return STILL_RUNNING;
  if (step.background?.state === "running") return IN_THE_BACKGROUND;
  if (step.background?.state === "lost") return NO_REPORT;
  if (step.background?.state === "stopped") return STOPPED;
  if (!TIMED.has(step.kind) || step.endedAt === null) return null;
  const ms = Date.parse(step.endedAt) - Date.parse(step.startedAt);
  return Number.isFinite(ms) && ms >= 1000 ? formatWorkDuration(ms) : null;
}

/**
 * How long a platform operation took; one still running says so — one whose
 * call returned while it runs on says nothing: the band times it.
 */
export function operationTime(operation: ZeropsOperation): ReactNode {
  if (operation.phase === "running") {
    return operation.returnedAt === undefined ? STILL_RUNNING : null;
  }
  if (operation.settledAt === undefined) return null;
  const ms = Date.parse(operation.settledAt) - Date.parse(operation.anchorAt);
  return Number.isFinite(ms) && ms >= 1000 ? formatWorkDuration(ms) : null;
}
