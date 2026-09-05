import { describe, expect, it } from "vite-plus/test";
import { ZeropsActivityResult } from "@t3tools/shared/showcaseScenes";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { readZeropsActivityResult } from "./activityResult.ts";

const decodeSharedActivityResult = Schema.decodeUnknownSync(ZeropsActivityResult);
const decodeSharedActivityResultOption = Schema.decodeUnknownOption(ZeropsActivityResult);

describe("readZeropsActivityResult", () => {
  it("reads a completed zerops result", () => {
    const result = readZeropsActivityResult({
      item: { tool: "zerops_deploy" },
      zerops: { toolName: "zerops_deploy", resultText: '{"status":"DEPLOYED"}' },
    });

    expect(result).toEqual({ toolName: "zerops_deploy", resultText: '{"status":"DEPLOYED"}' });
  });

  it("reads a running call, which has a name but no text yet", () => {
    const result = readZeropsActivityResult({ zerops: { toolName: "zerops_import" } });

    expect(result).toEqual({ toolName: "zerops_import" });
  });

  it("reads the truncated marker without inventing text", () => {
    const result = readZeropsActivityResult({
      zerops: { toolName: "zerops_deploy", truncated: true },
    });

    expect(result).toEqual({ toolName: "zerops_deploy", truncated: true });
  });

  /**
   * A server older than this seam sends no `zerops` key at all. That is the
   * ordinary path during a rollout, not an error: the caller renders the
   * generic tool block.
   */
  it("returns nothing when the server did not attach a zerops result", () => {
    expect(readZeropsActivityResult({ item: { tool: "zerops_deploy" } })).toBeUndefined();
  });

  it("returns nothing for a payload it cannot read", () => {
    expect(readZeropsActivityResult(undefined)).toBeUndefined();
    expect(readZeropsActivityResult("text")).toBeUndefined();
    expect(readZeropsActivityResult([])).toBeUndefined();
    expect(readZeropsActivityResult({ zerops: "deployed" })).toBeUndefined();
    expect(readZeropsActivityResult({ zerops: {} })).toBeUndefined();
    expect(readZeropsActivityResult({ zerops: { toolName: "" } })).toBeUndefined();
    expect(readZeropsActivityResult({ zerops: { toolName: 42 } })).toBeUndefined();
  });

  it("ignores a resultText that is not a string rather than passing it on", () => {
    const result = readZeropsActivityResult({
      zerops: { toolName: "zerops_verify", resultText: { content: "nope" } },
    });

    expect(result).toEqual({ toolName: "zerops_verify" });
  });

  it("reads an image alongside the text (e.g. a zerops_browser screenshot)", () => {
    const result = readZeropsActivityResult({
      zerops: {
        toolName: "zerops_browser",
        resultText: "## Screenshot\n",
        images: [{ mimeType: "image/jpeg", data: "AAAA", width: 640, height: 360 }],
      },
    });

    expect(result).toEqual({
      toolName: "zerops_browser",
      resultText: "## Screenshot\n",
      images: [{ mimeType: "image/jpeg", data: "AAAA", width: 640, height: 360 }],
    });
  });

  it("reads the imagesDropped marker", () => {
    const result = readZeropsActivityResult({
      zerops: { toolName: "zerops_browser", imagesDropped: true },
    });

    expect(result).toEqual({ toolName: "zerops_browser", imagesDropped: true });
  });

  it("drops a malformed image entry rather than failing the whole read", () => {
    const result = readZeropsActivityResult({
      zerops: {
        toolName: "zerops_browser",
        images: [{ mimeType: "image/jpeg" }, { mimeType: "image/jpeg", data: "AAAA" }],
      },
    });

    expect(result).toEqual({
      toolName: "zerops_browser",
      images: [{ mimeType: "image/jpeg", data: "AAAA" }],
    });
  });

  it("accepts the shared shape and normalizes its two deliberately permissive fields", () => {
    const candidates: ReadonlyArray<{
      readonly value: unknown;
      readonly readerAccepts: boolean;
      readonly schemaAccepts: boolean;
    }> = [
      { value: { toolName: "zerops_import" }, readerAccepts: true, schemaAccepts: true },
      {
        value: { toolName: "zerops_verify", resultText: '{"status":"healthy"}' },
        readerAccepts: true,
        schemaAccepts: true,
      },
      {
        value: { toolName: "zerops_deploy", truncated: true },
        readerAccepts: true,
        schemaAccepts: true,
      },
      {
        value: { toolName: "zerops_verify", resultText: 42 },
        readerAccepts: true,
        schemaAccepts: false,
      },
      {
        value: { toolName: "zerops_deploy", truncated: false },
        readerAccepts: true,
        schemaAccepts: false,
      },
      { value: {}, readerAccepts: false, schemaAccepts: false },
      { value: { toolName: "" }, readerAccepts: false, schemaAccepts: false },
      { value: { toolName: 42 }, readerAccepts: false, schemaAccepts: false },
      { value: null, readerAccepts: false, schemaAccepts: false },
      { value: [], readerAccepts: false, schemaAccepts: false },
    ];
    for (const { value, readerAccepts, schemaAccepts } of candidates) {
      const schemaResult = decodeSharedActivityResultOption(value);
      const readerResult = readZeropsActivityResult({ zerops: value });
      expect(readerResult !== undefined).toBe(readerAccepts);
      expect(Option.isSome(schemaResult)).toBe(schemaAccepts);
      if (readerResult !== undefined) {
        expect(decodeSharedActivityResult(readerResult)).toEqual(readerResult);
      }
    }
  });
});
