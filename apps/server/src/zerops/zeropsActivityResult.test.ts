import { describe, expect, it } from "@effect/vitest";

import type { SpiEvent, SpiToolCall } from "@t3tools/contracts";
import { ZeropsActivityResult } from "@t3tools/shared/showcaseScenes";
import * as Schema from "effect/Schema";

import { ZEROPS_RESULT_TEXT_LIMIT, projectZeropsResult } from "./zeropsActivityResult.ts";

const spiEvent = (toolCall?: SpiToolCall): SpiEvent => ({ toolCall }) as SpiEvent;
const strictParseOptions = {
  errors: "all",
  onExcessProperty: "error",
} as const;
const decodeSharedActivityResult = Schema.decodeUnknownSync(
  ZeropsActivityResult,
  strictParseOptions,
);

const zeropsCall = (overrides: Partial<SpiToolCall> = {}): SpiToolCall => ({
  name: "zerops_deploy",
  rawName: "mcp__zerops__zerops_deploy",
  arguments: { hostname: "kanbandev" },
  ...overrides,
});

describe("projectZeropsResult", () => {
  it("carries a zerops result verbatim, tool name normalized", () => {
    const projected = projectZeropsResult(
      spiEvent(zeropsCall({ result: { text: '{"status":"DEPLOYED"}', failed: false } })),
    );

    expect(projected?.toolName).toBe("zerops_deploy");
    expect(projected?.resultText).toBe('{"status":"DEPLOYED"}');
    expect(projected?.truncated).toBeUndefined();
  });

  it("ignores a tool that is not zerops", () => {
    const call = zeropsCall({
      name: "browser_open",
      rawName: "mcp__t3-code__browser_open",
      result: { text: "ignored", failed: false },
    });
    expect(projectZeropsResult(spiEvent(call))).toBeUndefined();
  });

  it("reports the tool with no text when the call has not returned yet", () => {
    const projected = projectZeropsResult(spiEvent(zeropsCall()));

    expect(projected?.toolName).toBe("zerops_deploy");
    expect(projected?.resultText).toBeUndefined();
    expect(projected?.truncated).toBeUndefined();
  });

  /**
   * Over the cap the text is DROPPED, never sliced. Half a JSON document parses
   * as nothing, and a card rendering from a truncated document would render a
   * lie; the client degrades to the generic tool block instead.
   */
  it("drops the text whole when it exceeds the cap, and says so", () => {
    const oversized = "x".repeat(ZEROPS_RESULT_TEXT_LIMIT + 1);
    const projected = projectZeropsResult(
      spiEvent(zeropsCall({ result: { text: oversized, failed: false } })),
    );

    expect(projected?.toolName).toBe("zerops_deploy");
    expect(projected?.resultText).toBeUndefined();
    expect(projected?.truncated).toBe(true);
  });

  it("keeps a result sitting exactly on the cap", () => {
    const exact = "x".repeat(ZEROPS_RESULT_TEXT_LIMIT);
    const projected = projectZeropsResult(
      spiEvent(zeropsCall({ result: { text: exact, failed: false } })),
    );

    expect(projected?.resultText).toBe(exact);
    expect(projected?.truncated).toBeUndefined();
  });

  it("ignores an event that carries no toolCall", () => {
    expect(projectZeropsResult(spiEvent(undefined))).toBeUndefined();
  });

  it("carries images through alongside the text", () => {
    const projected = projectZeropsResult(
      spiEvent(
        zeropsCall({
          name: "zerops_browser",
          rawName: "mcp__zerops__zerops_browser",
          result: {
            text: "## Screenshot\n",
            failed: false,
            images: [{ mimeType: "image/jpeg", data: "AAAA", width: 640, height: 360 }],
          },
        }),
      ),
    );

    expect(projected?.images).toEqual([
      { mimeType: "image/jpeg", data: "AAAA", width: 640, height: 360 },
    ]);
    expect(projected?.imagesDropped).toBeUndefined();
  });

  it("carries the imagesDropped flag through even when the text is over its own cap", () => {
    const oversized = "x".repeat(ZEROPS_RESULT_TEXT_LIMIT + 1);
    const projected = projectZeropsResult(
      spiEvent(
        zeropsCall({
          result: { text: oversized, failed: false, imagesDropped: true },
        }),
      ),
    );

    expect(projected?.truncated).toBe(true);
    expect(projected?.imagesDropped).toBe(true);
  });

  it("the projected result decodes through the shared ZeropsActivityResult schema", () => {
    const projected = [
      projectZeropsResult(spiEvent(zeropsCall())),
      projectZeropsResult(
        spiEvent(zeropsCall({ result: { text: '{"status":"DEPLOYED"}', failed: false } })),
      ),
      projectZeropsResult(
        spiEvent(
          zeropsCall({
            result: { text: "x".repeat(ZEROPS_RESULT_TEXT_LIMIT + 1), failed: false },
          }),
        ),
      ),
    ];

    for (const result of projected) {
      expect(result).toBeDefined();
      expect(() => decodeSharedActivityResult(result)).not.toThrow();
    }
  });
});
