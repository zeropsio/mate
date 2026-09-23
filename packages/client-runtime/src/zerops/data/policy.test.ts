import { describe, expect, it } from "@effect/vitest";
import {
  DEFAULT_ZEROPS_DATA_POLICY,
  DEFAULT_ZEROPS_GRANT_POLICY,
  makeZeropsDataPolicy,
  renewalLeadMs,
  roundDeadlineMs,
} from "./policy.ts";

describe("Zerops data runtime policy", () => {
  it("keeps every queue, retry, retention and deadline budget finite", () => {
    for (const value of Object.values(DEFAULT_ZEROPS_DATA_POLICY)) {
      expect(Number.isSafeInteger(value)).toBe(true);
      expect(value).toBeGreaterThan(0);
    }
    expect(DEFAULT_ZEROPS_DATA_POLICY.pongDeadlineMs).toBeLessThan(
      DEFAULT_ZEROPS_DATA_POLICY.heartbeatIntervalMs,
    );
    expect(DEFAULT_ZEROPS_DATA_POLICY.ingressMaxFrameBytes).toBeLessThanOrEqual(
      DEFAULT_ZEROPS_DATA_POLICY.ingressMaxBytesPerAccount,
    );
    expect(DEFAULT_ZEROPS_DATA_POLICY.desiredInterestsPerReceiver).toBeLessThanOrEqual(
      DEFAULT_ZEROPS_DATA_POLICY.registrationAttemptsPerReceiver,
    );
  });

  it("retains the proven HTTP and heartbeat deadlines", () => {
    expect(DEFAULT_ZEROPS_DATA_POLICY.httpDeadlineMs).toBe(15_000);
    expect(DEFAULT_ZEROPS_DATA_POLICY.heartbeatIntervalMs).toBe(15_000);
    expect(DEFAULT_ZEROPS_DATA_POLICY.pongDeadlineMs).toBe(8_000);
  });

  it("bounds establishment and background receiver lifetime", () => {
    expect(DEFAULT_ZEROPS_DATA_POLICY.hiddenReceiverPauseAfterMs).toBe(60_000);
    expect(DEFAULT_ZEROPS_DATA_POLICY.establishmentDeadlineMs).toBe(60_000);
  });

  it("bounds account-wide entity, telemetry, history and log retention", () => {
    expect(DEFAULT_ZEROPS_DATA_POLICY.retainedTerminalProcessesPerProject).toBe(500);
    expect(DEFAULT_ZEROPS_DATA_POLICY.retainedTerminalProcessesPerAccount).toBe(2_000);
    expect(DEFAULT_ZEROPS_DATA_POLICY.retainedCurrentMetricSamplesPerAccount).toBe(10_000);
    expect(DEFAULT_ZEROPS_DATA_POLICY.retainedHistoryBucketsPerSeries).toBe(720);
    expect(DEFAULT_ZEROPS_DATA_POLICY.activeHistorySeriesPerAccount).toBe(128);
    expect(DEFAULT_ZEROPS_DATA_POLICY.logBackfillLines).toBe(500);
    expect(DEFAULT_ZEROPS_DATA_POLICY.logPublishBatchLines).toBe(100);
    expect(DEFAULT_ZEROPS_DATA_POLICY.retainedLogLinesPerSession).toBe(2_000);
    expect(DEFAULT_ZEROPS_DATA_POLICY.receiversPerAccount).toBe(16);
    expect(DEFAULT_ZEROPS_DATA_POLICY.activeQueriesPerAccount).toBe(512);
    expect(DEFAULT_ZEROPS_DATA_POLICY.queuedReadRequestsPerAccount).toBe(1_024);
    expect(DEFAULT_ZEROPS_DATA_POLICY.retainedCompletedReadsPerAccount).toBe(2_048);
    expect(DEFAULT_ZEROPS_DATA_POLICY.queuedCommandRequestsPerAccount).toBe(128);
    expect(DEFAULT_ZEROPS_DATA_POLICY.retainedCommandAttemptsPerAccount).toBe(1_000);
  });

  it("accepts bounded overrides and rejects contradictory limits", () => {
    expect(makeZeropsDataPolicy({ hydrationConcurrency: 2 }).hydrationConcurrency).toBe(2);
    expect(() => makeZeropsDataPolicy({ recoveryAttemptLimit: 0 })).toThrow(
      "recoveryAttemptLimit must be a positive safe integer",
    );
    expect(() =>
      makeZeropsDataPolicy({ ingressMaxBytesPerAccount: 10, ingressMaxFrameBytes: 11 }),
    ).toThrow("ingressMaxFrameBytes cannot exceed ingressMaxBytesPerAccount");
    expect(() =>
      makeZeropsDataPolicy({
        desiredInterestsPerReceiver: 5,
        registrationAttemptsPerReceiver: 4,
      }),
    ).toThrow("desiredInterestsPerReceiver cannot exceed registrationAttemptsPerReceiver");
  });
});

