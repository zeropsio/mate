import {
  type CanUseTool,
  type Options as ClaudeQueryOptions,
  type PermissionResult,
  type PermissionUpdate,
} from "@anthropic-ai/claude-agent-sdk";
import {
  ApprovalRequestId,
  type ProviderApprovalDecision,
  type ProviderUserInputAnswers,
  type UserInputQuestion,
} from "@t3tools/contracts";
import {
  CLAUDE_RESUME_COMPACTION_NEVER_ANSWER,
  formatClaudeResumeCompactionQuestion,
} from "@t3tools/shared/claudeCompaction";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import { type ClaudeAdapterShape } from "../Services/ClaudeAdapter.ts";
import {
  PROVIDER,
  type PendingApproval,
  type PendingUserInput,
  type ClaudeSessionContext,
  type ClaudeAdapterKit,
  asCanonicalTurnId,
  asRuntimeRequestId,
  nativeProviderRefs,
} from "./ClaudeSessionState.ts";
import {
  classifyRequestType,
  summarizeToolRequest,
  extractExitPlanModePlan,
} from "./ClaudeToolItems.ts";
import { helperOfCall } from "./ClaudeTasks.ts";
import { finiteNonNegativeInteger } from "./ClaudeTokenUsage.ts";
import { type ClaudeRuntimeEmit } from "./ClaudeRuntimeEmit.ts";

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

/** One session's answers to Claude's permission and question callbacks. */
export const makeClaudeSessionPermissions = (
  kit: ClaudeAdapterKit,
  parts: { readonly runtimeEmit: ClaudeRuntimeEmit },
  session: {
    readonly input: Parameters<ClaudeAdapterShape["startSession"]>[0];
    readonly contextRef: Ref.Ref<ClaudeSessionContext | undefined>;
    readonly pendingApprovals: Map<ApprovalRequestId, PendingApproval>;
    readonly pendingUserInputs: Map<ApprovalRequestId, PendingUserInput>;
    readonly runFork: ReturnType<typeof Effect.runForkWith<never>>;
    readonly runPromise: ReturnType<typeof Effect.runPromiseWith<never>>;
  },
) => {
  const { randomUUIDv4, makeEventStamp, offerRuntimeEvent } = kit;
  const { emitProposedPlanCompleted } = parts.runtimeEmit;
  const { input, contextRef, pendingApprovals, pendingUserInputs, runFork, runPromise } = session;

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
      return Deferred.succeed(answersDeferred, {} as ProviderUserInputAnswers).pipe(Effect.ignore);
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
    const agentId = helperOfCall(context.taskAgents, parentToolUseId) ?? callbackOptions.agentID;
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
              updatedPermissions: toSessionPermissionUpdates(toolName, pendingApproval.suggestions),
            }
          : {}),
      } satisfies PermissionResult;
    }

    return {
      behavior: "deny",
      message:
        decision === "cancel" ? "User cancelled tool execution." : "User declined tool execution.",
    } satisfies PermissionResult;
  });

  const canUseTool: CanUseTool = (toolName, toolInput, callbackOptions) =>
    runPromise(canUseToolEffect(toolName, toolInput, callbackOptions));
  const onUserDialog: NonNullable<ClaudeQueryOptions["onUserDialog"]> = (
    request,
    callbackOptions,
  ) => runPromise(handleResumeDialog(request, callbackOptions));

  return { canUseTool, onUserDialog };
};
