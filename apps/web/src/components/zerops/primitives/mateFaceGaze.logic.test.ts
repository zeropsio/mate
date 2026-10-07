import { describe, expect, it } from "vite-plus/test";

import {
  gazeOffset,
  MATE_GAZE_BLINK_TRAVEL,
  MATE_GAZE_REACH,
  trackGaze,
  type GazeHost,
  type Point,
} from "./mateFaceGaze.logic";

const FACE = { left: 100, top: 100, width: 48, height: 48 };

describe("a large face following the pointer", () => {
  it.each<[string, Point, -1 | 0 | 1, -1 | 0 | 1]>([
    ["right", { x: 400, y: 124 }, 1, 0],
    ["left", { x: 0, y: 124 }, -1, 0],
    ["up", { x: 124, y: 0 }, 0, -1],
    ["down-left", { x: 0, y: 400 }, -1, 1],
  ])("looks %s toward the pointer", (_, pointer, sx, sy) => {
    const offset = gazeOffset(FACE, pointer);
    expect(Math.sign(offset.x)).toBe(sx);
    expect(Math.sign(offset.y)).toBe(sy);
  });

  it("never looks past the eye area, however far the pointer is", () => {
    for (const pointer of [
      { x: 10_000, y: 124 },
      { x: 124, y: -10_000 },
      { x: -9_000, y: 9_000 },
    ]) {
      const offset = gazeOffset(FACE, pointer);
      expect(Math.abs(offset.x)).toBeLessThanOrEqual(MATE_GAZE_REACH.x);
      expect(Math.abs(offset.y)).toBeLessThanOrEqual(MATE_GAZE_REACH.y);
    }
  });

  it("looks ahead when the pointer is on it", () => {
    expect(gazeOffset(FACE, { x: 124, y: 124 })).toEqual({ x: 0, y: 0 });
  });

  /** A page the tracker can be driven through, with what it asked for recorded. */
  function page(options: { reduced?: boolean } = {}) {
    const handlers = new Map<string, (event: object) => void>();
    let visibility: ((visible: boolean) => void) | null = null;
    let frames: Array<() => void> = [];
    const looks: Point[] = [];
    let blinks = 0;
    let measured = 0;
    const host: GazeHost = {
      reducedMotion: () => options.reduced === true,
      observeVisible: (_, onChange) => {
        visibility = onChange;
        return () => {
          visibility = null;
        };
      },
      listen: (type, handler) => {
        handlers.set(type, handler);
        return () => handlers.delete(type);
      },
      nextFrame: (run) => {
        frames.push(run);
        return () => {
          frames = frames.filter((each) => each !== run);
        };
      },
      measure: () => {
        measured += 1;
        return FACE;
      },
    };
    const stop = trackGaze({} as Element, host, {
      look: (offset) => looks.push(offset),
      blink: () => {
        blinks += 1;
      },
      tap: (offset) => looks.push(offset),
    });
    return {
      stop,
      show: (visible: boolean) => visibility?.(visible),
      listening: () => handlers.has("pointermove"),
      move: (x: number, y: number) => handlers.get("pointermove")?.({ clientX: x, clientY: y }),
      leave: () => handlers.get("pointerout")?.({ relatedTarget: null }),
      flush: () => {
        const run = frames;
        frames = [];
        for (const each of run) each();
      },
      looks,
      blinks: () => blinks,
      measured: () => measured,
      observed: () => visibility !== null,
    };
  }

  it("does nothing with reduced motion: the eyes stay centred", () => {
    const tracked = page({ reduced: true });
    expect(tracked.observed()).toBe(false);
    tracked.show(true);
    expect(tracked.listening()).toBe(false);
  });

  it("does no listener work while the face is off screen", () => {
    const tracked = page();
    expect(tracked.listening()).toBe(false);
    tracked.show(true);
    expect(tracked.listening()).toBe(true);
    tracked.show(false);
    expect(tracked.listening()).toBe(false);
    tracked.stop();
    expect(tracked.observed()).toBe(false);
  });

  it("writes once a frame however often the pointer moves, measuring the face once", () => {
    const tracked = page();
    tracked.show(true);
    tracked.move(400, 124);
    tracked.move(410, 124);
    tracked.move(420, 124);
    expect(tracked.looks).toHaveLength(0);
    tracked.flush();
    expect(tracked.looks).toHaveLength(1);
    expect(tracked.looks[0]!.x).toBeGreaterThan(0);
    tracked.move(0, 124);
    tracked.flush();
    expect(tracked.looks[1]!.x).toBeLessThan(0);
    expect(tracked.measured()).toBe(1);
  });

  it("drifts back to centre when the pointer leaves the window", () => {
    const tracked = page();
    tracked.show(true);
    tracked.move(400, 124);
    tracked.flush();
    tracked.leave();
    expect(tracked.looks.at(-1)).toEqual({ x: 0, y: 0 });
  });

  it("blinks after the pointer has travelled a while, not on a clock", () => {
    const tracked = page();
    tracked.show(true);
    tracked.move(0, 0);
    tracked.move(MATE_GAZE_BLINK_TRAVEL - 1, 0);
    expect(tracked.blinks()).toBe(0);
    tracked.move(MATE_GAZE_BLINK_TRAVEL + 1, 0);
    expect(tracked.blinks()).toBe(1);
  });
});
