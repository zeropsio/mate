import { describe, expect, it } from "vite-plus/test";

import type { ZeropsCall } from "../types.ts";
import { buildBrowserFields, pngSize } from "./browser.ts";

// The first 24 bytes of real PNGs: signature and IHDR, base64.
const PHONE_PNG = "iVBORw0KGgoAAAANSUhEUgAABJIAAAnkCAYAAABWQUsD";
const DESKTOP_PNG = "iVBORw0KGgoAAAANSUhEUgAABaAAAAOECAYAAABXTZbS";

function call(input: Record<string, unknown>, image?: string): ZeropsCall {
  return {
    id: "c1",
    turnId: "t1",
    toolName: "zerops_browser",
    input,
    status: "completed",
    resultText: JSON.stringify({ steps: [] }),
    truncated: false,
    startedAt: "2026-09-26T00:00:00.000Z",
    anchorActivityId: "a1",
    settledAt: "2026-09-26T00:00:03.000Z",
    rowIds: new Set(["a1"]),
    agentInternal: false,
    ...(image !== undefined ? { images: [{ mimeType: "image/png", data: image }] } : {}),
  };
}

describe("pngSize — a screenshot's size from its header", () => {
  it.each([
    {
      name: "a phone shot at three device pixels per CSS pixel",
      data: PHONE_PNG,
      size: { width: 1170, height: 2532 },
    },
    { name: "a desktop shot", data: DESKTOP_PNG, size: { width: 1440, height: 900 } },
    {
      name: "something that is not a PNG",
      data: "R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==",
      size: undefined,
    },
    { name: "too little to read", data: "iVBORw0KGgo", size: undefined },
  ])("$name", ({ data, size }) => {
    expect(pngSize(data)).toEqual(size);
  });
});

describe("buildBrowserFields — the device a check looked through", () => {
  it.each([
    {
      name: "a named phone gives its name and a phone's viewport",
      commands: [
        ["set", "device", "iPhone 14"],
        ["open", "https://app.example/status"],
      ],
      viewport: { width: 390, height: 844 },
      deviceName: "iPhone 14",
    },
    {
      name: "a named tablet gives a tablet's viewport",
      commands: [["set", "device", "iPad Air"]],
      viewport: { width: 820, height: 1180 },
      deviceName: "iPad Air",
    },
    {
      name: "a named desktop keeps the default viewport",
      commands: [["set", "device", "Desktop Chrome"]],
      viewport: undefined,
      deviceName: "Desktop Chrome",
    },
    {
      name: "an explicit resize after the device wins",
      commands: [
        ["set", "device", "iPhone 14"],
        ["set", "viewport", "1440", "900"],
      ],
      viewport: { width: 1440, height: 900 },
      deviceName: "iPhone 14",
    },
  ])("$name", ({ commands, viewport, deviceName }) => {
    const fields = buildBrowserFields(call({ commands }));
    expect(fields.viewport).toEqual(viewport);
    expect(fields.deviceName).toBe(deviceName);
  });

  it("fills in the screenshot's size from the picture when the block did not say", () => {
    const fields = buildBrowserFields(call({ commands: [] }, `${PHONE_PNG}AAAA`));
    expect(fields.screenshot).toMatchObject({ width: 1170, height: 2532 });
  });
});
