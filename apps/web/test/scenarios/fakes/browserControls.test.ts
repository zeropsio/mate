// @effect-diagnostics nodeBuiltinImport:off -- browser boundary controls against a tiny loopback document.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";
import { openBrowser, clickText } from "../harness/browser.ts";
import { completedHttp } from "../harness/completedHttp.ts";

it("manual client timers cross Retry-After/backoff deadlines and coalesce timers across sleep/wake", async () => {
  const dist = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "scenario-clock-"));
  await NodeFSP.writeFile(
    NodePath.join(dist, "index.html"),
    "<!doctype html><title>Clock driver</title>",
  );
  const web = await openBrowser(dist, {});
  try {
    const clock = web.clock(web.page);
    await clock.install();
    await web.page.goto(web.origin);
    await web.page.evaluate(() => {
      const receipts: number[] = [];
      Object.assign(window, { receipts, started: Date.now() });
      setTimeout(() => {
        receipts.push(Date.now());
        setTimeout(() => receipts.push(Date.now()), 2000);
      }, 7000);
    });
    await clock.advance(6999);
    expect(
      await web.page.evaluate(() => (window as unknown as { receipts: number[] }).receipts),
    ).toEqual([]);
    await clock.advance(3001);
    expect(
      await web.page.evaluate(() => {
        const state = window as unknown as { receipts: number[]; started: number };
        return state.receipts.map((at) => at - state.started);
      }),
    ).toEqual([7000, 9000]);
    await web.page.evaluate(() => {
      const state = window as unknown as { receipts: number[] };
      const id = setInterval(() => state.receipts.push(Date.now()), 1000);
      setTimeout(() => clearInterval(id), 60_000);
    });
    await clock.sleep();
    await clock.wake(3_600_000);
    expect(
      await web.page.evaluate(() => (window as unknown as { receipts: number[] }).receipts.length),
    ).toBe(3);
    expect(web.pageErrors).toEqual([]);
  } finally {
    await web.close();
    await NodeFSP.rm(dist, { recursive: true, force: true });
  }
});

it.each(["held reply", "default HTTP settling"])(
  "settles retry replies between timer deadlines (%s), including response-driven backoff",
  async (mode) => {
    const { serve, deadline } = await import("../harness/http.ts");
    const dist = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "scenario-stepped-clock-"));
    await NodeFSP.writeFile(
      NodePath.join(dist, "index.html"),
      "<!doctype html><title>Stepped clock</title>",
    );
    let admitted = () => {};
    const requested = new Promise<void>((resolve) => {
      admitted = resolve;
    });
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let requests = 0;
    const api = await serve(async () => {
      if (++requests === 1) {
        admitted();
        if (mode === "held reply") await held;
        return {
          status: 429,
          headers: { "Retry-After": "2", "Access-Control-Expose-Headers": "Retry-After" },
          body: { retry: true },
        };
      }
      return { body: { done: true } };
    });
    const web = await openBrowser(dist, { "https://retry.example.test": api.origin });
    const settledHttp = completedHttp(web.page);
    try {
      const clock = web.clock(web.page);
      await clock.install();
      await web.page.goto(web.origin);
      await web.page.evaluate(() => {
        const events: [string, number, boolean?][] = [];
        const started = Date.now();
        let complete = false;
        const retry = async () => {
          const response = await fetch("https://retry.example.test/retry");
          await response.json();
          events.push([`reply-${response.status}`, Date.now() - started]);
          if (response.status === 429)
            setTimeout(() => void retry(), Number(response.headers.get("Retry-After")) * 1000);
          else complete = true;
        };
        Object.assign(window, { events });
        setTimeout(() => void retry(), 1000);
        setTimeout(() => events.push(["deadline", Date.now() - started, complete]), 4000);
      });
      const settle = async () => {
        await deadline(requested, "retry admission");
        release();
        await settledHttp();
        await web.page.waitForFunction(
          (count) =>
            (window as unknown as { events: [string, number, boolean?][] }).events.filter(
              ([name]) => name.startsWith("reply-"),
            ).length === count,
          { timeout: 10_000, polling: "raf" },
          requests,
        );
      };
      await clock.advanceStepped(5000, mode === "held reply" ? { settle } : {});
      expect(
        await web.page.evaluate(() => (window as unknown as { events: unknown[] }).events),
      ).toEqual([
        ["reply-429", 1000],
        ["reply-200", 3000],
        ["deadline", 4000, true],
      ]);
      expect(requests).toBe(2);
      await web.page.evaluate(() => {
        setTimeout(
          () => setTimeout(() => Object.assign(window, { nextReceipt: Date.now() }), 1),
          2117,
        );
      });
      await clock.advanceUntil(
        () => web.page.evaluate(() => "nextReceipt" in window),
        "next scheduled client timer receipt",
      );
      expect(
        await web.page.evaluate(() => {
          const state = window as unknown as {
            nextReceipt: number;
            events: [string, number, boolean?][];
          };
          return state.nextReceipt - Date.now();
        }),
      ).toBe(0);
    } finally {
      release();
      await web.close();
      await api.close();
      await NodeFSP.rm(dist, { recursive: true, force: true });
    }
  },
);

it("clicking visible text reacquires a row replaced during the browser's clickability check", async () => {
  const dist = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "scenario-click-"));
  await NodeFSP.writeFile(
    NodePath.join(dist, "index.html"),
    '<!doctype html><button data-zerops-surface="click-test">Open Mate</button>',
  );
  const web = await openBrowser(dist, {});
  try {
    await web.page.goto(web.origin);
    await web.page.evaluate(() => {
      const original = document.querySelector<HTMLButtonElement>(
        '[data-zerops-surface="click-test"]',
      )!;
      const bounds = original.getBoundingClientRect.bind(original);
      let reads = 0;
      Object.defineProperty(original, "getBoundingClientRect", {
        value: () => {
          const rectangle = bounds();
          if (++reads === 2) {
            const replacement = original.cloneNode(true) as HTMLButtonElement;
            replacement.addEventListener("click", () => {
              replacement.innerText = "Mate opened";
            });
            original.replaceWith(replacement);
          }
          return rectangle;
        },
      });
    });
    await clickText(web.page, "click-test", "Open Mate");
    expect(await web.page.evaluate(() => document.body.innerText)).toBe("Mate opened");
  } finally {
    await web.close();
    await NodeFSP.rm(dist, { recursive: true, force: true });
  }
});
