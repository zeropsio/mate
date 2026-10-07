import type { UsageOwnersStatus } from "../../zerops/usageEnvironmentIdentities";
import type { UsageScope } from "./usageDimensions";

/** Resolve identity and source coverage before totals can make a claim. */
export function usagePageState(input: {
  readonly baseline: UsageOwnersStatus;
  readonly owners: UsageOwnersStatus;
  readonly scope: UsageScope;
  readonly projects: ReadonlyMap<string, string>;
  readonly scopeKnown: boolean;
  readonly listed: boolean;
  readonly answered: number;
  readonly records: number;
  readonly pending: number;
  readonly unavailable: number;
}): {
  readonly kind: "reading" | "unavailable" | "invalid" | "partial" | "ready";
  readonly message: string | null;
} {
  if (input.baseline === "unavailable")
    return {
      kind: "unavailable",
      message: "Usage scope could not be read. Restore HQ access or retry the unavailable source.",
    };
  if (input.baseline === "resolving")
    return { kind: "reading", message: "Reading organization and Usage scope…" };
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
  if (input.scope.person !== undefined && input.owners !== "resolved")
    return {
      kind: input.owners === "resolving" ? "reading" : "unavailable",
      message:
        input.owners === "resolving"
          ? "Reading current Mate owners…"
          : "Current Mate owners are unavailable. Retry HQ owner facts.",
    };
  if (!input.scopeKnown)
    return {
      kind: "invalid",
      message: "This Usage scope is unknown, deleted, or inaccessible. Choose an available scope.",
    };
  const incomplete = !input.listed || input.pending > 0 || input.unavailable > 0;
  if (input.answered > 0) {
    if (incomplete && input.records === 0)
      return {
        kind: !input.listed || input.pending > 0 ? "reading" : "unavailable",
        message:
          !input.listed || input.pending > 0
            ? "No activity has been confirmed yet; Usage coverage is incomplete."
            : "No activity has been confirmed in the answered sources. Some Mates could not report usage; reconnect or retry them.",
      };
    return { kind: incomplete ? "partial" : "ready", message: null };
  }
  if (!input.listed || input.pending > 0)
    return { kind: "reading", message: "Reading usage from the scoped Mates…" };
  if (input.unavailable > 0)
    return {
      kind: "unavailable",
      message: "No scoped Mate could report usage. Reconnect or retry the unavailable Mates.",
    };
  return { kind: "ready", message: null };
}
