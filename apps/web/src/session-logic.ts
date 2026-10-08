import { usageLimitProvider } from "./zerops/providerLimit.logic";
import {
  requestKindFromRequestType,
  type PendingApproval,
} from "@t3tools/client-runtime/pending-requests";
import * as Option from "effect/Option";
import * as Arr from "effect/Array";
import * as Schema from "effect/Schema";
import { shallow } from "zustand/vanilla/shallow";
import { isBackgroundTaskActivity } from "@t3tools/client-runtime/state/subagentRuntime";
import { spilledResultIdIn } from "./components/chat/spilledOutput.logic";
import { sameValue } from "./lib/sameValue";
import {
  commandDetailRepeatsCommand,
  extractCommandOutputText,
} from "@t3tools/client-runtime/work-log/presentation";
import {
  CREW_SEAM_ACTIVITY_KIND,
  MateInterruption,
  CrewSeam,
  isToolLifecycleItemType,
  type AssetResource,
  type OrchestrationLatestTurn,
  type OrchestrationThreadActivity,
  type OrchestrationProposedPlanId,
  ProviderDriverKind,
  type ToolLifecycleItemType,
  type ThreadId,
  type TurnId,
  UserInputAttachmentAnswerPayload,
  type ToolPresentation,
} from "@t3tools/contracts";
import { isLatestTurnSettled } from "@t3tools/shared/orchestrationTiming";
import { skillInvocation } from "@t3tools/shared/toolActivity";

import { humanizeToolName, TIMELINE_HIDDEN_TOOL_NAMES } from "@t3tools/client-runtime/zerops/model";
import type {
  ZeropsCall,
  ZeropsCallStatus,
  ZeropsOperation,
  ZeropsTimelineEntry,
} from "@t3tools/client-runtime/zerops/model";
import type { ChangeLandedEvent } from "@t3tools/client-runtime/zerops";

import {
  isImageAttachment,
  type ChatAttachment,
  type ChatMessage,
  type ProposedPlan,
  type SessionPhase,
  type Thread,
  type ThreadSession,
  type TurnDiffSummary,
} from "./types";

export type { PendingApproval, PendingUserInput } from "@t3tools/client-runtime/pending-requests";

export { formatDuration } from "@t3tools/shared/orchestrationTiming";

export type ProviderPickerKind = ProviderDriverKind;

export const PROVIDER_OPTIONS: Array<{
  value: ProviderPickerKind;
  label: string;
  available: boolean;
  /** Shown on the model picker sidebar when relevant */
  pickerSidebarBadge?: "new" | "soon";
}> = [
  { value: ProviderDriverKind.make("codex"), label: "Codex", available: true },
  { value: ProviderDriverKind.make("claudeAgent"), label: "Claude", available: true },
  {
    value: ProviderDriverKind.make("opencode"),
    label: "OpenCode",
    available: true,
    pickerSidebarBadge: "new",
  },
  {
    value: ProviderDriverKind.make("cursor"),
    label: "Cursor",
    available: true,
    pickerSidebarBadge: "new",
  },
  {
    value: ProviderDriverKind.make("grok"),
    label: "Grok",
    available: true,
    pickerSidebarBadge: "new",
  },
  {
    value: ProviderDriverKind.make("antigravity"),
    label: "Antigravity",
    available: true,
    pickerSidebarBadge: "new",
  },
];

export type WorkLogToolLifecycleStatus =
  | "inProgress"
  | "completed"
  | "failed"
  | "declined"
  | "stopped";

/** A question the Mate asked with its question tool, as it asked it. */
export interface InputQuestion {
  readonly id: string;
  readonly header: string;
  readonly question: string;
}

/** The person's answer to one of the Mate's questions, keyed as the tool keys it. */
export interface InputAnswer {
  readonly key: string;
  readonly answer: string;
}

/** A call's own words and target: see `WorkLogEntry.callInput`. */
export interface WorkCallInput {
  readonly description?: string;
  readonly filePath?: string;
  readonly path?: string;
  readonly pattern?: string;
  readonly glob?: string;
  readonly url?: string;
  readonly query?: string;
  /** The skill a skill call loads, whichever agent's (`skillInvocation`). */
  readonly skill?: string;
}

const CALL_INPUT_KEYS: ReadonlyArray<readonly [string, keyof WorkCallInput]> = [
  ["description", "description"],
  ["file_path", "filePath"],
  ["path", "path"],
  ["pattern", "pattern"],
  ["glob", "glob"],
  ["url", "url"],
  ["query", "query"],
];

/** A call's presentation as the server carries it (`ToolPresentation`): its title, its source. */
function readToolPresentation(value: unknown): ToolPresentation | undefined {
  const record = asRecord(value);
  if (record === null) return undefined;
  const title = asTrimmedString(record.title);
  const source = asRecord(record.source);
  const key = asTrimmedString(source?.key);
  const name = asTrimmedString(source?.name);
  const iconUrl = asTrimmedString(source?.iconUrl);
  const iconUrlDark = asTrimmedString(source?.iconUrlDark);
  if (title === null && (key === null || name === null)) return undefined;
  return {
    ...(title !== null ? { title } : {}),
    ...(key !== null && name !== null
      ? {
          source: {
            key,
            name,
            ...(iconUrl !== null ? { iconUrl } : {}),
            ...(iconUrlDark !== null ? { iconUrlDark } : {}),
          },
        }
      : {}),
  };
}

function readCallInput(input: Record<string, unknown> | null): WorkCallInput | undefined {
  if (input === null) return undefined;
  const read: { -readonly [Key in keyof WorkCallInput]: string } = {};
  for (const [wire, key] of CALL_INPUT_KEYS) {
    const value = asTrimmedString(input[wire]);
    if (value !== null) read[key] = value;
  }
  return Object.keys(read).length > 0 ? read : undefined;
}

export interface WorkLogEntry {
  interruption?: MateInterruption;
  /**
   * `runtime.error`: how the server says its turn ended — its agent died
   * (`crash`), it failed (`failed`), or the usage limit refused it
   * (`usage-limit`, a pause). Typed by the server: never read off the words.
   */
  turnEnd?: "crash" | "failed" | "usage-limit";
  /** A real provider refusal, retaining its supplied deadline independently of the warning copy. */
  usageLimit?: { readonly resetsAt: string | null };
  questionAnswer?: UserInputAttachmentAnswerPayload;
  /** `user-input.requested`/`.resolved`: which request the entry belongs to. */
  inputRequestId?: string;
  /** `user-input.requested`: what the Mate asked. */
  inputQuestions?: ReadonlyArray<InputQuestion>;
  /** `user-input.resolved`: what the person answered. */
  inputAnswers?: ReadonlyArray<InputAnswer>;
  id: string;
  createdAt: string;
  /**
   * The server-stamped time this entry's call started (its `tool.started`,
   * else its earliest lifecycle activity's own `createdAt`), preserved across
   * every later merge, like `id` and `createdAt` (see `deriveWorkLogEntries`,
   * `mergeDerivedWorkLogEntries`).
   */
  startedAt?: string;
  /**
   * The latest lifecycle activity's own `createdAt`, set on every merge and
   * on a row anchored at its `tool.started` — unlike `createdAt`, which stays
   * pinned to the anchor. Absent on an entry that is its own only activity.
   */
  updatedAt?: string;
  /**
   * The model response its call was written in, as its start named it: the
   * calls of one response are one batch (`@t3tools/shared/liveBatch`).
   * Absent where the provider names none.
   */
  responseId?: string;
  /** How its call presents itself, as its agent said: an MCP tool's title and server. */
  toolPresentation?: ToolPresentation;
  turnId?: TurnId | null;
  /** Stable provider identity across in-progress and completed lifecycle updates. */
  toolCallId?: string;
  label: string;
  detail?: string;
  viewedImagePath?: string;
  viewedImageName?: string;
  viewedImageDimensions?: { readonly width: number; readonly height: number };
  command?: string;
  rawCommand?: string;
  changedFiles?: ReadonlyArray<string>;
  tone: "thinking" | "tool" | "info" | "error";
  toolTitle?: string;
  /**
   * The tool the call ran, as the server names it for every driver
   * (`ActivityPayloadProjection.ts`, `data.toolName`): Claude's own
   * (`Read`, `mcp__zerops__zerops_deploy`), OpenCode's (`read`, `grep`), an
   * ACP agent's kind (`read`, `search`, `execute`) or the MCP tool its title
   * named. `namedToolCall` reads it in Claude's words.
   */
  toolName?: string;
  toolData?: unknown;
  /**
   * The tool call's own arguments, when the driver reported them as a flat
   * `data.input` record rather than the Codex-shaped `data.item` `toolData`
   * captures below — Claude's `mcp_tool_call` projection (`ActivityPayloadProjection.ts`
   * `projectMcpToolCallData`: `data = {toolName, input, result}`, no `item`).
   * Read this before falling back to `toolData` for a call's arguments.
   */
  toolInput?: Record<string, unknown>;
  /**
   * What a call said of itself and named as its target, from the input the
   * server passes on (`data.input`): Claude Code's one-line description of a
   * command ("Screenshot the home page at laptop width"), the file, pattern,
   * address or query a tool names.
   */
  callInput?: WorkCallInput;
  /**
   * The call's payload shows what it wrote (`data.wrote`): its row opens onto
   * it, asked of the server (`threads.fileWrites`), which keeps the text.
   */
  wroteFile?: boolean;
  /** A task's: the tool call it tracks — Claude Code tracks a long command as a task. */
  taskToolUseId?: string;
  /**
   * A command's: the id of the job it sent to the background, as its own
   * output says ("Command running in background with ID: …") — known before
   * the task that tracks it reaches the log, which is only once it ends.
   */
  sentToBackground?: string;
  /**
   * A call's: the file its output was saved to, too long to hand back whole,
   * by the id a read of it names (`…/tool-results/<id>.txt`), as its own
   * output says.
   */
  spilledTo?: string;
  /** A task's kind, as the runtime names it ("local_bash", "local_agent", …). */
  taskType?: string;
  /** A task's: it ended unreported, its session gone (an engine Mate says so: `status: "lost"`). */
  taskLost?: boolean;
  itemType?: ToolLifecycleItemType;
  requestKind?: PendingApproval["requestKind"];
  /** From runtime item / task payload `status` when present (e.g. tool.updated). */
  toolLifecycleStatus?: WorkLogToolLifecycleStatus;
  /** Originating orchestration activity kind (e.g. `user-input.requested`) for row chrome. */
  sourceActivityKind?: OrchestrationThreadActivity["kind"];
  /** A crew seam (`crew.seam`): a line across a crewmate's chat, `label` its words. */
  crewSeam?: CrewSeam;
  /** Grouping key for subagent lifecycle rows (one row per agent). */
  taskId?: string;
  /** Agent role (subagent_type) for labeled timeline rows. */
  agentRole?: string;
  /**
   * Present on agent-spawn rows: one per workflow run or per-turn batch of
   * direct spawns. The row ("Kicked off N subagents") derives its live
   * status and member list from the agent panel model at render time.
   */
  agentSpawn?: {
    /** Workflow coordinator taskId, or null for a direct-spawn batch. */
    workflowId: string | null;
    agentTaskIds: ReadonlyArray<string>;
  };
}

const workLogCollapseKey = Symbol();

interface DerivedWorkLogEntry extends WorkLogEntry {
  sourceActivityKind: OrchestrationThreadActivity["kind"];
  [workLogCollapseKey]?: string;
  toolCallId?: string;
  isWorkflowCoordinator?: boolean;
  /** Shell/monitor/plan tasks: ordinary work-log rows, never spawn CTAs. */
  isBackgroundTask?: boolean;
}

const isCrewSeam = Schema.is(CrewSeam);

const derivedWorkLogEntryByActivity = new WeakMap<
  OrchestrationThreadActivity,
  DerivedWorkLogEntry
>();

export interface ActivePlanState {
  createdAt: string;
  turnId: TurnId | null;
  explanation?: string | null;
  steps: Array<{
    durationMs?: number;
    step: string;
    status: "pending" | "inProgress" | "completed";
  }>;
}

