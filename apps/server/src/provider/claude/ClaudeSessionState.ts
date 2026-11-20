import {
  ProviderDriverKind,
  type RuntimeContentStreamKind,
  ThreadId,
  TurnId,
  type CanonicalRequestType,
  type ProviderApprovalDecision,
  type UserInputQuestion,
  type ProviderUserInputAnswers,
  type CanonicalItemType,
  type ToolPresentation,
  type TaskRunHandles,
  type ProviderSession,
  ApprovalRequestId,
  type ThreadTokenUsageSnapshot,
  RuntimeItemId,
  RuntimeRequestId,
  type ProviderRuntimeEvent,
  ProviderItemId,
  type EventId,
} from "@t3tools/contracts";
import type {
  Options as ClaudeQueryOptions,
  SDKUserMessage,
  PermissionUpdate,
  PermissionMode,
  SDKMessage,
  Query as ClaudeSdkQuery,
} from "@anthropic-ai/claude-agent-sdk";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import { makeClaudeTurnUsage } from "../../spi/responseUsage.ts";
import type { StderrTail } from "../claudeStreamFailure.ts";
import type { ClaudeAdapterShape } from "../Services/ClaudeAdapter.ts";
import * as Queue from "effect/Queue";
import * as Fiber from "effect/Fiber";
import type { ClaudeMcpQuery } from "../../spi/mcpControl.ts";
import type { ProviderAdapterRequestError } from "../Errors.ts";

export const PROVIDER = ProviderDriverKind.make("claudeAgent");
export type ClaudeTextStreamKind = Extract<
  RuntimeContentStreamKind,
  "assistant_text" | "reasoning_text" | "reasoning_summary_text"
>;
export type ClaudeToolResultStreamKind = Extract<
  RuntimeContentStreamKind,
  "command_output" | "file_change_output"
>;
export type ClaudeSdkEffort = NonNullable<ClaudeQueryOptions["effort"]>;

export type PromptQueueItem =
  | {
      readonly type: "message";
      readonly message: SDKUserMessage;
    }
  | {
      readonly type: "terminate";
    };

export interface ClaudeResumeState {
  readonly threadId?: ThreadId;
  readonly resume?: string;
  readonly resumeSessionAt?: string;
  readonly turnCount?: number;
  readonly turnStartMessageIds?: ReadonlyArray<string | null>;
  /** The mark of the instructions its Claude session holds: a resume keeps its first prompt. */
  readonly instructions?: string;
  /** The mark of the system prompt its Claude session began with: compaction returns to it. */
  readonly startInstructions?: string;
}

export interface ClaudeTurnState {
  readonly turnId: TurnId;
  readonly startedAt: string;
  /**
   * True for turns auto-started by assistant output arriving without an
   * active turn (background agent/subagent responses between user prompts).
   * Synthetic turns are auto-closed by the next sendTurn; real turns are
   * steered instead (the queued message continues the same turn).
   */
  readonly synthetic?: boolean;
  readonly assistantTextBlocks: Map<number, AssistantTextBlockState>;
  readonly assistantTextBlockOrder: Array<AssistantTextBlockState>;
  readonly capturedProposedPlanKeys: Set<string>;
  latestAssistantUsage: unknown | undefined;
  compactedSinceLatestAssistantUsage: boolean;
  nextSyntheticAssistantBlockIndex: number;
  authenticationFailureMessage: string | undefined;
  rejectedRateLimitTypes: Set<string>;
  latestAssistantRateLimited: boolean;
  emittedThinkingText: boolean;
  readonly thinkingSnapshotIds: Set<string>;
  /** The Mate's model response streaming now (`message_start`): its calls are one batch. */
  responseId?: string | undefined;
  /** A synthetic turn its stream opened: its first assistant message is still to name it. */
  startMessagePending?: boolean;
}

export interface AssistantTextBlockState {
  readonly itemId: string;
  readonly blockIndex: number;
  emittedTextDelta: boolean;
  fallbackText: string;
  streamClosed: boolean;
  completionEmitted: boolean;
  /**
   * Its streamed words, held while they could still be Claude Code's no-reply placeholder
   * (`isClaudePlaceholderPrefix`); null once they cannot, and they went out.
   */
  heldText: string | null;
}

export interface PendingApproval {
  readonly requestType: CanonicalRequestType;
  readonly detail?: string;
  readonly suggestions?: ReadonlyArray<PermissionUpdate>;
  readonly decision: Deferred.Deferred<ProviderApprovalDecision>;
}

