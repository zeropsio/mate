import type { RuntimeSubagent } from "@t3tools/client-runtime/state/subagentRuntime";
import { deriveAgentPanelModel } from "@t3tools/client-runtime/state/subagentRuntime";
import { describe, expect, it } from "vite-plus/test";

import { helpersBubbleOf } from "./helpersBubble.logic";

const helper = (id: string, status: RuntimeSubagent["status"]): RuntimeSubagent =>
  ({
    id,
    kind: "subagent",
    title: `Helper ${id}`,
    role: "general-purpose",
    model: null,
    effort: null,
    status,
    activationCount: 1,
    usage: null,
    progress: null,
    lastToolName: null,
    result: null,
    error: null,
    outputFile: null,
    parentAgentId: null,
    agentIndex: null,
    phaseIndex: null,
    phaseTitle: null,
    attempt: null,
    workflowName: null,
    phases: [],
    runHandles: null,
    recentActivity: [],
    prompt: null,
    toolUseId: null,
    spawnedBy: null,
    liveCall: null,
    firstSeenAt: "2026-10-09T18:00:00.000Z",
    startedAt: "2026-10-09T18:00:00.000Z",
    completedAt: null,
    updatedAt: "2026-10-09T18:00:00.000Z",
  }) as RuntimeSubagent;

describe("the bubble of helpers a launch started", () => {
  it.each([
    {
      // Milo's stress runs: one failed in a batch of three, and the bubble said only "Working".
      name: "one failed while the others still work: marked failed at once",
      statuses: ["failed", "running"] as const,
      failed: true,
      ended: null,
    },
    {
      // A person's Stop after the turn ended both: the card read "2 helpers" and nothing more.
      name: "a person's Stop ended them: said stopped",
      statuses: ["cancelled", "cancelled"] as const,
      failed: false,
      ended: "2 stopped",
    },
    {
      name: "one failed, one stopped, one its session took: each end said",
      statuses: ["failed", "cancelled", "interrupted"] as const,
      failed: true,
      ended: "1 failed, 1 stopped, 1 didn't report back",
    },
    {
      name: "all finished: nothing more to say",
      statuses: ["completed", "completed"] as const,
      failed: false,
      ended: null,
    },
  ])("says how its helpers stand: $name", ({ statuses, failed, ended }) => {
    const agents = statuses.map((status, index) => helper(`h${index}`, status));
    const bubble = helpersBubbleOf(deriveAgentPanelModel({ agents }), {
      workflowId: null,
      agentTaskIds: agents.map((agent) => agent.id),
    });
    expect({ words: bubble.words, failed: bubble.failed, ended: bubble.ended }).toEqual({
      words: `Started ${statuses.length} helpers`,
      failed,
      ended,
    });
  });
});
