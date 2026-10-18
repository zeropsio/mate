import type { HqAppTask, HqTaskLimitsView } from "@t3tools/shared/hqIntake";
import { describe, expect, it } from "vite-plus/test";

import {
  RECENT_SHOWN,
  boardOf,
  costWords,
  poolLine,
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
        }),
        task({ id: "0", state: "merged", endedAt: "2026-10-18T08:00:00.000Z", spentUsd: 0.31 }),
      ],
      NOW,
    );
    expect(board.atWork).toEqual([
      expect.objectContaining({
        id: "1",
        status: { word: "Working", tone: "working" },
        elapsed: "12m",
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
        outcome: { word: "Merged", tone: "merged" },
        mate: "Juno",
        when: "4h",
        cost: "$0.31",
      }),
    ]);
  });

  it.each([
    ["assigned", "Starting", "starting"],
    ["working", "Working", "working"],
    ["waiting", "Needs an answer", "waiting"],
  ] as const)("a task %s at work says %s", (state, word, tone) => {
    expect(boardOf([task({ id: "1", state })], NOW).atWork[0]?.status).toEqual({ word, tone });
  });

  it.each([
    ["done", "Done", "done"],
    ["merged", "Merged", "merged"],
    ["failed", "Failed", "failed"],
    ["stopped", "Stopped", "stopped"],
    ["declined", "Declined", "stopped"],
  ] as const)("a task that ended %s says %s", (state, word, tone) => {
    const ended = task({ id: "1", state, endedAt: "2026-10-18T11:00:00.000Z" });
    expect(boardOf([ended], NOW).recent[0]?.outcome).toEqual({ word, tone });
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
    expect(board.recent[1]?.outcome).toEqual({ word: "Up for review", tone: "review" });
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
