// @effect-diagnostics nodeBuiltinImport:off -- browser boundary controls against a tiny loopback document.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";
import { openBrowser } from "../harness/browser.ts";

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
