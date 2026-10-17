import { describe, expect, it } from "vite-plus/test";

import {
  automatedKeyState,
  automatedMateEntries,
  conversationTask,
  taskTitle,
} from "./automatedMate.logic";

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

describe("the organization's key for automated Mates", () => {
  const nebius = (set: boolean) => ({ provider: "nebius", set, setAt: null });
  it.each([
    { case: "not read yet", keys: { state: "unread" }, key: "unknown" },
    { case: "being read", keys: { state: "reading" }, key: "unknown" },
    { case: "its read failed", keys: { state: "failed", words: "HQ is down." }, key: "unknown" },
    {
      case: "an HQ older than automated Mates",
      keys: { state: "unsupported" },
      key: "unsupported",
    },
    {
      case: "set",
      keys: { state: "known", keys: [nebius(true)], stale: false },
      key: "set",
    },
    {
      case: "not set",
      keys: { state: "known", keys: [nebius(false)], stale: false },
      key: "missing",
    },
    { case: "none listed", keys: { state: "known", keys: [], stale: false }, key: "missing" },
  ] as const)("reads $case as $key", ({ keys, key }) => {
    expect(automatedKeyState(keys)).toBe(key);
  });
});
