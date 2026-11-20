import { describe, expect, it } from "vite-plus/test";

import {
  INITIAL_BACKOFF,
  RETRY_RUNGS_MS,
  backoffOn,
  scheduleRetry,
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
