/** Divide a host's test workers between concurrent jobs; an unset budget keeps Vitest's default. */
export function testWorkerBudget(jobs: string | undefined, cores: number): number | undefined {
  if (jobs === undefined) return undefined;
  const count = Number(jobs);
  if (!Number.isSafeInteger(count) || count < 1)
    throw new Error("MATE_TEST_JOBS must be a positive integer");
  // Leave one core for the runner, transforms and build tools, as Vitest does by default.
  return Math.max(1, Math.floor(Math.max(1, cores - 1) / count));
}