describe("Zerops access grant policy", () => {
  const MINUTE = 60_000;
  const SECOND = 1_000;

  it("renews at start + 12 min while rounds stay typical, never with less than a 3 min lead (G13, D5)", () => {
    for (const p95RoundMs of [0, 2 * SECOND, 30 * SECOND, 90 * SECOND]) {
      expect(renewalLeadMs(DEFAULT_ZEROPS_GRANT_POLICY, p95RoundMs)).toBe(3 * MINUTE);
    }
    expect(
      DEFAULT_ZEROPS_GRANT_POLICY.windowMs - renewalLeadMs(DEFAULT_ZEROPS_GRANT_POLICY, 0),
    ).toBe(12 * MINUTE);
  });

  it("widens the lead past the floor once a slow round no longer fits inside it (G13)", () => {
    // 60 s hidden-timer alignment + the round itself + 30 s for one retry.
    expect(renewalLeadMs(DEFAULT_ZEROPS_GRANT_POLICY, 100 * SECOND)).toBe(190 * SECOND);
    expect(renewalLeadMs(DEFAULT_ZEROPS_GRANT_POLICY, 5 * MINUTE)).toBe(6 * MINUTE + 30 * SECOND);
  });

  it.each([
    [0, 30 * SECOND],
    [1, 45 * SECOND],
    [4, 45 * SECOND],
    [5, 60 * SECOND],
    [8, 60 * SECOND],
    [40, 180 * SECOND],
  ])("gives a round of %i projects %i ms: 30 s plus 15 s per batch of 4 (G7)", (projects, ms) => {
    expect(roundDeadlineMs(DEFAULT_ZEROPS_GRANT_POLICY, projects)).toBe(ms);
  });

  it("names every grant ladder of §4.2 and keeps each rung inside the access window", () => {
    expect(DEFAULT_ZEROPS_GRANT_POLICY.windowMs).toBe(15 * MINUTE);
    expect(DEFAULT_ZEROPS_GRANT_POLICY.dormantAfterHiddenMs).toBe(60 * MINUTE);
    expect(DEFAULT_ZEROPS_GRANT_POLICY.wallJumpBackToleranceMs).toBe(60 * SECOND);
    expect(DEFAULT_ZEROPS_GRANT_POLICY.denialConfirmationDelayMs).toBe(5 * SECOND);
    expect(DEFAULT_ZEROPS_GRANT_POLICY.initialRetryMs).toEqual(
      [2, 4, 8, 15, 30, 60].map((s) => s * SECOND),
    );
    expect(DEFAULT_ZEROPS_GRANT_POLICY.renewalRetryMs).toEqual(
      [10, 20, 40, 60].map((s) => s * SECOND),
    );
    expect(DEFAULT_ZEROPS_GRANT_POLICY.lapsedRetryMs).toEqual(
      [2, 5, 15, 30, 60].map((s) => s * SECOND),
    );
    expect(DEFAULT_ZEROPS_GRANT_POLICY.projectRetryMs).toEqual(
      [10, 20, 40, 60].map((s) => s * SECOND),
    );
    for (const ladder of [
      DEFAULT_ZEROPS_GRANT_POLICY.initialRetryMs,
      DEFAULT_ZEROPS_GRANT_POLICY.renewalRetryMs,
      DEFAULT_ZEROPS_GRANT_POLICY.lapsedRetryMs,
      DEFAULT_ZEROPS_GRANT_POLICY.projectRetryMs,
    ]) {
      expect(ladder.length).toBeGreaterThan(0);
      for (const rung of ladder) {
        expect(rung).toBeGreaterThan(0);
        expect(rung).toBeLessThan(DEFAULT_ZEROPS_GRANT_POLICY.windowMs);
      }
    }
  });
});
