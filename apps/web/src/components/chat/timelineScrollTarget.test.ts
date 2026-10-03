import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  isTimelineScrollTarget,
  latchWheelGesture,
  resolveTimelineKeyTarget,
  timelineScrollKeyDirection,
  timelineScrollKeyInput,
  WHEEL_GESTURE_IDLE_MS,
} from "./timelineScrollTarget";

// What the element is, for `closest`: a control, editable text, or neither.
type ElementKind = "button" | "input" | null;

class ScrollElement extends EventTarget {
  kind: ElementKind = null;
  scrollTop = 0;
  scrollHeight = 100;
  clientHeight = 100;
  overflowY = "visible";
  overscrollBehaviorY = "auto";

  constructor(readonly parentElement: ScrollElement | null = null) {
    super();
  }

  get ownerDocument() {
    return fakeDocument;
  }

  closest(selector: string): ScrollElement | null {
    const kinds = selector.split(",").map((part) => part.trim());
    for (let element: ScrollElement | null = this; element; element = element.parentElement) {
      const kind = element.kind;
      if (kind && kinds.some((part) => part.startsWith(kind))) return element;
    }
    return null;
  }

  contains(target: ScrollElement): boolean {
    return (
      target === this || (target.parentElement !== null && this.contains(target.parentElement))
    );
  }
}

const fakeDocument = { body: new ScrollElement(), documentElement: new ScrollElement() };

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

describe("resolveTimelineKeyTarget", () => {
  function within(parent: ScrollElement, kind: ElementKind = null) {
    return Object.assign(new ScrollElement(parent), { kind });
  }

  it.each([
    { name: "message text", make: (t: ScrollElement) => within(t), expected: "content" },
    {
      name: "a disclosure button",
      make: (t: ScrollElement) => within(within(t), "button"),
      expected: "control",
    },
    {
      name: "text inside a button",
      make: (t: ScrollElement) => within(within(t, "button")),
      expected: "control",
    },
    { name: "an input", make: (t: ScrollElement) => within(t, "input"), expected: "editable" },
    { name: "the body", make: () => fakeDocument.body, expected: "page" },
    { name: "the root", make: () => fakeDocument.documentElement, expected: "page" },
    { name: "outside the list", make: () => new ScrollElement(), expected: "elsewhere" },
    {
      name: "a button outside the list",
      make: () => Object.assign(new ScrollElement(), { kind: "button" as const }),
      expected: "elsewhere",
    },
    { name: "no element", make: () => null, expected: "page" },
  ] as const)("$name → $expected", ({ make, expected }) => {
    const { timeline } = setup();
    expect(resolveTimelineKeyTarget(make(timeline), timeline as unknown as HTMLElement)).toBe(
      expected,
    );
  });
});

describe("timelineScrollKeyInput", () => {
  // The live card's own scroller inside the list, scrolled partway: keys
  // that start in it scroll it, not the list.
  function withCard() {
    const { timeline } = setup();
    const card = Object.assign(new ScrollElement(timeline), {
      overflowY: "auto",
      scrollHeight: 600,
      clientHeight: 300,
      scrollTop: 120,
    });
    const cardButton = Object.assign(new ScrollElement(card), { kind: "button" as const });
    const cardText = new ScrollElement(card);
    const button = Object.assign(new ScrollElement(timeline), { kind: "button" as const });
    const text = new ScrollElement(timeline);
    return { timeline, card, cardButton, cardText, button, text };
  }
  type Parts = ReturnType<typeof withCard>;

  const cases: ReadonlyArray<{
    readonly name: string;
    readonly key: string;
    readonly target: (parts: Parts) => EventTarget | null;
    readonly lastPointer: (parts: Parts) => ScrollElement | null;
    readonly expected: "up" | "down" | null;
  }> = [
    {
      name: "ArrowUp on a button in the live card scrolls the card",
      key: "ArrowUp",
      target: (p) => p.cardButton,
      lastPointer: () => null,
      expected: null,
    },
    {
      name: "PageUp on a button in the live card scrolls the card",
      key: "PageUp",
      target: (p) => p.cardButton,
      lastPointer: () => null,
      expected: null,
    },
    {
      name: "ArrowUp on the page after a click in a tool body scrolls the tool body",
      key: "ArrowUp",
      target: () => fakeDocument.body,
      lastPointer: (p) => p.cardText,
      expected: null,
    },
    {
      name: "ArrowUp on a button in the list scrolls the list",
      key: "ArrowUp",
      target: (p) => p.button,
      lastPointer: () => null,
      expected: "up",
    },
    {
      name: "PageUp on the page after a click on message text scrolls the list",
      key: "PageUp",
      target: () => fakeDocument.body,
      lastPointer: (p) => p.text,
      expected: "up",
    },
    {
      name: "PageUp on the page after a click outside the list",
      key: "PageUp",
      target: () => fakeDocument.body,
      lastPointer: () => null,
      expected: null,
    },
    {
      name: "End in message text scrolls the list",
      key: "End",
      target: (p) => p.text,
      lastPointer: () => null,
      expected: "down",
    },
    {
      name: "ArrowUp in message text inside the card scrolls the card",
      key: "ArrowUp",
      target: (p) => p.cardText,
      lastPointer: () => null,
      expected: null,
    },
  ];

  it.each(cases)("$name", ({ key, target, lastPointer, expected }) => {
    const parts = withCard();
    expect(
      timelineScrollKeyInput({
        key,
        shiftKey: false,
        target: target(parts),
        timeline: parts.timeline as unknown as HTMLElement,
        lastPointerTarget: lastPointer(parts) as unknown as Element | null,
      }),
    ).toBe(expected);
  });

  it("a card scrolled to its top hands ArrowUp to the list", () => {
    const parts = withCard();
    parts.card.scrollTop = 0;
    expect(
      timelineScrollKeyInput({
        key: "ArrowUp",
        shiftKey: false,
        target: parts.cardButton,
        timeline: parts.timeline as unknown as HTMLElement,
        lastPointerTarget: null,
      }),
    ).toBe("up");
  });
});

describe("latchWheelGesture", () => {
  it("decides a gesture's target on its first event and keeps it while the wheel runs", () => {
    let targetsList = false;
    let latch = latchWheelGesture(null, { at: 1_000, direction: "up" }, () => targetsList);
    expect(latch.targetsList).toBe(false);
    // The live card reaches its top mid-gesture: the gesture stays the card's.
    targetsList = true;
    for (const at of [1_016, 1_032, 1_100, 1_190]) {
      latch = latchWheelGesture(latch, { at, direction: "up" }, () => targetsList);
      expect(latch.targetsList).toBe(false);
    }
    // A new gesture after the wheel rested starts at the card's edge and moves the list.
    latch = latchWheelGesture(
      latch,
      { at: 1_190 + WHEEL_GESTURE_IDLE_MS + 1, direction: "up" },
      () => targetsList,
    );
    expect(latch.targetsList).toBe(true);
  });

  it("decides again when the wheel turns the other way mid-gesture", () => {
    let targetsList = false;
    let latch = latchWheelGesture(null, { at: 1_000, direction: "up" }, () => targetsList);
    targetsList = true;
    latch = latchWheelGesture(latch, { at: 1_016, direction: "up" }, () => targetsList);
    expect(latch.targetsList).toBe(false);
    latch = latchWheelGesture(latch, { at: 1_032, direction: "down" }, () => targetsList);
    expect(latch.targetsList).toBe(true);
  });
});
