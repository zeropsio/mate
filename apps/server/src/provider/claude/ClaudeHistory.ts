// @effect-diagnostics nodeBuiltinImport:off
import * as NodeUtil from "node:util";
import * as Schema from "effect/Schema";
import { getSessionMessages, forkSession } from "@anthropic-ai/claude-agent-sdk";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { ProviderAdapterRequestError, ProviderAdapterValidationError } from "../Errors.ts";
import { type ClaudeAdapterShape } from "../Services/ClaudeAdapter.ts";
import { spawnAndCollect } from "../providerSnapshot.ts";
import { PROVIDER } from "./ClaudeSessionState.ts";
import { toRequestError } from "./ClaudeFailures.ts";
import type { ClaudeAdapterLiveOptions } from "../Layers/ClaudeAdapter.ts";
import { type ClaudeResumeCursor } from "./ClaudeResumeCursor.ts";
import { type ClaudeSessionStream } from "./ClaudeSessionStream.ts";

export const encodeHistoryArgs = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
export const decodeHistoryFork = Schema.decodeSync(
  Schema.fromJsonString(Schema.Struct({ sessionId: Schema.String })),
);
export const decodeSessionMessages = Schema.decodeSync(
  Schema.fromJsonString(
    Schema.Array(
      Schema.Struct({
        type: Schema.Literals(["user", "assistant", "system"]),
        uuid: Schema.String,
        parent_tool_use_id: Schema.NullOr(Schema.String),
        message: Schema.Unknown,
      }),
    ),
  ),
);

type ClaudeHistoryMessage = {
  readonly type: string;
  readonly uuid: string;
  readonly parent_tool_use_id: string | null;
  readonly message: unknown;
};

const isClaudeConversationMessage = (message: ClaudeHistoryMessage): boolean =>
  message.type === "user" || message.type === "assistant";

export const isClaudeHumanTurnStart = (message: ClaudeHistoryMessage): boolean => {
  if (message.type !== "user" || message.parent_tool_use_id !== null) return false;
  const body = message.message;
  if (typeof body !== "object" || body === null || !("content" in body)) return false;
  const content = body.content;
  return (
    typeof content === "string" ||
    (Array.isArray(content) &&
      content.some(
        (part: unknown) =>
          typeof part === "object" &&
          part !== null &&
          "type" in part &&
          part.type !== "tool_result",
      ))
  );
};

const conversationIndexForUuid = (
  messages: ReadonlyArray<ClaudeHistoryMessage>,
  uuid: string,
): number => {
  let index = -1;
  for (const message of messages) {
    if (!isClaudeConversationMessage(message)) continue;
    index += 1;
    if (message.uuid === uuid) return index;
  }
  return -1;
};

// Native forks rewrite every UUID. getSessionMessages then rebuilds the
// parentUuid chain, so system notices and compact metadata can change the
// raw length without dropping retained user/assistant turns. Align those
// conversation messages from the truncated end, then remap T3 turn starts.
export const remapClaudeForkTurnBoundaries = (
  messages: ReadonlyArray<ClaudeHistoryMessage>,
  forkMessages: ReadonlyArray<ClaudeHistoryMessage>,
  firstRemoved: number,
  retainedBoundaries: ReadonlyArray<string | null>,
): Array<string | null> | undefined => {
  const retainedConversation = messages.slice(0, firstRemoved).filter(isClaudeConversationMessage);
  const forkConversation = forkMessages.filter(isClaudeConversationMessage);
  if (retainedConversation.length === 0) {
    return retainedBoundaries.every((id) => id === null) ? [...retainedBoundaries] : undefined;
  }
  const offset = forkConversation.length - retainedConversation.length;
  // Forks preserve message bodies. Matching roles alone can mistake a restored
  // steering message for a retained turn when compaction changes the chain.
  if (
    offset < 0 ||
    retainedConversation.some((message, index) => {
      const forkMessage = forkConversation[index + offset];
      return (
        forkMessage === undefined ||
        forkMessage.type !== message.type ||
        !NodeUtil.isDeepStrictEqual(forkMessage.message, message.message)
      );
    })
  ) {
    return undefined;
  }
  const remapped = retainedBoundaries.map((originalId) => {
    if (originalId === null) return null;
    const originalIndex = conversationIndexForUuid(messages, originalId);
    const forkIndex = originalIndex + offset;
    const forkMessage =
      originalIndex >= 0 && forkIndex >= 0 ? forkConversation[forkIndex] : undefined;
    const originalMessage = messages.find((message) => message.uuid === originalId);
    return forkMessage !== undefined &&
      originalMessage !== undefined &&
      forkMessage.type === originalMessage.type
      ? forkMessage.uuid
      : null;
  });
  return remapped.some((id) => id === null) ? undefined : remapped;
};

