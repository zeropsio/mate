import { agentNeedsSignIn } from "@t3tools/client-runtime/zerops";
import type { ZeropsAgentActivity } from "./agentActivity";
import { usageLimitProvider } from "./noticeWords";

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
  if (
    activity?.usageLimited === true ||
    activity?.pausedUntil !== undefined ||
    usageLimitProvider(activity?.errorLine) !== null
  ) {
    return {
      kind: "limit",
      severity: "attention",
      until: activity?.pausedUntil,
      provider: usageLimitProvider(activity?.errorLine) ?? undefined,
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
