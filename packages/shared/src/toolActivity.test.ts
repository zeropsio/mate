import { describe, expect, it } from "vite-plus/test";

import {
  claudeToolUseMeta,
  deriveToolActivityPresentation,
  mcpToolPresentation,
  skillInvocation,
} from "./toolActivity.ts";

describe("toolActivity", () => {
  it("normalizes command tools to a stable ran-command label", () => {
    expect(
      deriveToolActivityPresentation({
        itemType: "command_execution",
        title: "Terminal",
        detail: "Terminal",
        data: {
          command: "bun run lint",
        },
        fallbackSummary: "Terminal",
      }),
    ).toEqual({
      summary: "Ran command",
      detail: "bun run lint",
    });
  });

  it("uses structured file paths for read-file tools when available", () => {
    expect(
      deriveToolActivityPresentation({
        itemType: "dynamic_tool_call",
        title: "Read File",
        detail: "Read File",
        data: {
          kind: "read",
          locations: [{ path: "/tmp/app.ts" }],
        },
        fallbackSummary: "Read File",
      }),
    ).toEqual({
      summary: "Read file",
      detail: "/tmp/app.ts",
    });
  });

  it("drops duplicated generic read-file detail when no path is available", () => {
    expect(
      deriveToolActivityPresentation({
        itemType: "dynamic_tool_call",
        title: "Read File",
        detail: "Read File",
        data: {
          kind: "read",
          rawInput: {},
        },
        fallbackSummary: "Read File",
      }),
    ).toEqual({
      summary: "Read file",
    });
  });

  it.each([
    [
      "Claude's Skill call",
      "Skill",
      { skill: "claude-api", args: " pricing " },
      { name: "claude-api", args: "pricing" },
    ],
    [
      "OpenCode's skill call",
      "skill",
      { name: "zerops-deploy" },
      { name: "zerops-deploy", args: undefined },
    ],
    ["a skill call that names no skill", "Skill", { skill: " " }, undefined],
    ["another tool's input that happens to say skill", "Read", { skill: "full-send" }, undefined],
  ])("%s: the skill it loads, and what it passes", (_call, toolName, input, expected) => {
    expect(skillInvocation(toolName, input)).toEqual(expected);
  });
});

describe("mcpToolPresentation", () => {
  it.each([
    [
      "an MCP tool presents its own title and its server, by name and icon",
      {
        toolName: "mcp__claude_ai_Firecrawl__firecrawl_scrape",
        title: "Firecrawl scrape",
        serverDisplayName: "Firecrawl",
        iconUrl: "https://www.google.com/s2/favicons?domain=firecrawl.dev&sz=64",
      },
      {
        title: "Firecrawl scrape",
        source: {
          key: "mcp:claude_ai_firecrawl",
          name: "Firecrawl",
          iconUrl: "https://www.google.com/s2/favicons?domain=firecrawl.dev&sz=64",
        },
      },
    ],
    [
      "an MCP tool its agent gives no title is titled from its name",
      { toolName: "mcp__linear__search_issues" },
      { title: "search issues", source: { key: "mcp:linear", name: "linear" } },
    ],
    [
      "a server named apart from its tool is that server",
      { serverName: "Notion", toolName: "notion-search" },
      { title: "notion search", source: { key: "mcp:notion", name: "Notion" } },
    ],
    [
      "an icon that is no web address is dropped",
      { toolName: "mcp__linear__search_issues", iconUrl: "javascript:alert(1)" },
      { title: "search issues", source: { key: "mcp:linear", name: "linear" } },
    ],
    ["a tool that is no MCP tool presents nothing", { toolName: "Read", title: "Read" }, undefined],
  ])("%s", (_sentence, input, expected) => {
    expect(mcpToolPresentation(input)).toEqual(expected);
  });
});

describe("claudeToolUseMeta", () => {
  it("reads Claude Code's display name, server and icon for each call of an assistant frame", () => {
    const meta = claudeToolUseMeta({
      type: "assistant",
      tool_use_meta: [
        {
          id: "toolu_1",
          display_name: "Firecrawl scrape",
          server_display_name: "Firecrawl",
          icon_url: "https://firecrawl.dev/icon.png",
        },
        { id: "toolu_2", display_name: "  " },
        "not an entry",
        { display_name: "No id" },
      ],
    });
    expect([...meta]).toEqual([
      [
        "toolu_1",
        {
          title: "Firecrawl scrape",
          serverDisplayName: "Firecrawl",
          iconUrl: "https://firecrawl.dev/icon.png",
        },
      ],
      ["toolu_2", {}],
    ]);
  });

  it("reads nothing from a frame that carries none", () => {
    expect(claudeToolUseMeta({ type: "assistant" }).size).toBe(0);
    expect(claudeToolUseMeta({ type: "user", tool_use_meta: [{ id: "toolu_1" }] }).size).toBe(0);
  });
});
