// @effect-diagnostics nodeBuiltinImport:off -- Chrome and the static localhost server are Node test tools.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import { afterAll, expect } from "vite-plus/test";
import puppeteer, { type Page, type BrowserContext } from "puppeteer-core";
import { clientClock, type ScenarioWallClock } from "./clientClock.ts";
import { serve } from "./http.ts";

// Vitest inverts afterEach failures inside it.fails too. Retain diagnostics from every opened
// browser until the file-level hook, which cannot become an expected domain failure.
// Filtered/skipped tests never open a browser and therefore contribute no diagnostics.
const healthChecks: { pageErrors: string[]; blocked: string[] }[] = [];
afterAll(() => {
  const checks = healthChecks.splice(0);
  expect(
    checks.flatMap((check) => check.pageErrors),
    "Uncaught browser errors",
  ).toEqual([]);
  expect(
    checks.flatMap((check) => check.blocked),
    "Unmapped browser network",
  ).toEqual([]);
});

const contentTypes: Record<string, string> = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".html": "text/html",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
};

export async function openBrowser(
  dist: string,
  routes: Record<string, string>,
  wallClock?: ScenarioWallClock,
) {
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
    // Use the owned child's pipe and create only the routed page the driver needs.
    pipe: true,
    waitForInitialPage: false,
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
  const errors: string[] = [];
  const pageErrors: string[] = [];
  const blocked: string[] = [];
  healthChecks.push({ pageErrors, blocked });
  const identities = new WeakMap<Page, string>();
  let notifyViolation = () => {};
  const networkViolation = new Promise<void>((resolve) => {
    notifyViolation = resolve;
  });
  const recordBlocked = (address: string) => {
    blocked.push(address);
    notifyViolation();
  };
  const contextIdentities = new WeakMap<BrowserContext, string>();
  const clocks = new WeakMap<Page, ReturnType<typeof clientClock>>();
  const routeSetters = new Map<Page, () => Promise<void>>();
  const newPage = async (context: BrowserContext = browser.defaultBrowserContext()) => {
    const page = await context.newPage();
    clocks.set(page, clientClock(page, wallClock));
    await page.setBypassServiceWorker(true);
    await page.setViewport({ width: 1280, height: 900 });
    page.on("pageerror", (error) => {
      errors.push(String(error));
      pageErrors.push(String(error));
    });
    await page.exposeFunction("scenarioBlockedSocket", (address: string) =>
      recordBlocked(`WS ${address}`),
    );
    page.on("console", (message) => {
      if (["warn", "error"].includes(message.type())) errors.push(message.text());
    });
    // CDP's byte entries preserve file uploads; fetchPostData decodes them as text.
    const network = await page.createCDPSession();
    const postBodies = new Map<string, ArrayBuffer>();
    const opaqueBodies = new Set<string>();
    network.on("Network.requestWillBeSent", ({ requestId, request }) => {
      if (request.hasPostData && !request.postDataEntries && request.postData === undefined)
        opaqueBodies.add(requestId);
      if (request.postDataEntries?.every((entry) => entry.bytes !== undefined))
        postBodies.set(
          requestId,
          Uint8Array.from(
            Buffer.concat(
              request.postDataEntries.map((entry) => Buffer.from(entry.bytes!, "base64")),
            ),
          ).buffer,
        );
    });
    await network.send("Network.enable");
    await page.setRequestInterception(true);
    page.on("request", async (request) => {
      const requestId = "id" in request && typeof request.id === "string" ? request.id : null;
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
          if (url.pathname === "/authorize-app")
            headers["x-scenario-person"] = identities.get(page) ?? "personal";
          delete headers.host;
          delete headers["content-length"];
          // File/Blob bytes are opaque to CDP. Let Chrome forward them intact.
          if (requestId !== null && opaqueBodies.has(requestId)) {
            await request.continue({ url: local.href, headers });
            return;
          }
          const response = await fetch(local, {
            method: request.method(),
            headers,
            ...(request.hasPostData()
              ? {
                  body:
                    (requestId === null ? undefined : postBodies.get(requestId)) ??
                    (await request.fetchPostData()) ??
                    "",
                }
              : {}),
            redirect: "manual",
          });
          await request.respond({
            status: response.status,
            headers: Object.fromEntries(response.headers),
            body: Buffer.from(await response.arrayBuffer()),
          });
        } else if (url.origin === web.origin) await request.continue();
        else {
          recordBlocked(`${request.method()} ${url.origin}${url.pathname}`);
          await request.abort("blockedbyclient");
        }
      } catch (error) {
        errors.push(String(error));
        if (!request.isInterceptResolutionHandled()) await request.abort();
      } finally {
        if (requestId !== null) {
          postBodies.delete(requestId);
          opaqueBodies.delete(requestId);
        }
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
            if (!target) {
              void (
                window as unknown as { scenarioBlockedSocket(address: string): Promise<void> }
              ).scenarioBlockedSocket(httpOrigin);
              throw new Error(`Unmapped websocket origin: ${httpOrigin}`);
            }
            if (!["localhost", "127.0.0.1"].includes(new URL(target).hostname))
              throw new Error("Fake websocket route is not loopback");
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
    routeSetters.set(page, setRoutes);
    page.once("close", () => routeSetters.delete(page));
    await setRoutes();
    return page;
  };
  const page = await newPage();
  return {
    page,
    newPage,
    clock: (page: Page) => {
      const clock = clocks.get(page);
      if (!clock) throw new Error("Page belongs to a different scenario");
      return clock;
    },
    newContext: () => browser.createBrowserContext(),
    setPerson: (page: Page, token: string) => {
      const context = page.browserContext();
      const existing = contextIdentities.get(context);
      if (existing && existing !== token)
        throw new Error("Use a new browser context to sign in as another person");
      contextIdentities.set(context, token);
      identities.set(page, token);
    },
    setRoutes: async () => {
      for (const update of routeSetters.values()) await update();
    },
    origin: web.origin,
    errors,
    pageErrors,
    blocked,
    networkViolation,
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
  const until = Date.now() + 10_000;
  for (;;) {
    await visibleText(page, surface, text, Math.max(1, until - Date.now()));
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
    try {
      const element = handle.asElement();
      if (element) {
        await (element as import("puppeteer-core").ElementHandle<Element>).click();
        return;
      }
    } catch (error) {
      // A row can be replaced after it becomes visible but before Chrome checks clickability.
      // Reacquire through the same visible-text condition; every other click error is a failure.
      if (!/Node is detached|Node is either not clickable or not an Element/u.test(String(error)))
        throw error;
      if (Date.now() >= until) throw error;
    } finally {
      await handle.dispose();
    }
    if (Date.now() >= until) throw new Error(`Missing clickable ${surface}: ${text}`);
  }
}
