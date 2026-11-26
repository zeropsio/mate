import { type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import * as Effect from "effect/Effect";
import {
  PROVIDER,
  type ToolInFlight,
  type ClaudeSessionContext,
  type ClaudeAdapterKit,
  asRuntimeItemId,
  asCanonicalTurnId,
  inFlightToolKey,
  nativeProviderRefs,
} from "./ClaudeSessionState.ts";
import {
  isClaudePlaceholderPrefix,
  streamKindFromDeltaType,
  extractContentBlockText,
} from "./ClaudeSdkMessages.ts";
import {
  classifyToolItemType,
  isTodoTool,
  summarizeToolRequest,
  titleForTool,
  tryParseJsonRecord,
  toolInputFingerprint,
} from "./ClaudeToolItems.ts";
import { extractPlanStepsFromTodoInput, trimmedString, helperOfCall } from "./ClaudeTasks.ts";
import { normalizeClaudeActiveTokenUsage } from "./ClaudeTokenUsage.ts";
import { type ClaudeRuntimeEmit } from "./ClaudeRuntimeEmit.ts";
import { type ClaudeAssistantText } from "./ClaudeAssistantText.ts";
import { type ClaudeTurns } from "./ClaudeTurns.ts";

/** The SDK's partial stream: text, thinking and tool input as they arrive. */
export const makeClaudeStreamEvents = (
  kit: ClaudeAdapterKit,
  parts: {
    readonly runtimeEmit: ClaudeRuntimeEmit;
    readonly assistantText: ClaudeAssistantText;
    readonly turns: ClaudeTurns;
  },
) => {
  const { makeEventStamp, offerRuntimeEvent } = kit;
  const { emitThreadTokenUsage } = parts.runtimeEmit;
  const { ensureAssistantTextBlock, completeAssistantTextBlock, emitReasoningSummaryDelta } =
    parts.assistantText;
  const { startSyntheticTurn } = parts.turns;

  const handleStreamEvent = Effect.fn("handleStreamEvent")(function* (
    context: ClaudeSessionContext,
    message: SDKMessage,
  ) {
    if (message.type !== "stream_event") {
      return;
    }

    const { event } = message;

    // Subagent-owned stream traffic (parent_tool_use_id set) must not write
    // into the parent transcript: with forwardSubagentText off the SDK still
    // forwards subagent tool_use/tool_result blocks and their wrapping
    // text/thinking deltas, and emitting them interleaved N subagents'
    // narration into the chat (live-test finding). Their results reach the
    // UI via the task.* lifecycle; their tool blocks are attributed and
    // re-homed by the quiet-timeline filter.
    const streamParentToolUseId = (message as { parent_tool_use_id?: string | null })
      .parent_tool_use_id;
    if (streamParentToolUseId !== null && streamParentToolUseId !== undefined) {
      // Drop only the subagent's narration (text/thinking); tool_use blocks
      // and their input_json_delta frames must flow so attributed tool items
      // keep their inputs (review finding: dropping deltas emptied inputs).
      const dropStart =
        event.type === "content_block_start" &&
        event.content_block.type !== "tool_use" &&
        event.content_block.type !== "server_tool_use" &&
        event.content_block.type !== "mcp_tool_use";
      const dropDelta =
        event.type === "content_block_delta" &&
        (event.delta.type === "text_delta" || event.delta.type === "thinking_delta");
      if (dropStart || dropDelta) {
        return;
      }
    }

    // Claude's own turn streaming before its first message: it opens here, so what it streams is
    // its own.
    if (event.type === "message_start" && !context.turnState && !streamParentToolUseId) {
      yield* startSyntheticTurn(context, undefined);
    }
    if (event.type === "message_start" && context.turnState && !streamParentToolUseId) {
      context.turnState.emittedThinkingText = false;
      context.turnState.responseId = trimmedString(event.message.id);
    }

    if (event.type === "message_delta") {
      if (message.parent_tool_use_id !== null && message.parent_tool_use_id !== undefined) {
        return;
      }

      const snapshot = normalizeClaudeActiveTokenUsage(
        event.usage,
        context.lastKnownContextWindow,
        context.lastKnownTotalProcessedTokens,
      );
      yield* emitThreadTokenUsage(context, snapshot, {
        rawMethod: "claude/stream_event/message_delta",
        rawPayload: message,
      });
      return;
    }

    if (event.type === "content_block_delta") {
      if (
        (event.delta.type === "text_delta" || event.delta.type === "thinking_delta") &&
        context.turnState
      ) {
        const deltaText =
          event.delta.type === "text_delta"
            ? event.delta.text
            : typeof event.delta.thinking === "string"
              ? event.delta.thinking
              : "";
        if (deltaText.length === 0) {
          return;
        }
        const streamKind = streamKindFromDeltaType(event.delta.type);
        if (streamKind === "reasoning_summary_text") {
          yield* emitReasoningSummaryDelta(context, {
            delta: deltaText,
            contentIndex: event.index,
            rawMethod: "claude/stream_event/content_block_delta",
            rawPayload: message,
          });
          return;
        }
        const assistantBlockEntry = yield* ensureAssistantTextBlock(context, event.index);
        const textBlock = assistantBlockEntry?.block;
        let outText = deltaText;
        // Words that could still be Claude Code's no-reply placeholder wait for the next ones.
        if (textBlock !== undefined && textBlock.heldText !== null) {
          const held = textBlock.heldText + deltaText;
          if (isClaudePlaceholderPrefix(held)) {
            textBlock.heldText = held;
            return;
          }
          textBlock.heldText = null;
          outText = held;
        }
        if (textBlock) {
          textBlock.emittedTextDelta = true;
        }
        const stamp = yield* makeEventStamp();
        yield* offerRuntimeEvent({
          type: "content.delta",
          eventId: stamp.eventId,
          provider: PROVIDER,
          createdAt: stamp.createdAt,
          threadId: context.session.threadId,
          turnId: context.turnState.turnId,
          ...(assistantBlockEntry?.block
            ? {
                itemId: asRuntimeItemId(assistantBlockEntry.block.itemId),
              }
            : {}),
          payload: {
            streamKind,
            delta: outText,
          },
          providerRefs: nativeProviderRefs(context),
          raw: {
            source: "claude.sdk.message",
            method: "claude/stream_event/content_block_delta",
            payload: message,
          },
        });
        return;
      }

      if (event.delta.type === "input_json_delta") {
        const tool = context.inFlightTools.get(inFlightToolKey(streamParentToolUseId, event.index));
        if (!tool || typeof event.delta.partial_json !== "string") {
          return;
        }

        const partialInputJson = tool.partialInputJson + event.delta.partial_json;
        const parsedInput = tryParseJsonRecord(partialInputJson);
        const itemType = parsedInput
          ? classifyToolItemType(tool.toolName, parsedInput)
          : tool.itemType;
        const detail = parsedInput ? summarizeToolRequest(tool.toolName, parsedInput) : tool.detail;
        let nextTool: ToolInFlight = {
          ...tool,
          itemType,
          title: titleForTool(itemType),
          partialInputJson,
          ...(parsedInput ? { input: parsedInput } : {}),
          ...(detail ? { detail } : {}),
        };

        const nextFingerprint =
          parsedInput && Object.keys(parsedInput).length > 0
            ? toolInputFingerprint(parsedInput)
            : undefined;
        context.inFlightTools.set(inFlightToolKey(streamParentToolUseId, event.index), nextTool);

        if (
          !parsedInput ||
          !nextFingerprint ||
          tool.lastEmittedInputFingerprint === nextFingerprint
        ) {
          return;
        }

        nextTool = {
          ...nextTool,
          lastEmittedInputFingerprint: nextFingerprint,
        };
        context.inFlightTools.set(inFlightToolKey(streamParentToolUseId, event.index), nextTool);

        const stamp = yield* makeEventStamp();
        yield* offerRuntimeEvent({
          type: "item.updated",
          eventId: stamp.eventId,
          provider: PROVIDER,
          createdAt: stamp.createdAt,
          threadId: context.session.threadId,
          ...(context.turnState
            ? {
                turnId: asCanonicalTurnId(context.turnState.turnId),
              }
            : {}),
          itemId: asRuntimeItemId(nextTool.itemId),
          payload: {
            itemType: nextTool.itemType,
            status: "inProgress",
            title: nextTool.title,
            ...(nextTool.detail ? { detail: nextTool.detail } : {}),
            ...(nextTool.agentId ? { agentId: nextTool.agentId } : {}),
            ...(nextTool.parentToolUseId ? { parentToolUseId: nextTool.parentToolUseId } : {}),
            data: {
              toolName: nextTool.toolName,
              input: nextTool.input,
            },
          },
          providerRefs: nativeProviderRefs(context, {
            providerItemId: nextTool.itemId,
          }),
          raw: {
            source: "claude.sdk.message",
            method: "claude/stream_event/content_block_delta/input_json_delta",
            payload: message,
          },
        });

        // Emit plan update when TodoWrite input is parsed
        if (parsedInput && isTodoTool(nextTool.toolName)) {
          const planSteps = extractPlanStepsFromTodoInput(parsedInput);
          if (planSteps && planSteps.length > 0) {
            const planStamp = yield* makeEventStamp();
            yield* offerRuntimeEvent({
              type: "turn.plan.updated",
              eventId: planStamp.eventId,
              provider: PROVIDER,
              createdAt: planStamp.createdAt,
              threadId: context.session.threadId,
              ...(context.turnState
                ? {
                    turnId: asCanonicalTurnId(context.turnState.turnId),
                  }
                : {}),
              payload: {
                plan: planSteps,
              },
              providerRefs: nativeProviderRefs(context),
            });
          }
        }
      }
      return;
    }

    if (event.type === "content_block_start") {
      const { index, content_block: block } = event;
      if (block.type === "text") {
        yield* ensureAssistantTextBlock(context, index, {
          fallbackText: extractContentBlockText(block),
        });
        return;
      }
      if (
        block.type !== "tool_use" &&
        block.type !== "server_tool_use" &&
        block.type !== "mcp_tool_use"
      ) {
        return;
      }

      const toolName = block.name;
      const toolInput =
        typeof block.input === "object" && block.input !== null
          ? (block.input as Record<string, unknown>)
          : {};
      const itemType = classifyToolItemType(toolName, toolInput);
      const itemId = block.id;
      const detail = summarizeToolRequest(toolName, toolInput);
      const inputFingerprint =
        Object.keys(toolInput).length > 0 ? toolInputFingerprint(toolInput) : undefined;

      // Attribute tools that ran inside a subagent to their owning agent so
      // clients can re-home them out of the main timeline (quiet-timeline
      // guarantee): the SDK forwards subagent tool_use blocks tagged with the
      // spawning Task tool's id as parent_tool_use_id.
      const parentToolUseId =
        (message as { parent_tool_use_id?: string | null }).parent_tool_use_id ?? undefined;
      const owningAgentId = helperOfCall(context.taskAgents, parentToolUseId);

      const tool: ToolInFlight = {
        itemId,
        itemType,
        toolName,
        title: titleForTool(itemType),
        detail,
        input: toolInput,
        partialInputJson: "",
        inputComplete: false,
        ...(inputFingerprint ? { lastEmittedInputFingerprint: inputFingerprint } : {}),
        ...(owningAgentId ? { agentId: owningAgentId } : {}),
        ...(parentToolUseId ? { parentToolUseId } : {}),
      };
      context.inFlightTools.set(inFlightToolKey(parentToolUseId, index), tool);
      // A helper's call is no call of the Mate's response.
      const responseId = parentToolUseId ? undefined : context.turnState?.responseId;

      const stamp = yield* makeEventStamp();
      yield* offerRuntimeEvent({
        type: "item.started",
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
          ...(responseId ? { responseId } : {}),
          data: {
            toolName: tool.toolName,
            input: toolInput,
            inputComplete: false,
          },
        },
        providerRefs: nativeProviderRefs(context, {
          providerItemId: tool.itemId,
        }),
        raw: {
          source: "claude.sdk.message",
          method: "claude/stream_event/content_block_start",
          payload: message,
        },
      });
      return;
    }

    if (event.type === "content_block_stop") {
      const { index } = event;
      // Mate: a helper's block indexes are its own response's, never the Mate's text.
      const assistantBlock = streamParentToolUseId
        ? undefined
        : context.turnState?.assistantTextBlocks.get(index);
      if (assistantBlock) {
        assistantBlock.streamClosed = true;
        yield* completeAssistantTextBlock(context, assistantBlock, {
          rawMethod: "claude/stream_event/content_block_stop",
          rawPayload: message,
        });
        return;
      }
      const tool = context.inFlightTools.get(inFlightToolKey(streamParentToolUseId, index));
      if (!tool) {
        return;
      }
      context.inFlightTools.set(inFlightToolKey(streamParentToolUseId, index), {
        ...tool,
        inputComplete: true,
      });
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
          data: { toolName: tool.toolName, input: tool.input, inputComplete: true },
        },
        providerRefs: nativeProviderRefs(context, { providerItemId: tool.itemId }),
        raw: {
          source: "claude.sdk.message",
          method: "claude/stream_event/content_block_stop",
          payload: message,
        },
      });
    }
  });

  return { handleStreamEvent };
};

export type ClaudeStreamEvents = ReturnType<typeof makeClaudeStreamEvents>;
