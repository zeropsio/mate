import { describe, expect, it } from "@effect/vitest";

import { runLimitReached, type RunLimitFacts } from "./crewRuns.ts";

const HOUR = 3_600_000;

const facts = (overrides: Partial<RunLimitFacts> = {}): RunLimitFacts => ({
  budgetUsd: 10,
  spentUsd: 2,
  elapsedMs: HOUR,
  timeLimitHours: 8,
  usagePercent: 40,
  stopAtUsagePercent: 80,
  ...overrides,
});

describe("runLimitReached", () => {
  it.each<[string, Partial<RunLimitFacts>, ReturnType<typeof runLimitReached>]>([
    ["every meter under its limit", {}, undefined],
    ["the spend at the budget", { spentUsd: 10 }, "budget"],
    [
      "No limit on the budget, however much is spent",
      { budgetUsd: null, spentUsd: 500 },
      undefined,
    ],
    ["the time limit", { elapsedMs: 8 * HOUR }, "time"],
    ["No limit on time", { timeLimitHours: "unlimited", elapsedMs: 80 * HOUR }, undefined],
    ["the usage window at the stop", { usagePercent: 80 }, "usage"],
    ["the usage stop off", { stopAtUsagePercent: null, usagePercent: 99 }, undefined],
    ["no usage reading", { usagePercent: null }, undefined],
    ["the budget first when several are reached", { spentUsd: 11, usagePercent: 95 }, "budget"],
  ])("%s", (_, overrides, expected) => {
    expect(runLimitReached(facts(overrides))).toBe(expected);
  });
});
