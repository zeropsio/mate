import { describe, expect, it } from "vite-plus/test";

import {
  automationSection,
  connectionMissing,
  poolMateLine,
  scheduleWhen,
  sourceRowPress,
  sourceRows,
  stopWords,
  type SourceReads,
} from "./projectAutomation.logic";

const known = <T>(held: T) => ({ state: "known" as const, held, stale: false });
const NONE: SourceReads = {
  intake: null,
  slack: known({ channel: null }),
  discord: known({ channel: null }),
  webhooks: known([]),
  schedules: known([]),
  slackConnected: true,
  discordConnected: true,
};
const schedule = {
  id: "s1",
  name: "Update dependencies",
  brief: "Update them.",
  rule: { every: "week" as const, day: 1, at: "09:00", timeZone: "Europe/Prague" },
  nextAt: null,
};

describe("a project's pool of automated Mates", () => {
  const task = { number: 1, title: "Add a search box" };
  it.each([
    ["one with no task waits for one", { task: null }, false, "Waiting for a task"],
    [
      "one with no task and no organization key waits for the key",
      { task: null, key: "missing" as const },
      false,
      "Waiting for an API key",
    ],
    ["one at work names its task", { task }, true, "#1 Add a search box"],
    [
      "one at work on its pull request names both",
      { task: { ...task, pullRequest: { number: 2, state: "open" as const } } },
      true,
      "#1 Add a search box · PR #2 open",
    ],
    [
      "one at rest on its pull request says it waits for review",
      { task: { ...task, pullRequest: { number: 2, state: "open" as const } } },
      false,
      "#1 Add a search box · PR #2 up for review",
    ],
    [
      "one waiting for a person's answer says so",
      { task: { ...task, waiting: true as const } },
      false,
      "#1 Add a search box · waiting for you",
    ],
  ])("%s", (_case, automation, working, line) => {
    expect(poolMateLine(automation, working)).toBe(line);
  });
});

describe("a project's sources of tasks", () => {
  it.each([
    ["none set reads as no rows", NONE, []],
    [
      "GitHub issues by their label and repository, with the tasks waiting",
      { ...NONE, intake: { repo: "acme/tea-shop", label: "mate", waiting: 2 } },
      ["GitHub issues labelled “mate” · acme/tea-shop · 2 tasks waiting"],
    ],
    [
      "a channel on Slack and one on Discord",
      {
        ...NONE,
        slack: known({ channel: { appId: "a", channelId: "C1", channel: "support" } }),
        discord: known({ channel: { appId: "a", channelId: "D1", channel: "bugs" } }),
      },
      ["#support on Slack", "#bugs on Discord"],
    ],
    [
      "webhooks by their count",
      { ...NONE, webhooks: known([{ id: "w1" }, { id: "w2" }]) },
      ["2 webhooks"],
    ],
    ["one webhook", { ...NONE, webhooks: known([{ id: "w1" }]) }, ["1 webhook"]],
    [
      "each schedule by when it runs and its name",
      { ...NONE, schedules: known([schedule]) },
      ["Every Monday 09:00 · Update dependencies"],
    ],
    [
      "a source refused to the reader has no row",
      { ...NONE, webhooks: { state: "withheld" as const } },
      [],
    ],
    [
      "a source whose read failed says HQ's words",
      { ...NONE, schedules: { state: "failed" as const, words: "HQ did not answer." } },
      ["HQ did not answer."],
    ],
  ] as const)("%s", (_case, reads, words) => {
    expect(sourceRows(reads).rows.map((row) => row.words)).toEqual(words);
  });

  it("says a channel's organization connection is missing on its row", () => {
    const { rows } = sourceRows({
      ...NONE,
      slack: known({ channel: { appId: "a", channelId: "C1", channel: "support" } }),
      slackConnected: false,
    });
    expect(rows).toEqual([
      { key: "slack", kind: "slack", words: "#support on Slack", disconnected: true },
    ]);
  });

  it.each([
    ["the intake is not read", { ...NONE, intake: undefined }, true],
    ["a channel is being read", { ...NONE, slack: { state: "reading" as const } }, true],
    ["webhooks are not read", { ...NONE, webhooks: { state: "unread" as const } }, true],
    ["everything is read", NONE, false],
    [
      "a refused read is no read to wait for",
      { ...NONE, slack: { state: "withheld" as const } },
      false,
    ],
  ] as const)("is still reading while %s: %s", (_case, reads, reading) => {
    expect(sourceRows(reads).reading).toBe(reading);
  });
});

