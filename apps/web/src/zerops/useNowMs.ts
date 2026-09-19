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
import { useNowMinute } from "~/hooks/useNowMinute";

export function useNowMs(): number {
  return Date.parse(`${useNowMinute()}:00Z`);
}
