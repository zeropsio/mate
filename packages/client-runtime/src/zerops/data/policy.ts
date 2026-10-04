export interface ZeropsDataPolicy {
  readonly httpDeadlineMs: number;
  /** A command of several requests, between them all (`commandDeadlineMs`). */
  readonly commandDeadlineMs: number;
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
  /**
   * Registration requests in flight at once across the account, the organization inventory's
   * admitted first; a registration's deadline starts when it is sent, not while it waits.
   */
  readonly registrationConcurrency: number;
  readonly queuedReadRequestsPerAccount: number;
  readonly activeSharedReadsPerAccount: number;
  readonly retainedCompletedReadsPerAccount: number;
  readonly queuedCommandRequestsPerAccount: number;
  readonly retainedCommandAttemptsPerAccount: number;
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
  /**
   * How long a build log's stream stands open with no frame before it counts
   * as live: its first frame replays what was written since the backfill.
   */
  readonly logStreamSettleMs: number;
  readonly desiredInterestsPerReceiver: number;
  readonly activeInterestsPerAccount: number;
  readonly activeRegistrationsPerAccount: number;
  readonly registrationAttemptsPerReceiver: number;
  /**
   * Released subscriptions an organization's socket keeps on the wire before it is replaced: the
   * platform has no unsubscribe, so only a fresh socket stops their frames.
   */
  readonly releasedRegistrationsPerReceiver: number;
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
 * reducers must expose the state transition ("partial" or "failed")
 * before any policy-driven discard. The eviction rule per kind of
 * state — an inactive query is removed immediately after its last lease, a
 * completed read evicts its oldest diagnostic first, a terminal command
 * attempt evicts its oldest unreferenced attempt, pending work is never
 * evicted (new admission is rejected at capacity instead), and live data
 * marks the affected view partial or failed before any loss.
 */
export const DEFAULT_ZEROPS_DATA_POLICY: ZeropsDataPolicy = Object.freeze({
  httpDeadlineMs: 15_000,
  commandDeadlineMs: 60_000,
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
  registrationConcurrency: 6,
  queuedReadRequestsPerAccount: 1_024,
  activeSharedReadsPerAccount: 256,
  retainedCompletedReadsPerAccount: 2_048,
  queuedCommandRequestsPerAccount: 128,
  retainedCommandAttemptsPerAccount: 1_000,
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
  logStreamSettleMs: 1_000,
  desiredInterestsPerReceiver: 512,
  activeInterestsPerAccount: 512,
  activeRegistrationsPerAccount: 2_048,
  registrationAttemptsPerReceiver: 4_096,
  releasedRegistrationsPerReceiver: 256,
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

/**
 * The commands that make several requests: a container into a project — its services, the org's
 * keys (17 s measured on a 193-key org, cold), a key, then the container itself, all in `api.ts`.
 * One request's 15 s cannot hold them; main gave its commands a minute.
 */
const SEVERAL_REQUESTS: ReadonlySet<string> = new Set(["import-development-container"]);

/** How long a command of `kind` is given: a minute for one of several requests, else one's. */
export const commandDeadlineMs = (kind: string, policy: ZeropsDataPolicy): number =>
  SEVERAL_REQUESTS.has(kind) ? policy.commandDeadlineMs : policy.httpDeadlineMs;

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
  if (policy.desiredInterestsPerReceiver > policy.registrationAttemptsPerReceiver) {
    throw new RangeError(
      "desiredInterestsPerReceiver cannot exceed registrationAttemptsPerReceiver.",
    );
  }
  // A socket's registrations are its live ones plus those released on it before replacement.
  if (
    policy.activeRegistrationsPerAccount + policy.releasedRegistrationsPerReceiver >
    policy.registrationAttemptsPerReceiver
  ) {
    throw new RangeError(
      "activeRegistrationsPerAccount plus releasedRegistrationsPerReceiver cannot exceed registrationAttemptsPerReceiver.",
    );
  }
  return Object.freeze(policy);
}

/**
 * The access grant's clocks (DESIGN §4.2, D5). Evidence authorizes for `windowMs` from the
 * instant its round started, on both the wall and the monotonic clock. A failed read waits
 * for an explicit manual attempt.
 */
export interface ZeropsGrantPolicy {
  /** How long evidence authorizes after its round started (account-lifecycle 15 min window). */
  readonly windowMs: number;
  /** The renewal lead never drops below this (G13). */
  readonly renewalLeadFloorMs: number;
  /** A hidden tab's timer may fire this late: Chrome aligns throttled timers to 1-min buckets. */
  readonly hiddenTimerAlignmentMs: number;
  /** Room to show a failed renewal before the deadline. */
  readonly renewalSafetyMarginMs: number;
  /** How many admitted round durations feed the p95 of the renewal lead. */
  readonly roundDurationSamples: number;
  /** A tab hidden this long stops renewing; its grant lapses at its deadline (D5). */
  readonly dormantAfterHiddenMs: number;
  /** A round's deadline: this, plus `roundDeadlinePerBatchMs` per batch of projects (G7). */
  readonly roundDeadlineBaseMs: number;
  readonly roundDeadlinePerBatchMs: number;
  /** `fetchProject` reads a round runs at once (G1). */
  readonly roundProjectConcurrency: number;
  /** A backwards wall-clock jump beyond this lapses the grant (G5). */
  readonly wallJumpBackToleranceMs: number;
  /** A 403/404 removes content only after a direct read at least this much later agrees (G6). */
  readonly denialConfirmationDelayMs: number;
  /**
   * The epoch's first mount waits this long after its round started or ended before its wait
   * offers a way off (G10): a round that never answers, or data that never arrives.
   */
  readonly firstMountPatienceMs: number;
}

const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
export const DEFAULT_ZEROPS_GRANT_POLICY: ZeropsGrantPolicy = Object.freeze({
  windowMs: 15 * MINUTE_MS,
  renewalLeadFloorMs: 3 * MINUTE_MS,
  hiddenTimerAlignmentMs: 60 * SECOND_MS,
  renewalSafetyMarginMs: 30 * SECOND_MS,
  roundDurationSamples: 20,
  dormantAfterHiddenMs: 60 * MINUTE_MS,
  roundDeadlineBaseMs: 30 * SECOND_MS,
  roundDeadlinePerBatchMs: 15 * SECOND_MS,
  roundProjectConcurrency: 4,
  wallJumpBackToleranceMs: 60 * SECOND_MS,
  denialConfirmationDelayMs: 5 * SECOND_MS,
  firstMountPatienceMs: 20 * SECOND_MS,
});

/** G13: `max(floor, timer alignment + p95 round + safety margin)`. */
export const renewalLeadMs = (policy: ZeropsGrantPolicy, p95RoundMs: number): number =>
  Math.max(
    policy.renewalLeadFloorMs,
    policy.hiddenTimerAlignmentMs + p95RoundMs + policy.renewalSafetyMarginMs,
  );

/** G7: `30 s + 15 s × ⌈N / 4⌉` for a round over N projects. */
export const roundDeadlineMs = (policy: ZeropsGrantPolicy, projects: number): number =>
  policy.roundDeadlineBaseMs +
  policy.roundDeadlinePerBatchMs * Math.ceil(projects / policy.roundProjectConcurrency);
