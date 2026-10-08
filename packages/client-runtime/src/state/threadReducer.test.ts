import { describe, expect, it } from "vite-plus/test";

import {
  CheckpointRef,
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import type { OrchestrationThread } from "@t3tools/contracts";

import { activityOrder, applyThreadDetailEvent } from "./threadReducer.ts";

const baseEventFields = {
  eventId: EventId.make("event-1"),
  commandId: null,
  causationEventId: null,
  correlationId: null,
  metadata: {},
} as const;

const baseThread: OrchestrationThread = {
  id: ThreadId.make("thread-1"),
  projectId: ProjectId.make("project-1"),
  title: "Test Thread",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  latestTurn: null,
  createdAt: "2026-04-01T00:00:00.000Z",
  updatedAt: "2026-04-01T00:00:00.000Z",
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  deletedAt: null,
  messages: [],
  proposedPlans: [],
  activities: [],
  checkpoints: [],
  session: null,
};

describe("applyThreadDetailEvent", () => {
  describe("project events", () => {
    it("returns unchanged for project.created", () => {
      const result = applyThreadDetailEvent(baseThread, {
        ...baseEventFields,
        sequence: 1,
        occurredAt: "2026-04-01T01:00:00.000Z",
        aggregateKind: "project",
        aggregateId: ProjectId.make("project-1"),
        type: "project.created",
        payload: {
          projectId: ProjectId.make("project-1"),
          title: "T3 Code",
          workspaceRoot: "/repo",
          repositoryIdentity: null,
          defaultModelSelection: null,
          scripts: [],
          createdAt: "2026-04-01T01:00:00.000Z",
          updatedAt: "2026-04-01T01:00:00.000Z",
          deletedAt: null,
        },
      } as any);
      expect(result.kind).toBe("unchanged");
    });
  });

  describe("thread.created", () => {
    it("creates a fresh thread", () => {
      const result = applyThreadDetailEvent(baseThread, {
        ...baseEventFields,
        sequence: 1,
        occurredAt: "2026-04-01T01:00:00.000Z",
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-2"),
        type: "thread.created",
        payload: {
          threadId: ThreadId.make("thread-2"),
          projectId: ProjectId.make("project-1"),
          title: "New Thread",
          modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: "main",
          worktreePath: null,
          createdAt: "2026-04-01T01:00:00.000Z",
          updatedAt: "2026-04-01T01:00:00.000Z",
        },
      });

      expect(result.kind).toBe("updated");
      if (result.kind === "updated") {
        expect(result.thread.id).toBe("thread-2");
        expect(result.thread.title).toBe("New Thread");
        expect(result.thread.branch).toBe("main");
        expect(result.thread.messages).toEqual([]);
        expect(result.thread.session).toBeNull();
        expect("crew" in result.thread).toBe(false);
      }
    });

    it("keeps a crewmate's thread's crew origin", () => {
      const crew = { crew: "shop", crewmate: "backend", stint: 2 };
      const result = applyThreadDetailEvent(baseThread, {
        ...baseEventFields,
        sequence: 1,
        occurredAt: "2026-09-27T08:00:00.000Z",
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-crew"),
        type: "thread.created",
        payload: {
          threadId: ThreadId.make("thread-crew"),
          projectId: ProjectId.make("project-1"),
          title: "backend",
          modelSelection: { instanceId: ProviderInstanceId.make("claudeAgent"), model: "opus" },
          runtimeMode: "approval-required",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt: "2026-09-27T08:00:00.000Z",
          updatedAt: "2026-09-27T08:00:00.000Z",
          crew,
        },
      });

      expect(result.kind === "updated" && result.thread.crew).toEqual(crew);
    });
  });

  describe("thread.deleted", () => {
    it("returns deleted signal", () => {
      const result = applyThreadDetailEvent(baseThread, {
        ...baseEventFields,
        sequence: 2,
        occurredAt: "2026-04-01T02:00:00.000Z",
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-1"),
        type: "thread.deleted",
        payload: {
          threadId: ThreadId.make("thread-1"),
          deletedAt: "2026-04-01T02:00:00.000Z",
        },
      });
      expect(result.kind).toBe("deleted");
    });
  });

  describe("thread.archived / thread.unarchived", () => {
    it("sets archivedAt and clears title regeneration", () => {
      const regeneratingThread: OrchestrationThread = {
        ...baseThread,
        titleRegeneration: {
          requestId: CommandId.make("regenerate-title"),
          startedAt: "2026-04-01T02:00:00.000Z",
        },
      };
      const result = applyThreadDetailEvent(regeneratingThread, {
        ...baseEventFields,
        sequence: 3,
        occurredAt: "2026-04-01T03:00:00.000Z",
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-1"),
        type: "thread.archived",
        payload: {
          threadId: ThreadId.make("thread-1"),
          archivedAt: "2026-04-01T03:00:00.000Z",
          updatedAt: "2026-04-01T03:00:00.000Z",
        },
      });

      expect(result.kind).toBe("updated");
      if (result.kind === "updated") {
        expect(result.thread.archivedAt).toBe("2026-04-01T03:00:00.000Z");
        expect(result.thread.titleRegeneration).toBeNull();
      }
    });

    it("clears archivedAt", () => {
      const archivedThread = { ...baseThread, archivedAt: "2026-04-01T03:00:00.000Z" };
      const result = applyThreadDetailEvent(archivedThread, {
        ...baseEventFields,
        sequence: 4,
        occurredAt: "2026-04-01T04:00:00.000Z",
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-1"),
        type: "thread.unarchived",
        payload: {
          threadId: ThreadId.make("thread-1"),
          updatedAt: "2026-04-01T04:00:00.000Z",
        },
      });

      expect(result.kind).toBe("updated");
      if (result.kind === "updated") {
        expect(result.thread.archivedAt).toBeNull();
      }
    });
  });

  describe("thread.settled / thread.unsettled", () => {
    it("sets the settled override and timestamp", () => {
      const settledAt = "2026-04-01T05:00:00.000Z";
      const result = applyThreadDetailEvent(
        { ...baseThread, activeOrderKey: "m" },
        {
          ...baseEventFields,
          sequence: 5,
          occurredAt: settledAt,
          aggregateKind: "thread",
          aggregateId: ThreadId.make("thread-1"),
          type: "thread.settled",
          payload: {
            threadId: ThreadId.make("thread-1"),
            settledAt,
            updatedAt: settledAt,
          },
        },
      );

      expect(result.kind).toBe("updated");
      if (result.kind === "updated") {
        expect(result.thread.settledOverride).toBe("settled");
        expect(result.thread.settledAt).toBe(settledAt);
        expect(result.thread.activeOrderKey).toBeNull();
      }
    });

    it.each([
      ["user", "active"],
      ["activity", null],
    ] as const)("unsettles for %s with override %s", (reason, settledOverride) => {
      const settledThread: OrchestrationThread = {
        ...baseThread,
        settledOverride: "settled",
        settledAt: "2026-04-01T05:00:00.000Z",
      };
      const updatedAt = "2026-04-01T06:00:00.000Z";
      const result = applyThreadDetailEvent(settledThread, {
        ...baseEventFields,
        sequence: 6,
        occurredAt: updatedAt,
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-1"),
        type: "thread.unsettled",
        payload: {
          threadId: ThreadId.make("thread-1"),
          reason,
          updatedAt,
        },
      });

      expect(result.kind).toBe("updated");
      if (result.kind === "updated") {
        expect(result.thread.settledOverride).toBe(settledOverride);
        expect(result.thread.settledAt).toBeNull();
      }
    });
  });

  describe("thread.pinned / thread.unpinned", () => {
    it("sets pinnedAt", () => {
      const pinnedAt = "2026-04-01T05:00:00.000Z";
      const result = applyThreadDetailEvent(
        { ...baseThread, activeOrderKey: "m" },
        {
          ...baseEventFields,
          sequence: 5,
          occurredAt: pinnedAt,
          aggregateKind: "thread",
          aggregateId: ThreadId.make("thread-1"),
          type: "thread.pinned",
          payload: {
            threadId: ThreadId.make("thread-1"),
            pinnedAt,
            updatedAt: pinnedAt,
          },
        },
      );

      expect(result.kind).toBe("updated");
      if (result.kind === "updated") {
        expect(result.thread.pinnedAt).toBe(pinnedAt);
        expect(result.thread.activeOrderKey).toBe("m");
      }
    });

    it("clears pinnedAt", () => {
      const pinnedThread: OrchestrationThread = {
        ...baseThread,
        pinnedAt: "2026-04-01T05:00:00.000Z",
      };
      const updatedAt = "2026-04-01T06:00:00.000Z";
      const result = applyThreadDetailEvent(pinnedThread, {
        ...baseEventFields,
        sequence: 6,
        occurredAt: updatedAt,
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-1"),
        type: "thread.unpinned",
        payload: {
          threadId: ThreadId.make("thread-1"),
          updatedAt,
        },
      });

      expect(result.kind).toBe("updated");
      if (result.kind === "updated") {
        expect(result.thread.pinnedAt).toBeNull();
      }
    });
  });

  describe("thread.auto-settle-set", () => {
    it("stores and clears autoSettleDisabledAt", () => {
      const disabledAt = "2026-04-01T05:00:00.000Z";
      const off = applyThreadDetailEvent(baseThread, {
        ...baseEventFields,
        sequence: 7,
        occurredAt: disabledAt,
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-1"),
        type: "thread.auto-settle-set",
        payload: {
          threadId: ThreadId.make("thread-1"),
          autoSettleDisabledAt: disabledAt,
          updatedAt: disabledAt,
        },
      });
      expect(off.kind).toBe("updated");
      if (off.kind !== "updated") return;
      expect(off.thread.autoSettleDisabledAt).toBe(disabledAt);

      const on = applyThreadDetailEvent(off.thread, {
        ...baseEventFields,
        sequence: 8,
        occurredAt: "2026-04-01T06:00:00.000Z",
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-1"),
        type: "thread.auto-settle-set",
        payload: {
          threadId: ThreadId.make("thread-1"),
          autoSettleDisabledAt: null,
          updatedAt: "2026-04-01T06:00:00.000Z",
        },
      });
      expect(on.kind).toBe("updated");
      if (on.kind === "updated") {
        expect(on.thread.autoSettleDisabledAt).toBeNull();
      }
    });
  });

  describe("thread.meta-updated", () => {
    it.each(["f", null] as const)(
      "updates the active key to %s without activity",
      (activeOrderKey) => {
        const result = applyThreadDetailEvent(
          { ...baseThread, activeOrderKey: "m" },
          {
            ...baseEventFields,
            sequence: 5,
            occurredAt: "2026-04-01T05:00:00.000Z",
            aggregateKind: "thread",
            aggregateId: baseThread.id,
            type: "thread.meta-updated",
            payload: {
              threadId: baseThread.id,
              activeOrderKey,
              updatedAt: baseThread.updatedAt,
            },
          },
        );
        expect(result.kind).toBe("updated");
        if (result.kind === "updated") {
          expect(result.thread.activeOrderKey).toBe(activeOrderKey);
          expect(result.thread.updatedAt).toBe(baseThread.updatedAt);
        }
      },
    );

    it("patches title and branch", () => {
      const result = applyThreadDetailEvent(
        { ...baseThread, activeOrderKey: "m" },
        {
          ...baseEventFields,
          sequence: 5,
          occurredAt: "2026-04-01T05:00:00.000Z",
          aggregateKind: "thread",
          aggregateId: ThreadId.make("thread-1"),
          type: "thread.meta-updated",
          payload: {
            threadId: ThreadId.make("thread-1"),
            title: "Updated Title",
            branch: "feature/demo",
            updatedAt: "2026-04-01T05:00:00.000Z",
          },
        },
      );

      expect(result.kind).toBe("updated");
      if (result.kind === "updated") {
        expect(result.thread.title).toBe("Updated Title");
        expect(result.thread.branch).toBe("feature/demo");
        expect(result.thread.activeOrderKey).toBe("m");
        // Model selection should be unchanged since it wasn't in the payload
        expect(result.thread.modelSelection).toEqual(baseThread.modelSelection);
      }
    });

    it("sets and clears a linked pull request", () => {
      const linkedPullRequest = {
        projectId: ProjectId.make("project-1"),
        repository: "pingdotgg/t3code",
        number: 42,
        url: "https://github.com/pingdotgg/t3code/pull/42",
      };
      const linked = applyThreadDetailEvent(baseThread, {
        ...baseEventFields,
        sequence: 5,
        occurredAt: "2026-04-01T05:00:00.000Z",
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-1"),
        type: "thread.meta-updated",
        payload: {
          threadId: ThreadId.make("thread-1"),
          linkedPullRequest,
          updatedAt: "2026-04-01T05:00:00.000Z",
        },
      });

      expect(linked.kind).toBe("updated");
      if (linked.kind !== "updated") return;
      expect(linked.thread.linkedPullRequest).toEqual(linkedPullRequest);

      const cleared = applyThreadDetailEvent(linked.thread, {
        ...baseEventFields,
        sequence: 6,
        occurredAt: "2026-04-01T06:00:00.000Z",
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-1"),
        type: "thread.meta-updated",
        payload: {
          threadId: ThreadId.make("thread-1"),
          linkedPullRequest: null,
          updatedAt: "2026-04-01T06:00:00.000Z",
        },
      });

      expect(cleared.kind).toBe("updated");
      if (cleared.kind === "updated") {
        expect(cleared.thread.linkedPullRequest).toBeNull();
      }
    });
  });

  describe("thread.message-sent", () => {
    it.each([
      ["first", ["first+", "middle", "last"]],
      ["middle", ["first", "middle+", "last"]],
      ["last", ["first", "middle", "last+"]],
      ["new", ["first", "middle", "last", "+"]],
    ] as const)("applies a delta to %s without changing other messages", (id, texts) => {
      const messages = Object.freeze(
        ["first", "middle", "last"].map((name) =>
          Object.freeze({
            id: MessageId.make(name),
            role: "assistant" as const,
            text: name,
            turnId: null,
            streaming: false,
            createdAt: baseThread.createdAt,
            updatedAt: baseThread.updatedAt,
          }),
        ),
      );
      const result = applyThreadDetailEvent(
        { ...baseThread, messages },
        {
          ...baseEventFields,
          sequence: 6,
          occurredAt: baseThread.updatedAt,
          aggregateKind: "thread",
          aggregateId: baseThread.id,
          type: "thread.message-sent",
          payload: {
            threadId: baseThread.id,
            messageId: MessageId.make(id),
            role: "assistant",
            text: "+",
            turnId: null,
            streaming: true,
            createdAt: baseThread.createdAt,
            updatedAt: baseThread.updatedAt,
          },
        },
      );
      expect(result.kind).toBe("updated");
      if (result.kind !== "updated") return;
      expect(result.thread.messages.map((message) => message.text)).toEqual(texts);
      for (const [index, message] of messages.entries()) {
        if (message.id !== id) expect(result.thread.messages[index]).toBe(message);
      }
    });

    it("appends a new message", () => {
      const result = applyThreadDetailEvent(baseThread, {
        ...baseEventFields,
        sequence: 6,
        occurredAt: "2026-04-01T06:00:00.000Z",
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-1"),
        type: "thread.message-sent",
        payload: {
          threadId: ThreadId.make("thread-1"),
          messageId: MessageId.make("msg-1"),
          role: "user",
          text: "Hello, world!",
          turnId: null,
          streaming: false,
          createdAt: "2026-04-01T06:00:00.000Z",
          updatedAt: "2026-04-01T06:00:00.000Z",
        },
      });

      expect(result.kind).toBe("updated");
      if (result.kind === "updated") {
        expect(result.thread.messages).toHaveLength(1);
        expect(result.thread.messages[0]?.text).toBe("Hello, world!");
      }
    });

    it("appends text for streaming messages", () => {
      const threadWithMessage: OrchestrationThread = {
        ...baseThread,
        messages: [
          {
            id: MessageId.make("msg-2"),
            role: "assistant",
            text: "Hello",
            turnId: TurnId.make("turn-1"),
            streaming: true,
            createdAt: "2026-04-01T06:00:00.000Z",
            updatedAt: "2026-04-01T06:00:00.000Z",
          },
        ],
      };

      const result = applyThreadDetailEvent(threadWithMessage, {
        ...baseEventFields,
        sequence: 7,
        occurredAt: "2026-04-01T06:01:00.000Z",
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-1"),
        type: "thread.message-sent",
        payload: {
          threadId: ThreadId.make("thread-1"),
          messageId: MessageId.make("msg-2"),
          role: "assistant",
          text: ", world!",
          turnId: TurnId.make("turn-1"),
          streaming: true,
          createdAt: "2026-04-01T06:00:00.000Z",
          updatedAt: "2026-04-01T06:01:00.000Z",
        },
      });

      expect(result.kind).toBe("updated");
      if (result.kind === "updated") {
        expect(result.thread.messages).toHaveLength(1);
        expect(result.thread.messages[0]?.text).toBe("Hello, world!");
      }
    });

    it("updates latestTurn for assistant messages with a turn", () => {
      const result = applyThreadDetailEvent(baseThread, {
        ...baseEventFields,
        sequence: 8,
        occurredAt: "2026-04-01T07:00:00.000Z",
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-1"),
        type: "thread.message-sent",
        payload: {
          threadId: ThreadId.make("thread-1"),
          messageId: MessageId.make("msg-3"),
          role: "assistant",
          text: "Done.",
          turnId: TurnId.make("turn-1"),
          streaming: false,
          createdAt: "2026-04-01T07:00:00.000Z",
          updatedAt: "2026-04-01T07:00:00.000Z",
        },
      });

      expect(result.kind).toBe("updated");
      if (result.kind === "updated") {
        expect(result.thread.latestTurn?.turnId).toBe("turn-1");
        expect(result.thread.latestTurn?.state).toBe("completed");
        expect(result.thread.latestTurn?.assistantMessageId).toBe("msg-3");
      }
    });

    it("keeps latestTurn running for interim assistant messages while the session runs the turn", () => {
      const threadWithRunningSession: OrchestrationThread = {
        ...baseThread,
        session: {
          threadId: ThreadId.make("thread-1"),
          status: "running",
          providerName: "claude",
          runtimeMode: "full-access",
          activeTurnId: TurnId.make("turn-1"),
          lastError: null,
          updatedAt: "2026-04-01T06:59:00.000Z",
        },
        latestTurn: {
          turnId: TurnId.make("turn-1"),
          state: "running",
          requestedAt: "2026-04-01T06:59:00.000Z",
          startedAt: "2026-04-01T06:59:00.000Z",
          completedAt: null,
          assistantMessageId: null,
        },
      };

      const result = applyThreadDetailEvent(threadWithRunningSession, {
        ...baseEventFields,
        sequence: 8,
        occurredAt: "2026-04-01T07:00:00.000Z",
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-1"),
        type: "thread.message-sent",
        payload: {
          threadId: ThreadId.make("thread-1"),
          messageId: MessageId.make("msg-3"),
          role: "assistant",
          text: "Interim commentary between tool calls.",
          turnId: TurnId.make("turn-1"),
          streaming: false,
          createdAt: "2026-04-01T07:00:00.000Z",
          updatedAt: "2026-04-01T07:00:00.000Z",
        },
      });

      expect(result.kind).toBe("updated");
      if (result.kind === "updated") {
        expect(result.thread.latestTurn?.state).toBe("running");
        expect(result.thread.latestTurn?.completedAt).toBeNull();
      }
    });

    it("keeps latestTurn and checkpoints references across a streaming delta", () => {
      const streamingThread: OrchestrationThread = {
        ...baseThread,
        session: {
          threadId: ThreadId.make("thread-1"),
          status: "running",
          providerName: "claude",
          runtimeMode: "full-access",
          activeTurnId: TurnId.make("turn-1"),
          lastError: null,
          updatedAt: "2026-04-01T06:59:00.000Z",
        },
        latestTurn: {
          turnId: TurnId.make("turn-1"),
          state: "running",
          requestedAt: "2026-04-01T06:59:00.000Z",
          startedAt: "2026-04-01T06:59:00.000Z",
          completedAt: null,
          assistantMessageId: MessageId.make("msg-2"),
        },
        messages: [
          {
            id: MessageId.make("msg-2"),
            role: "assistant",
            text: "Hello",
            turnId: TurnId.make("turn-1"),
            streaming: true,
            createdAt: "2026-04-01T06:00:00.000Z",
            updatedAt: "2026-04-01T06:00:00.000Z",
          },
        ],
        checkpoints: [
          {
            turnId: TurnId.make("turn-1"),
            checkpointTurnCount: 1,
            checkpointRef: CheckpointRef.make("ref-1"),
            status: "ready",
            files: [],
            assistantMessageId: MessageId.make("msg-2"),
            completedAt: "2026-04-01T06:00:30.000Z",
          },
        ],
      };

      const result = applyThreadDetailEvent(streamingThread, {
        ...baseEventFields,
        sequence: 9,
        occurredAt: "2026-04-01T07:00:00.000Z",
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-1"),
        type: "thread.message-sent",
        payload: {
          threadId: ThreadId.make("thread-1"),
          messageId: MessageId.make("msg-2"),
          role: "assistant",
          text: ", world",
          turnId: TurnId.make("turn-1"),
          streaming: true,
          createdAt: "2026-04-01T06:00:00.000Z",
          updatedAt: "2026-04-01T07:00:00.000Z",
        },
      });

      expect(result.kind).toBe("updated");
      if (result.kind === "updated") {
        expect(result.thread.messages).not.toBe(streamingThread.messages);
        expect(result.thread.messages[0]?.text).toBe("Hello, world");
        expect(result.thread.latestTurn).toBe(streamingThread.latestTurn);
        expect(result.thread.checkpoints).toBe(streamingThread.checkpoints);
      }
    });

    it("replaces latestTurn and checkpoints when the first assistant message binds the turn", () => {
      const unboundThread: OrchestrationThread = {
        ...baseThread,
        session: {
          threadId: ThreadId.make("thread-1"),
          status: "running",
          providerName: "claude",
          runtimeMode: "full-access",
          activeTurnId: TurnId.make("turn-1"),
          lastError: null,
          updatedAt: "2026-04-01T06:59:00.000Z",
        },
        latestTurn: {
          turnId: TurnId.make("turn-1"),
          state: "running",
          requestedAt: "2026-04-01T06:59:00.000Z",
          startedAt: "2026-04-01T06:59:00.000Z",
          completedAt: null,
          assistantMessageId: null,
        },
        checkpoints: [
          {
            turnId: TurnId.make("turn-1"),
            checkpointTurnCount: 1,
            checkpointRef: CheckpointRef.make("ref-1"),
            status: "ready",
            files: [],
            assistantMessageId: null,
            completedAt: "2026-04-01T06:59:30.000Z",
          },
        ],
      };

      const result = applyThreadDetailEvent(unboundThread, {
        ...baseEventFields,
        sequence: 9,
        occurredAt: "2026-04-01T07:00:00.000Z",
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-1"),
        type: "thread.message-sent",
        payload: {
          threadId: ThreadId.make("thread-1"),
          messageId: MessageId.make("msg-2"),
          role: "assistant",
          text: "Hello",
          turnId: TurnId.make("turn-1"),
          streaming: true,
          createdAt: "2026-04-01T07:00:00.000Z",
          updatedAt: "2026-04-01T07:00:00.000Z",
        },
      });

      expect(result.kind).toBe("updated");
      if (result.kind === "updated") {
        expect(result.thread.latestTurn).not.toBe(unboundThread.latestTurn);
        expect(result.thread.latestTurn?.assistantMessageId).toBe("msg-2");
        expect(result.thread.checkpoints).not.toBe(unboundThread.checkpoints);
        expect(result.thread.checkpoints[0]?.assistantMessageId).toBe("msg-2");
      }
    });
  });

  describe("thread.session-set", () => {
    it("settles a running latestTurn when the session leaves the running status", () => {
      const threadWithRunningTurn: OrchestrationThread = {
        ...baseThread,
        latestTurn: {
          turnId: TurnId.make("turn-1"),
          state: "running",
          requestedAt: "2026-04-01T07:00:00.000Z",
          startedAt: "2026-04-01T07:00:00.000Z",
          completedAt: null,
          assistantMessageId: MessageId.make("msg-3"),
        },
      };

      const result = applyThreadDetailEvent(threadWithRunningTurn, {
        ...baseEventFields,
        sequence: 9,
        occurredAt: "2026-04-01T08:00:00.000Z",
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-1"),
        type: "thread.session-set",
        payload: {
          threadId: ThreadId.make("thread-1"),
          session: {
            threadId: ThreadId.make("thread-1"),
            status: "ready",
            providerName: "claude",
            runtimeMode: "full-access",
            activeTurnId: null,
            lastError: null,
            updatedAt: "2026-04-01T08:00:00.000Z",
          },
        },
      });

      expect(result.kind).toBe("updated");
      if (result.kind === "updated") {
        expect(result.thread.latestTurn?.state).toBe("completed");
        expect(result.thread.latestTurn?.completedAt).toBe("2026-04-01T08:00:00.000Z");
      }
    });

    it("updates session and latestTurn for a running session", () => {
      const result = applyThreadDetailEvent(baseThread, {
        ...baseEventFields,
        sequence: 9,
        occurredAt: "2026-04-01T08:00:00.000Z",
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-1"),
        type: "thread.session-set",
        payload: {
          threadId: ThreadId.make("thread-1"),
          session: {
            threadId: ThreadId.make("thread-1"),
            status: "running",
            providerName: "codex",
            runtimeMode: "full-access",
            activeTurnId: TurnId.make("turn-1"),
            lastError: null,
            updatedAt: "2026-04-01T08:00:00.000Z",
          },
        },
      });

      expect(result.kind).toBe("updated");
      if (result.kind === "updated") {
        expect(result.thread.session?.status).toBe("running");
        expect(result.thread.latestTurn?.turnId).toBe("turn-1");
        expect(result.thread.latestTurn?.state).toBe("running");
      }
    });
  });

  describe("thread.session-stop-requested", () => {
    it("marks session as stopped", () => {
      const threadWithSession: OrchestrationThread = {
        ...baseThread,
        session: {
          threadId: ThreadId.make("thread-1"),
          status: "running",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: TurnId.make("turn-1"),
          lastError: null,
          updatedAt: "2026-04-01T08:00:00.000Z",
        },
      };

      const result = applyThreadDetailEvent(threadWithSession, {
        ...baseEventFields,
        sequence: 10,
        occurredAt: "2026-04-01T09:00:00.000Z",
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-1"),
        type: "thread.session-stop-requested",
        payload: {
          threadId: ThreadId.make("thread-1"),
          createdAt: "2026-04-01T09:00:00.000Z",
        },
      });

      expect(result.kind).toBe("updated");
      if (result.kind === "updated") {
        expect(result.thread.session?.status).toBe("stopped");
        expect(result.thread.session?.activeTurnId).toBeNull();
      }
    });

    it("returns unchanged when no session exists", () => {
      const result = applyThreadDetailEvent(baseThread, {
        ...baseEventFields,
        sequence: 10,
        occurredAt: "2026-04-01T09:00:00.000Z",
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-1"),
        type: "thread.session-stop-requested",
        payload: {
          threadId: ThreadId.make("thread-1"),
          createdAt: "2026-04-01T09:00:00.000Z",
        },
      });
      expect(result.kind).toBe("unchanged");
    });
  });

  describe("thread.proposed-plan-upserted", () => {
    it("adds a proposed plan", () => {
      const result = applyThreadDetailEvent(baseThread, {
        ...baseEventFields,
        sequence: 11,
        occurredAt: "2026-04-01T10:00:00.000Z",
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-1"),
        type: "thread.proposed-plan-upserted",
        payload: {
          threadId: ThreadId.make("thread-1"),
          proposedPlan: {
            id: "plan-1",
            turnId: TurnId.make("turn-1"),
            planMarkdown: "## Plan\n- Do stuff",
            implementedAt: null,
            implementationThreadId: null,
            createdAt: "2026-04-01T10:00:00.000Z",
            updatedAt: "2026-04-01T10:00:00.000Z",
          },
        },
      });

      expect(result.kind).toBe("updated");
      if (result.kind === "updated") {
        expect(result.thread.proposedPlans).toHaveLength(1);
        expect(result.thread.proposedPlans[0]?.id).toBe("plan-1");
      }
    });
  });

  describe("thread.activity-appended", () => {
    // A provider sends a call's last update with its completion: the same
    // instant, the same payload but its status (`isToolCallEcho`). With no
    // sequence, rows of one instant sort by their random ids, so the echo
    // lands before or after the completion. Run 12: every browser check's
    // screenshot rode in both, and a live page held each picture twice.
    describe("a call's echoed update is dropped wherever it sorts", () => {
      const AT = "2026-04-01T11:00:09.000Z";
      const payloadOf = (status: string, output = "screenshot") => ({
        itemType: "mcp_tool_call",
        toolCallId: "call-1",
        status,
        data: { toolName: "mcp__zerops__zerops_browser", zerops: { resultText: output } },
      });
      type Row = readonly [id: string, kind: string, createdAt?: string, output?: string];
      const rowOf = ([id, kind, createdAt = AT, output]: Row) => ({
        id: EventId.make(id),
        tone: "tool" as const,
        kind,
        summary: "MCP tool call",
        payload: payloadOf(kind === "tool.completed" ? "completed" : "inProgress", output),
        turnId: TurnId.make("turn-1"),
        createdAt,
      });
      const START: Row = ["m-start", "tool.started", "2026-04-01T11:00:00.000Z"];
      const appendAll = (rows: ReadonlyArray<Row>) =>
        rows.reduce<OrchestrationThread>((thread, row, index) => {
          const result = applyThreadDetailEvent(thread, {
            ...baseEventFields,
            sequence: 100 + index,
            occurredAt: AT,
            aggregateKind: "thread",
            aggregateId: ThreadId.make("thread-1"),
            type: "thread.activity-appended",
            payload: { threadId: ThreadId.make("thread-1"), activity: rowOf(row) },
          });
          return result.kind === "updated" ? result.thread : thread;
        }, baseThread);

      it.each<{ name: string; rows: ReadonlyArray<Row>; kept: ReadonlyArray<string> }>([
        {
          name: "the echo first, sorting before its completion",
          rows: [START, ["b-echo", "tool.updated"], ["c-done", "tool.completed"]],
          kept: ["m-start", "c-done"],
        },
        {
          name: "the echo first, its completion sorting before it",
          rows: [START, ["u-echo", "tool.updated"], ["c-done", "tool.completed"]],
          kept: ["m-start", "c-done"],
        },
        {
          name: "the completion first, the echo sorting after it",
          rows: [START, ["c-done", "tool.completed"], ["u-echo", "tool.updated"]],
          kept: ["m-start", "c-done"],
        },
        {
          name: "the completion first, the echo sorting before it",
          rows: [START, ["c-done", "tool.completed"], ["b-echo", "tool.updated"]],
          kept: ["m-start", "c-done"],
        },
        {
          name: "a call with no start, its completion first",
          rows: [
            ["c-done", "tool.completed"],
            ["b-echo", "tool.updated"],
          ],
          kept: ["c-done"],
        },
        {
          name: "a call with no start, its echo first",
          rows: [
            ["u-echo", "tool.updated"],
            ["c-done", "tool.completed"],
          ],
          kept: ["c-done"],
        },
        {
          name: "an update after the completion with new output stays",
          rows: [
            START,
            ["c-done", "tool.completed"],
            ["u-late", "tool.updated", "2026-04-01T11:00:10.000Z", "the rest of its output"],
          ],
          kept: ["m-start", "c-done", "u-late"],
        },
        {
          name: "an in-flight update at the completion's instant with other output stays",
          rows: [
            START,
            ["b-flight", "tool.updated", AT, "half of it"],
            ["c-done", "tool.completed"],
          ],
          kept: ["m-start", "b-flight", "c-done"],
        },
      ])("$name", ({ rows, kept }) => {
        expect(appendAll(rows).activities.map((activity) => activity.id)).toEqual(kept);
      });

      it.each(["update-first", "completion-first"])(
        "a retained screenshot appears once when its echo arrives %s",
        (order) => {
          const rows: ReadonlyArray<Row> =
            order === "update-first"
              ? [
                  ["u-echo", "tool.updated"],
                  ["c-done", "tool.completed"],
                ]
              : [
                  ["c-done", "tool.completed"],
                  ["u-echo", "tool.updated"],
                ];
          const thread = rows.reduce<OrchestrationThread>((current, row, index) => {
            const activity = rowOf(row);
            const result = applyThreadDetailEvent(current, {
              ...baseEventFields,
              sequence: 100 + index,
              occurredAt: AT,
              aggregateKind: "thread",
              aggregateId: ThreadId.make("thread-1"),
              type: "thread.activity-appended",
              payload: {
                threadId: ThreadId.make("thread-1"),
                activity: {
                  ...activity,
                  payload: {
                    ...payloadOf(row[1] === "tool.completed" ? "completed" : "inProgress"),
                    data: {
                      toolName: "mcp__zerops__zerops_browser",
                      zerops: {
                        images: [
                          {
                            mimeType: "image/png",
                            asset: {
                              id: row[0],
                              ownerId: row[0],
                              threadId: "thread-1",
                              name: "tool-image",
                              provenance: "capture",
                              original: {
                                status: "ready",
                                digest: "a".repeat(64),
                                mimeType: "image/png",
                                sizeBytes: 200,
                              },
                            },
                          },
                        ],
                      },
                    },
                  },
                },
              },
            });
            return result.kind === "updated" ? result.thread : current;
          }, baseThread);
          expect(thread.activities.map((activity) => activity.id)).toEqual(["c-done"]);
        },
      );

      it("an echo landing after its completion changes nothing", () => {
        const done = appendAll([START, ["c-done", "tool.completed"]]);
        const result = applyThreadDetailEvent(done, {
          ...baseEventFields,
          sequence: 200,
          occurredAt: AT,
          aggregateKind: "thread",
          aggregateId: ThreadId.make("thread-1"),
          type: "thread.activity-appended",
          payload: {
            threadId: ThreadId.make("thread-1"),
            activity: rowOf(["u-echo", "tool.updated"]),
          },
        });
        expect(result.kind).toBe("unchanged");
      });
    });

    it("adds an activity", () => {
      const result = applyThreadDetailEvent(baseThread, {
        ...baseEventFields,
        sequence: 12,
        occurredAt: "2026-04-01T11:00:00.000Z",
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-1"),
        type: "thread.activity-appended",
        payload: {
          threadId: ThreadId.make("thread-1"),
          activity: {
            id: EventId.make("activity-1"),
            tone: "tool",
            kind: "file-edit",
            summary: "Edited src/index.ts",
            payload: {},
            turnId: TurnId.make("turn-1"),
            createdAt: "2026-04-01T11:00:00.000Z",
          },
        },
      });

      expect(result.kind).toBe("updated");
      if (result.kind === "updated") {
        expect(result.thread.activities).toHaveLength(1);
        expect(result.thread.activities[0]?.kind).toBe("file-edit");
      }
    });

    it("preserves the complete activity history when live events arrive", () => {
      const existingActivities = Array.from({ length: 129 }, (_, index) => ({
        id: EventId.make(`activity-${index}`),
        tone: "tool" as const,
        kind: "command",
        summary: `Ran command ${index}`,
        payload: {},
        turnId: TurnId.make("turn-1"),
        sequence: index,
        createdAt: "2026-04-01T11:00:00.000Z",
      }));
      const result = applyThreadDetailEvent(
        { ...baseThread, activities: existingActivities },
        {
          ...baseEventFields,
          sequence: 130,
          occurredAt: "2026-04-01T11:01:00.000Z",
          aggregateKind: "thread",
          aggregateId: ThreadId.make("thread-1"),
          type: "thread.activity-appended",
          payload: {
            threadId: ThreadId.make("thread-1"),
            activity: {
              id: EventId.make("activity-129"),
              tone: "tool",
              kind: "command",
              summary: "Ran command 129",
              payload: {},
              turnId: TurnId.make("turn-1"),
              sequence: 129,
              createdAt: "2026-04-01T11:01:00.000Z",
            },
          },
        },
      );

      expect(result.kind).toBe("updated");
      if (result.kind === "updated") {
        expect(result.thread.activities).toHaveLength(130);
        expect(result.thread.activities[0]?.id).toBe("activity-0");
      }
    });

    it("re-sorts when an activity arrives out of order", () => {
      const makeActivity = (id: string, sequence: number) => ({
        id: EventId.make(id),
        tone: "tool" as const,
        kind: "command",
        summary: `Ran command ${sequence}`,
        payload: {},
        turnId: TurnId.make("turn-1"),
        sequence,
        createdAt: "2026-04-01T11:00:00.000Z",
      });
      const result = applyThreadDetailEvent(
        {
          ...baseThread,
          activities: [makeActivity("activity-a", 1), makeActivity("activity-c", 3)],
        },
        {
          ...baseEventFields,
          sequence: 131,
          occurredAt: "2026-04-01T11:01:00.000Z",
          aggregateKind: "thread",
          aggregateId: ThreadId.make("thread-1"),
          type: "thread.activity-appended",
          payload: {
            threadId: ThreadId.make("thread-1"),
            activity: makeActivity("activity-b", 2),
          },
        },
      );

      expect(result.kind).toBe("updated");
      if (result.kind === "updated") {
        expect(result.thread.activities.map((activity) => activity.id)).toEqual([
          "activity-a",
          "activity-b",
          "activity-c",
        ]);
      }
    });

    it("repairs snapshot ordering before fast-path appends engage", () => {
      const makeActivity = (id: string, sequence: number | null) => ({
        id: EventId.make(id),
        tone: "tool" as const,
        kind: "command",
        summary: `Ran ${id}`,
        payload: {},
        turnId: TurnId.make("turn-1"),
        ...(sequence === null ? {} : { sequence }),
        createdAt: "2026-04-01T11:00:00.000Z",
      });
      // Snapshot loads deliver null-sequence rows first (DB order), which
      // activityOrder sorts last; an in-order live append must not freeze
      // that prefix.
      const result = applyThreadDetailEvent(
        {
          ...baseThread,
          activities: [makeActivity("activity-null", null), makeActivity("activity-a", 1)],
        },
        {
          ...baseEventFields,
          sequence: 135,
          occurredAt: "2026-04-01T11:01:00.000Z",
          aggregateKind: "thread",
          aggregateId: ThreadId.make("thread-1"),
          type: "thread.activity-appended",
          payload: {
            threadId: ThreadId.make("thread-1"),
            activity: makeActivity("activity-b", 2),
          },
        },
      );

      expect(result.kind).toBe("updated");
      if (result.kind === "updated") {
        expect(result.thread.activities.map((activity) => activity.id)).toEqual([
          "activity-a",
          "activity-b",
          "activity-null",
        ]);
      }
    });

    it("dedupes a re-delivery arriving right after an in-order append", () => {
      const makeActivity = (id: string, sequence: number, summary: string) => ({
        id: EventId.make(id),
        tone: "tool" as const,
        kind: "command",
        summary,
        payload: {},
        turnId: TurnId.make("turn-1"),
        sequence,
        createdAt: "2026-04-01T11:00:00.000Z",
      });
      const makeEvent = (sequence: number, activity: ReturnType<typeof makeActivity>) =>
        ({
          ...baseEventFields,
          sequence,
          occurredAt: "2026-04-01T11:01:00.000Z",
          aggregateKind: "thread",
          aggregateId: ThreadId.make("thread-1"),
          type: "thread.activity-appended",
          payload: { threadId: ThreadId.make("thread-1"), activity },
        }) as const;
      const first = applyThreadDetailEvent(
        { ...baseThread, activities: [makeActivity("activity-a", 1, "first")] },
        makeEvent(133, makeActivity("activity-b", 2, "second")),
      );
      expect(first.kind).toBe("updated");
      if (first.kind !== "updated") {
        return;
      }
      const second = applyThreadDetailEvent(
        first.thread,
        makeEvent(134, makeActivity("activity-c", 3, "third")),
      );
      expect(second.kind).toBe("updated");
      if (second.kind !== "updated") {
        return;
      }
      const third = applyThreadDetailEvent(
        second.thread,
        makeEvent(135, makeActivity("activity-c", 4, "third (redelivered)")),
      );
      expect(third.kind).toBe("updated");
      if (third.kind === "updated") {
        expect(third.thread.activities.map((activity) => activity.id)).toEqual([
          "activity-a",
          "activity-b",
          "activity-c",
        ]);
        expect(third.thread.activities[2]?.summary).toBe("third (redelivered)");
      }
    });

    it("replaces a re-delivered activity instead of duplicating it", () => {
      const makeActivity = (id: string, sequence: number, summary: string) => ({
        id: EventId.make(id),
        tone: "tool" as const,
        kind: "command",
        summary,
        payload: {},
        turnId: TurnId.make("turn-1"),
        sequence,
        createdAt: "2026-04-01T11:00:00.000Z",
      });
      const result = applyThreadDetailEvent(
        {
          ...baseThread,
          activities: [
            makeActivity("activity-a", 1, "first"),
            makeActivity("activity-b", 2, "second"),
          ],
        },
        {
          ...baseEventFields,
          sequence: 132,
          occurredAt: "2026-04-01T11:01:00.000Z",
          aggregateKind: "thread",
          aggregateId: ThreadId.make("thread-1"),
          type: "thread.activity-appended",
          payload: {
            threadId: ThreadId.make("thread-1"),
            activity: makeActivity("activity-b", 2, "second (redelivered)"),
          },
        },
      );

      expect(result.kind).toBe("updated");
      if (result.kind === "updated") {
        expect(result.thread.activities.map((activity) => activity.id)).toEqual([
          "activity-a",
          "activity-b",
        ]);
        expect(result.thread.activities[1]?.summary).toBe("second (redelivered)");
      }
    });

    it("replaces earlier resolvable context-window updates for the same turn", () => {
      const contextWindowActivity = (id: string, sequence: number, usedTokens: unknown) => ({
        id: EventId.make(id),
        tone: "info" as const,
        kind: "context-window.updated",
        summary: "Context window updated",
        payload: { usedTokens },
        turnId: TurnId.make("turn-1"),
        sequence,
        createdAt: "2026-04-01T11:00:00.000Z",
      });
      const otherTurnActivity = contextWindowActivity("activity-other-turn", 2, 500);
      const existingActivities = [
        contextWindowActivity("activity-cw-1", 1, 1_000),
        { ...otherTurnActivity, turnId: TurnId.make("turn-0") },
        // Malformed row (no usedTokens): must survive, and must not be
        // treated as the latest value by consumers.
        contextWindowActivity("activity-cw-malformed", 3, undefined),
        contextWindowActivity("activity-cw-2", 4, 2_000),
      ];

      const result = applyThreadDetailEvent(
        { ...baseThread, activities: existingActivities },
        {
          ...baseEventFields,
          sequence: 20,
          occurredAt: "2026-04-01T11:02:00.000Z",
          aggregateKind: "thread",
          aggregateId: ThreadId.make("thread-1"),
          type: "thread.activity-appended",
          payload: {
            threadId: ThreadId.make("thread-1"),
            activity: contextWindowActivity("activity-cw-3", 5, 3_000),
          },
        },
      );

      expect(result.kind).toBe("updated");
      if (result.kind === "updated") {
        const ids = result.thread.activities.map((activity) => activity.id);
        // Same-turn resolvable rows collapse to the newest; the other turn's
        // row and the malformed row are untouched.
        expect(ids).toEqual(["activity-other-turn", "activity-cw-malformed", "activity-cw-3"]);
      }
    });

    it("streams context-window updates to the same history a from-scratch fold gives", () => {
      type Activity = OrchestrationThread["activities"][number];
      const resolvable = (activity: Activity) => {
        const used = (activity.payload as { usedTokens?: unknown } | null)?.usedTokens;
        return (
          activity.kind === "context-window.updated" &&
          typeof used === "number" &&
          Number.isFinite(used) &&
          used >= 0
        );
      };
      // The rule as it reads: a redelivery replaces its row, a resolvable
      // update replaces the same turn's resolvable ones, all in activity order.
      const reference = (activities: ReadonlyArray<Activity>, next: Activity) =>
        [
          ...activities.filter(
            (entry) =>
              entry.id !== next.id &&
              !(resolvable(next) && entry.turnId === next.turnId && resolvable(entry)),
          ),
          next,
        ].toSorted(activityOrder);
      const row = (index: number, turn: string, kind: string, usedTokens?: unknown): Activity => ({
        id: EventId.make(`activity-${index}`),
        tone: "info",
        kind,
        summary: kind,
        payload: kind === "context-window.updated" ? { usedTokens } : {},
        turnId: TurnId.make(turn),
        sequence: index,
        createdAt: `2026-04-01T11:00:${String(index).padStart(2, "0")}.000Z`,
      });
      const stream: Activity[] = [];
      for (let index = 1; index <= 40; index += 1) {
        const turn = index <= 20 ? "turn-1" : "turn-2";
        stream.push(
          index % 7 === 0
            ? row(index, turn, "context-window.updated", Number.NaN)
            : index % 3 === 0
              ? row(index, turn, "tool.started")
              : row(index, turn, "context-window.updated", index * 100),
        );
      }
      // A late row for the first turn, and a redelivery.
      stream.push(row(41, "turn-1", "context-window.updated", 9_000));
      stream.push({ ...row(41, "turn-1", "context-window.updated", 9_500) });

      let thread: OrchestrationThread = baseThread;
      let expected: ReadonlyArray<Activity> = [];
      for (const [index, activity] of stream.entries()) {
        const result = applyThreadDetailEvent(thread, {
          ...baseEventFields,
          sequence: 100 + index,
          occurredAt: "2026-04-01T11:05:00.000Z",
          aggregateKind: "thread",
          aggregateId: ThreadId.make("thread-1"),
          type: "thread.activity-appended",
          payload: { threadId: ThreadId.make("thread-1"), activity },
        });
        expect(result.kind).toBe("updated");
        if (result.kind !== "updated") return;
        const previous = thread.activities;
        expected = reference(expected, activity);
        expect(result.thread.activities).toEqual(expected);
        // Rows the update did not replace are the same objects.
        for (const entry of result.thread.activities) {
          if (entry !== activity) expect(previous).toContain(entry);
        }
        thread = result.thread;
      }
    });

    it("does not collapse context-window history for a malformed update", () => {
      const resolvable = {
        id: EventId.make("activity-cw-resolvable"),
        tone: "info" as const,
        kind: "context-window.updated",
        summary: "Context window updated",
        payload: { usedTokens: 1_000 },
        turnId: TurnId.make("turn-1"),
        sequence: 1,
        createdAt: "2026-04-01T11:00:00.000Z",
      };

      const result = applyThreadDetailEvent(
        { ...baseThread, activities: [resolvable] },
        {
          ...baseEventFields,
          sequence: 21,
          occurredAt: "2026-04-01T11:03:00.000Z",
          aggregateKind: "thread",
          aggregateId: ThreadId.make("thread-1"),
          type: "thread.activity-appended",
          payload: {
            threadId: ThreadId.make("thread-1"),
            activity: {
              ...resolvable,
              id: EventId.make("activity-cw-broken"),
              payload: { usedTokens: Number.NaN },
              sequence: 2,
            },
          },
        },
      );

      expect(result.kind).toBe("updated");
      if (result.kind === "updated") {
        // The resolvable row must survive so consumers can still derive a
        // usage value by walking backwards past the malformed row.
        const ids = result.thread.activities.map((activity) => activity.id);
        expect(ids).toEqual(["activity-cw-resolvable", "activity-cw-broken"]);
      }
    });
  });

  describe("thread.turn-diff-completed", () => {
    it.each([null, "interrupted"] as const)(
      "adds a checkpoint without replacing a %s turn outcome",
      (previousState) => {
        const result = applyThreadDetailEvent(
          {
            ...baseThread,
            latestTurn:
              previousState === null
                ? null
                : {
                    turnId: TurnId.make("turn-1"),
                    state: previousState,
                    requestedAt: "2026-04-01T11:00:00.000Z",
                    startedAt: "2026-04-01T11:00:00.000Z",
                    completedAt: "2026-04-01T12:00:00.000Z",
                    assistantMessageId: null,
                  },
          },
          {
            ...baseEventFields,
            sequence: 13,
            occurredAt: "2026-04-01T12:00:00.000Z",
            aggregateKind: "thread",
            aggregateId: ThreadId.make("thread-1"),
            type: "thread.turn-diff-completed",
            payload: {
              threadId: ThreadId.make("thread-1"),
              turnId: TurnId.make("turn-1"),
              checkpointTurnCount: 1,
              checkpointRef: CheckpointRef.make("ref-1"),
              status: "ready",
              files: [],
              assistantMessageId: MessageId.make("msg-3"),
              completedAt: "2026-04-01T12:00:00.000Z",
            },
          },
        );

        expect(result.kind).toBe("updated");
        if (result.kind === "updated") {
          expect(result.thread.checkpoints).toHaveLength(1);
          expect(result.thread.latestTurn?.turnId).toBe("turn-1");
          expect(result.thread.latestTurn?.state).toBe(previousState ?? "completed");
        }
      },
    );
  });

  describe("thread.reverted", () => {
    it("filters entities to retained turns", () => {
      const threadWithData: OrchestrationThread = {
        ...baseThread,
        messages: [
          {
            id: MessageId.make("msg-1"),
            role: "user",
            text: "First",
            turnId: null,
            streaming: false,
            createdAt: "2026-04-01T01:00:00.000Z",
            updatedAt: "2026-04-01T01:00:00.000Z",
          },
          {
            id: MessageId.make("msg-2"),
            role: "assistant",
            text: "Response 1",
            turnId: TurnId.make("turn-1"),
            streaming: false,
            createdAt: "2026-04-01T02:00:00.000Z",
            updatedAt: "2026-04-01T02:00:00.000Z",
          },
          {
            id: MessageId.make("msg-3"),
            role: "assistant",
            text: "Response 2",
            turnId: TurnId.make("turn-2"),
            streaming: false,
            createdAt: "2026-04-01T03:00:00.000Z",
            updatedAt: "2026-04-01T03:00:00.000Z",
          },
        ],
        checkpoints: [
          {
            turnId: TurnId.make("turn-1"),
            checkpointTurnCount: 1,
            checkpointRef: CheckpointRef.make("ref-1"),
            status: "ready",
            files: [],
            assistantMessageId: MessageId.make("msg-2"),
            completedAt: "2026-04-01T02:00:00.000Z",
          },
          {
            turnId: TurnId.make("turn-2"),
            checkpointTurnCount: 2,
            checkpointRef: CheckpointRef.make("ref-2"),
            status: "ready",
            files: [],
            assistantMessageId: MessageId.make("msg-3"),
            completedAt: "2026-04-01T03:00:00.000Z",
          },
        ],
      };

      const result = applyThreadDetailEvent(threadWithData, {
        ...baseEventFields,
        sequence: 14,
        occurredAt: "2026-04-01T04:00:00.000Z",
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-1"),
        type: "thread.reverted",
        payload: {
          threadId: ThreadId.make("thread-1"),
          turnCount: 1,
        },
      });

      expect(result.kind).toBe("updated");
      if (result.kind === "updated") {
        // turn-2 checkpoint is filtered out (turnCount 2 > revert target 1)
        expect(result.thread.checkpoints).toHaveLength(1);
        expect(result.thread.checkpoints[0]?.turnId).toBe("turn-1");
        // msg-3 (turn-2) is filtered, msg-1 (no turn) and msg-2 (turn-1) remain
        expect(result.thread.messages).toHaveLength(2);
        expect(result.thread.latestTurn?.turnId).toBe("turn-1");
      }
    });
  });

  describe("no-op events", () => {
    it("returns unchanged for approval-response-requested", () => {
      const result = applyThreadDetailEvent(baseThread, {
        ...baseEventFields,
        sequence: 15,
        occurredAt: "2026-04-01T13:00:00.000Z",
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-1"),
        type: "thread.approval-response-requested",
        payload: {
          threadId: ThreadId.make("thread-1"),
          requestId: "req-1",
          decision: "approve",
          createdAt: "2026-04-01T13:00:00.000Z",
        },
      } as any);
      expect(result.kind).toBe("unchanged");
    });
  });
});

it("retains per-root incomplete history in the live thread projection", () => {
  const history = {
    runId: "run-1",
    coverage: "partial" as const,
    semantics: "observed-workspace" as const,
    representation: "git-normalized" as const,
    policyVersion: "git-v1",
    roots: [
      {
        root: { rootId: "api", label: "api", remotePath: "/var/www", pathPrefix: "api/" },
        before: { status: "missing-baseline" as const, reason: "Initial state is unavailable." },
        after: { status: "unavailable" as const, reason: "Service is unreachable." },
      },
    ],
  };
  const result = applyThreadDetailEvent(baseThread, {
    ...baseEventFields,
    sequence: 1,
    occurredAt: "2026-09-07T10:00:00.000Z",
    aggregateKind: "thread",
    aggregateId: baseThread.id,
    type: "thread.turn-diff-completed",
    payload: {
      threadId: baseThread.id,
      turnId: TurnId.make("turn-1"),
      checkpointTurnCount: 1,
      checkpointRef: CheckpointRef.make("refs/mate/run-1"),
      status: "ready",
      files: [],
      history,
      assistantMessageId: null,
      completedAt: "2026-09-07T10:00:00.000Z",
    },
  });
  expect(result.kind).toBe("updated");
  if (result.kind === "updated") expect(result.thread.checkpoints[0]?.history).toEqual(history);
});

it("restart evidence stays on the interrupted turn after an accepted continuation", () => {
  const turnId = TurnId.make("cut-turn");
  const at = "2026-10-08T08:24:39.700Z";
  const interruption = {
    turnId,
    restart: { cause: "replaced" as const, at },
    continuation: "manual" as const,
  };
  const result = applyThreadDetailEvent(
    {
      ...baseThread,
      latestTurn: {
        turnId,
        state: "running",
        requestedAt: baseThread.createdAt,
        startedAt: baseThread.createdAt,
        completedAt: null,
        assistantMessageId: null,
      },
    },
    {
      ...baseEventFields,
      sequence: 1,
      aggregateKind: "thread",
      aggregateId: baseThread.id,
      occurredAt: at,
      type: "thread.session-set",
      payload: {
        threadId: baseThread.id,
        session: {
          threadId: baseThread.id,
          status: "interrupted",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: null,
          lastError: null,
          interruption,
          updatedAt: at,
        },
      },
    },
  );
  expect(result.kind).toBe("updated");
  if (result.kind !== "updated") return;
  expect(result.thread.latestTurn?.state).toBe("interrupted");
  expect(result.thread.activities[0]).toMatchObject({
    turnId,
    kind: "runtime.interrupted",
    payload: { interruption },
  });
  const accepted = applyThreadDetailEvent(result.thread, {
    ...baseEventFields,
    sequence: 2,
    aggregateKind: "thread",
    aggregateId: baseThread.id,
    occurredAt: at,
    type: "thread.turn-start-requested",
    payload: {
      threadId: baseThread.id,
      messageId: MessageId.make("continue"),
      runtimeMode: "full-access",
      interactionMode: "default",
      createdAt: at,
    },
  });
  expect(accepted.kind).toBe("updated");
  if (accepted.kind !== "updated") return;
  expect(accepted.thread.session?.interruption).toBeNull();
  expect(accepted.thread.activities).toEqual(result.thread.activities);
});
