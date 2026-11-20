import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { ProviderAdapterValidationError } from "../Errors.ts";
import {
  PROVIDER,
  type ClaudeAdapterKit,
  type ClaudeResumeState,
  type ClaudeSessionContext,
} from "./ClaudeSessionState.ts";

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isSyntheticClaudeThreadId(value: string): boolean {
  return value.startsWith("claude-thread-");
}

export function hasDurableClaudeSessionId(message: SDKMessage): boolean {
  if (message.type !== "system") {
    return true;
  }

  return (
    message.subtype !== "hook_started" &&
    message.subtype !== "hook_progress" &&
    message.subtype !== "hook_response"
  );
}

export function readClaudeResumeState(resumeCursor: unknown): ClaudeResumeState | undefined {
  if (!resumeCursor || typeof resumeCursor !== "object") {
    return undefined;
  }
  const cursor = resumeCursor as {
    threadId?: unknown;
    resume?: unknown;
    sessionId?: unknown;
    resumeSessionAt?: unknown;
    turnCount?: unknown;
    turnStartMessageIds?: unknown;
    instructions?: unknown;
    startInstructions?: unknown;
  };

  const threadIdCandidate = typeof cursor.threadId === "string" ? cursor.threadId : undefined;
  const threadId =
    threadIdCandidate && !isSyntheticClaudeThreadId(threadIdCandidate)
      ? ThreadId.make(threadIdCandidate)
      : undefined;
  const resumeCandidate =
    typeof cursor.resume === "string"
      ? cursor.resume
      : typeof cursor.sessionId === "string"
        ? cursor.sessionId
        : undefined;
  const resume = resumeCandidate && isUuid(resumeCandidate) ? resumeCandidate : undefined;
  const resumeSessionAt =
    typeof cursor.resumeSessionAt === "string" ? cursor.resumeSessionAt : undefined;
  const turnCountValue = typeof cursor.turnCount === "number" ? cursor.turnCount : undefined;
  const turnStartMessageIds =
    Array.isArray(cursor.turnStartMessageIds) &&
    cursor.turnStartMessageIds.every((id: unknown) => id === null || typeof id === "string")
      ? (cursor.turnStartMessageIds as Array<string | null>)
      : undefined;

  return {
    ...(threadId ? { threadId } : {}),
    ...(resume ? { resume } : {}),
    ...(resumeSessionAt ? { resumeSessionAt } : {}),
    ...(turnStartMessageIds ? { turnStartMessageIds } : {}),
    ...(typeof cursor.instructions === "string" ? { instructions: cursor.instructions } : {}),
    ...(typeof cursor.startInstructions === "string"
      ? { startInstructions: cursor.startInstructions }
      : {}),
    ...(turnCountValue !== undefined && Number.isInteger(turnCountValue) && turnCountValue >= 0
      ? { turnCount: turnCountValue }
      : {}),
  };
}

/** The session's resume cursor and thread id as Claude reports them. */
export const makeClaudeResumeCursor = (kit: ClaudeAdapterKit) => {
  const { nowIso, makeEventStamp, offerRuntimeEvent } = kit;

  const snapshotThread = Effect.fn("snapshotThread")(function* (context: ClaudeSessionContext) {
    const threadId = context.session.threadId;
    if (!threadId) {
      return yield* new ProviderAdapterValidationError({
        provider: PROVIDER,
        operation: "readThread",
        issue: "Session thread id is not initialized yet.",
      });
    }
    return {
      threadId,
      turns: context.turns.map((turn) => ({ id: turn.id, items: [] })),
    };
  });

  const updateResumeCursor = Effect.fn("updateResumeCursor")(function* (
    context: ClaudeSessionContext,
  ) {
    const threadId = context.session.threadId;
    if (!threadId) return;

    const resumeCursor = {
      threadId,
      ...(context.resumeSessionId ? { resume: context.resumeSessionId } : {}),
      ...(context.lastAssistantUuid ? { resumeSessionAt: context.lastAssistantUuid } : {}),
      turnCount: context.turnStartMessageIds.length,
      turnStartMessageIds: [...context.turnStartMessageIds],
      ...(context.instructions ? { instructions: context.instructions } : {}),
      ...(context.startInstructions ? { startInstructions: context.startInstructions } : {}),
    };

    context.session = {
      ...context.session,
      resumeCursor,
      updatedAt: yield* nowIso,
    };
  });

  const ensureThreadId = Effect.fn("ensureThreadId")(function* (
    context: ClaudeSessionContext,
    message: SDKMessage,
  ) {
    if (typeof message.session_id !== "string" || message.session_id.length === 0) {
      return;
    }
    if (!hasDurableClaudeSessionId(message)) {
      return;
    }
    const nextThreadId = message.session_id;
    context.resumeSessionId = message.session_id;
    yield* updateResumeCursor(context);

    if (context.lastThreadStartedId !== nextThreadId) {
      context.lastThreadStartedId = nextThreadId;
      const stamp = yield* makeEventStamp();
      yield* offerRuntimeEvent({
        type: "thread.started",
        eventId: stamp.eventId,
        provider: PROVIDER,
        createdAt: stamp.createdAt,
        threadId: context.session.threadId,
        payload: {
          providerThreadId: nextThreadId,
        },
        providerRefs: {},
        raw: {
          source: "claude.sdk.message",
          method: "claude/thread/started",
          payload: {
            session_id: message.session_id,
          },
        },
      });
    }
  });

  return { snapshotThread, updateResumeCursor, ensureThreadId };
};

export type ClaudeResumeCursor = ReturnType<typeof makeClaudeResumeCursor>;
