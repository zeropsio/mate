export interface ZeropsDataPolicy {
  readonly httpDeadlineMs: number;
  readonly socketTokenDeadlineMs: number;
  readonly socketOpenDeadlineMs: number;
  readonly socketGreetingDeadlineMs: number;
  readonly registrationDeadlineMs: number;
  readonly establishmentDeadlineMs: number;
  readonly heartbeatIntervalMs: number;
  readonly pongDeadlineMs: number;
  readonly ingressMaxEventsPerAccount: number;
  readonly ingressMaxBytesPerAccount: number;
  readonly ingressMaxFrameBytes: number;
  /** Bound reactive publications during a queued burst; receipts always flush immediately. */
  readonly ingressPublicationBatchEvents: number;
  readonly readConcurrency: number;
  readonly hydrationConcurrency: number;
  readonly queuedReadRequestsPerAccount: number;
  readonly activeSharedReadsPerAccount: number;
  readonly retainedCompletedReadsPerAccount: number;
  readonly queuedCommandRequestsPerAccount: number;
  readonly retainedCommandAttemptsPerAccount: number;
  readonly hydrationRetryLimit: number;
  readonly recoveryAttemptLimit: number;
  readonly recoveryBackoffStartMs: number;
  readonly recoveryBackoffMaxMs: number;
  readonly retainedProjectsPerAccount: number;
  readonly retainedServicesPerAccount: number;
  readonly retainedTerminalProcessesPerProject: number;
  readonly retainedTerminalProcessesPerAccount: number;
  readonly retainedNonTerminalProcessesPerAccount: number;
  readonly retainedCurrentMetricSamplesPerAccount: number;
  readonly retainedHistoryBucketsPerSeries: number;
  readonly activeHistorySeriesPerAccount: number;
  readonly logBackfillLines: number;
  readonly logPublishBatchLines: number;
  readonly retainedLogLinesPerSession: number;
  readonly retainedLogBytesPerSession: number;
  readonly activeLogSessionsPerAccount: number;
  readonly logPublicationCoalescingMs: number;
  readonly desiredInterestsPerReceiver: number;
  readonly activeInterestsPerAccount: number;
  readonly activeRegistrationsPerAccount: number;
  readonly registrationAttemptsPerReceiver: number;
  readonly receiversPerAccount: number;
  readonly activeQueriesPerAccount: number;
  readonly membershipMarkersPerQuery: number;
  readonly hiddenReceiverPauseAfterMs: number;
}

/**
 * Initial internal limits for the first integrated proof. They intentionally
 * preserve the existing 15s HTTP and 15s ping/8s pong behavior. Load tests may
 * tune these values without changing public observation semantics.
 *
 * Every one of these budgets is a capacity, never a silent-loss trigger:
 * reducers must expose the state transition ("partial", "recovering", or
 * "failed") before any policy-driven discard. The eviction rule per kind of
 * state — an inactive query is removed immediately after its last lease, a
 * completed read evicts its oldest diagnostic first, a terminal command
 * attempt evicts its oldest unreferenced attempt, pending work is never
 * evicted (new admission is rejected at capacity instead), and live data
 * marks the affected view partial or recovering before any loss.
 */
export const DEFAULT_ZEROPS_DATA_POLICY: ZeropsDataPolicy = Object.freeze({
  httpDeadlineMs: 15_000,
  socketTokenDeadlineMs: 15_000,
  socketOpenDeadlineMs: 10_000,
  socketGreetingDeadlineMs: 10_000,
  registrationDeadlineMs: 15_000,
  establishmentDeadlineMs: 60_000,
  heartbeatIntervalMs: 15_000,
  pongDeadlineMs: 8_000,
  ingressMaxEventsPerAccount: 2_048,
  ingressMaxBytesPerAccount: 8 * 1_024 * 1_024,
  ingressMaxFrameBytes: 1 * 1_024 * 1_024,
  readConcurrency: 8,
  hydrationConcurrency: 4,
  queuedReadRequestsPerAccount: 1_024,
  activeSharedReadsPerAccount: 256,
  retainedCompletedReadsPerAccount: 2_048,
  queuedCommandRequestsPerAccount: 128,
  retainedCommandAttemptsPerAccount: 1_000,
  hydrationRetryLimit: 3,
  recoveryAttemptLimit: 5,
  recoveryBackoffStartMs: 1_000,
  recoveryBackoffMaxMs: 30_000,
  retainedProjectsPerAccount: 10_000,
  retainedServicesPerAccount: 50_000,
  retainedTerminalProcessesPerProject: 500,
  retainedTerminalProcessesPerAccount: 2_000,
  retainedNonTerminalProcessesPerAccount: 10_000,
  retainedCurrentMetricSamplesPerAccount: 10_000,
  retainedHistoryBucketsPerSeries: 720,
  activeHistorySeriesPerAccount: 128,
  logBackfillLines: 500,
  logPublishBatchLines: 100,
  retainedLogLinesPerSession: 2_000,
  retainedLogBytesPerSession: 5 * 1_024 * 1_024,
  activeLogSessionsPerAccount: 32,
  logPublicationCoalescingMs: 100,
  desiredInterestsPerReceiver: 128,
  activeInterestsPerAccount: 512,
  activeRegistrationsPerAccount: 2_048,
  registrationAttemptsPerReceiver: 256,
  receiversPerAccount: 16,
  activeQueriesPerAccount: 512,
  membershipMarkersPerQuery: 2_048,
  ingressPublicationBatchEvents: 32,
  hiddenReceiverPauseAfterMs: 60_000,
});

function assertPositiveInteger(name: keyof ZeropsDataPolicy, value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer.`);
  }
}

export function makeZeropsDataPolicy(overrides: Partial<ZeropsDataPolicy> = {}): ZeropsDataPolicy {
  const policy = { ...DEFAULT_ZEROPS_DATA_POLICY, ...overrides };
  for (const [name, value] of Object.entries(policy) as ReadonlyArray<
    readonly [keyof ZeropsDataPolicy, number]
  >) {
    assertPositiveInteger(name, value);
  }
  if (policy.pongDeadlineMs >= policy.heartbeatIntervalMs) {
    throw new RangeError("pongDeadlineMs must be shorter than heartbeatIntervalMs.");
  }
  if (policy.ingressMaxFrameBytes > policy.ingressMaxBytesPerAccount) {
    throw new RangeError("ingressMaxFrameBytes cannot exceed ingressMaxBytesPerAccount.");
  }
  if (policy.recoveryBackoffStartMs > policy.recoveryBackoffMaxMs) {
    throw new RangeError("recoveryBackoffStartMs cannot exceed recoveryBackoffMaxMs.");
  }
  if (policy.desiredInterestsPerReceiver > policy.registrationAttemptsPerReceiver) {
    throw new RangeError(
      "desiredInterestsPerReceiver cannot exceed registrationAttemptsPerReceiver.",
    );
  }
  return Object.freeze(policy);
}
