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
  | { readonly kind: "limit" | "sign-in" | "broken" }
  /** It waits on the person's answer: a question or an approval, or a key it asked for. */
  | { readonly kind: "answer"; readonly key?: true }
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
    return {
      kind: "answer",
      severity: "attention",
      ...(activity.kind === "input" && activity.asksFor === "key" ? { key: true as const } : {}),
    };
  }
  if (activity?.interruption?.continuation === "manual") {
    return { kind: "interrupted", severity: "attention", interruption: activity.interruption };
  }
  if (activity?.kind === "failed") return { kind: "broken", severity: "danger" };
  return null;
}

/** What a waiting Mate's open conversation knows of its ask, for the status's hover. */
export interface MateStatusAsk {
  /** What it asks for: a key in people's words ("Stripe secret key"), a question's first line. */
  readonly asked?: string | undefined;
  /** Its person, to someone who only reads along: they are asked, not the reader ("Waiting on Dana"). */
  readonly askedOf?: string | undefined;
}

/**
 * A waiting Mate's cause: what is asked, where known, and of whom to someone reading along. A
 * value is never a "key": that word is the Mate's own key at HQ, so "Needs a key" read as the Mate
 * missing a setting of its own.
 */
function answerCause(
  status: Extract<MateStatus, { readonly kind: "answer" }>,
  mateName: string,
  label: string,
  ask: MateStatusAsk,
): string {
  const asked = ask.asked
    ?.split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (ask.askedOf !== undefined) {
    if (status.key === true) return `${mateName} needs ${asked ?? "a value"} from ${ask.askedOf}`;
    return asked === undefined
      ? `${mateName} waits on ${ask.askedOf}'s answer`
      : `${mateName} asked ${ask.askedOf}: ${asked}`;
  }
  return asked === undefined ? `${mateName}: ${label}` : `${label}: ${asked}`;
}

/** The same cause and next action wherever a Mate's status is drawn. */
export function mateStatusWords(
  status: MateStatus,
  mateName: string,
  timestampFormat: TimestampFormat = "locale",
  ask: MateStatusAsk = {},
) {
  const label =
    status.kind === "interrupted"
      ? restartWords(mateName, status.interruption, timestampFormat)
      : status.kind === "limit"
        ? "Limit"
        : status.kind === "sign-in"
          ? (status.admission?.summary ?? "Sign in")
          : status.kind === "answer"
            ? ask.askedOf !== undefined
              ? `Waiting on ${ask.askedOf}`
              : status.key === true
                ? "Needs a value"
                : "Needs an answer"
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
          : status.kind === "answer"
            ? answerCause(status, mateName, label, ask)
            : `${mateName}: ${label}`;
  return { label, cause, action: status.admission?.actionLabel ?? "Open" };
}
