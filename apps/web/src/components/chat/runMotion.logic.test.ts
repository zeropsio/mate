import { describe, expect, it } from "vite-plus/test";

import {
  FOLLOW_TAU_MS,
  MAX_SPEED_PX_PER_MS,
  ROOM_TAU_MS,
  SETTLED_PX,
  approach,
  keepsFoot,
  LONG_GONE_MS,
  movesAsPerson,
  spendStep,
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
      // Run 12, 18:58:18: a "Context condensed" row went in, the box grew 4 px, and the
      // browser set the top 14 px up with no input for 43 s; the run stopped following
      // for 39 minutes.
      what: "its box resized, no input near",
      moving: false,
      resized: true,
      sinceInput: 43_000,
      atFoot: false,
      follows: true,
      person: false,
    },
    {
      what: "its box resized, right after an input",
      moving: false,
      resized: true,
      sinceInput: 100,
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
  ])("$what: the person's $person", (row) => {
    const { moving, sinceInput, atFoot, follows, person } = row;
    const resized = "resized" in row ? row.resized : false;
    expect(movesAsPerson({ moving, resized, msSinceInput: sinceInput, atFoot, follows })).toBe(
      person,
    );
  });
});

// How a run's scroll that follows its foot keeps to it as what it holds
// changes (R12-17: a line landing left it 10–28 px short of its foot for
// 200 ms, the newest line cut, as it glided after a height that already eased).
describe("keepsFoot", () => {
  const at = {
    follows: true,
    heldAbove: false,
    grew: false,
    below: true,
    eases: true,
    roomEases: false,
    gliding: false,
  };
  it.each([
    { what: "scrolled up by the person", given: { follows: false }, keeps: "stays" },
    { what: "the card around it easing taller", given: { heldAbove: true }, keeps: "waits" },
    {
      what: "a line landing whose room eases in",
      given: { grew: true, roomEases: true },
      keeps: "puts",
    },
    {
      what: "a bubble easing taller as its words stream",
      given: { roomEases: true },
      keeps: "puts",
    },
    { what: "its box squeezed by the slot growing", given: {}, keeps: "puts" },
    {
      what: "lines that grew at once, nothing easing them",
      given: { grew: true },
      keeps: "glides",
    },
    {
      what: "lines that grew at once in a run not watched live",
      given: { grew: true, eases: false },
      keeps: "puts",
    },
    { what: "a glide to the foot in flight", given: { gliding: true }, keeps: "stays" },
    {
      // It re-aims at the foot every frame: a put mid-way jumped it there.
      what: "a glide in flight as a room eases",
      given: { gliding: true, roomEases: true, grew: true },
      keeps: "stays",
    },
  ] as const)("$what: it $keeps", ({ given, keeps }) => {
    expect(keepsFoot({ ...at, ...given })).toBe(keeps);
  });
});

// Two eases in one card — a landed line's room and the slot squeezing the
// history — each took their own 32 px a frame, and moved the history up to
// 53 px in one (the p43 review): they share one speed a frame.
describe("spendStep", () => {
  it.each([
    { what: "one ease alone", steps: [[1000, 20]], taken: [20] },
    { what: "one ease past the frame's speed", steps: [[1000, 45]], taken: [32] },
    {
      what: "two eases in one frame",
      steps: [
        [1000, 30],
        [1000, 30],
      ],
      taken: [30, 2],
    },
    {
      what: "two eases growing and shrinking",
      steps: [
        [1000, 20],
        [1000, -20],
      ],
      taken: [20, -12],
    },
    {
      what: "a new frame has its speed again",
      steps: [
        [1000, 30],
        [1020, 30],
      ],
      taken: [30, 30],
    },
  ])("$what", ({ steps, taken }) => {
    const budget = { at: -1, left: 0 };
    expect(steps.map(([now, step]) => spendStep(budget, now!, 20, step!))).toEqual(taken);
  });

  it("lets a frame long gone stand at its target", () => {
    const budget = { at: -1, left: 0 };
    expect(spendStep(budget, 1000, LONG_GONE_MS, 400)).toBe(400);
  });
});
