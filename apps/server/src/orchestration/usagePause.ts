/**
 * A usage limit is one pause, not a turn per attempt.
 *
 * Measured in a real thread (the owner's review of "Lena", 2026-09-26): once
 * Claude's usage window was rejected, 17 turns each ended at once — "Done ·
 * 1 ms" and "You've hit your session limit…" — and 11 of them had no message
 * from the person. Claude Code starts a turn by itself whenever a background
 * task (a subagent, a background command) finishes, to hand the model its
 * result; against a closed window every such turn fails at the first request,
 * and the adapter opened a synthetic turn for each failure. The adapter no
 * longer does (`ClaudeAdapter.ts`, `handleAssistantMessage`): the result stays
 * in Claude's own conversation, and the thread is paused instead.
 *
 * This module decides that pause: what a provider's blocked window, a
 * background result and the reset do to it. Pure — the reactor
 * (`Layers/ThreadUsagePauseReactor.ts`) reads the thread, asks here, and
 * dispatches the answer.
 *
 * @module usagePause
 */
import type {
  OrchestrationSessionStatus,
  ProviderRuntimeEvent,
  ProviderUsageLimitBlock,
  ThreadUsagePauseState,
} from "@t3tools/contracts";

/**
 * How long after the reset the server resumes: a clock running a little ahead
 * of the provider's must not resume into the same closed window.
 */
export const USAGE_RESUME_GRACE_MS = 30_000;

/**
 * The pause after the provider reports a window refusing requests, or
 * undefined when the report changes nothing. Only a reset in the future
 * pauses; with two windows closed the later reset holds the thread, and a
 * pause that is extended keeps what it held and when it began.
 */
export function pauseForBlock(input: {
  readonly current: ThreadUsagePauseState | null;
  readonly block: ProviderUsageLimitBlock;
  readonly now: string;
}): ThreadUsagePauseState | undefined {
  const { current, block, now } = input;
  if (Date.parse(block.resetsAt) <= Date.parse(now)) {
    return undefined;
  }
  if (current !== null && Date.parse(current.resetsAt) >= Date.parse(block.resetsAt)) {
    return undefined;
  }
  return {
    resetsAt: block.resetsAt,
    window: block.window,
    held: current?.held ?? 0,
    pausedAt: current?.pausedAt ?? now,
  };
}

/** Milliseconds until the server acts on a pause's reset: the reset and its grace, never less than none. */
export function resumeDelayMs(
  pause: Pick<ThreadUsagePauseState, "resetsAt">,
  nowMs: number,
): number {
  return Math.max(0, Date.parse(pause.resetsAt) + USAGE_RESUME_GRACE_MS - nowMs);
}

/**
 * Whether the reset resumes the thread's work (the pause itself is cleared
 * either way): only with the thread's switch on, and only when nothing is
 * running or starting — a turn the provider parked continues by itself, and a
 * message the person just sent is already on its way.
 */
export function resumesAtReset(input: {
  readonly autoResume: boolean;
  readonly sessionStatus: OrchestrationSessionStatus | null;
}): boolean {
  return (
    input.autoResume && input.sessionStatus !== "running" && input.sessionStatus !== "starting"
  );
}

/**
 * A background task's result arriving outside any turn: while paused, this is
 * what would have started a turn. A task stopped with its session is no result.
 */
export function isHeldBackgroundResult(event: ProviderRuntimeEvent): boolean {
  return (
    event.type === "task.completed" &&
    event.turnId === undefined &&
    event.payload.status !== "stopped"
  );
}

/** A turn that completes shows the provider serving requests again. */
export function liftsUsagePause(event: ProviderRuntimeEvent): boolean {
  return event.type === "turn.completed" && event.payload.state === "completed";
}
