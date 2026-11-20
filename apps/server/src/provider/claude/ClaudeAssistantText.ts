import { type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import * as Effect from "effect/Effect";
import {
  PROVIDER,
  type AssistantTextBlockState,
  type ClaudeSessionContext,
  type ClaudeAdapterKit,
  asRuntimeItemId,
  nativeProviderRefs,
} from "./ClaudeSessionState.ts";
import {
  isClaudePlaceholder,
  extractAssistantTextBlocks,
  extractAssistantThinkingBlocks,
} from "./ClaudeSdkMessages.ts";

/** The Mate's streamed reply and thinking, block by block. */
export const makeClaudeAssistantText = (kit: ClaudeAdapterKit) => {
  const { randomUUIDv4, makeEventStamp, offerRuntimeEvent } = kit;

  const ensureAssistantTextBlock = Effect.fn("ensureAssistantTextBlock")(function* (
    context: ClaudeSessionContext,
    blockIndex: number,
    options?: {
      readonly fallbackText?: string;
      readonly streamClosed?: boolean;
    },
  ) {
    const turnState = context.turnState;
    if (!turnState) {
      return undefined;
    }

    const existing = turnState.assistantTextBlocks.get(blockIndex);
    if (existing && !existing.completionEmitted) {
      if (existing.fallbackText.length === 0 && options?.fallbackText) {
        existing.fallbackText = options.fallbackText;
      }
      if (options?.streamClosed) {
        existing.streamClosed = true;
      }
      return { blockIndex, block: existing };
    }

    const block: AssistantTextBlockState = {
      itemId: yield* randomUUIDv4,
      blockIndex,
      emittedTextDelta: false,
      fallbackText: options?.fallbackText ?? "",
      streamClosed: options?.streamClosed ?? false,
      completionEmitted: false,
      heldText: "",
    };
    turnState.assistantTextBlocks.set(blockIndex, block);
    turnState.assistantTextBlockOrder.push(block);
    return { blockIndex, block };
  });

  const createSyntheticAssistantTextBlock = Effect.fn("createSyntheticAssistantTextBlock")(
    function* (context: ClaudeSessionContext, fallbackText: string) {
      const turnState = context.turnState;
      if (!turnState) {
        return undefined;
      }

      const blockIndex = turnState.nextSyntheticAssistantBlockIndex;
      turnState.nextSyntheticAssistantBlockIndex -= 1;
      return yield* ensureAssistantTextBlock(context, blockIndex, {
        fallbackText,
        streamClosed: true,
      });
    },
  );

  const completeAssistantTextBlock = Effect.fn("completeAssistantTextBlock")(function* (
    context: ClaudeSessionContext,
    block: AssistantTextBlockState,
    options?: {
      readonly force?: boolean;
      readonly rawMethod?: string;
      readonly rawPayload?: unknown;
    },
  ) {
    const turnState = context.turnState;
    if (!turnState || block.completionEmitted) {
      return;
    }

    if (!options?.force && !block.streamClosed) {
      return;
    }

    // What it held is its whole text: Claude Code's placeholder is no reply, so nothing of it goes
    // out; any other words go as they were.
    const held = block.heldText ?? "";
    const whole = held.length > 0 ? held : block.fallbackText;
    if (!block.emittedTextDelta && isClaudePlaceholder(whole)) {
      block.completionEmitted = true;
      if (turnState.assistantTextBlocks.get(block.blockIndex) === block) {
        turnState.assistantTextBlocks.delete(block.blockIndex);
      }
      return;
    }
    if (!block.emittedTextDelta && held.length > 0) block.fallbackText = held;

    if (!block.emittedTextDelta && block.fallbackText.length > 0) {
      const deltaStamp = yield* makeEventStamp();
      yield* offerRuntimeEvent({
        type: "content.delta",
        eventId: deltaStamp.eventId,
        provider: PROVIDER,
        createdAt: deltaStamp.createdAt,
        threadId: context.session.threadId,
        turnId: turnState.turnId,
        itemId: asRuntimeItemId(block.itemId),
        payload: {
          streamKind: "assistant_text",
          delta: block.fallbackText,
        },
        providerRefs: nativeProviderRefs(context),
        ...(options?.rawMethod || options?.rawPayload
          ? {
              raw: {
                source: "claude.sdk.message" as const,
                ...(options.rawMethod ? { method: options.rawMethod } : {}),
                payload: options?.rawPayload,
              },
            }
          : {}),
      });
    }

    block.completionEmitted = true;
    if (turnState.assistantTextBlocks.get(block.blockIndex) === block) {
      turnState.assistantTextBlocks.delete(block.blockIndex);
    }

    const stamp = yield* makeEventStamp();
    yield* offerRuntimeEvent({
      type: "item.completed",
      eventId: stamp.eventId,
      provider: PROVIDER,
      createdAt: stamp.createdAt,
      itemId: asRuntimeItemId(block.itemId),
      threadId: context.session.threadId,
      turnId: turnState.turnId,
      payload: {
        itemType: "assistant_message",
        status: "completed",
        title: "Assistant message",
        ...(block.fallbackText.length > 0 ? { detail: block.fallbackText } : {}),
      },
      providerRefs: nativeProviderRefs(context),
      ...(options?.rawMethod || options?.rawPayload
        ? {
            raw: {
              source: "claude.sdk.message" as const,
              ...(options.rawMethod ? { method: options.rawMethod } : {}),
              payload: options?.rawPayload,
            },
          }
        : {}),
    });
  });

  const backfillAssistantTextBlocksFromSnapshot = Effect.fn(
    "backfillAssistantTextBlocksFromSnapshot",
  )(function* (context: ClaudeSessionContext, message: SDKMessage) {
    const turnState = context.turnState;
    if (!turnState) {
      return;
    }

    const snapshotTextBlocks = extractAssistantTextBlocks(message);
    if (snapshotTextBlocks.length === 0) {
      return;
    }

    const orderedBlocks = turnState.assistantTextBlockOrder.map((block) => ({
      blockIndex: block.blockIndex,
      block,
    }));

    for (const [position, text] of snapshotTextBlocks.entries()) {
      const existingEntry = orderedBlocks[position];
      const entry =
        existingEntry ??
        (yield* createSyntheticAssistantTextBlock(context, text).pipe(
          Effect.map((created) => {
            if (!created) {
              return undefined;
            }
            orderedBlocks.push(created);
            return created;
          }),
        ));
      if (!entry) {
        continue;
      }

      if (entry.block.fallbackText.length === 0) {
        entry.block.fallbackText = text;
      }

      if (entry.block.streamClosed && !entry.block.completionEmitted) {
        yield* completeAssistantTextBlock(context, entry.block, {
          rawMethod: "claude/assistant",
          rawPayload: message,
        });
      }
    }
  });

  const emitReasoningSummaryDelta = Effect.fn("emitReasoningSummaryDelta")(function* (
    context: ClaudeSessionContext,
    input: {
      readonly delta: string;
      readonly contentIndex?: number;
      readonly rawMethod: string;
      readonly rawPayload: SDKMessage;
    },
  ) {
    const turnState = context.turnState;
    if (!turnState || input.delta.length === 0) {
      return;
    }
    turnState.emittedThinkingText = true;
    const stamp = yield* makeEventStamp();
    yield* offerRuntimeEvent({
      type: "content.delta",
      eventId: stamp.eventId,
      provider: PROVIDER,
      createdAt: stamp.createdAt,
      threadId: context.session.threadId,
      turnId: turnState.turnId,
      payload: {
        streamKind: "reasoning_summary_text",
        delta: input.delta,
        ...(input.contentIndex !== undefined ? { contentIndex: input.contentIndex } : {}),
      },
      providerRefs: nativeProviderRefs(context),
      raw: {
        source: "claude.sdk.message",
        method: input.rawMethod,
        payload: input.rawPayload,
      },
    });
  });

  const backfillThinkingFromSnapshot = Effect.fn("backfillThinkingFromSnapshot")(function* (
    context: ClaudeSessionContext,
    message: SDKMessage,
  ) {
    const turnState = context.turnState;
    if (!turnState || message.type !== "assistant") {
      return;
    }
    const snapshotId = message.uuid;
    const alreadyEmitted =
      turnState.emittedThinkingText || turnState.thinkingSnapshotIds.has(snapshotId);
    turnState.thinkingSnapshotIds.add(snapshotId);
    turnState.emittedThinkingText = false;
    if (alreadyEmitted) {
      return;
    }

    for (const [index, delta] of extractAssistantThinkingBlocks(message).entries()) {
      yield* emitReasoningSummaryDelta(context, {
        delta,
        contentIndex: index,
        rawMethod: "claude/assistant/thinking",
        rawPayload: message,
      });
    }
    turnState.emittedThinkingText = false;
  });

  return {
    ensureAssistantTextBlock,
    completeAssistantTextBlock,
    backfillAssistantTextBlocksFromSnapshot,
    emitReasoningSummaryDelta,
    backfillThinkingFromSnapshot,
  };
};

export type ClaudeAssistantText = ReturnType<typeof makeClaudeAssistantText>;
