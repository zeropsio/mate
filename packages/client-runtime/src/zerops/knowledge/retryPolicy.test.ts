import { describe, expect, it } from "vite-plus/test";

import {
  GRANT_RETRY_LADDERS,
  INITIAL_BACKOFF,
  RECOVERY_CAP_MS,
  RECOVERY_FIRST_MS,
  RETRY_RUNGS_MS,
  backoffOn,
  doublingLadder,
  onLastRung,
  rungMs,
  scheduleRetry,
  soonerJittered,
  type Backoff,
  type RetryTrigger,
} from "./retryPolicy.ts";

const NOW = 1_000_000;
const MIDPOINT = () => 0.5;

/** The backoff after `failures` scheduled retries from the first rung. */
const afterFailures = (failures: number): Backoff => {
  let backoff = INITIAL_BACKOFF;
  for (let failure = 0; failure < failures; failure += 1) {
    backoff = scheduleRetry(backoff, NOW, MIDPOINT).backoff;
  }
  return backoff;
};

describe("retry policy (DESIGN §4.0)", () => {
  it("climbs the rungs 2, 4, 8, 15, 30, 60 s and stays on the last", () => {
    const delays: Array<number> = [];
    let backoff = INITIAL_BACKOFF;
    for (let failure = 0; failure < 8; failure += 1) {
      const scheduled = scheduleRetry(backoff, NOW, MIDPOINT);
      delays.push(scheduled.retryAtMs - NOW);
      backoff = scheduled.backoff;
    }
    expect(RETRY_RUNGS_MS).toEqual([2_000, 4_000, 8_000, 15_000, 30_000, 60_000]);
    expect(delays).toEqual([2_000, 4_000, 8_000, 15_000, 30_000, 60_000, 60_000, 60_000]);
  });

  it.each([
    { name: "the lowest random value", random: 0, factor: 0.8 },
    { name: "the midpoint", random: 0.5, factor: 1 },
    { name: "the highest random value", random: 0.999_999, factor: 1.2 },
  ])("jitters every rung within ±20 % ($name)", ({ random, factor }) => {
    RETRY_RUNGS_MS.forEach((rungMs, rung) => {
      const delay = scheduleRetry({ rung }, NOW, () => random).retryAtMs - NOW;
      expect(delay).toBeGreaterThanOrEqual(Math.floor(rungMs * 0.8));
      expect(delay).toBeLessThanOrEqual(Math.ceil(rungMs * 1.2));
      expect(Math.abs(delay - rungMs * factor)).toBeLessThanOrEqual(1);
    });
  });

  it.each<{ readonly trigger: RetryTrigger; readonly resets: boolean }>([
    { trigger: "visible-wake", resets: true },
    { trigger: "online", resets: true },
    { trigger: "user-retry", resets: true },
    { trigger: "input-change", resets: true },
    { trigger: "retry-at-reached", resets: false },
    { trigger: "invalidation", resets: false },
    { trigger: "prerequisite-arrived", resets: false },
  ])("$trigger resets to the first rung: $resets", ({ trigger, resets }) => {
    const climbed = afterFailures(4);
    const next = backoffOn(climbed, trigger);
    expect(next).toEqual(resets ? INITIAL_BACKOFF : climbed);
    expect(scheduleRetry(next, NOW, MIDPOINT).retryAtMs - NOW).toBe(resets ? 2_000 : 30_000);
  });
});

// Every machine retries on one shape: a ladder of waits whose last rung repeats — bounded in rate,
// not in count (2026-10-05).
describe("retry ladders", () => {
  it("waits each failure's rung, and the last rung from then on", () => {
    const ladder = [1_000, 2_000, 5_000];
    expect([0, 1, 2, 3, 4, 9].map((failures) => rungMs(ladder, failures))).toEqual([
      1_000, 1_000, 2_000, 5_000, 5_000, 5_000,
    ]);
    expect([2, 3, 4].map((failures) => onLastRung(ladder, failures))).toEqual([false, true, true]);
  });

  it.each([
    { firstMs: 1_000, capMs: 30_000, rungs: 3, want: [1_000, 2_000, 30_000] },
    { firstMs: 1_000, capMs: 30_000, rungs: 6, want: [1_000, 2_000, 4_000, 8_000, 16_000, 30_000] },
    { firstMs: 100, capMs: 1_000, rungs: 6, want: [100, 200, 400, 800, 1_000, 1_000] },
    { firstMs: 10, capMs: 10, rungs: 2, want: [10, 10] },
    { firstMs: 1_000, capMs: 30_000, rungs: 1, want: [30_000] },
  ])("doubles from $firstMs to $capMs in $rungs rungs", ({ firstMs, capMs, rungs, want }) => {
    expect(doublingLadder(firstMs, capMs, rungs)).toEqual(want);
  });

  it("comes up to a fifth sooner, never later", () => {
    expect([0, 0.5, 1].map((random) => soonerJittered(10_000, random))).toEqual([
      10_000, 9_000, 8_000,
    ]);
  });

  it("names the access grant's ladders and the data runtime's recovery", () => {
    const seconds = (...values: ReadonlyArray<number>) => values.map((value) => value * 1_000);
    expect(GRANT_RETRY_LADDERS).toEqual({
      initial: RETRY_RUNGS_MS,
      renewal: seconds(10, 20, 40, 60),
      lapsed: seconds(2, 5, 15, 30, 60),
      project: seconds(10, 20, 40, 60),
    });
    expect([RECOVERY_FIRST_MS, RECOVERY_CAP_MS]).toEqual([1_000, 30_000]);
  });
});
