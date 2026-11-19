import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createEndFollow, glideWindowMs } from "./timelineEndFollow";

/** A conversation's scroll as the browser keeps it: its top clamped to what it holds. */
class Scroll {
  content: number;
  clientHeight: number;
  private top: number;
  constructor(content: number, clientHeight: number) {
    this.content = content;
    this.clientHeight = clientHeight;
    this.top = content - clientHeight;
  }
  get scrollHeight() {
    return this.content;
  }
  get scrollTop() {
    return this.top;
  }
  set scrollTop(value: number) {
    this.top = Math.max(0, Math.min(value, this.content - this.clientHeight));
  }
  get toEnd() {
    return this.content - this.clientHeight - this.top;
  }
}

let queue = new Map<number, FrameRequestCallback>();
let nextFrame = 1;
let now = 0;
let reduced = false;

/** The next `count` frames, `dt` ms apart; the scroll's top after each. */
function frames(scroll: Scroll, count: number, dt = 1000 / 60): number[] {
  const tops: number[] = [];
  for (let index = 0; index < count; index += 1) {
    now += dt;
    const due = queue;
    queue = new Map();
    for (const callback of due.values()) callback(now);
    tops.push(scroll.scrollTop);
  }
  return tops;
}

function follower(scroll: Scroll, follows = () => true) {
  return createEndFollow({
    viewport: () => scroll as unknown as HTMLElement,
    follows,
    placeEnd: () => {
      scroll.scrollTop = scroll.content;
    },
  });
}

