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
