import type { MateRecovery } from "@t3tools/client-runtime/data";
import {
  classifyZeropsAgentAuth,
  type ZeropsAgentAuthFields,
} from "@t3tools/shared/zeropsAgentAuth";
import type { ReachabilityAction } from "@t3tools/client-runtime/zerops/environments";

export interface RecoveryNotice {
  readonly text: string;
  readonly headline: string;
  readonly secondary: string;
  readonly details?: string;
  readonly actions: ReadonlyArray<ReachabilityAction>;
  readonly tone: "default" | "warning" | "error";
}

export function expiredAgentNotice(
  agent: ZeropsAgentAuthFields,
  mateName: string,
  agentName: string,
): string | null {
  return classifyZeropsAgentAuth(agent).kind === "needs-reauth"
    ? `${mateName}'s ${agentName} login no longer works. Sign in again to continue.`
    : null;
}

/** Only owner evidence distinguishes access, deletion, deliberate stop and startup failure. */
export function recoveryNotice(read: MateRecovery, mateName: string): RecoveryNotice | null {
  const { standing, status, process } = read;
  const name = mateName.trim() || "The Mate";
  const say = (
    headline: string,
    secondary: string,
    actions: RecoveryNotice["actions"],
    tone: RecoveryNotice["tone"],
    details?: string,
  ): RecoveryNotice => ({
    headline,
    secondary,
    text: [headline, secondary].filter(Boolean).join(" "),
    actions,
    tone,
    ...(details ? { details } : {}),
  });
  if (standing.kind === "deleted")
    return say(
      `${name}'s project was deleted.`,
      "This conversation is no longer available.",
      ["go-to-projects"],
      "default",
    );
  if (standing.kind === "denied")
    return say(
      `You no longer have access to ${name}'s project.`,
      "Ask a project owner to restore it.",
      ["go-to-projects"],
      "warning",
    );
  if (
    (process?.status === "RUNNING" || process?.status === "PENDING") &&
    (process.actionName === "stack.restart" || process.actionName === "stack.start")
  )
    return say(
      `${name} is ${process.actionName === "stack.restart" ? "restarting" : "starting"}.`,
      "",
      [],
      "default",
    );
  if (status?.endsWith("FAILED")) {
    const verb =
      process?.actionName === "stack.restart"
        ? "restart"
        : process?.actionName === "stack.start"
          ? "start"
          : null;
    const failed = process?.status === "FAILED" || process?.status === "CANCELED";
    const result = failed ? process.failReason : undefined;
    const cause =
      result && /init command failed|CommandExec/iu.test(result)
        ? "Its startup command failed."
        : result && /ENOSPC|EDQUOT|no space left|disk quota exceeded/iu.test(result)
          ? "Its disk is full. Free space before saving or running more work."
          : result && /(?:\b5\d{2}\b|internal server error)/iu.test(result)
            ? `Zerops returned an error${verb === "restart" ? " while restarting" : verb === "start" ? " while starting" : " while preparing the container"}.`
            : process?.status === "CANCELED"
              ? "Zerops canceled the process."
              : "Open the process in Zerops to see what happened.";
    return say(
      failed && verb !== null ? `${name} couldn't ${verb}.` : `${name}'s container failed.`,
      cause,
      ["restart", "open-in-zerops"],
      "error",
      result,
    );
  }
  if (status === "STOPPED")
    return say(
      `${name}'s container is stopped.`,
      `Start ${name} to reconnect.`,
      ["start"],
      "default",
    );
  if (read.diskFull === true)
    return say(
      `Zerops last reported ${name}'s disk is full.`,
      "Free space before saving or running more work.",
      ["open-in-zerops"],
      "warning",
    );
  return null;
}
