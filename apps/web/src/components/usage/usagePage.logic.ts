import type { AgentUsageRead } from "@t3tools/client-runtime/data";
import type { UsageScope } from "./usageDimensions";

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
          : `No recorded usage in this period. No data before ${report.recordedSince.slice(0, 10)}.`,
    };
  return { kind: report.state === "complete" ? "ready" : "partial", message: null };
}
