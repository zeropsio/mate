import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";
import { ZeropsBrowserStreamEvent } from "./zerops.ts";
const decode = Schema.decodeUnknownSync(ZeropsBrowserStreamEvent);

describe("browser source evidence contract", () => {
  it("keeps legacy unidentified frames decodable", () => {
    expect(decode({ type: "frame", data: "A", width: 10, height: 20 }).type).toBe("frame");
  });
  it("carries call identity and source revision without mutating the JPEG", () => {
    const frame = {
      type: "frame",
      callId: "item",
      threadId: "thread",
      turnId: "turn",
      revision: 3,
      completeness: "complete",
      data: "A",
      width: 10,
      height: 20,
    };
    expect(decode(frame)).toEqual(frame);
  });
  it("distinguishes complete explicit absence from a partial omitted frame", () => {
    const identity = {
      type: "call-result",
      callId: "item",
      threadId: "thread",
      turnId: "turn",
      revision: 4,
    };
    expect(decode({ ...identity, completeness: "complete", frame: null })).toHaveProperty(
      "frame",
      null,
    );
    expect(decode({ ...identity, completeness: "partial" })).not.toHaveProperty("frame");
  });
  it("refuses a fractional source revision", () => {
    expect(() =>
      decode({ type: "frame", callId: "item", revision: 0.5, data: "A", width: 10, height: 20 }),
    ).toThrow();
  });
});
