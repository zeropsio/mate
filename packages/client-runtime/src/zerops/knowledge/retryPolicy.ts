/**
 * The one backoff policy every machine retries on (DESIGN §4.0). Pure: the caller passes the time
 * and the random source.
 */

export const RETRY_RUNGS_MS: ReadonlyArray<number> = [2_000, 4_000, 8_000, 15_000, 30_000, 60_000];

/** Each delay lands within ±20 % of its rung. */
export const RETRY_JITTER = 0.2;

/** Where the next retry sits on the ladder; past the last rung it stays there. */
export interface Backoff {
  readonly rung: number;
}

export const INITIAL_BACKOFF: Backoff = { rung: 0 };

/** What sends a waiting attempt back to work. */
export type RetryTrigger =
  | "retry-at-reached"
  | "invalidation"
  | "prerequisite-arrived"
  | "visible-wake"
  | "online"
  | "user-retry"
  | "input-change";

const RESETTING: ReadonlySet<RetryTrigger> = new Set<RetryTrigger>([
  "visible-wake",
  "online",
  "user-retry",
  "input-change",
]);

/** A visible wake, `online`, a user retry or a relevant input change resets to the first rung. */
export const backoffOn = (backoff: Backoff, trigger: RetryTrigger): Backoff =>
  RESETTING.has(trigger) ? INITIAL_BACKOFF : backoff;

/** The next retry time after a failure, and the backoff to use after the one after it. */
export function scheduleRetry(
  backoff: Backoff,
  nowMs: number,
  random: () => number,
): { readonly retryAtMs: number; readonly backoff: Backoff } {
  const last = RETRY_RUNGS_MS.length - 1;
  const rung = Math.min(backoff.rung, last);
  // `rung` is clamped to the ladder, so the lookup always hits.
  const rungMs = RETRY_RUNGS_MS[rung] ?? 0;
  const jitter = 1 + RETRY_JITTER * (2 * random() - 1);
  return {
    retryAtMs: nowMs + Math.round(rungMs * jitter),
    backoff: { rung: Math.min(rung + 1, last) },
  };
}
