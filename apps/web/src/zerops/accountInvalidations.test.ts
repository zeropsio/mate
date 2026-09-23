import type { Invalidation } from "@t3tools/client-runtime/zerops/knowledge";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { bindTestInvalidationBus, type BoundTestBus } from "./__fixtures__/invalidationBus";
import { closeAccountLifetime, openAccountLifetime } from "./accountLifetime";
import { invalidateZerops, onZeropsInvalidation } from "./accountInvalidations";

const container = (target: `${string}:${string}`): Invalidation => ({ topic: "container", target });

/** Everything a listener hears, until the test ends. */
function listen() {
  const heard: Array<Invalidation> = [];
  stops.push(onZeropsInvalidation((invalidation) => heard.push(invalidation)));
  return heard;
}

/** An account's bus, bound as the host binds its runtime's. */
function bind(): BoundTestBus {
  const bound = bindTestInvalidationBus();
  stops.push(bound.close);
  return bound;
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
});

describe("the web's binding to the account's invalidation bus (DESIGN §6.2)", () => {
  it("carries a surface's intent into the bound bus, and the bus's invalidations to every listener", async () => {
    fakeClocks();
    openAccountLifetime("account");
    const bus = bind();
    const first = listen();
    const second = listen();

    invalidateZerops(container("p1:s1"));
    invalidateZerops(container("p1:s1"));
    bus.invalidate({ topic: "access", change: "lapsed" });
    await vi.advanceTimersByTimeAsync(249);
    expect(first).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    expect(first).toEqual([container("p1:s1"), { topic: "access", change: "lapsed" }]);
    expect(second).toEqual(first);
  });

  it("keeps delivering to every listener after one of them throws", async () => {
    fakeClocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    openAccountLifetime("account");
    bind();
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

  it("unbinds when the account closes: a request still coalescing reaches nobody", async () => {
    fakeClocks();
    openAccountLifetime("account-a");
    bind();
    const heard = listen();
    invalidateZerops(container("p1:s1"));
    closeAccountLifetime();
    await vi.advanceTimersByTimeAsync(250);
    expect(heard).toEqual([]);

    // A write that answers after sign-out still reports what it changed.
    invalidateZerops(container("p1:s1"));
    await vi.advanceTimersByTimeAsync(250);
    expect(heard).toEqual([]);

    openAccountLifetime("account-b");
    bind();
    invalidateZerops(container("p1:s1"));
    await vi.advanceTimersByTimeAsync(250);
    expect(heard).toEqual([container("p1:s1")]);
  });

  it("an unbind of a replaced bus leaves the newer one bound", async () => {
    fakeClocks();
    openAccountLifetime("account");
    const older = bindTestInvalidationBus();
    bind();
    const heard = listen();
    older.close();

    invalidateZerops(container("p1:s1"));
    await vi.advanceTimersByTimeAsync(250);
    expect(heard).toEqual([container("p1:s1")]);
  });
});
