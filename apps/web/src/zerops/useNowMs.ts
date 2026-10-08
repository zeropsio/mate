/**
 * The shared clock, in milliseconds, for anything that says how long ago.
 *
 * `Date.now()` read during a render is impure and, worse, silent: the page
 * keeps whatever age it computed until something unrelated re-renders it, so a
 * change left open all afternoon still says `2h`. This subscribes to the one
 * module-level timer the app already runs, so every surface ages together and
 * ticks on the same UTC minute boundary.
 *
 * The parse is the point of the wrapper: `useNowMinute` hands back a UTC
 * minute with no offset on it, and `Date.parse` reads an offset-less date-time
 * as *local* — which in Prague would put every age two hours out. The `Z` is
 * not decoration.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { useNowMinute } from "~/hooks/useNowMinute";
import { secondSnapshot, subscribeSecond } from "~/lib/secondTicker";

export function useNowMs(): number {
  return Date.parse(`${useNowMinute()}:00Z`);
}

/**
 * The clock in milliseconds, moving on each wall-clock second while `active`, for what counts seconds (a
 * running operation's elapsed time, a live read's age). Clock observations use the same synchronous
 * subscription contract as account facts, so a clock change cannot leave a concurrent arrival
 * render working from an older second. Inactive surfaces retain their snapshot without a timer.
 */
export function useSecondsNowMs(active: boolean): number {
  const clock = useMemo(() => {
    const initialNow = Date.now();
    const initialSnapshot = () => initialNow;
    return {
      subscribe: active ? subscribeSecond : () => () => {},
      snapshot: active ? secondSnapshot : initialSnapshot,
      serverSnapshot: initialSnapshot,
    };
  }, [active]);
  return useSyncExternalStore(clock.subscribe, clock.snapshot, clock.serverSnapshot);
}

/**
 * The wall ms of the last of `deadlines` (wall ms) that passed while mounted, 0 before any: it
 * moves at the earliest still ahead, and again at each next one — what a memoised surface reads so
 * a line that changes by time alone redraws on time.
 */
export function useWakeAt(deadlines: ReadonlyArray<number>): number {
  const [wokeAt, setWokeAt] = useState(0);
  const key = deadlines.join(",");
  useEffect(() => {
    const ahead = key
      .split(",")
      .map(Number)
      .filter((at) => Number.isFinite(at));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      const nowMs = Date.now();
      const next = Math.min(...ahead.filter((at) => at > nowMs));
      if (!Number.isFinite(next)) return;
      timer = setTimeout(() => {
        setWokeAt(Date.now());
        arm();
      }, next - nowMs);
    };
    arm();
    return () => clearTimeout(timer);
  }, [key]);
  return wokeAt;
}
