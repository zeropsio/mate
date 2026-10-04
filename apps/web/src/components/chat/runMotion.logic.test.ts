import { describe, expect, it } from "vite-plus/test";

import {
  FOLLOW_TAU_MS,
  MAX_SPEED_PX_PER_MS,
  ROOM_TAU_MS,
  SETTLED_PX,
  approach,
  movesAsPerson,
} from "./runMotion.logic";

const FRAME_MS = 1000 / 60;

/** Each frame's position, from `from` towards `to`, until it stands at `to` (at most 120 frames). */
function frames(from: number, to: number, tau: number): number[] {
  const out: number[] = [];
  let at = from;
  while (at !== to && out.length < 120) {
    at = approach(at, to, FRAME_MS, tau);
    out.push(at);
  }
  return out;
}

describe("approach", () => {
  it.each([
    { what: "a card growing by a line", from: 38, to: 193, tau: ROOM_TAU_MS },
    { what: "a card growing by a tall line", from: 80, to: 280, tau: ROOM_TAU_MS },
    { what: "a card shrinking as a slot row leaves", from: 330, to: 270, tau: ROOM_TAU_MS },
    { what: "a scroll following its foot", from: 386, to: 540, tau: FOLLOW_TAU_MS },
  ])(
    "eases $what: never past the target, no step over half the way, done inside 260 ms",
    ({ from, to, tau }) => {
      const path = frames(from, to, tau);
      expect(path.at(-1)).toBe(to);
      const distance = Math.abs(to - from);
      let last = from;
      for (const at of path) {
        // Never past the target, never back.
        expect(Math.sign(to - at) * Math.sign(to - from)).toBeGreaterThanOrEqual(0);
        expect(Math.abs(at - last)).toBeLessThan(distance / 2);
        last = at;
      }
      // A strong ease-out: the first frame takes the most.
      const steps = path.map((at, index) => Math.abs(at - (index === 0 ? from : path[index - 1]!)));
      // (A long way's first frames all go at the top speed.)
      expect(steps[0]).toBeGreaterThanOrEqual(Math.max(...steps) - 1e-9);
      expect(path.length * FRAME_MS).toBeLessThanOrEqual(260 + FRAME_MS * 4);
    },
  );

  it.each([
    { what: "standing at its target", current: 120, target: 120, dt: FRAME_MS, expected: 120 },
    { what: "within half a pixel", current: 119.6, target: 120, dt: FRAME_MS, expected: 120 },
    { what: "no time passed", current: 100, target: 200, dt: 0, expected: 100 },
    {
      what: "a frame long gone (a hidden tab)",
      current: 100,
      target: 900,
      dt: 2000,
      expected: 900,
    },
  ])("$what", ({ current, target, dt, expected }) => {
    expect(approach(current, target, dt, ROOM_TAU_MS)).toBe(expected);
  });

  it.each([
    { what: "a long command's output", from: 56, to: 356 },
    { what: "a burst of lines", from: 100, to: 700 },
  ])("caps its speed for $what: no frame moves it 40 px", ({ from, to }) => {
    const path = frames(from, to, ROOM_TAU_MS);
    let last = from;
    for (const at of path) {
      expect(Math.abs(at - last)).toBeLessThan(40);
      last = at;
    }
    expect(MAX_SPEED_PX_PER_MS * FRAME_MS).toBeLessThan(40);
    // A longer way takes longer, never so long it trails what comes next.
    expect(path.length * FRAME_MS).toBeLessThanOrEqual(600);
  });

  it("moves no further in a late frame than in one on time", () => {
    expect(approach(0, 500, 50, ROOM_TAU_MS)).toBe(approach(0, 500, 20, ROOM_TAU_MS));
    expect(approach(0, 500, 50, ROOM_TAU_MS)).toBeLessThan(40);
  });

  it("is retargeted from where it stands: a second arrival mid-way never jumps", () => {
    let at = 100;
    for (let frame = 0; frame < 4; frame += 1) at = approach(at, 200, FRAME_MS, ROOM_TAU_MS);
    const before = at;
    const next = approach(at, 300, FRAME_MS, ROOM_TAU_MS);
    expect(next).toBeGreaterThan(before);
    expect(next - before).toBeLessThan(100 / 2);
  });

  it("settles within the half pixel it calls settled", () => {
    expect(SETTLED_PX).toBeLessThanOrEqual(0.5);
  });
});

// A run's scroll moves while its own motion runs (its room easing, its glide):
// such a move is the page's, unless the person just gave an input — or it
// brings a scroll they had left back onto its foot, as a phone's flick
// coasting there does, long after its last touch (the review, 2026-10-04).
describe("movesAsPerson", () => {
  it.each([
    {
      what: "no motion of its own",
      moving: false,
      sinceInput: 5000,
      atFoot: false,
      follows: true,
      person: true,
    },
    {
      what: "its motion, no input near",
      moving: true,
      sinceInput: 5000,
      atFoot: false,
      follows: true,
      person: false,
    },
    {
      what: "its motion, right after an input",
      moving: true,
      sinceInput: 100,
      atFoot: false,
      follows: true,
      person: true,
    },
    {
      what: "its motion, at its foot while following",
      moving: true,
      sinceInput: 5000,
      atFoot: true,
      follows: true,
      person: false,
    },
    {
      what: "a flick coasting onto the foot it had left",
      moving: true,
      sinceInput: 1500,
      atFoot: true,
      follows: false,
      person: true,
    },
  ])("$what: the person's $person", ({ moving, sinceInput, atFoot, follows, person }) => {
    expect(movesAsPerson({ moving, msSinceInput: sinceInput, atFoot, follows })).toBe(person);
  });
});
