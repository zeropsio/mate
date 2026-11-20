/**
 * ClaudeAdapterLive - Scoped live implementation for the Claude Agent provider adapter.
 *
 * Wraps `@anthropic-ai/claude-agent-sdk` query sessions behind the generic
 * provider adapter contract and emits canonical runtime events.
 *
 * @module ClaudeAdapterLive
 */

import {
  type CanUseTool,
  query,
  getSessionMessages,
  forkSession,
  type Options as ClaudeQueryOptions,
  type PermissionMode,
  type PermissionResult,
  type PermissionUpdate,
  type SettingSource,
  type SDKUserMessage,
  type Query as ClaudeSdkQuery,
} from "@anthropic-ai/claude-agent-sdk";
import { parseCliArgs } from "@t3tools/shared/cliArgs";
import { type ClaudeScopedLimitNames } from "./claudeUsageLimits.ts";
import {
  ApprovalRequestId,
  CLAUDE_DEFAULT_AUTO_COMPACT_WINDOW,
  type ClaudeSettings,
  EventId,
  type ProviderApprovalDecision,
  ProviderInstanceId,
  type ProviderRuntimeEvent,
  type ProviderSession,
  type ProviderUserInputAnswers,
  ThreadId,
  TurnId,
  type UserInputQuestion,
} from "@t3tools/contracts";
import {
  getModelSelectionBooleanOptionValue,
  getModelSelectionStringOptionValue,
  getProviderOptionDescriptors,
} from "@t3tools/shared/model";
import {
  CLAUDE_RESUME_COMPACTION_NEVER_ANSWER,
  formatClaudeResumeCompactionQuestion,
} from "@t3tools/shared/claudeCompaction";
import * as Cause from "effect/Cause";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Fiber from "effect/Fiber";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { ServerConfig } from "../../config.ts";
import {
  applyClaudeQueryOptionsPatch,
  claudeProfileModelSelection,
  claudeQueryOptionsPatch,
  claudeTurnModelSelection,
  readClaudeThreadRegistries,
  resolveClaudeThreadSetup,
} from "../../spi/claudeThreadProfile.ts";
import { claudeMcpControl, type ClaudeMcpQuery } from "../../spi/mcpControl.ts";
import { makeClaudeTurnUsage } from "../../spi/responseUsage.ts";

/** A session as the MCP tab's hook sees it. */
const claudeMcpSession = (context: {
  readonly query: ClaudeMcpQuery;
  readonly profiled: boolean;
}) => ({ runtime: context.query, profiled: context.profiled });
import { resolveClaudeSdkExecutablePath } from "../Drivers/ClaudeExecutable.ts";
import { makeClaudeEnvironment } from "../Drivers/ClaudeHome.ts";
import { rememberTurnPictures } from "../../providerPictures.ts";
import { claudeLaunchArgDirectories, discoverClaudeSkills } from "../Drivers/ClaudeSkills.ts";
import { buildRuntimeInstructions } from "../RuntimeInstructions.ts";
import { instructionsMark, instructionsRefresh } from "../../resumedInstructions.ts";
import { makePersonaReader } from "../../personaInstructions.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import {
  BUNDLED_CLAUDE_MODEL_CATALOG,
  type ClaudeModelCatalog,
  getClaudeCatalogModelCapabilities,
  isClaudeCatalogUltracodeEffort,
  normalizeClaudeCatalogEffort,
  resolveClaudeCatalogApiModelId,
  resolveClaudeCatalogEffort,
  resolveClaudeModelSlug,
  scopeClaudeModelCatalog,
} from "../ClaudeModelCatalog.ts";
import {
  ProviderAdapterProcessError,
  ProviderAdapterRequestError,
  ProviderAdapterSessionClosedError,
  ProviderAdapterValidationError,
} from "../Errors.ts";
import { makeStderrTail } from "../claudeStreamFailure.ts";
import { type ClaudeAdapterShape } from "../Services/ClaudeAdapter.ts";
import { spawnAndCollect } from "../providerSnapshot.ts";
import { type EventNdjsonLogger, makeEventNdjsonLogger } from "./EventNdjsonLogger.ts";
import {
  PROVIDER,
  type ClaudeSdkEffort,
  type PromptQueueItem,
  type ClaudeTurnState,
  type PendingApproval,
  type PendingUserInput,
  type ToolInFlight,
  type ClaudeTaskState,
  type ClaudeTaskAgentState,
  type ClaudeSessionContext,
  type ClaudeQueryRuntime,
  type ClaudeAdapterKit,
  asCanonicalTurnId,
  asRuntimeRequestId,
  nativeProviderRefs,
} from "../claude/ClaudeSessionState.ts";
import { encodeJsonStringForDiagnostics } from "../claude/ClaudeSdkMessages.ts";
import {
  classifyRequestType,
  summarizeToolRequest,
  extractExitPlanModePlan,
} from "../claude/ClaudeToolItems.ts";
import { helperOfCall } from "../claude/ClaudeTasks.ts";
import {
  selectedClaudeContextWindow,
  finiteNonNegativeInteger,
} from "../claude/ClaudeTokenUsage.ts";
import { toMessage, toRequestError } from "../claude/ClaudeFailures.ts";
import { makeClaudeResumeCursor, readClaudeResumeState } from "../claude/ClaudeResumeCursor.ts";
import { buildUserMessageEffect } from "../claude/ClaudeUserMessage.ts";
import {
  decodeHistoryFork,
  decodeSessionMessages,
  encodeHistoryArgs,
  isClaudeHumanTurnStart,
  remapClaudeForkTurnBoundaries,
} from "../claude/ClaudeHistory.ts";
import { makeClaudeStreamEvents } from "../claude/ClaudeStreamEvents.ts";
import { makeClaudeTurns } from "../claude/ClaudeTurns.ts";
import { makeClaudeToolCalls } from "../claude/ClaudeToolCalls.ts";
import { makeClaudeAssistantText } from "../claude/ClaudeAssistantText.ts";
import { makeClaudeRuntimeEmit } from "../claude/ClaudeRuntimeEmit.ts";
import { makeClaudeMessages } from "../claude/ClaudeMessages.ts";
import { makeClaudeSystemMessages } from "../claude/ClaudeSystemMessages.ts";
import { makeClaudeSessionStream } from "../claude/ClaudeSessionStream.ts";
/**
 * Permission updates applied for an "Always allow this session" decision.
 *
 * Claude Code's suggestions are reused when present but rescoped to
 * `destination: "session"` — echoing them verbatim would persist the
 * session-only choice as a permanent rule (suggestions typically target
 * `localSettings`, i.e. `.claude/settings.local.json`). When Claude Code
 * offers no suggestion — common for MCP tools — fall back to a whole-tool
 * session allow rule so the decision still sticks for the session instead of
 * silently degrading into a one-shot accept.
 */
function toSessionPermissionUpdates(
  toolName: string,
  suggestions: ReadonlyArray<PermissionUpdate> | undefined,
): Array<PermissionUpdate> {
  const sessionScoped = (suggestions ?? []).map((suggestion): PermissionUpdate => ({
    ...suggestion,
    destination: "session",
  }));
  if (sessionScoped.length > 0) {
    return sessionScoped;
  }
  return [
    {
      type: "addRules",
      rules: [{ toolName }],
      behavior: "allow",
      destination: "session",
    },
  ];
}

