// @effect-diagnostics nodeBuiltinImport:off -- deterministic browser event-boundary driver.
import * as NodeEvents from "node:events";
import type { HTTPRequest, Page } from "puppeteer-core";
import { expect, it } from "vite-plus/test";
import { completedHttp } from "../harness/completedHttp.ts";

it.each(["requestfinished", "requestfailed"])(
  "HTTP settling ignores response headers and waits for %s plus renderer continuations",
  async (terminal) => {
    let rendererTurns = 0;
    const events = Object.assign(new NodeEvents.EventEmitter(), {
      isClosed: () => false,
      evaluate: async () => {
        rendererTurns++;
      },
      // Puppeteer's header-idle condition is already satisfied; using it would overtake the body.
      waitForNetworkIdle: async () => {},
    });
    const settle = completedHttp(events as unknown as Page);
    const request = { isNavigationRequest: () => false } as HTTPRequest;
    events.emit("request", request);
    const drained = settle();
    events.emit("response", { request: () => request });
    await Promise.resolve();
    expect(rendererTurns, "Response headers must not release the renderer/next timer").toBe(0);
    events.emit(terminal, request);
    await drained;
    expect(rendererTurns).toBe(1);
    events.emit("close");
    expect(events.listenerCount("request")).toBe(0);
    expect(events.listenerCount("requestfinished")).toBe(0);
  },
);

function navigationBrowser() {
  let rendererTurns = 0;
  const client = new NodeEvents.EventEmitter();
  const mainFrame = {};
  const events = Object.assign(new NodeEvents.EventEmitter(), {
    isClosed: () => false,
    mainFrame: () => mainFrame,
    evaluate: async () => {
      rendererTurns++;
    },
  });
  const body = { isNavigationRequest: () => false } as HTTPRequest;
  const navigation = {
    client,
    isNavigationRequest: () => true,
    frame: () => mainFrame,
  } as unknown as HTTPRequest;
  return { events, client, body, navigation, rendererTurns: () => rendererTurns };
}

it.each(["requestfinished", "requestfailed"])(
  "navigation %s before document commit cannot retire an unfinished old body",
  async (terminal) => {
    const browser = navigationBrowser();
    const settle = completedHttp(browser.events as unknown as Page);
    browser.events.emit("request", browser.body);
    const drained = settle();
    browser.events.emit("request", browser.navigation);
    browser.events.emit(terminal, browser.navigation);
    await Promise.resolve();
    try {
      expect(
        browser.rendererTurns(),
        "Rendering must wait for document replacement or the old body",
      ).toBe(0);
    } finally {
      browser.events.emit("requestfinished", browser.body);
      browser.client.emit("Page.frameNavigated", { frame: { id: "main" } });
      await drained;
      settle.close();
    }
  },
);

it("a committed main document retires old bodies but waits for its own body even when the filter excludes navigation", async () => {
  const browser = navigationBrowser();
  const settle = completedHttp(
    browser.events as unknown as Page,
    (request) => request === browser.body,
  );
  browser.events.emit("request", browser.body);
  browser.events.emit("request", browser.navigation);
  const drained = settle();
  browser.client.emit("Page.frameNavigated", { frame: { parentId: "main" } });
  browser.client.emit("Page.navigatedWithinDocument", { frameId: "main" });
  await Promise.resolve();
  try {
    expect(
      browser.rendererTurns(),
      "Subframes and same-document navigation cannot retire old bodies",
    ).toBe(0);
    browser.client.emit("Page.frameNavigated", { frame: { id: "main" } });
    await Promise.resolve();
    expect(browser.rendererTurns(), "The new document body must finish before rendering").toBe(0);
    browser.events.emit("requestfinished", browser.navigation);
    await drained;
    expect(browser.rendererTurns()).toBe(1);
  } finally {
    browser.events.emit("requestfinished", browser.body);
    browser.events.emit("requestfinished", browser.navigation);
    browser.client.emit("Page.frameNavigated", { frame: { id: "main" } });
    await drained;
    settle.close();
  }
  expect(browser.client.listenerCount("Page.frameNavigated")).toBe(0);
});

it("a navigation body finishing before document commit does not enter the old renderer", async () => {
  const browser = navigationBrowser();
  const settle = completedHttp(browser.events as unknown as Page);
  browser.events.emit("request", browser.navigation);
  const drained = settle();
  browser.events.emit("requestfinished", browser.navigation);
  await Promise.resolve();
  try {
    expect(browser.rendererTurns(), "The body finishing is not a document commit receipt").toBe(0);
  } finally {
    browser.client.emit("Page.frameNavigated", { frame: { id: "main" } });
    await drained;
    settle.close();
  }
  expect(browser.rendererTurns()).toBe(1);
});
