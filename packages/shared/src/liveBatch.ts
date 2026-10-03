/**
 * The batch rule for what a running turn is on (pass 35). A batch is one
 * model response: Claude Code runs a response's early calls while the model
 * still writes the later ones, and the next response starts only once every
 * call of the one before has returned. So a call still marked open when a
 * call of a newer response has started cannot be running — its completion
 * went missing. Such a call is stale: never shown as live, and closed as
 * "No result" when the run settles.
 *
 * A provider whose calls never name a response (Codex) keeps the timing
 * rule: a call that started after another call returned belongs to a newer
 * batch. A call seen only as it ended — its start and return at one instant,
 * or no start at all — tells that a call returned, never that a batch began.
 * Claude names them; where its calls name none — an older Mate server, a
 * helper's call — nothing is judged stale by timing, as before the rule.
 *
 * The rule needs no event to arrive: staleness follows from the calls alone.
 * The run card's live slot (web) reads it, and the menu row's live step
 * (server, `ThreadLiveStep.ts`) applies the same rule to the events as they
 * arrive.
 */

/** A call as the rule reads it: when it started and when it returned (null while open). */
export interface BatchCall<T> {
  readonly item: T;
  /**
   * Epoch milliseconds; null where only its return is known — a completion
   * that came on its own: it says a call returned, never that one started.
   */
  readonly startedAt: number | null;
  /** Epoch milliseconds; null while the Mate still waits on it. */
  readonly returnedAt: number | null;
  /** The model response it was written in; absent where the provider names none. */
  readonly response?: string | undefined;
}

export interface LiveBatch<T> {
  /** The newest batch's calls still open, by start: what the Mate waits on now. */
  readonly open: ReadonlyArray<T>;
  /**
   * Calls still marked open from an older batch, by start, each with when it
   * went stale: the start of the first call made after a return that came
   * after it started — where it joins the record.
   */
  readonly stale: ReadonlyArray<{ readonly item: T; readonly since: number }>;
}

/** How a thread's calls read under the rule. */
export interface BatchRule {
  /**
   * A call that names no response goes stale by timing: the thread's provider
   * never names one (`batchesByTiming`).
   */
  readonly byTiming: boolean;
}

/** The driver that names each call's model response (Claude Code). */
const NAMES_RESPONSES = "claudeAgent";

/**
 * Whether a thread's provider never names its calls' response, so its batches
 * are read by timing (Codex). Claude names them; a provider not known reads
 * nothing stale by timing.
 */
export function batchesByTiming(driver: string | null | undefined): boolean {
  return driver !== null && driver !== undefined && driver !== NAMES_RESPONSES;
}

/** The first index in `sorted` whose value passes `test`, `sorted.length` if none. */
function firstIndex(sorted: ReadonlyArray<number>, test: (value: number) => boolean): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (test(sorted[middle]!)) high = middle;
    else low = middle + 1;
  }
  return low;
}

/** Its start, unless it was seen only as it ended: a start at its own return is no start. */
function startOf(call: BatchCall<unknown>): number | null {
  const { startedAt, returnedAt } = call;
  if (startedAt === null || !Number.isFinite(startedAt)) return null;
  return returnedAt !== null && startedAt >= returnedAt ? null : startedAt;
}

/**
 * Splits the calls still open into the newest batch's and the stale ones. A
 * call of a named response is stale once a call of another response started
 * after it; a call of none, where batches go by timing, once some call
 * returned after it started and another call started after that return. Any
 * other is the newest batch's.
 */
export function liveBatch<T>(calls: ReadonlyArray<BatchCall<T>>, rule: BatchRule): LiveBatch<T> {
  const starts = calls
    .flatMap((call) => {
      const start = startOf(call);
      return start === null ? [] : [start];
    })
    .sort((a, b) => a - b);
  const returns = calls
    .flatMap((call) => (call.returnedAt === null ? [] : [call.returnedAt]))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  // The calls of named responses, by start: when each response's first call started after another's.
  const responded = calls
    .flatMap((call) => {
      const start = startOf(call);
      return start === null || call.response === undefined
        ? []
        : [{ start, response: call.response }];
    })
    .sort((a, b) => a.start - b.start);
  const open: Array<{ readonly item: T; readonly startedAt: number }> = [];
  const stale: Array<{ readonly item: T; readonly since: number; readonly startedAt: number }> = [];
  for (const call of calls) {
    if (call.returnedAt !== null) continue;
    const startedAt = startOf(call) ?? Number.NEGATIVE_INFINITY;
    let next: number | undefined;
    if (call.response !== undefined) {
      next = responded.find(
        (other) => other.start > startedAt && other.response !== call.response,
      )?.start;
    } else if (rule.byTiming) {
      const back = firstIndex(returns, (value) => value > startedAt);
      const returnedAfter = returns[back];
      next =
        returnedAfter === undefined
          ? undefined
          : starts[firstIndex(starts, (value) => value >= returnedAfter)];
    }
    if (next === undefined) open.push({ item: call.item, startedAt });
    else stale.push({ item: call.item, since: next, startedAt });
  }
  return {
    open: [...open].sort((a, b) => a.startedAt - b.startedAt).map((call) => call.item),
    stale: [...stale]
      .sort((a, b) => a.startedAt - b.startedAt)
      .map(({ item, since }) => ({ item, since })),
  };
}
