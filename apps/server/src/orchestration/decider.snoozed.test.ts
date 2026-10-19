import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationReadModel,
  type OrchestrationThread,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";

const NOW = "2026-01-01T00:00:00.000Z";
// The decider's clock is the Effect test clock, pinned to the epoch, so
// "future" wake times are relative to 1970-01-01T00:00:00.000Z.
const FUTURE_WAKE = "1970-01-02T09:00:00.000Z";
const PAST_WAKE = "1969-12-31T09:00:00.000Z";
const SNOOZED_AT = "1969-12-30T00:00:00.000Z";

function makeReadModel(input: {
  readonly snoozedUntil?: string | null;
  readonly snoozedAt?: string | null;
  readonly archivedAt?: string | null;
  readonly activities?: OrchestrationThread["activities"];
  readonly messages?: OrchestrationThread["messages"];
}): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    projects: [],
    threads: [
      {
        id: ThreadId.make("thread-1"),
        projectId: ProjectId.make("project-1"),
        title: "Thread",
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
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
        snoozedUntil: input.snoozedUntil ?? null,
        snoozedAt: input.snoozedAt ?? (input.snoozedUntil != null ? SNOOZED_AT : null),
        deletedAt: null,
        messages: input.messages ?? [],
        proposedPlans: [],
        activities: input.activities ?? [],
        session: null,
      },
    ],
    updatedAt: NOW,
  };
}

it.layer(NodeServices.layer)("snoozed thread decider", (it) => {
  it.effect("a user message spends the snooze return ticket (activity wake)", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread.turn.start",
          commandId: CommandId.make("cmd-turn-start"),
          threadId: ThreadId.make("thread-1"),
          message: {
            messageId: MessageId.make("message-1"),
            role: "user",
            text: "Continue",
            attachments: [],
          },
          runtimeMode: "full-access",
          interactionMode: "default",
          createdAt: NOW,
        },
        readModel: makeReadModel({ snoozedUntil: FUTURE_WAKE }),
      });
      const events = Array.isArray(result) ? result : [result];
      const unsnoozed = events.find((entry) => entry.type === "thread.unsnoozed");
      expect(unsnoozed).toBeDefined();
      if (unsnoozed?.type === "thread.unsnoozed") {
        expect(unsnoozed.payload.reason).toBe("activity");
      }
    }),
  );
});
