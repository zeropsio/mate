import { type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { RuntimeTaskId, type TaskRunHandles } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import { claudeSignedOutMessage } from "../Drivers/ClaudeHome.ts";
import {
  PROVIDER,
  type ClaudeSessionContext,
  type ClaudeAdapterKit,
  asRuntimeItemId,
  asCanonicalTurnId,
  nativeProviderRefs,
} from "./ClaudeSessionState.ts";
import { toolResultBlocksFromUserMessage, toolNonExecutionKind } from "./ClaudeSdkMessages.ts";
import { extractExitPlanModePlan, toolResultStreamKind } from "./ClaudeToolItems.ts";
import {
  rememberPendingTaskEntry,
  readClaudeToolUseResult,
  applyClaudeTaskToolResult,
  sanitizeSessionUrl,
  trimmedString,
  agentIdForParentToolUse,
  taskLinkageFor,
} from "./ClaudeTasks.ts";
import { normalizeClaudeActiveTokenUsage } from "./ClaudeTokenUsage.ts";
import { type ClaudeResumeCursor } from "./ClaudeResumeCursor.ts";
import { type ClaudeRuntimeEmit } from "./ClaudeRuntimeEmit.ts";
import { type ClaudeAssistantText } from "./ClaudeAssistantText.ts";
import { type ClaudeToolCalls } from "./ClaudeToolCalls.ts";
import { type ClaudeTurns } from "./ClaudeTurns.ts";

/** The SDK's user and assistant messages: tool results, replies, plans and helpers. */
export const makeClaudeMessages = Effect.fn("makeClaudeMessages")(function* (
  kit: ClaudeAdapterKit,
  parts: {
    readonly resumeCursor: ClaudeResumeCursor;
    readonly runtimeEmit: ClaudeRuntimeEmit;
    readonly assistantText: ClaudeAssistantText;
    readonly toolCalls: ClaudeToolCalls;
    readonly turns: ClaudeTurns;
  },
  claudeEnvironment: NodeJS.ProcessEnv,
) {
  const path = yield* Path.Path;
  const { makeEventStamp, offerRuntimeEvent } = kit;
  const { updateResumeCursor } = parts.resumeCursor;
  const { emitProposedPlanCompleted, emitClaudeTaskPlanUpdated } = parts.runtimeEmit;
  const { backfillAssistantTextBlocksFromSnapshot, backfillThinkingFromSnapshot } =
    parts.assistantText;
  const { presentCalls, syncSnapshotCalls } = parts.toolCalls;
  const { startSyntheticTurn } = parts.turns;

  const handleUserMessage = Effect.fn("handleUserMessage")(function* (
    context: ClaudeSessionContext,
    message: SDKMessage,
  ) {
    if (message.type !== "user") {
      return;
    }

    for (const toolResult of toolResultBlocksFromUserMessage(message)) {
      const toolEntry = Array.from(context.inFlightTools.entries()).find(
        ([, tool]) => tool.itemId === toolResult.toolUseId,
      );
      if (!toolEntry) {
        continue;
      }

      const [index, tool] = toolEntry;
      const cancelled = toolNonExecutionKind(message, toolResult.toolUseId) === "cancelled";
      const itemStatus = cancelled ? "stopped" : toolResult.isError ? "failed" : "completed";
      const toolUseResult = readClaudeToolUseResult(message);
      const toolData = {
        toolName: tool.toolName,
        input: tool.input,
        result: toolResult.block,
      };

      // A helper's call has its result in its completion: no update row of its own.
      if (!tool.agentId) {
        const updatedStamp = yield* makeEventStamp();
        yield* offerRuntimeEvent({
          type: "item.updated",
          eventId: updatedStamp.eventId,
          provider: PROVIDER,
          createdAt: updatedStamp.createdAt,
          threadId: context.session.threadId,
          ...(context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {}),
          itemId: asRuntimeItemId(tool.itemId),
          payload: {
            itemType: tool.itemType,
            status: cancelled ? "stopped" : toolResult.isError ? "failed" : "inProgress",
            title: tool.title,
            ...(tool.detail ? { detail: tool.detail } : {}),
            ...(tool.parentToolUseId ? { parentToolUseId: tool.parentToolUseId } : {}),
            data: toolData,
            ...(tool.presentation ? { presentation: tool.presentation } : {}),
          },
          providerRefs: nativeProviderRefs(context, {
            providerItemId: tool.itemId,
          }),
          raw: {
            source: "claude.sdk.message",
            method: "claude/user",
            payload: message,
          },
        });
      }

      const streamKind = toolResultStreamKind(tool.itemType);
      if (streamKind && toolResult.text.length > 0 && context.turnState) {
        const deltaStamp = yield* makeEventStamp();
        yield* offerRuntimeEvent({
          type: "content.delta",
          eventId: deltaStamp.eventId,
          provider: PROVIDER,
          createdAt: deltaStamp.createdAt,
          threadId: context.session.threadId,
          turnId: context.turnState.turnId,
          itemId: asRuntimeItemId(tool.itemId),
          payload: {
            streamKind,
            delta: toolResult.text,
          },
          providerRefs: nativeProviderRefs(context, {
            providerItemId: tool.itemId,
          }),
          raw: {
            source: "claude.sdk.message",
            method: "claude/user",
            payload: message,
          },
        });
      }

      const completedStamp = yield* makeEventStamp();
      yield* offerRuntimeEvent({
        type: "item.completed",
        eventId: completedStamp.eventId,
        provider: PROVIDER,
        createdAt: completedStamp.createdAt,
        threadId: context.session.threadId,
        ...(context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {}),
        itemId: asRuntimeItemId(tool.itemId),
        payload: {
          itemType: tool.itemType,
          status: itemStatus,
          title: tool.title,
          ...(tool.detail ? { detail: tool.detail } : {}),
          ...(tool.agentId ? { agentId: tool.agentId } : {}),
          ...(tool.parentToolUseId ? { parentToolUseId: tool.parentToolUseId } : {}),
          data: toolData,
          ...(tool.presentation ? { presentation: tool.presentation } : {}),
        },
        providerRefs: nativeProviderRefs(context, {
          providerItemId: tool.itemId,
        }),
        raw: {
          source: "claude.sdk.message",
          method: "claude/user",
          payload: message,
        },
      });

      // The Workflow tool's result carries the run handles (runId, scriptPath,
      // transcriptDir, sessionUrl). Attach them to the workflow's task agent so
      // the next task.* payload advertises them to clients.
      if (!toolResult.isError && tool.toolName.toLowerCase() === "workflow" && toolUseResult) {
        const workflowTaskId = trimmedString(toolUseResult.taskId);
        if (workflowTaskId) {
          const runHandles: TaskRunHandles = {
            ...(trimmedString(toolUseResult.runId)
              ? { runId: trimmedString(toolUseResult.runId) }
              : {}),
            ...(trimmedString(toolUseResult.scriptPath)
              ? { scriptPath: trimmedString(toolUseResult.scriptPath) }
              : {}),
            ...(trimmedString(toolUseResult.transcriptDir)
              ? { transcriptDir: trimmedString(toolUseResult.transcriptDir) }
              : {}),
            ...(sanitizeSessionUrl(toolUseResult.sessionUrl)
              ? { sessionUrl: sanitizeSessionUrl(toolUseResult.sessionUrl) }
              : {}),
          };
          const existing = context.taskAgents.get(workflowTaskId);
          context.taskAgents.set(workflowTaskId, {
            taskId: workflowTaskId,
            toolUseId: existing?.toolUseId ?? tool.itemId,
            launches: existing?.launches ?? [tool.itemId],
            description: existing?.description,
            subagentType: existing?.subagentType,
            taskType: existing?.taskType ?? "local_workflow",
            workflowName: existing?.workflowName,
            skipTranscript: existing?.skipTranscript ?? false,
            runHandles,
            owningAgentId: existing?.owningAgentId,
            model: existing?.model,
            effort: existing?.effort,
          });
        }
      }

      // A helper's task list is its own (2.1.278 gives helpers no task tools):
      // never the Mate's plan.
      if (
        !toolResult.isError &&
        tool.agentId === undefined &&
        applyClaudeTaskToolResult(context.claudeTasks, tool, toolUseResult)
      ) {
        yield* emitClaudeTaskPlanUpdated(context, {
          toolUseId: tool.itemId,
          rawMethod: "claude/user",
          rawPayload: message,
        });
      }

      context.inFlightTools.delete(index);
    }
  });

  const handleAssistantMessage = Effect.fn("handleAssistantMessage")(function* (
    context: ClaudeSessionContext,
    message: SDKMessage,
  ) {
    if (message.type !== "assistant") {
      return;
    }

    // Subagent-owned assistant snapshots (parent_tool_use_id set) are the
    // subagent's own conversation, not the parent's. Emitting them created
    // interleaved "Agent N done"-adjacent leak messages and spawned synthetic
    // turns per subagent completion (which also reset the Working timer).
    const assistantParentToolUseId = (message as { parent_tool_use_id?: string | null })
      .parent_tool_use_id;
    if (assistantParentToolUseId !== null && assistantParentToolUseId !== undefined) {
      // The snapshot's message.model is the authoritative API model the
      // subagent actually ran on — refine the seeded launch-time value.
      const owningTaskId = agentIdForParentToolUse(context.taskAgents, assistantParentToolUseId);
      const snapshotModel = trimmedString(message.message.model);
      const owningAgent = owningTaskId ? context.taskAgents.get(owningTaskId) : undefined;
      const snapshotContent = Array.isArray(message.message.content) ? message.message.content : [];
      for (const block of snapshotContent) {
        if (block.type === "tool_use") {
          rememberPendingTaskEntry(context.subagentToolParents, block.id, assistantParentToolUseId);
        }
      }
      if (snapshotModel && owningAgent) {
        if (owningAgent.model !== snapshotModel) {
          owningAgent.model = snapshotModel;
          // Push the correction now. The next task row can be minutes away
          // when the subagent blocks on a long foreground tool.
          const stamp = yield* makeEventStamp();
          yield* offerRuntimeEvent({
            type: "task.updated",
            eventId: stamp.eventId,
            provider: PROVIDER,
            createdAt: stamp.createdAt,
            threadId: context.session.threadId,
            ...(context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {}),
            payload: {
              taskId: RuntimeTaskId.make(owningAgent.taskId),
              ...taskLinkageFor(context.taskAgents, owningAgent.taskId),
            },
            providerRefs: nativeProviderRefs(context),
            raw: {
              source: "claude.sdk.message",
              method: "claude/assistant",
              payload: message,
            },
          });
        }
      } else if (snapshotModel) {
        // The snapshot beat its task_started (or its tool_use_id was never
        // recorded): hold the model until the task registers.
        rememberPendingTaskEntry(
          context.pendingTaskModels,
          assistantParentToolUseId,
          snapshotModel,
        );
      }
      yield* syncSnapshotCalls(context, message, assistantParentToolUseId);
      context.lastAssistantUuid = message.uuid;
      yield* updateResumeCursor(context);
      return;
    }

    // Auto-start a synthetic turn for assistant messages that arrive without
    // an active turn (e.g., background agent/subagent responses between user prompts).
    if (!context.turnState) {
      // Claude Code wakes itself to hand the model a background result; against
      // a closed usage window the wake fails at once with this synthetic reply.
      // The result stays in Claude's conversation, so no turn opens: the thread
      // is held in one pause until the reset (orchestration/usagePause.ts).
      if (
        message.error === "rate_limit" &&
        (context.usageLimitBlockedUntilMs ?? 0) > DateTime.toEpochMillis(yield* DateTime.now)
      ) {
        context.heldLimitWake = true;
        context.lastAssistantUuid = message.uuid;
        yield* updateResumeCursor(context);
        return;
      }
      yield* startSyntheticTurn(context, message.uuid);
    } else if (context.turnState.startMessagePending === true) {
      // A turn its stream opened: its first assistant message names where it began.
      context.turnState.startMessagePending = false;
      context.turnStartMessageIds.push(message.uuid);
      yield* updateResumeCursor(context);
    }

    yield* syncSnapshotCalls(context, message);
    yield* presentCalls(context, message);
    const content = message.message?.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (!block || typeof block !== "object") {
          continue;
        }
        const toolUse = block as {
          type?: unknown;
          id?: unknown;
          name?: unknown;
          input?: unknown;
        };
        if (toolUse.type !== "tool_use" || toolUse.name !== "ExitPlanMode") {
          continue;
        }
        const planMarkdown = extractExitPlanModePlan(toolUse.input);
        if (!planMarkdown) {
          continue;
        }
        yield* emitProposedPlanCompleted(context, {
          planMarkdown,
          toolUseId: typeof toolUse.id === "string" ? toolUse.id : undefined,
          rawSource: "claude.sdk.message",
          rawMethod: "claude/assistant",
          rawPayload: message,
        });
      }
    }

    if (context.turnState) {
      // Limited retries may only carry an assistant error, without a new window
      // event. Later parent responses replace this evidence if the turn recovers.
      context.turnState.latestAssistantRateLimited = message.error === "rate_limit";
      // The CLI can report authentication failure before ending the turn as a
      // generic API error, so retain that evidence for the result fallback.
      if (message.error === "authentication_failed") {
        context.turnState.authenticationFailureMessage = claudeSignedOutMessage({
          configDir: claudeEnvironment.CLAUDE_CONFIG_DIR,
          cwd: path.resolve(context.session.cwd ?? "."),
        });
      }
      if (
        normalizeClaudeActiveTokenUsage(
          message.message.usage,
          context.lastKnownContextWindow,
          context.lastKnownTotalProcessedTokens,
        )
      ) {
        context.turnState.latestAssistantUsage = message.message.usage;
        context.turnState.compactedSinceLatestAssistantUsage = false;
      }
      yield* backfillThinkingFromSnapshot(context, message);
      yield* backfillAssistantTextBlocksFromSnapshot(context, message);
    }

    context.lastAssistantUuid = message.uuid;
    yield* updateResumeCursor(context);
  });

  return { handleUserMessage, handleAssistantMessage };
});

export type ClaudeMessages = Effect.Success<ReturnType<typeof makeClaudeMessages>>;
