import { describe, expect, it } from "vite-plus/test";

import { readZeropsActivityResult } from "./activityResult.ts";

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
});
