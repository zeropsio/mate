import { useLayoutEffect, useState } from "react";
import { scrollOwn } from "./timelineEndFollow";
import { FOLLOW_TAU_MS, approach } from "./runMotion.logic";
import { type LegendListRef } from "@legendapp/list/react";
import { prefersReducedMotion } from "~/lib/reducedMotion";

/**
 * The room under the conversation's end for what the agent asks (`askRoomEnd`), as the list has
 * it. It opens at once and a view at the end glides down into it. Once answered it stays while the view stands
 * in it, the view easing back up to the end on the follow curve, then goes: dropped at once, the
 * browser would cut the view back by all of it in one frame.
 */
export function useAskRoom(wanted: number, listRef: React.RefObject<LegendListRef | null>): number {
  const [held, setHeld] = useState(0);
  const [previous, setPrevious] = useState(wanted);
  if (wanted !== previous) {
    setPrevious(wanted);
    if (wanted < previous) setHeld(Math.max(held, previous));
  }
  useLayoutEffect(() => {
    if (held <= wanted) return;
    let frame = 0;
    let last = 0;
    let at: number | null = null;
    const step = (now: number) => {
      const element = listRef.current?.getScrollableNode();
      // Where the end stands once the room is gone.
      const end = element
        ? Math.max(0, element.scrollHeight - element.clientHeight - (held - wanted))
        : 0;
      // Within a pixel: the browser rounds the scroll it is given, and a view held at 118 for
      // an end at 117.5 never let the room go — the view rested 319 px short of its end over an
      // empty foot for good (the owner, 0.15.44).
      if (!element || element.scrollTop <= end + 1 || prefersReducedMotion()) {
        setHeld(0);
        return;
      }
      // Moved since by something else: it eases on from there.
      if (at === null || Math.abs(element.scrollTop - at) > 2) at = element.scrollTop;
      at = approach(at, end, last === 0 ? 1000 / 60 : now - last, FOLLOW_TAU_MS);
      last = now;
      scrollOwn(element, at);
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [held, listRef, wanted]);
  return Math.max(wanted, held);
}
