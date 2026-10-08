import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { subscribeSecond } from "./secondTicker";

describe("subscribeSecond — one clock for every counting duration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-06T10:00:00.400Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("ticks every listener together, on the second", () => {
    const ticks: Array<[string, number]> = [];
    const stopA = subscribeSecond((nowMs) => ticks.push(["a", nowMs]));
    vi.advanceTimersByTime(300);
    const stopB = subscribeSecond((nowMs) => ticks.push(["b", nowMs]));
    vi.advanceTimersByTime(300);
    expect(ticks).toEqual([
      ["a", Date.parse("2026-10-06T10:00:01.000Z")],
      ["b", Date.parse("2026-10-06T10:00:01.000Z")],
    ]);
    vi.advanceTimersByTime(1000);
    expect(ticks.map(([, nowMs]) => new Date(nowMs).toISOString())).toEqual([
      "2026-10-06T10:00:01.000Z",
      "2026-10-06T10:00:01.000Z",
      "2026-10-06T10:00:02.000Z",
      "2026-10-06T10:00:02.000Z",
    ]);
    stopA();
    stopB();
  });

  it("stops a listener that left, and keeps no timer once none listens", () => {
    const heard: number[] = [];
    const stop = subscribeSecond((nowMs) => heard.push(nowMs));
    vi.advanceTimersByTime(600);
    stop();
    vi.advanceTimersByTime(5000);
    expect(heard).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("lets a listener leave while the others are told", () => {
    const heard: string[] = [];
    const stopA: () => void = subscribeSecond(() => {
      heard.push("a");
      stopA();
    });
    const stopB = subscribeSecond(() => heard.push("b"));
    vi.advanceTimersByTime(2600);
    expect(heard).toEqual(["a", "b", "b", "b"]);
    stopB();
  });

  it("a new counting surface takes over without ticking twice", () => {
    const heard: string[] = [];
    let stopB = () => {};
    const stopA = subscribeSecond(() => {
      heard.push("a");
      stopA();
      stopB = subscribeSecond(() => heard.push("b"));
    });
    try {
      vi.advanceTimersByTime(2600);
      expect(heard).toEqual(["a", "b", "b"]);
    } finally {
      stopA();
      stopB();
    }
  });
});