export interface LatestProposedPlanState {
  id: OrchestrationProposedPlanId;
  createdAt: string;
  updatedAt: string;
  turnId: TurnId | null;
  planMarkdown: string;
  implementedAt: string | null;
  implementationThreadId: ThreadId | null;
}

export type TimelineEntry =
  | {
      id: string;
      kind: "message";
      createdAt: string;
      message: ChatMessage;
    }
  | {
      id: string;
      kind: "proposed-plan";
      createdAt: string;
      proposedPlan: ProposedPlan;
    }
  | {
      id: string;
      kind: "turn-plan";
      createdAt: string;
      turnPlan: TurnPlanEntry;
    }
  | {
      id: string;
      kind: "work";
      createdAt: string;
      entry: WorkLogEntry;
    }
  | {
      id: string;
      kind: "operation";
      createdAt: string;
      operation: ZeropsOperation;
    }
  | {
      id: string;
      kind: "generic-call";
      createdAt: string;
      entry: WorkLogEntry;
    }
  | {
      id: string;
      /**
       * One of this Mate's changes landing, placed at the moment it landed.
       *
       * Not projected from an activity, because nothing the agent did caused
       * it: a person merged, or HQ's Core did, and the conversation is where
       * the person reads the work in order.
       */
      kind: "change-landed";
      createdAt: string;
      event: ChangeLandedEvent;
    };

export function workLogEntryIsToolLike(entry: WorkLogEntry): boolean {
  if (entry.tone === "tool" || entry.tone === "thinking" || entry.tone === "error") {
    return true;
  }
  if (entry.command !== undefined && entry.command.trim().length > 0) {
    return true;
  }
  if (entry.requestKind !== undefined) {
    return true;
  }
  return entry.itemType !== undefined && isToolLifecycleItemType(entry.itemType);
}

/** Heuristic: providers often emit successful lifecycle status while error text lives in `detail` / `command`. */
function toolDetailTextLooksLikeFailure(text: string): boolean {
  const t = text.toLowerCase();
  if (t.includes("file not found")) {
    return true;
  }
  if (t.includes("no files found")) {
    return true;
  }
  if (
    t.includes("enoent") ||
    t.includes("no such file or directory") ||
    t.includes("no such file")
  ) {
    return true;
  }
  if (t.includes("cannot find path") && t.includes("because it does not exist")) {
    return true;
  }
  if (t.includes("commandnotfoundexception")) {
    return true;
  }
  if (t.includes("is not recognized as the name of a cmdlet")) {
    return true;
  }
  if (t.includes("is not recognized") && t.includes("the term '")) {
    return true;
  }
  if (t.includes("a parameter cannot be found that matches parameter name")) {
    return true;
  }
  if (t.includes("command not found")) {
    return true;
  }
  if (/<exited with exit code\s+[1-9]\d*\s*>/i.test(text)) {
    return true;
  }
  if (/exit(?:ed)? with exit code\s+[1-9]\d*/i.test(text)) {
    return true;
  }
  if (/exit code\s*[:\s]\s*[1-9]\d*\b/i.test(text)) {
    return true;
  }
  return false;
}

// A work-log entry never changes once derived (`derivedWorkLogEntryByActivity`
// keeps each one for its activity): what its output says is read once. The
// timeline asks on every streamed update, of every call of the conversation.
const toolFailureByEntry = new WeakMap<WorkLogEntry, boolean>();
const displayedToolFailureByEntry = new WeakMap<WorkLogEntry, boolean>();

function workEntryIndicatesToolFailureFromOutput(
  entry: WorkLogEntry,
  includeCommand: boolean,
): boolean {
  const known = includeCommand ? toolFailureByEntry : displayedToolFailureByEntry;
  const read = known.get(entry);
  if (read !== undefined) return read;
  const failed = readToolFailureFromOutput(entry, includeCommand);
  known.set(entry, failed);
  return failed;
}

function readToolFailureFromOutput(entry: WorkLogEntry, includeCommand: boolean): boolean {
  if (entry.tone === "error") {
    return true;
  }
  const ls = entry.toolLifecycleStatus;
  if (ls === "failed" || ls === "declined") {
    return true;
  }
  if (!workLogEntryIsToolLike(entry)) {
    return false;
  }
  const parts: string[] = [];
  if (entry.detail) {
    parts.push(entry.detail);
  }
  if (includeCommand && entry.command) {
    parts.push(entry.command);
  }
  const blob = parts.join("\n");
  if (blob.length === 0) {
    return false;
  }
  return toolDetailTextLooksLikeFailure(blob);
}

/** True when a tool failed, including providers that put error output in `command`. */
export function workEntryIndicatesToolFailure(entry: WorkLogEntry): boolean {
  return workEntryIndicatesToolFailureFromOutput(entry, true);
}

/** True when the rendered result indicates failure. The command itself is user intent, not output. */
export function workEntryDisplayIndicatesToolFailure(entry: WorkLogEntry): boolean {
  return workEntryIndicatesToolFailureFromOutput(entry, false);
}

/** Severe failures keep the red treatment ordinary tool failures lost: runtime
 *  errors and orchestration `*.failed` activities (provider.turn.start.failed,
 *  checkpoint.capture.failed, ...) mean the turn or a core side effect broke,
 *  not that a command exited nonzero. */
export function workEntrySignalsSevereFailure(entry: WorkLogEntry): boolean {
  return (
    entry.sourceActivityKind === "runtime.error" ||
    entry.sourceActivityKind?.endsWith(".failed") === true
  );
}

/** Tool/command row completed without failure (blue check affordance). */
export function workEntryIndicatesToolSuccess(entry: WorkLogEntry): boolean {
  if (!workLogEntryIsToolLike(entry)) {
    return false;
  }
  if (workEntryIndicatesToolFailure(entry)) {
    return false;
  }
  if (entry.tone === "thinking") {
    return false;
  }
  const ls = entry.toolLifecycleStatus;
  if (ls === "failed" || ls === "declined") {
    return false;
  }
  if (ls === "inProgress") {
    return false;
  }
  if (ls === "stopped") {
    return false;
  }
  return true;
}

/** Tool-like row with neither clear success nor failure (empty, incomplete, in progress, etc.). */
export function workEntryIndicatesToolNeutralStatus(entry: WorkLogEntry): boolean {
  // Spawn CTA rows are never neutral-hidden: mid-run they derive from
  // task.progress (tone "thinking") and the neutral filter was swallowing
  // them exactly while the fleet ran — the one moment they matter most.
  if (entry.agentSpawn !== undefined) {
    return false;
  }
  if (!workLogEntryIsToolLike(entry)) {
    return false;
  }
  if (workEntryIndicatesToolFailure(entry)) {
    return false;
  }
  if (workEntryIndicatesToolSuccess(entry)) {
    return false;
  }
  return true;
}

type LatestTurnTiming = Pick<OrchestrationLatestTurn, "turnId" | "startedAt" | "completedAt">;
type SessionActivityState = Pick<NonNullable<Thread["session"]>, "status" | "activeTurnId">;

export function deriveActiveWorkStartedAt(
  latestTurn: LatestTurnTiming | null,
  session: SessionActivityState | null,
  sendStartedAt: string | null,
  latestUserMessageAt: string | null = null,
): string | null {
  const runningTurnId = session?.status === "running" ? session.activeTurnId : null;
  if (runningTurnId !== null) {
    if (latestTurn?.turnId === runningTurnId) {
      return latestTurn.startedAt ?? sendStartedAt ?? latestUserMessageAt;
    }
    return sendStartedAt ?? latestUserMessageAt;
  }
  if (!isLatestTurnSettled(latestTurn, session)) {
    return latestTurn?.startedAt ?? sendStartedAt;
  }
  return sendStartedAt;
}

function planStateFromActivity(activity: OrchestrationThreadActivity): ActivePlanState | null {
  const payload =
    activity.payload && typeof activity.payload === "object"
      ? (activity.payload as Record<string, unknown>)
      : null;
  const rawPlan = payload?.plan;
  if (!Array.isArray(rawPlan)) {
    return null;
  }
  const steps: Array<{
    step: string;
    status: "pending" | "inProgress" | "completed";
  }> = [];
  for (const entry of rawPlan) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const record = entry as Record<string, unknown>;
    if (typeof record.step !== "string") {
      continue;
    }
    const status =
      record.status === "completed" || record.status === "inProgress" ? record.status : "pending";
    steps.push({
      step: record.step,
      status,
    });
  }
  if (steps.length === 0) {
    return null;
  }
  return {
    createdAt: activity.createdAt,
    turnId: activity.turnId,
    ...(payload && "explanation" in payload
      ? { explanation: payload.explanation as string | null }
      : {}),
    steps,
  };
}

function addPlanStepDurations(
  plan: ActivePlanState,
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): ActivePlanState {
  const timings = new Map<string, { completedAt?: number; startedAt?: number }>();
  let planStartedAt: number | undefined;

  const keyedSteps = (steps: ActivePlanState["steps"]) => {
    const occurrences = new Map<string, number>();
    return steps.map((step) => {
      const occurrence = occurrences.get(step.step) ?? 0;
      occurrences.set(step.step, occurrence + 1);
      return { key: `${step.step}:${occurrence}`, step };
    });
  };

  for (const activity of activities) {
    const snapshot = planStateFromActivity(activity);
    const activityAt = Date.parse(activity.createdAt);
    if (!snapshot || Number.isNaN(activityAt)) continue;
    planStartedAt ??= activityAt;

    for (const { key, step } of keyedSteps(snapshot.steps)) {
      const timing = timings.get(key) ?? {};
      if (step.status === "inProgress" && timing.startedAt === undefined) {
        timing.startedAt = activityAt;
      }
      if (step.status === "completed" && timing.completedAt === undefined) {
        timing.completedAt = activityAt;
      }
      timings.set(key, timing);
    }
  }

  const durationByKey = new Map<string, number>();
  let previousCompletedAt = planStartedAt;
  for (const [key, timing] of [...timings.entries()].toSorted(
    (left, right) => (left[1].completedAt ?? Infinity) - (right[1].completedAt ?? Infinity),
  )) {
    const completedAt = timing.completedAt;
    const startedAt = timing.startedAt ?? previousCompletedAt;
    if (completedAt === undefined) continue;
    if (startedAt !== undefined && completedAt > startedAt) {
      durationByKey.set(key, completedAt - startedAt);
    }
    previousCompletedAt = completedAt;
  }

  return {
    ...plan,
    steps: keyedSteps(plan.steps).map(({ key, step }) => {
      if (step.status !== "completed") return step;
      const durationMs = durationByKey.get(key);
      return durationMs === undefined ? step : { ...step, durationMs };
    }),
  };
}

export function deriveActivePlanState(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  latestTurnId: TurnId | undefined,
): ActivePlanState | null {
  const allPlanActivities = activities
    .filter((activity) => activity.kind === "turn.plan.updated")
    .sort(compareActivitiesByOrder);
  // Prefer plan from the current turn; fall back to the most recent plan from any turn
  // so that TodoWrite tasks persist across follow-up messages.
  const latest = Option.firstSomeOf([
    ...(latestTurnId
      ? Arr.findLast(allPlanActivities, (activity) => activity.turnId === latestTurnId)
      : Option.none()),
    Arr.last(allPlanActivities),
  ]).pipe(Option.getOrNull);
  if (!latest) {
    return null;
  }
  const plan = planStateFromActivity(latest);
  if (!plan) return null;
  const matchingActivities = allPlanActivities.filter(
    (activity) => activity.turnId === latest.turnId,
  );
  const latestClearIndex = matchingActivities.findLastIndex(
    (activity) => planStateFromActivity(activity) === null,
  );
  return addPlanStepDurations(plan, matchingActivities.slice(latestClearIndex + 1));
}

export interface TurnPlanEntry {
  /** Stable per-turn row id (plans rewrite constantly; the row must not churn). */
  id: string;
  /** Anchor timestamp: the turn's FIRST plan activity, so the chip renders where planning began. */
  createdAt: string;
  turnId: TurnId | null;
  plan: ActivePlanState;
}

/**
 * One inline plan chip per turn that produced plan/todo steps: the latest
 * snapshot for the turn, anchored at the first snapshot's timestamp. Turn-less
 * plan activities collapse into a single chip keyed by thread order.
 */