/** How long Stop waits for Claude to abort a turn before killing the process. */
const CLAUDE_INTERRUPT_GRACE = "3 seconds";

export interface ClaudeAdapterLiveOptions {
  readonly instanceId?: ProviderInstanceId;
  readonly environment?: NodeJS.ProcessEnv;
  readonly createQuery?: (input: {
    readonly prompt: AsyncIterable<SDKUserMessage>;
    readonly options: ClaudeQueryOptions;
  }) => ClaudeQueryRuntime;
  readonly getSessionMessages?: typeof getSessionMessages;
  readonly forkSession?: typeof forkSession;
  readonly nativeEventLogPath?: string;
  readonly nativeEventLogger?: EventNdjsonLogger;
  readonly modelCatalog?: Effect.Effect<ClaudeModelCatalog>;
  /** Scoped-bucket names the driver's status probe last saw; see `claudeUsageLimits`. */
  readonly scopedLimitNames?: Ref.Ref<ClaudeScopedLimitNames>;
  /** A session's full command list for its folder: on start, and whenever Claude reports a change. */
  readonly onWorkspaceCommands?: (
    commands: Awaited<ReturnType<ClaudeSdkQuery["supportedCommands"]>>,
    cwd: string,
  ) => Effect.Effect<void>;
}

function getEffectiveClaudeAgentEffort(
  catalog: ClaudeModelCatalog,
  effort: string | null | undefined,
  model: string | null | undefined,
): ClaudeSdkEffort | null {
  const normalized = normalizeClaudeCatalogEffort(catalog, effort, model);
  return normalized ? (normalized as ClaudeSdkEffort) : null;
}

// Model and effort can change after this session-level prompt is set.
const CLAUDE_INSTRUCTIONS = buildRuntimeInstructions({ harness: "Claude Code" });
/** The text a preset system prompt appends, when it is one. */
const presetAppend = (systemPrompt: ClaudeQueryOptions["systemPrompt"]) =>
  typeof systemPrompt === "object" && !Array.isArray(systemPrompt) && "append" in systemPrompt
    ? systemPrompt.append
    : undefined;
/** Mate's instructions for a session, with the persona unless it runs in a crew. */
const claudeInstructions = (persona: string | undefined) =>
  persona === undefined ? CLAUDE_INSTRUCTIONS : `${CLAUDE_INSTRUCTIONS}\n${persona}`;
const CLAUDE_SETTING_SOURCES = [
  "user",
  "project",
  "local",
] as const satisfies ReadonlyArray<SettingSource>;

function shouldRequestClaudeThinkingSummaries(input: {
  readonly thinking: boolean | undefined;
  readonly thinkingDisplay: string | null | undefined;
}): boolean {
  return input.thinking !== false && input.thinkingDisplay !== "omitted";
}

