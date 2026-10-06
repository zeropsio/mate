import { afterEach, expect, it, vi } from "vite-plus/test";
import type { Page } from "puppeteer-core";
import { boundPageWaits, waitBudget } from "../harness/waits.ts";
import { deadline } from "../harness/http.ts";
import { scenarioPolicy } from "../harness/policy.ts";

afterEach(() => vi.useRealTimers());
it("a missing receipt fails with its name at the condition deadline", async () => {
  vi.useFakeTimers();
  const result = deadline(new Promise<void>(() => {}), "Ada first RPC");
  const rejected = expect(result).rejects.toThrow("Timed out: Ada first RPC");
  await vi.advanceTimersByTimeAsync(scenarioPolicy.conditionMs);
  await rejected;
  expect(vi.getTimerCount()).toBe(0);
});
it("clears the deadline when the receipt arrives", async () => {
  vi.useFakeTimers();
  await expect(deadline(Promise.resolve("receipt"), "response body")).resolves.toBe("receipt");
  expect(vi.getTimerCount()).toBe(0);
});
it("derives a protocol wait from its delay and the live remaining test budget", () => {
  const plain = waitBudget();
  expect(waitBudget(500)).toBeGreaterThan(plain);
  expect(waitBudget(Infinity)).toBeLessThanOrEqual(scenarioPolicy.testMs);
});
it("a missing DOM condition reports the predicate and its arguments", async () => {
  const wait = vi.fn().mockRejectedValue(new Error("puppeteer timeout"));
  const page = {
    setDefaultTimeout: vi.fn(),
    setDefaultNavigationTimeout: vi.fn(),
    waitForFunction: wait,
  } as unknown as Page;
  boundPageWaits(page);
  await expect(
    page.waitForFunction((words) => words === "arrived", { timeout: 165_000 }, "Ada"),
  ).rejects.toThrow(/Condition never arrived:.*words.*arguments=\["Ada"\]/u);
  expect(wait.mock.calls[0]![1].timeout).toBeLessThanOrEqual(scenarioPolicy.conditionMs);
});