export function deriveTurnPlans(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): TurnPlanEntry[] {
  const ordered = inActivityOrder(activities);
  const byTurn = new Map<
    string,
    { activities: OrchestrationThreadActivity[]; entry: TurnPlanEntry }
  >();
  for (const activity of ordered) {
    if (activity.kind !== "turn.plan.updated") {
      continue;
    }
    const plan = planStateFromActivity(activity);
    const key = activity.turnId ?? "no-turn";
    if (!plan) {
      // A later snapshot with no steps clears the turn's plan; keeping the
      // stale entry would freeze the chip on a withdrawn plan.
      byTurn.delete(key);
      continue;
    }
    const existing = byTurn.get(key);
    if (existing) {
      existing.entry.plan = plan;
      existing.activities.push(activity);
    } else {
      byTurn.set(key, {
        activities: [activity],
        entry: {
          id: `turn-plan:${key}`,
          createdAt: activity.createdAt,
          turnId: activity.turnId,
          plan,
        },
      });
    }
  }
  return [...byTurn.values()].map(({ activities: planActivities, entry }) => {
    // The same snapshots give the same chip, the same object.
    const first = planActivities[0]!;
    const known = turnPlanByFirstActivity.get(first);
    if (
      known !== undefined &&
      known.entry.id === entry.id &&
      known.activities.length === planActivities.length &&
      known.activities.every((activity, index) => activity === planActivities[index])
    ) {
      return known.entry;
    }
    const derived = { ...entry, plan: addPlanStepDurations(entry.plan, planActivities) };
    turnPlanByFirstActivity.set(first, { activities: planActivities, entry: derived });
    return derived;
  });
}

const turnPlanByFirstActivity = new WeakMap<
  OrchestrationThreadActivity,
  {
    readonly activities: ReadonlyArray<OrchestrationThreadActivity>;
    readonly entry: TurnPlanEntry;
  }
>();

/**
 * The activities in thread order: as they nearly always arrive, read once
 * to tell, else sorted. A stable sort leaves an ordered list as it is.
 */
function inActivityOrder(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): ReadonlyArray<OrchestrationThreadActivity> {
  for (let index = 1; index < activities.length; index += 1) {
    if (compareActivitiesByOrder(activities[index - 1]!, activities[index]!) > 0) {
      return activities.toSorted(compareActivitiesByOrder);
    }
  }
  return activities;
}

export function findLatestProposedPlan(
  proposedPlans: ReadonlyArray<ProposedPlan>,
  latestTurnId: TurnId | string | null | undefined,
): LatestProposedPlanState | null {
  if (latestTurnId) {
    const matchingTurnPlan = [...proposedPlans]
      .filter((proposedPlan) => proposedPlan.turnId === latestTurnId)
      .toSorted(
        (left, right) =>
          left.updatedAt.localeCompare(right.updatedAt) || left.id.localeCompare(right.id),
      )
      .at(-1);
    if (matchingTurnPlan) {
      return toLatestProposedPlanState(matchingTurnPlan);
    }
  }

  const latestPlan = [...proposedPlans]
    .toSorted(
      (left, right) =>
        left.updatedAt.localeCompare(right.updatedAt) || left.id.localeCompare(right.id),
    )
    .at(-1);
  if (!latestPlan) {
    return null;
  }

  return toLatestProposedPlanState(latestPlan);
}

export function hasActionableProposedPlan(
  proposedPlan: LatestProposedPlanState | Pick<ProposedPlan, "implementedAt"> | null,
): boolean {
  return proposedPlan !== null && proposedPlan.implementedAt === null;
}

/**
 * Quiet-timeline guarantee: the work log carries the parent's narrative plus
 * at most one row per agent. Everything an agent does internally lives in the
 * Agents surface:
 * - timelineBypass rows (Codex children, workflow members) never render here;
 * - tool rows attributed to an owning agent (payload.agentId) are re-homed;
 * - task.progress ticks collapse into one row per taskId;
 * - task.updated is fold input only (status patches are not narrative).
 * Unattributed rows stay unless a linked agent row replaces their launch;
 * failed launches stay so the only terminal signal cannot disappear.
 */
/** Agent (non-background) task.started rows seed spawn CTA batches. */
function isAgentTaskStartedActivity(activity: OrchestrationThreadActivity): boolean {
  const payload =
    activity.payload && typeof activity.payload === "object"
      ? (activity.payload as Record<string, unknown>)
      : null;
  if (!payload || typeof payload.taskId !== "string") {
    return false;
  }
  return !isBackgroundTaskActivity(payload);
}

function isAgentInternalActivity(activity: OrchestrationThreadActivity): boolean {
  const payload =
    activity.payload && typeof activity.payload === "object"
      ? (activity.payload as Record<string, unknown>)
      : null;
  if (!payload) {
    return false;
  }
  const isTaskRow =
    activity.kind === "task.started" ||
    activity.kind === "task.progress" ||
    activity.kind === "task.updated" ||
    activity.kind === "task.completed";
  // Task rows classify by the server stamp: a subagent's own background
  // shell (agentId + "background") is agent-internal, but a nested AGENT
  // (agentId + "agent") stays visible so its rows can anchor a spawn row
  // (review finding: hiding on agentId alone removed nested agents and
  // their anchors). Bypassed agent lifecycle rows also pass — collapse
  // folds every such row into its batch's single CTA row, which is how
  // Codex children (whose rows are ALL bypassed) get an anchor at the
  // spawn point.
  if (isTaskRow) {
    const ownedByAgent = typeof payload.agentId === "string" && payload.agentId.trim().length > 0;
    if (ownedByAgent || payload.timelineBypass === true) {
      const isAgentTaskRow =
        activity.kind !== "task.updated" &&
        typeof payload.taskId === "string" &&
        !isBackgroundTaskActivity(payload);
      return !isAgentTaskRow;
    }
    return false;
  }
  if (payload.timelineBypass === true) {
    return true;
  }
  // Non-task rows (attributed tool activity) owned by an agent are internal.
  return typeof payload.agentId === "string" && payload.agentId.trim().length > 0;
}

export function deriveWorkLogEntries(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  options?: { readonly exclude?: ReadonlySet<string> },
): WorkLogEntry[] {
  const exclude = options?.exclude;
  const ordered = inActivityOrder(activities);
  // A launch tool and its task lifecycle describe the same run. Only hide
  // launch rows once their tool-use id has an agent row to replace them.
  const agentLaunchToolIds = new Set<string>();
  for (const activity of ordered) {
    if (
      (activity.kind === "task.started" ||
        activity.kind === "task.progress" ||
        activity.kind === "task.completed") &&
      isAgentTaskStartedActivity(activity)
    ) {
      const toolUseId = asTrimmedString(asRecord(activity.payload)?.toolUseId);
      if (toolUseId) agentLaunchToolIds.add(toolUseId);
    }
  }
  const entries: DerivedWorkLogEntry[] = [];
  // A tool row is anchored at its call's `tool.started`, which draws nothing
  // itself: a reload's snapshot keeps the start but drops every update a
  // completion supersedes, so an anchor at the first update would key and
  // place the row differently live and after a reload.
  const startedAnchorByKey = new Map<
    string,
    { activity: OrchestrationThreadActivity; responseId?: string | undefined }
  >();
  for (const activity of ordered) {
    if (exclude?.has(activity.id)) continue;
    if (activity.kind === "tool.started") {
      // A helper's call is the helper's, from its start: drawn from a start
      // that carries its command, it would run in the Mate's list until the
      // helper ended, since its end is filtered out below.
      if (isAgentInternalActivity(activity)) continue;
      const started = toDerivedWorkLogEntry(activity);
      // A command that starts with all it will say — Codex's, whole in its
      // start and silent until it ends — is drawn from its start, and its
      // end merges into it: it is the Mate's step the whole time it runs.
      if (startCarriesCommand(activity)) {
        entries.push(runningFromItsStart(started));
        continue;
      }
      const startedKey = toolLifecycleCollapseMapKey(started);
      if (startedKey !== undefined) {
        startedAnchorByKey.set(startedKey, { activity, responseId: started.responseId });
      }
      continue;
    }
    // Agent task.started rows are CTA seeds: they carry the true spawn turn,
    // which is the batch key (completions of background subagents arrive
    // under later synthetic turns and must not start new batches). They
    // collapse into the batch's single CTA row, never render standalone.
    if (activity.kind === "task.started" && !isAgentTaskStartedActivity(activity)) continue;
    if (activity.kind === "task.updated") continue;
    if (activity.kind === "tool.progress") continue;
    if (activity.kind === "context-window.updated") continue;
    if (activity.summary === "Checkpoint captured") continue;
    if (isNoContentRuntimeWarning(activity)) continue;
    if (isPlanBoundaryToolActivity(activity)) continue;
    if (isAgentInternalActivity(activity)) continue;
    if (isTimelineHiddenToolActivity(activity)) continue;
    const entry = toDerivedWorkLogEntry(activity);
    // Native agent launches get their visible row from task.started. Defer
    // their active tool row so another launch cannot duplicate the batch.
    if (
      activity.kind === "tool.updated" &&
      entry.itemType === "collab_agent_tool_call" &&
      entry.toolLifecycleStatus === "inProgress" &&
      entry.tone !== "error"
    ) {
      const toolName = asRecord(asRecord(activity.payload)?.data)?.toolName;
      if (toolName === "Agent" || toolName === "Task") continue;
    }
    if (
      (activity.kind === "tool.updated" || activity.kind === "tool.completed") &&
      entry.toolCallId &&
      agentLaunchToolIds.has(entry.toolCallId) &&
      entry.tone !== "error" &&
      entry.toolLifecycleStatus !== "failed"
    ) {
      continue;
    }
    // The first row of a call takes the anchor; later rows merge into it,
    // which keeps it (`mergeDerivedWorkLogEntries`).
    const lifecycleKey = toolLifecycleCollapseMapKey(entry);
    const anchor = lifecycleKey === undefined ? undefined : startedAnchorByKey.get(lifecycleKey);
    if (lifecycleKey !== undefined) startedAnchorByKey.delete(lifecycleKey);
    entries.push(
      anchor === undefined
        ? entry
        : rememberedPair(anchoredWorkLogEntries, entry, anchor.activity, () => ({
            ...entry,
            id: anchor.activity.id,
            createdAt: anchor.activity.createdAt,
            startedAt: anchor.activity.createdAt,
            updatedAt: entry.createdAt,
            ...(anchor.responseId !== undefined ? { responseId: anchor.responseId } : {}),
          })),
    );
  }
  return collapseDerivedWorkLogEntries(entries);
}

// Every row the work log builds from others — a start drawn running, a row
// anchored at its start, two rows merged — is kept by what it was built
// from, all of which never change: the same activities give the same rows,
// the same objects, so the timeline's entries and everything read off them
// stay the same from one update to the next, the new or changed rows aside.
const runningFromStart = new WeakMap<DerivedWorkLogEntry, DerivedWorkLogEntry>();
const anchoredWorkLogEntries = new WeakMap<
  DerivedWorkLogEntry,
  WeakMap<OrchestrationThreadActivity, DerivedWorkLogEntry>
>();
const mergedWorkLogEntries = new WeakMap<
  DerivedWorkLogEntry,
  WeakMap<DerivedWorkLogEntry, DerivedWorkLogEntry>
>();
const spawnRows = new WeakMap<
  DerivedWorkLogEntry,
  { readonly workflowId: string | null; readonly row: DerivedWorkLogEntry }
>();
const mergedSpawnRows = new WeakMap<
  DerivedWorkLogEntry,
  WeakMap<
    DerivedWorkLogEntry,
    { readonly workflowId: string | null; readonly row: DerivedWorkLogEntry }
  >
>();

function rememberedPair<A extends object, B extends object, R>(
  store: WeakMap<A, WeakMap<B, R>>,
  first: A,
  second: B,
  make: () => R,
): R {
  let bySecond = store.get(first);
  if (bySecond === undefined) {
    bySecond = new WeakMap();
    store.set(first, bySecond);
  }
  const known = bySecond.get(second);
  if (known !== undefined) return known;
  const made = make();
  bySecond.set(second, made);
  return made;
}

