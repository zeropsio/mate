// @effect-diagnostics nodeBuiltinImport:off globalConsole:off -- disposable Chrome lifecycle measurements.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";
import { openBrowser } from "../harness/browser.ts";

it("scenarios reuse Chrome while discarding every context, cookie, storage value and permission", async () => {
  const dist = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "scenario-browser-"));
  await NodeFSP.writeFile(
    NodePath.join(dist, "index.html"),
    "<!doctype html><title>Isolation</title><div style='height: 2000px'>Scroll</div>",
  );
  const browsers = [];
  const contexts = [];
  const timings = [];
  try {
    for (let index = 0; index < 3; index++) {
      const started = performance.now();
      const routes: Record<string, string> = {};
      const web = await openBrowser(dist, routes);
      routes["https://isolation.test"] = web.origin;
      const opened = performance.now();
      const browser = web.page.browser();
      browsers.push(browser);
      const context = web.page.browserContext();
      contexts.push(context);
      try {
        await web.page.goto("https://isolation.test");
        expect(
          await web.page.evaluate(() => document.visibilityState),
          "the current scenario receives native input",
        ).toBe("visible");
        await web.page.mouse.move(100, 100);
        await web.page.mouse.wheel({ deltaY: 2000 });
        await web.page.waitForFunction(() => scrollY > 0);
        expect(await context.cookies()).toEqual([]);
        expect(await web.page.evaluate(() => localStorage.length)).toBe(0);
        expect(
          await web.page.evaluate(
            async () => (await navigator.permissions.query({ name: "geolocation" })).state,
          ),
        ).toBe("prompt");
        await context.setCookie({
          name: "scenario",
          value: "private",
          domain: "localhost",
          path: "/",
        });
        await context.overridePermissions("https://isolation.test", ["geolocation"]);
        await web.page.evaluate(() => localStorage.setItem("scenario", "private"));
        await web.newContext();
      } finally {
        const closing = performance.now();
        await web.close();
        timings.push({ openMs: opened - started, closeMs: performance.now() - closing });
      }
    }
    console.log("scenario browser lifecycle ms", JSON.stringify(timings));
    expect(
      browsers.every((browser) => browser.connected),
      "closing a scenario keeps the worker Chrome alive",
    ).toBe(true);
    expect(new Set(browsers).size, "one Chrome connection per worker").toBe(1);
    expect(contexts.every((context) => context.closed)).toBe(true);
    expect(browsers[0]!.browserContexts()).toHaveLength(1);
  } finally {
    await NodeFSP.rm(dist, { recursive: true, force: true });
  }
});
