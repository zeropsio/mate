// @effect-diagnostics nodeBuiltinImport:off -- disposable browser documents prove timer cancellation.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";
import { openBrowser } from "../harness/browser.ts";

it.each(["advance", "advanceStepped"] as const)(
  "%s does not run a timer cancelled while its deadline is being acknowledged",
  async (mode) => {
    let now = Date.now();
    let cancel: (() => Promise<void>) | undefined;
    const dist = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "scenario-cancel-clock-"));
    await NodeFSP.writeFile(
      NodePath.join(dist, "index.html"),
      "<!doctype html><title>Timers</title>",
    );
    const web = await openBrowser(
      dist,
      {},
      {
        currentTimeMillis: () => now,
        setTime: async (time) => {
          now = time;
          const pending = cancel;
          cancel = undefined;
          await pending?.();
        },
      },
    );
    try {
      const clock = web.clock(web.page);
      await clock.install();
      await web.page.goto(web.origin);
      const id = await web.page.evaluate(() => {
        const cancelled = setTimeout(() => document.body.append("cancelled"), 1);
        setTimeout(() => document.body.append("survived"), 2);
        return cancelled;
      });
      cancel = async () => {
        await web.page.evaluate((id) => clearTimeout(id), id);
      };
      await clock[mode](3);
      expect(await web.page.evaluate(() => document.body.innerText)).toBe("survived");
    } finally {
      await web.close();
      await NodeFSP.rm(dist, { recursive: true, force: true });
    }
  },
);

it("a clock installed in the current document preserves its content and cancels its earlier native waits", async () => {
  const dist = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "scenario-current-clock-"));
  await NodeFSP.writeFile(
    NodePath.join(dist, "index.html"),
    "<!doctype html><title>Timers</title><body>retained:</body>",
  );
  const web = await openBrowser(dist, {});
  try {
    await web.page.goto(web.origin);
    const nativeIds = await web.page.evaluate(() => {
      const timeout = setTimeout(() => document.body.append("native timeout"), 3_600_000);
      const interval = setInterval(() => document.body.append("native interval"), 3_600_000);
      const clearTimeout = window.clearTimeout.bind(window);
      const clearInterval = window.clearInterval.bind(window);
      const cleared = { timeouts: [] as number[], intervals: [] as number[] };
      window.clearTimeout = (id) => {
        cleared.timeouts.push(Number(id));
        clearTimeout(Number(id));
      };
      window.clearInterval = (id) => {
        cleared.intervals.push(Number(id));
        clearInterval(Number(id));
      };
      Reflect.set(window, "nativeCleared", cleared);
      return { timeout, interval };
    });
    const clock = web.clock(web.page);
    await clock.install({ currentDocument: true });
    const controlledId = await web.page.evaluate(({ timeout, interval }) => {
      const cancelled = setTimeout(() => document.body.append("cancelled"), 1);
      clearTimeout(cancelled);
      clearTimeout(timeout);
      clearInterval(interval);
      const first = setTimeout(() => document.body.append("first,"), 1);
      setTimeout(() => document.body.append("second"), 1);
      return first;
    }, nativeIds);
    expect([nativeIds.timeout, nativeIds.interval]).not.toContain(controlledId);
    expect(await web.page.evaluate(() => Reflect.get(window, "nativeCleared"))).toEqual({
      timeouts: [nativeIds.timeout],
      intervals: [nativeIds.interval],
    });
    await clock.advance(1);
    expect(await web.page.evaluate(() => document.body.innerText)).toBe("retained:first,second");
  } finally {
    await web.close();
    await NodeFSP.rm(dist, { recursive: true, force: true });
  }
});

it("stepped time holds at the receipt instead of expiring the attempt it started", async () => {
  let now = 0;
  const dist = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "scenario-receipt-clock-"));
  await NodeFSP.writeFile(
    NodePath.join(dist, "index.html"),
    "<!doctype html><title>Admission</title>",
  );
  const web = await openBrowser(
    dist,
    {},
    {
      currentTimeMillis: () => now,
      setTime: (time) => {
        now = time;
      },
    },
  );
  try {
    const clock = web.clock(web.page);
    await clock.install();
    await web.page.goto(web.origin);
    await web.page.evaluate(() => {
      setTimeout(() => {
        document.body.textContent = "ticket requested";
        setTimeout(() => {
          document.body.textContent = "ticket expired";
        }, 1_000);
      }, 100);
    });
    let received = false;
    const options = {
      until: () => received,
      settle: async () => {
        received = await web.page.evaluate(() => document.body.textContent === "ticket requested");
      },
    };
    await clock.advanceStepped(2_000, options);
    expect(
      await web.page.evaluate(() => document.body.textContent),
      "ASSERTION: the ticket receipt holds the clock before the admission expires",
    ).toBe("ticket requested");
    expect(now).toBe(100);
    await clock.advanceStepped(2_000, options);
    expect(now).toBe(100);
    await clock.advanceStepped(1_000);
    expect(await web.page.evaluate(() => document.body.textContent)).toBe("ticket expired");
    expect(now).toBe(1_100);
  } finally {
    await web.close();
    await NodeFSP.rm(dist, { recursive: true, force: true });
  }
});