export interface PendingUserInput {
  readonly questions: ReadonlyArray<UserInputQuestion>;
  readonly answers: Deferred.Deferred<ProviderUserInputAnswers>;
  /** Unparks the waiting handler as cancelled. Session teardown must run it. */
  readonly cancel: Effect.Effect<void>;
}

export interface ToolInFlight {
  readonly itemId: string;
  readonly itemType: CanonicalItemType;
  readonly toolName: string;
  readonly title: string;
  readonly detail?: string;
  readonly input: Record<string, unknown>;
  readonly partialInputJson: string;
  readonly lastEmittedInputFingerprint?: string;
  /** Owning agent when this tool ran inside a subagent (see attribution note). */
  readonly agentId?: string;
  readonly parentToolUseId?: string;
  /** How Claude Code presents the call (an MCP tool's title and server), once its frame says. */
  readonly presentation?: ToolPresentation;
}

export interface ClaudeTaskState {
  readonly id: string;
  subject: string;
  status: PlanStep["status"];
  readonly blockedBy: Set<string>;
}

/**
 * Agent identity captured from task_started and repeated on every subsequent
 * task.* payload, so client folds can reconstruct an agent even when its
 * start row aged out of activity retention.
 */
export interface ClaudeTaskAgentState {
  readonly taskId: string;
  toolUseId: string | undefined;
  /** Every launch of this task, a resume's included: a resumed helper's calls
   * keep naming its first launch as their parent. */
  launches: ReadonlyArray<string>;
  description: string | undefined;
  subagentType: string | undefined;
  taskType: string | undefined;
  workflowName: string | undefined;
  skipTranscript: boolean;
  runHandles: TaskRunHandles | undefined;
  /** Set when this task was launched from inside a subagent. */
  owningAgentId: string | undefined;
  /** Seeded from the launching tool's input; refined by the subagent's own
   * assistant snapshots (authoritative API model). */
  model: string | undefined;
  effort: string | undefined;
}

export interface ClaudeSessionContext {
  readonly turnUsage: ReturnType<typeof makeClaudeTurnUsage>;
  session: ProviderSession;
  /** The last of what the CLI wrote to stderr: why its stream died, for the log. */
  readonly stderrTail: StderrTail;
  startInput: Parameters<ClaudeAdapterShape["startSession"]>[0];
  readonly turnStartMessageIds: Array<string | null>;
  readonly promptQueue: Queue.Queue<PromptQueueItem>;
  readonly query: ClaudeQueryRuntime;
  streamFiber: Fiber.Fiber<void, Error> | undefined;
  readonly startedAt: string;
  readonly basePermissionMode: PermissionMode | undefined;
  /** It runs a thread tool profile (a crewmate): the MCP tab never reaches it. */
  readonly profiled: boolean;
  currentApiModelId: string | undefined;
  /** Effective effort for the session's turns; subagents without an explicit
   * effort override inherit this. */
  currentEffort: string | undefined;
  resumeSessionId: string | undefined;
  /** The mark of the instructions its Claude session holds; another one hears the current ones. */
  instructions: string | undefined;
  /** The mark of the system prompt it began with, which it holds again after compacting. */
  readonly startInstructions: string | undefined;
  /** A crewmate's whole appended prompt, fixed at start: Mate's instructions and its crew context. */
  readonly crewInstructions: string | undefined;
  readonly pendingApprovals: Map<ApprovalRequestId, PendingApproval>;
  readonly pendingUserInputs: Map<ApprovalRequestId, PendingUserInput>;
  /** Completed turn ids, reported by readThread and trimmed on rollback.
   * SDK messages are not kept: rollback reads Claude's own history through
   * turnStartMessageIds, and a long-lived session would otherwise hold every
   * message it ever produced. */
  readonly turns: Array<{ readonly id: TurnId }>;
  /** By `inFlightToolKey`: a block index counts within one response, the parent's or a helper's. */
  readonly inFlightTools: Map<string, ToolInFlight>;
  readonly claudeTasks: Map<string, ClaudeTaskState>;
  readonly taskAgents: Map<string, ClaudeTaskAgentState>;
  /**
   * Authoritative subagent models from assistant snapshots that arrived before
   * their task_started registered the task, keyed by parent_tool_use_id.
   * Written through `rememberPendingTaskEntry`, consumed by task_started.
   */
  readonly pendingTaskModels: Map<string, string>;
  /**
   * tool_use_id → parent_tool_use_id for tool calls made inside a subagent.
   * The SDK forwards those calls only as assistant snapshots, never as stream
   * events, so task_started reads this to find the owner of a task launched
   * from inside a subagent.
   */
  readonly subagentToolParents: Map<string, string>;
  /**
   * Last emitted workflow-member fingerprint per member slot. A coordinator
   * task_progress repeats the FULL member array every tick; without a
   * material-transition filter one provider tick fans out into up to 100
   * runtime events (event-log writes, queue pressure, client reducer work)
   * even when nothing changed for most members.
   */
  readonly workflowMemberFingerprints: Map<string, string>;
  /** Task ids that have started and not yet reached a terminal state. */
  readonly liveTaskIds: Set<string>;
  turnState: ClaudeTurnState | undefined;
  /**
   * The window the catalog gives for the model this session runs — the
   * 200k/1m choice that decides the model id itself. Undefined only when the
   * catalog cannot say, and then the SDK's own report stands in.
   */
  selectedContextWindow: number | undefined;
  readonly autoCompactWindow: number | undefined;
  lastKnownContextWindow: number | undefined;
  lastKnownTokenUsage: ThreadTokenUsageSnapshot | undefined;
  lastKnownTotalProcessedTokens: number | undefined;
  lastAssistantUuid: string | undefined;
  lastThreadStartedId: string | undefined;
  /** Limits already announced for the running turn, keyed `window:resetsAt`. */
  announcedUsageLimits: { turnId: string; keys: Set<string> } | undefined;
  /** When the closed usage window last reported reopens, if credibly known (epoch ms). */
  usageLimitBlockedUntilMs?: number | undefined;
  /** A background wake the closed window held; its result is still to arrive. */
  heldLimitWake?: boolean | undefined;
  /** Resolved by completeTurn while Stop waits for Claude to abort the turn. */
  interruptedTurnSettled: Deferred.Deferred<void> | undefined;
  startFailure: string | undefined;
  endWords: string | undefined;
  stopped: boolean;
}

