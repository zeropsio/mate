import { useLayoutEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from "react";
import { type LegendListRef } from "@legendapp/list/react";
import { type ChatListAnchoredEndSpace } from "@t3tools/shared/chatList";
import { type MessagesTimelineRow } from "./MessagesTimeline.logic";
import {
  judgeTimelinePlacing,
  TIMELINE_ROW_READ_DEADLINE_MS,
  type RememberedTimelinePosition,
  readTimelineFirstLineInset,
  readTimelinePosition,
  resolveTimelineRestoreTarget,
} from "./timelineScrollAnchoring";
import { scrollOwn } from "./timelineEndFollow";
import { type makeTimelineRowReads } from "./timelineRowReads";
import { type useTimelineMotion } from "./useTimelineMotion";

/** Placing the list out of sight until it stands where it stays: a reading position put back, or the end reached. */
export function useTimelinePlacing({
  rows,
  showsList,
  shown,
  listPlaced,
  setListPlaced,
  listReady,
  noticeResizeRef,
  noticeReadingPosition,
  setNoticeReadingPosition,
  routeThreadKey,
  flowRead,
  contentInsetEndAdjustment,
  followingEnd,
  anchoredEndSpace,
  listRef,
  restoringReadingPosition,
  rememberedPosition,
  setPositionRestored,
  motion,
  onManualNavigation,
  cancelPositionRestoreRef,
  rowReads,
}: {
  rows: MessagesTimelineRow[];
  showsList: boolean;
  shown: boolean;
  listPlaced: boolean;
  setListPlaced: Dispatch<SetStateAction<boolean>>;
  listReady: boolean;
  noticeResizeRef: RefObject<{
    position: RememberedTimelinePosition | undefined;
    scrollOffset: number;
  } | null>;
  noticeReadingPosition: RememberedTimelinePosition | undefined;
  setNoticeReadingPosition: Dispatch<SetStateAction<RememberedTimelinePosition | undefined>>;
  routeThreadKey: string;
  flowRead: boolean;
  contentInsetEndAdjustment: number;
  followingEnd: boolean;
  anchoredEndSpace: ChatListAnchoredEndSpace | undefined;
  listRef: RefObject<LegendListRef | null>;
  restoringReadingPosition: boolean;
  rememberedPosition: RememberedTimelinePosition | undefined;
  setPositionRestored: Dispatch<SetStateAction<boolean>>;
  motion: ReturnType<typeof useTimelineMotion>;
  onManualNavigation: () => void;
  cancelPositionRestoreRef: RefObject<(() => void) | null> | undefined;
  rowReads: ReturnType<typeof makeTimelineRowReads>;
}) {
  const {
    previousContentInsetEndAdjustmentRef,
    followingEndRef,
    followRoomRef,
    remeasurePositionRef,
  } = motion;
  // So does its project's flow still being read: a landing read after the conversation stood
  // joined its end and moved the page under the person (owner, 2026-11-17). Read by the placing
  // loop each frame, and waited for at most the opening's beat from when this placement began —
  // never from a run of the loop, which a streaming first answer starts again with every row.
  const flowReadRef = useRef(flowRead);
  useLayoutEffect(() => {
    flowReadRef.current = flowRead;
  }, [flowRead]);
  const placingBeganRef = useRef<{ readonly key: string; readonly at: number } | null>(null);
  const rowsRef = useRef(rows);
  useLayoutEffect(() => {
    rowsRef.current = rows;
  });
  useLayoutEffect(() => {
    // A kept conversation still mounts/places while warming, but navigation
    // releases an already placed notice anchor before its hidden layout changes.
    if (!showsList || (!shown && listPlaced)) {
      if (!showsList) placingBeganRef.current = null;
      noticeResizeRef.current = null;
      if (noticeReadingPosition !== undefined) setNoticeReadingPosition(undefined);
      return;
    }
    if (!listReady) return;
    if (!listPlaced && placingBeganRef.current?.key !== routeThreadKey)
      placingBeganRef.current = { key: routeThreadKey, at: performance.now() };
    const placingBegan = placingBeganRef.current;
    const flowReading = () =>
      !listPlaced &&
      !flowReadRef.current &&
      placingBegan !== null &&
      performance.now() - placingBegan.at < TIMELINE_ROW_READ_DEADLINE_MS;
    const insetChanged = previousContentInsetEndAdjustmentRef.current !== contentInsetEndAdjustment;
    previousContentInsetEndAdjustmentRef.current = contentInsetEndAdjustment;
    if (followingEnd || anchoredEndSpace) {
      noticeResizeRef.current = null;
      if (noticeReadingPosition !== undefined) setNoticeReadingPosition(undefined);
    }
    const list = listRef.current;
    const viewport: HTMLElement | null = list?.getScrollableNode() ?? null;
    if (!list || !viewport) return;
    if (listPlaced && insetChanged && !followingEnd && !anchoredEndSpace) {
      if (noticeResizeRef.current === null) {
        const position = readTimelinePosition(routeThreadKey);
        noticeResizeRef.current = { position, scrollOffset: viewport.scrollTop };
        setNoticeReadingPosition(position);
      }
    }
    const noticeResize = listPlaced ? noticeResizeRef.current : null;
    if (listPlaced && noticeResize === null) return;
    const position =
      noticeResize?.position ?? (restoringReadingPosition ? rememberedPosition : undefined);
    let cancelled = false;
    let frame: number | null = null;
    let stableFrames = 0;
    const finish = () => {
      if (cancelled) return;
      cancelled = true;
      if (frame !== null) cancelAnimationFrame(frame);
      if (position !== undefined) setPositionRestored(true);
      // Placed at its end, the end is the follower's, and the list's initial scroll ends before
      // `initialScrollAtEnd` turns off: LegendList (3.3.5) keeps its bootstrap target and, as the
      // prop turns off, hands it to the scroll as its content offset — where the end stood
      // before a late picture grew it — and puts the view there, unheard; the follower then
      // glided the gap. An imperative scroll to the end it stands at drops that target.
      if (followingEndRef.current)
        void list.scrollToEnd({ animated: false, viewOffset: followRoomRef.current });
      setListPlaced(true);
    };
    // A reading position being put back hands the page to the person's
    // first gesture.
    const cancel = () => {
      finish();
      if (noticeResize !== null) {
        noticeResizeRef.current = null;
        setNoticeReadingPosition(undefined);
      }
    };
    const takeOver = () => {
      cancel();
      onManualNavigation();
    };
    const onScrollKey = (event: globalThis.KeyboardEvent) => {
      if (
        ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key) &&
        !(
          event.target instanceof Element &&
          event.target.closest("input, textarea, [contenteditable=true]")
        )
      )
        takeOver();
    };
    if (position !== undefined || noticeResize !== null) {
      viewport.addEventListener("wheel", takeOver, { passive: true });
      viewport.addEventListener("touchmove", takeOver, { passive: true });
      viewport.addEventListener("pointerdown", takeOver, { passive: true });
      // Keyboard activation opens content through a click without a pointer gesture.
      viewport.addEventListener("click", takeOver, { capture: true });
      viewport.ownerDocument.addEventListener("keydown", onScrollKey);
      if (noticeResize === null) onManualNavigation();
      if (cancelPositionRestoreRef) cancelPositionRestoreRef.current = cancel;
    }
    const rowElement = (rowId: string) => {
      const state = list.getState();
      const index = state.indexByKey(rowId);
      return index === undefined ? undefined : (state.elementAtIndex(index) ?? undefined);
    };
    // Where the view should stand now: the remembered row's line where it
    // was (a run folded since at its line), or the end; null until the row
    // it lands on is drawn.
    const aim = (): number | null => {
      const end = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
      const fallback =
        noticeResize === null ? end : Math.max(0, Math.min(noticeResize.scrollOffset, end));
      if (position === undefined) return fallback;
      const target = resolveTimelineRestoreTarget({
        position,
        rowIds: rowsRef.current.map((row) => row.id),
        heightOf: (rowId) => rowElement(rowId)?.getBoundingClientRect().height,
      });
      if (target.kind === "end") return fallback;
      const row = rowElement(target.rowId);
      if (row === undefined) return null;
      const box = row.getBoundingClientRect();
      const offsetWithinRow =
        target.kind === "row"
          ? target.offsetWithinRow
          : (target.edge === "foot" ? box.height : 0) - readTimelineFirstLineInset(viewport);
      return Math.max(
        0,
        Math.min(
          viewport.scrollTop + box.top - viewport.getBoundingClientRect().top + offsetWithinRow,
          end,
        ),
      );
    };
    const placingSince = performance.now();
    const tick = () => {
      frame = null;
      if (cancelled) return;
      const target = aim();
      const judged = judgeTimelinePlacing(
        {
          listReady,
          offBy: target === null ? null : viewport.scrollTop - target,
          elapsedMs: performance.now() - placingSince,
          rowsReading: rowReads.reading() || flowReading(),
          rowsSettling: rowReads.settling(),
        },
        stableFrames,
      );
      stableFrames = judged.stableFrames;
      if (judged.verdict === "placed") {
        if (noticeResize === null) finish();
        return;
      }
      if ((judged.verdict === "correct" || judged.verdict === "settle") && target !== null) {
        scrollOwn(viewport, target);
        // Hidden until the rows' late measurements stop moving it (LegendList places rows a
        // frame late), so the first frame shown is the settled one; a Mate streaming its answer
        // moves the end every frame, so past the deadline it shows where it now stands.
        if (judged.verdict === "settle" && noticeResize === null) {
          finish();
          return;
        }
      }
      // A missing DOM row waits for measurement rather than spinning.
      if (noticeResize === null || target !== null) frame = requestAnimationFrame(tick);
    };
    const remeasure = () => {
      stableFrames = 0;
      if (!cancelled && frame === null) frame = requestAnimationFrame(tick);
    };
    if (noticeResize !== null) remeasurePositionRef.current = remeasure;
    tick();
    return () => {
      cancelled = true;
      if (frame !== null) cancelAnimationFrame(frame);
      if (remeasurePositionRef.current === remeasure) remeasurePositionRef.current = null;
      if (position === undefined && noticeResize === null) return;
      if (cancelPositionRestoreRef?.current === cancel) cancelPositionRestoreRef.current = null;
      viewport.removeEventListener("wheel", takeOver);
      viewport.removeEventListener("touchmove", takeOver);
      viewport.removeEventListener("pointerdown", takeOver);
      viewport.removeEventListener("click", takeOver, { capture: true });
      viewport.ownerDocument.removeEventListener("keydown", onScrollKey);
    };
  }, [
    anchoredEndSpace,
    contentInsetEndAdjustment,
    followingEnd,
    noticeReadingPosition,
    routeThreadKey,
    cancelPositionRestoreRef,
    listPlaced,
    listReady,
    listRef,
    onManualNavigation,
    rememberedPosition,
    restoringReadingPosition,
    shown,
    showsList,
  ]);
  useLayoutEffect(() => {
    remeasurePositionRef.current?.();
  }, [rows]);
}
