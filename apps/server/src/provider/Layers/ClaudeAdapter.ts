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
  type SDKMessage,
  type SettingSource,
  type SDKUserMessage,
  type Query as ClaudeSdkQuery,
} from "@anthropic-ai/claude-agent-sdk";
import { parseCliArgs } from "@t3tools/shared/cliArgs";
import {
  type ClaudeScopedLimitNames,
  claudeRateLimitEventToUpdate,
  claudeUsageLimitBlock,
  describeClaudeUsageLimit,
} from "./claudeUsageLimits.ts";
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
  RuntimeTaskId,
  type TaskRunHandles,
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
import * as Exit from "effect/Exit";
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
import { claudeSignedOutMessage, makeClaudeEnvironment } from "../Drivers/ClaudeHome.ts";
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
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
  type ProviderAdapterError,
} from "../Errors.ts";
import { describeClaudeStreamFailure, makeStderrTail } from "../claudeStreamFailure.ts";
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
  asRuntimeItemId,
  asCanonicalTurnId,
  asRuntimeRequestId,
  nativeProviderRefs,
} from "../claude/ClaudeSessionState.ts";
import {
  encodeJsonStringForDiagnostics,
  toolResultBlocksFromUserMessage,
  toolNonExecutionKind,
  sdkMessageType,
  sdkNativeMethod,
  describeUnknownSdkMessage,
} from "../claude/ClaudeSdkMessages.ts";
import {
  classifyRequestType,
  summarizeToolRequest,
  extractExitPlanModePlan,
  toolResultStreamKind,
} from "../claude/ClaudeToolItems.ts";
import {
  rememberPendingTaskEntry,
  readClaudeToolUseResult,
  applyClaudeTaskToolResult,
  sanitizeSessionUrl,
  trimmedString,
  normalizeTaskUsage,
  CLAUDE_TASK_PATCH_STATUS,
  agentIdForParentToolUse,
  helperOfCall,
  adoptHelperLaunch,
  taskLinkageFor,
  parseWorkflowProgress,
  workflowAgentStatus,
} from "../claude/ClaudeTasks.ts";
import {
  selectedClaudeContextWindow,
  finiteNonNegativeInteger,
  normalizeClaudeActiveTokenUsage,
  compactBoundaryTokenUsageSnapshot,
  normalizeClaudeTaskProgressTokenUsage,
} from "../claude/ClaudeTokenUsage.ts";
import {
  STREAM_FAILED_DETAIL,
  isClaudeInterruptedCause,
  toMessage,
  toRequestError,
} from "../claude/ClaudeFailures.ts";
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
  const { snapshotThread, updateResumeCursor, ensureThreadId } = resumeCursor;
  const runtimeEmit = makeClaudeRuntimeEmit(kit, nativeEventLogger);
  const {
    logNativeSdkMessage,
    emitRuntimeError,
    emitRuntimeWarning,
    emitThreadTokenUsage,
    emitProposedPlanCompleted,
    emitClaudeTaskPlanUpdated,
  } = runtimeEmit;
  const assistantText = makeClaudeAssistantText(kit);
  const { backfillAssistantTextBlocksFromSnapshot, backfillThinkingFromSnapshot } = assistantText;
  const toolCalls = makeClaudeToolCalls(kit);
  const { closeUnreturnedCall, closeHelperCalls, presentCalls, startHelperCalls } = toolCalls;
  const turns = makeClaudeTurns(kit, { resumeCursor, runtimeEmit, assistantText, toolCalls });
  const { completeTurn, startSyntheticTurn, handleResultMessage } = turns;
  const streamEvents = makeClaudeStreamEvents(kit, { runtimeEmit, assistantText, turns });
  const { handleStreamEvent } = streamEvents;

  const handleUserMessage = Effect.fn("handleUserMessage")(function* (
    context: ClaudeSessionContext,
    message: SDKMessage,
  ) {
    if (message.type !== "user") {
      return;
    }

    for (const toolResult of toolResultBlocksFromUserMessage(message)) {
      const toolEntry = Array.from(context.inFlightTools.entries()).find(
        ([, tool]) => tool.itemId === toolResult.toolUseId,
      );
      if (!toolEntry) {
        continue;
      }

      const [index, tool] = toolEntry;
      const cancelled = toolNonExecutionKind(message, toolResult.toolUseId) === "cancelled";
      const itemStatus = cancelled ? "stopped" : toolResult.isError ? "failed" : "completed";
      const toolUseResult = readClaudeToolUseResult(message);
      const toolData = {
        toolName: tool.toolName,
        input: tool.input,
        result: toolResult.block,
      };

      // A helper's call has its result in its completion: no update row of its own.
      if (!tool.agentId) {
        const updatedStamp = yield* makeEventStamp();
        yield* offerRuntimeEvent({
          type: "item.updated",
          eventId: updatedStamp.eventId,
          provider: PROVIDER,
          createdAt: updatedStamp.createdAt,
          threadId: context.session.threadId,
          ...(context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {}),
          itemId: asRuntimeItemId(tool.itemId),
          payload: {
            itemType: tool.itemType,
            status: cancelled ? "stopped" : toolResult.isError ? "failed" : "inProgress",
            title: tool.title,
            ...(tool.detail ? { detail: tool.detail } : {}),
            ...(tool.parentToolUseId ? { parentToolUseId: tool.parentToolUseId } : {}),
            data: toolData,
            ...(tool.presentation ? { presentation: tool.presentation } : {}),
          },
          providerRefs: nativeProviderRefs(context, {
            providerItemId: tool.itemId,
          }),
          raw: {
            source: "claude.sdk.message",
            method: "claude/user",
            payload: message,
          },
        });
      }

      const streamKind = toolResultStreamKind(tool.itemType);
      if (streamKind && toolResult.text.length > 0 && context.turnState) {
        const deltaStamp = yield* makeEventStamp();
        yield* offerRuntimeEvent({
          type: "content.delta",
          eventId: deltaStamp.eventId,
          provider: PROVIDER,
          createdAt: deltaStamp.createdAt,
          threadId: context.session.threadId,
          turnId: context.turnState.turnId,
          itemId: asRuntimeItemId(tool.itemId),
          payload: {
            streamKind,
            delta: toolResult.text,
          },
          providerRefs: nativeProviderRefs(context, {
            providerItemId: tool.itemId,
          }),
          raw: {
            source: "claude.sdk.message",
            method: "claude/user",
            payload: message,
          },
        });
      }

      const completedStamp = yield* makeEventStamp();
      yield* offerRuntimeEvent({
        type: "item.completed",
        eventId: completedStamp.eventId,
        provider: PROVIDER,
        createdAt: completedStamp.createdAt,
        threadId: context.session.threadId,
        ...(context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {}),
        itemId: asRuntimeItemId(tool.itemId),
        payload: {
          itemType: tool.itemType,
          status: itemStatus,
          title: tool.title,
          ...(tool.detail ? { detail: tool.detail } : {}),
          ...(tool.agentId ? { agentId: tool.agentId } : {}),
          ...(tool.parentToolUseId ? { parentToolUseId: tool.parentToolUseId } : {}),
          data: toolData,
          ...(tool.presentation ? { presentation: tool.presentation } : {}),
        },
        providerRefs: nativeProviderRefs(context, {
          providerItemId: tool.itemId,
        }),
        raw: {
          source: "claude.sdk.message",
          method: "claude/user",
          payload: message,
        },
      });

      // The Workflow tool's result carries the run handles (runId, scriptPath,
      // transcriptDir, sessionUrl). Attach them to the workflow's task agent so
      // the next task.* payload advertises them to clients.
      if (!toolResult.isError && tool.toolName.toLowerCase() === "workflow" && toolUseResult) {
        const workflowTaskId = trimmedString(toolUseResult.taskId);
        if (workflowTaskId) {
          const runHandles: TaskRunHandles = {
            ...(trimmedString(toolUseResult.runId)
              ? { runId: trimmedString(toolUseResult.runId) }
              : {}),
            ...(trimmedString(toolUseResult.scriptPath)
              ? { scriptPath: trimmedString(toolUseResult.scriptPath) }
              : {}),
            ...(trimmedString(toolUseResult.transcriptDir)
              ? { transcriptDir: trimmedString(toolUseResult.transcriptDir) }
              : {}),
            ...(sanitizeSessionUrl(toolUseResult.sessionUrl)
              ? { sessionUrl: sanitizeSessionUrl(toolUseResult.sessionUrl) }
              : {}),
          };
          const existing = context.taskAgents.get(workflowTaskId);
          context.taskAgents.set(workflowTaskId, {
            taskId: workflowTaskId,
            toolUseId: existing?.toolUseId ?? tool.itemId,
            launches: existing?.launches ?? [tool.itemId],
            description: existing?.description,
            subagentType: existing?.subagentType,
            taskType: existing?.taskType ?? "local_workflow",
            workflowName: existing?.workflowName,
            skipTranscript: existing?.skipTranscript ?? false,
            runHandles,
            owningAgentId: existing?.owningAgentId,
            model: existing?.model,
            effort: existing?.effort,
          });
        }
      }

      // A helper's task list is its own (2.1.278 gives helpers no task tools):
      // never the Mate's plan.
      if (
        !toolResult.isError &&
        tool.agentId === undefined &&
        applyClaudeTaskToolResult(context.claudeTasks, tool, toolUseResult)
      ) {
        yield* emitClaudeTaskPlanUpdated(context, {
          toolUseId: tool.itemId,
          rawMethod: "claude/user",
          rawPayload: message,
        });
      }

      context.inFlightTools.delete(index);
    }
  });

  const handleAssistantMessage = Effect.fn("handleAssistantMessage")(function* (
    context: ClaudeSessionContext,
    message: SDKMessage,
  ) {
    if (message.type !== "assistant") {
      return;
    }

    // Subagent-owned assistant snapshots (parent_tool_use_id set) are the
    // subagent's own conversation, not the parent's. Emitting them created
    // interleaved "Agent N done"-adjacent leak messages and spawned synthetic
    // turns per subagent completion (which also reset the Working timer).
    const assistantParentToolUseId = (message as { parent_tool_use_id?: string | null })
      .parent_tool_use_id;
    if (assistantParentToolUseId !== null && assistantParentToolUseId !== undefined) {
      // The snapshot's message.model is the authoritative API model the
      // subagent actually ran on — refine the seeded launch-time value.
      const owningTaskId = agentIdForParentToolUse(context.taskAgents, assistantParentToolUseId);
      const snapshotModel = trimmedString(message.message.model);
      const owningAgent = owningTaskId ? context.taskAgents.get(owningTaskId) : undefined;
      const snapshotContent = Array.isArray(message.message.content) ? message.message.content : [];
      for (const block of snapshotContent) {
        if (block.type === "tool_use") {
          rememberPendingTaskEntry(context.subagentToolParents, block.id, assistantParentToolUseId);
        }
      }
      if (snapshotModel && owningAgent) {
        if (owningAgent.model !== snapshotModel) {
          owningAgent.model = snapshotModel;
          // Push the correction now. The next task row can be minutes away
          // when the subagent blocks on a long foreground tool.
          const stamp = yield* makeEventStamp();
          yield* offerRuntimeEvent({
            type: "task.updated",
            eventId: stamp.eventId,
            provider: PROVIDER,
            createdAt: stamp.createdAt,
            threadId: context.session.threadId,
            ...(context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {}),
            payload: {
              taskId: RuntimeTaskId.make(owningAgent.taskId),
              ...taskLinkageFor(context.taskAgents, owningAgent.taskId),
            },
            providerRefs: nativeProviderRefs(context),
            raw: {
              source: "claude.sdk.message",
              method: "claude/assistant",
              payload: message,
            },
          });
        }
      } else if (snapshotModel) {
        // The snapshot beat its task_started (or its tool_use_id was never
        // recorded): hold the model until the task registers.
        rememberPendingTaskEntry(
          context.pendingTaskModels,
          assistantParentToolUseId,
          snapshotModel,
        );
      }
      yield* startHelperCalls(context, message, assistantParentToolUseId);
      context.lastAssistantUuid = message.uuid;
      yield* updateResumeCursor(context);
      return;
    }

    // Auto-start a synthetic turn for assistant messages that arrive without
    // an active turn (e.g., background agent/subagent responses between user prompts).
    if (!context.turnState) {
      // Claude Code wakes itself to hand the model a background result; against
      // a closed usage window the wake fails at once with this synthetic reply.
      // The result stays in Claude's conversation, so no turn opens: the thread
      // is held in one pause until the reset (orchestration/usagePause.ts).
      if (
        message.error === "rate_limit" &&
        (context.usageLimitBlockedUntilMs ?? 0) > DateTime.toEpochMillis(yield* DateTime.now)
      ) {
        context.heldLimitWake = true;
        context.lastAssistantUuid = message.uuid;
        yield* updateResumeCursor(context);
        return;
      }
      yield* startSyntheticTurn(context, message.uuid);
    } else if (context.turnState.startMessagePending === true) {
      // A turn its stream opened: its first assistant message names where it began.
      context.turnState.startMessagePending = false;
      context.turnStartMessageIds.push(message.uuid);
      yield* updateResumeCursor(context);
    }

    yield* presentCalls(context, message);
    const content = message.message?.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (!block || typeof block !== "object") {
          continue;
        }
        const toolUse = block as {
          type?: unknown;
          id?: unknown;
          name?: unknown;
          input?: unknown;
        };
        if (toolUse.type !== "tool_use" || toolUse.name !== "ExitPlanMode") {
          continue;
        }
        const planMarkdown = extractExitPlanModePlan(toolUse.input);
        if (!planMarkdown) {
          continue;
        }
        yield* emitProposedPlanCompleted(context, {
          planMarkdown,
          toolUseId: typeof toolUse.id === "string" ? toolUse.id : undefined,
          rawSource: "claude.sdk.message",
          rawMethod: "claude/assistant",
          rawPayload: message,
        });
      }
    }

    if (context.turnState) {
      // Limited retries may only carry an assistant error, without a new window
      // event. Later parent responses replace this evidence if the turn recovers.
      context.turnState.latestAssistantRateLimited = message.error === "rate_limit";
      // The CLI can report authentication failure before ending the turn as a
      // generic API error, so retain that evidence for the result fallback.
      if (message.error === "authentication_failed") {
        context.turnState.authenticationFailureMessage = claudeSignedOutMessage({
          configDir: claudeEnvironment.CLAUDE_CONFIG_DIR,
          cwd: path.resolve(context.session.cwd ?? "."),
        });
      }
      if (
        normalizeClaudeActiveTokenUsage(
          message.message.usage,
          context.lastKnownContextWindow,
          context.lastKnownTotalProcessedTokens,
        )
      ) {
        context.turnState.latestAssistantUsage = message.message.usage;
        context.turnState.compactedSinceLatestAssistantUsage = false;
      }
      yield* backfillThinkingFromSnapshot(context, message);
      yield* backfillAssistantTextBlocksFromSnapshot(context, message);
    }

    context.lastAssistantUuid = message.uuid;
    yield* updateResumeCursor(context);
  });

  /**
   * Synthesizes per-member task.progress rows from the coordinator's
   * workflow_progress array. Member identity is the stable slot
   * `<coordinatorTaskId>:wf:<index>` (never the per-attempt agent id, which
   * changes on retry and would split one member into duplicate rows).
   * timelineBypass keeps these out of the parent chat; the Agents surface and
   * workflow card consume them.
   */
  const emitWorkflowMemberProgress = Effect.fn("emitWorkflowMemberProgress")(function* (
    context: ClaudeSessionContext,
    base: Omit<ProviderRuntimeEvent, "type" | "payload">,
    message: Extract<SDKMessage, { type: "system"; subtype: "task_progress" }>,
  ) {
    const progress = parseWorkflowProgress(
      (message as unknown as Record<string, unknown>).workflow_progress,
    );
    if (!progress) {
      return;
    }
    const coordinatorId = message.task_id;
    for (const entry of progress.agents) {
      const memberTaskId = `${coordinatorId}:wf:${entry.index}`;
      const status = workflowAgentStatus(entry);
      // Material-transition filter: the wire repeats every member each tick.
      // Emit only when something the client renders actually changed, so a
      // 100-agent fleet costs ~1 event per changed member instead of 100
      // per tick (review finding: unbounded event amplification).
      const fingerprint = [
        status,
        entry.label ?? "",
        entry.model ?? "",
        entry.lastToolName ?? "",
        entry.error ?? "",
        entry.tokens ?? "",
        entry.toolCalls ?? "",
        entry.phaseIndex ?? "",
        entry.phaseTitle ?? "",
        entry.attempt ?? "",
      ].join("\u001f");
      if (context.workflowMemberFingerprints.get(memberTaskId) === fingerprint) {
        continue;
      }
      context.workflowMemberFingerprints.set(memberTaskId, fingerprint);
      const stamp = yield* makeEventStamp();
      yield* offerRuntimeEvent({
        ...base,
        eventId: stamp.eventId,
        createdAt: stamp.createdAt,
        type: "task.progress",
        payload: {
          taskId: RuntimeTaskId.make(memberTaskId),
          description: entry.label ?? `agent ${entry.index}`,
          status,
          ...(entry.error ? { error: entry.error } : {}),
          ...(entry.label ? { title: entry.label } : {}),
          ...(entry.model ? { model: entry.model } : {}),
          ...(entry.lastToolName ? { lastToolName: entry.lastToolName } : {}),
          ...(entry.tokens !== undefined
            ? {
                typedUsage: {
                  totalTokens: entry.tokens,
                  ...(entry.toolCalls !== undefined ? { toolUses: entry.toolCalls } : {}),
                },
              }
            : {}),
          parentAgentId: coordinatorId,
          agentIndex: entry.index,
          ...(entry.phaseIndex !== undefined ? { phaseIndex: entry.phaseIndex } : {}),
          ...(entry.phaseTitle ? { phaseTitle: entry.phaseTitle } : {}),
          ...(entry.attempt !== undefined ? { attempt: entry.attempt } : {}),
          timelineBypass: true,
        },
      });
    }
  });

  const handleSystemMessage = Effect.fn("handleSystemMessage")(function* (
    context: ClaudeSessionContext,
    message: SDKMessage,
  ) {
    if (message.type !== "system") {
      return;
    }

    const stamp = yield* makeEventStamp();
    const base = {
      eventId: stamp.eventId,
      provider: PROVIDER,
      createdAt: stamp.createdAt,
      threadId: context.session.threadId,
      ...(context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {}),
      providerRefs: nativeProviderRefs(context),
      raw: {
        source: "claude.sdk.message" as const,
        method: sdkNativeMethod(message),
        messageType: `${message.type}:${message.subtype}`,
        payload: message,
      },
    };

    // Undeclared-but-real subtypes (absent from the SDK's union, so they can't
    // be switch cases): consumed intentionally without emitting, otherwise
    // they fall through to the unknown-subtype warning and surface as spurious
    // error rows in client work logs. `vcs_state_changed`
    // ({kind: commit|push|rebase}) and `code_change_published`
    // ({provider, url, repo}) are informational CLI notices; the work log
    // already shows the underlying git/gh tool calls.
    switch (message.subtype as string) {
      case "vcs_state_changed":
      case "code_change_published":
        return;
    }

    switch (message.subtype) {
      case "init": {
        yield* offerRuntimeEvent({
          ...base,
          type: "session.configured",
          payload: {
            config: message as Record<string, unknown>,
          },
        });
        // The live session answers its folder's commands without a spawn: a
        // scan of this folder that came back pending completes here.
        const cwd = context.session.cwd;
        const onWorkspaceCommands = options?.onWorkspaceCommands;
        const supportedCommands = context.query.supportedCommands?.bind(context.query);
        if (cwd && onWorkspaceCommands && supportedCommands) {
          yield* Effect.tryPromise(() => supportedCommands()).pipe(
            Effect.flatMap((commands) => onWorkspaceCommands(commands, cwd)),
            Effect.catch((error) =>
              Effect.logWarning("claude.workspace-commands.unavailable", {
                threadId: context.session.threadId,
                cause: toMessage(error.cause, "supportedCommands failed"),
              }),
            ),
          );
        }
        return;
      }
      case "status":
        // A status notice is progress inside a turn. With none open it
        // belongs to a turn this adapter is not tracking (a queued /compact
        // whose turn a background wake's result already closed), or it only
        // reports a permission mode change. Nothing would settle a working
        // state reported now: that turn's result finds no turn to complete.
        if (!context.turnState) {
          return;
        }
        yield* offerRuntimeEvent({
          ...base,
          type: "session.state.changed",
          payload: {
            state: message.status === "compacting" ? "waiting" : "running",
            reason: `status:${message.status ?? "active"}`,
            detail: message,
          },
        });
        return;
      case "compact_boundary": {
        // Compaction drops every reminder that led a message; the session holds its first prompt.
        context.instructions = context.startInstructions;
        yield* updateResumeCursor(context);
        if (context.turnState) {
          context.turnState.latestAssistantUsage = undefined;
          context.turnState.compactedSinceLatestAssistantUsage = true;
        }
        const compactedUsage = compactBoundaryTokenUsageSnapshot(
          message as unknown as Record<string, unknown>,
          context.lastKnownContextWindow,
          context.lastKnownTotalProcessedTokens,
        );
        yield* emitThreadTokenUsage(context, compactedUsage, {
          rawMethod: "claude/system/compact_boundary",
          rawPayload: message,
        });
        yield* offerRuntimeEvent({
          ...base,
          type: "thread.state.changed",
          payload: {
            state: "compacted",
            ...(compactedUsage?.lastUsedTokens !== undefined
              ? { beforeTokens: compactedUsage.lastUsedTokens }
              : {}),
            ...(compactedUsage?.usedTokens !== undefined
              ? { afterTokens: compactedUsage.usedTokens }
              : {}),
            detail: message,
          },
        });
        return;
      }
      case "hook_started":
        yield* offerRuntimeEvent({
          ...base,
          type: "hook.started",
          payload: {
            hookId: message.hook_id,
            hookName: message.hook_name,
            hookEvent: message.hook_event,
          },
        });
        return;
      case "hook_progress":
        yield* offerRuntimeEvent({
          ...base,
          type: "hook.progress",
          payload: {
            hookId: message.hook_id,
            output: message.output,
            stdout: message.stdout,
            stderr: message.stderr,
          },
        });
        return;
      case "hook_response":
        yield* offerRuntimeEvent({
          ...base,
          type: "hook.completed",
          payload: {
            hookId: message.hook_id,
            outcome: message.outcome,
            output: message.output,
            stdout: message.stdout,
            stderr: message.stderr,
            ...(typeof message.exit_code === "number" ? { exitCode: message.exit_code } : {}),
          },
        });
        return;
      case "task_started": {
        // A task launched by a tool that itself ran inside a subagent is
        // agent-internal: a subagent's background shell, not parent work. A
        // streamed tool carries agentId from parent_tool_use_id; a tool seen
        // only in a subagent snapshot resolves through subagentToolParents.
        const toolUseId = message.tool_use_id;
        const launchingTool = toolUseId
          ? Array.from(context.inFlightTools.values()).find((tool) => tool.itemId === toolUseId)
          : undefined;
        // A tool seen only in a subagent snapshot resolves through
        // subagentToolParents to the subagent that called it.
        const launchParentToolUseId = toolUseId
          ? context.subagentToolParents.get(toolUseId)
          : undefined;
        if (toolUseId) {
          context.subagentToolParents.delete(toolUseId);
        }
        const owningAgentId =
          launchingTool === undefined
            ? helperOfCall(context.taskAgents, launchParentToolUseId)
            : (helperOfCall(context.taskAgents, launchingTool.parentToolUseId) ??
              launchingTool.agentId);
        // Model/effort: the Agent tool's input carries explicit overrides;
        // absent ones inherit the owning subagent's model, else the session's
        // selection (SDK behavior). Subagent assistant snapshots refine model
        // with the authoritative API id: one that already arrived is buffered
        // and outranks the seed here, later ones refine the record in place.
        // AgentInput.effort may be a named level or an integer.
        const launchInput = launchingTool?.input;
        const bufferedModel = toolUseId ? context.pendingTaskModels.get(toolUseId) : undefined;
        if (toolUseId) {
          context.pendingTaskModels.delete(toolUseId);
        }
        const model =
          bufferedModel ??
          trimmedString(launchInput?.model) ??
          (owningAgentId ? context.taskAgents.get(owningAgentId)?.model : undefined) ??
          trimmedString(context.session.model ?? undefined);
        const rawLaunchEffort = launchInput?.effort;
        const effort =
          trimmedString(rawLaunchEffort) ??
          (typeof rawLaunchEffort === "number" && Number.isFinite(rawLaunchEffort)
            ? String(rawLaunchEffort)
            : context.currentEffort);
        // Remember the agent identity so every later task.* payload for this
        // taskId is self-describing (identity must survive activity retention).
        const earlier = context.taskAgents.get(message.task_id)?.launches ?? [];
        context.taskAgents.set(message.task_id, {
          taskId: message.task_id,
          toolUseId: message.tool_use_id,
          launches:
            message.tool_use_id === undefined || earlier.includes(message.tool_use_id)
              ? earlier
              : [...earlier, message.tool_use_id],
          description: message.description,
          subagentType: message.subagent_type,
          taskType: message.task_type,
          workflowName: message.workflow_name,
          skipTranscript: message.skip_transcript === true,
          runHandles: context.taskAgents.get(message.task_id)?.runHandles,
          owningAgentId,
          model,
          effort,
        });
        context.liveTaskIds.add(message.task_id);
        yield* offerRuntimeEvent({
          ...base,
          type: "task.started",
          payload: {
            taskId: RuntimeTaskId.make(message.task_id),
            description: message.description,
            ...(message.task_type ? { taskType: message.task_type } : {}),
            ...(owningAgentId ? { agentId: owningAgentId } : {}),
            ...(message.description ? { title: message.description } : {}),
            ...(message.subagent_type ? { role: message.subagent_type } : {}),
            ...(model ? { model } : {}),
            ...(effort ? { effort } : {}),
            ...(message.tool_use_id ? { toolUseId: message.tool_use_id } : {}),
            ...(message.workflow_name ? { workflowName: message.workflow_name } : {}),
            ...(trimmedString(message.prompt) ? { prompt: trimmedString(message.prompt) } : {}),
          },
        });
        return;
      }
      case "task_progress": {
        yield* emitThreadTokenUsage(
          context,
          normalizeClaudeTaskProgressTokenUsage(message.usage, context),
          {
            rawMethod: "claude/system/task_progress",
            rawPayload: message,
          },
        );
        const linkage = taskLinkageFor(context.taskAgents, message.task_id);
        const typedUsage = normalizeTaskUsage(message.usage);
        // Phases ride on the coordinator's ONE progress row per tick. A
        // separate phases-only row shared the stable ingestion activity id
        // with this full row, and the thinner upsert overwrote usage and
        // progress text (review finding).
        const workflowPhases = parseWorkflowProgress(
          (message as unknown as Record<string, unknown>).workflow_progress,
        )?.phases;
        yield* offerRuntimeEvent({
          ...base,
          type: "task.progress",
          payload: {
            taskId: RuntimeTaskId.make(message.task_id),
            description: message.description,
            ...(message.summary ? { summary: message.summary } : {}),
            ...(message.usage ? { usage: message.usage } : {}),
            ...(typedUsage ? { typedUsage } : {}),
            ...(message.last_tool_name ? { lastToolName: message.last_tool_name } : {}),
            ...(workflowPhases && workflowPhases.length > 0 ? { phases: workflowPhases } : {}),
            ...linkage,
            ...(message.subagent_type ? { role: message.subagent_type } : {}),
          },
        });
        yield* emitWorkflowMemberProgress(context, base, message);
        return;
      }
      case "task_updated": {
        // Status patch (killed/paused/backgrounded/end_time/error) — main
        // previously dropped this on the floor, losing all transitions.
        const patch = message.patch;
        const status =
          patch.status !== undefined ? CLAUDE_TASK_PATCH_STATUS[patch.status] : undefined;
        if (status === "completed" || status === "failed" || status === "cancelled") {
          context.liveTaskIds.delete(message.task_id);
          yield* closeHelperCalls(
            context,
            message.task_id,
            status === "completed" ? "completed" : "failed",
            message,
          );
        }
        const endedAt =
          typeof patch.end_time === "number" && Number.isFinite(patch.end_time)
            ? DateTime.formatIso(DateTime.makeUnsafe(patch.end_time))
            : undefined;
        yield* offerRuntimeEvent({
          ...base,
          type: "task.updated",
          payload: {
            taskId: RuntimeTaskId.make(message.task_id),
            ...(status ? { status } : {}),
            ...(patch.description ? { description: patch.description } : {}),
            ...(patch.error ? { error: patch.error } : {}),
            ...(endedAt ? { endedAt } : {}),
            ...(patch.is_backgrounded !== undefined
              ? { isBackgrounded: patch.is_backgrounded }
              : {}),
            ...taskLinkageFor(context.taskAgents, message.task_id),
          },
        });
        return;
      }
      case "task_notification": {
        context.liveTaskIds.delete(message.task_id);
        yield* closeHelperCalls(
          context,
          message.task_id,
          message.status === "completed" ? "completed" : "failed",
          message,
        );
        yield* emitThreadTokenUsage(
          context,
          normalizeClaudeTaskProgressTokenUsage(message.usage, context),
          {
            rawMethod: "claude/system/task_notification",
            rawPayload: message,
          },
        );
        const typedUsage = normalizeTaskUsage(message.usage);
        yield* offerRuntimeEvent({
          ...base,
          type: "task.completed",
          payload: {
            taskId: RuntimeTaskId.make(message.task_id),
            status: message.status,
            ...(message.summary ? { summary: message.summary } : {}),
            ...(message.usage ? { usage: message.usage } : {}),
            ...(typedUsage ? { typedUsage } : {}),
            ...(message.output_file ? { outputFile: message.output_file } : {}),
            ...taskLinkageFor(context.taskAgents, message.task_id),
          },
        });
        return;
      }
      case "files_persisted":
        yield* offerRuntimeEvent({
          ...base,
          type: "files.persisted",
          payload: {
            files: Array.isArray(message.files)
              ? message.files.map((file: { filename: string; file_id: string }) => ({
                  filename: file.filename,
                  fileId: file.file_id,
                }))
              : [],
            ...(Array.isArray(message.failed)
              ? {
                  failed: message.failed.map((entry: { filename: string; error: string }) => ({
                    filename: entry.filename,
                    error: entry.error,
                  })),
                }
              : {}),
          },
        });
        return;
      case "thinking_tokens":
        return;
      case "api_retry":
        // Transport-level retry heartbeat. Surfacing each attempt as a
        // warning row spammed the work log (10 rows during a 502 storm);
        // the terminal result/error path reports the actual failure. Keep
        // the session visibly alive instead.
        yield* offerRuntimeEvent({
          ...base,
          type: "session.state.changed",
          payload: {
            state: "running",
            reason: `api_retry:${message.attempt}/${message.max_retries}`,
          },
        });
        return;
      case "session_state_changed":
        // Authoritative turn-over signal from the CLI.
        yield* offerRuntimeEvent({
          ...base,
          type: "session.state.changed",
          payload: {
            state:
              message.state === "running"
                ? "running"
                : message.state === "requires_action"
                  ? "waiting"
                  : "ready",
            reason: `session_state:${message.state}`,
          },
        });
        return;
      case "notification":
        // User-facing CLI notification (e.g. context-limit warnings). Only
        // high-priority ones warrant a work-log row.
        if (message.priority === "high" || message.priority === "immediate") {
          yield* emitRuntimeWarning(context, message.text, message);
        }
        return;
      case "model_refusal_fallback":
        // A safety fallback switched the model mid-session (e.g. Fable 5
        // retried on Opus 4.8 after a flagged request). The CLI ships the
        // user-facing notice in `content`; surface it like high-priority
        // notifications so the rest of the session isn't silently served
        // by a different model.
        yield* emitRuntimeWarning(context, message.content, message);
        return;
      // Inner protocol/UX details with no T3 surface today — consumed
      // deliberately so they don't masquerade as unknown-subtype warnings.
      // `background_tasks_changed` is a roster snapshot ({tasks: [...]}); the
      // task_* lifecycle events carry the authoritative per-agent data and
      // the typed background_tasks control request is the reconciliation
      // source. `control_request_progress` is a liveness heartbeat for an
      // in-flight control request. `worker_shutting_down` is a Remote
      // Control worker notice; the session close path reports the outcome.
      case "local_command_output":
        // A local slash command's output, which the SDK asks to be shown as
        // assistant text: the CLI's own `<synthetic>` reply, so it travels
        // the same way. It belongs to the command's turn; after its result it
        // would open a synthetic turn that nothing closes.
        if (!context.turnState) return;
        yield* handleAssistantMessage(context, {
          type: "assistant",
          session_id: message.session_id,
          uuid: message.uuid,
          parent_tool_use_id: null,
          message: {
            id: message.uuid,
            model: "<synthetic>",
            content: [{ type: "text", text: message.content }],
          },
        } as unknown as SDKMessage);
        return;
      case "commands_changed": {
        // Claude's full list after a mid-session change; it replaces the folder's.
        const cwd = context.session.cwd;
        if (cwd && options?.onWorkspaceCommands) {
          yield* options.onWorkspaceCommands(message.commands, cwd);
        }
        return;
      }
      case "plugin_install":
      case "memory_recall":
      case "elicitation_complete":
      case "background_tasks_changed":
      case "control_request_progress":
      case "worker_shutting_down":
        return;
      case "informational":
        // Transcript-level CLI notes. Only warnings (e.g. a Stop hook that
        // refused continuation) warrant a work-log row; info/notice/
        // suggestion levels are CLI chrome.
        if (message.level === "warning") {
          yield* emitRuntimeWarning(context, message.content, message);
        }
        return;
      case "model_refusal_no_fallback":
        // The API refused the request and no fallback model was available.
        // The terminal result reports the failed turn; this row carries the
        // refusal explanation the result's error list lacks.
        yield* emitRuntimeWarning(
          context,
          message.api_refusal_explanation?.trim() || message.content,
          message,
        );
        return;
      case "permission_denied":
        yield* offerRuntimeEvent({
          ...base,
          type: "tool.denied",
          payload: {
            toolName: message.tool_name,
            ...(message.tool_use_id ? { toolUseId: message.tool_use_id } : {}),
            ...(message.decision_reason ? { reason: message.decision_reason } : {}),
            ...(message.agent_id ? { agentId: message.agent_id } : {}),
          },
        });
        return;
      case "mirror_error":
        yield* emitRuntimeError(
          context,
          `Claude workspace mirror error: ${message.error}`,
          message,
        );
        return;
      default: {
        // Exhaustiveness guard: every subtype in the SDK's typed union is
        // handled above, so `message` narrows to never here — a new SDK
        // release adding a subtype fails this typecheck instead of silently
        // warning at runtime. The runtime fallback still catches undeclared
        // wire-only subtypes (like vcs_state_changed).
        message satisfies never;
        const unknownMessage = message as never as { subtype: string };
        yield* emitRuntimeWarning(
          context,
          describeUnknownSdkMessage(`Claude system message '${unknownMessage.subtype}'`, message),
          message,
        );
        return;
      }
    }
  });

  const handleSdkTelemetryMessage = Effect.fn("handleSdkTelemetryMessage")(function* (
    context: ClaudeSessionContext,
    message: SDKMessage,
  ) {
    const stamp = yield* makeEventStamp();
    const base = {
      eventId: stamp.eventId,
      provider: PROVIDER,
      createdAt: stamp.createdAt,
      threadId: context.session.threadId,
      ...(context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {}),
      providerRefs: nativeProviderRefs(context),
      raw: {
        source: "claude.sdk.message" as const,
        method: sdkNativeMethod(message),
        messageType: message.type,
        payload: message,
      },
    };

    if (message.type === "tool_progress") {
      yield* offerRuntimeEvent({
        ...base,
        type: "tool.progress",
        payload: {
          toolUseId: message.tool_use_id,
          toolName: message.tool_name,
          elapsedSeconds: message.elapsed_time_seconds,
          ...(message.task_id ? { taskId: RuntimeTaskId.make(message.task_id) } : {}),
          ...(message.parent_tool_use_id !== null
            ? { parentToolUseId: message.parent_tool_use_id }
            : {}),
        },
      });
      return;
    }

    if (message.type === "tool_use_summary") {
      yield* offerRuntimeEvent({
        ...base,
        type: "tool.summary",
        payload: {
          summary: message.summary,
          ...(message.preceding_tool_use_ids.length > 0
            ? {
                precedingToolUseIds: message.preceding_tool_use_ids,
              }
            : {}),
        },
      });
      return;
    }

    if (message.type === "auth_status") {
      yield* offerRuntimeEvent({
        ...base,
        type: "auth.status",
        payload: {
          isAuthenticating: message.isAuthenticating,
          output: message.output,
          ...(message.error ? { error: message.error } : {}),
        },
      });
      return;
    }

    if (message.type === "rate_limit_event") {
      const rateLimitInfo = message.rate_limit_info;
      if (!rateLimitInfo) return;
      const names = options?.scopedLimitNames
        ? yield* Ref.get(options.scopedLimitNames)
        : { overageIncluded: undefined };
      const limits = claudeRateLimitEventToUpdate(rateLimitInfo, names);
      // A rejected window parks the turn inside the SDK: no further messages
      // arrive and no result lands, so without a row the thread just spins.
      // Warnings (allowed_warning) still have headroom and stay quiet, an
      // account spending provisioned overage keeps running despite the reject,
      // and between turns there is no turn to report as paused.
      const overageAllowed =
        rateLimitInfo.overageStatus === "allowed" ||
        rateLimitInfo.overageStatus === "allowed_warning" ||
        rateLimitInfo.isUsingOverage === true ||
        rateLimitInfo.overageInUse === true;
      const blocked = rateLimitInfo.status === "rejected" && !overageAllowed;
      const closed = blocked
        ? claudeUsageLimitBlock(rateLimitInfo, Date.parse(stamp.createdAt), names)
        : undefined;
      context.usageLimitBlockedUntilMs = closed?.resetsAtMs;
      const limitType = rateLimitInfo.rateLimitType ?? "unknown";
      const limitKey = `${limitType}:${rateLimitInfo.resetsAt ?? "unknown"}`;
      const wasRefused = (context.turnState?.rejectedRateLimitTypes.size ?? 0) > 0;
      if (context.turnState) {
        // Current blocking evidence is independent of whether its warning has
        // already been shown. A recovery can omit or advance the reset time;
        // its window type remains stable without clearing another window.
        if (blocked) context.turnState.rejectedRateLimitTypes.add(limitType);
        else if (
          rateLimitInfo.status === "allowed" ||
          rateLimitInfo.status === "allowed_warning" ||
          overageAllowed
        ) {
          context.turnState.rejectedRateLimitTypes.delete(limitType);
        }
      }
      const knowsAdmission =
        blocked ||
        rateLimitInfo.status === "allowed" ||
        rateLimitInfo.status === "allowed_warning" ||
        overageAllowed;
      const refused =
        context.turnState && knowsAdmission && (blocked || wasRefused)
          ? context.turnState.rejectedRateLimitTypes.size > 0
          : undefined;
      if (limits || closed || refused !== undefined) {
        yield* offerRuntimeEvent({
          ...base,
          type: "account.rate-limits.updated",
          payload: {
            limits: limits ?? { windows: [] },
            ...(closed ? { blocked: closed.block } : {}),
            ...(refused === undefined ? {} : { refused }),
          },
        });
      }
      if (blocked && context.turnState !== undefined) {
        // Tracked per turn as a set of limit identities, not as the rendered
        // row: a parked window re-fires while the remaining wait shrinks, and a
        // turn can park on more than one window, so a single slot would let an
        // interleaved repeat through. A new turn — including a synthetic one —
        // starts a fresh set and announces its pause again.
        const turnId = context.turnState.turnId;
        if (context.announcedUsageLimits?.turnId !== turnId) {
          context.announcedUsageLimits = { turnId, keys: new Set() };
        }
        if (!context.announcedUsageLimits.keys.has(limitKey)) {
          context.announcedUsageLimits.keys.add(limitKey);
          const notice = describeClaudeUsageLimit(
            rateLimitInfo,
            Date.parse(stamp.createdAt),
            names,
          );
          yield* emitRuntimeWarning(context, notice, rateLimitInfo);
        }
      }
      return;
    }
  });

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
