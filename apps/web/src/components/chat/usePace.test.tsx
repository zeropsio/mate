import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { PACE_GAP_MS } from "./runPace.logic";
import { usePace } from "./usePace";

/** What shows of `keys`: those the pace does not hold. */
function Shown({ keys }: { readonly keys: ReadonlyArray<string> }) {
  const held = usePace({ keys, flush: false });
  return <>{keys.filter((key) => !held.has(key)).join(",")}</>;
}

describe("usePace — as drawn", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-10-04T10:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // Rosa at a phone's width, 2026-10-04: a turn's answer arrived in one last
  // draw, nothing drew after it, and the pace never heard it — the answer
  // stayed out of the conversation for good.
  it("lets in what arrived in the last draw, with nothing drawn after it", () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Shown keys={["a"]} />);
    });
    act(() => {
      renderer.update(<Shown keys={["a", "answer"]} />);
    });
    act(() => {
      vi.advanceTimersByTime(PACE_GAP_MS * 2);
    });
    expect(renderer.toJSON()).toBe("a,answer");
  });

  it("lets a burst in one after another, the last within a second and a half", () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Shown keys={["a"]} />);
    });
    act(() => {
      renderer.update(<Shown keys={["a", "n1", "n2", "n3"]} />);
    });
    expect(renderer.toJSON()).toBe("a,n1");
    for (let step = 0; step < 15; step += 1) {
      act(() => {
        vi.advanceTimersByTime(100);
      });
    }
    expect(renderer.toJSON()).toBe("a,n1,n2,n3");
  });
});
