import { describe, expect, it } from "vite-plus/test";

import {
  matePressLockName,
  withExclusiveLock,
  withLockIfFree,
  type LockManagerLike,
} from "./mateLocks";

/** The page's exclusive locks, as `navigator.locks` grants them: one holder per name. */
function fakeLocks() {
  const held = new Set<string>();
  const waiting = new Map<string, Array<() => void>>();
  const asked: Array<string> = [];
  const locks: LockManagerLike = {
    request: async (name, options, hold) => {
      asked.push(name);
      if (held.has(name)) {
        if (options.ifAvailable === true) return hold(null);
        await new Promise<void>((resolve) => {
          waiting.set(name, [...(waiting.get(name) ?? []), resolve]);
        });
      }
      held.add(name);
      try {
        return await hold({ name });
      } finally {
        held.delete(name);
        const next = waiting.get(name)?.shift();
        next?.();
      }
    },
  };
  return { locks, asked };
}

describe("the locks a Mate's setup holds across this browser's tabs", () => {
  it("names a press's lock by its project", () => {
    expect(matePressLockName("p-1")).toBe("mate:press:p-1");
  });

  it("runs a press only where no other tab is running one for the project", async () => {
    const { locks } = fakeLocks();
    let release: () => void = () => undefined;
    const first = withLockIfFree(
      locks,
      "mate:press:p-1",
      () =>
        new Promise<string>((resolve) => {
          release = () => resolve("first");
        }),
      () => "busy",
    );
    const second = await withLockIfFree(
      locks,
      "mate:press:p-1",
      async () => "second",
      () => "busy",
    );
    expect(second).toBe("busy");
    release();
    expect(await first).toBe("first");
    expect(
      await withLockIfFree(
        locks,
        "mate:press:p-1",
        async () => "third",
        () => "busy",
      ),
    ).toBe("third");
  });

  it("queues one press behind another for the same project", async () => {
    const { locks } = fakeLocks();
    const order: Array<string> = [];
    let release: () => void = () => undefined;
    const first = withExclusiveLock(locks, "mate:press:p-2", async () => {
      order.push("first in");
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      order.push("first out");
    });
    const second = withExclusiveLock(locks, "mate:press:p-2", async () => {
      order.push("second");
    });
    await Promise.resolve();
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(["first in", "first out", "second"]);
  });

  it("runs as it is where the browser has no locks", async () => {
    expect(
      await withLockIfFree(
        undefined,
        "mate:press:p-1",
        async () => "ran",
        () => "busy",
      ),
    ).toBe("ran");
    expect(await withExclusiveLock(undefined, "mate:press:p-2", async () => "ran")).toBe("ran");
  });
});
