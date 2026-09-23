import type { Invalidation } from "@t3tools/client-runtime/zerops/knowledge";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { closeAccountLifetime, openAccountLifetime } from "./accountLifetime";
import { invalidateZerops, onZeropsInvalidation } from "./accountInvalidations";

const container = (target: `${string}:${string}`): Invalidation => ({ topic: "container", target });

/** Everything a listener hears, until the test ends. */
function listen() {
  const heard: Array<Invalidation> = [];
  stops.push(onZeropsInvalidation((invalidation) => heard.push(invalidation)));
  return heard;
}

/**
 * Fake timers on both of the bus's clocks: Effect reads monotonic time off `process.hrtime` in
 * node, which fake timers leave running, so it follows the faked `performance` here.
 */
function fakeClocks() {
  vi.useFakeTimers({ toFake: ["Date", "performance", "setTimeout", "clearTimeout"] });
  vi.spyOn(process.hrtime, "bigint").mockImplementation(() =>
    BigInt(Math.round(performance.now() * 1_000_000)),
  );
}

const stops: Array<() => void> = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  closeAccountLifetime();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the account's invalidation bus on the web (DESIGN §6.2)", () => {
  it("reaches every listener once per key, when the key's 250 ms window closes", async () => {
    fakeClocks();
    openAccountLifetime("account");
    const first = listen();
    const second = listen();

    invalidateZerops(container("p1:s1"));
    invalidateZerops(container("p1:s1"));
    invalidateZerops(container("p2:s2"));
    await vi.advanceTimersByTimeAsync(249);
    expect(first).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    expect(first).toEqual([container("p1:s1"), container("p2:s2")]);
    expect(second).toEqual(first);
  });

  it("holds what a tab hidden for a minute hears until the tab is shown again", async () => {
    fakeClocks();
    const tab = new EventTarget() as EventTarget & { visibilityState: DocumentVisibilityState };
    tab.visibilityState = "visible";
    vi.stubGlobal("document", tab);
    const turn = (visibilityState: DocumentVisibilityState) => {
      tab.visibilityState = visibilityState;
      tab.dispatchEvent(new Event("visibilitychange"));
    };
    openAccountLifetime("account");
    const heard = listen();
    invalidateZerops(container("p1:s1"));
    await vi.advanceTimersByTimeAsync(250);
    expect(heard).toEqual([container("p1:s1")]);

    turn("hidden");
    await vi.advanceTimersByTimeAsync(60_000);
    invalidateZerops(container("p2:s2"));
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(heard).toEqual([container("p1:s1")]);

    turn("visible");
    await vi.advanceTimersByTimeAsync(0);
    expect(heard).toEqual([container("p1:s1"), container("p2:s2")]);
  });

  it("keeps delivering to every listener after one of them throws", async () => {
    fakeClocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    openAccountLifetime("account");
    stops.push(
      onZeropsInvalidation(() => {
        throw new Error("a broken listener");
      }),
    );
    const heard = listen();
    invalidateZerops(container("p1:s1"));
    await vi.advanceTimersByTimeAsync(250);
    invalidateZerops(container("p2:s2"));
    await vi.advanceTimersByTimeAsync(250);
    expect(heard).toEqual([container("p1:s1"), container("p2:s2")]);
  });

  it("drops a request still coalescing when the account closes", async () => {
    fakeClocks();
    openAccountLifetime("account-a");
    const heard = listen();
    invalidateZerops(container("p1:s1"));
    closeAccountLifetime();
    openAccountLifetime("account-b");
    await vi.advanceTimersByTimeAsync(250);
    expect(heard).toEqual([]);

    invalidateZerops(container("p1:s1"));
    await vi.advanceTimersByTimeAsync(250);
    expect(heard).toEqual([container("p1:s1")]);
  });

  it("drops a request sent while no account is open, and opens no bus for the next one", async () => {
    fakeClocks();
    const heard = listen();
    openAccountLifetime("account-a");
    closeAccountLifetime();
    // A write that answers after sign-out still reports what it changed.
    invalidateZerops(container("p1:s1"));
    await vi.advanceTimersByTimeAsync(250);
    expect(heard).toEqual([]);

    openAccountLifetime("account-b");
    closeAccountLifetime();
    await vi.advanceTimersByTimeAsync(250);
    expect(heard).toEqual([]);
  });
});
