/**
 * The plan's usage as the crew's usage stop reads it: the account's windows the instance's snapshot
 * holds — the bars the person sees — never a single streamed rate-limit event. Claude streams one
 * only near a threshold or at a refusal, so the last one could stand for days after its window
 * reset (H10, 2026-10-11: a reading of 100 % kept while the plan read 23 % / 39 %).
 *
 * @module crew/engine/planUsage
 */
import type { ServerProvider, ServerProviderUsageLimits } from "@t3tools/contracts";

/**
 * The fullest of the plan's windows still open at `nowMs`; `null` when the login reports none, so
 * an agent that reports no usage never stops a run.
 */
export const planUsagePercent = (
  limits: ServerProviderUsageLimits | undefined,
  nowMs: number,
): number | null => {
  const open = (limits?.windows ?? []).filter(
    (window) => window.resetsAt === undefined || Date.parse(window.resetsAt) > nowMs,
  );
  return open.length === 0 ? null : Math.max(...open.map((window) => window.usedPercent));
};

/** Each instance's reading that moved since `told`, which it then holds. */
export const movedPlanUsage = (
  providers: ReadonlyArray<Pick<ServerProvider, "instanceId" | "usageLimits">>,
  nowMs: number,
  told: Map<string, number | null>,
): ReadonlyArray<{ readonly login: string; readonly usagePercent: number | null }> =>
  providers.flatMap((provider) => {
    const login = provider.instanceId as string;
    const usagePercent = planUsagePercent(provider.usageLimits, nowMs);
    if (told.has(login) && told.get(login) === usagePercent) return [];
    told.set(login, usagePercent);
    return [{ login, usagePercent }];
  });
