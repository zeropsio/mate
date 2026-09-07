import { describe, expect, it } from "vite-plus/test";

import { agentsFromOAuthFlags, unionAgents } from "./agentSelection.ts";

describe("agentsFromOAuthFlags", () => {
  const cases = [
    {
      name: "reads the agent a container has signed in with",
      records: [{ key: "ZCP_AGENT_OAUTH_CLAUDE_CODE", content: "true" }],
      expected: ["claude-code"],
    },
    {
      name: "maps every suffix back to its agent type",
      records: [
        { key: "ZCP_AGENT_OAUTH_CODEX", content: "true" },
        { key: "ZCP_AGENT_OAUTH_ANTIGRAVITY", content: "true" },
        { key: "ZCP_AGENT_OAUTH_GROK", content: "true" },
        { key: "ZCP_AGENT_OAUTH_CURSOR", content: "true" },
      ],
      expected: ["codex", "antigravity", "grok", "cursor"],
    },
    {
      name: "answers in canonical order, not the order the platform listed",
      records: [
        { key: "ZCP_AGENT_OAUTH_CURSOR", content: "true" },
        { key: "ZCP_AGENT_OAUTH_CLAUDE_CODE", content: "true" },
      ],
      expected: ["claude-code", "cursor"],
    },
    {
      name: "reads a flag as forgivingly as zcp does",
      records: [
        { key: "ZCP_AGENT_OAUTH_CLAUDE_CODE", content: " 1 " },
        { key: "ZCP_AGENT_OAUTH_CODEX", content: "TRUE" },
      ],
      expected: ["claude-code", "codex"],
    },
    {
      name: "ignores a flag that is switched off",
      records: [
        { key: "ZCP_AGENT_OAUTH_CLAUDE_CODE", content: "false" },
        { key: "ZCP_AGENT_OAUTH_CODEX", content: "" },
      ],
      expected: [],
    },
    {
      // The selection reads back REDACTED (measured 2026-09-07), which is
      // exactly why the oauth flag — written non-sensitive — is the source.
      name: "never reads the redacted selection as an authorization",
      records: [
        { key: "ZCP_AGENTS", content: "REDACTED" },
        { key: "ZCP_AGENT_AUTH_TYPE_CLAUDE_CODE", content: "REDACTED" },
      ],
      expected: [],
    },
    {
      name: "ignores a suffix that names no agent we know",
      records: [{ key: "ZCP_AGENT_OAUTH_OPENCODE_AI", content: "true" }],
      expected: [],
    },
    {
      name: "says nothing for a container with no flags at all",
      records: [{ key: "PATH", content: "/usr/bin" }],
      expected: [],
    },
  ] as const;

  for (const { name, records, expected } of cases) {
    it(name, () => {
      expect(agentsFromOAuthFlags(records)).toEqual(expected);
    });
  }
});

describe("unionAgents", () => {
  it("merges what the group's environments have between them, in canonical order", () => {
    expect(unionAgents([["cursor"], ["claude-code"], ["cursor", "codex"]])).toEqual([
      "claude-code",
      "codex",
      "cursor",
    ]);
  });

  it("is empty for a group that has authorized nothing", () => {
    expect(unionAgents([[], []])).toEqual([]);
  });
});
