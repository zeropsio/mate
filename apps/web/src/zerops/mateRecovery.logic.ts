import type { MateRecovery } from "@t3tools/client-runtime/data";
import {
  classifyZeropsAgentAuth,
  type ZeropsAgentAuthFields,
} from "@t3tools/shared/zeropsAgentAuth";
import type { ReachabilityAction } from "@t3tools/client-runtime/zerops/environments";

export interface RecoveryNotice {
  readonly text: string;
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
  const name =
    (standing.kind === "listed"
      ? standing.project.name
      : "name" in standing
        ? standing.name
        : undefined) ||
    mateName ||
    "This Mate";
  if (standing.kind === "deleted")
    return {
      text: `${name}'s project was deleted. This conversation is no longer available.`,
      actions: ["go-to-projects"],
      tone: "default",
    };
  if (standing.kind === "denied")
    return {
      text: `You no longer have access to ${name}'s project. Ask a project owner to restore it.`,
      actions: ["go-to-projects"],
      tone: "warning",
    };
  if (
    (process?.status === "RUNNING" || process?.status === "PENDING") &&
    (process.actionName === "stack.restart" || process.actionName === "stack.start")
  )
    return {
      text: `${name} is ${process.actionName === "stack.restart" ? "restarting" : "starting"}.`,
      actions: [],
      tone: "default",
    };
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
          : (result ?? "Open the process in Zerops to see what happened.");
    return {
      text: `${failed && verb !== null ? `${name} could not ${verb}.` : `${name}'s container failed.`} ${cause}`,
      actions: ["restart", "open-in-zerops"],
      tone: "error",
    };
  }
  if (status === "STOPPED")
    return {
      text: `${name}'s container is stopped. Start ${name} to reconnect.`,
      actions: ["start"],
      tone: "default",
    };
  if (read.diskFull === true)
    return {
      text: `Zerops last reported ${name}'s disk is full. Free space before saving or running more work.`,
      actions: ["open-in-zerops"],
      tone: "warning",
    };
  return null;
}
