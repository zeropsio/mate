import {
  CommandId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";

const UPDATED_AT = "2026-01-01T00:00:00.000Z";

const readModel: OrchestrationReadModel = {
  snapshotSequence: 0,
  projects: [],
  threads: [
    {
      id: ThreadId.make("thread-1"),
      projectId: ProjectId.make("project-1"),
      title: "Manual title",
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      latestTurn: null,
      createdAt: UPDATED_AT,
      updatedAt: UPDATED_AT,
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      snoozedUntil: null,
      snoozedAt: null,
      deletedAt: null,
      messages: [],
      proposedPlans: [],
      activities: [],
      checkpoints: [],
      session: null,
    },
  ],
  updatedAt: UPDATED_AT,
};

it.layer(NodeServices.layer)("conversation copy assignment", (it) => {
  it.effect.each(
    Array.from([null, "/chosen/copy"], (currentPath) => ({
      title: `refuses a stale path change from ${currentPath}`,
      currentPath,
    })),
  )("$title", ({ currentPath }) =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        decideOrchestrationCommand({
          command: {
            type: "thread.meta.update",
            commandId: CommandId.make("crew:copy:selected"),
            threadId: ThreadId.make("thread-1"),
            expectedWorktreePath: currentPath,
            worktreePath: "/crew/copy",
          },
          readModel: {
            ...readModel,
            threads: readModel.threads.map((thread) => ({
              ...thread,
              worktreePath: "/new/choice",
            })),
          },
        }),
      );
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );
});
