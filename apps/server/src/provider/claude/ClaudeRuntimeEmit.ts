import { type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { ProviderItemId, type ThreadTokenUsageSnapshot } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { type EventNdjsonLogger } from "../Layers/EventNdjsonLogger.ts";
import {
  PROVIDER,
  type ClaudeSessionContext,
  type ClaudeAdapterKit,
  asCanonicalTurnId,
  nativeProviderRefs,
} from "./ClaudeSessionState.ts";
import { sdkNativeMethod, sdkNativeItemId } from "./ClaudeSdkMessages.ts";
import { exitPlanCaptureKey } from "./ClaudeToolItems.ts";
import { planStepsFromClaudeTasks } from "./ClaudeTasks.ts";

/** The adapter's native log and its runtime events for errors, warnings, usage and plans. */
export const makeClaudeRuntimeEmit = (
  kit: ClaudeAdapterKit,
  nativeEventLogger: EventNdjsonLogger | undefined,
) => {
  const { nowIso, randomUUIDv4, makeEventStamp, offerRuntimeEvent } = kit;

  const logNativeSdkMessage = Effect.fnUntraced(function* (
    context: ClaudeSessionContext,
    message: SDKMessage,
  ) {
    if (!nativeEventLogger) {
      return;
    }

    const observedAt = yield* nowIso;
    const itemId = sdkNativeItemId(message);

    yield* nativeEventLogger.write(
      {
        observedAt,
        event: {
          id:
            "uuid" in message && typeof message.uuid === "string"
              ? message.uuid
              : yield* randomUUIDv4,
          kind: "notification",
          provider: PROVIDER,
          createdAt: observedAt,
          method: sdkNativeMethod(message),
          ...(typeof message.session_id === "string"
            ? { providerThreadId: message.session_id }
            : {}),
          ...(context.turnState
            ? {
                turnId: asCanonicalTurnId(context.turnState.turnId),
              }
            : {}),
          ...(itemId ? { itemId: ProviderItemId.make(itemId) } : {}),
          payload: message,
        },
      },
      context.session.threadId,
    );
  });

  const emitRuntimeError = Effect.fn("emitRuntimeError")(function* (
    context: ClaudeSessionContext,
    message: string,
    cause?: unknown,
    errorClass: "provider_error" | "usage_limit" | "process_exit" = "provider_error",
  ) {
    if (cause !== undefined) {
      void cause;
    }
    const turnState = context.turnState;
    const stamp = yield* makeEventStamp();
    yield* offerRuntimeEvent({
      type: "runtime.error",
      eventId: stamp.eventId,
      provider: PROVIDER,
      createdAt: stamp.createdAt,
      threadId: context.session.threadId,
      ...(turnState ? { turnId: asCanonicalTurnId(turnState.turnId) } : {}),
      payload: {
        message,
        class: errorClass,
        ...(cause !== undefined ? { detail: cause } : {}),
      },
      providerRefs: nativeProviderRefs(context),
    });
  });

  const emitRuntimeWarning = Effect.fn("emitRuntimeWarning")(function* (
    context: ClaudeSessionContext,
    message: string,
    detail?: unknown,
  ) {
    const turnState = context.turnState;
    const stamp = yield* makeEventStamp();
    yield* offerRuntimeEvent({
      type: "runtime.warning",
      eventId: stamp.eventId,
      provider: PROVIDER,
      createdAt: stamp.createdAt,
      threadId: context.session.threadId,
      ...(turnState ? { turnId: asCanonicalTurnId(turnState.turnId) } : {}),
      payload: {
        message,
        ...(detail !== undefined ? { detail } : {}),
      },
      providerRefs: nativeProviderRefs(context),
    });
  });

  const emitThreadTokenUsage = Effect.fn("emitThreadTokenUsage")(function* (
    context: ClaudeSessionContext,
    usage: ThreadTokenUsageSnapshot | undefined,
    options?: {
      readonly rawMethod?: string;
      readonly rawPayload?: unknown;
    },
  ) {
    if (!usage) {
      return;
    }

    context.lastKnownTokenUsage = usage;
    context.lastKnownTotalProcessedTokens =
      usage.totalProcessedTokens ?? context.lastKnownTotalProcessedTokens;

    const turnState = context.turnState;
    const stamp = yield* makeEventStamp();
    yield* offerRuntimeEvent({
      type: "thread.token-usage.updated",
      eventId: stamp.eventId,
      provider: PROVIDER,
      createdAt: stamp.createdAt,
      threadId: context.session.threadId,
      ...(turnState ? { turnId: turnState.turnId } : {}),
      payload: {
        usage: { ...usage, autoCompactWindow: context.autoCompactWindow },
      },
      providerRefs: nativeProviderRefs(context),
      ...(options?.rawMethod || options?.rawPayload
        ? {
            raw: {
              source: "claude.sdk.message" as const,
              ...(options.rawMethod ? { method: options.rawMethod } : {}),
              payload: options.rawPayload,
            },
          }
        : {}),
    });
  });

  const emitProposedPlanCompleted = Effect.fn("emitProposedPlanCompleted")(function* (
    context: ClaudeSessionContext,
    input: {
      readonly planMarkdown: string;
      readonly toolUseId?: string | undefined;
      readonly rawSource: "claude.sdk.message" | "claude.sdk.permission";
      readonly rawMethod: string;
      readonly rawPayload: unknown;
    },
  ) {
    const turnState = context.turnState;
    const planMarkdown = input.planMarkdown.trim();
    if (!turnState || planMarkdown.length === 0) {
      return;
    }

    const captureKey = exitPlanCaptureKey({
      toolUseId: input.toolUseId,
      planMarkdown,
    });
    if (turnState.capturedProposedPlanKeys.has(captureKey)) {
      return;
    }
    turnState.capturedProposedPlanKeys.add(captureKey);

    const stamp = yield* makeEventStamp();
    yield* offerRuntimeEvent({
      type: "turn.proposed.completed",
      eventId: stamp.eventId,
      provider: PROVIDER,
      createdAt: stamp.createdAt,
      threadId: context.session.threadId,
      turnId: turnState.turnId,
      payload: {
        planMarkdown,
      },
      providerRefs: nativeProviderRefs(context, {
        providerItemId: input.toolUseId,
      }),
      raw: {
        source: input.rawSource,
        method: input.rawMethod,
        payload: input.rawPayload,
      },
    });
  });

  const emitClaudeTaskPlanUpdated = Effect.fn("emitClaudeTaskPlanUpdated")(function* (
    context: ClaudeSessionContext,
    input: {
      readonly toolUseId: string;
      readonly rawMethod: string;
      readonly rawPayload: unknown;
    },
  ) {
    const plan = planStepsFromClaudeTasks(context.claudeTasks);
    if (plan.length === 0) {
      return;
    }

    const stamp = yield* makeEventStamp();
    yield* offerRuntimeEvent({
      type: "turn.plan.updated",
      eventId: stamp.eventId,
      provider: PROVIDER,
      createdAt: stamp.createdAt,
      threadId: context.session.threadId,
      ...(context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {}),
      payload: {
        explanation: "Claude Tasks",
        plan,
      },
      providerRefs: nativeProviderRefs(context, {
        providerItemId: input.toolUseId,
      }),
      raw: {
        source: "claude.sdk.message",
        method: input.rawMethod,
        payload: input.rawPayload,
      },
    });
  });

  return {
    logNativeSdkMessage,
    emitRuntimeError,
    emitRuntimeWarning,
    emitThreadTokenUsage,
    emitProposedPlanCompleted,
    emitClaudeTaskPlanUpdated,
  };
};

export type ClaudeRuntimeEmit = ReturnType<typeof makeClaudeRuntimeEmit>;
