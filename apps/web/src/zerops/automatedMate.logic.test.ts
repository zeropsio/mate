import { describe, expect, it } from "vite-plus/test";

import { automatedMateEntries, conversationTask, taskTitle } from "./automatedMate.logic";

const issue = {
  kind: "github-issue",
  repo: "acme/tea-shop",
  number: 12,
  url: "https://github.com/acme/tea-shop/issues/12",
  title: "Fix the checkout total",
  author: "nova-dev",
} as const;

describe("an automated Mate's agents", () => {
  const entries = [
    { instanceId: "claudeAgent", driverKind: "claudeAgent" },
    { instanceId: "codex", driverKind: "codex" },
    { instanceId: "opencode", driverKind: "opencode" },
  ];
  it.each([
    ["an automated Mate offers no agent a person signs in", true, ["opencode"]],
    ["an ordinary Mate offers every agent", false, ["claudeAgent", "codex", "opencode"]],
  ] as const)("%s", (_case, automated, shown) => {
    expect(automatedMateEntries(entries, automated).map((entry) => entry.instanceId)).toEqual(
      shown,
    );
  });
});

describe("a task's conversation", () => {
  it("is named by its issue's number and title", () => {
    expect(taskTitle(issue)).toBe("#12 Fix the checkout total");
  });

  it.each([
    ["a conversation opened by a task is that task's", [{ role: "user", task: issue }], issue],
    [
      "a later message carrying nothing leaves it the task's",
      [{ role: "user", task: issue }, { role: "assistant" }, { role: "user" }],
      issue,
    ],
    ["a conversation a person opened is no task's", [{ role: "user" }], null],
    ["an empty conversation is no task's", [], null],
  ] as const)("%s", (_case, messages, task) => {
    expect(conversationTask(messages)).toEqual(task);
  });
});
