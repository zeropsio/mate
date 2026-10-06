// Failure ceilings, not sleeps: local conditions get 2 s; a whole scenario (including its
// receipts) gets 10 s. Protocol timers add their actual delay to the condition bound.
export const scenarioPolicy = { conditionMs: 2_000, testMs: 10_000 } as const;
