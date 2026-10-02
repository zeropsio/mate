/**
 * The batch rule for what a running turn is on (pass 35): Claude makes a
 * batch of calls, then waits for every result before it thinks, speaks or
 * calls again. So a call that started after another call returned belongs to
 * a newer batch, and a call of an older batch still marked open cannot be
 * running — its completion went missing (filed under another turn, or under
 * none). Such a call is stale: never shown as live, and closed as "No result"
 * when the run settles.
 *
 * The rule needs no event to arrive: staleness follows from the calls'
 * start and return times alone. The run card's live slot (web) reads it, and
 * the menu row's live step (server, `ThreadLiveStep.ts`) applies the same
 * rule to the events as they arrive.
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

/**
 * Splits the calls still open into the newest batch's and the stale ones. A
 * call is stale once some call returned after it started and another call
 * started after that return; a call with no such pair is the newest batch's.
 */
export function liveBatch<T>(calls: ReadonlyArray<BatchCall<T>>): LiveBatch<T> {
  const starts = calls
    .flatMap((call) => (call.startedAt === null ? [] : [call.startedAt]))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const returns = calls
    .flatMap((call) => (call.returnedAt === null ? [] : [call.returnedAt]))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const open: Array<{ readonly item: T; readonly startedAt: number }> = [];
  const stale: Array<{ readonly item: T; readonly since: number; readonly startedAt: number }> = [];
  for (const call of calls) {
    if (call.returnedAt !== null) continue;
    const startedAt = call.startedAt ?? Number.NEGATIVE_INFINITY;
    const back = firstIndex(returns, (value) => value > startedAt);
    const returnedAfter = returns[back];
    const next =
      returnedAfter === undefined
        ? undefined
        : starts[firstIndex(starts, (value) => value >= returnedAfter)];
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
