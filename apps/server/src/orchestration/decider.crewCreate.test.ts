import {
  CommandId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";

import { decideOrchestrationCommand } from "./decider.ts";

const NOW = "2026-09-27T08:00:00.000Z";
const CREW = { crew: "shop", crewmate: "backend", stint: 2 };

const readModel: OrchestrationReadModel = {
  snapshotSequence: 0,
  projects: [
    {
      id: ProjectId.make("project-1"),
      title: "Project",
      workspaceRoot: "/var/www",
      defaultModelSelection: null,
      scripts: [],
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
    },
  ],
  threads: [],
  updatedAt: NOW,
};

const create = {
  commandId: CommandId.make("server:crew:shop:backend:2"),
  threadId: ThreadId.make("thread-crew"),
  projectId: ProjectId.make("project-1"),
  title: "backend",
  modelSelection: { instanceId: ProviderInstanceId.make("claudeAgent"), model: "opus" },
  runtimeMode: "approval-required",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  createdAt: NOW,
} as const;

const decide = (command: OrchestrationCommand, model = readModel) =>
  decideOrchestrationCommand({ command, readModel: model }).pipe(
    Effect.map((decided) => (Array.isArray(decided) ? decided : [decided])),
  );

it.layer(NodeServices.layer)("crew thread creation", (it) => {
  it.effect.each([
    {
      name: "a crew thread carries its crew origin",
      command: { ...create, type: "thread.crew.create", crew: CREW },
      crew: CREW,
    },
    {
      name: "a person's thread carries none",
      command: { ...create, type: "thread.create" },
      crew: undefined,
    },
  ] as const)("$name on thread.created", ({ command, crew }) =>
    Effect.gen(function* () {
      const [event] = yield* decide(command);
      expect(event?.type).toBe("thread.created");
      const payload = event?.type === "thread.created" ? event.payload : undefined;
      expect(payload?.runtimeMode).toBe("approval-required");
      expect(payload?.crew).toEqual(crew);
      expect(payload !== undefined && "crew" in payload).toBe(crew !== undefined);
    }),
  );

  it.effect("refuses a crew thread whose id is taken", () =>
    Effect.gen(function* () {
      const [created] = yield* decide({ ...create, type: "thread.crew.create", crew: CREW });
      expect(created?.type).toBe("thread.created");
      const taken: OrchestrationReadModel = {
        ...readModel,
        threads: [
          {
            id: create.threadId,
            projectId: create.projectId,
            title: "backend",
            modelSelection: create.modelSelection,
            runtimeMode: "approval-required",
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            latestTurn: null,
            createdAt: NOW,
            updatedAt: NOW,
            archivedAt: null,
            settledOverride: null,
            settledAt: null,
            deletedAt: null,
            messages: [],
            proposedPlans: [],
            activities: [],
            checkpoints: [],
            session: null,
            crew: CREW,
          },
        ],
      };
      const exit = yield* Effect.exit(
        decide({ ...create, type: "thread.crew.create", crew: CREW }, taken),
      );
      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );
});
