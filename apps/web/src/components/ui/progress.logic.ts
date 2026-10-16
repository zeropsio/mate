/**
 * A long operation's row (`Progress`): its clock, what it says about the estimate, and how far its
 * bar reaches. The clock reads from the start time on every paint, so a tab that slept shows the
 * true elapsed time; past the estimate the row says so instead of counting down. Pure.
 */

/** Elapsed time as a clock reads: `0:05`, `4:44`, `1:05:03`. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
}

/** A measured duration as a promise: `about 20 s` under 40 s, else whole minutes. */
export function formatEstimate(ms: number): string {
  if (ms < 40_000) return `about ${Math.max(10, Math.round(ms / 10_000) * 10)} s`;
  return `about ${Math.max(1, Math.round(ms / 60_000))} min`;
}

export const OVERRUN_NOTE = "Taking longer than usual";

export interface ProgressClock {
  /** How long it has run; `null` when its start is unknown. */
  readonly elapsed: string | null;
  /** `usually about 5 min` inside the estimate, the overrun line past it; `null` once ended. */
  readonly note: string | null;
  readonly overrun: boolean;
}

export function progressClock(input: {
  readonly startedAtMs: number | null;
  readonly nowMs: number;
  /** When it ended (done or stopped): the clock stays there. */
  readonly endedAtMs: number | null;
  /** The measured usual duration; `null` when none is measured. */
  readonly estimateMs: number | null;
}): ProgressClock {
  const ended = input.endedAtMs !== null;
  const elapsedMs =
    input.startedAtMs === null ? null : (input.endedAtMs ?? input.nowMs) - input.startedAtMs;
  const overrun =
    !ended && elapsedMs !== null && input.estimateMs !== null && elapsedMs >= input.estimateMs;
  const note =
    ended || input.estimateMs === null
      ? null
      : overrun
        ? OVERRUN_NOTE
        : `usually ${formatEstimate(input.estimateMs)}`;
  return { elapsed: elapsedMs === null ? null : formatElapsed(elapsedMs), note, overrun };
}

export type ProgressState = "running" | "done" | "failed";

/**
 * How far the bar reaches, 0..1: the steps behind it, plus time's share of the step it is on —
 * never past that step's end, so the bar waits at the step's edge rather than running ahead.
 */
export function progressFraction(input: {
  /** The step it is on, from 0. */
  readonly at: number;
  readonly count: number;
  readonly elapsedMs: number | null;
  readonly estimateMs: number | null;
  readonly state: ProgressState;
}): number {
  if (input.state === "done") return 1;
  const count = Math.max(1, input.count);
  const at = Math.min(Math.max(0, input.at), count - 1);
  const floor = at / count;
  if (input.state === "failed") return floor;
  const ceiling = (at + 1) / count;
  const byTime =
    input.elapsedMs === null || input.estimateMs === null || input.estimateMs <= 0
      ? 0
      : input.elapsedMs / input.estimateMs;
  // A step's last stretch is held back, so the bar still has room to move when it overruns.
  return Math.min(Math.max(floor, byTime), floor + (ceiling - floor) * 0.9);
}
