import { describe, expect, it } from "@effect/vitest";
import { DEFAULT_ZEROPS_DATA_POLICY, makeZeropsDataPolicy } from "./policy.ts";

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
