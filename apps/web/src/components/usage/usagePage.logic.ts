import type { AgentUsageRead } from "@t3tools/client-runtime/data";
import type { UsageScope } from "./usageDimensions";
import type { EnvironmentId, UsageReport } from "@t3tools/contracts";
import type {
  UsageEnvironmentIdentities,
  UsageEnvironmentOwner,
} from "../../zerops/usageEnvironmentIdentities";

/** One report's attribution joins only that report's independently authorized coverage. */
export function createUsageIdentityIndex(input: {
  readonly report: UsageReport | null;
  readonly registered: UsageEnvironmentIdentities;
  readonly people: ReadonlyMap<string, UsageEnvironmentOwner> | undefined;
  readonly projects: ReadonlyMap<string, string>;
}) {
  const identities = new Map(input.registered);
  for (const entry of input.report?.coverage ?? []) {
    if (entry.mateId === undefined) continue;
    const owner =
      (entry.ownerUserId == null ? null : input.people?.get(entry.ownerUserId)) ??
      [...input.registered.values()].find((value) => value.owner?.id === entry.ownerUserId)
        ?.owner ??
      null;
    identities.set(entry.mateId as EnvironmentId, {
      mateName: entry.label ?? entry.mateId,
      projectId: entry.appId ?? null,
      projectName: entry.appId == null ? null : (input.projects.get(entry.appId) ?? entry.appId),
      ownerState: entry.ownerUserId === null ? "unassigned" : owner === null ? "unknown" : "known",
      owner,
    });
  }
  return {
    identities,
    labels: new Map([...identities].map(([id, value]) => [id, value.mateName])),
  };
}

/** A read report is evidence; an empty unread source never establishes zero consumption. */
export function usagePageState(input: {
  readonly read: AgentUsageRead;
  readonly scope: UsageScope;
  readonly projects: ReadonlyMap<string, string>;
}): {
  readonly kind: "reading" | "unavailable" | "invalid" | "empty" | "partial" | "ready";
  readonly message: string | null;
} {
  if (input.scope.legacyProject !== undefined) {
    const matches = [...input.projects.values()].filter(
      (name) => name === input.scope.legacyProject,
    ).length;
    return {
      kind: "invalid",
      message:
        matches > 1
          ? "This old project-name URL is ambiguous. Choose a project to use its stable ID."
          : "This old project-name URL is no longer supported. Choose a project to use its stable ID.",
    };
  }
  if (input.read.kind === "reading")
    return { kind: "reading", message: "Reading organization usage from HQ…" };
  if (input.read.kind === "unavailable")
    return { kind: "unavailable", message: `${input.read.reason} Restore HQ access or retry.` };
  const report = input.read.report;
  if (report.state === "unsupported-exact-boundary")
    return {
      kind: "unavailable",
      message: "Exact usage is unavailable for this period. Choose a daily range.",
    };
  if (report.totals.records === "0")
    return {
      kind: "empty",
      message:
        report.recordedSince == null
          ? "No recorded Mate usage yet."
          : "No recorded usage in this period.",
    };
  return { kind: report.state === "complete" ? "ready" : "partial", message: null };
}
