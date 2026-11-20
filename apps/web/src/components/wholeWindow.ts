/**
 * A page that is the whole window: while it is mounted the app's frame draws no menu around it
 * (`AppSidebarLayout`), and the page brings its own mark and account. Only a screen with one job
 * and nothing else to reach claims it — an account's first run (`FirstRunScreen`) — and the page
 * decides alone, so the frame never re-derives why.
 *
 * The claim is made and let go in layout effects: leaving the page draws the menu in the same frame
 * the next page lands in, inside that navigation's view transition.
 */
import { useLayoutEffect } from "react";
import { create } from "zustand";

const useWholeWindowStore = create<{ readonly claimed: boolean }>(() => ({ claimed: false }));

/** Claims the whole window while the calling page is mounted. */
export function useClaimWholeWindow(): void {
  useLayoutEffect(() => {
    useWholeWindowStore.setState({ claimed: true });
    return () => useWholeWindowStore.setState({ claimed: false });
  }, []);
}

/** Whether a page holds the whole window now: the frame then draws no menu. */
export function useWholeWindowClaimed(): boolean {
  return useWholeWindowStore((state) => state.claimed);
}
