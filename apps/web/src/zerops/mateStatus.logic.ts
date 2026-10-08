import { agentNeedsSignIn } from "@t3tools/client-runtime/zerops";
import type { ZeropsAgentActivity } from "./agentActivity";

export type MateStatus = {
  readonly kind: "limit" | "sign-in" | "answer" | "broken";
  readonly severity: "attention" | "danger";
  readonly until?: string | undefined;
  readonly provider?: string | undefined;
};

/** Status evidence is shared by the menu and conversation; a reset never proves a resume. */
export function mateStatus(
  activity: ZeropsAgentActivity | undefined,
  needsSignIn = false,
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
    (needsSignIn &&
      (activity === undefined || activity.kind === "idle" || activity.kind === "failed")) ||
    agentNeedsSignIn(activity?.errorLine ?? "")
  ) {
    return { kind: "sign-in", severity: "attention" };
  }
  if (
    activity?.kind === "approval" ||
    activity?.kind === "input" ||
    activity?.kind === "planReady"
  ) {
    return { kind: "answer", severity: "attention" };
  }
  if (activity?.kind === "failed") return { kind: "broken", severity: "danger" };
  return null;
}
