// @effect-diagnostics nodeBuiltinImport:off globalConsole:off -- owns the serial scenario worker's Chrome process.
import puppeteer from "puppeteer-core";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import { resolveTestBrowser } from "../../testBrowser.ts";
import type { TestProject } from "vite-plus/test/node";

declare module "vite-plus/test" {
  interface ProvidedContext {
    scenarioBrowserEndpoint: string;
  }
}

// Each scenario project has one serial worker. Global setup keeps Chrome alive across file
// isolation; each file disconnects its CDP client and every scenario closes its own contexts.
export default async function setup(project: TestProject) {
  const executablePath = await resolveTestBrowser(process.env.MATE_CHROME_BIN);
  const started = performance.now();
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    // Preserve Chrome's startup cause if it exits before CDP attaches.
    dumpio: process.env.GITHUB_ACTIONS === "true",
    // The serial worker connects over loopback; scenarios only create isolated routed pages.
    pipe: false,
    waitForInitialPage: false,
    args: [
      // Ubuntu runners restrict user namespaces for downloaded Chrome for Testing. This
      // disposable browser can only reach loopback fakes; personal browsers keep their sandbox.
      ...(HostProcessPlatform.defaultValue() === "linux" && process.env.GITHUB_ACTIONS === "true"
        ? ["--no-sandbox"]
        : []),
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-domain-reliability",
      "--disable-sync",
      "--no-first-run",
      "--no-default-browser-check",
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost",
      "--disable-features=MediaRouter,OptimizationHints,AutofillServerCommunication",
    ],
  });
  console.log(`scenario Chrome: launch ${(performance.now() - started).toFixed(2)}ms`);
  project.provide("scenarioBrowserEndpoint", browser.wsEndpoint());
  return async () => {
    const closing = performance.now();
    await browser.close();
    console.log(`scenario Chrome: close ${(performance.now() - closing).toFixed(2)}ms`);
  };
}
