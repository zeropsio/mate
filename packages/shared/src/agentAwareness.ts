import type {
  EnvironmentId,
  OrchestrationProjectShell,
  OrchestrationThreadShell,
  ThreadId,
} from "@t3tools/contracts";
import { resolveThreadStatus, type ThreadStatusInput } from "./threadStatus.ts";

export type AgentAwarenessPhase =
  | "starting"
  | "running"
  | "waiting_for_approval"
  | "waiting_for_input"
  | "completed"
  | "failed"
  | "stale";

export interface AgentAwarenessState {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly projectTitle: string;
  readonly threadTitle: string;
  readonly phase: AgentAwarenessPhase;
  readonly headline: string;
  readonly detail?: string;
  readonly modelTitle: string;
  readonly updatedAt: string;
  readonly deepLink: string;
}

export interface ProjectThreadAwarenessInput {
  readonly environmentId: EnvironmentId;
  readonly project: Pick<OrchestrationProjectShell, "title">;
  readonly thread: Pick<
    OrchestrationThreadShell,
    | "id"
    | "title"
    | "modelSelection"
    | "session"
    | "latestTurn"
    | "updatedAt"
    | "hasPendingApprovals"
    | "hasPendingUserInput"
    | "hasActionableProposedPlan"
    | "interactionMode"
    | "backgroundLiveness"
  >;
}

export function buildAgentAwarenessDeepLink(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}): string {
  return `/threads/${encodeURIComponent(input.environmentId)}/${encodeURIComponent(input.threadId)}`;
}

export function projectThreadAwareness(
  input: ProjectThreadAwarenessInput,
): AgentAwarenessState | null {
  const { environmentId, project, thread } = input;
  const phase = resolveThreadAwarenessPhase(thread);
  if (!phase) {
    return null;
  }

  const detail = detailForPhase(phase, thread);
  return {
    environmentId,
    threadId: thread.id,
    projectTitle: project.title,
    threadTitle: thread.title,
    phase,
    headline: headlineForPhase(phase),
    ...(detail === undefined ? {} : { detail }),
    modelTitle: thread.modelSelection.model,
    updatedAt: thread.updatedAt,
    deepLink: buildAgentAwarenessDeepLink({ environmentId, threadId: thread.id }),
  };
}

function completedAwarenessPhase(thread: ThreadStatusInput): AgentAwarenessPhase | null {
  if (thread.latestTurn?.state === "completed") return "completed";
  // Session teardown can settle a finished turn as interrupted, while
  // completedAt remains the durable evidence that the work finished.
  if (thread.latestTurn?.state === "interrupted" && thread.latestTurn.completedAt !== null) {
    return "completed";
  }
  // No-change turns may leave no materialized turn, making a settled
  // session the only completion signal available to the relay.
  if (thread.session?.status === "ready" || thread.session?.status === "idle") {
    return "completed";
  }
  return null;
}

function resolveThreadAwarenessPhase(thread: ThreadStatusInput): AgentAwarenessPhase | null {
  switch (resolveThreadStatus(thread).kind) {
    case "approval":
      return "waiting_for_approval";
    case "input":
      return "waiting_for_input";
    case "failed":
      return "failed";
    case "connecting":
      return "starting";
    case "working":
      if (thread.session?.status === "running" || thread.latestTurn?.state === "running") {
        return "running";
      }
      return completedAwarenessPhase(thread);
    case "planReady":
    case "monitoring":
    case "done":
    case "woke":
      return "completed";
    case "idle":
      return completedAwarenessPhase(thread);
  }
}

function headlineForPhase(phase: AgentAwarenessPhase): string {
  switch (phase) {
    case "starting":
      return "Starting agent";
    case "running":
      return "Agent is working";
    case "waiting_for_approval":
      return "Approval needed";
    case "waiting_for_input":
      return "Waiting for input";
    case "completed":
      return "Agent finished";
    case "failed":
      return "Agent failed";
    case "stale":
      return "Update delayed";
  }
}

function detailForPhase(
  phase: AgentAwarenessPhase,
  thread: ProjectThreadAwarenessInput["thread"],
): string | undefined {
  if (phase === "failed") {
    return thread.session?.lastError ?? undefined;
  }
  if (phase === "completed") {
    return "Review the completed task.";
  }
  if (phase === "running" && thread.session?.providerName) {
    return `${thread.session.providerName} is active.`;
  }
  return undefined;
}
