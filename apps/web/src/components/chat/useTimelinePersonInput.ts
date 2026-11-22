import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { type LegendListRef } from "@legendapp/list/react";
import {
  nextPersonScrollSession,
  PERSON_SCROLL_IDLE,
  type PersonScrollSession,
  type PersonScrollSessionEvent,
} from "@t3tools/client-runtime/zerops/timelineFollow";
import { type MessagesTimelineRow } from "./MessagesTimeline.logic";
import {
  isTimelineScrollTarget,
  isVerticalWheel,
  latchWheelGesture,
  timelineScrollKeyInput,
  type WheelGestureLatch,
} from "./timelineScrollTarget";
import { prefersReducedMotion } from "~/lib/reducedMotion";
import { useAskReveal } from "../ask/askReveal";

/** An input a person gave the list, before it moved it. */
export type TimelinePersonInput =
  | { readonly kind: "wheel" | "key"; readonly direction: "up" | "down" }
  | { readonly kind: "touch-move" | "scrollbar" | "content-pointer" };

/** What a person does to the list: each input starts or holds their scroll session and is handed up to decide follow. */
export function useTimelinePersonInput({
  rows,
  onManualNavigation,
  listRef,
  onPersonInput,
  timelineViewportElement,
}: {
  rows: MessagesTimelineRow[];
  onManualNavigation: () => void;
  listRef: RefObject<LegendListRef | null>;
  onPersonInput: (input: TimelinePersonInput) => void;
  timelineViewportElement: HTMLDivElement | null;
}) {
  // What a person is doing to the list, so a scroll they make is told from
  // one the list or the browser makes as rows land, grow, settle or shrink.
  const personSessionRef = useRef<PersonScrollSession>(PERSON_SCROLL_IDLE);
  const notePersonSession = useCallback((event: PersonScrollSessionEvent) => {
    personSessionRef.current = nextPersonScrollSession(personSessionRef.current, event);
  }, []);
  // "Show in conversation" on an ask docked above the composer: the person's way to its card.
  useAskReveal(rows, (index) => {
    onManualNavigation();
    notePersonSession({ type: "input", at: performance.now() });
    return listRef.current?.scrollToIndex({
      index,
      animated: !prefersReducedMotion(),
      viewOffset: 24,
    });
  });
  // The wheel gesture under way and whether it is the list's (`latchWheelGesture`).
  const wheelLatchRef = useRef<WheelGestureLatch | null>(null);
  const onPersonInputRef = useRef(onPersonInput);
  useLayoutEffect(() => {
    onPersonInputRef.current = onPersonInput;
  }, [onPersonInput]);
  // Every input a person gives the list, observed here once: each starts or
  // holds their scroll session, and each is handed up to decide follow.
  useEffect(() => {
    const wrapper = timelineViewportElement;
    if (!wrapper) return;
    const scrollNode = () => listRef.current?.getScrollableNode() ?? null;
    const input = (personInput: TimelinePersonInput) => {
      notePersonSession({ type: "input", at: performance.now() });
      onPersonInputRef.current(personInput);
    };
    const onWheel = (event: WheelEvent) => {
      const node = scrollNode();
      if (!node || event.ctrlKey || !isVerticalWheel(event)) return;
      // Whatever it scrolls, the wheel is the person's: should the browser
      // hand the rest of a gesture to the list, the list's move is theirs.
      notePersonSession({ type: "input", at: performance.now() });
      // A wheel that started in a nested scroller (a run's own scroll, a code
      // block) does not leave the end while it scrolls that scroller; carried
      // on past its edge into the list, it is the list's (`wheelHandedToList`).
      const direction = event.deltaY < 0 ? "up" : "down";
      const latch = latchWheelGesture(
        wheelLatchRef.current,
        { at: performance.now(), direction },
        () => isTimelineScrollTarget(event.target, node, event.deltaY),
      );
      wheelLatchRef.current = latch;
      if (latch.targetsList) onPersonInputRef.current({ kind: "wheel", direction });
    };
    const onTouchStart = () =>
      notePersonSession({ type: "hold", by: "touch", at: performance.now() });
    const onTouchMove = () => input({ kind: "touch-move" });
    const onTouchEnd = () =>
      notePersonSession({ type: "release", by: "touch", at: performance.now() });
    // The scrollbar: the only pointerdown whose target is the scroll node itself.
    const onPointerDown = (event: PointerEvent) => {
      const node = scrollNode();
      if (!node || !(event.target instanceof Node) || !node.contains(event.target)) return;
      if (event.target === node) {
        notePersonSession({ type: "hold", by: "pointer", at: performance.now() });
        onPersonInputRef.current({ kind: "scrollbar" });
      } else {
        onPersonInputRef.current({ kind: "content-pointer" });
      }
    };
    const onPointerUp = () =>
      notePersonSession({ type: "release", by: "pointer", at: performance.now() });
    // With the focus on the page (a click on message text leaves it there),
    // scroll keys move the scroller around what was last clicked.
    let lastPointerTarget: Element | null = null;
    const onDocumentPointerDown = (event: PointerEvent) => {
      const node = scrollNode();
      lastPointerTarget =
        node !== null && event.target instanceof Element && node.contains(event.target)
          ? event.target
          : null;
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const node = scrollNode();
      if (!node || event.defaultPrevented) return;
      const direction = timelineScrollKeyInput({
        key: event.key,
        shiftKey: event.shiftKey,
        target: event.target,
        timeline: node,
        lastPointerTarget,
      });
      if (direction !== null) input({ kind: "key", direction });
    };
    // The end of a scroll ends the person's session with it.
    const onScrollEnd = (event: Event) => {
      if (event.target === scrollNode()) notePersonSession({ type: "scroll-ended" });
    };
    const document = wrapper.ownerDocument;
    const view = document.defaultView ?? window;
    wrapper.addEventListener("wheel", onWheel, { passive: true });
    wrapper.addEventListener("touchstart", onTouchStart, { passive: true });
    wrapper.addEventListener("touchmove", onTouchMove, { passive: true });
    wrapper.addEventListener("pointerdown", onPointerDown, { passive: true });
    wrapper.addEventListener("scrollend", onScrollEnd, { capture: true });
    document.addEventListener("pointerdown", onDocumentPointerDown, {
      capture: true,
      passive: true,
    });
    document.addEventListener("keydown", onKeyDown);
    view.addEventListener("touchend", onTouchEnd, { passive: true });
    view.addEventListener("touchcancel", onTouchEnd, { passive: true });
    view.addEventListener("pointerup", onPointerUp, { passive: true });
    view.addEventListener("pointercancel", onPointerUp, { passive: true });
    return () => {
      wrapper.removeEventListener("wheel", onWheel);
      wrapper.removeEventListener("touchstart", onTouchStart);
      wrapper.removeEventListener("touchmove", onTouchMove);
      wrapper.removeEventListener("pointerdown", onPointerDown);
      wrapper.removeEventListener("scrollend", onScrollEnd, { capture: true });
      document.removeEventListener("pointerdown", onDocumentPointerDown, { capture: true });
      document.removeEventListener("keydown", onKeyDown);
      view.removeEventListener("touchend", onTouchEnd);
      view.removeEventListener("touchcancel", onTouchEnd);
      view.removeEventListener("pointerup", onPointerUp);
      view.removeEventListener("pointercancel", onPointerUp);
    };
  }, [listRef, notePersonSession, timelineViewportElement]);
  return { personSessionRef, notePersonSession, wheelLatchRef, onPersonInputRef };
}
