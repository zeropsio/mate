import type { Page } from "puppeteer-core";

/** Opt-in clock at the browser API boundary. Install before navigation/sign-in. */
export function clientClock(page: Page) {
  let installed = false;
  const install = async () => {
    if (installed) return;
    installed = true;
    await page.evaluateOnNewDocument(() => {
      const NativeDate = Date;
      const nativeTimeout = window.setTimeout.bind(window);
      const nativeClear = window.clearTimeout.bind(window);
      const nativeTimers = new Map<number, number>();
      let now = NativeDate.now();
      let serial = 0;
      const timers = new Map<number, { at: number; interval?: number; callback: () => void }>();
      window.Date = new Proxy(NativeDate, {
        construct: (target, args) => Reflect.construct(target, args.length ? args : [now]),
        apply: () => new NativeDate(now).toString(),
        get: (target, key) => (key === "now" ? () => now : Reflect.get(target, key)),
      });
      const schedule = (callback: TimerHandler, delay = 0, args: unknown[], interval?: number) => {
        if (typeof callback !== "function")
          throw new Error("Scenario clock requires function timers");
        const id = ++serial;
        // Zero-delay jobs are the client's task scheduler, not a timed backoff. Keep that
        // scheduler live so promises/React can make progress while positive waits are paused.
        if (delay <= 0 && interval === undefined) {
          nativeTimers.set(
            id,
            nativeTimeout(() => {
              nativeTimers.delete(id);
              callback(...args);
            }, 0),
          );
          return id;
        }
        timers.set(id, {
          at: now + Math.max(0, delay),
          ...(interval === undefined ? {} : { interval }),
          callback: () => callback(...args),
        });
        return id;
      };
      Object.assign(window, {
        setTimeout: (callback: TimerHandler, delay?: number, ...args: unknown[]) =>
          schedule(callback, delay, args),
        setInterval: (callback: TimerHandler, delay?: number, ...args: unknown[]) =>
          schedule(callback, delay, args, Math.max(1, delay ?? 0)),
        clearTimeout: (id: number) => {
          timers.delete(id);
          const native = nativeTimers.get(id);
          if (native !== undefined) {
            nativeClear(native);
            nativeTimers.delete(id);
          }
        },
        clearInterval: (id: number) => {
          timers.delete(id);
          const native = nativeTimers.get(id);
          if (native !== undefined) {
            nativeClear(native);
            nativeTimers.delete(id);
          }
        },
      });
      const advance = async (ms: number, coalesce: boolean) => {
        const end = now + ms;
        let turns = 0;
        if (coalesce) now = end;
        for (;;) {
          const next = [...timers.entries()]
            .filter(([, timer]) => timer.at <= end)
            .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
          if (!next) break;
          if (++turns > 10_000)
            throw new Error("Scenario clock timer loop exceeded 10,000 callbacks");
          const [id, timer] = next;
          if (!coalesce) now = timer.at;
          timers.delete(id);
          if (timer.interval !== undefined) timers.set(id, { ...timer, at: now + timer.interval });
          timer.callback();
          await Promise.resolve();
        }
        now = end;
      };
      Object.assign(window, {
        scenarioClock: { advance, now: () => now, pending: () => timers.size },
      });
    });
  };
  const advance = (ms: number, coalesce = false) => {
    if (!installed) throw new Error("Install clientClock before sign-in/navigation");
    if (!Number.isFinite(ms) || ms < 0)
      throw new Error("Clock advance must be nonnegative and finite");
    return page.evaluate(
      async (ms, coalesce) => {
        await (
          window as unknown as {
            scenarioClock: { advance(ms: number, coalesce: boolean): Promise<void> };
          }
        ).scenarioClock.advance(ms, coalesce);
      },
      ms,
      coalesce,
    );
  };
  return {
    install,
    advance,
    async sleep() {
      if (!installed) throw new Error("Install clientClock before sign-in/navigation");
      const cdp = await page.createCDPSession();
      try {
        await cdp.send("Page.setWebLifecycleState", { state: "frozen" });
      } finally {
        await cdp.detach();
      }
    },
    async wake(elapsedMs: number) {
      const cdp = await page.createCDPSession();
      try {
        await cdp.send("Page.setWebLifecycleState", { state: "active" });
      } finally {
        await cdp.detach();
      }
      await advance(elapsedMs, true);
      await page.evaluate(() => {
        window.dispatchEvent(new Event("online"));
        window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
      });
    },
  };
}
