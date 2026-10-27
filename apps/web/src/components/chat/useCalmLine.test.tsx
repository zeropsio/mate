import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { NOW_LINE_DWELL_MS } from "./nowLineCalm.logic";
import { useCalmLine } from "./useCalmLine";

function Line({ words, final = false }: { readonly words: string; readonly final?: boolean }) {
  return <>{useCalmLine(words, words, final)}</>;
}

const START = Date.parse("2026-10-01T10:00:00.000Z");

describe("useCalmLine — the line's timer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const shown = (renderer: ReactTestRenderer) => renderer.toJSON();

  it.each([
    { name: "on time: the waiting line shows when the dwell ends", stepBack: 0 },
    // A wall clock stepped back (or a timer that fired early) wakes it before
    // the dwell has ended: it waits out the rest, never sticks.
    { name: "woken early: it waits out the rest and then shows", stepBack: 300 },
  ])("$name", ({ stepBack }) => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Line words="Reading a.ts" />);
    });
    act(() => {
      vi.advanceTimersByTime(100);
      renderer.update(<Line words="Reading b.ts" />);
    });
    expect(shown(renderer)).toBe("Reading a.ts");
    act(() => {
      vi.setSystemTime(Date.now() - stepBack);
      vi.advanceTimersByTime(NOW_LINE_DWELL_MS - 100);
    });
    act(() => {
      vi.advanceTimersByTime(stepBack);
    });
    expect(shown(renderer)).toBe("Reading b.ts");
  });

  it("shows the run's end at once", () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Line words="Reading a.ts" />);
    });
    act(() => {
      renderer.update(<Line final words="Nova worked 1m 2s" />);
    });
    expect(shown(renderer)).toBe("Nova worked 1m 2s");
  });
});
