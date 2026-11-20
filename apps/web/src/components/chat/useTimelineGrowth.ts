import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import { type LegendListProps, type LegendListRef } from "@legendapp/list/react";
import {
  historicalInsertions,
  endArrivals,
  carriedRowGrowth,
  type MessagesTimelineRow,
} from "./MessagesTimeline.logic";
import { type useTimelineMotion } from "./useTimelineMotion";

/** What moves the end as the rows grow: rows arriving, history joining above, the viewport resizing, a row measured. */
export function useTimelineGrowth({
  listRef,
  motion,
  holdAnswer,
  rows,
  followingEnd,
  listPlaced,
  askRoom,
  contentInsetEndAdjustment,
  timelineViewportElement,
  measuredRowsRef,
}: {
  listRef: RefObject<LegendListRef | null>;
  motion: ReturnType<typeof useTimelineMotion>;
  holdAnswer: () => void;
  rows: MessagesTimelineRow[];
  followingEnd: boolean;
  listPlaced: boolean;
  askRoom: number;
  contentInsetEndAdjustment: number;
  timelineViewportElement: HTMLDivElement | null;
  measuredRowsRef: RefObject<Map<string, MessagesTimelineRow>>;
}) {
  const {
    endFollowRef,
    outerFoldsRef,
    followEnd,
    placeFolds,
    followingEndRef,
    previousContentInsetEndAdjustmentRef,
    remeasurePositionRef,
  } = motion;
  const endRepinFrameRef = useRef<number | null>(null);
  useEffect(() => {
    return () => {
      if (endRepinFrameRef.current !== null) {
        cancelAnimationFrame(endRepinFrameRef.current);
      }
    };
  }, []);
  // Which rows stand where: what the list's containers are drawn again for.
  const rowOrder = useMemo(() => rows.map((row) => row.id).join("\n"), [rows]);
  const previousRowOrderRef = useRef(rowOrder);
  const insertedHistory = useMemo(
    () => historicalInsertions(previousRowOrderRef.current.split("\n"), rowOrder.split("\n")),
    [rowOrder],
  );
  // Rows that came at the end with this order: their first measurement is their arrival.
  const arrivedRows = useMemo(
    () => endArrivals(previousRowOrderRef.current.split("\n"), rowOrder.split("\n")),
    [rowOrder],
  );
  useLayoutEffect(() => {
    previousRowOrderRef.current = rowOrder;
  }, [rowOrder]);
  // The history whose room the view was last taken along for: once per rows joining.
  const joinedHistoryRef = useRef(insertedHistory);
  // Rows arriving, and the viewport resizing, move the end too.
  useLayoutEffect(() => {
    const joining = joinedHistoryRef.current !== insertedHistory && insertedHistory.size > 0;
    joinedHistoryRef.current = insertedHistory;
    if (!followingEnd || rows.length === 0) return;
    // A commit can clamp the native range before later row measurements grow it again.
    endFollowRef.current?.observe();
    // Composer geometry keeps the followed line in place. Row growth keeps its existing motion.
    if (previousContentInsetEndAdjustmentRef.current !== contentInsetEndAdjustment) {
      if (outerFoldsRef.current.size === 0)
        endFollowRef.current?.place(
          contentInsetEndAdjustment - previousContentInsetEndAdjustmentRef.current,
        );
    }
    if (!listPlaced) return;
    // History joining before the tail — a landing or a release its application's flow names once
    // the conversation stands — moves the end by its room in the commit that brings it, and the
    // view goes with it before that frame paints. A row not drawn is never measured, so nothing
    // carried it: every row in sight stood its room lower for a frame, and a glide brought them
    // back (90 px a row, the owner 2026-11-11).
    if (joining)
      // After the list has laid the commit out, as a measured row's growth is carried.
      queueMicrotask(() => {
        const state = listRef.current?.getState();
        if (state === undefined) return;
        // The room the list gives each: its estimate until it is drawn, between its place and
        // the next row's (history joins before the tail, so there is one).
        let joined = 0;
        for (const id of insertedHistory) {
          const index = state.indexByKey(id);
          if (index === undefined) continue;
          const room = state.positionAtIndex(index + 1) - state.positionAtIndex(index);
          if (room > 0) joined += room;
        }
        if (joined > 0) followEnd(joined);
      });
    const frame = requestAnimationFrame(() => followEnd());
    return () => cancelAnimationFrame(frame);
  }, [
    askRoom,
    contentInsetEndAdjustment,
    followEnd,
    followingEnd,
    insertedHistory,
    listPlaced,
    listRef,
    rows,
  ]);
  useEffect(() => {
    const viewport = timelineViewportElement;
    if (viewport === null || typeof ResizeObserver === "undefined") return;
    let height = viewport.clientHeight;
    // A shorter viewport moves the end by what it lost: carried, as any growth of what is there.
    const observer = new ResizeObserver(() => {
      const shrank = height - viewport.clientHeight;
      height = viewport.clientHeight;
      remeasurePositionRef.current?.();
      followEnd(Math.max(0, shrank));
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [followEnd, timelineViewportElement]);
  // Every measurement can move the end, including an estimated row becoming
  // shorter. Read its native clamp in the measurement callback before another
  // layout can hide it, then follow after the list applies its layout.
  // An inserted historical row carries its whole measured height before paint; the words
  // below it already stood in view. Every other row's growth is carried too (`carriedRowGrowth`)
  // but an arrival's: a row that came at the end, from its first measurement while its glide runs.
  const arrivingRowsRef = useRef(new Set<string>());
  useLayoutEffect(() => {
    const keys = new Set(rowOrder.split("\n"));
    for (const key of measuredRowsRef.current.keys())
      if (!keys.has(key)) measuredRowsRef.current.delete(key);
    for (const key of arrivingRowsRef.current)
      if (!keys.has(key)) arrivingRowsRef.current.delete(key);
  }, [rowOrder]);
  const onItemSizeChanged = useCallback<
    NonNullable<LegendListProps<MessagesTimelineRow>["onItemSizeChanged"]>
  >(
    (info) => {
      const previous = measuredRowsRef.current.get(info.itemKey);
      if (info.itemData !== undefined) measuredRowsRef.current.set(info.itemKey, info.itemData);
      const arriving =
        (previous === undefined && arrivedRows.has(info.itemKey)) ||
        (arrivingRowsRef.current.has(info.itemKey) && endFollowRef.current?.gliding() === true);
      if (arriving) arrivingRowsRef.current.add(info.itemKey);
      else arrivingRowsRef.current.delete(info.itemKey);
      const grew = carriedRowGrowth({
        inserted: insertedHistory.has(info.itemKey),
        arriving,
        previous,
        next: info.itemData,
        size: info.size,
        previousSize: info.previous,
      });
      remeasurePositionRef.current?.();
      placeFolds();
      if (!followingEndRef.current) return;
      endFollowRef.current?.observe();
      holdAnswer();
      queueMicrotask(() => {
        placeFolds();
        holdAnswer();
        followEnd(grew);
      });
      if (endRepinFrameRef.current !== null) return;
      endRepinFrameRef.current = requestAnimationFrame(() => {
        endRepinFrameRef.current = null;
        placeFolds();
        followEnd();
      });
    },
    [arrivedRows, followEnd, holdAnswer, insertedHistory, placeFolds],
  );
  return { rowOrder, onItemSizeChanged };
}