beforeEach(() => {
  queue = new Map();
  now = 0;
  reduced = false;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = nextFrame++;
    queue.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => queue.delete(id));
  vi.stubGlobal("window", { matchMedia: () => ({ matches: reduced }) });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the conversation following its end", () => {
  it("a late picture of 3,000 px is carried in the frame it lays out, never glided", () => {
    const scroll = new Scroll(10_000, 1_000);
    const end = follower(scroll);
    scroll.content += 3_000;
    end.follow(3_000);
    expect(scroll.toEnd).toBe(0);
    expect(end.gliding()).toBe(false);
    expect(new Set(frames(scroll, 30))).toEqual(new Set([12_000]));
  });

  it("growth told before the list grows the end is carried in the frame the end takes it", () => {
    const scroll = new Scroll(10_000, 1_000);
    const end = follower(scroll);
    end.follow(3_000);
    scroll.content += 3_000;
    frames(scroll, 1);
    expect(scroll.toEnd).toBe(0);
    expect(end.gliding()).toBe(false);
  });

  it("growth told is never kept to swallow a later arrival", () => {
    const scroll = new Scroll(10_000, 1_000);
    const end = follower(scroll);
    // A row measured taller whose room the list never grew.
    end.follow(500);
    frames(scroll, 2);
    scroll.content += 800;
    end.follow();
    expect(end.gliding()).toBe(true);
    expect(scroll.toEnd).toBe(800);
  });

  it("a column narrowing reflows every row it shows and the view stays at the end", () => {
    const scroll = new Scroll(26_693, 1_000);
    const end = follower(scroll);
    // The first opening of the right panel: rows measured one by one at the new width.
    for (const grew of [104, 1_044, 896, 763, 584, 403, 267, 172, 110, 70, 44, 26, 16, 9, 9]) {
      scroll.content += grew;
      end.follow(grew);
      expect(scroll.toEnd).toBe(0);
    }
    expect(end.gliding()).toBe(false);
  });

  it("a shorter viewport is carried, the end staying in view", () => {
    const scroll = new Scroll(10_000, 1_000);
    const end = follower(scroll);
    scroll.clientHeight = 600;
    end.follow(400);
    expect(scroll.toEnd).toBe(0);
    expect(end.gliding()).toBe(false);
  });

  it("an arrival of 5,000 px lands within its window, starting a view short of the end", () => {
    const scroll = new Scroll(10_000, 1_000);
    const end = follower(scroll);
    scroll.content += 5_000;
    end.follow();
    expect(end.gliding()).toBe(true);
    const tops = frames(scroll, 30);
    expect(scroll.toEnd).toBe(0);
    const landed = tops.indexOf(scroll.content - scroll.clientHeight) + 1;
    expect(landed * (1000 / 60)).toBeLessThanOrEqual(glideWindowMs(5_000) + 1000 / 60);
    expect(scroll.content - scroll.clientHeight - tops[0]!).toBeLessThan(scroll.clientHeight);
  });

  it("an arrival lands within its window when frames come late", () => {
    const scroll = new Scroll(10_000, 1_000);
    const end = follower(scroll);
    scroll.content += 900;
    end.follow();
    const tops = frames(scroll, 10, 50);
    expect((tops.indexOf(scroll.content - scroll.clientHeight) + 1) * 50).toBeLessThanOrEqual(
      glideWindowMs(900) + 50,
    );
  });

  it("an arrival's glide eases out: its steps only shrink", () => {
    const scroll = new Scroll(10_000, 1_000);
    const end = follower(scroll);
    scroll.content += 600;
    end.follow();
    const tops = [scroll.scrollTop, ...frames(scroll, 20)];
    const steps = tops.slice(1).map((top, index) => top - tops[index]!);
    for (let index = 1; index < steps.length; index += 1)
      expect(steps[index]!).toBeLessThanOrEqual(steps[index - 1]! + 0.01);
  });

  it("an arrival landing during a glide gets a window of its own", () => {
    const scroll = new Scroll(10_000, 1_000);
    const end = follower(scroll);
    scroll.content += 600;
    end.follow();
    frames(scroll, 6);
    scroll.content += 900;
    end.follow();
    const tops = frames(scroll, 30);
    expect(
      (tops.indexOf(scroll.content - scroll.clientHeight) + 1) * (1000 / 60),
    ).toBeLessThanOrEqual(glideWindowMs(900) + 1000 / 60);
  });

  it("a picture laying out above while an arrival glides never moves what the person sees", () => {
    const scroll = new Scroll(10_000, 1_000);
    const end = follower(scroll);
    scroll.content += 600;
    end.follow();
    frames(scroll, 3);
    const way = scroll.toEnd;
    scroll.content += 3_000;
    end.follow(3_000);
    expect(scroll.toEnd).toBe(way);
    frames(scroll, 30);
    expect(scroll.toEnd).toBe(0);
  });

  it("the person's scroll stops a glide where it stands", () => {
    const scroll = new Scroll(10_000, 1_000);
    let follows = true;
    const end = follower(scroll, () => follows);
    scroll.content += 2_000;
    end.follow();
    frames(scroll, 3);
    follows = false;
    const stood = scroll.scrollTop;
    expect(new Set(frames(scroll, 20))).toEqual(new Set([stood]));
    expect(end.gliding()).toBe(false);
  });

  it("streamed words landing a line a frame keep the newest line at the end every frame", () => {
    const scroll = new Scroll(10_000, 1_000);
    const end = follower(scroll);
    for (let line = 0; line < 40; line += 1) {
      scroll.content += 22;
      end.follow(22);
      frames(scroll, 1);
      expect(scroll.toEnd).toBe(0);
    }
    expect(end.gliding()).toBe(false);
  });

  it("reading history, growth below never moves the view", () => {
    const scroll = new Scroll(10_000, 1_000);
    scroll.scrollTop = 4_000;
    const end = follower(scroll, () => false);
    scroll.content += 3_000;
    end.follow(3_000);
    frames(scroll, 10);
    expect(scroll.scrollTop).toBe(4_000);
  });

  it("with reduced motion an arrival stands at the end at once", () => {
    reduced = true;
    const scroll = new Scroll(10_000, 1_000);
    const end = follower(scroll);
    scroll.content += 2_000;
    end.follow();
    expect(scroll.toEnd).toBe(0);
    expect(end.gliding()).toBe(false);
  });
});
