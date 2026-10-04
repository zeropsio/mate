import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createEndFollow, GLIDE_FROM_PX, scrollOwn } from "./timelineEndFollow";

const FRAME_MS = 1000 / 60;

/**
 * A list's scroll as the browser keeps it: its top clamped to its range, and
 * a scroll event after every move, heard by the follower as the list's own
 * `scroll` listener hears it. `withinThreshold` is the list's own reading of
 * its end, recomputed only on a scroll as LegendList does — stale between —
 * which nothing here may depend on.
 */
function list({ top, height, client }: { top: number; height: number; client: number }) {
  let scrollTop = top;
  let heard: (() => void) | null = null;
  const element = {
    scrollHeight: height,
    clientHeight: client,
    withinThreshold: true,
    get scrollTop() {
      return scrollTop;
    },
    set scrollTop(next: number) {
      const clamped = Math.max(0, Math.min(next, element.scrollHeight - element.clientHeight));
      if (clamped === scrollTop) return;
      scrollTop = clamped;
      element.withinThreshold =
        element.scrollHeight - element.clientHeight - scrollTop <= element.clientHeight;
      queue.push(() => heard?.());
    },
  };
  const queue: Array<() => void> = [];
  return {
    element,
    listen: (callback: () => void) => {
      heard = callback;
    },
    /** The scroll events since, delivered. */
    events: () => {
      for (const event of queue.splice(0)) event();
    },
  };
}

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

  /** Runs the frames due, `gap` ms apart, scroll events between, and says where it stood after each. */
  const play = (scroll: ReturnType<typeof list>, gap = FRAME_MS) => {
    const tops: number[] = [];
    for (let guard = 0; frames.length > 0 && guard < 200; guard += 1) {
      now += gap;
      for (const frame of frames.splice(0)) frame(now);
      scroll.events();
      tops.push(scroll.element.scrollTop);
    }
    return tops;
  };

  /** A list standing at its end, 1000 tall in a 400 viewport, followed while `follows`. */
  const atItsEnd = (follows: () => boolean = () => true, client = 400) => {
    const scroll = list({ top: 1000 - client, height: 1000, client });
    const follow = createEndFollow({
      viewport: () => scroll.element as unknown as HTMLElement,
      follows,
    });
    scroll.listen(follow.heard);
    follow.follow();
    return { scroll, follow };
  };

  const grow = (scroll: ReturnType<typeof list>, by: number) => {
    scroll.element.scrollHeight += by;
  };

  it.each([
    { what: "a row easing taller by a few pixels", grew: 6, glides: false },
    { what: "growth just under a glide's step", grew: GLIDE_FROM_PX - 1, glides: false },
    { what: "a row arriving whole", grew: 155, glides: true },
    { what: "a settled turn's long answer", grew: 992, glides: true },
  ])("follows $what: glides $glides", ({ grew, glides }) => {
    const { scroll, follow } = atItsEnd();
    const from = scroll.element.scrollTop;
    grow(scroll, grew);
    follow.follow();
    const end = scroll.element.scrollHeight - scroll.element.clientHeight;
    if (!glides) {
      expect(scroll.element.scrollTop).toBe(end);
      return;
    }
    // Nothing moves in the frame it grew; then it glides, no frame 40 px.
    expect(scroll.element.scrollTop).toBe(from);
    const tops = play(scroll);
    expect(tops.at(-1)).toBe(end);
    let last = from;
    for (const top of tops) {
      expect(top - last).toBeLessThan(40);
      expect(top).toBeGreaterThanOrEqual(last);
      last = top;
    }
  });

  // The review, 2026-10-04: one step taller than the list and the composer
  // turned the list's own reading stale after the glide's first frame, and
  // the glide stopped 973 px short, for good.
  it.each([
    { what: "a phone", client: 700, step: 1000 },
    { what: "a desktop", client: 935, step: 2300 },
  ])("glides all the way through a step taller than the list on $what", ({ client, step }) => {
    const { scroll, follow } = atItsEnd(() => true, client);
    grow(scroll, step);
    follow.follow();
    play(scroll);
    // The list's own reading went stale on the way; the end was reached all the same.
    expect(scroll.element.scrollTop).toBe(
      scroll.element.scrollHeight - scroll.element.clientHeight,
    );
    // And it is followed on from there.
    grow(scroll, 300);
    follow.follow();
    play(scroll);
    expect(scroll.element.scrollTop).toBe(
      scroll.element.scrollHeight - scroll.element.clientHeight,
    );
  });

  it("leaves a list that was not at its end where it stands", () => {
    const scroll = list({ top: 930, height: 4000, client: 800 });
    const follow = createEndFollow({
      viewport: () => scroll.element as unknown as HTMLElement,
      follows: () => true,
    });
    scroll.listen(follow.heard);
    follow.follow();
    grow(scroll, 200);
    follow.follow();
    play(scroll);
    expect(scroll.element.scrollTop).toBe(930);
  });

  it("stops where the person scrolled up mid-glide, and stays", () => {
    const { scroll, follow } = atItsEnd();
    grow(scroll, 600);
    follow.follow();
    now += FRAME_MS;
    for (const frame of frames.splice(0)) frame(now);
    scroll.events();
    // The person's wheel, up.
    scroll.element.scrollTop -= 120;
    scroll.events();
    const stood = scroll.element.scrollTop;
    play(scroll);
    expect(scroll.element.scrollTop).toBe(stood);
    grow(scroll, 100);
    follow.follow();
    play(scroll);
    expect(scroll.element.scrollTop).toBe(stood);
  });

  it.each([
    { what: "the way back to the end", move: "pill" },
    { what: "the person scrolling down onto it", move: "person" },
  ])("glides the next long step after $what put it at its end", ({ move }) => {
    const scroll = list({ top: 100, height: 3000, client: 600 });
    const follow = createEndFollow({
      viewport: () => scroll.element as unknown as HTMLElement,
      follows: () => true,
    });
    scroll.listen(follow.heard);
    follow.follow();
    // Up there, it was left alone; now something else brings it to its end.
    if (move === "pill") {
      scroll.element.scrollTop = 2400;
    } else {
      for (let top = 300; top <= 2500; top += 200) scroll.element.scrollTop = Math.min(top, 2400);
    }
    scroll.events();
    grow(scroll, 300);
    follow.follow();
    expect(scroll.element.scrollTop).toBe(2400);
    const tops = play(scroll);
    expect(tops.at(-1)).toBe(2700);
    expect(tops[0]! - 2400).toBeLessThan(40);
  });

  it("stays at its end through a fold that scrolls it up as it takes room the list gives back late", () => {
    const { scroll, follow } = atItsEnd();
    // The fold takes 50 px and scrolls up by it; the list's height comes a frame later.
    scrollOwn(scroll.element as unknown as HTMLElement, scroll.element.scrollTop - 50);
    scroll.events();
    scroll.element.scrollHeight -= 50;
    scroll.events();
    grow(scroll, 300);
    follow.follow();
    play(scroll);
    expect(scroll.element.scrollTop).toBe(
      scroll.element.scrollHeight - scroll.element.clientHeight,
    );
  });

  it("stands at the end at once when its next frame comes long after, as on a tab coming back", () => {
    const { scroll, follow } = atItsEnd();
    grow(scroll, 900);
    follow.follow();
    now += FRAME_MS;
    for (const frame of frames.splice(0)) frame(now);
    now += 2000;
    for (const frame of frames.splice(0)) frame(now);
    expect(frames).toHaveLength(0);
    expect(scroll.element.scrollTop).toBe(
      scroll.element.scrollHeight - scroll.element.clientHeight,
    );
  });

  it("stands at the end at once while the tab is out of sight", () => {
    vi.stubGlobal("document", { visibilityState: "hidden" });
    const { scroll, follow } = atItsEnd();
    grow(scroll, 900);
    follow.follow();
    expect(frames).toHaveLength(0);
    expect(scroll.element.scrollTop).toBe(
      scroll.element.scrollHeight - scroll.element.clientHeight,
    );
  });

  it("never moves a list that does not follow", () => {
    const { scroll, follow } = atItsEnd(() => false);
    grow(scroll, 200);
    follow.follow();
    play(scroll);
    expect(scroll.element.scrollTop).toBe(600);
  });
});
