import { type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  claudeRateLimitEventToUpdate,
  claudeUsageLimitBlock,
  describeClaudeUsageLimit,
} from "../Layers/claudeUsageLimits.ts";
import { type ProviderRuntimeEvent, RuntimeTaskId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import {
  PROVIDER,
  type ClaudeSessionContext,
  type ClaudeAdapterKit,
  asCanonicalTurnId,
  nativeProviderRefs,
} from "./ClaudeSessionState.ts";
import { sdkNativeMethod, describeUnknownSdkMessage } from "./ClaudeSdkMessages.ts";
import {
  trimmedString,
  normalizeTaskUsage,
  CLAUDE_TASK_PATCH_STATUS,
  helperOfCall,
  taskLinkageFor,
  parseWorkflowProgress,
  workflowAgentStatus,
} from "./ClaudeTasks.ts";
import {
  compactBoundaryTokenUsageSnapshot,
  normalizeClaudeTaskProgressTokenUsage,
} from "./ClaudeTokenUsage.ts";
import { toMessage } from "./ClaudeFailures.ts";
import type { ClaudeAdapterLiveOptions } from "../Layers/ClaudeAdapter.ts";
import { type ClaudeResumeCursor } from "./ClaudeResumeCursor.ts";
import { type ClaudeRuntimeEmit } from "./ClaudeRuntimeEmit.ts";
import { type ClaudeToolCalls } from "./ClaudeToolCalls.ts";
import { type ClaudeMessages } from "./ClaudeMessages.ts";

/** The SDK's system and telemetry messages: init, status, tasks, workflows, compaction, limits. */
export const makeClaudeSystemMessages = (
  kit: ClaudeAdapterKit,
  parts: {
    readonly resumeCursor: ClaudeResumeCursor;
    readonly runtimeEmit: ClaudeRuntimeEmit;
    readonly toolCalls: ClaudeToolCalls;
    readonly messages: ClaudeMessages;
  },
  options: ClaudeAdapterLiveOptions | undefined,
) => {
  const { makeEventStamp, offerRuntimeEvent } = kit;
  const { updateResumeCursor } = parts.resumeCursor;
  const { emitRuntimeError, emitRuntimeWarning, emitThreadTokenUsage } = parts.runtimeEmit;
  const { closeHelperCalls } = parts.toolCalls;
  const { handleAssistantMessage } = parts.messages;

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
        // The earlier reading describes the context before compaction, even when Claude gives no
        // post-compaction count. Never report it again as the size of the compacted context.
        context.lastKnownTokenUsage = compactedUsage;
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

  return { handleSystemMessage, handleSdkTelemetryMessage };
};

export type ClaudeSystemMessages = ReturnType<typeof makeClaudeSystemMessages>;
