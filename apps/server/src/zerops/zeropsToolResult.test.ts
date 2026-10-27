import { describe, expect, it } from "@effect/vitest";

import type { SpiEvent, SpiToolCall } from "@t3tools/contracts";

import {
  isZeropsToolName,
  normalizeZeropsToolName,
  readZeropsToolCall,
} from "./zeropsToolResult.ts";

const spiEvent = (toolCall?: SpiToolCall): SpiEvent => ({ toolCall }) as SpiEvent;

const zeropsCall = (overrides: Partial<SpiToolCall> = {}): SpiToolCall => ({
  name: "zerops_workflow",
  rawName: "mcp__zerops__zerops_workflow",
  ...overrides,
});

describe("normalizeZeropsToolName", () => {
  it.each([
    ["mcp__zerops__zerops_workflow", "zerops_workflow"],
    ["mcp__t3-code__browser_open", "browser_open"],
    ["zerops_deploy", "zerops_deploy"],
    ["Bash", "Bash"],
  ])("strips the mcp server prefix from %s", (raw, expected) => {
    expect(normalizeZeropsToolName(raw)).toBe(expected);
  });
});

describe("isZeropsToolName", () => {
  it.each(["mcp__zerops__zerops_workflow", "zerops_deploy", "mcp__anything__zerops_import"])(
    "accepts %s",
    (raw) => {
      expect(isZeropsToolName(raw)).toBe(true);
    },
  );

  it.each(["Bash", "mcp__t3-code__browser_open", "zeropsish", "", "mcp__zerops__other_tool"])(
    "rejects %s",
    (raw) => {
      expect(isZeropsToolName(raw)).toBe(false);
    },
  );
});

/**
 * `readZeropsToolCall` is a pure filter over `event.toolCall` — the ANY-tool
 * view `apps/server/src/spi/toolCall.ts` already populated on the bus. It
 * never looks at a driver's raw item payload, and it never shape-dispatches per provider;
 * that coverage lives in `apps/server/src/spi/toolCall.test.ts`.
 */
describe("readZeropsToolCall", () => {
  it("returns the toolCall verbatim when its rawName is zerops_*", () => {
    const call = zeropsCall({ result: { text: "## Status\n", failed: false } });
    expect(readZeropsToolCall(spiEvent(call))).toEqual(call);
  });

  it("accepts a bare (non-mcp-prefixed) zerops_* rawName — Codex reports it that way", () => {
    const call = zeropsCall({ name: "zerops_deploy", rawName: "zerops_deploy", server: "zerops" });
    expect(readZeropsToolCall(spiEvent(call))).toEqual(call);
  });

  it("returns undefined when the event carries no toolCall (not a tool item, or an unrecognized shape)", () => {
    expect(readZeropsToolCall(spiEvent(undefined))).toBeUndefined();
  });

  it("returns undefined for a non-zerops tool", () => {
    const call = zeropsCall({ name: "browser_open", rawName: "mcp__t3-code__browser_open" });
    expect(readZeropsToolCall(spiEvent(call))).toBeUndefined();
  });

  it("returns undefined for a native (non-MCP) tool with no server", () => {
    const call = zeropsCall({ name: "Bash", rawName: "Bash" });
    expect(readZeropsToolCall(spiEvent(call))).toBeUndefined();
  });

  it("accepts zerops_delete — whatever itemType Claude misclassified it as, toolCall.ts already resolved the shape", () => {
    const call = zeropsCall({ name: "zerops_delete", rawName: "mcp__zerops__zerops_delete" });
    expect(readZeropsToolCall(spiEvent(call))?.name).toBe("zerops_delete");
  });
});