function runningFromItsStart(started: DerivedWorkLogEntry): DerivedWorkLogEntry {
  const known = runningFromStart.get(started);
  if (known !== undefined) return known;
  const running: DerivedWorkLogEntry = { ...started, toolLifecycleStatus: "inProgress" };
  runningFromStart.set(started, running);
  return running;
}

function mergedWorkLogEntry(
  previous: DerivedWorkLogEntry,
  next: DerivedWorkLogEntry,
): DerivedWorkLogEntry {
  return rememberedPair(mergedWorkLogEntries, previous, next, () =>
    mergeDerivedWorkLogEntries(previous, next),
  );
}

/**
 * Whether a command's start carries the command itself — in its own fields,
 * never read off its detail, which is all a start whose input is still
 * streaming in has ("Bash: {}").
 */
function startCarriesCommand(activity: OrchestrationThreadActivity): boolean {
  const payload = asRecord(activity.payload);
  if (asTrimmedString(payload?.itemType) !== "command_execution") return false;
  const data = asRecord(payload?.data);
  const item = asRecord(data?.item);
  return [data?.command, item?.command, asRecord(item?.input)?.command].some(
    (value) => formatCommandValue(value) !== null,
  );
}

// Keyed by activity identity, like `derivedWorkLogEntryByActivity` below — a
// repeat `deriveWorkLogEntries` call over the same (unchanged) activities
// must never re-read `activity.payload` for one it already classified.
const isTimelineHiddenToolActivityCache = new WeakMap<OrchestrationThreadActivity, boolean>();

/**
 * `ToolSearch` / `Skill` never become work-log entries at all — classified
 * per-activity, since the transcript's own lifecycle collapse
 * (started/updated/completed) has not happened yet here. Every `zerops_*`
 * activity is excluded upstream of this check (`model.zeropsActivityIds`),
 * so this only ever sees a non-Zerops tool name.
 */
function isTimelineHiddenToolActivity(activity: OrchestrationThreadActivity): boolean {
  const cached = isTimelineHiddenToolActivityCache.get(activity);
  if (cached !== undefined) {
    return cached;
  }
  if (activity.kind !== "tool.updated" && activity.kind !== "tool.completed") {
    isTimelineHiddenToolActivityCache.set(activity, false);
    return false;
  }
  const payload =
    activity.payload && typeof activity.payload === "object"
      ? (activity.payload as Record<string, unknown>)
      : null;
  const data = asRecord(payload?.data);
  const toolName = genericToolNameForHiddenCheck(payload, data);
  const hidden = TIMELINE_HIDDEN_TOOL_NAMES.has(toolName);
  isTimelineHiddenToolActivityCache.set(activity, hidden);
  return hidden;
}

/**
 * `payload.data.toolName` (its `mcp__<server>__` prefix stripped) ?? the tool
 * title, for a non-MCP tool (`ToolSearch`, `Skill`) that carries no
 * `data.toolName` of its own — a name `TIMELINE_HIDDEN_TOOL_NAMES` never
 * contains simply never matches, so an empty string here is always safe.
 */
function genericToolNameForHiddenCheck(
  payload: Record<string, unknown> | null,
  data: Record<string, unknown> | null,
): string {
  const plainToolName = asTrimmedString(data?.toolName);
  if (plainToolName !== null) {
    return plainToolName.replace(/^mcp__[^_]+__/, "");
  }
  return asTrimmedString(payload?.title) ?? "";
}

/** Adapters forward unknown wire-only SDK messages (background_tasks_changed,
 *  commands_changed, ...) as runtime warnings. The suffix comes from
 *  describeUnknownSdkMessage in the Claude adapter; a row with no displayable
 *  text carries nothing a user can act on, so it does not render. */
function isNoContentRuntimeWarning(activity: OrchestrationThreadActivity): boolean {
  return (
    activity.kind === "runtime.warning" &&
    activity.summary.endsWith("(no displayable text content)")
  );
}

function isPlanBoundaryToolActivity(activity: OrchestrationThreadActivity): boolean {
  if (activity.kind !== "tool.updated" && activity.kind !== "tool.completed") {
    return false;
  }

  const payload =
    activity.payload && typeof activity.payload === "object"
      ? (activity.payload as Record<string, unknown>)
      : null;
  return typeof payload?.detail === "string" && payload.detail.startsWith("ExitPlanMode:");
}

function extractWorkLogToolLifecycleStatus(
  payload: Record<string, unknown> | null,
): WorkLogToolLifecycleStatus | undefined {
  if (!payload) {
    return undefined;
  }
  const s = payload.status;
  if (
    s === "inProgress" ||
    s === "completed" ||
    s === "failed" ||
    s === "declined" ||
    s === "stopped"
  ) {
    return s;
  }
  return undefined;
}

const decodeMateInterruption = Schema.decodeUnknownOption(MateInterruption);
const decodeQuestionAttachmentAnswer = Schema.decodeUnknownOption(UserInputAttachmentAnswerPayload);

function toDerivedWorkLogEntry(activity: OrchestrationThreadActivity): DerivedWorkLogEntry {
  const cachedEntry = derivedWorkLogEntryByActivity.get(activity);
  if (cachedEntry) {
    return cachedEntry;
  }
  const payload =
    activity.payload && typeof activity.payload === "object"
      ? (activity.payload as Record<string, unknown>)
      : null;
  const commandPreview = extractToolCommand(payload);
  const changedFiles = extractChangedFiles(payload);
  const title = extractToolTitle(payload);
  const isTaskActivity =
    activity.kind === "task.started" ||
    activity.kind === "task.progress" ||
    activity.kind === "task.completed";
  const taskSummary =
    isTaskActivity && typeof payload?.summary === "string" && payload.summary.length > 0
      ? payload.summary
      : null;
  const taskDetailAsLabel =
    isTaskActivity &&
    !taskSummary &&
    typeof payload?.detail === "string" &&
    payload.detail.length > 0
      ? payload.detail
      : null;
  const taskLabel = taskSummary || taskDetailAsLabel;
  // A provider failure's row reads its first line: a cause printed with its
  // stack (rows written before servers sent one sentence) never shows.
  const isProviderFailure =
    activity.kind.startsWith("provider.") && activity.kind.endsWith(".failed");
  const detail = isProviderFailure
    ? typeof payload?.detail === "string"
      ? payload.detail.split("\n")[0]?.trim() || null
      : null
    : isTaskActivity
      ? !taskDetailAsLabel &&
        payload &&
        typeof payload.detail === "string" &&
        payload.detail.length > 0
        ? stripTrailingExitCode(payload.detail).output
        : null
      : extractToolDetail(payload, title ?? activity.summary);
  const toolCallId = isTaskActivity ? null : extractToolCallId(payload);
  const responseId =
    typeof payload?.responseId === "string" && payload.responseId.trim().length > 0
      ? payload.responseId
      : undefined;
  const toolPresentation = readToolPresentation(payload?.presentation);
  const entry: DerivedWorkLogEntry = {
    id: activity.id,
    createdAt: activity.createdAt,
    startedAt: activity.createdAt,
    ...(responseId !== undefined ? { responseId } : {}),
    ...(toolPresentation !== undefined ? { toolPresentation } : {}),
    turnId: activity.turnId,
    label: taskLabel || activity.summary,
    tone:
      activity.kind === "task.progress"
        ? "thinking"
        : activity.tone === "approval"
          ? "info"
          : activity.tone,
    sourceActivityKind: activity.kind,
  };
  if (activity.kind === "user-input.answer-submitted") {
    const answer = decodeQuestionAttachmentAnswer(payload);
    if (Option.isSome(answer)) entry.questionAnswer = answer.value;
  }
  if (activity.kind === CREW_SEAM_ACTIVITY_KIND && isCrewSeam(activity.payload)) {
    entry.crewSeam = activity.payload;
  }
  if (activity.kind === "user-input.requested" || activity.kind === "user-input.resolved") {
    const requestId = asTrimmedString(payload?.requestId);
    if (requestId) entry.inputRequestId = requestId;
    const questions = readInputQuestions(payload?.questions);
    if (questions.length > 0) entry.inputQuestions = questions;
    const answers = readInputAnswers(payload?.answers);
    if (answers.length > 0) entry.inputAnswers = answers;
  }
  if (activity.kind === "runtime.interrupted") {
    const interruption = decodeMateInterruption(payload?.interruption);
    if (Option.isSome(interruption)) entry.interruption = interruption.value;
  }
  const itemType = extractWorkLogItemType(payload);
  const requestKind = extractWorkLogRequestKind(payload);
  const viewedImagePath = asTrimmedString(asRecord(payload?.data)?.imagePath);
  const turnEnd = activity.kind === "runtime.error" ? payload?.turnEnd : undefined;
  if (turnEnd === "crash" || turnEnd === "failed" || turnEnd === "usage-limit") {
    entry.turnEnd = turnEnd;
  }
  if (detail) {
    entry.detail = detail;
  } else if (activity.kind === "runtime.error" || activity.kind === "runtime.warning") {
    const limit = asRecord(payload?.detail);
    if (
      usageLimitProvider(activity.summary) !== null &&
      limit?.status === "rejected" &&
      limit.overageStatus !== "allowed" &&
      limit.overageStatus !== "allowed_warning" &&
      limit.isUsingOverage !== true &&
      limit.overageInUse !== true
    ) {
      const reset = typeof limit.resetsAt === "number" ? new Date(limit.resetsAt * 1000) : null;
      entry.usageLimit = {
        resetsAt: reset !== null && Number.isFinite(reset.getTime()) ? reset.toISOString() : null,
      };
    }
    const message = asTrimmedString(payload?.message);
    if (
      message &&
      normalizePreviewForComparison(message) !== normalizePreviewForComparison(activity.summary)
    ) {
      entry.detail = message;
    }
  }
  if (viewedImagePath) {
    entry.viewedImagePath = viewedImagePath;
    const imageName = asTrimmedString(asRecord(payload?.data)?.imageName);
    if (imageName) entry.viewedImageName = imageName;
    const dimensions = asRecord(asRecord(payload?.data)?.imageDimensions);
    if (
      typeof dimensions?.width === "number" &&
      dimensions.width > 0 &&
      Number.isFinite(dimensions.width) &&
      typeof dimensions.height === "number" &&
      dimensions.height > 0 &&
      Number.isFinite(dimensions.height)
    )
      entry.viewedImageDimensions = { width: dimensions.width, height: dimensions.height };
  }
  if (commandPreview.command) {
    entry.command = commandPreview.command;
  }
  if (commandPreview.rawCommand) {
    entry.rawCommand = commandPreview.rawCommand;
  }
  if (changedFiles.length > 0) {
    entry.changedFiles = changedFiles;
  }
  if (title) {
    entry.toolTitle = title;
  }
  const data = asRecord(payload?.data);
  if (!isTaskActivity && data?.wrote === true) {
    entry.wroteFile = true;
  }
  const toolName = isTaskActivity ? null : asTrimmedString(data?.toolName);
  if (toolName) {
    entry.toolName = toolName;
  }
  if (itemType === "mcp_tool_call") {
    if (data?.item !== undefined) {
      entry.toolData = data.item;
    } else {
      // Claude's `mcp_tool_call` projection carries no `item` at all — its
      // arguments are the flat `data.input` record instead
      // (`ActivityPayloadProjection.ts` `projectMcpToolCallData`).
      const input = asRecord(data?.input);
      if (input !== null) {
        entry.toolInput = input;
      }
    }
  } else if (!isTaskActivity) {
    const input = asRecord(data?.input);
    const skill = skillInvocation(asTrimmedString(data?.toolName), input)?.name;
    const callInput = readCallInput(input);
    if (callInput !== undefined || skill !== undefined) {
      entry.callInput = { ...callInput, ...(skill !== undefined ? { skill } : {}) };
    }
    const output = asTrimmedString(asRecord(data?.rawOutput)?.content) ?? "";
    const sent = BACKGROUND_NOTICE.exec(output);
    if (sent?.[1] !== undefined) entry.sentToBackground = sent[1];
    const spilled = spilledResultIdIn(output);
    if (spilled !== undefined) entry.spilledTo = spilled;
  }
  if (itemType) {
    entry.itemType = itemType;
  }
  if (requestKind) {
    entry.requestKind = requestKind;
  }
  if (toolCallId) {
    entry.toolCallId = toolCallId;
  }
  let toolLifecycleStatus = extractWorkLogToolLifecycleStatus(payload);
  if (!toolLifecycleStatus && activity.kind === "tool.completed") {
    toolLifecycleStatus = "completed";
  }
  // Its turn's end closed it: the call never returned, so no result.
  if (activity.kind === "tool.completed" && payload?.unreturned === true) {
    toolLifecycleStatus = "inProgress";
  }
  if (toolLifecycleStatus) {
    entry.toolLifecycleStatus = toolLifecycleStatus;
  }
  if (isTaskActivity && typeof payload?.taskId === "string" && payload.taskId.length > 0) {
    entry.taskId = payload.taskId;
  }
  if (activity.kind === "task.completed" && payload?.status === "lost") entry.taskLost = true;
  if (isTaskActivity && typeof payload?.role === "string" && payload.role.length > 0) {
    entry.agentRole = payload.role;
  }
  const taskToolUseId = isTaskActivity ? asTrimmedString(payload?.toolUseId) : null;
  if (taskToolUseId !== null) entry.taskToolUseId = taskToolUseId;
  const taskType = isTaskActivity ? asTrimmedString(payload?.taskType) : null;
  if (taskType !== null) entry.taskType = taskType;
  if (
    isTaskActivity &&
    (payload?.taskType === "local_workflow" ||
      (typeof payload?.workflowName === "string" && payload.workflowName.length > 0))
  ) {
    entry.isWorkflowCoordinator = true;
  }
  if (isTaskActivity && payload && isBackgroundTaskActivity(payload)) {
    entry.isBackgroundTask = true;
  }
  const collapseKey = deriveToolLifecycleCollapseKey(entry);
  if (collapseKey) {
    entry[workLogCollapseKey] = collapseKey;
  }
  derivedWorkLogEntryByActivity.set(activity, entry);
  return entry;
}

