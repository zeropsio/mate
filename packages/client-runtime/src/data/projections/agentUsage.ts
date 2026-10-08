/** Reports retain known values during HQ outages; denial removes their protected payload. */
import type { UsageReport } from "@t3tools/contracts";
import { agentUsageId, agentUsageScope } from "../families/agentUsage.ts";
import type { Projection } from "../store.ts";
import { sameValue } from "./equal.ts";
export type AgentUsageRead =
  | { readonly kind: "reading" }
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
        stale: stream.phase !== "live",
        ...(stream.fault?.code === "usage-update-required" ? { updateRequired: true } : {}),
      };
    if (fact.kind === "withheld" || stream.fault !== null)
      return {
        kind: "unavailable",
        reason: stream.fault?.message ?? "HQ usage access is unavailable. Retry HQ access.",
      };
    return { kind: "reading" };
  },
  equals: sameValue,
};
