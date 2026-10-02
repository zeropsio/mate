import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { startRefreshClock, type PageVisibility } from "./refreshClock";

function page(): PageVisibility & { show: (visible: boolean) => void } {
  const listeners = new Set<() => void>();
  const view = {
    hidden: false,
    addEventListener: (_type: "visibilitychange", listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: "visibilitychange", listener: () => void) =>
      listeners.delete(listener),
    show: (visible: boolean) => {
      view.hidden = !visible;
      for (const listener of listeners) listener();
    },
  };
  return view;
}

describe("startRefreshClock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("refreshes on its interval while the page is visible", () => {
    const refresh = vi.fn();
    startRefreshClock({ refresh, everyMs: 60_000, page: page() });
    vi.advanceTimersByTime(59_999);
    expect(refresh).toHaveBeenCalledTimes(0);
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(120_000);
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("reads nothing while hidden, and once on coming back if a tick was missed", () => {
    const refresh = vi.fn();
    const view = page();
    startRefreshClock({ refresh, everyMs: 60_000, page: view });
    view.show(false);
    vi.advanceTimersByTime(10 * 60_000);
    expect(refresh).toHaveBeenCalledTimes(0);
    view.show(true);
    expect(refresh).toHaveBeenCalledTimes(1);
    view.show(false);
    view.show(true);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("stops when stopped", () => {
    const refresh = vi.fn();
    const view = page();
    const stop = startRefreshClock({ refresh, everyMs: 60_000, page: view });
    view.show(false);
    vi.advanceTimersByTime(60_000);
    stop();
    view.show(true);
    vi.advanceTimersByTime(600_000);
    expect(refresh).toHaveBeenCalledTimes(0);
  });
});
