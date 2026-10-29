// @effect-diagnostics nodeBuiltinImport:off -- Chrome and the static localhost server are Node test tools.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import { afterAll, expect, inject, TestRunner } from "vite-plus/test";
import puppeteer, {
  type ElementHandle,
  type Page,
  type BrowserContext,
  type HTTPRequest,
  type Browser,
} from "puppeteer-core";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import { ZEROPS_SESSION_STORAGE_KEY } from "../../../../../packages/client-runtime/src/zerops/session.ts";
import { clientClock, type ScenarioWallClock } from "./clientClock.ts";
import { deadline, serve } from "./http.ts";

/** A positive send waits for the composer to acknowledge its text and offer Send or Queue. */
export async function sendConversationMessage(page: Page, message: string, waitForReady = true) {
  const input = page.locator(
    '::-p-aria([role="textbox"]):not([inert], [inert] *, [aria-hidden="true"], [aria-hidden="true"] *)',
  );
  const modifier = HostProcessPlatform.defaultValue() === "darwin" ? "Meta" : "Control";
  await (await input.waitHandle()).focus();
  await page.keyboard.down(modifier);
  await page.keyboard.press("a");
  await page.keyboard.up(modifier);
  await page.keyboard.press("Backspace");
  await page.keyboard.type(message);
  await page.waitForFunction(
    (message) => document.activeElement?.textContent === message,
    { polling: "raf" },
    message,
  );
  if (waitForReady) {
    try {
      await page.waitForFunction(
        () =>
          [...document.querySelectorAll<HTMLButtonElement>("button[type=submit]")].some(
            (button) =>
              ["Send message", "Queue message"].includes(button.getAttribute("aria-label") ?? "") &&
              !button.disabled &&
              button.getBoundingClientRect().height > 0,
          ),
        { polling: "raf" },
      );
    } catch (cause) {
      throw new Error(
        `Composer did not become ready:\n${await page.evaluate(() => document.body.innerText)}`,
        { cause },
      );
    }
  }
  await (await input.waitHandle()).focus();
  await page.keyboard.press("Enter");
}

