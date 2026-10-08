// @effect-diagnostics nodeBuiltinImport:off -- deterministic browser response/renderer boundary.
import * as NodeEvents from "node:events";
import type { HTTPRequest, Page } from "puppeteer-core";
import { expect, it } from "vite-plus/test";
import { creationNetwork } from "./browserDrain.ts";

it("creation settling includes the renderer continuation of the last completed platform body", async () => {
  let bodyFinished = false;
  let continuationApplied = false;
  const events = Object.assign(new NodeEvents.EventEmitter(), {
    isClosed: () => false,
    evaluate: async () => {
      if (bodyFinished) continuationApplied = true;
    },
  });
  const network = creationNetwork(events as unknown as Page);
  events.emit("request", {
    url: () => "https://hqzone.prg1-zerops.zone/api/structure/ws",
    isNavigationRequest: () => false,
  } as HTTPRequest);
  const request = {
    url: () => "https://api.app-prg1.zerops.io/api/rest/public/project",
    isNavigationRequest: () => false,
  } as HTTPRequest;
  events.emit("request", request);
  const settled = network.settled();
  await Promise.resolve();
  bodyFinished = true;
  events.emit("requestfinished", request);
  try {
    await settled;
    expect(
      continuationApplied,
      "Creation returned before the response continuation was applied",
    ).toBe(true);
  } finally {
    network.close();
  }
  expect(events.listenerCount("request")).toBe(0);
  expect(events.listenerCount("requestfinished")).toBe(0);
  expect(events.listenerCount("requestfailed")).toBe(0);
  expect(events.listenerCount("close")).toBe(0);
});
