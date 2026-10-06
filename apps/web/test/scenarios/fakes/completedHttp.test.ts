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
    const request = { url: () => "https://stream.example.test/body" } as HTTPRequest;
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
