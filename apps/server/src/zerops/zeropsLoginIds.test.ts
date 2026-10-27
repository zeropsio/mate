import { describe, expect, it } from "vite-plus/test";

import { extraLoginAgent, makeExtraLoginId } from "./zeropsLoginIds.ts";

describe("extraLoginAgent", () => {
  it.each([
    ["claudeAgent-work", "claude-code"],
    ["codex-home-2", "codex"],
    ["claudeAgent", undefined],
    ["codex", undefined],
    ["claude-code", undefined],
    ["claudeAgent_work", undefined],
    ["cursor-work", undefined],
    ["claudeAgent-", undefined],
  ] as const)("%s is another login of %s", (id, agent) => {
    expect(extraLoginAgent(id)).toBe(agent);
  });
});

describe("makeExtraLoginId", () => {
  it.each([
    {
      name: "a label",
      agent: "claude-code",
      kind: "subscription",
      label: "work",
      id: "claudeAgent-work",
    },
    {
      name: "spaces and case",
      agent: "codex",
      kind: "subscription",
      label: "My Home",
      id: "codex-my-home",
    },
    {
      name: "no label, an account",
      agent: "codex",
      kind: "subscription",
      label: " ",
      id: "codex-account",
    },
    {
      name: "no label, a key",
      agent: "claude-code",
      kind: "apiKey",
      label: "",
      id: "claudeAgent-api-key",
    },
    {
      name: "only symbols",
      agent: "claude-code",
      kind: "subscription",
      label: "✨",
      id: "claudeAgent-account",
    },
  ] as const)("names $name", ({ agent, kind, label, id }) => {
    expect(makeExtraLoginId({ agent, kind, label }, new Set())).toBe(id);
  });

  it("numbers a name already taken", () => {
    expect(
      makeExtraLoginId(
        { agent: "claude-code", kind: "subscription", label: "work" },
        new Set(["claudeAgent-work", "claudeAgent-work-2"]),
      ),
    ).toBe("claudeAgent-work-3");
  });

  it("keeps an id within the slug limit", () => {
    const id = makeExtraLoginId(
      { agent: "claude-code", kind: "subscription", label: "x".repeat(32) },
      new Set(),
    );
    expect(id.length).toBeLessThanOrEqual(64);
    expect(extraLoginAgent(id)).toBe("claude-code");
  });
});
