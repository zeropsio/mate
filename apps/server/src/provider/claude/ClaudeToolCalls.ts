import { type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { TurnId } from "@t3tools/contracts";
import { claudeToolUseMeta } from "@t3tools/shared/toolActivity";
import * as Effect from "effect/Effect";
import {
  PROVIDER,
  type ToolInFlight,
  type ClaudeSessionContext,
  type ClaudeAdapterKit,
  asRuntimeItemId,
  asCanonicalTurnId,
  nativeProviderRefs,
} from "./ClaudeSessionState.ts";
import {
  claudeCallPresentation,
  classifyToolItemType,
  summarizeToolRequest,
  titleForTool,
  toolInputFingerprint,
} from "./ClaudeToolItems.ts";
import { agentIdForParentToolUse, helperOfCall, frameAgentId } from "./ClaudeTasks.ts";

/** A tool call's life: started, presented, closed, a helper's calls with it. */
export const makeClaudeToolCalls = (kit: ClaudeAdapterKit) => {
  const { makeEventStamp, offerRuntimeEvent } = kit;

  /** Mate: a call whose result never came; what ended around it closes it. */
  const closeUnreturnedCall = Effect.fn("closeUnreturnedCall")(function* (
    context: ClaudeSessionContext,
    tool: ToolInFlight,
    options: {
      readonly status: "completed" | "failed";
      readonly turnId: TurnId | undefined;
      readonly rawMethod: string;
      readonly rawPayload: unknown;
    },
  ) {
    const toolStamp = yield* makeEventStamp();
    yield* offerRuntimeEvent({
      type: "item.completed",
      eventId: toolStamp.eventId,
      provider: PROVIDER,
      createdAt: toolStamp.createdAt,
      threadId: context.session.threadId,
      ...(options.turnId ? { turnId: asCanonicalTurnId(options.turnId) } : {}),
      itemId: asRuntimeItemId(tool.itemId),
      payload: {
        itemType: tool.itemType,
        status: options.status,
        title: tool.title,
        ...(tool.detail ? { detail: tool.detail } : {}),
        ...(tool.agentId ? { agentId: tool.agentId } : {}),
        ...(tool.parentToolUseId ? { parentToolUseId: tool.parentToolUseId } : {}),
        data: {
          toolName: tool.toolName,
          input: tool.input,
        },
        ...(tool.presentation ? { presentation: tool.presentation } : {}),
        unreturned: true,
      },
      providerRefs: nativeProviderRefs(context, {
        providerItemId: tool.itemId,
      }),
      raw: {
        source: "claude.sdk.message",
        method: options.rawMethod,
        payload: options.rawPayload,
      },
    });
  });

  /** A helper that ended closes the calls it never saw return. */
  const closeHelperCalls = Effect.fn("closeHelperCalls")(function* (
    context: ClaudeSessionContext,
    taskId: string,
    status: "completed" | "failed",
    rawPayload: unknown,
  ) {
    const launches = context.taskAgents.get(taskId)?.launches ?? [];
    for (const [index, tool] of context.inFlightTools.entries()) {
      if (
        tool.agentId !== taskId &&
        (tool.parentToolUseId === undefined || !launches.includes(tool.parentToolUseId))
      ) {
        continue;
      }
      yield* closeUnreturnedCall(context, tool, {
        status,
        turnId: context.turnState?.turnId,
        rawMethod: "claude/system/task_notification",
        rawPayload,
      });
      context.inFlightTools.delete(index);
    }
  });

  /**
   * A helper's call outlives the Mate's turn while its helper works — or
   * while its helper is not known yet, which only a working helper can be.
   */
  const helperStillWorks = (context: ClaudeSessionContext, tool: ToolInFlight): boolean => {
    if (tool.agentId === undefined) return false;
    const owner = agentIdForParentToolUse(context.taskAgents, tool.parentToolUseId);
    return owner === undefined || context.liveTaskIds.has(owner);
  };

  /**
   * The Mate's calls as Claude Code presents them: its assistant frame names each call's title
   * and server (`tool_use_meta`) after the stream has started it, so a call it presents says so
   * in an update, and every step after carries it.
   */
  const presentCalls = Effect.fn("presentCalls")(function* (
    context: ClaudeSessionContext,
    message: Extract<SDKMessage, { type: "assistant" }>,
  ) {
    const meta = claudeToolUseMeta(message);
    if (meta.size === 0) return;
    for (const [key, tool] of context.inFlightTools) {
      if (tool.presentation !== undefined) continue;
      const presentation = claudeCallPresentation(meta, tool.toolName, tool.itemId);
      if (presentation === undefined) continue;
      context.inFlightTools.set(key, { ...tool, presentation });
      const stamp = yield* makeEventStamp();
      yield* offerRuntimeEvent({
        type: "item.updated",
        eventId: stamp.eventId,
        provider: PROVIDER,
        createdAt: stamp.createdAt,
        threadId: context.session.threadId,
        ...(context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {}),
        itemId: asRuntimeItemId(tool.itemId),
        payload: {
          itemType: tool.itemType,
          status: "inProgress",
          title: tool.title,
          ...(tool.detail ? { detail: tool.detail } : {}),
          ...(tool.agentId ? { agentId: tool.agentId } : {}),
          ...(tool.parentToolUseId ? { parentToolUseId: tool.parentToolUseId } : {}),
          data: { toolName: tool.toolName, input: tool.input },
          presentation,
        },
        providerRefs: nativeProviderRefs(context, { providerItemId: tool.itemId }),
        raw: { source: "claude.sdk.message", method: "claude/assistant", payload: message },
      });
    }
  });

  /** A snapshot either starts a call with its complete input or finishes a streamed input. */
  const syncSnapshotCalls = Effect.fn("syncSnapshotCalls")(function* (
    context: ClaudeSessionContext,
    message: Extract<SDKMessage, { type: "assistant" }>,
    parentToolUseId?: string,
  ) {
    const content = (message.message as { content?: unknown }).content;
    if (!Array.isArray(content)) return;
    const meta = claudeToolUseMeta(message);
    for (const entry of content) {
      if (typeof entry !== "object" || entry === null) continue;
      const block = entry as { type?: unknown; id?: unknown; name?: unknown; input?: unknown };
      if (
        block.type !== "tool_use" &&
        block.type !== "server_tool_use" &&
        block.type !== "mcp_tool_use"
      ) {
        continue;
      }
      if (typeof block.id !== "string" || typeof block.name !== "string") continue;
      const itemId = block.id;
      const existing = Array.from(context.inFlightTools.entries()).find(
        ([, tool]) => tool.itemId === itemId,
      );
      const toolInput =
        typeof block.input === "object" && block.input !== null
          ? (block.input as Record<string, unknown>)
          : {};
      const itemType = classifyToolItemType(block.name, toolInput);
      if (
        existing?.[1].inputComplete === true &&
        toolInputFingerprint(existing[1].input) === toolInputFingerprint(toolInput)
      )
        continue;
      const owningAgentId = parentToolUseId
        ? helperOfCall(context.taskAgents, parentToolUseId, frameAgentId(message))
        : undefined;
      const presentation =
        existing?.[1].presentation ?? claudeCallPresentation(meta, block.name, itemId);
      const tool: ToolInFlight = {
        ...existing?.[1],
        itemId,
        itemType,
        toolName: block.name,
        title: titleForTool(itemType),
        detail: summarizeToolRequest(block.name, toolInput),
        input: toolInput,
        partialInputJson: "",
        inputComplete: true,
        ...(owningAgentId ? { agentId: owningAgentId } : {}),
        ...(parentToolUseId ? { parentToolUseId } : {}),
        ...(presentation ? { presentation } : {}),
      };
      context.inFlightTools.set(
        existing?.[0] ?? `${parentToolUseId ?? "snapshot"}#${itemId}`,
        tool,
      );
      const stamp = yield* makeEventStamp();
      yield* offerRuntimeEvent({
        type: existing === undefined ? "item.started" : "item.updated",
        eventId: stamp.eventId,
        provider: PROVIDER,
        createdAt: stamp.createdAt,
        threadId: context.session.threadId,
        ...(context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {}),
        itemId: asRuntimeItemId(itemId),
        payload: {
          itemType,
          status: "inProgress",
          title: tool.title,
          ...(tool.detail ? { detail: tool.detail } : {}),
          ...(owningAgentId ? { agentId: owningAgentId } : {}),
          ...(parentToolUseId ? { parentToolUseId } : {}),
          data: { toolName: block.name, input: toolInput, inputComplete: true },
          ...(presentation ? { presentation } : {}),
        },
        providerRefs: nativeProviderRefs(context, { providerItemId: itemId }),
        raw: {
          source: "claude.sdk.message",
          method: "claude/assistant",
          payload: message,
        },
      });
    }
  });

  return {
    closeUnreturnedCall,
    closeHelperCalls,
    helperStillWorks,
    presentCalls,
    syncSnapshotCalls,
  };
};

export type ClaudeToolCalls = ReturnType<typeof makeClaudeToolCalls>;
