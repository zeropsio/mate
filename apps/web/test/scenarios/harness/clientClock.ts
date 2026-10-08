import type { CDPSession, Page } from "puppeteer-core";
import { completedHttp } from "./completedHttp.ts";

export interface SteppedAdvanceOptions {
  /** Override the default completed-HTTP condition, e.g. to release held replies and await receipts. */
  settle?: () => Promise<void>;
  timeout?: number;
}

export interface ScenarioWallClock {
  currentTimeMillis(): number;
  setTime(timestamp: number): void;
}

/** Opt-in clock at the browser API boundary. Install before navigation/sign-in. */
export function clientClock(page: Page, wallClock?: ScenarioWallClock) {
  const settleHttp = completedHttp(page);
  let installed = false;
  let frozenSession: CDPSession | undefined;
  let refreshEpoch = async () => {};
  const install = async () => {
    if (installed) return;
    installed = true;
    const initialTime = wallClock?.currentTimeMillis();
    if (wallClock) {
      wallClock.setTime(initialTime!);
      await page.exposeFunction("scenarioClockTime", (timestamp: number) =>
        wallClock.setTime(timestamp),
      );
    }
    const registerDocument = (initialTime?: number) =>
      page.evaluateOnNewDocument((initialTime) => {
        const NativeDate = Date;
        const nativeTimeout = window.setTimeout.bind(window);
        const nativeClear = window.clearTimeout.bind(window);
        const nativeTimers = new Map<number, number>();
        let now = initialTime ?? NativeDate.now();
        const setNow = async (timestamp: number) => {
          now = timestamp;
          if (initialTime !== undefined)
            await (
              window as unknown as { scenarioClockTime(timestamp: number): Promise<void> }
            ).scenarioClockTime(timestamp);
        };
        // A reload starts at this document's clock epoch too.
        void setNow(now);
        let serial = 0;
        const timers = new Map<number, { at: number; interval?: number; callback: () => void }>();
        window.Date = new Proxy(NativeDate, {
          construct: (target, args) => Reflect.construct(target, args.length ? args : [now]),
          apply: () => new NativeDate(now).toString(),
          get: (target, key) => (key === "now" ? () => now : Reflect.get(target, key)),
        });
        const schedule = (
          callback: TimerHandler,
          delay = 0,
          args: unknown[],
          interval?: number,
        ) => {
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
          if (coalesce) await setNow(end);
          for (;;) {
            const next = [...timers.entries()]
              .filter(([, timer]) => timer.at <= end)
              .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
            if (!next) break;
            if (++turns > 10_000)
              throw new Error("Scenario clock timer loop exceeded 10,000 callbacks");
            const [id, timer] = next;
            if (!coalesce) await setNow(timer.at);
            // A clock acknowledgement can cancel or replace the selected callback.
            if (timers.get(id) !== timer) continue;
            timers.delete(id);
            if (timer.interval !== undefined)
              timers.set(id, { ...timer, at: now + timer.interval });
            timer.callback();
            await Promise.resolve();
          }
          await setNow(end);
        };
        const step = async (end: number) => {
          const next = [...timers.entries()]
            .filter(([, timer]) => timer.at <= end)
            .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
          if (!next) {
            await setNow(end);
            return false;
          }
          const [id, timer] = next;
          await setNow(timer.at);
          if (timers.get(id) !== timer) return true;
          timers.delete(id);
          if (timer.interval !== undefined) timers.set(id, { ...timer, at: now + timer.interval });
          timer.callback();
          await Promise.resolve();
          return true;
        };
        Object.assign(window, {
          scenarioClock: { advance, step, now: () => now, pending: () => timers.size },
        });
      }, initialTime);
    let script = await registerDocument(initialTime);
    refreshEpoch = async () => {
      if (!wallClock) return;
      // Keep subsequent navigation/reload at the advanced epoch, not the installation epoch.
      await page.removeScriptToEvaluateOnNewDocument(script.identifier);
      script = await registerDocument(wallClock.currentTimeMillis());
    };
  };
  const advance = async (ms: number, coalesce = false) => {
    if (!installed) throw new Error("Install clientClock before sign-in/navigation");
    if (!Number.isFinite(ms) || ms < 0)
      throw new Error("Clock advance must be nonnegative and finite");
    await page.evaluate(
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
    await refreshEpoch();
  };
  return {
    install,
    advance,
    async advanceStepped(ms: number, options: SteppedAdvanceOptions = {}) {
      if (!installed) throw new Error("Install clientClock before sign-in/navigation");
      if (!Number.isFinite(ms) || ms < 0)
        throw new Error("Clock advance must be nonnegative and finite");
      const end = await page.evaluate(
        (ms) =>
          (window as unknown as { scenarioClock: { now(): number } }).scenarioClock.now() + ms,
        ms,
      );
      const settle = options.settle ?? (() => settleHttp(options.timeout));
      let turns = 0;
      while (
        await page.evaluate(
          (end) =>
            (
              window as unknown as { scenarioClock: { step(end: number): Promise<boolean> } }
            ).scenarioClock.step(end),
          end,
        )
      ) {
        if (++turns > 10_000)
          throw new Error("Scenario clock timer loop exceeded 10,000 callbacks");
        await settle();
      }
      await refreshEpoch();
    },
    async sleep() {
      if (!installed) throw new Error("Install clientClock before sign-in/navigation");
      const cdp = await page.createCDPSession();
      try {
        await cdp.send("Page.setWebLifecycleState", { state: "frozen" });
        // A new session can wait on the frozen renderer; resume through the one that froze it.
        frozenSession = cdp;
      } catch (error) {
        await cdp.detach();
        throw error;
      }
    },
    async wake(elapsedMs: number) {
      const cdp = frozenSession ?? (await page.createCDPSession());
      try {
        await cdp.send("Page.setWebLifecycleState", { state: "active" });
      } finally {
        frozenSession = undefined;
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