describe("sources refused to the reader", () => {
  it.each([
    ["a source refused to the reader", { ...NONE, slack: { state: "withheld" as const } }, true],
    ["every source read", NONE, false],
    ["a source this HQ predates", { ...NONE, slack: { state: "unsupported" as const } }, false],
  ] as const)("are said where %s", (_case, reads, withheld) => {
    expect(sourceRows(reads).withheld).toBe(withheld);
  });
});

describe("when a schedule runs", () => {
  it.each([
    [{ every: "day", at: "07:30", timeZone: "UTC" }, "Every day 07:30"],
    [{ every: "weekday", at: "08:00", timeZone: "UTC" }, "Every weekday 08:00"],
    [{ every: "week", day: 5, at: "16:00", timeZone: "UTC" }, "Every Friday 16:00"],
  ] as const)("%o reads “%s”", (rule, words) => {
    expect(scheduleWhen(rule)).toBe(words);
  });
});

describe("a channel's form where its app is not connected", () => {
  it.each([
    ["slack", { slack: false, discord: true }, true],
    ["discord", { slack: true, discord: false }, true],
    ["slack", { slack: true, discord: false }, false],
    ["slack", { slack: undefined, discord: undefined }, false],
    ["webhook", { slack: false, discord: false }, false],
  ] as const)("%s with %o says where to connect it: %s", (kind, connected, says) => {
    const words = connectionMissing(kind, connected);
    expect(words === null ? false : words.includes("Settings › Automation")).toBe(says);
  });
});

describe("whether a project's page shows its Automation section", () => {
  it.each([
    ["to an Admin with nothing set up", { admin: true, key: "set", pool: 0, sources: 0 }, "shown"],
    [
      "to a member with nothing set up",
      { admin: false, key: "set", pool: 0, sources: 0 },
      "hidden",
    ],
    ["to a member once it has a pool", { admin: false, key: "set", pool: 1, sources: 0 }, "shown"],
    [
      "to a member once it has a source",
      { admin: false, key: "missing", pool: 0, sources: 1 },
      "shown",
    ],
    [
      "to an Admin while the key is not read yet",
      { admin: true, key: "unknown", pool: 0, sources: 0 },
      "shown",
    ],
    [
      "to an Admin where HQ predates automated Mates: in its place, that HQ needs updating",
      { admin: true, key: "unsupported", pool: 0, sources: 0 },
      "update",
    ],
    [
      "to a member where HQ predates automated Mates: nothing",
      { admin: false, key: "unsupported", pool: 0, sources: 0 },
      "hidden",
    ],
  ] as const)("%s", (_case, input, section) => {
    expect(automationSection(input)).toBe(section);
  });
});

describe("Stop and Remove on a source's row", () => {
  it.each([
    [
      "rests while nothing was pressed on it",
      { asking: null, pressed: null, action: { kind: "idle" } },
      { kind: "idle" },
    ],
    [
      "asks first, once pressed",
      { asking: "slack", pressed: null, action: { kind: "idle" } },
      { kind: "asking" },
    ],
    [
      "shows its stop under way",
      { asking: null, pressed: "slack", action: { kind: "working", verb: "channel-stop" } },
      { kind: "working" },
    ],
    [
      "says HQ's refusal on it",
      { asking: null, pressed: "slack", action: { kind: "failed", words: "HQ refused it." } },
      { kind: "refused", words: "HQ refused it." },
    ],
    [
      "rests once its stop is done",
      { asking: null, pressed: "slack", action: { kind: "done", verb: "channel-stop" } },
      { kind: "idle" },
    ],
    [
      "never wears another row's press",
      { asking: null, pressed: "github", action: { kind: "working", verb: "stop" } },
      { kind: "idle" },
    ],
  ] as const)("%s", (_case, input, press) => {
    expect(sourceRowPress({ key: "slack", ...input })).toEqual(press);
  });

  it.each([
    ["github", { ask: "Stop taking GitHub issues?", verb: "Stop", working: "Stopping…" }],
    ["slack", { ask: "Stop taking tasks from this channel?", verb: "Stop", working: "Stopping…" }],
    [
      "schedule",
      { ask: "Remove this schedule and its brief?", verb: "Remove", working: "Removing…" },
    ],
  ] as const)("a %s row asks and works in its own words", (kind, words) => {
    expect(stopWords(kind)).toEqual(words);
  });
});
