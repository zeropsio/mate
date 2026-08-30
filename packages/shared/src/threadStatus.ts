import type { OrchestrationThreadShell } from "@t3tools/contracts";
import type { RelayAgentAwarenessPhase } from "@t3tools/contracts/relay";
import { isLatestTurnSettled } from "./orchestrationTiming.ts";

export type ThreadStatusKind =
  | "approval"
  | "input"
  | "failed"
  | "connecting"
  | "working"
  | "planReady"
  | "monitoring"
  | "done"
  | "woke"
  | "idle";

export type ThreadStatusToneId =
  | "attention"
  | "input"
  | "active"
  | "danger"
  | "plan"
  | "success"
  | "neutral";

export type ThreadStatusInput = Pick<
  OrchestrationThreadShell,
  | "hasPendingApprovals"
  | "hasPendingUserInput"
  | "hasActionableProposedPlan"
  | "interactionMode"
  | "latestTurn"
  | "session"
  | "backgroundLiveness"
> & {
  readonly lastVisitedAt?: string | null;
  readonly wokeAt?: string | null;
};

export interface ThreadStatus {
  readonly kind: ThreadStatusKind;
  readonly toneId: ThreadStatusToneId;
}

export function hasUnseenCompletion(
  thread: Pick<ThreadStatusInput, "latestTurn" | "lastVisitedAt">,
): boolean {
  if (!thread.latestTurn?.completedAt) return false;
  const completedAt = Date.parse(thread.latestTurn.completedAt);
  if (Number.isNaN(completedAt) || !thread.lastVisitedAt) return false;

  const lastVisitedAt = Date.parse(thread.lastVisitedAt);
  return Number.isNaN(lastVisitedAt) || completedAt > lastVisitedAt;
}

function hasUnseenWake(thread: Pick<ThreadStatusInput, "lastVisitedAt" | "wokeAt">): boolean {
  if (!thread.wokeAt) return false;
  const wokeAt = Date.parse(thread.wokeAt);
  if (Number.isNaN(wokeAt)) return false;
  if (!thread.lastVisitedAt) return true;

  const lastVisitedAt = Date.parse(thread.lastVisitedAt);
  return Number.isNaN(lastVisitedAt) || wokeAt > lastVisitedAt;
}

function toneIdForKind(kind: ThreadStatusKind): ThreadStatusToneId {
  switch (kind) {
    case "approval":
    case "woke":
      return "attention";
    case "input":
      return "input";
    case "connecting":
    case "working":
    case "monitoring":
      return "active";
    case "failed":
      return "danger";
    case "planReady":
      return "plan";
    case "done":
      return "success";
    case "idle":
      return "neutral";
  }
}

function status(kind: ThreadStatusKind): ThreadStatus {
  return { kind, toneId: toneIdForKind(kind) };
}

export function resolveThreadStatus(thread: ThreadStatusInput): ThreadStatus {
  if (thread.hasPendingApprovals) return status("approval");
  if (thread.hasPendingUserInput) return status("input");
  if (thread.session?.status === "running" || thread.latestTurn?.state === "running") {
    return status("working");
  }
  if (thread.session?.status === "starting") return status("connecting");
  if (thread.session?.status === "error" || thread.latestTurn?.state === "error") {
    return status("failed");
  }
  if (
    thread.interactionMode === "plan" &&
    isLatestTurnSettled(thread.latestTurn, thread.session) &&
    thread.hasActionableProposedPlan
  ) {
    return status("planReady");
  }
  if (thread.backgroundLiveness === "working") return status("working");
  if (thread.backgroundLiveness === "monitoring") return status("monitoring");
  if (hasUnseenWake(thread)) return status("woke");
  if (hasUnseenCompletion(thread)) return status("done");
  return status("idle");
}

export function kindForAwarenessPhase(
  phase: Exclude<RelayAgentAwarenessPhase, "stale">,
): Exclude<ThreadStatusKind, "idle">;
export function kindForAwarenessPhase(phase: "stale"): "idle";
export function kindForAwarenessPhase(phase: RelayAgentAwarenessPhase): ThreadStatusKind;
export function kindForAwarenessPhase(phase: RelayAgentAwarenessPhase): ThreadStatusKind {
  switch (phase) {
    case "waiting_for_approval":
      return "approval";
    case "waiting_for_input":
      return "input";
    case "failed":
      return "failed";
    case "starting":
      return "connecting";
    case "running":
      return "working";
    case "completed":
      return "done";
    case "stale":
      return "idle";
  }
}
