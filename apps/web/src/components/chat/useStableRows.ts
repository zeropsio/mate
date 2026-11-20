import { useMemo, useRef } from "react";
import { markPanelsGone } from "./timelinePanelStand";
import {
  computeStableMessagesTimelineRows,
  type StableMessagesTimelineRowsState,
  type MessagesTimelineRow,
} from "./MessagesTimeline.logic";

// ---------------------------------------------------------------------------
// Structural sharing — reuse old row references when data hasn't changed
// so LegendList (and React) can skip re-rendering unchanged items.
// ---------------------------------------------------------------------------

/** Returns a structurally-shared copy of `rows`: for each row whose content
 *  hasn't changed since last call, the previous object reference is reused. */
export function useStableRows(rows: MessagesTimelineRow[]): MessagesTimelineRow[] {
  const prevState = useRef<StableMessagesTimelineRowsState>({
    byId: new Map<string, MessagesTimelineRow>(),
    result: [],
  });

  return useMemo(() => {
    const nextState = computeStableMessagesTimelineRows(rows, prevState.current);
    // A run's panel leaves when the rows stop carrying it, whatever order the
    // list then mounts and unmounts their rows in.
    markPanelsGone(prevState.current.result, nextState.result);
    prevState.current = nextState;
    return nextState.result;
  }, [rows]);
}
