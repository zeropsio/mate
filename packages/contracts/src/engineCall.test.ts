import { describe, expect, it } from "vite-plus/test";

import { STEP_ITEM_KINDS, callStep } from "./engineCall.ts";

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