export interface ClaudeQueryRuntime extends AsyncIterable<SDKMessage>, ClaudeMcpQuery {
  /** SDK Query.interrupt — present on real queries; optional for test doubles. */
  readonly interrupt?: () => Promise<unknown>;
  readonly setModel: (model?: string) => Promise<void>;
  readonly setPermissionMode: (mode: PermissionMode) => Promise<void>;
  readonly setMaxThinkingTokens: (maxThinkingTokens: number | null) => Promise<void>;
  readonly applyFlagSettings: ClaudeSdkQuery["applyFlagSettings"];
  readonly usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: ClaudeSdkQuery["usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET"];
  /** SDK Query.supportedCommands — present on real queries; optional for test doubles. */
  readonly supportedCommands?: ClaudeSdkQuery["supportedCommands"];
  readonly close: () => void;
}

export function asRuntimeItemId(value: string): RuntimeItemId {
  return RuntimeItemId.make(value);
}

export function asCanonicalTurnId(value: TurnId): TurnId {
  return value;
}

export function asRuntimeRequestId(value: ApprovalRequestId): RuntimeRequestId {
  return RuntimeRequestId.make(value);
}

export type PlanStep = {
  step: string;
  status: "pending" | "inProgress" | "completed";
};

/**
 * A tool block in flight, by the response it streams in: block indexes count
 * per response, and a helper's response (`parent_tool_use_id`) streams beside
 * its parent's, so an index alone would let a helper's call take the place of
 * the parent's call at the same index, and one result would never close its call.
 */
export function inFlightToolKey(parentToolUseId: string | null | undefined, index: number): string {
  return `${parentToolUseId ?? ""}#${index}`;
}

export function nativeProviderRefs(
  _context: ClaudeSessionContext,
  options?: {
    readonly providerItemId?: string | undefined;
  },
): NonNullable<ProviderRuntimeEvent["providerRefs"]> {
  if (options?.providerItemId) {
    return {
      providerItemId: ProviderItemId.make(options.providerItemId),
    };
  }
  return {};
}

/** What every part of one Claude adapter shares: its clock, its ids and the door to its event queue. */
export interface ClaudeAdapterKit {
  readonly nowIso: Effect.Effect<string>;
  readonly randomUUIDv4: Effect.Effect<string, ProviderAdapterRequestError>;
  readonly makeEventStamp: () => Effect.Effect<
    { eventId: EventId; createdAt: string },
    ProviderAdapterRequestError
  >;
  readonly offerRuntimeEvent: (event: ProviderRuntimeEvent) => Effect.Effect<void>;
}
