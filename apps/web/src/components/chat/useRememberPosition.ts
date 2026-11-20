import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";
import { type LegendListRef } from "@legendapp/list/react";
import {
  describeTimelineAnchor,
  type RememberedTimelinePosition,
  rememberTimelinePosition,
  resolveTimelineScrollAnchor,
} from "./timelineScrollAnchoring";
import { resolveTimelineIsAtEnd, type MessagesTimelineRow } from "./MessagesTimeline.logic";

/** Where the person is, kept as they move, and once more as the conversation leaves the page. */
export function useRememberPosition(
  listRef: RefObject<LegendListRef | null>,
  rows: MessagesTimelineRow[],
  routeThreadKey: string,
  noticeResizeRef: RefObject<{
    position: RememberedTimelinePosition | undefined;
    scrollOffset: number;
  } | null>,
  restoringReadingPosition: boolean,
  listPlaced: boolean,
  listReady: boolean,
) {
  // Where the person is, kept as they move, by row: the row at the reading
  // line, how far into it, how tall it was, the run's line and the row above
  // it — what finds the place again once rows have changed (a watched run
  // folds when the person leaves).
  const rememberPosition = useCallback((): boolean | undefined => {
    const state = listRef.current?.getState?.();
    // Nothing is the person's place while the list is still being placed.
    if (
      noticeResizeRef.current !== null ||
      restoringReadingPosition ||
      !listPlaced ||
      state === undefined ||
      state.data !== rows
    ) {
      return undefined;
    }
    const isAtEnd = resolveTimelineIsAtEnd(state);
    const anchor = state.data.length ? resolveTimelineScrollAnchor(state) : undefined;
    const row = anchor === undefined ? undefined : state.elementAtIndex(anchor.index);
    const element = listRef.current?.getScrollableNode();
    if (anchor && row && element && isAtEnd !== undefined) {
      const box = row.getBoundingClientRect();
      rememberTimelinePosition(routeThreadKey, {
        rowId: anchor.rowId,
        // DOM geometry includes the header and the virtualizer's layout adjustment.
        offsetWithinRow: element.getBoundingClientRect().top - box.top,
        rowHeight: box.height,
        ...describeTimelineAnchor(rows, anchor.index),
        atEnd: isAtEnd,
      });
    }
    return isAtEnd;
  }, [listPlaced, listReady, listRef, restoringReadingPosition, routeThreadKey, rows]);
  // Once more as the conversation goes, while it still stands on the page:
  // what changed since the last scroll (a run opened or closed in place) is
  // where the person left it.
  const rememberPositionRef = useRef(rememberPosition);
  useLayoutEffect(() => {
    rememberPositionRef.current = rememberPosition;
  }, [rememberPosition]);
  useLayoutEffect(() => () => void rememberPositionRef.current(), []);
  return rememberPosition;
}
