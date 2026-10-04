import { describe, expect, it } from "vite-plus/test";
import type { ZeropsBrowserFrame, ZeropsBrowserStreamEvent } from "@t3tools/contracts";

import type { FailureReason, Known } from "./knowledge/index.ts";

import {
  foldBrowserStreamEvent,
  frameImageSrc,
  INITIAL_BROWSER_STREAM_STATE,
  mapCanvasPointToDevicePixels,
  resolveBrowserDrivingState,
  type RecentToolEntry,
  type ZeropsBrowserStreamState,
} from "./browserStream.ts";

/** The lifecycle feed's answer, as the panel reads it. */
type LifecycleRead = Known<{ readonly recentTools: ReadonlyArray<RecentToolEntry> }>;

const knownTools = (
  recentTools: ReadonlyArray<RecentToolEntry>,
  freshness: Extract<LifecycleRead, { state: "known" }>["freshness"] = { kind: "live" },
): LifecycleRead => ({
  state: "known",
  value: { recentTools },
  asOf: { ordinal: 1, atMs: 0 },
  coverage: "complete",
  freshness,
});

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
  it("maps a canvas click to viewport CSS pixels with the frame's scale and zoom", () => {
    // Canvas displayed at half the frame's captured-image size (e.g. a
    // HiDPI display), and the page pinch-zoomed to 2x.
    const point = mapCanvasPointToDevicePixels(
      { canvasWidth: 320, canvasHeight: 180, x: 100, y: 50 },
      frame({ width: 640, height: 360, pageScaleFactor: 2 }),
    );
    // scale = 640/320 = 2, 360/180 = 2 → (100*2, 50*2) / 2 (the zoom)
    expect(point).toEqual({ x: 100, y: 50 });
  });

  it("never adds the frame's scroll offset to a click's coordinates (CDP dispatch is already viewport-relative)", () => {
    const point = mapCanvasPointToDevicePixels(
      { canvasWidth: 640, canvasHeight: 360, x: 100, y: 50 },
      frame({ width: 640, height: 360, scrollX: 500, scrollY: 900 }),
    );
    expect(point).toEqual({ x: 100, y: 50 });
  });

  it("divides by the page's zoom level (pageScaleFactor) at identity canvas scale", () => {
    const point = mapCanvasPointToDevicePixels(
      { canvasWidth: 640, canvasHeight: 360, x: 100, y: 50 },
      frame({ width: 640, height: 360, pageScaleFactor: 4 }),
    );
    expect(point).toEqual({ x: 25, y: 12.5 });
  });

  it("defaults pageScaleFactor to 1 when the frame does not report one", () => {
    const point = mapCanvasPointToDevicePixels(
      { canvasWidth: 640, canvasHeight: 360, x: 100, y: 50 },
      frame({ width: 640, height: 360 }),
    );
    expect(point).toEqual({ x: 100, y: 50 });
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
    title?: string,
  ): ZeropsBrowserStreamEvent =>
    ({
      type: "state",
      status,
      ...(url !== undefined ? { url } : {}),
      ...(title !== undefined ? { title } : {}),
    }) as ZeropsBrowserStreamEvent;

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

  it("carries the active tab's title alongside its url", () => {
    const next = foldBrowserStreamEvent(
      INITIAL_BROWSER_STREAM_STATE,
      stateEvent("live", "https://example.com/", "Example"),
    );
    expect(next).toEqual({ status: "live", url: "https://example.com/", title: "Example" });
  });

  it("keeps the last known title across a state event that carries none", () => {
    const state: ZeropsBrowserStreamState = {
      status: "live",
      url: "https://example.com/",
      title: "Example",
    };
    const next = foldBrowserStreamEvent(state, stateEvent("connecting"));
    expect(next).toEqual({
      status: "connecting",
      url: "https://example.com/",
      title: "Example",
    });
  });

  it("a live state event keeps the current frame", () => {
    const state: ZeropsBrowserStreamState = { status: "live", frame: frame() };
    const next = foldBrowserStreamEvent(state, stateEvent("live", "https://example.com/"));
    expect(next).toEqual({ status: "live", url: "https://example.com/", frame: frame() });
  });
});

