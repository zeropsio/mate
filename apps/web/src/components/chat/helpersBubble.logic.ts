/**
 * The bubble a launch of helpers draws on its run's card: how many it started, what for, and
 * whether one of them failed — said from the helpers' surface, which knows each one's state.
 */
import {
  UNNAMED_HELPER,
  type AgentPanelModel,
} from "@t3tools/client-runtime/state/subagentRuntime";

import type { WorkLogEntry } from "../../session-logic";
import { deriveAgentSpawnSummary } from "./agentSpawnSummary";

export function helpersBubbleOf(
  model: AgentPanelModel,
  spawn: NonNullable<WorkLogEntry["agentSpawn"]>,
) {
  const memberIds = new Set(spawn.agentTaskIds);
  const workflowGroup = spawn.workflowId
    ? model.workflows.find((group) => group.workflow.id === spawn.workflowId)
    : undefined;
  const agents = workflowGroup
    ? [...workflowGroup.phases.flatMap((phase) => phase.members), ...workflowGroup.unphasedMembers]
    : model.directAgents.filter((agent) => memberIds.has(agent.id));
  const count = Math.max(
    agents.length,
    Math.max(memberIds.size - (spawn.workflowId ? 1 : 0), 0),
    1,
  );
  const summary = deriveAgentSpawnSummary({
    agents,
    agentCount: count,
    coordinatorStatus: workflowGroup?.workflow.status,
  });
  const workflowName =
    workflowGroup?.workflow.workflowName ?? workflowGroup?.workflow.title ?? null;
  // A helper no one named says nothing past "Started a helper".
  const what =
    workflowName ??
    agents
      .map((agent) => agent.title)
      .filter((title) => title !== UNNAMED_HELPER)
      .join(" · ");
  // How the helpers that did not finish ended, once none works: a person's Stop or a failure is
  // said on the bubble, never left to the helpers' surface ("Milo worked 11s · 2 helpers" and
  // nothing more after a Stop that ended both).
  const failedCount = agents.filter((agent) => agent.status === "failed").length;
  const stoppedCount = agents.filter((agent) => agent.status === "cancelled").length;
  const cutCount = agents.filter((agent) => agent.status === "interrupted").length;
  const ended = summary.live
    ? null
    : [
        failedCount > 0 ? `${failedCount} failed` : null,
        stoppedCount > 0 ? `${stoppedCount} stopped` : null,
        cutCount > 0 ? `${cutCount} didn't report back` : null,
      ]
        .filter((part): part is string => part !== null)
        .join(", ") || null;
  return {
    agents,
    count,
    summary,
    ended,
    words: count === 1 ? "Started a helper" : `Started ${count} helpers`,
    what,
    // A helper that failed marks the bubble at once, never hidden behind the others still at it
    // (Milo's stress runs: one failed in a batch of three, and the bubble said only "Working").
    failed: summary.tone === "failed" || agents.some((agent) => agent.status === "failed"),
  };
}
