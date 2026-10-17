import { describe, expect, it } from "vite-plus/test";

import {
  newMateKeyNote,
  automatedAgentsLine,
  automatedKeyState,
  automatedMateEntries,
  conversationTask,
  pullRequestStateWords,
  taskChain,
  taskChainLine,
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

describe("an automated Mate's panel line", () => {
  it.each([
    { key: "set", line: "Nova runs on your organization's API key. Nobody signs in to it." },
    {
      key: "missing",
      line: "Nova waits for your organization's API key. Nobody signs in to it.",
    },
    { key: "unknown", line: "Nova runs on your organization's API key. Nobody signs in to it." },
  ] as const)("with the key $key says: $line", ({ key, line }) => {
    expect(automatedAgentsLine("Nova", key)).toBe(line);
  });
});

describe("New Mate's note on the key an automated Mate runs on", () => {
  it.each([
    { key: "missing", admin: true, note: { kind: "missing", canSet: true } },
    { key: "missing", admin: false, note: { kind: "missing", canSet: false } },
    { key: "set", admin: true, note: null },
    { key: "unknown", admin: false, note: null },
    { key: "unsupported", admin: true, note: { kind: "update" } },
  ] as const)("with the key $key, admin $admin", ({ key, admin, note }) => {
    expect(newMateKeyNote(key, admin)).toEqual(note);
  });
});

describe("a task's chain: where its conversation's task stands now", () => {
  const onIt = {
    id: "t1",
    repo: "acme/tea-shop",
    number: 12,
    title: "Fix the checkout total",
    url: "https://github.com/acme/tea-shop/issues/12",
  };
  const pr = { number: 14, url: "https://github.com/acme/tea-shop/pull/14" };
  it.each([
    {
      case: "holds its line while the Mate's task is not read",
      current: undefined,
      working: false,
      line: { status: null, pullRequest: null },
    },
    {
      case: "holds its line once its Mate is on no task HQ names",
      current: null,
      working: false,
      line: { status: null, pullRequest: null },
    },
    {
      case: "holds its line once its Mate is on another task",
      current: { ...onIt, id: "t2", number: 13, title: "Another" },
      working: false,
      line: { status: null, pullRequest: null },
    },
    {
      case: "names its pull request merged, once the task ended with it",
      current: {
        ...onIt,
        ended: "merged" as const,
        pullRequest: { ...pr, state: "merged" as const },
      },
      working: false,
      line: { status: null, pullRequest: { words: "PR #14 · merged", url: pr.url } },
    },
    {
      case: "names its pull request closed, once the task ended with it",
      current: {
        ...onIt,
        ended: "closed" as const,
        pullRequest: { ...pr, state: "closed" as const },
      },
      working: false,
      line: { status: null, pullRequest: { words: "PR #14 · closed", url: pr.url } },
    },
    {
      case: "says it was stopped, with the pull request it left",
      current: {
        ...onIt,
        ended: "stopped" as const,
        pullRequest: { ...pr, state: "closed" as const },
      },
      working: false,
      line: { status: "Stopped", pullRequest: { words: "PR #14 · closed", url: pr.url } },
    },
    {
      case: "says it failed",
      current: { ...onIt, ended: "failed" as const },
      working: false,
      line: { status: "Failed", pullRequest: null },
    },
    {
      case: "says it is done",
      current: { ...onIt, ended: "done" as const },
      working: false,
      line: { status: "Done", pullRequest: null },
    },
    {
      case: "says it merged where no pull request carried it",
      current: { ...onIt, ended: "merged" as const },
      working: false,
      line: { status: "Merged", pullRequest: null },
    },
    {
      case: "says how it ended, never that its Mate works on it, once it ended",
      current: { ...onIt, ended: "done" as const },
      working: true,
      line: { status: "Done", pullRequest: null },
    },
    {
      case: "says its Mate works on it",
      current: onIt,
      working: true,
      line: { status: "Working", pullRequest: null },
    },
    {
      case: "says its Mate waits for you where it asked something",
      current: { ...onIt, waiting: true as const },
      working: false,
      line: { status: "Waiting for you", pullRequest: null },
    },
    {
      case: "says its change waits for review where it has no pull request",
      current: onIt,
      working: false,
      line: { status: "Waiting for review", pullRequest: null },
    },
    {
      case: "names its open pull request and its checks, linked",
      current: {
        ...onIt,
        pullRequest: { ...pr, state: "open" as const, checks: "passing" as const },
      },
      working: false,
      line: { status: null, pullRequest: { words: "PR #14 · open · checks passing", url: pr.url } },
    },
    {
      case: "names its pull request while its Mate works on it again",
      current: {
        ...onIt,
        pullRequest: { ...pr, state: "open" as const, checks: "failing" as const },
      },
      working: true,
      line: {
        status: "Working",
        pullRequest: { words: "PR #14 · open · checks failing", url: pr.url },
      },
    },
    {
      case: "names its merged pull request",
      current: { ...onIt, pullRequest: { ...pr, state: "merged" as const } },
      working: false,
      line: { status: null, pullRequest: { words: "PR #14 · merged", url: pr.url } },
    },
    {
      case: "names its pull request closed unmerged",
      current: { ...onIt, pullRequest: { ...pr, state: "closed" as const } },
      working: false,
      line: { status: null, pullRequest: { words: "PR #14 · closed", url: pr.url } },
    },
  ])("$case", ({ current, working, line }) => {
    expect(taskChainLine(taskChain(issue, current, working))).toEqual(line);
  });

  it("knows a task from elsewhere by its link, else by its title", () => {
    const slack = {
      kind: "slack-thread",
      workspace: "Acme",
      channel: "support",
      url: "https://acme.slack.com/archives/C1/p1",
      title: "Update the price list",
      author: "Nova",
    } as const;
    const schedule = { kind: "schedule", name: "Weekly", title: "Update dependencies" } as const;
    const nav = (over: object) => ({ id: "t", title: "Other", url: null, ...over });
    expect(taskChain(slack, nav({ url: slack.url }), true).kind).toBe("working");
    expect(taskChain(slack, nav({ url: "https://acme.slack.com/x" }), true).kind).toBe("earlier");
    expect(taskChain(schedule, nav({ title: "Update dependencies" }), true).kind).toBe("working");
    expect(taskChain(schedule, nav({}), true).kind).toBe("earlier");
  });
});

describe("a pull request's state in words", () => {
  it.each([
    [{ state: "open", checks: "passing" }, "open · checks passing"],
    [{ state: "open", checks: "failing" }, "open · checks failing"],
    [{ state: "open", checks: "pending" }, "open · checks running"],
    [{ state: "open" }, "open"],
    [{ state: "merged", checks: "passing" }, "merged"],
    [{ state: "closed" }, "closed"],
  ] as const)("%o reads “%s”", (pullRequest, words) => {
    expect(pullRequestStateWords(pullRequest)).toBe(words);
  });
});
