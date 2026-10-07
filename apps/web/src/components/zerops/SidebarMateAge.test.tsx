import { act, memo, Profiler } from "react";
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
  it("ages on one shared minute clock, rendering only the labels", () => {
    const menuRender = vi.fn();
    const rowRender = vi.fn();
    const siblingRender = vi.fn();
    const labelRender = vi.fn();
    function Sibling() {
      siblingRender();
      return <span>Finished reply</span>;
    }
    const IdleRow = memo(function IdleRow({ at }: { readonly at: string }) {
      rowRender();
      return (
        <div>
          <Sibling />
          <Profiler id={at} onRender={labelRender}>
            <SidebarMateAge at={at} />
          </Profiler>
        </div>
      );
    });
    function Menu() {
      menuRender();
      return (
        <>
          <IdleRow at="2026-10-07T09:59:00.000Z" />
          <IdleRow at="2026-10-07T09:58:00.000Z" />
        </>
      );
    }
    act(() => {
      tree = create(<Menu />);
    });
    expect(labels()).toEqual(["1m", "2m"]);
    expect(vi.getTimerCount()).toBe(1);
    labelRender.mockClear();
    act(() => vi.advanceTimersByTime(1000));
    expect(labelRender).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(58_600));
    expect(labels()).toEqual(["2m", "3m"]);
    expect(labelRender).toHaveBeenCalledTimes(2);
    // A throttled/backgrounded tab reads the real minute at its next tick.
    vi.setSystemTime(new Date("2026-10-07T10:30:59.000Z"));
    act(() => vi.advanceTimersByTime(60_000));
    expect(labels()).toEqual(["32m", "33m"]);
    expect(menuRender).toHaveBeenCalledTimes(1);
    expect(rowRender).toHaveBeenCalledTimes(2);
    expect(siblingRender).toHaveBeenCalledTimes(2);
    act(() => tree!.unmount());
    expect(vi.getTimerCount()).toBe(0);
  });

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
