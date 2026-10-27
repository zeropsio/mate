import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { LONG_GONE_MS } from "./runMotion.logic";
import {
  LATE_STEP_MS,
  cubicBezier,
  drawerEase,
  easedClock,
  stepHeight,
  type CarriedRow,
} from "./stepHeight";

/** Frames by hand: each `frame(now)` runs what asked for it. */
let frames: FrameRequestCallback[] = [];
const frame = (now: number) => {
  const due = frames;
  frames = [];
  for (const callback of due) callback(now);
};
/** The observer the stepper makes: `hear()` is the list having heard a step. */
let hear: () => void = () => undefined;
const saved = {
  frame: globalThis.requestAnimationFrame,
  cancel: globalThis.cancelAnimationFrame,
  observer: globalThis.ResizeObserver,
};
beforeEach(() => {
  frames = [];
  hear = () => undefined;
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {
    frames = [];
  }) as typeof cancelAnimationFrame;
  globalThis.ResizeObserver = class {
    constructor(callback: () => void) {
      hear = callback;
    }
    observe() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(() => {
  globalThis.requestAnimationFrame = saved.frame;
  globalThis.cancelAnimationFrame = saved.cancel;
  globalThis.ResizeObserver = saved.observer;
});

const element = () => ({ style: { height: "" } }) as unknown as HTMLElement;
/** A row of the list, where it stands on screen as `top` says. */
const row = (at = 0) => {
  const state = { top: at };
  const node = {
    style: { translate: "" },
    getBoundingClientRect: () => ({ top: state.top }),
  } as unknown as HTMLElement;
  return { node, state };
};
const heightOf = (node: HTMLElement) => Number.parseFloat(node.style.height);

describe("cubicBezier", () => {
  it.each([
    { x: 0, y: 0 },
    { x: 1, y: 1 },
    { x: 0.5, y: 0.5 },
  ])("draws the linear curve through ($x, $y)", ({ x, y }) => {
    expect(cubicBezier(0, 0, 1, 1)(x)).toBeCloseTo(y, 5);
  });
});

// A late frame counts no more than a late step: a stall slows the ease, and
// nothing drops (run 12: a 195 ms stall dropped the helpers' card 41 px).
describe("easedClock", () => {
  it.each([
    { name: "a frame on time counts whole", elapsed: 100, frame: 16, next: 116 },
    {
      name: "a step a frame late counts whole",
      elapsed: 100,
      frame: LATE_STEP_MS,
      next: 100 + LATE_STEP_MS,
    },
    {
      name: "a stalled frame counts as a late step",
      elapsed: 100,
      frame: 195,
      next: 100 + LATE_STEP_MS,
    },
    { name: "a frame long gone finishes the ease", elapsed: 100, frame: LONG_GONE_MS, next: 360 },
    { name: "the ease never runs past its end", elapsed: 350, frame: 30, next: 360 },
    { name: "a frame back in time counts nothing", elapsed: 100, frame: -5, next: 100 },
  ])("$name", ({ elapsed, frame: dt, next }) => {
    expect(easedClock(elapsed, dt, 360)).toBe(next);
  });
});

describe("stepHeight", () => {
  it("slows through a stalled frame instead of dropping", () => {
    const node = element();
    stepHeight({
      element: node,
      from: 100,
      to: 0,
      duration: 360,
      ease: (t) => t,
      done: () => undefined,
    });
    frame(0);
    frame(16);
    const before = heightOf(node);
    frame(16 + 195);
    expect(before - heightOf(node)).toBeCloseTo((100 * LATE_STEP_MS) / 360, 5);
  });

  it("holds where it stood, then eases to its end a step a frame on its curve", () => {
    const node = element();
    let finished = 0;
    stepHeight({
      element: node,
      from: 60,
      to: 0,
      duration: 100,
      ease: drawerEase,
      done: () => (finished += 1),
    });
    expect(node.style.height).toBe("60px");
    const heights: number[] = [];
    for (const now of [0, 25, 50, 75, 100, 125]) {
      frame(now);
      heights.push(heightOf(node));
    }
    expect(heights.slice(0, 5)).toEqual(
      [0, 0.25, 0.5, 0.75, 1].map((t) => expect.closeTo(60 * (1 - drawerEase(t)), 5)),
    );
    expect(heightOf(node)).toBe(0);
    expect(finished).toBe(1);
    expect(frames).toHaveLength(0);
  });

  it("waits the frames it is asked to before its first step", () => {
    const node = element();
    stepHeight({
      element: node,
      from: 40,
      to: 20,
      duration: 64,
      ease: (t) => t,
      wait: 2,
      done: () => undefined,
    });
    frame(0);
    frame(16);
    expect(heightOf(node)).toBe(40);
    frame(32);
    frame(64);
    expect(heightOf(node)).toBe(30);
  });

  // The list moves its rows a frame after it hears a height change: each step
  // carries them that far, and the next waits for the list to hear this one.
  it.each([
    { direction: 1, carry: "0 10px" },
    { direction: -1, carry: "0 -10px" },
    { direction: 0, carry: "" },
  ] as const)(
    "carries a row going $direction by each step, one step per hearing",
    ({ direction, carry }) => {
      const node = element();
      const { node: moved } = row();
      const carried: CarriedRow[] = [{ row: moved, direction }];
      stepHeight({
        element: node,
        from: 40,
        to: 20,
        duration: 64,
        ease: (t) => t,
        carried,
        done: () => undefined,
      });
      frame(0);
      frame(32);
      expect(heightOf(node)).toBe(30);
      expect(moved.style.translate).toBe(carry);
      // Not heard yet: no step.
      frame(48);
      expect(heightOf(node)).toBe(30);
      hear();
      frame(100);
      expect(heightOf(node)).toBe(20);
    },
  );

  // While a change of its rows locks it, the list takes a step at once: what
  // it moved by the step comes off the carry, and a row that stands still is
  // held where it stood, for the frame until the list places it.
  it.each([
    {
      name: "a carried row the list moved at once loses its carry",
      direction: 1,
      moved: 10,
      translate: "",
    },
    {
      name: "a still row the list dropped is held where it stood",
      direction: 0,
      moved: 10,
      translate: "0 -10px",
    },
    {
      name: "a carried row the list moved for something else keeps its carry",
      direction: 1,
      moved: 42,
      translate: "0 10px",
    },
    {
      name: "a carried row the list left for a frame keeps its carry",
      direction: 1,
      moved: 0,
      translate: "0 10px",
    },
  ] as const)("$name", ({ direction, moved, translate }) => {
    const node = element();
    const { node: carriedRow, state } = row(100);
    stepHeight({
      element: node,
      from: 40,
      to: 20,
      duration: 64,
      ease: (t) => t,
      carried: [{ row: carriedRow, direction }],
      done: () => undefined,
    });
    frame(0);
    frame(32);
    state.top += moved;
    hear();
    expect(carriedRow.style.translate).toBe(translate);
  });

  it("stops where it stands, its rows losing their carry", () => {
    const node = element();
    const { node: carriedRow } = row();
    let finished = 0;
    const stop = stepHeight({
      element: node,
      from: 40,
      to: 20,
      duration: 64,
      ease: (t) => t,
      carried: [{ row: carriedRow, direction: 1 }],
      done: () => (finished += 1),
    });
    frame(0);
    frame(32);
    stop();
    hear();
    frame(100);
    expect(heightOf(node)).toBe(30);
    expect(carriedRow.style.translate).toBe("");
    expect(finished).toBe(0);
  });
});
