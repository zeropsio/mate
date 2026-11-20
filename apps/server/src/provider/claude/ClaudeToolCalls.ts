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

  /**
   * A helper's calls, from its snapshot: the SDK streams no events for a
   * helper's response, so its snapshot is the first sight of each call. Each
   * starts as a step of the helper that made it (the owner of its parent
   * call), and its result completes it (`handleUserMessage`). A call its
   * stream already started is left alone.
   */
  const startHelperCalls = Effect.fn("startHelperCalls")(function* (
    context: ClaudeSessionContext,
    message: Extract<SDKMessage, { type: "assistant" }>,
    parentToolUseId: string,
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
      if (Array.from(context.inFlightTools.values()).some((tool) => tool.itemId === itemId)) {
        continue;
      }
      const toolInput =
        typeof block.input === "object" && block.input !== null
          ? (block.input as Record<string, unknown>)
          : {};
      const itemType = classifyToolItemType(block.name, toolInput);
      const owningAgentId = helperOfCall(
        context.taskAgents,
        parentToolUseId,
        frameAgentId(message),
      );
      const presentation = claudeCallPresentation(meta, block.name, itemId);
      const tool: ToolInFlight = {
        itemId,
        itemType,
        toolName: block.name,
        title: titleForTool(itemType),
        detail: summarizeToolRequest(block.name, toolInput),
        input: toolInput,
        partialInputJson: "",
        ...(owningAgentId ? { agentId: owningAgentId } : {}),
        parentToolUseId,
        ...(presentation ? { presentation } : {}),
      };
      context.inFlightTools.set(`${parentToolUseId}#${itemId}`, tool);
      const stamp = yield* makeEventStamp();
      yield* offerRuntimeEvent({
        type: "item.started",
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
          parentToolUseId,
          data: { toolName: block.name, input: toolInput },
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
    startHelperCalls,
  };
};

export type ClaudeToolCalls = ReturnType<typeof makeClaudeToolCalls>;
