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
import { useEffect, useState } from "react";

import { useNowMinute } from "~/hooks/useNowMinute";
import { subscribeSecond } from "~/lib/secondTicker";

export function useNowMs(): number {
  return Date.parse(`${useNowMinute()}:00Z`);
}

/**
 * The clock in milliseconds, moving on each wall-clock second while `active`, for what counts seconds (a
 * running operation's elapsed time, a live read's age). It is state, never a `Date.now()` read in
 * the render: the React Compiler memoises such a read on the render's other inputs, so a
 * running card would keep the second it was first drawn at.
 */
export function useSecondsNowMs(active: boolean): number {
  const [nowMs, setNowMs] = useState(() => Date.now());
  // The one second clock (`subscribeSecond`): every counting surface ticks in the same pass.
  useEffect(() => (active ? subscribeSecond(setNowMs) : undefined), [active]);
  return nowMs;
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
