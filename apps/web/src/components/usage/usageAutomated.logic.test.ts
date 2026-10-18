import type { HqAppTask } from "@t3tools/shared/hqIntake";
import { describe, expect, it } from "vite-plus/test";

import { automatedBudget, usageMateTasks, usageTaskTarget } from "./usageAutomated.logic";

const task = (change: Partial<HqAppTask>): HqAppTask => ({
  id: "task",
  title: "Add a search box to the tea list",
  label: "acme/tea-shop#1",
  url: "https://github.com/acme/tea-shop/issues/1",
  state: "merged",
  mate: { projectId: "tea-raya", name: "Raya" },
  requestedBy: "juno",
  createdAt: "2026-10-05T08:00:00.000Z",
  startedAt: "2026-10-05T08:01:00.000Z",
  endedAt: "2026-10-05T08:21:00.000Z",
  spentUsd: 1.25,
  workedMs: 1_200_000,
  detail: null,
  change: null,
  pullRequest: null,
  link: "https://mate.zerops.io/env-raya/thread-1",
  ...change,
});
const window = { since: "2026-10-01T00:00:00.000Z", until: "2026-10-08T00:00:00.000Z" };

describe("an automated Mate's tasks in Usage", () => {
  it("lists the Mate's tasks that worked in the period, newest first, with what each cost and how long it worked", () => {
    const rows = usageMateTasks({
      ...window,
      mateProjectId: "tea-raya",
      tasks: [
        task({ id: "older" }),
        task({
          id: "newer",
          title: "Show each tea's price",
          state: "working",
          startedAt: "2026-10-06T09:00:00.000Z",
          endedAt: null,
          spentUsd: 0.4,
          workedMs: 65_000,
        }),
        task({ id: "another-mate", mate: { projectId: "tea-ines", name: "Ines" } }),
        task({ id: "queued", state: "queued", startedAt: null, spentUsd: null, workedMs: null }),
        task({
          id: "before",
          startedAt: "2026-09-20T08:00:00.000Z",
          endedAt: "2026-09-20T09:00:00.000Z",
        }),
      ],
    });
    expect(rows).toEqual([
      {
        id: "newer",
        title: "Show each tea's price",
        target: { kind: "conversation", environmentId: "env-raya", threadId: "thread-1" },
        status: "working",
        state: "Working",
        cost: "$0.40",
        worked: "1m",
      },
      {
        id: "older",
        title: "Add a search box to the tea list",
        target: { kind: "conversation", environmentId: "env-raya", threadId: "thread-1" },
        status: "merged",
        state: "Merged",
        cost: "$1.25",
        worked: "20m",
      },
    ]);
  });
  it.each([
    ["assigned", "Starting"],
    ["waiting", "Waiting for you"],
    ["stopping", "Stopping"],
    ["closed", "Closed"],
    ["declined", "Not taken"],
  ] as const)("says a task %s in the words every surface uses: %s", (state, words) => {
    const [row] = usageMateTasks({
      ...window,
      mateProjectId: "tea-raya",
      tasks: [task({ state })],
    });
    expect(row?.state).toBe(words);
  });
  it("says nothing it does not know: a task its Mate never reported on shows no cost or time", () => {
    const [row] = usageMateTasks({
      ...window,
      mateProjectId: "tea-raya",
      tasks: [task({ spentUsd: null, workedMs: null, link: null })],
    });
    expect(row).toMatchObject({ cost: null, worked: null, target: null });
  });
  it("a task that ended in the period but started before it still counts", () => {
    expect(
      usageMateTasks({
        ...window,
        mateProjectId: "tea-raya",
        tasks: [
          task({ startedAt: "2026-09-30T23:00:00.000Z", endedAt: "2026-10-01T01:00:00.000Z" }),
        ],
      }),
    ).toHaveLength(1);
  });
});

describe("following a task from Usage", () => {
  it.each([
    {
      link: "https://mate.zerops.io/env-raya/thread-1",
      target: { kind: "conversation", environmentId: "env-raya", threadId: "thread-1" },
    },
    {
      link: "https://mate.zerops.io/mate/tea-raya",
      target: { kind: "mate", projectId: "tea-raya" },
    },
    {
      link: "https://github.com/acme/tea-shop/issues/1",
      target: { kind: "external", href: "https://github.com/acme/tea-shop/issues/1" },
    },
    { link: null, target: null },
  ])("$link opens where HQ links it, in this app where it can", ({ link, target }) =>
    expect(usageTaskTarget(link)).toEqual(target),
  );
});

describe("the month's automated spend against its budget", () => {
  it.each([
    { name: "no budget set says nothing", limits: { minutes: 30, costUsd: null }, line: null },
    {
      name: "an older HQ without a budget says nothing",
      limits: { minutes: 30, costUsd: 5, monthlyBudgetUsd: null, spentThisMonthUsd: 2 },
      line: null,
    },
    {
      name: "a budget shows this month's spend against it",
      limits: { minutes: 30, costUsd: 5, monthlyBudgetUsd: 50, spentThisMonthUsd: 6.44 },
      line: { spent: "$6.44", budget: "$50.00", share: 0.1288, reached: false },
    },
    {
      name: "a spent budget says so",
      limits: { minutes: 30, costUsd: 5, monthlyBudgetUsd: 50, spentThisMonthUsd: 52 },
      line: { spent: "$52.00", budget: "$50.00", share: 1, reached: true },
    },
  ])("$name", ({ limits, line }) => expect(automatedBudget(limits)).toEqual(line));
});