describe("resolveBrowserDrivingState", () => {
  const NOW = Date.parse("2026-09-04T12:00:00.000Z");

  it("panel disables input while the agent drives and enables it on take-over", () => {
    const driving = resolveBrowserDrivingState({
      lifecycle: knownTools([{ toolName: "zerops_browser", status: "inProgress" }]),
      takeOver: false,
      lastUserInputAtMs: undefined,
      nowMs: NOW,
    });
    expect(driving.agentDriving).toBe(true);
    expect(driving.inputDisabled).toBe(true);

    const tookOver = resolveBrowserDrivingState({
      lifecycle: knownTools([{ toolName: "zerops_browser", status: "inProgress" }]),
      takeOver: true,
      lastUserInputAtMs: undefined,
      nowMs: NOW,
    });
    expect(tookOver.agentDriving).toBe(true);
    expect(tookOver.inputDisabled).toBe(false);
  });

  it("input stays enabled when the agent's browser call already completed", () => {
    const driving = resolveBrowserDrivingState({
      lifecycle: knownTools([{ toolName: "zerops_browser", status: "completed" }]),
      takeOver: false,
      lastUserInputAtMs: undefined,
      nowMs: NOW,
    });
    expect(driving.agentDriving).toBe(false);
    expect(driving.inputDisabled).toBe(false);
  });

  it("input stays enabled when the agent's most recent call is a different tool", () => {
    const driving = resolveBrowserDrivingState({
      lifecycle: knownTools([
        { toolName: "zerops_browser", status: "inProgress" },
        { toolName: "zerops_deploy", status: "inProgress" },
      ]),
      takeOver: false,
      lastUserInputAtMs: undefined,
      nowMs: NOW,
    });
    expect(driving.agentDriving).toBe(false);
    expect(driving.inputDisabled).toBe(false);
  });

  it("reports the viewer as driving within the window after their last input", () => {
    const driving = resolveBrowserDrivingState({
      lifecycle: knownTools([]),
      takeOver: false,
      lastUserInputAtMs: NOW - 500,
      nowMs: NOW,
    });
    expect(driving.userDriving).toBe(true);
  });

  it("the viewer stops driving once the window elapses", () => {
    const driving = resolveBrowserDrivingState({
      lifecycle: knownTools([]),
      takeOver: false,
      lastUserInputAtMs: NOW - 2001,
      nowMs: NOW,
    });
    expect(driving.userDriving).toBe(false);
  });

  it("no recent tools at all: nobody is driving, input stays enabled", () => {
    const driving = resolveBrowserDrivingState({
      lifecycle: knownTools([]),
      takeOver: false,
      lastUserInputAtMs: undefined,
      nowMs: NOW,
    });
    expect(driving).toEqual({
      agentDriving: false,
      userDriving: false,
      inputDisabled: false,
      agentUnknown: null,
    });
  });

  it("an unread lifecycle is not one where nobody drives: the agent is unknown, the line checks", () => {
    const driving = resolveBrowserDrivingState({
      lifecycle: { state: "unread", waitingFor: null },
      takeOver: false,
      lastUserInputAtMs: undefined,
      nowMs: NOW,
    });
    expect(driving).toEqual({
      agentDriving: null,
      userDriving: false,
      inputDisabled: false,
      agentUnknown: { text: "Checking whether the agent is driving…", afterMs: 400, tone: "quiet" },
    });
  });

  it("a failed lifecycle read names its cause, an old Mate's included", () => {
    const failed = (failure: FailureReason) =>
      resolveBrowserDrivingState({
        lifecycle: { state: "failed", failure, atMs: 0, attempt: 1, retryAtMs: null },
        takeOver: false,
        lastUserInputAtMs: undefined,
        nowMs: NOW,
      });
    expect(failed({ kind: "transport", detail: "closed" }).agentUnknown?.text).toBe(
      "Couldn't read what the agent is doing. This Mate didn't answer.",
    );
    expect(
      failed({ kind: "unsupported", capability: "subscribeZeropsLifecycle" }).agentUnknown?.text,
    ).toBe("This Mate is too old for this. Updating it adds it.");
  });

  it("a stale lifecycle keeps its value: the agent still drives", () => {
    const driving = resolveBrowserDrivingState({
      lifecycle: knownTools([{ toolName: "zerops_browser", status: "inProgress" }], {
        kind: "stale",
        reason: { kind: "source-recovering", retryAtMs: null },
        sinceMs: 0,
      }),
      takeOver: false,
      lastUserInputAtMs: undefined,
      nowMs: NOW,
    });
    expect(driving.agentDriving).toBe(true);
    expect(driving.inputDisabled).toBe(true);
  });

  it("no thread to read: nobody is driving and nothing is checked", () => {
    const driving = resolveBrowserDrivingState({
      lifecycle: undefined,
      takeOver: false,
      lastUserInputAtMs: undefined,
      nowMs: NOW,
    });
    expect(driving.agentDriving).toBe(false);
    expect(driving.agentUnknown).toBeNull();
  });
});
