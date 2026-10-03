import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  isTimelineScrollTarget,
  latchWheelGesture,
  timelineScrollKeyDirection,
  WHEEL_GESTURE_IDLE_MS,
} from "./timelineScrollTarget";

class ScrollElement extends EventTarget {
  scrollTop = 0;
  scrollHeight = 100;
  clientHeight = 100;
  overflowY = "visible";
  overscrollBehaviorY = "auto";

  constructor(readonly parentElement: ScrollElement | null = null) {
    super();
  }

  contains(target: ScrollElement): boolean {
    return (
      target === this || (target.parentElement !== null && this.contains(target.parentElement))
    );
  }
}

function targetsTimeline(target: EventTarget | null, timeline: ScrollElement, deltaY: number) {
  return isTimelineScrollTarget(target, timeline as unknown as HTMLElement, deltaY);
}

function setup() {
  const timeline = Object.assign(new ScrollElement(), {
    overflowY: "auto",
    scrollHeight: 1500,
    clientHeight: 500,
    scrollTop: 1000,
  });
  const group = Object.assign(new ScrollElement(timeline), {
    overflowY: "auto",
    scrollHeight: 300,
    scrollTop: 80,
  });
  return { timeline, group, content: new ScrollElement(group) };
}

beforeEach(() => {
  vi.stubGlobal("Element", ScrollElement);
  vi.stubGlobal("getComputedStyle", (element: ScrollElement) => element);
});
afterEach(() => vi.unstubAllGlobals());

describe("timeline scroll targets", () => {
  it.each([-30, 30])("keeps a nested tool group's scroll out of the timeline: %i", (deltaY) => {
    const { timeline, group, content } = setup();
    expect(targetsTimeline(content, timeline, deltaY)).toBe(false);
    expect(targetsTimeline(group, timeline, deltaY)).toBe(false);
  });

  it.each([
    { scrollTop: 0, deltaY: -30 },
    { scrollTop: 200, deltaY: 30 },
  ])("allows chaining only past the matching edge: %j", ({ scrollTop, deltaY }) => {
    const { timeline, group, content } = setup();
    group.scrollTop = scrollTop;
    expect(targetsTimeline(content, timeline, deltaY)).toBe(true);
    expect(targetsTimeline(content, timeline, -deltaY)).toBe(false);
  });

  it.each(["contain", "none"])("respects overscroll-y %s at either edge", (overscrollBehaviorY) => {
    const { timeline, group, content } = setup();
    group.overscrollBehaviorY = overscrollBehaviorY;
    group.scrollTop = 0;
    expect(targetsTimeline(content, timeline, -30)).toBe(false);
    group.scrollTop = 200;
    expect(targetsTimeline(content, timeline, 30)).toBe(false);
    group.scrollTop = 0;
    group.scrollHeight = group.clientHeight;
    expect(targetsTimeline(content, timeline, 30)).toBe(false);
  });

  it("checks nested results even when the tool group cannot scroll", () => {
    const { timeline, group } = setup();
    group.scrollTop = 0;
    group.scrollHeight = group.clientHeight;
    const result = Object.assign(new ScrollElement(group), {
      overflowY: "scroll",
      scrollHeight: 300,
      scrollTop: 0.25,
    });
    expect(targetsTimeline(new ScrollElement(result), timeline, -30)).toBe(false);
    result.scrollTop = 0;
    expect(targetsTimeline(result, timeline, -30)).toBe(true);
  });

  it("checks an outer group when an inner result reaches its edge", () => {
    const { timeline, group } = setup();
    const result = Object.assign(new ScrollElement(group), { overflowY: "auto" });
    expect(targetsTimeline(result, timeline, -30)).toBe(false);
    group.scrollTop = 0;
    expect(targetsTimeline(result, timeline, -30)).toBe(true);
  });

  it.each(["visible", "hidden", "clip"])("ignores overflow-y %s", (overflowY) => {
    const { timeline, group, content } = setup();
    group.overflowY = overflowY;
    expect(targetsTimeline(content, timeline, -30)).toBe(true);
  });

  it("allows ordinary message content and the outer viewport", () => {
    const { timeline } = setup();
    expect(targetsTimeline(new ScrollElement(timeline), timeline, -30)).toBe(true);
    expect(targetsTimeline(timeline, timeline, 30)).toBe(true);
  });

  it("rejects outside targets, non-elements, and horizontal-only scrolling", () => {
    const { timeline, content } = setup();
    expect(targetsTimeline(new ScrollElement(), timeline, -30)).toBe(false);
    expect(targetsTimeline(new EventTarget(), timeline, -30)).toBe(false);
    expect(targetsTimeline(null, timeline, -30)).toBe(false);
    expect(targetsTimeline(content, timeline, 0)).toBe(false);
  });
});

describe("timelineScrollKeyDirection", () => {
  const cases = [
    { key: "PageUp", shiftKey: false, target: "content", expected: "up" },
    { key: "ArrowUp", shiftKey: false, target: "page", expected: "up" },
    { key: "Home", shiftKey: false, target: "page", expected: "up" },
    { key: " ", shiftKey: true, target: "page", expected: "up" },
    { key: " ", shiftKey: false, target: "page", expected: "down" },
    { key: "PageDown", shiftKey: false, target: "page", expected: "down" },
    { key: "End", shiftKey: false, target: "content", expected: "down" },
    { key: "ArrowDown", shiftKey: false, target: "content", expected: "down" },
    { key: "ArrowUp", shiftKey: false, target: "editable", expected: null },
    { key: " ", shiftKey: false, target: "editable", expected: null },
    { key: " ", shiftKey: false, target: "control", expected: null },
    { key: "PageUp", shiftKey: false, target: "control", expected: "up" },
    { key: "PageUp", shiftKey: false, target: "elsewhere", expected: null },
    { key: "a", shiftKey: false, target: "page", expected: null },
  ] as const;

  it.each(cases)("$key (shift $shiftKey) on $target → $expected", (row) => {
    expect(timelineScrollKeyDirection(row)).toBe(row.expected);
  });
});

describe("latchWheelGesture", () => {
  it("decides a gesture's target on its first event and keeps it while the wheel runs", () => {
    let targetsList = false;
    let latch = latchWheelGesture(null, 1_000, () => targetsList);
    expect(latch.targetsList).toBe(false);
    // The live card reaches its top mid-gesture: the gesture stays the card's.
    targetsList = true;
    for (const at of [1_016, 1_032, 1_100, 1_190]) {
      latch = latchWheelGesture(latch, at, () => targetsList);
      expect(latch.targetsList).toBe(false);
    }
    // A new gesture after the wheel rested starts at the card's edge and moves the list.
    latch = latchWheelGesture(latch, 1_190 + WHEEL_GESTURE_IDLE_MS + 1, () => targetsList);
    expect(latch.targetsList).toBe(true);
  });
});
