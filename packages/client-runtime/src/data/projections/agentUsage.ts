/** Reports retain known values during HQ outages; denial removes their protected payload. */
import type { UsageReport } from "@t3tools/contracts";
import { agentUsageId, agentUsageScope } from "../families/agentUsage.ts";
import type { Projection } from "../store.ts";
import { sameValue } from "./equal.ts";
import { liveOrHeld } from "../streamMachine.ts";
import { hqAppsScope } from "../families/hqNavigation.ts";
import { HQ_SLOW, scopeSlow } from "./freshness.ts";
export type AgentUsageRead =
  /** `line`: what the read waits for, where it is not its own read under way. */
  | { readonly kind: "reading"; readonly line?: string }
  | {
      readonly kind: "read";
      readonly report: UsageReport;
      readonly stale: boolean;
      readonly updateRequired?: boolean;
    }
  | { readonly kind: "unavailable"; readonly reason: string };
export const agentUsage: Projection<
  { readonly orgId: string; readonly owner: string },
  AgentUsageRead
> = {
  name: "agentUsage",
  keyOf: ({ orgId, owner }) => agentUsageId(orgId, owner),
  derive: (read, { orgId, owner }) => {
    const fact = read.fact("agentUsage", agentUsageId(orgId, owner));
    const stream = read.stream(agentUsageScope(orgId, owner));
    if (fact.kind === "known")
      return {
        kind: "read",
        report: fact.value,
        stale: !liveOrHeld(stream),
        ...(stream.fault?.code === "usage-update-required" ? { updateRequired: true } : {}),
      };
    if (fact.kind === "withheld" || stream.fault !== null)
      return {
        kind: "unavailable",
        reason: stream.fault?.message ?? "HQ usage access is unavailable. Retry HQ access.",
      };
    // Usage is asked only once HQ's navigation said which reports it serves.
    if (scopeSlow(read, hqAppsScope(orgId)) || scopeSlow(read, agentUsageScope(orgId, owner)))
      return { kind: "reading", line: HQ_SLOW };
    if (stream.generation === 0) return { kind: "reading", line: "Waiting for HQ…" };
    return { kind: "reading" };
  },
  equals: sameValue,
};
