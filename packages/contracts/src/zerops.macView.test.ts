import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";
import { ZeropsMacInput, ZeropsMacStreamEvent } from "./zerops.ts";

const decodeEvent = Schema.decodeUnknownSync(ZeropsMacStreamEvent);
const decodeInput = Schema.decodeUnknownSync(ZeropsMacInput);

describe("the Mac live view contract", () => {
  it("carries a window frame with its image size and place on the Mac's screen", () => {
    const frame = {
      type: "frame",
      mimeType: "image/jpeg",
      data: "A",
      width: 460,
      height: 816,
      bounds: { x: 100, y: 50, width: 230, height: 408 },
    };
    expect(decodeEvent(frame)).toEqual(frame);
  });

  it.each(["not-paired", "unreachable", "no-app", "no-helper", "connecting", "live"])(
    "says the view is %s, with the Mac's name and app once known and whether someone uses it",
    (status) => {
      const state = { type: "state", status, macName: "Test Mac", app: "Counter", inUse: true };
      expect(decodeEvent(state)).toEqual(state);
    },
  );

  it("refuses a state it does not know", () => {
    expect(() => decodeEvent({ type: "state", status: "asleep", inUse: false })).toThrow();
  });

  it("takes a click at an image pixel and typed text", () => {
    expect(decodeInput({ kind: "click", x: 12, y: 34 })).toEqual({ kind: "click", x: 12, y: 34 });
    expect(decodeInput({ kind: "text", text: "hello" })).toEqual({ kind: "text", text: "hello" });
  });

  it.each([
    ["empty text", { kind: "text", text: "" }],
    ["a page of text", { kind: "text", text: "x".repeat(1001) }],
    ["a click off the image", { kind: "click", x: -1, y: 4 }],
  ])("refuses %s", (_, input) => {
    expect(() => decodeInput(input)).toThrow();
  });
});
