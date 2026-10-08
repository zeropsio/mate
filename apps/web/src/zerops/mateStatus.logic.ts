import type { AgentAdmissionAttention } from "@t3tools/client-runtime/data";
import type { ZeropsAgentActivity } from "./agentActivity";

export type MateStatus = {
  readonly admission?: AgentAdmissionAttention;
  readonly severity: "attention" | "danger";
  readonly until?: string | undefined;
  readonly provider?: string | undefined;
} & (
  | { readonly kind: "limit" | "sign-in" | "answer" | "broken" }
  | {
      readonly kind: "interrupted";
      readonly interruption: import("@t3tools/contracts").MateInterruption;
    }
);

/** Status evidence is shared by the menu and conversation; a reset never proves a resume. */
export function mateStatus(
  activity: ZeropsAgentActivity | undefined,
  admission?: AgentAdmissionAttention | null,
): MateStatus | null {
  if (activity?.remembered === true) return null;
  if (activity?.limit?.kind === "limited") {
    return {
      kind: "limit",
      severity: "attention",
      until: activity.limit.resetsAt ?? undefined,
      provider: activity.limit.provider,
    };
  }
  if (
    admission !== undefined &&
    admission !== null &&
    (activity === undefined || activity.kind === "idle" || activity.kind === "failed")
  ) {
    return { kind: "sign-in", severity: admission.severity, admission };
  }

  if (
    activity?.kind === "approval" ||
    activity?.kind === "input" ||
    activity?.kind === "planReady"
  ) {
    return { kind: "answer", severity: "attention" };
  }
  if (activity?.interruption?.continuation === "manual") {
    return { kind: "interrupted", severity: "attention", interruption: activity.interruption };
  }
  if (activity?.kind === "failed") return { kind: "broken", severity: "danger" };
  return null;
}
