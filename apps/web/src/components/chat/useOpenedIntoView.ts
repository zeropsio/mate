import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { type LegendListRef } from "@legendapp/list/react";
import { scrollOwn } from "./timelineEndFollow";
import { revealBy } from "./timelineReveal.logic";
import { FOLLOW_TAU_MS, approach } from "./runMotion.logic";
import { prefersReducedMotion } from "~/lib/reducedMotion";

/** The keys that scroll a list: pressed, a reveal in flight gives way. */
const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);
/** How long after a person's click what they opened is brought into view, while it eases open. */
const REVEAL_FOR_MS = 700;

/** What a person opens comes into view for a moment after their click (see the comment inside). */
export function useOpenedIntoView(
  timelineViewportElement: HTMLDivElement | null,
  listRef: RefObject<LegendListRef | null>,
  contentInsetEndAdjustment: number,
  followRoomRef: RefObject<number>,
  outerFoldsRef: RefObject<Set<() => void>>,
  followingEndRef: RefObject<boolean>,
) {
  // What a person opens comes into view (`revealBy`): for a moment after
  // their click, while it eases open, the list glides by as much as shows
  // its foot over the composer, never its opener off the top; a scroll of
  // theirs ends it.
  const insetEndRef = useRef(contentInsetEndAdjustment);
  useLayoutEffect(() => {
    insetEndRef.current = contentInsetEndAdjustment;
  }, [contentInsetEndAdjustment]);
  useEffect(() => {
    const wrapper = timelineViewportElement;
    if (!wrapper || typeof requestAnimationFrame !== "function") return;
    let frame = 0;
    let until = 0;
    let last = 0;
    let opener: HTMLElement | null = null;
    // Opened at the conversation's end, the end stays in sight: what opens grows upward, the last
    // row held where it stands (recheck on 0.15.45: an opened card pushed its answer under the
    // composer) — never past its own row's top reaching the view's, from where it grows down.
    // Opened farther up, the opener stands where it was clicked.
    let keepsEnd = false;
    // Held as it lays out, before it paints: a step a frame late let the end dip 81 px.
    let holdsEnd: ResizeObserver | null = null;
    let heldRow: HTMLElement | null = null;
    const keepEnd = () => {
      const viewport = listRef.current?.getScrollableNode();
      if (!viewport || performance.now() > until) return;
      if (!keepsEnd) {
        shrinkWith(viewport);
        return;
      }
      const end = viewport.scrollHeight - viewport.clientHeight - followRoomRef.current;
      // Its row seen whole is what the list keeps in place as rows grow; once past the top, the
      // list kept the rows under it in place too, and with the end kept here the view went twice
      // as far and fell back (Show work at the end, 2026-11-12: the opener 600 px up and gone,
      // 325 px past the end, then back in one frame).
      const room =
        heldRow === null
          ? Number.POSITIVE_INFINITY
          : heldRow.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
      const to = Math.min(end, viewport.scrollTop + Math.max(0, room));
      if (Math.abs(to - viewport.scrollTop) > 0.5) scrollOwn(viewport, to);
    };
    // What it shut moves the rest in the frame it shrinks, as the list will once it has heard
    // the row — the list hears it every other frame: the rows under it come up with its edge,
    // and at the conversation's end the view comes down with it. Left to the list, the rows under
    // it trailed its edge by a frame's shrink, and the view the browser clamped to the list's end
    // came down at half its pace.
    let carried: HTMLElement[] = [];
    let settling = 0;
    const uncarry = () => {
      for (const row of carried) row.style.translate = "";
      carried = [];
    };
    // How much of its shrink the list has not heard yet, and what to carry by it.
    const unheardOf = () => {
      const root = heldRow?.closest<HTMLElement>("[data-timeline-root]");
      const holder = root?.parentElement;
      const state = listRef.current?.getState();
      const key = root?.dataset.timelineRoot;
      const index = key === undefined ? undefined : state?.indexByKey(key);
      if (holder == null || state === undefined || index === undefined) return null;
      const unheard = Math.min(0, holder.getBoundingClientRect().height - state.sizeAtIndex(index));
      return { unheard, holder, index, state };
    };
    // Once the list has heard the last step, the rows it moved go without their carry.
    const settle = () => {
      settling = 0;
      if (carried.length === 0) return;
      const read = unheardOf();
      if (read === null || read.unheard > -0.5 || performance.now() > until + REVEAL_FOR_MS)
        uncarry();
      else settling = requestAnimationFrame(settle);
    };
    const shrinkWith = (viewport: HTMLElement) => {
      // A fold places the rows itself.
      if (outerFoldsRef.current.size > 0) return;
      const read = unheardOf();
      uncarry();
      if (read === null) return;
      const { unheard, holder, index, state } = read;
      if (unheard < -0.5) {
        for (const row of holder.parentElement?.children ?? []) {
          const under = row.querySelector<HTMLElement>(":scope > [data-timeline-root]");
          const at = under?.dataset.timelineRoot;
          if (!(row instanceof HTMLElement) || at === undefined) continue;
          if ((state.indexByKey(at) ?? -1) <= index) continue;
          row.style.translate = `0 ${unheard}px`;
          carried.push(row);
        }
        if (settling === 0) settling = requestAnimationFrame(settle);
      }
      const end = viewport.scrollHeight - viewport.clientHeight + unheard;
      if (viewport.scrollTop - end > 0.5) scrollOwn(viewport, end);
    };
    const stop = () => {
      holdsEnd?.disconnect();
      holdsEnd = null;
      heldRow = null;
      uncarry();
      cancelAnimationFrame(settling);
      settling = 0;
      cancelAnimationFrame(frame);
      frame = 0;
      opener = null;
    };
    const regionOf = (button: HTMLElement): HTMLElement | null => {
      const id = button.getAttribute("aria-controls");
      const controlled = id === null ? null : button.ownerDocument.getElementById(id);
      return (
        controlled ??
        button.closest<HTMLElement>("[data-chat-row],[data-background-line],[data-timeline-row-id]")
      );
    };
    const step = (now: number) => {
      frame = 0;
      const viewport = listRef.current?.getScrollableNode();
      if (opener === null || !viewport || !opener.isConnected || now > until) {
        stop();
        return;
      }
      frame = requestAnimationFrame(step);
      if (opener.getAttribute("aria-expanded") !== "true") return;
      if (keepsEnd) {
        keepEnd();
        return;
      }
      const region = regionOf(opener);
      if (region === null) return;
      const box = viewport.getBoundingClientRect();
      // Inside a run's own scroll, what shows of it ends at that scroll's foot.
      const inner = region.closest<HTMLElement>("[data-run-scroll]");
      const bottom = Math.min(
        region.getBoundingClientRect().bottom,
        inner?.getBoundingClientRect().bottom ?? Number.POSITIVE_INFINITY,
      );
      const by = revealBy({
        openerTop: opener.getBoundingClientRect().top,
        regionBottom: bottom,
        view: { top: box.top, bottom: box.bottom - insetEndRef.current },
      });
      const dt = last === 0 ? 1000 / 60 : now - last;
      last = now;
      if (by <= 0.5) return;
      // Under reduced motion it stands there at once.
      if (prefersReducedMotion()) {
        viewport.scrollTop += by;
        stop();
        return;
      }
      viewport.scrollTop += approach(0, by, dt, FOLLOW_TAU_MS);
    };
    const onClick = (event: globalThis.MouseEvent) => {
      const button =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>("[aria-expanded]")
          : null;
      if (button === null) return;
      if (button.getAttribute("aria-expanded") === "true") {
        stop();
        heldRow = button.closest<HTMLElement>("[data-timeline-row-id]");
        if (heldRow === null || typeof ResizeObserver === "undefined") return;
        keepsEnd = false;
        until = performance.now() + REVEAL_FOR_MS;
        holdsEnd = new ResizeObserver(keepEnd);
        holdsEnd.observe(heldRow);
        return;
      }
      opener = button;
      keepsEnd = followingEndRef.current;
      until = performance.now() + REVEAL_FOR_MS;
      holdsEnd?.disconnect();
      holdsEnd = null;
      const row = button.closest<HTMLElement>("[data-timeline-row-id]");
      heldRow = row;
      if (keepsEnd && row !== null && typeof ResizeObserver !== "undefined") {
        holdsEnd = new ResizeObserver(keepEnd);
        holdsEnd.observe(row);
      }
      last = 0;
      if (frame === 0) frame = requestAnimationFrame(step);
    };
    // Any scroll of the person's ends it: a wheel, a touch, the keys, the scrollbar.
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (SCROLL_KEYS.has(event.key)) stop();
    };
    const onPointerDown = (event: globalThis.PointerEvent) => {
      if (event.target === listRef.current?.getScrollableNode()) stop();
    };
    wrapper.addEventListener("click", onClick, { capture: true });
    wrapper.addEventListener("wheel", stop, { passive: true });
    wrapper.addEventListener("touchmove", stop, { passive: true });
    wrapper.addEventListener("pointerdown", onPointerDown, { passive: true });
    wrapper.ownerDocument.addEventListener("keydown", onKey);
    return () => {
      stop();
      wrapper.removeEventListener("click", onClick, { capture: true });
      wrapper.removeEventListener("wheel", stop);
      wrapper.removeEventListener("touchmove", stop);
      wrapper.removeEventListener("pointerdown", onPointerDown);
      wrapper.ownerDocument.removeEventListener("keydown", onKey);
    };
  }, [listRef, timelineViewportElement]);
}