let workerBrowser: Promise<Browser> | undefined;
afterAll(async () => {
  await (await workerBrowser)?.disconnect();
});

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
  const browser = await (workerBrowser ??= puppeteer.connect({
    browserWSEndpoint: inject("scenarioBrowserEndpoint"),
  }));
  const contexts = new Set<BrowserContext>();
  const newContext = async () => {
    const context = await browser.createBrowserContext();
    contexts.add(context);
    return context;
  };
  const scenarioContext = await newContext();
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
  /** Windows a page opened, routed like it once their routing is on. */
  const popups = new WeakMap<Page, Promise<void>>();
  const newPage = async (context: BrowserContext = scenarioContext) => {
    const page = await context.newPage();
    clocks.set(page, clientClock(page, wallClock));
    await page.setViewport({ width: 1280, height: 900 });
    await route(page);
    return page;
  };
  // Every request leaves through the scenario's routes, or is blocked and reported.
  const route = async (page: Page) => {
    // A wait ends on its predicate or at the hang guard, never at a window sized to one machine.
    page.setDefaultTimeout(0);
    // The test's stop ends a wait that never found its element; the page then says where it stood.
    const stop = TestRunner.getCurrentTest()?.context.signal;
    stop?.addEventListener(
      "abort",
      () => {
        void Promise.race([
          page.evaluate(() => `${location.href}\n${document.body.innerText}`),
          new Promise<string>((resolve) => setTimeout(resolve, 2_000, "(page did not answer)")),
        ]).then(
          (text) => {
            console.error(`Test stopped while the page showed\n${text}`);
          },
          () => {},
        );
      },
      { once: true },
    );
    await page.setBypassServiceWorker(true);
    page.on("popup", (popup) => {
      if (popup === null) return;
      const identity = identities.get(page);
      if (identity !== undefined) identities.set(popup, identity);
      popups.set(popup, route(popup));
    });
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
    // Awaiting interception work here blocks later request observers behind a held fake response.
    // Legacy interception responds explicitly; native completion remains the HTTP receipt.
    const intercept = async (request: HTTPRequest) => {
      const requestId = "id" in request && typeof request.id === "string" ? request.id : null;
      try {
        const url = new URL(request.url());
        if (["data:", "blob:"].includes(url.protocol)) {
          await request.continue();
          return;
        }
        // Faces fall back to Gravatar's for a member's e-mail (`memberPicture`): a third party no
        // scenario fakes, so it answers nothing and initials stand in, as for a failed picture.
        if (url.origin === "https://www.gravatar.com") {
          await request.respond({ status: 404, body: "" });
          return;
        }
        const target = routes[url.origin];
        if (target) {
          const local = new URL(`${url.pathname}${url.search}`, target);
          if (!["localhost", "127.0.0.1"].includes(local.hostname))
            throw new Error("Fake route is not loopback");
          const headers = { ...request.headers() };
          if (url.pathname === "/authorize-app" || url.pathname === "/authorize-login")
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
    };
    page.on("request", (request) => {
      void intercept(request).catch((error) => errors.push(String(error)));
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
    newContext,
    /**
     * The window `open` makes `page` open, once its routing is on. A window that navigates on its
     * own before then leaves unrouted: open it blank and point it later (device login does).
     */
    popup: async (page: Page, open: () => Promise<void>) => {
      let opened: (popup: Page | null) => void = () => {};
      const popup = new Promise<Page>((resolve) => {
        opened = (popup) => {
          if (popup !== null) resolve(popup);
        };
      });
      page.on("popup", opened);
      try {
        await open();
        const window = await deadline(popup, "a window the page opened");
        await popups.get(window);
        return window;
      } finally {
        page.off("popup", opened);
      }
    },
    setPerson: (page: Page, token: string) => {
      const context = page.browserContext();
      const existing = contextIdentities.get(context);
      if (existing && existing !== token)
        throw new Error("Use a new browser context to sign in as another person");
      contextIdentities.set(context, token);
      identities.set(page, token);
    },
    // Seed only this navigation: reload and sign-out must use the product's persisted state.
    gotoWithSession: async (page: Page, token: string) => {
      const script = await page.evaluateOnNewDocument(
        (origin, key, accessToken) => {
          if (location.origin === origin && localStorage.getItem(key) === null)
            localStorage.setItem(key, JSON.stringify({ accessToken }));
        },
        web.origin,
        ZEROPS_SESSION_STORAGE_KEY,
        token,
      );
      try {
        await page.goto(`${web.origin}/zerops`);
      } finally {
        await page.removeScriptToEvaluateOnNewDocument(script.identifier);
      }
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
      await Promise.all(
        [...contexts].filter((context) => !context.closed).map((context) => context.close()),
      );
      await web.close();
    },
  };
}

/** Some `surface` in the page draws `text` as one of its lines, or one name of a line. */
/**
 * Whether `surface` draws `text`: shown, or — where `folds` — not drawn while a menu group stands
 * folded, so it may stand inside that group.
 */
function whereText(surface: string, text: string, folds: boolean): "shown" | "folded" | null {
  const shown = [
    ...document.querySelectorAll<HTMLElement>(`[data-zerops-surface="${surface}"]`),
  ].some(
    (element) =>
      // A Mate alone in its project reads "Project · Mate": either name stands on its own.
      element.innerText
        .split("\n")
        .some(
          (line) =>
            line.split(/\s·\s/).some((part) => part.trim() === text) || line.trim() === text,
        ) && element.getBoundingClientRect().height > 0,
  );
  if (shown) return "shown";
  return folds &&
    document.querySelector('[data-zerops-surface="sidebar-project"][aria-expanded="false"]') !==
      null
    ? "folded"
    : null;
}

/** Whether `surface` draws `text` now, with no wait: for a look between clock advances. */
export async function showsText(page: Page, surface: string, text: string) {
  return (await page.evaluate(whereText, surface, text, false)) === "shown";
}

export async function visibleText(page: Page, surface: string, text: string) {
  await page.waitForFunction(whereText, { polling: "raf" }, surface, text, false);
}

/** Where Mate `name` stands in the menu against project `app`: drawn there, folded in it, or not yet. */
function whereInApp(name: string, app: string): "shown" | "folded" | null {
  const shown = (node: Element) => node.getBoundingClientRect().height > 0;
  const named = (row: Element) =>
    row
      .querySelector('[data-zerops-surface="sidebar-mate-name"]')
      ?.textContent?.replaceAll("\u00a0", " ")
      .trim();
  const rows = (within: ParentNode) =>
    [...within.querySelectorAll('[data-zerops-surface="sidebar-mate"]')].filter(shown);
  // A project of one Mate is that Mate's row: "Shop · Ada".
  if (rows(document).some((row) => named(row) === `${app} · ${name}`)) return "shown";
  if (app === "Ungrouped") {
    const ungrouped = document.querySelector("section[data-zerops-ungrouped]");
    return ungrouped !== null && rows(ungrouped).some((row) => named(row) === name)
      ? "shown"
      : null;
  }
  for (const section of document.querySelectorAll("section[data-zerops-group]")) {
    const group = section.querySelector(
      '[data-zerops-surface="sidebar-project-row"] [data-zerops-surface="sidebar-project"]',
    );
    const title = group
      ?.querySelector('[data-zerops-surface="sidebar-project-name"]')
      ?.firstChild?.textContent?.trim();
    if (group === null || group === undefined || title !== app) continue;
    if (group.getAttribute("aria-expanded") === "false") return "folded";
    if (rows(section).some((row) => named(row) === name)) return "shown";
  }
  return null;
}

/** The menu's row of group `app`, its project of several Mates. */
function groupRow(page: Page, app: string) {
  return page.waitForFunction(
    (app) =>
      [
        ...document.querySelectorAll<HTMLElement>(
          '[data-zerops-surface="sidebar-project-row"] [data-zerops-surface="sidebar-project"]',
        ),
      ].find(
        (group) =>
          group.getBoundingClientRect().height > 0 &&
          group
            .querySelector('[data-zerops-surface="sidebar-project-name"]')
            ?.firstChild?.textContent?.trim() === app,
      ) ?? null,
    { polling: "raf" },
    app,
  );
}

/**
 * Opens or folds group `app` from the keyboard — → opens it, ← folds it, and neither opens a
 * Mate — then waits for it to stand so.
 */
export async function foldMenuGroup(page: Page, app: string, fold: boolean) {
  const group = (await groupRow(page, app)).asElement() as ElementHandle<HTMLElement>;
  // Press only when it stands the other way: open while folding, folded while opening.
  if ((await group.evaluate((node) => node.getAttribute("aria-expanded"))) === String(fold)) {
    await group.focus();
    await page.keyboard.press(fold ? "ArrowLeft" : "ArrowRight");
  }
  await page.waitForFunction(
    (node, open) => node.getAttribute("aria-expanded") === open,
    { polling: "raf" },
    group,
    String(!fold),
  );
}

/** Whether group `app` stands open in the menu. */

/**
 * Mate `name` stands in project `app` in the menu: as its row ("Shop · Ada"), under its group's
 * row — the group opened as a person would, where it is folded — or among the ungrouped.
 */
export async function menuMateIn(page: Page, name: string, app: string) {
  for (;;) {
    const where = await page.waitForFunction(whereInApp, { polling: "raf" }, name, app);
    const found = await where.jsonValue();
    await where.dispose();
    if (found === "shown") return;
    await foldMenuGroup(page, app, false);
  }
}

/**
 * The menu's row of Mate `name`, drawn and still: its name alone (a Mate in no project, or under its open
 * group), or its project's then its own ("Shop · Ada", a project of one Mate). A Mate in a folded
 * group is drawn once a person opens its group: where it is not drawn while a group stands folded,
 * every group is opened once.
 */
export async function menuMateRow(page: Page, name: string) {
  const words = `normalize-space(translate(., "\u00a0", " "))`;
  const suffix = xpathLiteral(` · ${name}`);
  const named = `${words}=${xpathLiteral(name)} or substring(${words}, string-length(${words}) - string-length(${suffix}) + 1)=${suffix}`;
  const path = `//*[@data-zerops-surface="sidebar-mate"][.//*[@data-zerops-surface="sidebar-mate-name"][${named}]]`;
  const row = page.locator(`::-p-xpath(${path})`).filter(
    (row) =>
      row.getBoundingClientRect().height > 0 &&
      // Still: a group unfolding moves and clips its rows, so a press measured meanwhile lands
      // beside the row.
      !document
        .getAnimations()
        .some(
          (animation) =>
            animation.playState === "running" &&
            animation.effect instanceof KeyframeEffect &&
            animation.effect.target?.contains(row) === true,
        ),
  );
  const where = await page.waitForFunction(
    (path) => {
      const rows = document.evaluate(path, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE);
      for (let index = 0; index < rows.snapshotLength; index++)
        if ((rows.snapshotItem(index) as Element).getBoundingClientRect().height > 0)
          return "shown";
      return document.querySelector(
        '[data-zerops-surface="sidebar-project"][aria-expanded="false"]',
      ) === null
        ? null
        : "folded";
    },
    { polling: "raf" },
    path,
  );
  const found = await where.jsonValue();
  await where.dispose();
  if (found === "folded") await openFoldedGroups(page);
  await row.wait();
  // Keep the query, not a node that an arriving HQ snapshot can replace before the click.
  return row;
}

/** Every folded group in the menu opened as a person opens one from the keyboard: → on its row. */
async function openFoldedGroups(page: Page) {
  await page.evaluate(() => {
    for (const row of document.querySelectorAll<HTMLElement>(
      '[data-zerops-surface="sidebar-project"][aria-expanded="false"]',
    )) {
      row.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    }
  });
}

/**
 * Mate `name` drawn in the menu's `surface`: a Mate in a folded group is drawn once a person
 * opens its group, so where it is not drawn while a group stands folded every group is opened
 * once. The menu draws a snapshot's groups and rows in one frame, so a row in an open group or
 * among the ungrouped reads as shown before any folded group is opened for it.
 */
export async function visibleInMenu(page: Page, surface: string, name: string) {
  const where = await page.waitForFunction(whereText, { polling: "raf" }, surface, name, true);
  const found = await where.jsonValue();
  await where.dispose();
  if (found === "shown") return;
  await openFoldedGroups(page);
  await visibleText(page, surface, name);
}

/**
 * Opens the menu's account control: the one on top, as the closed menu's rail keeps its own
 * under the open menu, where a click lands on the menu instead.
 */
export async function openAccountMenu(page: Page) {
  // Its centre, clicked there: the control may draw anew between finding and clicking it.
  const centre = await page.waitForFunction(() => {
    for (const button of document.querySelectorAll<HTMLElement>(
      '[data-zerops-surface="sidebar-account"]',
    )) {
      const box = button.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      const top = document.elementFromPoint(x, y);
      if (top !== null && button.contains(top)) return { x, y };
    }
    return null;
  });
  const { x, y } = (await centre.jsonValue()) as { readonly x: number; readonly y: number };
  await page.mouse.click(x, y);
}

export function xpathLiteral(value: string) {
  const parts = value.split('"').map((part) => `"${part}"`);
  return parts.length === 1 ? parts[0] : `concat(${parts.join(`, '"', `)})`;
}

export async function clickText(page: Page, surface: string, text: string) {
  const literal = xpathLiteral(text);
  await page
    .locator(
      `::-p-xpath(//*[@data-zerops-surface="${surface}"][.//text()[normalize-space(.)=${literal}]])`,
    )
    .click();
}

/** Resize the menu through its drag rail, then wait for the exact drawn width. */
export async function resizeMenu(page: Page, width: number) {
  const rail = await page.waitForSelector('[data-sidebar="rail"]', {
    visible: true,
  });
  const box = await rail!.boundingBox();
  if (box === null) throw new Error("The menu drag rail has no geometry");
  const current = await page.$eval(
    '[data-sidebar="sidebar"]',
    (element) => element.getBoundingClientRect().width,
  );
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + width - current, box.y + box.height / 2, {
    steps: 5,
  });
  await page.mouse.up();
  await page.waitForFunction(
    (expected) =>
      document.querySelector('[data-sidebar="sidebar"]')?.getBoundingClientRect().width ===
      expected,
    { polling: "raf" },
    width,
  );
}
