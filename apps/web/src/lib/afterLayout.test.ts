// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

/**
 * A page's frame as the browser runs it: the frame's callbacks, then layout,
 * then the ResizeObservers' delivery. An element observed while that delivery
 * runs, no deeper than what it delivered, is skipped for the frame and the
 * browser reports a loop error: `skipped` counts those.
 */
function stubPage() {
  const page = { phase: "task" as "task" | "frame" | "delivery", skipped: 0, observed: 0 };
  const observers: Array<{ callback: () => void; due: boolean }> = [];
  let frames: Array<() => void> = [];
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      #self: { callback: () => void; due: boolean };
      constructor(callback: () => void) {
        this.#self = { callback, due: false };
        observers.push(this.#self);
      }
      observe() {
        page.observed += 1;
        if (page.phase === "delivery") page.skipped += 1;
        else this.#self.due = true;
      }
      unobserve() {}
      disconnect() {}
    },
  );
  /** One frame: its callbacks, layout, then what each observer has to deliver. */
  const frame = () => {
    page.phase = "frame";
    const due = frames;
    frames = [];
    for (const run of due) run();
    page.phase = "delivery";
    for (const observer of observers) {
      if (!observer.due) continue;
      observer.due = false;
      observer.callback();
    }
    page.phase = "task";
  };
  /** Another observer of the page's, reporting in this frame's delivery. */
  const other = (callback: () => void) => observers.push({ callback, due: true });
  return { page, frame, other };
}

let reported: unknown[] = [];

beforeEach(() => {
  reported = [];
  vi.stubGlobal("reportError", (error: unknown) => reported.push(error));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("afterLayout", () => {
  it("runs what asked once the page is laid out, all of it in one turn, in order", async () => {
    const { page, frame } = stubPage();
    const { afterLayout } = await import("./afterLayout");
    const ran: string[] = [];
    afterLayout(() => ran.push("a"));
    afterLayout(() => ran.push("b"));
    expect(ran).toEqual([]);
    frame();
    expect(ran).toEqual(["a", "b"]);
    // One observation asked for the frame, however many callbacks waited on it.
    expect(page.observed).toBe(1);
    frame();
    expect(ran).toEqual(["a", "b"]);
  });

  it("runs at once what asks while its turn runs", async () => {
    const { frame } = stubPage();
    const { afterLayout } = await import("./afterLayout");
    const ran: string[] = [];
    afterLayout(() => {
      ran.push("outer");
      afterLayout(() => ran.push("inner"));
    });
    frame();
    expect(ran).toEqual(["outer", "inner"]);
  });

  // A draw flushed inside another observer's delivery (a list measuring its
  // rows) asks from there: observing then is skipped, and the browser reports
  // a loop error. It waits for the next frame instead, and never errs.
  it("asked from inside another observer's delivery, runs the next frame without a loop error", async () => {
    const { page, frame, other } = stubPage();
    const { afterLayout } = await import("./afterLayout");
    const ran: string[] = [];
    other(() => afterLayout(() => ran.push("asked in delivery")));
    frame();
    expect(page.skipped).toBe(0);
    frame();
    expect(ran).toEqual(["asked in delivery"]);
    expect(page.skipped).toBe(0);
  });

  it("runs the rest of a turn when one callback throws, and reports the throw", async () => {
    const { frame } = stubPage();
    const { afterLayout } = await import("./afterLayout");
    const ran: string[] = [];
    const broken = new Error("broken reader");
    afterLayout(() => ran.push("before"));
    afterLayout(() => {
      throw broken;
    });
    afterLayout(() => ran.push("after"));
    frame();
    expect(ran).toEqual(["before", "after"]);
    expect(reported).toEqual([broken]);
    // The next ask is heard as ever.
    afterLayout(() => ran.push("next"));
    frame();
    expect(ran).toEqual(["before", "after", "next"]);
  });

  it("runs at once on a page without a ResizeObserver", async () => {
    vi.stubGlobal("ResizeObserver", undefined);
    const { afterLayout } = await import("./afterLayout");
    const ran: string[] = [];
    afterLayout(() => ran.push("now"));
    expect(ran).toEqual(["now"]);
  });
});
