import type { HqAppTask, HqTaskLimitsView } from "@t3tools/shared/hqIntake";
import { describe, expect, it } from "vite-plus/test";

import {
  RECENT_SHOWN,
  boardOf,
  costWords,
  poolLine,
  predictedBoard,
  spendLine,
  taskRoute,
} from "./taskBoard.logic";

const NOW = Date.parse("2026-10-18T12:00:00.000Z");

const task = (patch: Partial<HqAppTask> & Pick<HqAppTask, "id" | "state">): HqAppTask => ({
  title: `Task ${patch.id}`,
  label: `acme/tea-shop#${patch.id}`,
  url: `https://github.com/acme/tea-shop/issues/${patch.id}`,
  mate: { projectId: "P_JUNO", name: "Juno" },
  requestedBy: "nova",
  createdAt: "2026-10-18T11:00:00.000Z",
  startedAt: null,
  endedAt: null,
  spentUsd: null,
  workedMs: null,
  detail: null,
  change: null,
  pullRequest: null,
  link: null,
  ...patch,
});

describe("an application's task board", () => {
  it("puts what its Mates are on at work, what waits in the queue by its place, and what ended in recent", () => {
    const board = boardOf(
      [
        task({
          id: "2",
          state: "queued",
          position: 1,
          mate: null,
          createdAt: "2026-10-18T11:56:00.000Z",
        }),
        task({ id: "3", state: "queued", position: 2, mate: null }),
        task({
          id: "1",
          state: "working",
          startedAt: "2026-10-18T11:48:00.000Z",
          spentUsd: 0.42,
          workedMs: 9 * 60_000,
        }),
        task({ id: "0", state: "merged", endedAt: "2026-10-18T08:00:00.000Z", spentUsd: 0.31 }),
      ],
      NOW,
    );
    expect(board.atWork).toEqual([
      expect.objectContaining({
        id: "1",
        status: "working",
        worked: "9m",
        cost: "$0.42",
      }),
    ]);
    expect(board.queued).toEqual([
      expect.objectContaining({ id: "2", position: 1, source: "acme/tea-shop#2", waited: "4m" }),
      expect.objectContaining({ id: "3", position: 2, waited: "1h" }),
    ]);
    expect(board.recent).toEqual([
      expect.objectContaining({
        id: "0",
        outcome: "merged",
        mate: "Juno",
        when: "4h ago",
        cost: "$0.31",
      }),
    ]);
  });

  it.each([
    ["assigned", "starting"],
    ["working", "working"],
    ["waiting", "waiting"],
    ["stopping", "stopping"],
  ] as const)("a task %s is at work, %s", (state, status) => {
    expect(boardOf([task({ id: "1", state })], NOW).atWork[0]?.status).toBe(status);
  });

  it.each([
    ["done", "done"],
    ["merged", "merged"],
    ["closed", "closed"],
    ["failed", "failed"],
    ["stopped", "stopped"],
    ["declined", "declined"],
  ] as const)("a task that ended %s says so, and when it ended", (state, status) => {
    const ended = task({ id: "1", state, endedAt: "2026-10-18T11:00:00.000Z" });
    expect(boardOf([ended], NOW).recent[0]).toMatchObject({ outcome: status, when: "1h ago" });
  });

  it("takes a live task's cost, time and state from navigation, which says each report", () => {
    const working = task({ id: "1", state: "working", spentUsd: 0.1, workedMs: 60_000 });
    const live = new Map([
      ["1", { id: "1", title: "Task 1", url: null, spentUsd: 0.9, workedMs: 15 * 60_000 }],
    ]);
    expect(boardOf([working], NOW, "app-1", live).atWork[0]).toMatchObject({
      worked: "15m",
      cost: "$0.90",
      status: "working",
    });
    const stopping = new Map([
      ["1", { id: "1", title: "Task 1", url: null, stopping: true as const }],
    ]);
    expect(boardOf([working], NOW, "app-1", stopping).atWork[0]?.status).toBe("stopping");
  });

  it("says a Mate whose last change waits for review is held by it, never that it waits for a task", () => {
    const done = task({
      id: "1",
      state: "done",
      endedAt: "2026-10-18T11:00:00.000Z",
      change: { repo: "web", number: 3 },
    });
    const live = new Map([["1", { id: "1", title: "Task 1", url: null }]]);
    expect(boardOf([done], NOW, "app-1", live).blocked).toEqual([
      {
        projectId: "P_JUNO",
        change: { label: "Change #3", href: "/change/app-1/web/3", external: false },
      },
    ]);
    expect(boardOf([done], NOW, "app-1").blocked).toEqual([]);
  });

  it("links an ended task's pull request on GitHub, else its change in Mate", () => {
    const board = boardOf(
      [
        task({
          id: "1",
          state: "merged",
          endedAt: "2026-10-18T11:00:00.000Z",
          change: { repo: "web", number: 3 },
          pullRequest: { number: 2, url: "https://github.com/acme/tea-shop/pull/2" },
        }),
        task({
          id: "2",
          state: "done",
          endedAt: "2026-10-18T10:00:00.000Z",
          change: { repo: "web", number: 4 },
        }),
        task({ id: "3", state: "failed", endedAt: "2026-10-18T09:00:00.000Z" }),
      ],
      NOW,
      "app-1",
    );
    expect(board.recent.map((row) => row.change)).toEqual([
      { label: "PR #2", href: "https://github.com/acme/tea-shop/pull/2", external: true },
      { label: "Change #4", href: "/change/app-1/web/4", external: false },
      null,
    ]);
    // Done with its change still open: it waits for someone's review.
    expect(board.recent[1]?.outcome).toBe("review");
  });

  it(`lists the latest ${String(RECENT_SHOWN)} that ended, and says how many more there are`, () => {
    const ended = Array.from({ length: RECENT_SHOWN + 3 }, (_, at) =>
      task({ id: String(at), state: "done", endedAt: "2026-10-18T10:00:00.000Z" }),
    );
    const board = boardOf(ended, NOW);
    expect(board.recent).toHaveLength(RECENT_SHOWN);
    expect(board.recentMore).toBe(3);
  });

  it.each([
    [null, "—"],
    [0, "$0.00"],
    [0.004, "<$0.01"],
    [0.42, "$0.42"],
    [6.444, "$6.44"],
    [1234.5, "$1,234.50"],
  ] as const)("says a cost of %s as %s", (usd, words) => {
    expect(costWords(usd)).toBe(words);
  });

  it("opens a task's conversation inside Mate, wherever its link was made for", () => {
    expect(taskRoute("https://mate.zerops.io/env-1/conversation-1")).toBe("/env-1/conversation-1");
    expect(taskRoute("https://mate.zerops.io/mate/P_JUNO")).toBe("/mate/P_JUNO");
    expect(taskRoute(null)).toBeNull();
    expect(taskRoute("https://elsewhere.example/x")).toBeNull();
  });
});

