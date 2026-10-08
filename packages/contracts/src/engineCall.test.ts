import { describe, expect, it } from "vite-plus/test";

import { STEP_ITEM_KINDS, callStep, importedCallFields } from "./engineCall.ts";

const PICTURE = {
  mimeType: "image/png",
  asset: {
    id: "a1",
    threadId: "mate/s/1",
    ownerId: "call-1",
    name: "tool-image",
    provenance: "capture",
    original: { status: "ready", digest: "a".repeat(64), mimeType: "image/png", sizeBytes: 68 },
  },
  width: 1,
  height: 1,
};

describe("a call's step", () => {
  it.each([
    "command_execution",
    "file_change",
    "web_search",
    "image_view",
    "collab_agent_tool_call",
    "mcp_tool_call",
    "dynamic_tool_call",
  ])("reads back as the %s its driver made it", (kind) => {
    expect(STEP_ITEM_KINDS[callStep(kind, {}, undefined)]).toBe(kind);
  });

  it.each([
    { name: "Claude's Read by its line", line: 'Read: {"file_path":"/a"}', step: "read" },
    { name: "OpenCode's grep by its tool's name", shows: { toolName: "grep" }, step: "search" },
    { name: "an ACP read by its kind", shows: { kind: "read" }, step: "read" },
    { name: "a call titled Read File", title: "Read File", step: "read" },
    {
      name: "an MCP tool, never by its own name",
      shows: { toolName: "mcp__x__read" },
      step: "tool",
    },
  ])("a generic call is $step: $name", ({ line, shows, title, step }) => {
    const facts = {
      ...(line === undefined ? {} : { line }),
      ...(shows === undefined ? {} : { shows }),
    };
    const kind = callStep("dynamic_tool_call", facts, title);
    expect(kind).toBe(step);
    expect(STEP_ITEM_KINDS[kind]).toBe("dynamic_tool_call");
  });
});

describe("a call V1 recorded, brought over by the history import", () => {
  const imported = (payload: Record<string, unknown>, summary = "Tool") =>
    importedCallFields({ source: "v1", kind: "tool.completed", summary, payload });

  it("carries its step, input line and facts as a live call's record does", () => {
    expect(
      imported({
        itemType: "command_execution",
        toolCallId: "toolu_1",
        status: "completed",
        detail: "Bash: npm run build",
        data: { toolName: "Bash", command: "npm run build", toolCallId: "toolu_1" },
      }),
    ).toEqual({
      step: "command",
      input: "Bash: npm run build",
      shows: { toolName: "Bash", command: "npm run build" },
    });
  });

  it("a generic call that read a file is a read", () => {
    expect(
      imported({ itemType: "dynamic_tool_call", detail: 'Read: {"file_path":"/a"}' }).step,
    ).toBe("read");
  });

  it("keeps a Zerops result and its pictures held by reference, and drops one held inline", () => {
    expect(
      imported({
        itemType: "mcp_tool_call",
        data: {
          toolName: "mcp__zerops__zerops_browser",
          zerops: {
            toolName: "zerops_browser",
            resultText: "{}",
            images: [PICTURE, { mimeType: "image/png", data: "iVBOR" }],
          },
        },
      }).result,
    ).toEqual({
      toolName: "zerops_browser",
      resultText: "{}",
      images: [PICTURE],
      imagesDropped: true,
    });
  });

  it("keeps what the import already cut: a result too long, pictures it dropped", () => {
    expect(
      imported({
        itemType: "mcp_tool_call",
        data: { zerops: { toolName: "zerops_deploy", truncated: true, imagesDropped: true } },
      }).result,
    ).toEqual({ toolName: "zerops_deploy", truncated: true, imagesDropped: true });
  });

  it("gives nothing for data that is not a V1 call's", () => {
    expect(importedCallFields({ toolName: "Write" })).toEqual({});
    expect(importedCallFields(null)).toEqual({});
  });
});
