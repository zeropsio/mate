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

export function useNowMs(): number {
  return Date.parse(`${useNowMinute()}:00Z`);
}

/**
 * The clock in milliseconds, moving once a second while `active`, for what counts seconds (a
 * running operation's elapsed time, a live read's age). It is state, never a `Date.now()` read in
 * the render: the React Compiler memoises such a read on the render's other inputs, so a
 * running card would keep the second it was first drawn at.
 */
export function useSecondsNowMs(active: boolean): number {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [active]);
  return nowMs;
}
