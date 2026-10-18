import type { HqAppTask } from "@t3tools/shared/hqIntake";
import type { HqNavigationMateTask } from "@t3tools/shared/hqStream";
import { describe, expect, it } from "vite-plus/test";

import {
  recordOf,
  spentWords,
  taskSession,
  workedWords,
  type TaskSessionInput,
} from "./taskSession.logic";

const issue = {
  kind: "github-issue",
  repo: "acme/tea-shop",
  number: 12,
  url: "https://github.com/acme/tea-shop/issues/12",
  title: "Fix the checkout total",
  author: "nova-dev",
} as const;

const onIt: HqNavigationMateTask = {
  id: "task-12",
  repo: "acme/tea-shop",
  number: 12,
  title: "Fix the checkout total",
  url: issue.url,
  spentUsd: 0.42,
  workedMs: 12 * 60_000,
};

const prOpen = {
  number: 2,
  url: "https://github.com/acme/tea-shop/pull/2",
  state: "open",
} as const;

const record = (overrides: Partial<HqAppTask> = {}): HqAppTask => ({
  id: "task-12",
  title: "Fix the checkout total",
  label: "acme/tea-shop#12",
  url: issue.url,
  state: "done",
  mate: { projectId: "p-juno", name: "Juno" },
  requestedBy: "nova-dev",
  createdAt: "2026-10-17T10:00:00.000Z",
  startedAt: "2026-10-17T10:01:00.000Z",
  endedAt: "2026-10-17T10:30:00.000Z",
  spentUsd: 1.2,
  workedMs: 29 * 60_000,
  detail: null,
  change: { repo: "web", number: 3 },
  pullRequest: null,
  link: null,
  ...overrides,
});

const input = (overrides: Partial<TaskSessionInput>): TaskSessionInput => ({
  source: issue,
  current: undefined,
  working: false,
  record: undefined,
  stopAsked: false,
  ...overrides,
});

describe("a task's session: how its conversation's task stands, in one word", () => {
  it.each([
    ["nothing is said while HQ's navigation is not read", input({}), null],
    ["its Mate at work on it is working", input({ current: onIt, working: true }), "working"],
    [
      "waiting for a person's answer is waiting for you",
      input({ current: { ...onIt, waiting: true } }),
      "waiting",
    ],
    [
      "at rest with its pull request open is up for review",
      input({ current: { ...onIt, pullRequest: prOpen } }),
      "review",
    ],
    ["at rest with no pull request yet is up for review", input({ current: onIt }), "review"],
    [
      "its pull request merged is merged",
      input({ current: { ...onIt, ended: "merged", pullRequest: { ...prOpen, state: "merged" } } }),
      "merged",
    ],
    ["ended failed is failed", input({ current: { ...onIt, ended: "failed" } }), "failed"],
    ["ended stopped is stopped", input({ current: { ...onIt, ended: "stopped" } }), "stopped"],
    [
      "done with its pull request open is up for review",
      input({ current: { ...onIt, ended: "done", pullRequest: prOpen } }),
      "review",
    ],
    ["done with nothing to review is done", input({ current: { ...onIt, ended: "done" } }), "done"],
    [
      "stopped by the person and not yet ended is stopping",
      input({ current: onIt, working: true, stopAsked: true }),
      "stopping",
    ],
    [
      "a task before its Mate's latest says what its own record says",
      input({ current: { ...onIt, id: "task-13", number: 13 }, record: record() }),
      "review",
    ],
    [
      "a task before its Mate's latest, with no record read, says nothing",
      input({ current: { ...onIt, id: "task-13", number: 13 } }),
      null,
    ],
    [
      "a queued task's record is queued",
      input({ current: null, record: record({ state: "queued" }) }),
      "queued",
    ],
    [
      "a merged task's record is merged",
      input({ current: null, record: record({ state: "merged" }) }),
      "merged",
    ],
  ] as const)("%s", (_title, given, status) => {
    expect(taskSession(given).status).toBe(status);
  });

  it("says what its Mate last reported it cost and worked, else its record's", () => {
    expect(taskSession(input({ current: onIt, working: true }))).toMatchObject({
      spentUsd: 0.42,
      workedMs: 12 * 60_000,
    });
    expect(
      taskSession(input({ current: { ...onIt, id: "task-13", number: 13 }, record: record() })),
    ).toMatchObject({ spentUsd: 1.2, workedMs: 29 * 60_000, change: { repo: "web", number: 3 } });
  });

  it("can be stopped while queued, at work or waiting, and once only", () => {
    expect(taskSession(input({ current: onIt, working: true }))).toMatchObject({
      stoppable: true,
      taskId: "task-12",
    });
    expect(taskSession(input({ current: { ...onIt, waiting: true } })).stoppable).toBe(true);
    expect(taskSession(input({ current: onIt })).stoppable).toBe(false);
    expect(taskSession(input({ current: onIt, working: true, stopAsked: true })).stoppable).toBe(
      false,
    );
    expect(taskSession(input({ current: { ...onIt, ended: "failed" } })).stoppable).toBe(false);
  });
});

describe("a task's record on its application's board", () => {
  it("is the latest of its Mate's tasks from the same source", () => {
    const earlier = record({ id: "task-9", createdAt: "2026-10-16T10:00:00.000Z" });
    const latest = record({ id: "task-12" });
    const otherMate = record({ id: "task-13", mate: { projectId: "p-rhea", name: "Rhea" } });
    const otherIssue = record({ id: "task-14", url: "https://github.com/acme/tea-shop/issues/13" });
    expect(recordOf(issue, "p-juno", [earlier, otherMate, latest, otherIssue])?.id).toBe("task-12");
  });

  it("is none where no task of its Mate came from that source", () => {
    expect(recordOf(issue, "p-juno", [record({ mate: null })])).toBeUndefined();
    expect(recordOf(issue, "p-juno", null)).toBeUndefined();
  });

  it("is found by title for a schedule, which has no address", () => {
    const schedule = {
      kind: "schedule",
      name: "nightly",
      title: "Nightly dependency check",
    } as const;
    const nightly = record({ url: null, title: "Nightly dependency check" });
    expect(recordOf(schedule, "p-juno", [nightly])?.id).toBe("task-12");
  });
});

describe("a task's time and cost in words", () => {
  it.each([
    [0, "<1m"],
    [59_000, "<1m"],
    [12 * 60_000 + 30_000, "12m"],
    [64 * 60_000, "1h 04m"],
  ])("%d ms worked reads %s", (ms, words) => {
    expect(workedWords(ms)).toBe(words);
  });

  it.each([
    [0, "$0.00"],
    [0.004, "<$0.01"],
    [0.42, "$0.42"],
    [6.437, "$6.44"],
  ])("$%d spent reads %s", (usd, words) => {
    expect(spentWords(usd)).toBe(words);
  });
});
