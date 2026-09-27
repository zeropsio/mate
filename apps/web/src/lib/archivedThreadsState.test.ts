import { EnvironmentId, OrchestrationShellSnapshot } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { withoutCrewThreads } from "./archivedThreadsState";

const decodeSnapshot = Schema.decodeUnknownSync(OrchestrationShellSnapshot);

const archivedShell = (id: string, extra: object) => ({
  id,
  projectId: "project-1",
  title: id,
  modelSelection: { instanceId: "claudeAgent", model: "claude-opus-5" },
  runtimeMode: "approval-required",
  branch: null,
  worktreePath: null,
  latestTurn: null,
  createdAt: "2026-09-27T08:00:00.000Z",
  updatedAt: "2026-09-27T09:00:00.000Z",
  archivedAt: "2026-09-27T09:00:00.000Z",
  session: null,
  latestUserMessageAt: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
  ...extra,
});

describe("withoutCrewThreads", () => {
  it("lists the person's archived threads and never a crewmate's retired one", () => {
    const environmentId = EnvironmentId.make("environment-1");
    const snapshot = decodeSnapshot({
      snapshotSequence: 1,
      projects: [],
      threads: [
        archivedShell("thread-person", {}),
        archivedShell("thread-retired-stint", {
          crew: { crew: "shop", crewmate: "backend", stint: 1 },
        }),
      ],
      updatedAt: "2026-09-27T09:00:00.000Z",
    });

    const [entry] = withoutCrewThreads([{ environmentId, snapshot }]);

    expect(entry?.environmentId).toBe(environmentId);
    expect(entry?.snapshot.threads.map((thread) => thread.id)).toEqual(["thread-person"]);
  });
});
