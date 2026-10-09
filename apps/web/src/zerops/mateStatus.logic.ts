import type { TimestampFormat } from "@t3tools/contracts/settings";
import { restartWords } from "./restartWords";
import { usageLimitWords } from "./noticeWords";
import { formatUpcomingTimestamp } from "../timestampFormat";
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

/** The same cause and next action wherever a Mate's status is drawn. */
export function mateStatusWords(
  status: MateStatus,
  mateName: string,
  timestampFormat: TimestampFormat = "locale",
) {
  const label =
    status.kind === "interrupted"
      ? restartWords(mateName, status.interruption, timestampFormat)
      : status.kind === "limit"
        ? "Limit"
        : status.kind === "sign-in"
          ? (status.admission?.summary ?? "Sign in")
          : status.kind === "answer"
            ? "Needs an answer"
            : "Needs attention";
  const cause =
    status.kind === "limit"
      ? usageLimitWords(
          status.provider ?? "coding agent",
          status.until === undefined
            ? undefined
            : formatUpcomingTimestamp(status.until, timestampFormat),
          mateName,
        )
      : status.kind === "interrupted"
        ? `${label}. Continue on the interrupted turn.`
        : status.kind === "sign-in" && status.admission !== undefined
          ? status.admission.text
          : `${mateName}: ${label}`;
  return { label, cause, action: status.admission?.actionLabel ?? "Open" };
}
