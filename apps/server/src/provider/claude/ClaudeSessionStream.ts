import { type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { RuntimeTaskId, ThreadId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import {
  ProviderAdapterProcessError,
  ProviderAdapterSessionClosedError,
  ProviderAdapterSessionNotFoundError,
  type ProviderAdapterError,
} from "../Errors.ts";
import { describeClaudeStreamFailure } from "../claudeStreamFailure.ts";
import {
  PROVIDER,
  type ClaudeSessionContext,
  type ClaudeAdapterKit,
  asCanonicalTurnId,
  asRuntimeRequestId,
  nativeProviderRefs,
} from "./ClaudeSessionState.ts";
import { sdkMessageType, describeUnknownSdkMessage } from "./ClaudeSdkMessages.ts";
import { adoptHelperLaunch, taskLinkageFor } from "./ClaudeTasks.ts";
import { STREAM_FAILED_DETAIL, isClaudeInterruptedCause } from "./ClaudeFailures.ts";
import { type ClaudeResumeCursor } from "./ClaudeResumeCursor.ts";
import { type ClaudeRuntimeEmit } from "./ClaudeRuntimeEmit.ts";
import { type ClaudeToolCalls } from "./ClaudeToolCalls.ts";
import { type ClaudeTurns } from "./ClaudeTurns.ts";
import { type ClaudeStreamEvents } from "./ClaudeStreamEvents.ts";
import { type ClaudeMessages } from "./ClaudeMessages.ts";
import { type ClaudeSystemMessages } from "./ClaudeSystemMessages.ts";

/** One session's SDK stream: each message to its handler, the stream's end, the session's stop. */
export const makeClaudeSessionStream = (
  kit: ClaudeAdapterKit,
  parts: {
    readonly resumeCursor: ClaudeResumeCursor;
    readonly runtimeEmit: ClaudeRuntimeEmit;
    readonly toolCalls: ClaudeToolCalls;
    readonly turns: ClaudeTurns;
    readonly streamEvents: ClaudeStreamEvents;
    readonly messages: ClaudeMessages;
    readonly systemMessages: ClaudeSystemMessages;
  },
  sessions: Map<ThreadId, ClaudeSessionContext>,
) => {
  const { nowIso, makeEventStamp, offerRuntimeEvent } = kit;
  const { ensureThreadId } = parts.resumeCursor;
  const { logNativeSdkMessage, emitRuntimeError, emitRuntimeWarning } = parts.runtimeEmit;
  const { closeUnreturnedCall, closeHelperCalls } = parts.toolCalls;
  const { completeTurn, handleResultMessage } = parts.turns;
  const { handleStreamEvent } = parts.streamEvents;
  const { handleUserMessage, handleAssistantMessage } = parts.messages;
  const { handleSystemMessage, handleSdkTelemetryMessage } = parts.systemMessages;

  const handleSdkMessage = Effect.fn("handleSdkMessage")(function* (
    context: ClaudeSessionContext,
    message: SDKMessage,
  ) {
    yield* logNativeSdkMessage(context, message);
    yield* ensureThreadId(context, message);
    adoptHelperLaunch(context.taskAgents, message);
    const measured = yield* Effect.try({
      try: () => {
        if (message.type === "conversation_reset")
          context.turnUsage.resetNativeLedger(message.new_conversation_id, message.session_id);
        return context.turnUsage(message);
      },
      catch: (cause) =>
        new ProviderAdapterProcessError({
          provider: PROVIDER,
          threadId: context.session.threadId,
          detail: "Exact Claude usage accounting failed.",
          cause,
        }),
    }).pipe(
      Effect.catch((cause) => {
        return emitRuntimeWarning(context, `${cause.detail} ${String(cause.cause)}`, message).pipe(
          Effect.as([]),
        );
      }),
    );
    for (const payload of measured) {
      const stamp = yield* makeEventStamp();
      yield* offerRuntimeEvent({
        ...stamp,
        type: "turn.usage.completed",
        provider: PROVIDER,
        threadId: context.session.threadId,
        providerRefs: {},
        payload,
      });
    }

    // Wire-only command bookkeeping has no user-facing T3 lifecycle.
    if (sdkMessageType(message) === "command_lifecycle") {
      return;
    }

    switch (message.type) {
      case "stream_event":
        yield* handleStreamEvent(context, message);
        return;
      case "user":
        yield* handleUserMessage(context, message);
        return;
      case "assistant":
        yield* handleAssistantMessage(context, message);
        return;
      case "result":
        yield* handleResultMessage(context, message);
        return;
      case "system":
        yield* handleSystemMessage(context, message);
        return;
      case "tool_progress":
      case "tool_use_summary":
      case "auth_status":
      case "rate_limit_event":
        yield* handleSdkTelemetryMessage(context, message);
        return;
      // Composer prompt suggestions have no T3 surface; consumed deliberately.
      // `conversation_reset` announces a CLI-side conversation id swap
      // (e.g. /clear); T3 keeps its own thread identity and resume cursor.
      case "prompt_suggestion":
        return;
      case "conversation_reset": {
        return;
      }
      default: {
        // Exhaustiveness guard (see handleSystemMessage): new SDK top-level
        // message types fail typecheck here instead of warning at runtime.
        message satisfies never;
        const unknownMessage = message as never as { type: string };
        yield* emitRuntimeWarning(
          context,
          describeUnknownSdkMessage(`Claude SDK message '${unknownMessage.type}'`, message),
          message,
        );
        return;
      }
    }
  });

  /** Why the stream died, read off its error and the CLI's stderr, logged whole and scrubbed. */
  const logStreamFailure = Effect.fn("logStreamFailure")(function* (
    context: ClaudeSessionContext,
    input: { readonly error: unknown; readonly detail: string; readonly defect: boolean },
  ) {
    const failure = describeClaudeStreamFailure({
      error: input.error,
      stderr: context.stderrTail.text(),
      defect: input.defect,
    });
    // Only what says what crashed reaches the log (`crashLines`), never the
    // CLI's stderr as it came.
    yield* Effect.logError("claude.stream.failed", {
      threadId: context.session.threadId,
      detail: input.detail,
      reason: failure.reason,
      error: failure.log.error,
      exitCode: failure.log.exitCode,
      signal: failure.log.signal,
      crashLines: failure.log.crashLines,
      ...(failure.log.stack === null ? {} : { stack: failure.log.stack }),
      liveTasks: context.liveTaskIds.size,
      turnActive: context.turnState !== undefined,
    });
    return failure;
  });

  const runSdkStream = (
    context: ClaudeSessionContext,
  ): Effect.Effect<void, ProviderAdapterProcessError> =>
    Stream.fromAsyncIterable(
      context.query,
      (cause) =>
        new ProviderAdapterProcessError({
          provider: PROVIDER,
          threadId: context.session.threadId,
          detail: STREAM_FAILED_DETAIL,
          cause,
        }),
    ).pipe(
      Stream.takeWhile(() => !context.stopped),
      Stream.runForEach((message) =>
        handleSdkMessage(context, message).pipe(
          Effect.mapError(
            (cause) =>
              new ProviderAdapterProcessError({
                provider: PROVIDER,
                threadId: context.session.threadId,
                detail: "Failed to process Claude runtime event.",
                cause,
              }),
          ),
        ),
      ),
    );

  const handleStreamExit = Effect.fn("handleStreamExit")(function* (
    context: ClaudeSessionContext,
    exit: Exit.Exit<void, ProviderAdapterProcessError>,
  ) {
    if (context.stopped) {
      return;
    }

    if (Exit.isFailure(exit) && isClaudeInterruptedCause(exit.cause)) {
      if (context.turnState) {
        yield* completeTurn(context, "interrupted", "Claude runtime interrupted.");
      }
    } else {
      // The stream ended without a stop from here: Claude Code's stream died
      // (its error), or it ended by itself (none), or our own reading of it
      // failed (a defect, or a failure to handle an event) — that one is ours.
      const failures = Exit.isFailure(exit)
        ? exit.cause.reasons.flatMap((reason) => (Cause.isFailReason(reason) ? [reason.error] : []))
        : [];
      const defects = Exit.isFailure(exit)
        ? exit.cause.reasons.flatMap((reason) => (Cause.isDieReason(reason) ? [reason.defect] : []))
        : [];
      const first = failures[0];
      const ours =
        defects.length > 0 || (first !== undefined && first.detail !== STREAM_FAILED_DETAIL);
      const failure = yield* logStreamFailure(context, {
        error: defects[0] ?? first?.cause,
        detail: first?.detail ?? (Exit.isFailure(exit) ? "defect" : "Claude runtime stream ended."),
        defect: ours,
      });
      // The person is told why, and the turn fails with it: its reason stands
      // as the thread's last error. With no turn, its helpers stop with it
      // (`stopSessionInternal`) and the person is told all the same; a stream
      // that ended by itself with nothing at work is only logged.
      const told =
        Exit.isFailure(exit) || context.turnState !== undefined || context.liveTaskIds.size > 0;
      const words = context.startFailure ?? failure.words;
      if (told) {
        context.endWords = words;
        yield* emitRuntimeError(
          context,
          words,
          {
            failureCount: failures.length + defects.length,
            failureTags: [
              ...failures.map((failure) => failure._tag),
              ...defects.map(() => "Defect"),
            ],
          },
          // Its stream died: the turn broke off.
          "process_exit",
        );
      }
      if (context.turnState) {
        yield* completeTurn(context, "failed", words);
      }
    }

    yield* stopSessionInternal(context, {
      emitExitEvent: true,
    });
  });

  const stopSessionInternal = Effect.fn("stopSessionInternal")(function* (
    context: ClaudeSessionContext,
    options?: { readonly emitExitEvent?: boolean },
  ) {
    if (context.stopped) return;

    // Schedule process termination before any cleanup that can wait on the
    // provider. The SDK closes stdin, then escalates from SIGTERM to SIGKILL.
    yield* Effect.try({
      try: () => context.query.close(),
      catch: (cause) =>
        new ProviderAdapterProcessError({
          provider: PROVIDER,
          threadId: context.session.threadId,
          detail: "Failed to close Claude runtime query.",
          cause,
        }),
    });

    context.stopped = true;

    for (const taskId of Array.from(context.liveTaskIds)) {
      if (!context.liveTaskIds.delete(taskId)) {
        continue;
      }
      yield* closeHelperCalls(context, taskId, "failed", { status: "stopped" });
      const stamp = yield* makeEventStamp();
      yield* offerRuntimeEvent({
        type: "task.completed",
        eventId: stamp.eventId,
        provider: PROVIDER,
        createdAt: stamp.createdAt,
        threadId: context.session.threadId,
        ...(context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {}),
        payload: {
          taskId: RuntimeTaskId.make(taskId),
          status: "stopped",
          ...taskLinkageFor(context.taskAgents, taskId),
        },
        providerRefs: nativeProviderRefs(context),
      });
    }

    // A helper never known by its task leaves its calls too: nothing runs them now.
    for (const [index, tool] of context.inFlightTools.entries()) {
      if (tool.agentId === undefined) continue;
      yield* closeUnreturnedCall(context, tool, {
        status: "failed",
        turnId: context.turnState?.turnId,
        rawMethod: "claude/stop",
        rawPayload: { status: "stopped" },
      });
      context.inFlightTools.delete(index);
    }

    for (const [requestId, pending] of context.pendingApprovals) {
      yield* Deferred.succeed(pending.decision, "cancel");
      const stamp = yield* makeEventStamp();
      yield* offerRuntimeEvent({
        type: "request.resolved",
        eventId: stamp.eventId,
        provider: PROVIDER,
        createdAt: stamp.createdAt,
        threadId: context.session.threadId,
        ...(context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {}),
        requestId: asRuntimeRequestId(requestId),
        payload: {
          requestType: pending.requestType,
          decision: "cancel",
        },
        providerRefs: nativeProviderRefs(context),
      });
    }
    context.pendingApprovals.clear();

    // Same reason as the approvals above: a request nobody can answer any more
    // must not stay open, or the thread can never be settled.
    for (const pending of context.pendingUserInputs.values()) {
      yield* pending.cancel;
    }

    if (context.turnState) {
      yield* completeTurn(context, "interrupted", "Session stopped.");
    }

    yield* Queue.shutdown(context.promptQueue);

    const streamFiber = context.streamFiber;
    context.streamFiber = undefined;
    if (streamFiber && streamFiber.pollUnsafe() === undefined) {
      yield* Fiber.interrupt(streamFiber);
    }

    const updatedAt = yield* nowIso;
    context.session = {
      ...context.session,
      status: "closed",
      activeTurnId: undefined,
      updatedAt,
    };

    if (options?.emitExitEvent !== false && sessions.get(context.session.threadId) === context) {
      const stamp = yield* makeEventStamp();
      yield* offerRuntimeEvent({
        type: "session.exited",
        eventId: stamp.eventId,
        provider: PROVIDER,
        createdAt: stamp.createdAt,
        threadId: context.session.threadId,
        payload: {
          reason: context.endWords ?? "Session stopped",
          exitKind: context.endWords === undefined ? "graceful" : "error",
        },
        providerRefs: {},
      });
    }

    if (sessions.get(context.session.threadId) === context) {
      sessions.delete(context.session.threadId);
    }
  });

  const requireSession = (
    threadId: ThreadId,
  ): Effect.Effect<ClaudeSessionContext, ProviderAdapterError> => {
    const context = sessions.get(threadId);
    if (!context) {
      return Effect.fail(
        new ProviderAdapterSessionNotFoundError({
          provider: PROVIDER,
          threadId,
        }),
      );
    }
    if (context.stopped || context.session.status === "closed") {
      return Effect.fail(
        new ProviderAdapterSessionClosedError({
          provider: PROVIDER,
          threadId,
          detail: context.endWords,
        }),
      );
    }
    return Effect.succeed(context);
  };

  return { runSdkStream, handleStreamExit, stopSessionInternal, requireSession };
};

export type ClaudeSessionStream = ReturnType<typeof makeClaudeSessionStream>;
