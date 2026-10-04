import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createEndFollow, GLIDE_FROM_PX } from "./timelineEndFollow";

const FRAME_MS = 1000 / 60;

describe("createEndFollow", () => {
  let frames: Array<(now: number) => void> = [];
  let now = 0;
  beforeEach(() => {
    frames = [];
    now = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: (now: number) => void) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
  });
  afterEach(() => vi.unstubAllGlobals());

  /** Runs the frames due, one frame's time apart, and says where the list stood after each. */
  const play = (viewport: { scrollTop: number }) => {
    const tops: number[] = [];
    for (let guard = 0; frames.length > 0 && guard < 100; guard += 1) {
      now += FRAME_MS;
      for (const frame of frames.splice(0)) frame(now);
      tops.push(viewport.scrollTop);
    }
    return tops;
  };

  /** A list standing at its end (1000 tall in a 400 viewport), followed once. */
  const atItsEnd = (follows = true) => {
    const viewport = { scrollTop: 600, scrollHeight: 1000, clientHeight: 400 };
    const follow = createEndFollow({
      viewport: () => viewport as unknown as HTMLElement,
      follows: () => follows,
    });
    follow.follow();
    return { viewport, follow };
  };

  it.each([
    { what: "a row easing taller by a few pixels", grew: 6, glides: false },
    { what: "growth just under a glide's step", grew: GLIDE_FROM_PX - 1, glides: false },
    { what: "a row arriving whole", grew: 155, glides: true },
    { what: "a settled turn's long answer", grew: 992, glides: true },
  ])("follows $what: glides $glides", ({ grew, glides }) => {
    const { viewport, follow } = atItsEnd();
    viewport.scrollHeight += grew;
    follow.follow();
    const end = viewport.scrollHeight - viewport.clientHeight;
    if (!glides) {
      expect(viewport.scrollTop).toBe(end);
      return;
    }
    // Nothing moves in the frame it grew; then it glides, no frame 40 px.
    expect(viewport.scrollTop).toBe(600);
    const tops = play(viewport);
    expect(tops.at(-1)).toBe(end);
    let last = 600;
    for (const top of tops) {
      expect(top - last).toBeLessThan(40);
      expect(top).toBeGreaterThanOrEqual(last);
      last = top;
    }
  });

  it("is placed at once where it did not stand at its end before", () => {
    const viewport = { scrollTop: 0, scrollHeight: 3000, clientHeight: 400 };
    const follow = createEndFollow({
      viewport: () => viewport as unknown as HTMLElement,
      follows: () => true,
    });
    follow.follow();
    expect(viewport.scrollTop).toBe(2600);
  });

  it("stops where it stands once the person leaves the end", () => {
    let follows = true;
    const viewport = { scrollTop: 600, scrollHeight: 1000, clientHeight: 400 };
    const follow = createEndFollow({
      viewport: () => viewport as unknown as HTMLElement,
      follows: () => follows,
    });
    follow.follow();
    viewport.scrollHeight += 300;
    follow.follow();
    now += FRAME_MS;
    for (const frame of frames.splice(0)) frame(now);
    const stood = viewport.scrollTop;
    follows = false;
    play(viewport);
    expect(viewport.scrollTop).toBe(stood);
    viewport.scrollHeight += 100;
    follow.follow();
    expect(viewport.scrollTop).toBe(stood);
  });

  it("never moves a list that does not follow", () => {
    const { viewport, follow } = atItsEnd(false);
    viewport.scrollHeight += 200;
    follow.follow();
    play(viewport);
    expect(viewport.scrollTop).toBe(600);
  });
});
