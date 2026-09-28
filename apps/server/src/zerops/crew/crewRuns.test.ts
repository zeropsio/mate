import { describe, expect, it } from "@effect/vitest";

import { resumeRefusal, runLimitReached, type RunLimitFacts } from "./crewRuns.ts";

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

describe("resumeRefusal", () => {
  it.each<[string, Partial<RunLimitFacts>, string | undefined]>([
    ["limits with room left", {}, undefined],
    [
      "the budget still spent",
      { budgetUsd: 3, spentUsd: 3.14 },
      "The run has spent its $3 budget — raise it or choose No limit to resume",
    ],
    [
      "a raised budget no higher than the spend",
      { budgetUsd: 3.1, spentUsd: 3.14 },
      "The run has spent its $3.10 budget — raise it or choose No limit to resume",
    ],
    ["No limit on a spent run", { budgetUsd: null, spentUsd: 3.14 }, undefined],
    [
      "the time limit still used up",
      { elapsedMs: 8 * HOUR },
      "The run has used its 8 h — raise the time limit or choose No limit to resume",
    ],
    [
      "the usage window still at the stop",
      { usagePercent: 85 },
      "The usage window is at 85 % — raise the stop or turn it off to resume",
    ],
  ])("%s", (_, overrides, expected) => {
    expect(resumeRefusal(facts(overrides))).toBe(expected);
  });
});