/**
 * Spawn-group key for a subagent lifecycle row. Workflow members and their
 * coordinator share the coordinator's group; direct spawns batch per turn.
 * One CTA row per group (A1 design): "Kicked off N subagents".
 */
function agentSpawnGroupKey(entry: DerivedWorkLogEntry): string {
  const taskId = entry.taskId ?? "";
  const workflowSlot = taskId.indexOf(":wf:");
  if (workflowSlot !== -1) {
    return `wf:${taskId.slice(0, workflowSlot)}`;
  }
  if (entry.agentSpawn?.workflowId) {
    return `wf:${entry.agentSpawn.workflowId}`;
  }
  if (entry.isWorkflowCoordinator) {
    return `wf:${taskId}`;
  }
  // No turn id means no batch signal at all: fall back to one group per
  // task. Unrelated turn-less spawns (separate fleets whose rows lost their
  // turn) must not collapse into one immortal "direct:no-turn" CTA
  // accumulating every agent the thread ever ran (review finding). Adapters
  // stamp spawn turns (Codex spawnTurnId; Claude rows ride real turns), so
  // this path is defensive.
  return entry.turnId ? `direct:${entry.turnId}` : `direct:task:${taskId}`;
}

function toolLifecycleCollapseMapKey(entry: DerivedWorkLogEntry): string | undefined {
  if (
    entry.sourceActivityKind !== "tool.started" &&
    entry.sourceActivityKind !== "tool.updated" &&
    entry.sourceActivityKind !== "tool.completed"
  ) {
    return undefined;
  }
  return entry.toolCallId ? `tool:${entry.turnId ?? "no-turn"}:${entry.toolCallId}` : undefined;
}

function collapseDerivedWorkLogEntries(
  entries: ReadonlyArray<DerivedWorkLogEntry>,
): DerivedWorkLogEntry[] {
  const collapsed: DerivedWorkLogEntry[] = [];
  // Subagent rows collapse by spawn group, not adjacency: a workflow run (or
  // a turn's batch of direct spawns) is ONE narrative event in the chat — a
  // spawn row in the timeline — no matter how many agents it
  // contains or how their progress rows interleave (quiet-timeline
  // guarantee).
  const spawnRowIndex = new Map<string, number>();
  // Batch membership is decided once, at the FIRST row seen for a taskId.
  // Claude background subagents settle between turns, so their completion
  // rows carry fresh synthetic turn ids (or none) — keying each row by its
  // own turn splintered one batch into a stream of "Kicked off N subagents"
  // rows (live-test finding, thread 7ac7ef05).
  const groupKeyByTaskId = new Map<string, string>();
  const toolLifecycleRowIndex = new Map<string, number>();
  for (const entry of entries) {
    const isTaskRow =
      entry.taskId !== undefined &&
      !entry.isBackgroundTask &&
      (entry.sourceActivityKind === "task.started" ||
        entry.sourceActivityKind === "task.progress" ||
        entry.sourceActivityKind === "task.completed");
    if (isTaskRow && entry.taskId !== undefined) {
      const rememberedKey = groupKeyByTaskId.get(entry.taskId);
      const groupKey = rememberedKey ?? agentSpawnGroupKey(entry);
      if (rememberedKey === undefined) {
        groupKeyByTaskId.set(entry.taskId, groupKey);
      }
      const workflowId = groupKey.startsWith("wf:") ? groupKey.slice(3) : null;
      const existingIndex = spawnRowIndex.get(groupKey);
      if (existingIndex !== undefined) {
        const existing = collapsed[existingIndex]!;
        const taskId = entry.taskId;
        const bySecond =
          mergedSpawnRows.get(existing) ??
          new WeakMap<
            DerivedWorkLogEntry,
            { readonly workflowId: string | null; readonly row: DerivedWorkLogEntry }
          >();
        mergedSpawnRows.set(existing, bySecond);
        const known = bySecond.get(entry);
        if (known !== undefined && known.workflowId === workflowId) {
          collapsed[existingIndex] = known.row;
          continue;
        }
        const agentTaskIds = existing.agentSpawn?.agentTaskIds.includes(taskId)
          ? existing.agentSpawn.agentTaskIds
          : [...(existing.agentSpawn?.agentTaskIds ?? []), taskId];
        const row: DerivedWorkLogEntry = {
          ...mergeDerivedWorkLogEntries(existing, entry),
          // The CTA row keeps the group's ANCHOR identity, not the last
          // agent's: beyond the id/createdAt every merge pins, turnId stays
          // at the spawn point so the batch never drifts to a completion's
          // synthetic turn.
          turnId: existing.turnId ?? null,
          ...(existing.taskId !== undefined ? { taskId: existing.taskId } : {}),
          label: existing.label,
          agentSpawn: { workflowId, agentTaskIds },
        };
        bySecond.set(entry, { workflowId, row });
        collapsed[existingIndex] = row;
        continue;
      }
      spawnRowIndex.set(groupKey, collapsed.length);
      const known = spawnRows.get(entry);
      if (known !== undefined && known.workflowId === workflowId) {
        collapsed.push(known.row);
        continue;
      }
      const row: DerivedWorkLogEntry = {
        ...entry,
        agentSpawn: { workflowId, agentTaskIds: [entry.taskId] },
      };
      spawnRows.set(entry, { workflowId, row });
      collapsed.push(row);
      continue;
    }
    const lifecycleKey = toolLifecycleCollapseMapKey(entry);
    if (lifecycleKey !== undefined) {
      const matchingLifecycleIndex = toolLifecycleRowIndex.get(lifecycleKey);
      const matchingEntry =
        matchingLifecycleIndex === undefined ? undefined : collapsed[matchingLifecycleIndex];
      if (
        matchingLifecycleIndex !== undefined &&
        matchingEntry &&
        shouldCollapseToolLifecycleEntries(matchingEntry, entry)
      ) {
        collapsed[matchingLifecycleIndex] = mergedWorkLogEntry(matchingEntry, entry);
        continue;
      }
      toolLifecycleRowIndex.delete(lifecycleKey);
    }
    const previous = collapsed.at(-1);
    if (previous && shouldCollapseToolLifecycleEntries(previous, entry)) {
      const previousIndex = collapsed.length - 1;
      const previousKey = toolLifecycleCollapseMapKey(previous);
      if (previousKey !== undefined) toolLifecycleRowIndex.delete(previousKey);
      const merged = mergedWorkLogEntry(previous, entry);
      collapsed[previousIndex] = merged;
      const mergedKey = toolLifecycleCollapseMapKey(merged);
      if (mergedKey !== undefined) toolLifecycleRowIndex.set(mergedKey, previousIndex);
      continue;
    }
    collapsed.push(entry);
    if (lifecycleKey !== undefined) {
      toolLifecycleRowIndex.set(lifecycleKey, collapsed.length - 1);
    }
  }
  return collapsed;
}

function shouldCollapseToolLifecycleEntries(
  previous: DerivedWorkLogEntry,
  next: DerivedWorkLogEntry,
): boolean {
  if (
    previous.sourceActivityKind !== "tool.started" &&
    previous.sourceActivityKind !== "tool.updated" &&
    previous.sourceActivityKind !== "tool.completed"
  ) {
    return false;
  }
  if (next.sourceActivityKind !== "tool.updated" && next.sourceActivityKind !== "tool.completed") {
    return false;
  }
  if (previous.turnId !== next.turnId) {
    return false;
  }
  if (previous.sourceActivityKind === "tool.completed") {
    return false;
  }
  if (
    previous[workLogCollapseKey] !== undefined &&
    previous[workLogCollapseKey] === next[workLogCollapseKey]
  ) {
    return true;
  }
  return (
    previous.toolCallId !== undefined &&
    next.toolCallId === undefined &&
    previous.itemType === next.itemType &&
    normalizeCompactToolLabel(previous.toolTitle ?? previous.label) ===
      normalizeCompactToolLabel(next.toolTitle ?? next.label)
  );
}

/** Claude Code's word that a command went to the background, and the job's id. */
const BACKGROUND_NOTICE = /running in (?:the )?background with ID:\s*([\w-]+)/iu;

function mergeDerivedWorkLogEntries(
  previous: DerivedWorkLogEntry,
  next: DerivedWorkLogEntry,
): DerivedWorkLogEntry {
  const changedFiles = mergeChangedFiles(previous.changedFiles, next.changedFiles);
  const detail = next.detail ?? previous.detail;
  const viewedImagePath = next.viewedImagePath ?? previous.viewedImagePath;
  const viewedImageDimensions = next.viewedImageDimensions ?? previous.viewedImageDimensions;
  const viewedImageName = next.viewedImageName ?? previous.viewedImageName;
  const command = next.command ?? previous.command;
  const rawCommand = next.rawCommand ?? previous.rawCommand;
  const toolTitle = next.toolTitle ?? previous.toolTitle;
  const toolName = next.toolName ?? previous.toolName;
  const itemType = next.itemType ?? previous.itemType;
  const requestKind = next.requestKind ?? previous.requestKind;
  const collapseKey = next[workLogCollapseKey] ?? previous[workLogCollapseKey];
  const toolCallId = next.toolCallId ?? previous.toolCallId;
  const toolLifecycleStatus = next.toolLifecycleStatus ?? previous.toolLifecycleStatus;
  const toolData = next.toolData ?? previous.toolData;
  const toolInput = next.toolInput ?? previous.toolInput;
  const callInput = next.callInput ?? previous.callInput;
  const wroteFile = next.wroteFile === true || previous.wroteFile === true;
  const startedAt = previous.startedAt ?? previous.createdAt;
  const responseId = previous.responseId ?? next.responseId;
  return {
    ...previous,
    ...next,
    // The row is anchored at first sight: its key and timeline position stay
    // those of the first merged activity from start to completion, while the
    // content (status, label, detail, result) comes from the latest one.
    id: previous.id,
    createdAt: previous.createdAt,
    startedAt,
    updatedAt: next.createdAt,
    ...(detail ? { detail } : {}),
    ...(viewedImagePath ? { viewedImagePath } : {}),
    ...(viewedImageDimensions ? { viewedImageDimensions } : {}),
    ...(viewedImageName ? { viewedImageName } : {}),
    ...(command ? { command } : {}),
    ...(rawCommand ? { rawCommand } : {}),
    ...(changedFiles.length > 0 ? { changedFiles } : {}),
    ...(toolTitle ? { toolTitle } : {}),
    ...(toolName ? { toolName } : {}),
    ...(itemType ? { itemType } : {}),
    ...(requestKind ? { requestKind } : {}),
    ...(collapseKey ? { [workLogCollapseKey]: collapseKey } : {}),
    ...(toolCallId ? { toolCallId } : {}),
    ...(toolLifecycleStatus !== undefined ? { toolLifecycleStatus } : {}),
    ...(toolData !== undefined ? { toolData } : {}),
    ...(toolInput !== undefined ? { toolInput } : {}),
    ...(callInput !== undefined ? { callInput } : {}),
    ...(wroteFile ? { wroteFile } : {}),
    ...(responseId !== undefined ? { responseId } : {}),
  };
}

