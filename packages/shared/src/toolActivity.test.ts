import { describe, expect, it } from "vite-plus/test";

import { deriveToolActivityPresentation, skillInvocation } from "./toolActivity.ts";

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