describe("the board's rows while it reads", () => {
  it("holds a row per Mate on a live task, one line for those free, the queue, and what ended", () => {
    const on = { id: "1", title: "Task 1", url: null };
    const over = { id: "2", title: "Task 2", url: null, ended: "merged" as const };
    expect(predictedBoard([on, on, over, null], 3)).toEqual({ atWork: 3, queued: 3, recent: 1 });
    expect(predictedBoard([], 0)).toEqual({ atWork: 1, queued: 1, recent: 1 });
    const many = Array.from({ length: 8 }, () => over);
    expect(predictedBoard(many, 0).recent).toBe(RECENT_SHOWN);
  });
});

describe("the pool's line", () => {
  it.each([
    [[], "No automated Mates yet"],
    [["Juno"], "Juno · 1 automated Mate"],
    [["Raya", "Ines"], "Raya, Ines · 2 automated Mates"],
    [["Raya", "Ines", "Juno", "Nova"], "Raya, Ines, Juno +1 · 4 automated Mates"],
  ] as const)("names %j as %s", (names, words) => {
    expect(poolLine(names)).toBe(words);
  });

  it.each([
    [{ minutes: 60, costUsd: null }, null],
    [
      { minutes: 60, costUsd: null, monthlyBudgetUsd: null, spentThisMonthUsd: 6.44 },
      "$6.44 this month",
    ],
    [
      { minutes: 60, costUsd: null, monthlyBudgetUsd: 50, spentThisMonthUsd: 6.44 },
      "$6.44 of $50 this month",
    ],
    [
      { minutes: 60, costUsd: null, monthlyBudgetUsd: 50, spentThisMonthUsd: 50 },
      "$50.00 of $50 this month · spent",
    ],
  ] as const)("says the month's spend from %j as %s", (limits, words) => {
    expect(spendLine(limits as HqTaskLimitsView)).toBe(words);
  });
});