function mergeChangedFiles(
  previous: ReadonlyArray<string> | undefined,
  next: ReadonlyArray<string> | undefined,
): string[] {
  const merged = [...(previous ?? []), ...(next ?? [])];
  if (merged.length === 0) {
    return [];
  }
  return [...new Set(merged)];
}

function deriveToolLifecycleCollapseKey(entry: DerivedWorkLogEntry): string | undefined {
  // Subagent lifecycle rows collapse by agent identity: one row per agent,
  // progress ticks fold into it, the terminal row wins the label.
  if (
    entry.taskId &&
    (entry.sourceActivityKind === "task.progress" || entry.sourceActivityKind === "task.completed")
  ) {
    return `task${entry.taskId}`;
  }
  if (
    entry.sourceActivityKind !== "tool.started" &&
    entry.sourceActivityKind !== "tool.updated" &&
    entry.sourceActivityKind !== "tool.completed"
  ) {
    return undefined;
  }
  if (entry.toolCallId) {
    return `tool:${entry.turnId ?? "no-turn"}:${entry.toolCallId}`;
  }
  const normalizedLabel = normalizeCompactToolLabel(entry.toolTitle ?? entry.label);
  const detail = entry.detail?.trim() ?? "";
  const itemType = entry.itemType ?? "";
  if (normalizedLabel.length === 0 && detail.length === 0 && itemType.length === 0) {
    return undefined;
  }
  return [itemType, normalizedLabel, detail].join("\u001f");
}

function normalizeCompactToolLabel(value: string): string {
  return value.replace(/\s+(?:complete|completed)\s*$/i, "").trim();
}

function toLatestProposedPlanState(proposedPlan: ProposedPlan): LatestProposedPlanState {
  return {
    id: proposedPlan.id,
    createdAt: proposedPlan.createdAt,
    updatedAt: proposedPlan.updatedAt,
    turnId: proposedPlan.turnId,
    planMarkdown: proposedPlan.planMarkdown,
    implementedAt: proposedPlan.implementedAt,
    implementationThreadId: proposedPlan.implementationThreadId,
  };
}

function readInputQuestions(value: unknown): InputQuestion[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    const record = asRecord(candidate);
    const id = asTrimmedString(record?.id);
    const question = asTrimmedString(record?.question);
    if (!id || !question) return [];
    return [{ id, header: asTrimmedString(record?.header) ?? question, question }];
  });
}

/** An answer as the person gave it: a choice, several choices, or their own words. */
function readInputAnswers(value: unknown): InputAnswer[] {
  const record = asRecord(value);
  if (record === null) return [];
  return Object.entries(record).flatMap(([key, answer]) => {
    const words = Array.isArray(answer)
      ? answer.flatMap((item) => (typeof item === "string" && item.trim() ? [item.trim()] : []))
      : typeof answer === "string" && answer.trim()
        ? [answer.trim()]
        : [];
    return words.length > 0 ? [{ key, answer: words.join(", ") }] : [];
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function trimMatchingOuterQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    const unquoted = trimmed.slice(1, -1).trim();
    return unquoted.length > 0 ? unquoted : trimmed;
  }
  return trimmed;
}

function executableBasename(value: string): string | null {
  const trimmed = trimMatchingOuterQuotes(value);
  if (trimmed.length === 0) {
    return null;
  }
  const normalized = trimmed.replace(/\\/g, "/");
  const segments = normalized.split("/");
  const last = segments.at(-1)?.trim() ?? "";
  return last.length > 0 ? last.toLowerCase() : null;
}

function splitExecutableAndRest(value: string): { executable: string; rest: string } | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
    const quote = trimmed.charAt(0);
    const closeIndex = trimmed.indexOf(quote, 1);
    if (closeIndex <= 0) {
      return null;
    }
    return {
      executable: trimmed.slice(0, closeIndex + 1),
      rest: trimmed.slice(closeIndex + 1).trim(),
    };
  }

  const firstWhitespace = trimmed.search(/\s/);
  if (firstWhitespace < 0) {
    return {
      executable: trimmed,
      rest: "",
    };
  }

  return {
    executable: trimmed.slice(0, firstWhitespace),
    rest: trimmed.slice(firstWhitespace).trim(),
  };
}

const SHELL_WRAPPER_SPECS = [
  {
    executables: ["pwsh", "pwsh.exe", "powershell", "powershell.exe"],
    wrapperFlagPattern: /(?:^|\s)-command\s+/i,
  },
  {
    executables: ["cmd", "cmd.exe"],
    wrapperFlagPattern: /(?:^|\s)\/c\s+/i,
  },
  {
    executables: ["bash", "sh", "zsh"],
    wrapperFlagPattern: /(?:^|\s)-(?:l)?c\s+/i,
  },
] as const;

function findShellWrapperSpec(shell: string) {
  return SHELL_WRAPPER_SPECS.find((spec) =>
    (spec.executables as ReadonlyArray<string>).includes(shell),
  );
}

function unwrapCommandRemainder(value: string, wrapperFlagPattern: RegExp): string | null {
  const match = wrapperFlagPattern.exec(value);
  if (!match) {
    return null;
  }

  const command = value.slice(match.index + match[0].length).trim();
  if (command.length === 0) {
    return null;
  }

  const unwrapped = trimMatchingOuterQuotes(command);
  return unwrapped.length > 0 ? unwrapped : null;
}

function unwrapKnownShellCommandWrapper(value: string): string {
  const split = splitExecutableAndRest(value);
  if (!split || split.rest.length === 0) {
    return value;
  }

  const shell = executableBasename(split.executable);
  if (!shell) {
    return value;
  }

  const spec = findShellWrapperSpec(shell);
  if (!spec) {
    return value;
  }

  return unwrapCommandRemainder(split.rest, spec.wrapperFlagPattern) ?? value;
}

