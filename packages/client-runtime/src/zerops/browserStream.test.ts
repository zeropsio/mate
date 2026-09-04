import { describe, expect, it } from "vite-plus/test";
import type { ZeropsBrowserFrame, ZeropsBrowserStreamEvent } from "@t3tools/contracts";

import {
  foldBrowserStreamEvent,
  frameImageSrc,
  INITIAL_BROWSER_STREAM_STATE,
  mapCanvasPointToDevicePixels,
  type ZeropsBrowserStreamState,
} from "./browserStream.ts";

const frame = (overrides: Partial<ZeropsBrowserFrame> = {}): ZeropsBrowserFrame => ({
  type: "frame",
  data: "AAAA",
  width: 640,
  height: 360,
  ...overrides,
});

describe("frameImageSrc", () => {
  it("wraps the base64 data as a JPEG data URI, verbatim", () => {
    expect(frameImageSrc(frame({ data: "Zm9v" }))).toBe("data:image/jpeg;base64,Zm9v");
  });
});

describe("mapCanvasPointToDevicePixels", () => {
  it("maps a canvas click to device pixels with the frame's scale and scroll", () => {
    // Canvas displayed at half the frame's device size (e.g. a HiDPI
    // display), and the page scrolled 100/50 px.
    const point = mapCanvasPointToDevicePixels(
      { canvasWidth: 320, canvasHeight: 180, x: 100, y: 50 },
      frame({ width: 640, height: 360, scrollX: 100, scrollY: 50 }),
    );
    // scale = 640/320 = 2, 360/180 = 2 → (100*2 + 100, 50*2 + 50)
    expect(point).toEqual({ x: 300, y: 150 });
  });

  it("is the identity mapping when the canvas is drawn at the frame's own device size with no scroll", () => {
    const point = mapCanvasPointToDevicePixels(
      { canvasWidth: 640, canvasHeight: 360, x: 12, y: 34 },
      frame({ width: 640, height: 360 }),
    );
    expect(point).toEqual({ x: 12, y: 34 });
  });

  it("applies independent x/y scale factors", () => {
    const point = mapCanvasPointToDevicePixels(
      { canvasWidth: 100, canvasHeight: 50, x: 10, y: 10 },
      frame({ width: 400, height: 100 }),
    );
    expect(point).toEqual({ x: 40, y: 20 });
  });

  it("falls back to scale 1 when the canvas has not been laid out yet (zero dimension)", () => {
    const point = mapCanvasPointToDevicePixels(
      { canvasWidth: 0, canvasHeight: 0, x: 5, y: 5 },
      frame({ width: 640, height: 360 }),
    );
    expect(point).toEqual({ x: 5, y: 5 });
  });
});

describe("foldBrowserStreamEvent", () => {
  const stateEvent = (
    status: "no-browser" | "connecting" | "live",
    url?: string,
  ): ZeropsBrowserStreamEvent =>
    ({ type: "state", status, ...(url !== undefined ? { url } : {}) }) as ZeropsBrowserStreamEvent;

  it("starts as no-browser", () => {
    expect(INITIAL_BROWSER_STREAM_STATE).toEqual({ status: "no-browser" });
  });

  it("a state event replaces the status and clears the frame outside live", () => {
    const withFrame: ZeropsBrowserStreamState = {
      status: "live",
      frame: frame(),
    };
    expect(foldBrowserStreamEvent(withFrame, stateEvent("connecting"))).toEqual({
      status: "connecting",
    });
  });

  it("a frame event updates the frame without touching status or url", () => {
    const state: ZeropsBrowserStreamState = { status: "live", url: "https://example.com/" };
    const next = foldBrowserStreamEvent(state, frame({ data: "ZmFrZQ==" }));
    expect(next).toEqual({
      status: "live",
      url: "https://example.com/",
      frame: frame({ data: "ZmFrZQ==" }),
    });
  });

  it("keeps the last known url across a state event that carries none", () => {
    const state: ZeropsBrowserStreamState = { status: "live", url: "https://example.com/" };
    const next = foldBrowserStreamEvent(state, stateEvent("connecting"));
    expect(next).toEqual({ status: "connecting", url: "https://example.com/" });
  });

  it("a live state event keeps the current frame", () => {
    const state: ZeropsBrowserStreamState = { status: "live", frame: frame() };
    const next = foldBrowserStreamEvent(state, stateEvent("live", "https://example.com/"));
    expect(next).toEqual({ status: "live", url: "https://example.com/", frame: frame() });
  });
});
