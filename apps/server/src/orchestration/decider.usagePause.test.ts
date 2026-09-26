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

const NOW = "2026-09-26T09:00:00.000Z";
const PAUSE = {
  resetsAt: "2026-09-26T13:00:00.000Z",
  window: "5-hour",
  held: 2,
  pausedAt: "2026-09-26T08:40:00.000Z",
};

function makeReadModel(
  input: { readonly archivedAt?: string | null } = {},
): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    projects: [],
    threads: [
      {
        id: ThreadId.make("thread-1"),
        projectId: ProjectId.make("project-1"),
        title: "Thread",
        modelSelection: { instanceId: ProviderInstanceId.make("claudeAgent"), model: "opus" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        latestTurn: null,
        createdAt: NOW,
        updatedAt: NOW,
        archivedAt: input.archivedAt ?? null,
        settledOverride: null,
        settledAt: null,
        deletedAt: null,
        messages: [],
        proposedPlans: [],
        activities: [],
        checkpoints: [],
        session: null,
      },
    ],
    updatedAt: NOW,
  };
}

const decide = (command: OrchestrationCommand, readModel = makeReadModel()) =>
  decideOrchestrationCommand({ command, readModel }).pipe(
    Effect.map((decided) => (Array.isArray(decided) ? decided : [decided])),
  );

const pauseCommand = (usagePause: typeof PAUSE | null, threadId = "thread-1") =>
  ({
    type: "thread.usage-pause.set",
    commandId: CommandId.make("server:usage-pause:1"),
    threadId: ThreadId.make(threadId),
    usagePause,
    createdAt: NOW,
  }) as const;

const autoResumeCommand = (enabled: boolean) =>
  ({
    type: "thread.usage-auto-resume.set",
    commandId: CommandId.make(`cmd-auto-resume-${enabled}`),
    threadId: ThreadId.make("thread-1"),
    enabled,
  }) as const;

it.layer(NodeServices.layer)("usage pause decider", (it) => {
  it.effect.each([
    { name: "sets the pause the server read off the provider", usagePause: PAUSE },
    { name: "clears it with null", usagePause: null },
  ])("$name", ({ usagePause }) =>
    Effect.gen(function* () {
      const [event, ...rest] = yield* decide(pauseCommand(usagePause));
      expect(rest).toEqual([]);
      expect(event?.type).toBe("thread.usage-pause-set");
      expect(event?.occurredAt).toBe(NOW);
      expect(event?.payload).toEqual({ threadId: "thread-1", usagePause });
    }),
  );

  it.effect("refuses a pause for a thread it does not know", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(decide(pauseCommand(PAUSE, "thread-missing")));
      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );

  it.effect.each([
    { enabled: false, disabled: true },
    { enabled: true, disabled: false },
  ])("the auto-resume switch set to $enabled", ({ enabled, disabled }) =>
    Effect.gen(function* () {
      const [event] = yield* decide(autoResumeCommand(enabled));
      expect(event?.type).toBe("thread.usage-auto-resume-set");
      if (event?.type === "thread.usage-auto-resume-set") {
        expect(event.payload.threadId).toBe("thread-1");
        expect(event.payload.usageAutoResumeDisabledAt === null).toBe(!disabled);
        if (disabled) expect(event.payload.usageAutoResumeDisabledAt).toBe(event.occurredAt);
      }
    }),
  );

  it.effect("refuses the switch on an archived thread", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        decide(autoResumeCommand(false), makeReadModel({ archivedAt: NOW })),
      );
      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );
});