export const makeClaudeAdapter = Effect.fn("makeClaudeAdapter")(function* (
  claudeSettings: ClaudeSettings,
  options?: ClaudeAdapterLiveOptions,
) {
  const boundInstanceId = options?.instanceId ?? ProviderInstanceId.make("claudeAgent");
  const modelCatalogEffect = (
    options?.modelCatalog ?? Effect.succeed(BUNDLED_CLAUDE_MODEL_CATALOG)
  ).pipe(Effect.map((catalog) => scopeClaudeModelCatalog(catalog, claudeSettings.customModels)));
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const serverConfig = yield* ServerConfig;
  const readPersona = yield* makePersonaReader(yield* ServerSettingsService);
  const crypto = yield* SecureRandom.SecureRandom;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const threadRegistries = yield* readClaudeThreadRegistries;
  /**
   * The instructions a session should hold now: a crewmate's are its whole prompt from start,
   * with no persona. Undefined when no persona was ever read, and the session keeps what it heard.
   */
  const currentInstructions = (crewInstructions: string | undefined) =>
    crewInstructions !== undefined
      ? Effect.succeed(crewInstructions)
      : readPersona.pipe(
          Effect.map((persona) =>
            persona === undefined ? undefined : claudeInstructions(persona),
          ),
        );
  const claudeEnvironment = yield* makeClaudeEnvironment(claudeSettings, options?.environment).pipe(
    Effect.provideService(Path.Path, path),
  );
  const claudeSdkExecutablePath = yield* resolveClaudeSdkExecutablePath(
    claudeSettings.binaryPath,
    claudeEnvironment,
  );
  const nativeEventLogger =
    options?.nativeEventLogger ??
    (options?.nativeEventLogPath !== undefined
      ? yield* makeEventNdjsonLogger(options.nativeEventLogPath, {
          stream: "native",
        })
      : undefined);
  const managedNativeEventLogger =
    options?.nativeEventLogger === undefined ? nativeEventLogger : undefined;

  const createQuery =
    options?.createQuery ??
    ((input: {
      readonly prompt: AsyncIterable<SDKUserMessage>;
      readonly options: ClaudeQueryOptions;
    }) =>
      query({
        prompt: input.prompt,
        options: input.options,
      }) as ClaudeQueryRuntime);

  const sessions = new Map<ThreadId, ClaudeSessionContext>();
  const runtimeEventQueue = yield* Queue.unbounded<ProviderRuntimeEvent>();

  const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
  const randomUUIDv4 = crypto.uuidV4().pipe(
    Effect.mapError(
      (cause) =>
        new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "crypto/randomUUIDv4",
          detail: "Failed to generate Claude runtime identifier.",
          cause,
        }),
    ),
  );
  const nextEventId = Effect.map(randomUUIDv4, (id) => EventId.make(id));
  const makeEventStamp = () => Effect.all({ eventId: nextEventId, createdAt: nowIso });

  const offerRuntimeEvent = (event: ProviderRuntimeEvent): Effect.Effect<void> =>
    Queue.offer(runtimeEventQueue, event).pipe(Effect.asVoid);
  const kit: ClaudeAdapterKit = { nowIso, randomUUIDv4, makeEventStamp, offerRuntimeEvent };
  const resumeCursor = makeClaudeResumeCursor(kit);
  const { snapshotThread, updateResumeCursor } = resumeCursor;
  const runtimeEmit = makeClaudeRuntimeEmit(kit, nativeEventLogger);
  const { emitProposedPlanCompleted } = runtimeEmit;
  const assistantText = makeClaudeAssistantText(kit);
  const toolCalls = makeClaudeToolCalls(kit);
  const turns = makeClaudeTurns(kit, { resumeCursor, runtimeEmit, assistantText, toolCalls });
  const { completeTurn } = turns;
  const streamEvents = makeClaudeStreamEvents(kit, { runtimeEmit, assistantText, turns });
  const messages = yield* makeClaudeMessages(
    kit,
    { resumeCursor, runtimeEmit, assistantText, toolCalls, turns },
    claudeEnvironment,
  );
  const systemMessages = makeClaudeSystemMessages(
    kit,
    { resumeCursor, runtimeEmit, toolCalls, messages },
    options,
  );
  const sessionStream = makeClaudeSessionStream(
    kit,
    { resumeCursor, runtimeEmit, toolCalls, turns, streamEvents, messages, systemMessages },
    sessions,
  );
  const { runSdkStream, handleStreamExit, stopSessionInternal, requireSession } = sessionStream;

  const startSession: ClaudeAdapterShape["startSession"] = Effect.fn("startSession")(
    function* (input) {
      const modelCatalog = yield* modelCatalogEffect;
      if (input.provider !== undefined && input.provider !== PROVIDER) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "startSession",
          issue: `Expected provider '${PROVIDER}' but received '${input.provider}'.`,
        });
      }

      const existingContext = sessions.get(input.threadId);
      if (existingContext) {
        yield* Effect.logWarning("claude.session.replacing", {
          threadId: input.threadId,
          existingSessionStatus: existingContext.session.status,
          reason: "startSession called with existing active session",
        });
        yield* stopSessionInternal(existingContext, {
          emitExitEvent: false,
        });
      }

      const startedAt = yield* nowIso;
      const resumeState = readClaudeResumeState(input.resumeCursor);
      const threadId = input.threadId;
      const existingResumeSessionId = resumeState?.resume;
      const newSessionId = existingResumeSessionId === undefined ? yield* randomUUIDv4 : undefined;

      const runtimeContext = yield* Effect.context<never>();
      const runFork = Effect.runForkWith(runtimeContext);
      const runPromise = Effect.runPromiseWith(runtimeContext);

      const promptQueue = yield* Queue.unbounded<PromptQueueItem>();
      const prompt = Stream.fromQueue(promptQueue).pipe(
        Stream.filter((item) => item.type === "message"),
        Stream.map((item) => item.message),
        Stream.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause) ? Stream.empty : Stream.failCause(cause),
        ),
        Stream.toAsyncIterable,
      );

      const pendingApprovals = new Map<ApprovalRequestId, PendingApproval>();
      const pendingUserInputs = new Map<ApprovalRequestId, PendingUserInput>();
      const inFlightTools = new Map<string, ToolInFlight>();
      const claudeTasks = new Map<string, ClaudeTaskState>();
      const taskAgents = new Map<string, ClaudeTaskAgentState>();
      const pendingTaskModels = new Map<string, string>();
      const subagentToolParents = new Map<string, string>();
      const workflowMemberFingerprints = new Map<string, string>();
      const liveTaskIds = new Set<string>();

      const contextRef = yield* Ref.make<ClaudeSessionContext | undefined>(undefined);

      /**
       * Handle AskUserQuestion tool calls by emitting a `user-input.requested`
       * runtime event and waiting for the user to respond via `respondToUserInput`.
       */
      const handleAskUserQuestion = Effect.fn("handleAskUserQuestion")(function* (
        context: ClaudeSessionContext,
        toolInput: Record<string, unknown>,
        callbackOptions: {
          readonly signal: AbortSignal;
          readonly toolUseID?: string;
        },
      ) {
        const requestId = ApprovalRequestId.make(yield* randomUUIDv4);

        // Parse questions from the SDK's AskUserQuestion input.
        // `id` MUST equal the full question text — Claude SDK >= 2.1.121 looks
        // up answers by question text in `mapToolResultToToolResultBlockParam`,
        // so the key the UI uses to keep its draft answer must match the SDK's
        // expected lookup key. See https://github.com/pingdotgg/t3code/issues/2388
        const rawQuestions = Array.isArray(toolInput.questions) ? toolInput.questions : [];
        const questions: Array<UserInputQuestion> = rawQuestions.map(
          (q: Record<string, unknown>, idx: number) => ({
            id: typeof q.question === "string" && q.question.length > 0 ? q.question : `q-${idx}`,
            header: typeof q.header === "string" ? q.header : `Question ${idx + 1}`,
            question: typeof q.question === "string" ? q.question : "",
            options: Array.isArray(q.options)
              ? q.options.map((opt: Record<string, unknown>) => ({
                  label: typeof opt.label === "string" ? opt.label : "",
                  description: typeof opt.description === "string" ? opt.description : "",
                }))
              : [],
            multiSelect: typeof q.multiSelect === "boolean" ? q.multiSelect : false,
          }),
        );

        const answersDeferred = yield* Deferred.make<ProviderUserInputAnswers>();
        let aborted = false;
        const settleAsAborted = Effect.suspend(() => {
          if (!pendingUserInputs.has(requestId)) {
            return Effect.void;
          }
          aborted = true;
          pendingUserInputs.delete(requestId);
          return Deferred.succeed(answersDeferred, {} as ProviderUserInputAnswers).pipe(
            Effect.ignore,
          );
        });
        const pendingInput: PendingUserInput = {
          questions,
          answers: answersDeferred,
          cancel: settleAsAborted,
        };

        // Emit user-input.requested so the UI can present the questions.
        const requestedStamp = yield* makeEventStamp();
        yield* offerRuntimeEvent({
          type: "user-input.requested",
          eventId: requestedStamp.eventId,
          provider: PROVIDER,
          createdAt: requestedStamp.createdAt,
          threadId: context.session.threadId,
          ...(context.turnState
            ? {
                turnId: asCanonicalTurnId(context.turnState.turnId),
              }
            : {}),
          requestId: asRuntimeRequestId(requestId),
          payload: { questions },
          providerRefs: nativeProviderRefs(context, {
            providerItemId: callbackOptions.toolUseID,
          }),
          raw: {
            source: "claude.sdk.permission",
            method: "canUseTool/AskUserQuestion",
            payload: {
              toolName: "AskUserQuestion",
              input: toolInput,
            },
          },
        });

        pendingUserInputs.set(requestId, pendingInput);

        // Handle abort (e.g. turn interrupted while waiting for user input).
        const onAbort = () => {
          runFork(settleAsAborted);
        };
        callbackOptions.signal.addEventListener("abort", onAbort, {
          once: true,
        });
        // The signal may have aborted during the awaited event emissions
        // above, before the listener existed; settle now so the dialog
        // cannot hang with a lingering pending question.
        if (callbackOptions.signal.aborted) {
          yield* settleAsAborted;
        }

        // Block until the user provides answers.
        const answers = yield* Deferred.await(answersDeferred);
        pendingUserInputs.delete(requestId);

        // Emit user-input.resolved so the UI knows the interaction completed.
        const resolvedStamp = yield* makeEventStamp();
        yield* offerRuntimeEvent({
          type: "user-input.resolved",
          eventId: resolvedStamp.eventId,
          provider: PROVIDER,
          createdAt: resolvedStamp.createdAt,
          threadId: context.session.threadId,
          ...(context.turnState
            ? {
                turnId: asCanonicalTurnId(context.turnState.turnId),
              }
            : {}),
          requestId: asRuntimeRequestId(requestId),
          payload: { answers },
          providerRefs: nativeProviderRefs(context, {
            providerItemId: callbackOptions.toolUseID,
          }),
          raw: {
            source: "claude.sdk.permission",
            method: "canUseTool/AskUserQuestion/resolved",
            payload: { answers },
          },
        });

        if (aborted) {
          return {
            behavior: "deny",
            message: "User cancelled tool execution.",
          } satisfies PermissionResult;
        }

        // Return the answers to the SDK in the expected format:
        // { questions: [...], answers: { questionText: selectedLabel } }
        return {
          behavior: "allow",
          updatedInput: {
            questions: toolInput.questions,
            answers,
          },
        } satisfies PermissionResult;
      });

      const handleResumeDialog = Effect.fn("handleResumeDialog")(function* (
        request: Parameters<NonNullable<ClaudeQueryOptions["onUserDialog"]>>[0],
        callbackOptions: Parameters<NonNullable<ClaudeQueryOptions["onUserDialog"]>>[1],
      ) {
        if (request.dialogKind !== "resume_return") {
          return { behavior: "cancelled" as const };
        }

        const context = yield* Ref.get(contextRef);
        if (!context) {
          return { behavior: "cancelled" as const };
        }

        // The question copy lives in @t3tools/shared/claudeCompaction because
        // the web client recognizes this exact text (and the "never" answer)
        // to mirror a permanent dismissal.
        const question = formatClaudeResumeCompactionQuestion({
          ageMinutes: finiteNonNegativeInteger(request.payload.sessionAgeMinutes) ?? 0,
          estimatedTokens: finiteNonNegativeInteger(request.payload.estimatedTokens) ?? 0,
        });
        const result = yield* handleAskUserQuestion(
          context,
          {
            questions: [
              {
                header: "Resume session",
                question,
                options: [
                  {
                    label: "Compact and continue",
                    description: "Resume with a summary and use fewer tokens.",
                  },
                  {
                    label: "Keep full history",
                    description: "Resume without changing the conversation.",
                  },
                  {
                    label: CLAUDE_RESUME_COMPACTION_NEVER_ANSWER,
                    description: "Keep full history and skip future resume prompts.",
                  },
                ],
                multiSelect: false,
              },
            ],
          },
          {
            signal: callbackOptions.signal,
            ...(request.toolUseID ? { toolUseID: request.toolUseID } : {}),
          },
        );

        if (result.behavior !== "allow") {
          return { behavior: "cancelled" as const };
        }

        const answers = result.updatedInput.answers;
        const selection =
          answers && typeof answers === "object" && !Array.isArray(answers)
            ? (answers as Record<string, unknown>)[question]
            : undefined;
        const action =
          selection === "Compact and continue"
            ? "compact"
            : selection === CLAUDE_RESUME_COMPACTION_NEVER_ANSWER
              ? "never"
              : "continue";

        return { behavior: "completed" as const, result: action };
      });

      const canUseToolEffect = Effect.fn("canUseTool")(function* (
        toolName: Parameters<CanUseTool>[0],
        toolInput: Parameters<CanUseTool>[1],
        callbackOptions: Parameters<CanUseTool>[2],
      ) {
        const context = yield* Ref.get(contextRef);
        if (!context) {
          return {
            behavior: "deny",
            message: "Claude session context is unavailable.",
          } satisfies PermissionResult;
        }

        // Handle AskUserQuestion: surface clarifying questions to the
        // user via the user-input runtime event channel, regardless of
        // runtime mode (plan mode relies on this heavily).
        if (toolName === "AskUserQuestion") {
          return yield* handleAskUserQuestion(context, toolInput, callbackOptions);
        }

        if (toolName === "ExitPlanMode") {
          const planMarkdown = extractExitPlanModePlan(toolInput);
          if (planMarkdown) {
            yield* emitProposedPlanCompleted(context, {
              planMarkdown,
              toolUseId: callbackOptions.toolUseID,
              rawSource: "claude.sdk.permission",
              rawMethod: "canUseTool/ExitPlanMode",
              rawPayload: {
                toolName,
                input: toolInput,
              },
            });
          }

          return {
            behavior: "deny",
            message:
              "The client captured your proposed plan. Stop here and wait for the user's feedback or implementation request in a later turn.",
          } satisfies PermissionResult;
        }

        const runtimeMode = input.runtimeMode ?? "full-access";
        if (runtimeMode === "full-access") {
          return {
            behavior: "allow",
            updatedInput: toolInput,
          } satisfies PermissionResult;
        }

        const requestId = ApprovalRequestId.make(yield* randomUUIDv4);
        const requestType = classifyRequestType(toolName);
        const detail = summarizeToolRequest(toolName, toolInput);
        const decisionDeferred = yield* Deferred.make<ProviderApprovalDecision>();
        const pendingApproval: PendingApproval = {
          requestType,
          detail,
          decision: decisionDeferred,
          ...(callbackOptions.suggestions ? { suggestions: callbackOptions.suggestions } : {}),
        };

        // A helper's call asks too, often after the turn that started it ended: it names its
        // helper as its calls do, so the person is asked on that helper's card.
        const parentToolUseId = context.subagentToolParents.get(callbackOptions.toolUseID);
        const agentId =
          helperOfCall(context.taskAgents, parentToolUseId) ?? callbackOptions.agentID;
        const requestedStamp = yield* makeEventStamp();
        yield* offerRuntimeEvent({
          type: "request.opened",
          eventId: requestedStamp.eventId,
          provider: PROVIDER,
          createdAt: requestedStamp.createdAt,
          threadId: context.session.threadId,
          ...(context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {}),
          requestId: asRuntimeRequestId(requestId),
          payload: {
            requestType,
            detail,
            ...(agentId ? { agentId } : {}),
            ...(parentToolUseId ? { parentToolUseId } : {}),
            args: {
              toolName,
              input: toolInput,
              ...(callbackOptions.toolUseID ? { toolUseId: callbackOptions.toolUseID } : {}),
            },
          },
          providerRefs: nativeProviderRefs(context, {
            providerItemId: callbackOptions.toolUseID,
          }),
          raw: {
            source: "claude.sdk.permission",
            method: "canUseTool/request",
            payload: {
              toolName,
              input: toolInput,
            },
          },
        });

        pendingApprovals.set(requestId, pendingApproval);

        const onAbort = () => {
          if (!pendingApprovals.has(requestId)) {
            return;
          }
          pendingApprovals.delete(requestId);
          runFork(Deferred.succeed(decisionDeferred, "cancel"));
        };

        callbackOptions.signal.addEventListener("abort", onAbort, {
          once: true,
        });
        // Same late-listener race as handleAskUserQuestion: the signal may
        // have aborted while the request event emissions were awaited.
        if (callbackOptions.signal.aborted) {
          onAbort();
        }

        const decision = yield* Deferred.await(decisionDeferred);
        pendingApprovals.delete(requestId);

        const resolvedStamp = yield* makeEventStamp();
        yield* offerRuntimeEvent({
          type: "request.resolved",
          eventId: resolvedStamp.eventId,
          provider: PROVIDER,
          createdAt: resolvedStamp.createdAt,
          threadId: context.session.threadId,
          ...(context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {}),
          requestId: asRuntimeRequestId(requestId),
          payload: {
            requestType,
            decision,
          },
          providerRefs: nativeProviderRefs(context, {
            providerItemId: callbackOptions.toolUseID,
          }),
          raw: {
            source: "claude.sdk.permission",
            method: "canUseTool/decision",
            payload: {
              decision,
            },
          },
        });

        if (decision === "accept" || decision === "acceptForSession") {
          return {
            behavior: "allow",
            updatedInput: toolInput,
            ...(decision === "acceptForSession"
              ? {
                  updatedPermissions: toSessionPermissionUpdates(
                    toolName,
                    pendingApproval.suggestions,
                  ),
                }
              : {}),
          } satisfies PermissionResult;
        }

        return {
          behavior: "deny",
          message:
            decision === "cancel"
              ? "User cancelled tool execution."
              : "User declined tool execution.",
        } satisfies PermissionResult;
      });

      const canUseTool: CanUseTool = (toolName, toolInput, callbackOptions) =>
        runPromise(canUseToolEffect(toolName, toolInput, callbackOptions));
      const onUserDialog: NonNullable<ClaudeQueryOptions["onUserDialog"]> = (
        request,
        callbackOptions,
      ) => runPromise(handleResumeDialog(request, callbackOptions));

      // A thread with a tool profile runs gated; every other thread gets
      // exactly the options below.
      const threadSetup = yield* resolveClaudeThreadSetup(threadRegistries, {
        threadId,
        instanceId: boundInstanceId,
        ...(input.cwd ? { cwd: input.cwd } : {}),
      });
      const claudeBinaryPath = claudeSdkExecutablePath;
      const {
        // claudeLaunchArgDirectories reads every --add-dir into additionalDirectories.
        "add-dir": _launchArgAddDir,
        "permission-mode": launchArgPermissionMode,
        "dangerously-skip-permissions": launchArgSkipPermissions,
        ...extraArgs
      } = parseCliArgs(claudeSettings.launchArgs).flags;
      const selectedModel = claudeProfileModelSelection(
        threadSetup?.profile,
        boundInstanceId,
        input.modelSelection?.instanceId === boundInstanceId ? input.modelSelection : undefined,
      );
      const modelSelection = selectedModel
        ? {
            ...selectedModel,
            model: resolveClaudeModelSlug(modelCatalog, selectedModel.model),
          }
        : undefined;
      const caps = getClaudeCatalogModelCapabilities(modelCatalog, modelSelection?.model);
      const descriptors = getProviderOptionDescriptors({ caps });
      const apiModelId = modelSelection
        ? resolveClaudeCatalogApiModelId(modelCatalog, modelSelection)
        : undefined;
      const initialContextWindow = selectedClaudeContextWindow(modelCatalog, modelSelection);
      const rawEffort = getModelSelectionStringOptionValue(modelSelection, "effort");
      const effort =
        resolveClaudeCatalogEffort(modelCatalog, modelSelection?.model, rawEffort) ?? null;
      const fastModeSupported = descriptors.some(
        (descriptor) => descriptor.type === "boolean" && descriptor.id === "fastMode",
      );
      const thinkingSupported = descriptors.some(
        (descriptor) => descriptor.type === "boolean" && descriptor.id === "thinking",
      );
      const fastMode =
        getModelSelectionBooleanOptionValue(modelSelection, "fastMode") === true &&
        fastModeSupported;
      const thinking = thinkingSupported
        ? getModelSelectionBooleanOptionValue(modelSelection, "thinking")
        : undefined;
      const thinkingDisplayArg = extraArgs["thinking-display"];
      const requestThinkingSummaries = shouldRequestClaudeThinkingSummaries({
        thinking,
        thinkingDisplay: typeof thinkingDisplayArg === "string" ? thinkingDisplayArg : undefined,
      });
      const ultracode = isClaudeCatalogUltracodeEffort(effort);
      const effectiveEffort = getEffectiveClaudeAgentEffort(
        modelCatalog,
        effort,
        modelSelection?.model,
      );
      const runtimeModeToPermission: Record<string, PermissionMode> = {
        "auto-accept-edits": "acceptEdits",
        auto: "auto",
        "full-access": "bypassPermissions",
      };
      // A permission launch arg is folded into the mode T3 sends rather than
      // passed through: the CLI resolves both inputs together, so argv order
      // never let the user's flag win.
      // A profiled thread's tool calls are decided by its PreToolUse hook
      // alone, so its mode wins over both.
      const permissionMode: PermissionMode | undefined = threadSetup
        ? "dontAsk"
        : ((launchArgPermissionMode as PermissionMode | null | undefined) ??
          (launchArgSkipPermissions === null || launchArgSkipPermissions === "true"
            ? "bypassPermissions"
            : runtimeModeToPermission[input.runtimeMode]));
      const settings = {
        ...(typeof thinking === "boolean" ? { alwaysThinkingEnabled: thinking } : {}),
        ...(requestThinkingSummaries ? { showThinkingSummaries: true } : {}),
        ...(fastMode ? { fastMode: true } : {}),
        ...(ultracode ? { ultracode: true } : {}),
        autoCompactWindow: claudeSettings.autoCompactWindow
          ? Number(claudeSettings.autoCompactWindow)
          : CLAUDE_DEFAULT_AUTO_COMPACT_WINDOW,
      };
      if (requestThinkingSummaries && extraArgs["thinking-display"] === undefined) {
        extraArgs["thinking-display"] = "summarized";
      }
      // The attachments dir grant lets the agent Read/copy pasted images at
      // the paths ProviderService injects into the turn text, without an
      // approval prompt. It is a leaf directory holding only attachment
      // files; siblings like secrets/ and state.sqlite stay ungranted.
      const additionalDirectories = [
        ...(input.cwd ? [input.cwd] : []),
        serverConfig.attachmentsDir,
        ...claudeLaunchArgDirectories(claudeSettings.launchArgs),
      ];
      const stderrTail = makeStderrTail();
      const startInstructions =
        threadSetup === undefined
          ? ((yield* currentInstructions(undefined)) ?? CLAUDE_INSTRUCTIONS)
          : CLAUDE_INSTRUCTIONS;
      const baseQueryOptions: ClaudeQueryOptions = {
        ...(input.cwd ? { cwd: input.cwd } : {}),
        // Kept for the log: why the stream died, when it dies.
        stderr: stderrTail.push,
        ...(apiModelId ? { model: apiModelId } : {}),
        pathToClaudeCodeExecutable: claudeBinaryPath,
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: startInstructions,
        },
        settingSources: [...CLAUDE_SETTING_SOURCES],
        // `ultracode` is a Claude Code setting, not an API effort level. It is
        // normalized to `xhigh` above and paired with `settings.ultracode`.
        ...(effectiveEffort
          ? {
              effort: effectiveEffort as unknown as NonNullable<ClaudeQueryOptions["effort"]>,
            }
          : {}),
        ...(extraArgs["thinking-display"] === "summarized"
          ? {
              thinking: {
                type: "adaptive" as const,
                display: "summarized" as const,
              },
            }
          : {}),
        ...(permissionMode ? { permissionMode } : {}),
        ...(permissionMode === "bypassPermissions"
          ? { allowDangerouslySkipPermissions: true }
          : {}),
        settings,
        ...(existingResumeSessionId ? { resume: existingResumeSessionId } : {}),
        ...(newSessionId ? { sessionId: newSessionId } : {}),
        includePartialMessages: true,
        canUseTool,
        onUserDialog,
        supportedDialogKinds: ["resume_return"],
        // Claude says when it is idle: only once every background result reached the model, which
        // the engine reads as nothing finished still waiting for a turn (`session_state_changed`).
        // The CLI waits for its MCP servers (its connect timeout, about 5 s) before reading the
        // first prompt. Started in the background, a resumed session's first prompt told the model
        // its tools were gone and then back, and it spent a round loading them again.
        env: {
          ...claudeEnvironment,
          CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: "1",
          MCP_CONNECTION_NONBLOCKING: "false",
          // The CLI offers its plan tools (TaskCreate…) only to older models unless this is set; the plan bubble reads them.
          CLAUDE_CODE_ENABLE_TODO_TOOLS: "true",
        },
        additionalDirectories,
        ...(Object.keys(extraArgs).length > 0 ? { extraArgs } : {}),
      };
      const queryOptions = threadSetup
        ? applyClaudeQueryOptionsPatch(
            baseQueryOptions,
            claudeQueryOptionsPatch(
              threadSetup.profile,
              threadSetup.extension,
              runPromise,
              existingResumeSessionId === undefined ? "startup" : "resume",
            ),
          )
        : baseQueryOptions;
      // What the session holds: a crewmate's profile appends its crew context.
      const appended = presetAppend(queryOptions.systemPrompt) ?? startInstructions;
      const freshMark = instructionsMark(appended);
      const heardMark =
        existingResumeSessionId === undefined ? freshMark : resumeState?.instructions;
      const startMark =
        existingResumeSessionId === undefined ? freshMark : resumeState?.startInstructions;

      yield* Effect.annotateCurrentSpan({
        "provider.kind": PROVIDER,
        "provider.thread_id": threadId,
        "provider.runtime_mode": input.runtimeMode,
        "claude.resume.source":
          existingResumeSessionId !== undefined ? "resume-session" : "generated-session",
        "claude.resume.thread_id": resumeState?.threadId ?? "",
        "claude.resume.session_id": existingResumeSessionId ?? "",
        "claude.resume.session_at": resumeState?.resumeSessionAt ?? "",
        "claude.resume.turn_count": resumeState?.turnCount ?? -1,
        "claude.query.cwd": input.cwd ?? "",
        "claude.query.model": apiModelId ?? "",
        "claude.query.effort": effectiveEffort ?? "",
        "claude.query.permission_mode": permissionMode ?? "",
        "claude.query.allow_dangerously_skip_permissions": permissionMode === "bypassPermissions",
        "claude.query.resume": existingResumeSessionId ?? "",
        "claude.query.session_id": newSessionId ?? "",
        "claude.query.include_partial_messages": true,
        "claude.query.additional_directories": additionalDirectories,
        "claude.query.setting_sources": [...CLAUDE_SETTING_SOURCES],
        "claude.query.settings_json": encodeJsonStringForDiagnostics(settings) ?? "",
        "claude.query.extra_args_json": encodeJsonStringForDiagnostics(extraArgs) ?? "",
        "claude.query.path_to_executable": claudeBinaryPath,
      });

      // From the spawn until this start returns, the CLI is the start's alone: one that ends
      // early - a Stop interrupting it - closes the CLI instead of leaving it running unread.
      let spawned: ClaudeQueryRuntime | undefined;
      let registered: ClaudeSessionContext | undefined;
      return yield* Effect.gen(function* () {
        const queryRuntime = yield* Effect.try({
          // Kept in the same step as the spawn: an interrupt is seen before the next one.
          try: () =>
            (spawned = createQuery({
              prompt,
              options: queryOptions,
            })),
          catch: (cause) =>
            new ProviderAdapterProcessError({
              provider: PROVIDER,
              threadId,
              detail: "Failed to start Claude runtime session.",
              cause,
            }),
        });

        // Read restored usage before any input. If unavailable, the first result sets the baseline.
        const usageBaseline = yield* Effect.tryPromise(() =>
          queryRuntime.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({
            skipBehaviors: true,
          }),
        ).pipe(
          Effect.catch((error) =>
            Effect.logWarning("claude.usage.baseline-unavailable", {
              threadId,
              cause: error.cause,
            }),
          ),
        );

        const session: ProviderSession = {
          threadId,
          provider: PROVIDER,
          providerInstanceId: boundInstanceId,
          status: "ready",
          runtimeMode: input.runtimeMode,
          ...(input.cwd ? { cwd: input.cwd } : {}),
          ...(modelSelection?.model ? { model: modelSelection.model } : {}),
          ...(threadId ? { threadId } : {}),
          resumeCursor: {
            ...(threadId ? { threadId } : {}),
            ...(existingResumeSessionId ? { resume: existingResumeSessionId } : {}),
            ...(resumeState?.resumeSessionAt
              ? { resumeSessionAt: resumeState.resumeSessionAt }
              : {}),
            turnCount: resumeState?.turnCount ?? 0,
            ...(resumeState?.turnStartMessageIds
              ? { turnStartMessageIds: resumeState.turnStartMessageIds }
              : {}),
            ...(heardMark ? { instructions: heardMark } : {}),
            ...(startMark ? { startInstructions: startMark } : {}),
          },
          createdAt: startedAt,
          updatedAt: startedAt,
        };

        const context: ClaudeSessionContext = {
          turnUsage: makeClaudeTurnUsage(usageBaseline),
          session,
          stderrTail,
          startInput: input,
          turnStartMessageIds: resumeState?.turnStartMessageIds
            ? [...resumeState.turnStartMessageIds]
            : Array.from({ length: resumeState?.turnCount ?? 0 }, () => null),
          promptQueue,
          query: queryRuntime,
          streamFiber: undefined,
          startedAt,
          basePermissionMode: permissionMode,
          profiled: threadSetup !== undefined,
          currentApiModelId: apiModelId,
          currentEffort: effectiveEffort ?? undefined,
          resumeSessionId: existingResumeSessionId,
          instructions: heardMark,
          startInstructions: startMark,
          crewInstructions: threadSetup === undefined ? undefined : appended,
          pendingApprovals,
          pendingUserInputs,
          turns: [],
          inFlightTools,
          claudeTasks,
          taskAgents,
          pendingTaskModels,
          subagentToolParents,
          workflowMemberFingerprints,
          liveTaskIds,
          turnState: undefined,
          selectedContextWindow: initialContextWindow,
          autoCompactWindow:
            typeof queryOptions.settings === "object"
              ? queryOptions.settings.autoCompactWindow
              : undefined,
          lastKnownContextWindow: initialContextWindow,
          lastKnownTokenUsage: undefined,
          lastKnownTotalProcessedTokens: undefined,
          lastAssistantUuid: resumeState?.resumeSessionAt,
          lastThreadStartedId: undefined,
          announcedUsageLimits: undefined,
          interruptedTurnSettled: undefined,
          startFailure: undefined,
          endWords: undefined,
          stopped: false,
        };
        yield* Ref.set(contextRef, context);
        sessions.set(threadId, context);
        registered = context;

        const sessionStartedStamp = yield* makeEventStamp();
        yield* offerRuntimeEvent({
          type: "session.started",
          eventId: sessionStartedStamp.eventId,
          provider: PROVIDER,
          createdAt: sessionStartedStamp.createdAt,
          threadId,
          payload: input.resumeCursor !== undefined ? { resume: input.resumeCursor } : {},
          providerRefs: {},
        });

        const configuredStamp = yield* makeEventStamp();
        yield* offerRuntimeEvent({
          type: "session.configured",
          eventId: configuredStamp.eventId,
          provider: PROVIDER,
          createdAt: configuredStamp.createdAt,
          threadId,
          payload: {
            config: {
              ...(apiModelId ? { model: apiModelId } : {}),
              ...(input.cwd ? { cwd: input.cwd } : {}),
              ...(effectiveEffort ? { effort: effectiveEffort } : {}),
              ...(permissionMode ? { permissionMode } : {}),
              ...(fastMode ? { fastMode: true } : {}),
            },
          },
          providerRefs: {},
        });

        const readyStamp = yield* makeEventStamp();
        yield* offerRuntimeEvent({
          type: "session.state.changed",
          eventId: readyStamp.eventId,
          provider: PROVIDER,
          createdAt: readyStamp.createdAt,
          threadId,
          payload: {
            state: "ready",
          },
          providerRefs: {},
        });

        let streamFiber: Fiber.Fiber<void, never>;
        streamFiber = runFork(
          Effect.exit(runSdkStream(context)).pipe(
            Effect.flatMap((exit) => {
              if (context.stopped) {
                return Effect.void;
              }
              if (context.streamFiber === streamFiber) {
                context.streamFiber = undefined;
              }
              return handleStreamExit(context, exit).pipe(
                Effect.catch((cause) =>
                  Effect.logError("Failed to close Claude runtime stream.", { cause }),
                ),
              );
            }),
          ),
        );
        context.streamFiber = streamFiber;
        streamFiber.addObserver(() => {
          if (context.streamFiber === streamFiber) {
            context.streamFiber = undefined;
          }
        });

        return {
          ...session,
        };
      }).pipe(
        Effect.onInterrupt(() =>
          registered !== undefined
            ? stopSessionInternal(registered).pipe(Effect.ignore)
            : Effect.sync(() => spawned?.close()).pipe(Effect.ignore),
        ),
      );
    },
  );

  const sendTurn: ClaudeAdapterShape["sendTurn"] = Effect.fn("sendTurn")(function* (input) {
    const context = yield* requireSession(input.threadId);
    if (context.startFailure !== undefined) {
      context.endWords = context.startFailure;
      yield* stopSessionInternal(context);
      return yield* new ProviderAdapterSessionClosedError({
        provider: PROVIDER,
        threadId: input.threadId,
        detail: context.startFailure,
      });
    }
    // What the CLI wrote before this turn is no cause of how this one ends.
    context.stderrTail.reset();
    const modelCatalog = yield* modelCatalogEffect;
    const selectedModel = yield* claudeTurnModelSelection(
      threadRegistries,
      {
        threadId: input.threadId,
        instanceId: boundInstanceId,
        ...(context.session.cwd ? { cwd: context.session.cwd } : {}),
      },
      input.modelSelection !== undefined && input.modelSelection.instanceId === boundInstanceId
        ? input.modelSelection
        : undefined,
    );
    const modelSelection = selectedModel
      ? { ...selectedModel, model: resolveClaudeModelSlug(modelCatalog, selectedModel.model) }
      : undefined;
    const previousRawEffort = getModelSelectionStringOptionValue(
      context.startInput.modelSelection,
      "effort",
    );
    if (modelSelection) {
      context.startInput = { ...context.startInput, modelSelection };
    }

    // A sendTurn while a real turn is running is a steer: the message is
    // queued into the live SDK agent loop and the work continues as the same
    // turn — no synthetic turn boundary. Stale synthetic turns (from
    // background agent responses between user prompts) are auto-closed
    // instead, so they don't block the user's next turn.
    const steeringTurnState =
      context.turnState && context.turnState.synthetic !== true ? context.turnState : null;
    if (context.turnState && steeringTurnState === null) {
      yield* completeTurn(context, "completed");
    }

    if (modelSelection?.model) {
      const apiModelId = resolveClaudeCatalogApiModelId(modelCatalog, modelSelection);
      if (context.currentApiModelId !== apiModelId) {
        yield* Effect.tryPromise({
          try: () => context.query.setModel(apiModelId),
          catch: (cause) => toRequestError(input.threadId, "turn/setModel", cause),
        });
        context.currentApiModelId = apiModelId;
      }
      context.session = {
        ...context.session,
        model: modelSelection.model,
      };
      // A different model is a different window, and the person is shown that
      // number before the next turn reports anything.
      const changedContextWindow = selectedClaudeContextWindow(modelCatalog, modelSelection);
      context.selectedContextWindow = changedContextWindow;
      if (changedContextWindow !== undefined) {
        context.lastKnownContextWindow = changedContextWindow;
      }
      const turnEffort = resolveClaudeCatalogEffort(
        modelCatalog,
        modelSelection.model,
        getModelSelectionStringOptionValue(modelSelection, "effort"),
      );
      const nextEffort =
        getEffectiveClaudeAgentEffort(modelCatalog, turnEffort ?? null, modelSelection.model) ??
        undefined;
      const ultracode = isClaudeCatalogUltracodeEffort(turnEffort ?? null);
      const ultracodeChanged =
        ultracode !==
        isClaudeCatalogUltracodeEffort(
          resolveClaudeCatalogEffort(modelCatalog, modelSelection.model, previousRawEffort) ?? null,
        );
      // Effort is a flag setting: the live session takes it on its next
      // request, so a change never needs a new session. A CLI that refuses it
      // never costs the message: the effort is tried again on the next send.
      if (nextEffort !== context.currentEffort || ultracodeChanged) {
        const settings = {
          effortLevel: (nextEffort ?? null) as ClaudeSdkEffort | null,
          ...(ultracodeChanged ? { ultracode: ultracode ? true : null } : {}),
        };
        const applied = yield* Effect.tryPromise(() =>
          context.query.applyFlagSettings(settings),
        ).pipe(
          Effect.as(true),
          Effect.catch((cause) =>
            Effect.logWarning("claude.effort.apply-failed", {
              threadId: input.threadId,
              effort: nextEffort ?? null,
              cause: toMessage(cause, "applyFlagSettings failed"),
            }).pipe(Effect.as(false)),
          ),
        );
        if (applied) context.currentEffort = nextEffort;
      }
    }

    // Apply interaction mode by switching the SDK's permission mode.
    // "plan" maps directly to the SDK's "plan" permission mode;
    // "default" restores the session's original permission mode.
    // When interactionMode is absent we leave the current mode unchanged.
    if (input.interactionMode === "plan") {
      yield* Effect.tryPromise({
        try: () => context.query.setPermissionMode("plan"),
        catch: (cause) => toRequestError(input.threadId, "turn/setPermissionMode", cause),
      });
    } else if (input.interactionMode === "default") {
      yield* Effect.tryPromise({
        try: () => context.query.setPermissionMode(context.basePermissionMode ?? "default"),
        catch: (cause) => toRequestError(input.threadId, "turn/setPermissionMode", cause),
      });
    }

    // The message is built before its turn opens: an attachment that cannot
    // be read fails the send before any turn starts, never leaving one open.
    // Re-scan on every send: skills are added and switched off mid-session,
    // and the scan is a few directory reads. A skill switched off via
    // skillOverrides, or reserved for the agent with `user-invocable: false`,
    // is left as prose: the CLI would answer `/name` with a notice instead of
    // running it.
    const skills = yield* discoverClaudeSkills(
      claudeSettings,
      context.session.cwd,
      claudeEnvironment,
    ).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
    );
    // Instructions changed since the session last heard them (a persona switched, a resume or a
    // compaction): its next message leads with the current ones.
    const instructions = yield* currentInstructions(context.crewInstructions);
    const heard = instructions === undefined ? undefined : instructionsMark(instructions);
    const preface =
      instructions === undefined || context.instructions === heard
        ? undefined
        : instructionsRefresh(instructions);
    const message = yield* buildUserMessageEffect(input, {
      preface,
      fileSystem,
      attachmentsDir: serverConfig.attachmentsDir,
      boundInstanceId,
      modelCatalog,
      skills: new Map(
        skills
          .filter((skill) => skill.enabled && skill.userInvocable !== false)
          .map((skill) => [skill.name, skill]),
      ),
    });

    // Its stream may have ended while the message was built: the prompt
    // queue is shut, and a turn opened now would never end. The message never
    // reached Claude: the caller resends it on a new session.
    if (context.stopped) {
      return yield* new ProviderAdapterSessionClosedError({
        provider: PROVIDER,
        threadId: input.threadId,
        detail: context.endWords,
      });
    }

    const turnId = steeringTurnState?.turnId ?? TurnId.make(yield* randomUUIDv4);
    if (steeringTurnState === null) {
      const turnState: ClaudeTurnState = {
        turnId,
        startedAt: yield* nowIso,
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

      const updatedAt = yield* nowIso;
      context.turnState = turnState;
      context.session = {
        ...context.session,
        status: "running",
        activeTurnId: turnId,
        updatedAt,
      };

      const turnStartedStamp = yield* makeEventStamp();
      yield* offerRuntimeEvent({
        type: "turn.started",
        eventId: turnStartedStamp.eventId,
        provider: PROVIDER,
        createdAt: turnStartedStamp.createdAt,
        threadId: context.session.threadId,
        turnId,
        payload: modelSelection?.model ? { model: modelSelection.model } : {},
        providerRefs: {},
      });
    }

    if (steeringTurnState === null) context.turnStartMessageIds.push(turnId);
    rememberTurnPictures(context.turnState, input);
    yield* updateResumeCursor(context);
    const offered = yield* Queue.offer(context.promptQueue, {
      type: "message",
      message:
        steeringTurnState === null
          ? { ...message, uuid: turnId as NonNullable<SDKUserMessage["uuid"]> }
          : message,
    }).pipe(Effect.mapError((cause) => toRequestError(input.threadId, "turn/start", cause)));
    // A shut queue takes nothing: the message never reached Claude.
    if (!offered) {
      return yield* new ProviderAdapterSessionClosedError({
        provider: PROVIDER,
        threadId: input.threadId,
        detail: context.endWords,
      });
    }
    if (preface !== undefined) {
      context.instructions = heard;
      yield* updateResumeCursor(context);
    }

    return {
      threadId: context.session.threadId,
      turnId,
      ...(context.session.resumeCursor !== undefined
        ? { resumeCursor: context.session.resumeCursor }
        : {}),
    };
  });

  const interruptTurn: ClaudeAdapterShape["interruptTurn"] = Effect.fn("interruptTurn")(
    function* (threadId, _turnId) {
      const context = yield* requireSession(threadId);
      yield* settleInterruptedTurn(context);
      // interrupt() can acknowledge while resumed background tasks keep the
      // CLI alive. Stop is a hard session boundary for Claude, so close the
      // query and let the SDK escalate to SIGKILL when graceful exit fails.
      yield* stopSessionInternal(context);
    },
  );

  // Lets Claude abort the running turn through its own path before Stop kills
  // the process, so the prompt reaches the transcript. Killing a first turn
  // before Claude writes it leaves a resume cursor for a session Claude never
  // saved, and every later message fails with "No conversation found".
  const settleInterruptedTurn = Effect.fn("settleInterruptedTurn")(function* (
    context: ClaudeSessionContext,
  ) {
    const interrupt = context.query.interrupt?.bind(context.query);
    if (context.stopped || !context.turnState || !interrupt) return;
    const settled = yield* Deferred.make<void>();
    context.interruptedTurnSettled = settled;
    yield* Effect.tryPromise(interrupt).pipe(
      Effect.ignore,
      Effect.andThen(Deferred.await(settled)),
      Effect.timeoutOption(CLAUDE_INTERRUPT_GRACE),
    );
    context.interruptedTurnSettled = undefined;
  });

  const readThread: ClaudeAdapterShape["readThread"] = Effect.fn("readThread")(
    function* (threadId) {
      const context = yield* requireSession(threadId);
      return yield* snapshotThread(context);
    },
  );

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

  const respondToRequest: ClaudeAdapterShape["respondToRequest"] = Effect.fn("respondToRequest")(
    function* (threadId, requestId, decision) {
      const context = yield* requireSession(threadId);
      const pending = context.pendingApprovals.get(requestId);
      if (!pending) {
        return yield* new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "item/requestApproval/decision",
          detail: `Unknown pending approval request: ${requestId}`,
        });
      }

      context.pendingApprovals.delete(requestId);
      yield* Deferred.succeed(pending.decision, decision);
    },
  );

  const respondToUserInput: ClaudeAdapterShape["respondToUserInput"] = Effect.fn(
    "respondToUserInput",
  )(function* (threadId, requestId, answers) {
    const context = yield* requireSession(threadId);
    const pending = context.pendingUserInputs.get(requestId);
    if (!pending) {
      return yield* new ProviderAdapterRequestError({
        provider: PROVIDER,
        method: "item/tool/respondToUserInput",
        detail: `Unknown pending user-input request: ${requestId}`,
      });
    }

    context.pendingUserInputs.delete(requestId);
    yield* Deferred.succeed(pending.answers, answers);
  });

  const stopSession: ClaudeAdapterShape["stopSession"] = Effect.fn("stopSession")(
    function* (threadId) {
      const context = yield* requireSession(threadId);
      yield* stopSessionInternal(context, {
        emitExitEvent: true,
      });
    },
  );

  const listSessions: ClaudeAdapterShape["listSessions"] = () =>
    Effect.sync(() => Array.from(sessions.values(), ({ session }) => ({ ...session })));

  const hasSession: ClaudeAdapterShape["hasSession"] = (threadId) =>
    Effect.sync(() => {
      const context = sessions.get(threadId);
      return context !== undefined && !context.stopped;
    });

  const stopSessions = Effect.fn("stopSessions")(function* (
    contexts: ReadonlyArray<ClaudeSessionContext>,
    emitExitEvent: boolean,
  ) {
    const results = yield* Effect.forEach(contexts, (context) =>
      stopSessionInternal(context, { emitExitEvent }).pipe(Effect.result),
    );

    for (const result of results) {
      if (result._tag === "Failure") {
        return yield* result.failure;
      }
    }
  });

  const stopAll: ClaudeAdapterShape["stopAll"] = () =>
    stopSessions(Array.from(sessions.values()), true);

  yield* Effect.addFinalizer(() =>
    stopSessions(Array.from(sessions.values()), false).pipe(
      Effect.catch((cause) =>
        Effect.logError("Failed to emit Claude session shutdown event.", { cause }),
      ),
      Effect.tap(() => Queue.shutdown(runtimeEventQueue)),
      Effect.tap(() => managedNativeEventLogger?.close() ?? Effect.void),
    ),
  );

  return {
    provider: PROVIDER,
    capabilities: {
      sessionModelSwitch: "in-session",
      inSessionModelOptions: ["effort"],
      closedSendUndelivered: true,
      threadProfile: { tools: true, reportsSpend: true },
    },
    compaction: { type: "slash-command", command: "/compact" },
    startSession,
    sendTurn,
    interruptTurn,
    readThread,
    rollbackThread,
    respondToRequest,
    respondToUserInput,
    stopSession,
    listSessions,
    hasSession,
    stopAll,
    mcp: claudeMcpControl({
      get: (threadId) => {
        const context = sessions.get(threadId);
        return context === undefined || context.stopped ? undefined : claudeMcpSession(context);
      },
      all: () => [...sessions.values()].filter((context) => !context.stopped).map(claudeMcpSession),
    }),
    get streamEvents() {
      return Stream.fromQueue(runtimeEventQueue);
    },
  } satisfies ClaudeAdapterShape;
});
