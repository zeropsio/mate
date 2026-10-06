// Failure ceilings, not sleeps: local conditions get 2 s; a whole scenario (including its
// receipts) gets 10 s. Each additional page needs its own boot receipt; protocol timers add their
// actual delay to the condition bound. These ceilings do not delay a passing step.
export const scenarioPolicy = { conditionMs: 2_000, testMs: 10_000 } as const;

export const scenarioTimeout = (pages: number) =>
  scenarioPolicy.testMs + (pages - 1) * scenarioPolicy.conditionMs;