/** A thread's rollback: Claude's history read in the worker, the session forked before the dropped turns. */
export const makeClaudeRollback = Effect.fn("makeClaudeRollback")(function* (
  parts: {
    readonly resumeCursor: ClaudeResumeCursor;
    readonly sessionStream: ClaudeSessionStream;
  },
  startSession: ClaudeAdapterShape["startSession"],
  claudeEnvironment: NodeJS.ProcessEnv,
  options: ClaudeAdapterLiveOptions | undefined,
) {
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const { snapshotThread } = parts.resumeCursor;
  const { stopSessionInternal, requireSession } = parts.sessionStream;

  const rollbackThread: ClaudeAdapterShape["rollbackThread"] = Effect.fn("rollbackThread")(
    function* (threadId, numTurns) {
      const context = yield* requireSession(threadId);
      if (!Number.isInteger(numTurns) || numTurns < 1) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "rollbackThread",
          issue: "numTurns must be an integer >= 1.",
        });
      }
      if (
        context.turnStartMessageIds.length > 0 &&
        context.turnStartMessageIds.every((id) => id !== null) &&
        numTurns >= context.turnStartMessageIds.length
      ) {
        yield* stopSessionInternal(context, { emitExitEvent: false });
        yield* startSession({
          ...context.startInput,
          runtimeMode: context.session.runtimeMode,
          resumeCursor: undefined,
        });
        return yield* snapshotThread(yield* requireSession(threadId));
      }
      const sessionId = context.resumeSessionId;
      if (!sessionId) {
        return yield* new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "thread/rollback",
          detail: "Claude session id is unavailable.",
        });
      }
      const historyWorkerPath = yield* path
        .fromFileUrl(
          new URL(
            import.meta.url.endsWith(".ts")
              ? "../../claudeHistoryWorker.ts"
              : "./claudeHistoryWorker.mjs",
            import.meta.url,
          ),
        )
        .pipe(Effect.mapError((cause) => toRequestError(threadId, "thread/rollback", cause)));
      const runScopedHistoryCommand = async (
        method: "getSessionMessages" | "forkSession",
        args: object,
        historySessionId = sessionId,
      ) => {
        // SDK history helpers read process.env. Isolate the provider's home instead
        // of changing the server's environment while other providers are running.
        // @effect-diagnostics-next-line runEffectInsideEffect:off - SDK callback runs outside the fiber; the spawn is self-contained
        const result = await Effect.runPromise(
          spawnAndCollect(
            process.execPath,
            ChildProcess.make(
              process.execPath,
              [historyWorkerPath, method, historySessionId, encodeHistoryArgs(args)],
              { env: { ...claudeEnvironment, ELECTRON_RUN_AS_NODE: "1" } },
            ),
          ).pipe(
            Effect.timeout("30 seconds"),
            Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
          ),
        );
        if (result.code !== 0) throw new Error(result.stderr || "Claude history command failed.");
        return result.stdout;
      };
      const readHistory = (historySessionId: string) =>
        Effect.tryPromise({
          try: async () => {
            const readOptions = {
              ...(context.session.cwd ? { dir: context.session.cwd } : {}),
              includeSystemMessages: true,
            };
            if (options?.getSessionMessages)
              return options.getSessionMessages(historySessionId, readOptions);
            if (claudeEnvironment.CLAUDE_CONFIG_DIR === process.env.CLAUDE_CONFIG_DIR) {
              return getSessionMessages(historySessionId, readOptions);
            }
            return decodeSessionMessages(
              await runScopedHistoryCommand("getSessionMessages", readOptions, historySessionId),
            );
          },
          catch: (cause) => toRequestError(threadId, "thread/rollback", cause),
        });
      const messages = yield* readHistory(sessionId);
      // Tool results are user-role messages too. Only human prompts begin a turn.
      const turnStarts = messages.flatMap((message, index) =>
        isClaudeHumanTurnStart(message) ? [index] : [],
      );
      if (messages.length === 0) {
        return yield* new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "thread/rollback",
          detail: "Claude session history is unavailable.",
        });
      }
      const boundaries = [...context.turnStartMessageIds];
      // Older cursors did not record native boundaries. Infer them only when
      // their T3 turn count agrees; steers must never be treated as extra turns.
      if (
        boundaries.every((id): boolean => id === null) &&
        boundaries.length === turnStarts.length
      ) {
        boundaries.splice(
          0,
          boundaries.length,
          ...turnStarts.map((index) => messages[index]!.uuid),
        );
      }
      const retainedCount = Math.max(0, boundaries.length - numTurns);
      const firstRemovedId = boundaries[retainedCount];
      const firstRemoved = messages.findIndex((message) => message.uuid === firstRemovedId);
      if (
        boundaries.length === 0 ||
        boundaries.some((id) => id === null) ||
        (retainedCount > 0 && firstRemoved < 1)
      ) {
        return yield* new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "thread/rollback",
          detail:
            "The exact Claude turn boundary is unavailable, possibly after compaction or recovery of older history. Start a new thread instead.",
        });
      }
      const rollbackAt = retainedCount > 0 ? messages[firstRemoved - 1]?.uuid : undefined;
      const retainedTurns = context.turns.slice(0, Math.max(0, context.turns.length - numTurns));
      const fork = rollbackAt
        ? yield* Effect.tryPromise({
            try: async () => {
              const forkOptions = {
                ...(context.session.cwd ? { dir: context.session.cwd } : {}),
                upToMessageId: rollbackAt,
              };
              if (options?.forkSession) return options.forkSession(sessionId, forkOptions);
              if (claudeEnvironment.CLAUDE_CONFIG_DIR === process.env.CLAUDE_CONFIG_DIR) {
                return forkSession(sessionId, forkOptions);
              }
              return decodeHistoryFork(await runScopedHistoryCommand("forkSession", forkOptions));
            },
            catch: (cause) => toRequestError(threadId, "thread/rollback", cause),
          })
        : undefined;
      const retainedBoundaries = boundaries.slice(0, retainedCount);
      if (fork) {
        const forkMessages = yield* readHistory(fork.sessionId);
        const remappedBoundaries = remapClaudeForkTurnBoundaries(
          messages,
          forkMessages,
          firstRemoved,
          retainedBoundaries,
        );
        if (!remappedBoundaries) {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "thread/rollback",
            detail: "Claude fork history did not preserve the retained turn boundaries.",
          });
        }
        retainedBoundaries.splice(0, retainedBoundaries.length, ...remappedBoundaries);
      }
      yield* stopSessionInternal(context, { emitExitEvent: false });
      yield* startSession({
        ...context.startInput,
        runtimeMode: context.session.runtimeMode,
        resumeCursor: fork
          ? {
              resume: fork.sessionId,
              turnCount: retainedCount,
              turnStartMessageIds: retainedBoundaries,
              // A reminder may sit in a trimmed turn: the fork has heard only its first prompt.
              ...(context.startInstructions
                ? {
                    instructions: context.startInstructions,
                    startInstructions: context.startInstructions,
                  }
                : {}),
            }
          : undefined,
      });
      const restarted = yield* requireSession(threadId);
      restarted.turns.push(...retainedTurns);
      return yield* snapshotThread(restarted);
    },
  );

  return { rollbackThread };
});
