// A gesture inside the timeline may belong to a nested tool result or code
// block. Only treat it as timeline navigation if it can chain to the outer list.
export function isTimelineScrollTarget(
  target: EventTarget | null,
  timeline: HTMLElement,
  deltaY: number,
): boolean {
  if (!(target instanceof Element) || !timeline.contains(target) || deltaY === 0) return false;

  for (
    let element: Element | null = target;
    element && element !== timeline;
    element = element.parentElement
  ) {
    const style = getComputedStyle(element);
    if (style.overflowY !== "auto" && style.overflowY !== "scroll") continue;

    // A scroller pinned to its foot at a fractional pixel ratio stands a
    // fraction short of it (the live card counts itself there within 1 px).
    const canScroll =
      deltaY < 0
        ? element.scrollTop > 0
        : element.scrollTop < element.scrollHeight - element.clientHeight - 1;
    if (
      canScroll ||
      style.overscrollBehaviorY === "contain" ||
      style.overscrollBehaviorY === "none"
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Where a key lands, for the list: on the page itself (after a click on
 * message text the focus is the body, yet the browser scrolls the list), in
 * the list's content, on a control that takes Space, in editable text, or
 * somewhere else that scrolls on its own.
 */
export type TimelineKeyTarget = "page" | "content" | "control" | "editable" | "elsewhere";

export function resolveTimelineKeyTarget(
  target: EventTarget | null,
  timeline: HTMLElement,
): TimelineKeyTarget {
  if (!(target instanceof Element)) return "page";
  if (target.closest("input, textarea, select, [contenteditable]:not([contenteditable=false])"))
    return "editable";
  const document = timeline.ownerDocument;
  if (target === document.body || target === document.documentElement) return "page";
  if (!timeline.contains(target)) return "elsewhere";
  return target.closest("button, a[href], summary, [role=button]") ? "control" : "content";
}

const TIMELINE_UP_KEYS = new Set(["ArrowUp", "PageUp", "Home"]);
const TIMELINE_DOWN_KEYS = new Set(["ArrowDown", "PageDown", "End"]);

/** Which way a key scrolls the list, or null when it does not scroll it. */
export function timelineScrollKeyDirection(input: {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly target: TimelineKeyTarget;
}): "up" | "down" | null {
  if (input.target === "editable" || input.target === "elsewhere") return null;
  if (input.key === " ") {
    if (input.target === "control") return null;
    return input.shiftKey ? "up" : "down";
  }
  if (TIMELINE_UP_KEYS.has(input.key)) return "up";
  if (TIMELINE_DOWN_KEYS.has(input.key)) return "down";
  return null;
}

/**
 * Which way a key scrolls the list, or null when it scrolls something else or
 * nothing. A key scrolls the nearest scroller around where it starts — the
 * focused element, or with the focus on the page, what was last clicked — so
 * a key that starts in a nested scroller (the live card, a tool's output)
 * moves the list only past that scroller's edge.
 */
export function timelineScrollKeyInput(input: {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly target: EventTarget | null;
  readonly timeline: HTMLElement;
  /** What the person last pressed a pointer on inside the list, or null. */
  readonly lastPointerTarget: Element | null;
}): "up" | "down" | null {
  const target = resolveTimelineKeyTarget(input.target, input.timeline);
  const startsAt = target === "page" ? input.lastPointerTarget : input.target;
  if (startsAt === null) return null;
  const direction = timelineScrollKeyDirection({
    key: input.key,
    shiftKey: input.shiftKey,
    target,
  });
  if (direction === null) return null;
  return isTimelineScrollTarget(startsAt, input.timeline, direction === "up" ? -1 : 1)
    ? direction
    : null;
}

/** How long the wheel rests before its next event starts a new gesture. */
export const WHEEL_GESTURE_IDLE_MS = 100;

export interface WheelGestureLatch {
  readonly at: number;
  readonly direction: "up" | "down";
  readonly targetsList: boolean;
}

/**
 * The browser latches a wheel gesture to the scroller it started in: a card
 * that reaches its edge mid-gesture does not hand the rest to the list. So
 * the target is decided once, on a gesture's first event — and again when the
 * wheel turns the other way, which starts a new gesture.
 */
export function latchWheelGesture(
  latch: WheelGestureLatch | null,
  { at, direction }: { readonly at: number; readonly direction: "up" | "down" },
  targetsList: () => boolean,
): WheelGestureLatch {
  if (latch !== null && latch.direction === direction && at - latch.at <= WHEEL_GESTURE_IDLE_MS) {
    return { at, direction, targetsList: latch.targetsList };
  }
  return { at, direction, targetsList: targetsList() };
}
