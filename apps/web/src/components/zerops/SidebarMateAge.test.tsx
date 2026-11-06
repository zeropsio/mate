import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { SidebarMateAge } from "./SidebarMateAge";

let tree: ReactTestRenderer | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-07T10:00:00.400Z"));
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function labels(): string[] {
  return tree!.root
    .findAllByProps({ "data-zerops-surface": "sidebar-mate-time" })
    .map((label) => label.children.join(""));
}

describe("idle Mate age", () => {
  it.each([
    { at: "2026-10-07T09:01:00Z", before: "59m", after: "1h" },
    { at: "2026-10-06T10:01:00Z", before: "23h", after: "1d" },
    { at: "2026-10-07T10:00:00Z", before: "now", after: "1m" },
  ])("advances $before to $after", ({ at, before, after }) => {
    act(() => {
      tree = create(<SidebarMateAge at={at} />);
    });
    expect(labels()).toEqual([before]);
    act(() => vi.advanceTimersByTime(59_600));
    expect(labels()).toEqual([after]);
  });

  it.each([undefined, "invalid"])("shows no age for %s", (at) => {
    act(() => {
      tree = create(<SidebarMateAge at={at} />);
    });
    expect(labels()).toEqual([]);
  });
});