function formatCommandArrayPart(value: string): string {
  return /[\s"'`]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

function formatCommandValue(value: unknown): string | null {
  const direct = asTrimmedString(value);
  if (direct) {
    return direct;
  }
  if (!Array.isArray(value)) {
    return null;
  }
  const parts: Array<string> = [];
  for (const entry of value) {
    const part = asTrimmedString(entry);
    if (part !== null) {
      parts.push(part);
    }
  }
  if (parts.length === 0) {
    return null;
  }
  return parts.map((part) => formatCommandArrayPart(part)).join(" ");
}

function normalizeCommandValue(value: unknown): string | null {
  const formatted = formatCommandValue(value);
  return formatted ? unwrapKnownShellCommandWrapper(formatted) : null;
}

function toRawToolCommand(value: unknown, normalizedCommand: string | null): string | null {
  const formatted = formatCommandValue(value);
  if (!formatted || normalizedCommand === null) {
    return null;
  }
  return formatted === normalizedCommand ? null : formatted;
}

function extractToolCommand(payload: Record<string, unknown> | null): {
  command: string | null;
  rawCommand: string | null;
} {
  const data = asRecord(payload?.data);
  const item = asRecord(data?.item);
  const itemResult = asRecord(item?.result);
  const itemInput = asRecord(item?.input);
  const itemType = asTrimmedString(payload?.itemType);
  const detail = asTrimmedString(payload?.detail);
  const candidates: unknown[] = [
    item?.command,
    itemInput?.command,
    itemResult?.command,
    data?.command,
    itemType === "command_execution" && detail ? stripTrailingExitCode(detail).output : null,
  ];

  for (const candidate of candidates) {
    const command = normalizeCommandValue(candidate);
    if (!command) {
      continue;
    }
    return {
      command,
      rawCommand: toRawToolCommand(candidate, command),
    };
  }

  return {
    command: null,
    rawCommand: null,
  };
}

function extractToolTitle(payload: Record<string, unknown> | null): string | null {
  return asTrimmedString(payload?.title);
}

function extractToolCallId(payload: Record<string, unknown> | null): string | null {
  const data = asRecord(payload?.data);
  return asTrimmedString(payload?.toolCallId) ?? asTrimmedString(data?.toolCallId);
}

function normalizeInlinePreview(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateInlinePreview(value: string, maxLength = 84): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function normalizePreviewForComparison(value: string | null | undefined): string | null {
  const normalized = asTrimmedString(value);
  if (!normalized) {
    return null;
  }
  return normalizeCompactToolLabel(normalizeInlinePreview(normalized)).toLowerCase();
}

function summarizeToolTextOutput(value: string): string | null {
  const lines: Array<string> = [];
  for (const rawLine of value.split(/\r?\n/u)) {
    const line = normalizeInlinePreview(rawLine);
    if (line.length > 0) {
      lines.push(line);
    }
  }
  const firstLine = lines.find((line) => line !== "```");
  if (firstLine) {
    return truncateInlinePreview(firstLine);
  }
  if (lines.length > 1) {
    return `${lines.length.toLocaleString()} lines`;
  }
  return null;
}

function summarizeToolRawOutput(payload: Record<string, unknown> | null): string | null {
  const data = asRecord(payload?.data);
  const rawOutput = asRecord(data?.rawOutput);
  if (!rawOutput) {
    return null;
  }

  const totalFiles = asNumber(rawOutput.totalFiles);
  if (totalFiles !== null) {
    const suffix = rawOutput.truncated === true ? "+" : "";
    return `${totalFiles.toLocaleString()} file${totalFiles === 1 ? "" : "s"}${suffix}`;
  }

  const content = asTrimmedString(rawOutput.content);
  if (content) {
    return summarizeToolTextOutput(content);
  }

  const stdout = asTrimmedString(rawOutput.stdout);
  if (stdout) {
    return summarizeToolTextOutput(stdout);
  }

  return null;
}

function extractToolOutput(payload: Record<string, unknown> | null): string | null {
  const output = extractCommandOutputText(payload?.data);
  return output ? stripTrailingExitCode(output).output : null;
}

function isCommandToolDetail(payload: Record<string, unknown> | null, heading: string): boolean {
  const data = asRecord(payload?.data);
  const kind = asTrimmedString(data?.kind)?.toLowerCase();
  const title = asTrimmedString(payload?.title ?? heading)?.toLowerCase();
  return (
    extractWorkLogItemType(payload) === "command_execution" ||
    kind === "execute" ||
    title === "terminal" ||
    title === "ran command"
  );
}

function extractToolDetail(
  payload: Record<string, unknown> | null,
  heading: string,
): string | null {
  const rawDetail = asTrimmedString(payload?.detail);
  const detail = rawDetail ? stripTrailingExitCode(rawDetail).output : null;
  const normalizedHeading = normalizePreviewForComparison(heading);
  const normalizedDetail = normalizePreviewForComparison(detail);
  const commandTool = isCommandToolDetail(payload, heading);
  const commandPreview = commandTool
    ? extractToolCommand(payload)
    : { command: null, rawCommand: null };
  const command = commandPreview.command;

  if (commandTool && command) {
    const output = extractToolOutput(payload);
    if (output) return output;
  }

  const data = asRecord(payload?.data);
  const repeatsCommand =
    detail !== null &&
    commandDetailRepeatsCommand({
      detail,
      command,
      rawCommand: commandPreview.rawCommand,
      toolName: data?.toolName,
      data,
    });

  if (detail && normalizedHeading !== normalizedDetail && (!commandTool || !repeatsCommand)) {
    return detail;
  }

  if (commandTool) {
    return null;
  }

  const rawOutputSummary = summarizeToolRawOutput(payload);
  if (rawOutputSummary) {
    const normalizedRawOutputSummary = normalizePreviewForComparison(rawOutputSummary);
    if (normalizedRawOutputSummary !== normalizedHeading) {
      return rawOutputSummary;
    }
  }

  return null;
}

function stripTrailingExitCode(value: string): {
  output: string | null;
  exitCode?: number | undefined;
} {
  const trimmed = value.trim();
  const match = /^(?<output>[\s\S]*?)(?:\s*<exited with exit code (?<code>\d+)>)\s*$/i.exec(
    trimmed,
  );
  if (!match?.groups) {
    return {
      output: trimmed.length > 0 ? trimmed : null,
    };
  }
  const exitCode = Number.parseInt(match.groups.code ?? "", 10);
  const normalizedOutput = match.groups.output?.trim() ?? "";
  return {
    output: normalizedOutput.length > 0 ? normalizedOutput : null,
    ...(Number.isInteger(exitCode) ? { exitCode } : {}),
  };
}

function extractWorkLogItemType(
  payload: Record<string, unknown> | null,
): WorkLogEntry["itemType"] | undefined {
  if (typeof payload?.itemType === "string" && isToolLifecycleItemType(payload.itemType)) {
    return payload.itemType;
  }
  return undefined;
}

function extractWorkLogRequestKind(
  payload: Record<string, unknown> | null,
): WorkLogEntry["requestKind"] | undefined {
  if (
    payload?.requestKind === "command" ||
    payload?.requestKind === "file-read" ||
    payload?.requestKind === "file-change" ||
    payload?.requestKind === "permission"
  ) {
    return payload.requestKind;
  }
  return requestKindFromRequestType(payload?.requestType) ?? undefined;
}

function pushChangedFile(target: string[], seen: Set<string>, value: unknown) {
  const normalized = asTrimmedString(value);
  if (!normalized || seen.has(normalized)) {
    return;
  }
  seen.add(normalized);
  target.push(normalized);
}

function collectChangedFiles(value: unknown, target: string[], seen: Set<string>, depth: number) {
  if (depth > 4 || target.length >= 12) {
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectChangedFiles(entry, target, seen, depth + 1);
      if (target.length >= 12) {
        return;
      }
    }
    return;
  }

  const record = asRecord(value);
  if (!record) {
    return;
  }

  pushChangedFile(target, seen, record.path);
  pushChangedFile(target, seen, record.filePath);
  pushChangedFile(target, seen, record.relativePath);
  pushChangedFile(target, seen, record.filename);
  pushChangedFile(target, seen, record.newPath);
  pushChangedFile(target, seen, record.oldPath);

  for (const nestedKey of [
    "item",
    "result",
    "input",
    "data",
    "changes",
    "files",
    "edits",
    "patch",
    "patches",
    "operations",
  ]) {
    if (!(nestedKey in record)) {
      continue;
    }
    collectChangedFiles(record[nestedKey], target, seen, depth + 1);
    if (target.length >= 12) {
      return;
    }
  }
}

function extractChangedFiles(payload: Record<string, unknown> | null): string[] {
  const changedFiles: string[] = [];
  const seen = new Set<string>();
  collectChangedFiles(asRecord(payload?.data), changedFiles, seen, 0);
  return changedFiles;
}

function compareActivitiesByOrder(
  left: OrchestrationThreadActivity,
  right: OrchestrationThreadActivity,
): number {
  if (left.sequence !== undefined && right.sequence !== undefined) {
    if (left.sequence !== right.sequence) {
      return left.sequence - right.sequence;
    }
  } else if (left.sequence !== undefined) {
    return 1;
  } else if (right.sequence !== undefined) {
    return -1;
  }

  const createdAtComparison = left.createdAt.localeCompare(right.createdAt);
  if (createdAtComparison !== 0) {
    return createdAtComparison;
  }

  const lifecycleRankComparison =
    compareActivityLifecycleRank(left.kind) - compareActivityLifecycleRank(right.kind);
  if (lifecycleRankComparison !== 0) {
    return lifecycleRankComparison;
  }

  return left.id.localeCompare(right.id);
}

function compareActivityLifecycleRank(kind: string): number {
  if (kind.endsWith(".started") || kind === "tool.started") {
    return 0;
  }
  if (kind.endsWith(".progress") || kind.endsWith(".updated")) {
    return 1;
  }
  if (kind.endsWith(".completed") || kind.endsWith(".resolved")) {
    return 2;
  }
  return 1;
}

/** `entry.toolInput` (Claude) ?? `entry.toolData.arguments` (Codex) — unused by a synthesized entry, kept for parity with other WorkLogEntry readers. */
function zeropsCallToolLifecycleStatus(status: ZeropsCallStatus): WorkLogToolLifecycleStatus {
  // `WorkLogToolLifecycleStatus` has no "interrupted" value of its own; an
  // orphaned call renders as stopped, the closest honest word the generic
  // tool row already has.
  return status === "interrupted" ? "stopped" : status;
}

/**
 * A Zerops call the model classified `generic` (never a card) renders through
 * the ordinary generic tool block, same as any other tool call — this is the
 * one place that shape is synthesized, so `MessagesTimeline` never has to
 * know a `ZeropsCall` exists.
 */
export function zeropsCallToWorkLogEntry(call: ZeropsCall): WorkLogEntry {
  return {
    id: call.anchorActivityId,
    createdAt: call.startedAt,
    startedAt: call.startedAt,
    ...(call.settledAt !== undefined ? { updatedAt: call.settledAt } : {}),
    ...(call.responseId !== undefined ? { responseId: call.responseId } : {}),
    turnId: (call.turnId as TurnId | null) ?? null,
    toolCallId: call.id,
    label: call.toolName,
    // The row a person reads is named after the tool, not after the wire
    // name: `zerops_dev_server` is "Dev server". `label` keeps the raw name,
    // which is what lifecycle-marker identity is keyed on.
    toolTitle: humanizeToolName(call.toolName),
    tone: "tool",
    itemType: "mcp_tool_call",
    toolInput: call.input,
    toolLifecycleStatus: zeropsCallToolLifecycleStatus(call.status),
    ...(call.resultText !== undefined ? { detail: call.resultText } : {}),
  };
}

// Each timeline entry is kept by what it wraps, which never changes: the same
// message, call or operation is the same entry on every derive, and what the
// conversation reads off it (`deriveMessagesTimelineRows`) is read once.
const timelineEntryBySource = new WeakMap<object, TimelineEntry>();

function rememberedTimelineEntry<S extends object>(
  source: S,
  make: (source: S) => TimelineEntry,
): TimelineEntry {
  const known = timelineEntryBySource.get(source);
  if (known !== undefined) return known;
  const entry = make(source);
  timelineEntryBySource.set(source, entry);
  return entry;
}

function timelineEntryFromMessage(message: ChatMessage): TimelineEntry {
  return rememberedTimelineEntry(message, () => ({
    id: message.id,
    kind: "message",
    createdAt: message.createdAt,
    message,
  }));
}

function timelineEntryFromProposedPlan(proposedPlan: ProposedPlan): TimelineEntry {
  return rememberedTimelineEntry(proposedPlan, () => ({
    id: proposedPlan.id,
    kind: "proposed-plan",
    createdAt: proposedPlan.createdAt,
    proposedPlan,
  }));
}

function timelineEntryFromTurnPlan(turnPlan: TurnPlanEntry): TimelineEntry {
  return rememberedTimelineEntry(turnPlan, () => ({
    id: turnPlan.id,
    kind: "turn-plan",
    createdAt: turnPlan.createdAt,
    turnPlan,
  }));
}

function timelineEntryFromWork(workEntry: WorkLogEntry): TimelineEntry {
  return rememberedTimelineEntry(workEntry, () => ({
    id: workEntry.id,
    kind: "work",
    createdAt: workEntry.createdAt,
    entry: workEntry,
  }));
}

function timelineEntryFromZerops(zeropsEntry: ZeropsTimelineEntry): TimelineEntry {
  return rememberedTimelineEntry(zeropsEntry, (entry) =>
    entry.kind === "operation"
      ? {
          id: `zerops:${entry.key}`,
          kind: "operation",
          createdAt: entry.anchorAt,
          operation: entry.operation,
        }
      : {
          id: `zerops:${entry.key}`,
          kind: "generic-call",
          createdAt: entry.anchorAt,
          entry: zeropsCallToWorkLogEntry(entry.call),
        },
  );
}

function timelineEntryFromChangeLanded(event: ChangeLandedEvent): TimelineEntry {
  return rememberedTimelineEntry(event, () => ({
    id: `zerops:${event.key}`,
    kind: "change-landed",
    createdAt: event.landedAt,
    event,
  }));
}

/**
 * The Zerops entries, each one that holds what it held last time the one
 * from last time: the Zerops model builds them all afresh from the thread's
 * activities on every update, and a fresh entry for an operation nothing
 * happened to read as a change to the whole conversation.
 */
function sameZeropsEntriesAsBefore(
  next: ReadonlyArray<ZeropsTimelineEntry>,
  previous: ReadonlyArray<ZeropsTimelineEntry> | undefined,
): ReadonlyArray<ZeropsTimelineEntry> {
  if (previous === undefined || previous.length === 0 || next === previous) return next;
  const previousByKey = new Map(previous.map((entry) => [entry.key, entry] as const));
  let changed = next.length !== previous.length;
  const kept = next.map((entry, index) => {
    const before = previousByKey.get(entry.key);
    const same = before !== undefined && sameValue(before, entry) ? before : entry;
    if (same !== previous[index]) changed = true;
    return same;
  });
  return changed ? kept : previous;
}

/**
 * The entries sorted, from those of the last projection: the ones it held,
 * in its order, merged with the ones it did not, sorted — what sorting them
 * all gives, without comparing what has not moved. Null where two entries
 * order alike (`compareTimelineEntries` is 0), which only a full sort places
 * as it always has.
 */
function sortedFromPrevious(
  previous: ReadonlyArray<TimelineEntry>,
  next: ReadonlyArray<TimelineEntry>,
): TimelineEntry[] | null {
  const nextSet = new Set(next);
  if (nextSet.size !== next.length) return null;
  const previousSet = new Set(previous);
  const kept = previous.filter((entry) => nextSet.has(entry));
  const added = next.filter((entry) => !previousSet.has(entry)).toSorted(compareTimelineEntries);
  for (let index = 1; index < kept.length; index += 1) {
    if (compareTimelineEntries(kept[index - 1]!, kept[index]!) === 0) return null;
  }
  const merged: TimelineEntry[] = [];
  let keptIndex = 0;
  let addedIndex = 0;
  while (keptIndex < kept.length && addedIndex < added.length) {
    const order = compareTimelineEntries(kept[keptIndex]!, added[addedIndex]!);
    if (order === 0) return null;
    merged.push(order < 0 ? kept[keptIndex++]! : added[addedIndex++]!);
  }
  while (keptIndex < kept.length) merged.push(kept[keptIndex++]!);
  while (addedIndex < added.length) merged.push(added[addedIndex++]!);
  return merged;
}

/** A total order, so merging two sorted runs equals sorting their union. */
function compareTimelineEntries(left: TimelineEntry, right: TimelineEntry): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

function hasExactArrayPrefix<T>(previous: ReadonlyArray<T>, next: ReadonlyArray<T>): boolean {
  if (previous === next) return true;
  if (next.length < previous.length) return false;
  for (let index = 0; index < previous.length; index += 1) {
    if (previous[index] !== next[index]) return false;
  }
  return true;
}

function hasSameArrayItems<T>(previous: ReadonlyArray<T>, next: ReadonlyArray<T>): boolean {
  return previous.length === next.length && hasExactArrayPrefix(previous, next);
}

function mergeTimelineEntrySuffix(
  previous: ReadonlyArray<TimelineEntry>,
  suffix: ReadonlyArray<TimelineEntry>,
): TimelineEntry[] {
  if (suffix.length === 0) return previous as TimelineEntry[];
  const previousLast = previous.at(-1);
  if (previousLast === undefined || compareTimelineEntries(previousLast, suffix[0]!) <= 0) {
    return [...previous, ...suffix];
  }
  const merged: TimelineEntry[] = [];
  let previousIndex = 0;
  let suffixIndex = 0;
  while (previousIndex < previous.length || suffixIndex < suffix.length) {
    const previousEntry = previous[previousIndex];
    const suffixEntry = suffix[suffixIndex];
    if (
      previousEntry !== undefined &&
      (suffixEntry === undefined || compareTimelineEntries(previousEntry, suffixEntry) <= 0)
    ) {
      merged.push(previousEntry);
      previousIndex += 1;
    } else if (suffixEntry !== undefined) {
      merged.push(suffixEntry);
      suffixIndex += 1;
    }
  }
  return merged;
}

export interface TimelineEntriesProjection {
  readonly messages: ReadonlyArray<ChatMessage>;
  readonly proposedPlans: ReadonlyArray<ProposedPlan>;
  readonly turnPlans: ReadonlyArray<TurnPlanEntry>;
  readonly workEntries: ReadonlyArray<WorkLogEntry>;
  readonly zeropsEntries: ReadonlyArray<ZeropsTimelineEntry>;
  readonly changeEvents: ReadonlyArray<ChangeLandedEvent>;
  readonly entries: TimelineEntry[];
}

type AttachmentResource = Extract<AssetResource, { readonly _tag: "attachment" }>;
const EMPTY_IMAGE_RESOURCES = Object.freeze<ReadonlyArray<AttachmentResource>>([]);

/** A mounted row requests its stored images. Local previews keep their existing URLs. */
export function selectMessageImageResources(
  attachments: ChatMessage["attachments"],
): ReadonlyArray<AttachmentResource> {
  const attachmentIds = new Set<string>();
  for (const attachment of attachments ?? []) {
    if (!isImageAttachment(attachment)) continue;
    const previewUrl = attachment.previewUrl;
    if (previewUrl?.startsWith("blob:") || previewUrl?.startsWith("data:")) continue;
    attachmentIds.add(attachment.id);
  }
  return attachmentIds.size === 0
    ? EMPTY_IMAGE_RESOURCES
    : Array.from(attachmentIds, (attachmentId) => {
        const attachment = attachments?.find((value) => value.id === attachmentId);
        return {
          _tag: "attachment",
          attachmentId,
          ...(attachment ? { mimeType: attachment.mimeType } : {}),
          ...(attachment && "asset" in attachment && attachment.asset
            ? {
                occurrenceId: attachment.asset.id,
                ...(attachment.asset.original.status === "failed"
                  ? { captureFailure: attachment.asset.original.code }
                  : {}),
                ...("sourceAsset" in attachment && attachment.sourceAsset
                  ? { originalOccurrenceId: attachment.sourceAsset.id }
                  : {}),
              }
            : {}),
        };
      });
}

/** Handoffs need server URLs even while their message rows are unmounted. */
export function selectHandoffImageResources(
  messages: ReadonlyArray<ChatMessage> | undefined,
  handoffs: Readonly<Record<string, ReadonlyArray<string>>>,
): ReadonlyArray<AttachmentResource> {
  if (Object.keys(handoffs).length === 0) return EMPTY_IMAGE_RESOURCES;
  const attachmentIds = new Set<string>();
  for (const message of messages ?? []) {
    if (message.role !== "user" || !handoffs[message.id]?.length) continue;
    for (const attachment of message.attachments ?? []) {
      if (isImageAttachment(attachment)) attachmentIds.add(attachment.id);
    }
  }
  return attachmentIds.size === 0
    ? EMPTY_IMAGE_RESOURCES
    : Array.from(attachmentIds, (attachmentId) => {
        const attachment = messages
          ?.flatMap((message) => message.attachments ?? [])
          .find((value) => value.id === attachmentId);
        return {
          _tag: "attachment",
          attachmentId,
          ...(attachment ? { mimeType: attachment.mimeType } : {}),
          ...(attachment && "asset" in attachment && attachment.asset
            ? {
                occurrenceId: attachment.asset.id,
                ...(attachment.asset.original.status === "failed"
                  ? { captureFailure: attachment.asset.original.code }
                  : {}),
                ...("sourceAsset" in attachment && attachment.sourceAsset
                  ? { originalOccurrenceId: attachment.sourceAsset.id }
                  : {}),
              }
            : {}),
        };
      });
}

/** Own one mapper per preview stage. Immutable messages retain unchanged preview objects. */
export function createMessageAttachmentPreviewProjector() {
  const attachmentsBySource = new WeakMap<
    ReadonlyArray<ChatAttachment>,
    ReadonlyArray<ChatAttachment>
  >();
  const messagesBySource = new WeakMap<ChatMessage, ChatMessage>();
  return (
    message: ChatMessage,
    previewUrlFor: (attachment: ChatAttachment) => string | undefined,
  ): ChatMessage => {
    const source = message.attachments;
    if (!source || source.length === 0) return message;
    const previous = attachmentsBySource.get(source) ?? source;
    let changed: ChatAttachment[] | undefined;
    let hasOverrides = false;
    for (const [index, attachment] of source.entries()) {
      const previewUrl = previewUrlFor(attachment);
      const sourceUrl = "previewUrl" in attachment ? attachment.previewUrl : undefined;
      const previousAttachment = previous[index]!;
      const previousUrl =
        "previewUrl" in previousAttachment ? previousAttachment.previewUrl : undefined;
      const next =
        !previewUrl || previewUrl === sourceUrl
          ? attachment
          : previewUrl === previousUrl
            ? previousAttachment
            : { ...attachment, previewUrl };
      hasOverrides ||= next !== attachment;
      if (next !== previousAttachment) {
        changed ??= previous.slice();
        changed[index] = next;
      }
    }
    const attachments = hasOverrides ? (changed ?? previous) : source;
    attachmentsBySource.set(source, attachments);
    if (attachments === source) {
      messagesBySource.delete(message);
      return message;
    }
    const previousMessage = messagesBySource.get(message);
    if (previousMessage?.attachments === attachments) return previousMessage;
    const result = { ...message, attachments };
    messagesBySource.set(message, result);
    return result;
  };
}

/** Text and update time do not change a streaming assistant message's timeline structure. */
export function isStreamingMessageTextUpdate(previous: ChatMessage, next: ChatMessage): boolean {
  if (
    previous.role !== "assistant" ||
    next.role !== "assistant" ||
    !previous.streaming ||
    !next.streaming
  ) {
    return false;
  }
  const { text: _previousText, updatedAt: _previousUpdatedAt, ...previousMetadata } = previous;
  const { text: _nextText, updatedAt: _nextUpdatedAt, ...nextMetadata } = next;
  return shallow(previousMetadata, nextMetadata);
}

function replaceStreamingTimelineMessages(
  messages: ReadonlyArray<ChatMessage>,
  previous: TimelineEntriesProjection,
): TimelineEntry[] | null {
  if (messages.length !== previous.messages.length) return null;
  const replacements = new Map<ChatMessage, ChatMessage>();
  for (const [index, message] of messages.entries()) {
    const previousMessage = previous.messages[index]!;
    if (message === previousMessage) continue;
    if (!isStreamingMessageTextUpdate(previousMessage, message)) return null;
    replacements.set(previousMessage, message);
  }
  if (replacements.size === 0) return previous.entries;
  return previous.entries.map((entry) => {
    const replacement = entry.kind === "message" ? replacements.get(entry.message) : undefined;
    return replacement ? timelineEntryFromMessage(replacement) : entry;
  });
}

/**
 * Reuse ordered entries across updates: a streamed message replaces its own,
 * appended entries merge in, and any other change keeps the last order for
 * what it held (`sortedFromPrevious`); nothing changed, the same entries.
 */
export function deriveTimelineEntriesWithState(
  messages: ReadonlyArray<ChatMessage>,
  proposedPlans: ReadonlyArray<ProposedPlan>,
  workEntries: ReadonlyArray<WorkLogEntry>,
  previous: TimelineEntriesProjection | null = null,
  turnPlans: ReadonlyArray<TurnPlanEntry> = [],
  givenZeropsEntries: ReadonlyArray<ZeropsTimelineEntry> = [],
  changeEvents: ReadonlyArray<ChangeLandedEvent> = [],
): TimelineEntriesProjection {
  const zeropsEntries = sameZeropsEntriesAsBefore(givenZeropsEntries, previous?.zeropsEntries);
  const sources = { messages, proposedPlans, turnPlans, workEntries, zeropsEntries, changeEvents };
  if (
    previous !== null &&
    hasSameArrayItems(previous.proposedPlans, proposedPlans) &&
    hasSameArrayItems(previous.turnPlans, turnPlans) &&
    hasSameArrayItems(previous.workEntries, workEntries) &&
    hasSameArrayItems(previous.zeropsEntries, zeropsEntries) &&
    hasSameArrayItems(previous.changeEvents, changeEvents)
  ) {
    const entries = replaceStreamingTimelineMessages(messages, previous);
    if (entries !== null) return { ...sources, entries };
  }
  if (
    previous !== null &&
    hasExactArrayPrefix(previous.messages, messages) &&
    hasExactArrayPrefix(previous.proposedPlans, proposedPlans) &&
    hasExactArrayPrefix(previous.turnPlans, turnPlans) &&
    hasExactArrayPrefix(previous.workEntries, workEntries) &&
    hasExactArrayPrefix(previous.zeropsEntries, zeropsEntries) &&
    hasExactArrayPrefix(previous.changeEvents, changeEvents)
  ) {
    const suffix = [
      ...messages.slice(previous.messages.length).map(timelineEntryFromMessage),
      ...proposedPlans.slice(previous.proposedPlans.length).map(timelineEntryFromProposedPlan),
      ...turnPlans.slice(previous.turnPlans.length).map(timelineEntryFromTurnPlan),
      ...workEntries.slice(previous.workEntries.length).map(timelineEntryFromWork),
      ...zeropsEntries.slice(previous.zeropsEntries.length).map(timelineEntryFromZerops),
      ...changeEvents.slice(previous.changeEvents.length).map(timelineEntryFromChangeLanded),
    ].toSorted(compareTimelineEntries);
    return { ...sources, entries: mergeTimelineEntrySuffix(previous.entries, suffix) };
  }
  const entries = [
    ...messages.map(timelineEntryFromMessage),
    ...proposedPlans.map(timelineEntryFromProposedPlan),
    ...turnPlans.map(timelineEntryFromTurnPlan),
    ...workEntries.map(timelineEntryFromWork),
    ...zeropsEntries.map(timelineEntryFromZerops),
    ...changeEvents.map(timelineEntryFromChangeLanded),
  ];
  // A call that changed mid-run (its row merged its next update) is a new
  // entry where the old one stood: the rest keep their order.
  const sorted = previous === null ? null : sortedFromPrevious(previous.entries, entries);
  if (sorted !== null && sorted.length === previous!.entries.length) {
    if (sorted.every((entry, index) => entry === previous!.entries[index])) {
      return { ...sources, entries: previous!.entries };
    }
  }
  return { ...sources, entries: sorted ?? entries.toSorted(compareTimelineEntries) };
}

export function deriveTimelineEntries(
  messages: ReadonlyArray<ChatMessage>,
  proposedPlans: ReadonlyArray<ProposedPlan>,
  workEntries: ReadonlyArray<WorkLogEntry>,
  turnPlans: ReadonlyArray<TurnPlanEntry> = [],
  zeropsEntries: ReadonlyArray<ZeropsTimelineEntry> = [],
  changeEvents: ReadonlyArray<ChangeLandedEvent> = [],
): TimelineEntry[] {
  return deriveTimelineEntriesWithState(
    messages,
    proposedPlans,
    workEntries,
    null,
    turnPlans,
    zeropsEntries,
    changeEvents,
  ).entries;
}

export function inferCheckpointTurnCountByTurnId(
  summaries: ReadonlyArray<TurnDiffSummary>,
): Record<TurnId, number> {
  const sorted = [...summaries].toSorted((a, b) => a.completedAt.localeCompare(b.completedAt));
  const result: Record<TurnId, number> = {};
  for (let index = 0; index < sorted.length; index += 1) {
    const summary = sorted[index];
    if (!summary) continue;
    result[summary.turnId] = index + 1;
  }
  return result;
}

export function derivePhase(session: ThreadSession | null): SessionPhase {
  if (
    !session ||
    session.status === "stopped" ||
    session.status === "interrupted" ||
    session.status === "error"
  ) {
    return "disconnected";
  }
  if (session.status === "starting") return "connecting";
  if (session.status === "running") return "running";
  return "ready";
}
