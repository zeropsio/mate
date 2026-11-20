import { type SDKMessage, type SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  type ProviderRuntimeTurnStatus,
  type ThreadTokenUsageSnapshot,
  TurnId,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import { turnPictureError } from "../../providerPictures.ts";
import {
  PROVIDER,
  type ClaudeSessionContext,
  type ClaudeAdapterKit,
  nativeProviderRefs,
} from "./ClaudeSessionState.ts";
import {
  claudeConversationContextWindowFromModelUsage,
  claudeContextWindowForModel,
  claudeUsageInputTokens,
  claudeUsageOutputTokens,
  lastClaudeUsageIteration,
  claudeTotalProcessedTokens,
  normalizeClaudeActiveTokenUsage,
} from "./ClaudeTokenUsage.ts";
import { resultEndsAnotherTurn, resultOutcome } from "./ClaudeFailures.ts";
import { type ClaudeResumeCursor } from "./ClaudeResumeCursor.ts";
import { type ClaudeRuntimeEmit } from "./ClaudeRuntimeEmit.ts";
import { type ClaudeAssistantText } from "./ClaudeAssistantText.ts";
import { type ClaudeToolCalls } from "./ClaudeToolCalls.ts";

/** A turn's end, a turn Claude starts by itself, and the result that ends one. */
export const makeClaudeTurns = (
  kit: ClaudeAdapterKit,
  parts: {
    readonly resumeCursor: ClaudeResumeCursor;
    readonly runtimeEmit: ClaudeRuntimeEmit;
    readonly assistantText: ClaudeAssistantText;
    readonly toolCalls: ClaudeToolCalls;
  },
) => {
  const { nowIso, randomUUIDv4, makeEventStamp, offerRuntimeEvent } = kit;
  const { updateResumeCursor } = parts.resumeCursor;
  const { emitRuntimeError, emitThreadTokenUsage } = parts.runtimeEmit;
  const { completeAssistantTextBlock } = parts.assistantText;
  const { closeUnreturnedCall, helperStillWorks } = parts.toolCalls;

  const completeTurn = Effect.fn("completeTurn")(function* (
    context: ClaudeSessionContext,
    status: ProviderRuntimeTurnStatus,
    errorMessage?: string,
    result?: SDKResultMessage,
  ) {
    const resultContextWindow =
      context.selectedContextWindow ??
      claudeContextWindowForModel(result?.modelUsage, context.currentApiModelId) ??
      claudeConversationContextWindowFromModelUsage(result?.modelUsage);
    if (resultContextWindow !== undefined) {
      context.lastKnownContextWindow = resultContextWindow;
    }

    const maxTokens = resultContextWindow ?? context.lastKnownContextWindow;
    const accumulatedTotalProcessedTokens = claudeTotalProcessedTokens(result?.usage);
    if (accumulatedTotalProcessedTokens !== undefined) {
      context.lastKnownTotalProcessedTokens = accumulatedTotalProcessedTokens;
    }

    // Avoid getContextUsage because its token-count fallback can make extra model requests.
    const resultUsageRecord =
      result?.usage && typeof result.usage === "object" && !Array.isArray(result.usage)
        ? (result.usage as Record<string, unknown>)
        : undefined;
    const hasResultUsageIteration =
      resultUsageRecord !== undefined && lastClaudeUsageIteration(resultUsageRecord) !== undefined;
    const resultHasActiveUsage =
      resultUsageRecord !== undefined &&
      (hasResultUsageIteration ||
        claudeUsageInputTokens(resultUsageRecord) + claudeUsageOutputTokens(resultUsageRecord) > 0);
    const resultTotalOnly =
      resultUsageRecord !== undefined &&
      !resultHasActiveUsage &&
      claudeTotalProcessedTokens(resultUsageRecord) !== undefined;
    const resultIterationSnapshot = resultUsageRecord
      ? normalizeClaudeActiveTokenUsage(
          resultUsageRecord,
          maxTokens,
          accumulatedTotalProcessedTokens ?? context.lastKnownTotalProcessedTokens,
        )
      : undefined;
    const latestAssistantSnapshot = normalizeClaudeActiveTokenUsage(
      context.turnState?.latestAssistantUsage,
      maxTokens,
      accumulatedTotalProcessedTokens ?? context.lastKnownTotalProcessedTokens,
    );
    const lastGoodUsage = context.lastKnownTokenUsage;
    const usageSnapshot: ThreadTokenUsageSnapshot | undefined =
      latestAssistantSnapshot ??
      (context.turnState?.compactedSinceLatestAssistantUsage
        ? undefined
        : resultTotalOnly && lastGoodUsage
          ? {
              ...lastGoodUsage,
              ...(typeof maxTokens === "number" && Number.isFinite(maxTokens) && maxTokens > 0
                ? { maxTokens }
                : {}),
              ...(typeof accumulatedTotalProcessedTokens === "number" &&
              Number.isFinite(accumulatedTotalProcessedTokens) &&
              accumulatedTotalProcessedTokens > lastGoodUsage.usedTokens
                ? {
                    totalProcessedTokens: accumulatedTotalProcessedTokens,
                  }
                : {}),
            }
          : resultIterationSnapshot) ??
      (lastGoodUsage
        ? {
            ...lastGoodUsage,
            ...(typeof maxTokens === "number" && Number.isFinite(maxTokens) && maxTokens > 0
              ? { maxTokens }
              : {}),
            ...(typeof accumulatedTotalProcessedTokens === "number" &&
            Number.isFinite(accumulatedTotalProcessedTokens) &&
            accumulatedTotalProcessedTokens > lastGoodUsage.usedTokens
              ? {
                  totalProcessedTokens: accumulatedTotalProcessedTokens,
                }
              : {}),
          }
        : undefined);

    const turnState = context.turnState;
    if (!turnState) {
      yield* emitThreadTokenUsage(context, usageSnapshot, {
        rawMethod: "claude/result",
        rawPayload: result ?? { status },
      });

      // A result with no local turn is never a turn this adapter started:
      // real turns get turnState in sendTurn, and assistant messages that
      // arrive outside a turn auto-start a synthetic one. What lands here is
      // the resume handshake (system/init + result(num_turns: 0)), a late
      // result for a turn already completed locally (steer auto-close,
      // stream teardown), or a stream failure with no turn in flight. The
      // untargeted turn.completed this branch used to emit carried no turnId,
      // so ingestion could not attribute it — and whenever the projection had
      // no active turn (a pending turn start included) it flipped the session
      // lifecycle for a turn that never existed. Keep the usage emission,
      // drop the lifecycle event, and leave a tripwire so the upstream
      // trigger stays measurable in the field.
      yield* Effect.logInfo("claude.turn.result-without-active-turn", {
        threadId: context.session.threadId,
        status,
        numTurns: result?.num_turns,
        hasUsage: result?.usage !== undefined,
        ...(errorMessage ? { errorMessage } : {}),
      });
      return;
    }

    for (const [index, tool] of context.inFlightTools.entries()) {
      // A helper still at work outlives the Mate's turn, and so do its calls:
      // the helper's own end closes them (`closeHelperCalls`).
      if (helperStillWorks(context, tool)) continue;
      yield* closeUnreturnedCall(context, tool, {
        status: status === "completed" ? "completed" : "failed",
        turnId: turnState.turnId,
        rawMethod: "claude/result",
        rawPayload: result ?? { status },
      });
      context.inFlightTools.delete(index);
    }

    for (const block of turnState.assistantTextBlockOrder) {
      yield* completeAssistantTextBlock(context, block, {
        force: true,
        rawMethod: "claude/result",
        rawPayload: result ?? { status },
      });
    }

    context.turns.push({ id: turnState.turnId });

    yield* emitThreadTokenUsage(context, usageSnapshot, {
      rawMethod: "claude/result",
      rawPayload: result ?? { status },
    });

    const stamp = yield* makeEventStamp();
    yield* offerRuntimeEvent({
      type: "turn.completed",
      eventId: stamp.eventId,
      provider: PROVIDER,
      createdAt: stamp.createdAt,
      threadId: context.session.threadId,
      turnId: turnState.turnId,
      payload: {
        state: status,
        ...(result?.stop_reason !== undefined ? { stopReason: result.stop_reason } : {}),
        ...(result?.usage ? { usage: result.usage } : {}),
        ...(result?.modelUsage ? { modelUsage: result.modelUsage } : {}),
        ...(typeof result?.total_cost_usd === "number"
          ? { totalCostUsd: result.total_cost_usd }
          : {}),
        ...(errorMessage ? { errorMessage } : {}),
        ...(result?.terminal_reason ? { terminalReason: result.terminal_reason } : {}),
      },
      providerRefs: nativeProviderRefs(context),
    });

    const updatedAt = yield* nowIso;
    context.turnState = undefined;
    if (context.interruptedTurnSettled) {
      yield* Deferred.succeed(context.interruptedTurnSettled, undefined);
    }
    context.session = {
      ...context.session,
      status: "ready",
      activeTurnId: undefined,
      updatedAt,
      ...(status === "failed" && errorMessage ? { lastError: errorMessage } : {}),
    };
    yield* updateResumeCursor(context);
  });

  /**
   * A turn Claude Code opens on its own (a background result handed to the model between prompts):
   * from its first assistant message, or from its stream's start when that comes first — a call it
   * streams before its first message is that turn's, never the turn before (Milo's third stress
   * run read a wake's first command as the previous run's "No result").
   */
  const startSyntheticTurn = Effect.fn("startSyntheticTurn")(function* (
    context: ClaudeSessionContext,
    startMessageId: string | undefined,
  ) {
    const turnId = TurnId.make(yield* randomUUIDv4);
    const startedAt = yield* nowIso;
    if (startMessageId !== undefined) context.turnStartMessageIds.push(startMessageId);
    context.turnState = {
      turnId,
      startedAt,
      synthetic: true,
      ...(startMessageId === undefined ? { startMessagePending: true } : {}),
      assistantTextBlocks: new Map(),
      assistantTextBlockOrder: [],
      capturedProposedPlanKeys: new Set(),
      latestAssistantUsage: undefined,
      compactedSinceLatestAssistantUsage: false,
      nextSyntheticAssistantBlockIndex: -1,
      authenticationFailureMessage: undefined,
      rejectedRateLimitTypes: new Set(),
      latestAssistantRateLimited: false,
      emittedThinkingText: false,
      thinkingSnapshotIds: new Set(),
    };
    context.session = {
      ...context.session,
      status: "running",
      activeTurnId: turnId,
      updatedAt: startedAt,
    };
    yield* updateResumeCursor(context);
    const turnStartedStamp = yield* makeEventStamp();
    yield* offerRuntimeEvent({
      type: "turn.started",
      eventId: turnStartedStamp.eventId,
      provider: PROVIDER,
      createdAt: turnStartedStamp.createdAt,
      threadId: context.session.threadId,
      turnId,
      payload: {},
      providerRefs: {
        ...nativeProviderRefs(context),
        providerTurnId: turnId,
      },
      raw: {
        source: "claude.sdk.message",
        method: "claude/synthetic-turn-start",
        payload: {},
      },
    });
  });

  const handleResultMessage = Effect.fn("handleResultMessage")(function* (
    context: ClaudeSessionContext,
    message: SDKMessage,
  ) {
    if (message.type !== "result") {
      return;
    }

    const turn = context.turnState;
    // The end of a wake the closed usage window held: no turn, no failure to report.
    if (turn === undefined && context.heldLimitWake === true) {
      context.heldLimitWake = false;
      return;
    }
    // A background task's notification the CLI already queued runs as a turn
    // of its own before a send queued behind it, so the next result is not
    // always the sent turn's. Ending the sent turn on it closed a /compact
    // before its compaction ran, which then had no turn to belong to.
    if (
      turn !== undefined &&
      turn.synthetic !== true &&
      resultEndsAnotherTurn(message, turn.turnId)
    ) {
      yield* Effect.logInfo("claude.turn.result-for-another-turn", {
        threadId: context.session.threadId,
        turnId: turn.turnId,
        origin: message.origin?.kind,
        userMessageUuid: message.user_message_uuid,
      });
      return;
    }
    const usageLimited =
      turn !== undefined &&
      turn.authenticationFailureMessage === undefined &&
      (turn.rejectedRateLimitTypes.size > 0 || turn.latestAssistantRateLimited);
    const failureHint =
      turn?.authenticationFailureMessage ??
      (usageLimited
        ? "Claude usage limit reached. Send the message again once the limit resets."
        : undefined);
    const outcome = resultOutcome(message, failureHint);
    const status = outcome.status;
    const errorMessage = turnPictureError(message, turn) ?? outcome.errorMessage;

    if (status === "failed") {
      if (turn === undefined && context.turns.length === 0) {
        context.startFailure = errorMessage ?? "Claude turn failed.";
      }
      yield* emitRuntimeError(
        context,
        errorMessage ?? "Claude turn failed.",
        undefined,
        usageLimited ? "usage_limit" : "provider_error",
      );
    }

    yield* completeTurn(context, status, errorMessage, message);
  });

  return { completeTurn, startSyntheticTurn, handleResultMessage };
};

export type ClaudeTurns = ReturnType<typeof makeClaudeTurns>;
