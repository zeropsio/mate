import type { HqAppTask } from "@t3tools/shared/hqIntake";
import type { HqNavigationMateTask } from "@t3tools/shared/hqStream";
import { describe, expect, it } from "vite-plus/test";

import { recordOf, spentWords, taskSession, type TaskSessionInput } from "./taskSession.logic";
import { workedWords } from "./taskStatus";

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
  taskId: "task-12",
  current: undefined,
  working: false,
  record: undefined,
  canStop: true,
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
    [
      "live with its Mate at rest between runs is still working",
      input({ current: onIt, record: record({ state: "working", change: null }) }),
      "working",
    ],
    [
      "live with its Mate at rest, before the board is read, is still working",
      input({ current: onIt }),
      "working",
    ],
    [
      "just handed to its Mate is starting",
      input({ current: onIt, record: record({ state: "assigned", change: null }) }),
      "starting",
    ],
    [
      "done with its change open and no pull request is up for review",
      input({ current: onIt, record: record() }),
      "review",
    ],
    [
      "a stop HQ took is stopping, though its Mate still works",
      input({ current: { ...onIt, stopping: true }, working: true }),
      "stopping",
    ],
    [
      "a stop HQ's record took is stopping, though navigation still says it waits",
      input({ current: { ...onIt, waiting: true }, record: record({ state: "stopping" }) }),
      "stopping",
    ],
    [
      "a stopping task's record is stopping",
      input({ current: null, record: record({ state: "stopping" }) }),
      "stopping",
    ],
    [
      "a closed change's record is closed",
      input({ current: null, record: record({ state: "closed" }) }),
      "closed",
    ],
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
      "finished by its Mate, as HQ says, is up for review, even while its Mate works on",
      input({ current: { ...onIt, done: true }, working: true }),
      "review",
    ],
    [
      "finished by its Mate with its pull request merged is merged",
      input({ current: { ...onIt, done: true, pullRequest: { ...prOpen, state: "merged" } } }),
      "merged",
    ],
    [
      "stopped by the person, before HQ's answer shows, is stopping",
      input({ current: onIt, working: true, stop: { kind: "working", verb: "task-stop" } }),
      "stopping",
    ],
    [
      "yesterday's run of a schedule says its own record, never today's run of the same title",
      input({
        source: { kind: "schedule", name: "Nightly", title: "Nightly dependency check" },
        taskId: "task-9",
        current: { id: "task-12", title: "Nightly dependency check", url: null },
        working: true,
        record: record({ id: "task-9", state: "merged" }),
      }),
      "merged",
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

  it("can be stopped by an Owner or Admin while queued, at work or waiting, and once only", () => {
    expect(taskSession(input({ current: onIt, working: true }))).toMatchObject({
      stoppable: true,
      taskId: "task-12",
    });
    expect(taskSession(input({ current: { ...onIt, waiting: true } })).stoppable).toBe(true);
    expect(
      taskSession(input({ current: null, record: record({ state: "queued" }) })).stoppable,
    ).toBe(true);
    expect(taskSession(input({ current: onIt, record: record() })).stoppable).toBe(false);
    expect(
      taskSession(
        input({ current: onIt, working: true, stop: { kind: "working", verb: "task-stop" } }),
      ).stoppable,
    ).toBe(false);
    expect(taskSession(input({ current: { ...onIt, stopping: true } })).stoppable).toBe(false);
    expect(taskSession(input({ current: { ...onIt, ended: "failed" } })).stoppable).toBe(false);
    expect(taskSession(input({ current: onIt, working: true, canStop: false })).stoppable).toBe(
      false,
    );
  });

  it("offers no Stop for a task its Mate finished, whose change waits for review", () => {
    expect(taskSession(input({ current: { ...onIt, done: true }, working: true })).stoppable).toBe(
      false,
    );
  });

  it("stops the conversation's own task, never the run its Mate is on now", () => {
    const today = { id: "task-12", title: "Nightly dependency check", url: null };
    const session = taskSession(
      input({
        source: { kind: "schedule", name: "Nightly", title: "Nightly dependency check" },
        taskId: "task-9",
        current: today,
        working: true,
        record: record({ id: "task-9", state: "working", change: null }),
      }),
    );
    expect(session).toMatchObject({ taskId: "task-9", status: "working", stoppable: true });
  });
});

describe("a task's record on its application's board", () => {
  it("is the record of the conversation's own task, by HQ's id", () => {
    const earlier = record({ id: "task-9", createdAt: "2026-10-16T10:00:00.000Z" });
    const latest = record({ id: "task-12" });
    expect(recordOf("task-9", [earlier, latest])?.id).toBe("task-9");
  });

  it("is none where the board holds no task by its id, or is not read", () => {
    expect(recordOf("task-12", [record({ id: "task-13" })])).toBeUndefined();
    expect(recordOf("task-12", null)).toBeUndefined();
    expect(recordOf(null, [record()])).toBeUndefined();
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
