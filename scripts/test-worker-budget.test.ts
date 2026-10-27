import { expect, it } from "vite-plus/test";
import { testWorkerBudget } from "./lib/test-worker-budget.ts";

it("keeps the default unless a host concurrency budget is requested", () => {
  expect(testWorkerBudget(undefined, 18)).toBeUndefined();
  expect(testWorkerBudget("1", 18)).toBe(17);
});

it("shares CPU capacity across lanes without disabling tests on a small host", () => {
  expect(testWorkerBudget("8", 18)).toBe(2);
  expect(testWorkerBudget("8", 2)).toBe(1);
  expect(testWorkerBudget("1", 1)).toBe(1);
});

it.each(["", "0", "-1", "2.5", "eight", "Infinity"])("rejects invalid job budgets: %j", (jobs) => {
  expect(() => testWorkerBudget(jobs, 18)).toThrow("MATE_TEST_JOBS must be a positive integer");
});
