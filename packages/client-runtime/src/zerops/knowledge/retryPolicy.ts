/**
 * The one backoff policy every machine retries on (DESIGN §4.0). Pure: the caller passes the time
 * and the random source.
 *
 * One shape: a ladder of waits after each failure in a row, whose last rung repeats — bounded in
 * rate, not in count; a visible wake, `online` or a person's retry starts it over, and a
 * definitive refusal ends it (2026-10-05). Every ladder a machine climbs is named here.
 */

/** The waits after each failure in a row, in ms; past its last rung it stays there. */
export type RetryLadder = ReadonlyArray<number>;

export const RETRY_RUNGS_MS: RetryLadder = [2_000, 4_000, 8_000, 15_000, 30_000, 60_000];

/** Each delay lands within ±20 % of its rung (`scheduleRetry`), or up to that much sooner. */
export const RETRY_JITTER = 0.2;

const seconds = (...values: ReadonlyArray<number>): RetryLadder =>
  Object.freeze(values.map((value) => value * 1_000));

/**
 * The access grant's ladders (DESIGN §4.2): before the first grant, the session's; a renewal
 * while the held evidence is valid, bounded by its deadline; a lapsed grant (G9); one project's
 * read or a denial's confirmation while the account stays granted.
 */
export const GRANT_RETRY_LADDERS = Object.freeze({
  initial: RETRY_RUNGS_MS,
  renewal: seconds(10, 20, 40, 60),
  lapsed: seconds(2, 5, 15, 30, 60),
  project: seconds(10, 20, 40, 60),
});

/** The data runtime's recovery of an entity or an interest: doubling from 1 s up to 30 s. */
export const RECOVERY_FIRST_MS = 1_000;
export const RECOVERY_CAP_MS = 30_000;

/** The wait after `failures` failures in a row (the first is 1): its rung, the last repeating. */
export const rungMs = (ladder: RetryLadder, failures: number): number =>
  ladder[Math.min(Math.max(failures, 1), ladder.length) - 1] ?? 0;

/** Whether `failures` in a row stand on the ladder's last rung: its cap, from then on. */
export const onLastRung = (ladder: RetryLadder, failures: number): boolean =>
  failures >= ladder.length;

/** A ladder `rungs` long doubling from `firstMs`, never above `capMs`, its last rung `capMs`. */
export const doublingLadder = (firstMs: number, capMs: number, rungs: number): RetryLadder =>
  Array.from({ length: rungs }, (_, rung) =>
    rung === rungs - 1 ? capMs : Math.min(firstMs * 2 ** rung, capMs),
  );

/** A wait made up to `RETRY_JITTER` sooner, never later, so tabs that failed together part. */
export const soonerJittered = (ms: number, random: number): number =>
  Math.round(ms * (1 - RETRY_JITTER * random));

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
