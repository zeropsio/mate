import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";
import { type LegendListRef } from "@legendapp/list/react";
import { earlierTurnsAnchor, type MessagesTimelineRow } from "./MessagesTimeline.logic";

/** What hands the page back to the person while earlier turns are being placed. */
const GESTURES = ["wheel", "touchmove", "keydown", "pointerdown"] as const;

/** Loading earlier turns keeps the row the person was reading where it stood. */
export function useEarlierTurnsAnchor(
  listRef: RefObject<LegendListRef | null>,
  rows: MessagesTimelineRow[],
  loadEarlier: { readonly loading: boolean; readonly onLoadEarlier: () => void } | null,
) {
  // Loading earlier turns keeps the row the person was reading where it
  // stood. The list keeps the first row in sight in place, and at the top of
  // a loaded window that is the day's seam, which moves to the top of what
  // loads: the conversation under it was thrown 3,300 px down (Nova,
  // 2026-09-28). The first row of the conversation in sight, never a seam, is
  // taken back to where it stood once the earlier turns are drawn above it.
  const earlierAnchorRef = useRef<{
    readonly id: string;
    readonly top: number;
    readonly firstId: string | undefined;
  } | null>(null);
  // While the earlier turns are on their way the anchor follows the page: a
  // wheel made before they arrive is the person's, and the row goes back to
  // where they left it, not to where it stood at the press. One at a time.
  const stopFollowingRef = useRef<(() => void) | null>(null);
  const onLoadEarlier = useCallback(() => {
    const viewport = listRef.current?.getScrollableNode() as HTMLElement | undefined;
    if (viewport !== undefined) {
      stopFollowingRef.current?.();
      stopFollowingRef.current = null;
      const anchor = earlierTurnsAnchor(
        [...viewport.querySelectorAll<HTMLElement>("[data-timeline-row-id]")].map((element) => {
          const box = element.getBoundingClientRect();
          return {
            id: element.dataset.timelineRowId ?? "",
            kind: element.dataset.timelineRowKind,
            top: box.top,
            bottom: box.bottom,
          };
        }),
        viewport.getBoundingClientRect().top,
      );
      earlierAnchorRef.current =
        anchor === null
          ? null
          : { ...anchor, firstId: rows.find((row) => row.kind !== "seam")?.id };
      if (anchor !== null) {
        const follow = () => {
          const current = earlierAnchorRef.current;
          if (current === null) return;
          const element = viewport.querySelector(
            `[data-timeline-row-id="${CSS.escape(current.id)}"]`,
          );
          if (element === null) return;
          earlierAnchorRef.current = { ...current, top: element.getBoundingClientRect().top };
        };
        viewport.addEventListener("scroll", follow, { passive: true });
        stopFollowingRef.current = () => viewport.removeEventListener("scroll", follow);
      }
    }
    loadEarlier?.onLoadEarlier();
  }, [listRef, loadEarlier, rows]);
  useLayoutEffect(() => {
    const anchor = earlierAnchorRef.current;
    const viewport = listRef.current?.getScrollableNode() as HTMLElement | undefined;
    if (anchor === null || viewport === undefined) return;
    // Nothing came in above it yet: the earlier turns are still on their way.
    if (rows.find((row) => row.kind !== "seam")?.id === anchor.firstId) return;
    // `anchor` holds the top the last pre-arrival scroll left the row at.
    stopFollowingRef.current?.();
    stopFollowingRef.current = null;
    earlierAnchorRef.current = null;
    // The list places what arrived in frames of its own: the row is taken
    // back each time it writes a row's place, before the page paints it.
    const settle = () => {
      const element = viewport.querySelector(`[data-timeline-row-id="${CSS.escape(anchor.id)}"]`);
      if (element === null) return;
      const moved = element.getBoundingClientRect().top - anchor.top;
      if (Math.abs(moved) > 0.5) viewport.scrollTop += moved;
    };
    settle();
    const observer = new MutationObserver(settle);
    observer.observe(viewport, {
      attributes: true,
      attributeFilter: ["style"],
      childList: true,
      subtree: true,
    });
    // The list moves the page itself as it measures what arrived: taken back
    // then too. The person moving the page takes it over at once.
    viewport.addEventListener("scroll", settle, { passive: true });
    const release = () => {
      observer.disconnect();
      viewport.removeEventListener("scroll", settle);
      for (const type of GESTURES) viewport.removeEventListener(type, release);
    };
    for (const type of GESTURES) viewport.addEventListener(type, release, { passive: true });
    const done = setTimeout(release, 1000);
    return () => {
      clearTimeout(done);
      release();
    };
  }, [listRef, rows]);
  useLayoutEffect(() => () => stopFollowingRef.current?.(), []);

  return onLoadEarlier;
}
