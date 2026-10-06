// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

/** The page's ResizeObserver: what it was asked to observe, and its callback to run as a frame would. */
function stubObserver() {
  const observed: Element[] = [];
  let report: (() => void) | undefined;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        report = callback;
      }
      observe(target: Element) {
        observed.push(target);
      }
      unobserve() {}
      disconnect() {}
    },
  );
  return { observed, layOut: () => report?.() };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("afterLayout", () => {
  it("runs what asked once the page is laid out, all of it in one turn, in order", async () => {
    const page = stubObserver();
    const { afterLayout } = await import("./afterLayout");
    const ran: string[] = [];
    afterLayout(() => ran.push("a"));
    afterLayout(() => ran.push("b"));
    expect(ran).toEqual([]);
    // One observation asked for the frame, however many callbacks wait on it.
    expect(page.observed).toHaveLength(1);
    page.layOut();
    expect(ran).toEqual(["a", "b"]);
    page.layOut();
    expect(ran).toEqual(["a", "b"]);
  });

  it("runs at once what asks while the turn runs, and asks anew for the next frame after it", async () => {
    const page = stubObserver();
    const { afterLayout } = await import("./afterLayout");
    const ran: string[] = [];
    afterLayout(() => {
      ran.push("outer");
      afterLayout(() => ran.push("inner"));
    });
    page.layOut();
    expect(ran).toEqual(["outer", "inner"]);
    afterLayout(() => ran.push("next"));
    expect(page.observed).toHaveLength(2);
    page.layOut();
    expect(ran).toEqual(["outer", "inner", "next"]);
  });

  it("runs at once on a page without a ResizeObserver", async () => {
    vi.stubGlobal("ResizeObserver", undefined);
    const { afterLayout } = await import("./afterLayout");
    const ran: string[] = [];
    afterLayout(() => ran.push("now"));
    expect(ran).toEqual(["now"]);
  });
});
