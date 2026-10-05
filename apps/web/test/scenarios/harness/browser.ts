// @effect-diagnostics nodeBuiltinImport:off -- Chrome and the static localhost server are Node test tools.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import puppeteer, { type Page } from "puppeteer-core";
import { serve } from "./http.ts";

const contentTypes: Record<string, string> = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".html": "text/html",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
};

export async function openBrowser(dist: string, routes: Record<string, string>) {
  const web = await serve(async ({ url }) => {
    const path = NodePath.resolve(dist, `.${decodeURIComponent(url.pathname)}`);
    if (!path.startsWith(`${dist}/`) && path !== dist) return { status: 403 };
    try {
      const bytes = await NodeFSP.readFile(path);
      return {
        bytes,
        headers: {
          "content-type": contentTypes[NodePath.extname(path)] ?? "application/octet-stream",
        },
      };
    } catch {
      return {
        bytes: await NodeFSP.readFile(NodePath.join(dist, "index.html")),
        headers: { "content-type": "text/html" },
      };
    }
  });
  const candidates = [
    process.env.MATE_CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].filter((path): path is string => path !== undefined);
  const available = await Promise.all(
    candidates.map(async (path) => {
      try {
        await NodeFSP.access(path);
        return path;
      } catch {
        return undefined;
      }
    }),
  );
  const executablePath = available.find((path) => path !== undefined);
  if (!executablePath)
    throw new Error("Install Chrome or set MATE_CHROME_BIN; this suite never downloads browsers.");
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: [
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
  const page = await browser.newPage();
  await page.setBypassServiceWorker(true);
  await page.setViewport({ width: 1280, height: 900 });
  const errors: string[] = [];
  const blocked: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (["warn", "error"].includes(message.type())) errors.push(message.text());
  });
  await page.setRequestInterception(true);
  page.on("request", async (request) => {
    try {
      const url = new URL(request.url());
      if (["data:", "blob:"].includes(url.protocol)) {
        await request.continue();
        return;
      }
      const target = routes[url.origin];
      if (target) {
        const local = new URL(`${url.pathname}${url.search}`, target);
        if (!["localhost", "127.0.0.1"].includes(local.hostname))
          throw new Error("Fake route is not loopback");
        const headers = { ...request.headers() };
        delete headers.host;
        delete headers["content-length"];
        const response = await fetch(local, {
          method: request.method(),
          headers,
          ...(request.hasPostData() ? { body: (await request.fetchPostData()) ?? "" } : {}),
          redirect: "manual",
        });
        await request.respond({
          status: response.status,
          headers: Object.fromEntries(response.headers),
          body: Buffer.from(await response.arrayBuffer()),
        });
      } else if (url.origin === web.origin) await request.continue();
      else {
        blocked.push(`${request.method()} ${url.origin}${url.pathname}`);
        await request.abort("blockedbyclient");
      }
    } catch (error) {
      errors.push(String(error));
      if (!request.isInterceptResolutionHandled()) await request.abort();
    }
  });
  // Only transport addresses change. The app still computes production container URLs and
  // exchanges real frames; no stores, components or app functions are accessed here.
  let routeScript: string | undefined;
  const setRoutes = async () => {
    if (routeScript) await page.removeScriptToEvaluateOnNewDocument(routeScript);
    const script = await page.evaluateOnNewDocument((mapping) => {
      const NativeWebSocket = window.WebSocket;
      class ScenarioWebSocket extends NativeWebSocket {
        static scenarioOrigins = mapping;
        constructor(address: string | URL, protocols?: string | string[]) {
          const url = new URL(String(address));
          const httpOrigin = url.origin.replace(/^ws/u, "http");
          const target = ScenarioWebSocket.scenarioOrigins[httpOrigin];
          if (!target) throw new Error(`Unmapped websocket origin: ${httpOrigin}`);
          const local = new URL(`${url.pathname}${url.search}`, target);
          local.protocol = "ws:";
          super(local, protocols);
        }
      }
      window.WebSocket = ScenarioWebSocket;
    }, routes);
    routeScript = script.identifier;
    await page.evaluate((mapping) => {
      const socket = window.WebSocket as typeof WebSocket & {
        scenarioOrigins?: Record<string, string>;
      };
      if (socket.scenarioOrigins) socket.scenarioOrigins = mapping;
    }, routes);
  };
  return {
    page,
    setRoutes,
    origin: web.origin,
    errors,
    blocked,
    close: async () => {
      await browser.close();
      await web.close();
    },
  };
}

export async function visibleText(page: Page, surface: string, text: string, timeout = 10_000) {
  await page.waitForFunction(
    (surface, text) =>
      [...document.querySelectorAll<HTMLElement>(`[data-zerops-surface="${surface}"]`)].some(
        (element) =>
          element.innerText.split("\n").some((line) => line.trim() === text) &&
          element.getBoundingClientRect().height > 0,
      ),
    { timeout, polling: "raf" },
    surface,
    text,
  );
}

export async function clickText(page: Page, surface: string, text: string) {
  await visibleText(page, surface, text);
  const handle = await page.evaluateHandle(
    (surface, text) =>
      [...document.querySelectorAll<HTMLElement>(`[data-zerops-surface="${surface}"]`)].find(
        (element) =>
          element.innerText.split("\n").some((line) => line.trim() === text) &&
          element.getBoundingClientRect().height > 0,
      ),
    surface,
    text,
  );
  const element = handle.asElement();
  if (!element) throw new Error(`Missing ${surface}: ${text}`);
  await (element as import("puppeteer-core").ElementHandle<Element>).click();
  await handle.dispose();
}
