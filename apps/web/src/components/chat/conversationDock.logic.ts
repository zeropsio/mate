/**
 * What the Mate at work shows besides its words: the operations running now,
 * the helpers and their states, the Mate's task list, the background tasks,
 * and a pause's countdown — while a turn runs, and after it for as long as
 * work runs on in the background.
 *
 * Pure: the ChatView reads the thread and hands the pieces here.
 */
import type {
  AgentPanelModel,
  RuntimeSubagent,
} from "@t3tools/client-runtime/state/subagentRuntime";
import { standupRunsOn, type ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import { INERT_TASK_TYPES, type OrchestrationThreadActivity } from "@t3tools/contracts";

/** Task types that watch something rather than run once: the Monitor tool's. */
const WATCH_TASK_TYPES: ReadonlySet<string> = new Set(["monitor", "monitor_mcp"]);
import type { ServiceStatusToneId } from "@t3tools/shared/brand";

import type { ActivePlanState, TimelineEntry } from "../../session-logic";
import { splitBatchDeploy, timelineEntryTurnId } from "./conversation.logic";
import { jobLost, type LiveJobs } from "./liveJobs.logic";
import { helperNowWords, helperSpan } from "./helpers.logic";

/** Operations that run long enough to watch: a pipeline, a multi-step setup, a stand-up's builds. */
export const DOCKED_KINDS: ReadonlySet<ZeropsOperation["kind"]> = new Set([
  "deploy",
  "import",
  "bootstrap",
  "mount",
  "standup",
]);

export interface DockHelper {
  readonly id: string;
  /** The helper's task in the words it was given. */
  readonly title: string;
  readonly tone: ServiceStatusToneId;
  readonly word: string;
  readonly startedAt: string;
  readonly endedAt: string | null;
}

/** A task the Mate runs in the background — a shell, a watch loop — not a helper. */
export interface DockBackgroundTask {
  readonly id: string;
  /** What it was asked to do, in the words it was given. */
  readonly title: string;
  /** "lost": it never reported and the server holds it no longer (`jobLost`). */
  readonly state: "running" | "done" | "failed" | "stopped" | "lost";
  /** It watches something (a log, a pull request) rather than running once. */
  readonly watch: boolean;
  readonly turnId: string | null;
  readonly startedAt: string;
  readonly endedAt: string | null;
}

export interface DockModel {
  readonly operations: ReadonlyArray<ZeropsOperation>;
  readonly helpers: {
    readonly rows: ReadonlyArray<DockHelper>;
    readonly working: number;
    readonly done: number;
    readonly failed: number;
  } | null;
  readonly tasks: {
    readonly steps: ActivePlanState["steps"];
    readonly done: number;
    readonly current: string | null;
  } | null;
  readonly background: {
    readonly tasks: ReadonlyArray<DockBackgroundTask>;
    readonly running: number;
    readonly done: number;
    readonly failed: number;
  } | null;
  /**
   * The turn is over and work runs on — "working" while a helper does,
   * "monitoring" while only watch loops do: the Mate at work stays, smaller,
   * with a way to stop it, until the work ends.
   */
  readonly afterTurn: "working" | "monitoring" | null;
  readonly pause: { readonly resetsAt: string | null } | null;
  /**
   * The running turn's pipelines and background tasks that ended, as they
   * ended: a bar the person watched run shows how it ended a moment before
   * its room eases shut (`withEndingsHeld`).
   */
  readonly endings?: {
    /** A batch deploy's, a row per service. */
    readonly operations: ReadonlyArray<ZeropsOperation>;
    readonly tasks: ReadonlyArray<DockBackgroundTask>;
    /** The helpers, once none works. */
    readonly helpers?: DockModel["helpers"];
    /** The to-do list, once its every step is done. */
    readonly todo?: DockModel["tasks"];
  };
}

/** How long a bar that ended shows how it ended before its room eases shut (pass 35). */
export const BAND_ENDING_MS = 800;

/**
 * What the band draws running, by key: each pipeline's, each background
 * task's, the helpers' and the to-do list's.
 */
export function bandKeys(dock: DockModel | null): ReadonlySet<string> {
  return new Set([
    ...(dock?.helpers === null || dock?.helpers === undefined ? [] : ["helpers"]),
    ...(dock?.tasks === null || dock?.tasks === undefined ? [] : ["tasks"]),
    ...(dock?.operations ?? []).map((operation) => operation.key),
    ...(dock?.background?.tasks ?? [])
      .filter((task) => task.state === "running")
      .map((task) => `task:${task.id}`),
  ]);
}

/** Of what the band drew running before, what has ended since: it shows its ending a moment. */
export function endedSince(
  before: ReadonlySet<string>,
  dock: DockModel | null,
): ReadonlyArray<string> {
  const running = bandKeys(dock);
  const ended = new Set([
    ...(dock?.endings?.helpers == null ? [] : ["helpers"]),
    ...(dock?.endings?.todo == null ? [] : ["tasks"]),
    ...(dock?.endings?.operations ?? []).map((operation) => operation.key),
    ...(dock?.endings?.tasks ?? []).map((task) => `task:${task.id}`),
  ]);
  return [...before].filter((key) => !running.has(key) && ended.has(key));
}

/** What the band drew running, and the endings it holds. */
export interface BandSeen {
  readonly running: ReadonlySet<string>;
  readonly held: ReadonlySet<string>;
  /** How many times each bar has ended: a new ending holds its whole time again. */
  readonly ends: ReadonlyMap<string, number>;
}

/**
 * The band after a new dock: what it no longer runs, and the band drew
 * running, is held — unless a resync brought it, which nobody watched end.
 */
export function bandSeenNext(seen: BandSeen, dock: DockModel | null, syncing: boolean): BandSeen {
  const ended = syncing ? [] : endedSince(seen.running, dock);
  if (ended.length === 0) return { running: bandKeys(dock), held: seen.held, ends: seen.ends };
  const ends = new Map(seen.ends);
  for (const key of ended) ends.set(key, (ends.get(key) ?? 0) + 1);
  return { running: bandKeys(dock), held: new Set([...seen.held, ...ended]), ends };
}

/**
 * The dock as the band draws it, with the endings `held` drawn as they ended
 * (`BAND_ENDING_MS`), beside what runs: a deploy that finished shows it
 * finished, a task that failed says so, then the bar leaves. A failure is
 * then told once, as its row in the record.
 */
export function withEndingsHeld(
  dock: DockModel | null,
  held: ReadonlySet<string>,
): DockModel | null {
  if (dock === null || held.size === 0) return dock;
  const operations = (dock.endings?.operations ?? []).filter((operation) =>
    held.has(operation.key),
  );
  const tasks = (dock.endings?.tasks ?? []).filter((task) => held.has(`task:${task.id}`));
  const helpers = dock.helpers ?? (held.has("helpers") ? (dock.endings?.helpers ?? null) : null);
  const todo = dock.tasks ?? (held.has("tasks") ? (dock.endings?.todo ?? null) : null);
  if (
    operations.length === 0 &&
    tasks.length === 0 &&
    helpers === dock.helpers &&
    todo === dock.tasks
  ) {
    return dock;
  }
  const shownTasks = [...(dock.background?.tasks ?? []), ...tasks];
  return {
    ...dock,
    operations: [...dock.operations, ...operations].toSorted((a, b) =>
      a.anchorAt.localeCompare(b.anchorAt),
    ),
    helpers,
    tasks: todo,
    background: backgroundGroup(shownTasks),
  };
}

function payloadString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

const STOPPED_STATUSES: ReadonlySet<string> = new Set(["stopped", "cancelled", "interrupted"]);

/** A task and its command's call that ended together: the task was the call. */
const TRACKED_TOLERANCE_MS = 3_000;

/**
 * The thread's background tasks, from their lifecycle: each by what it was
 * asked to do, running until it ends done, failed or stopped. Helpers are
 * the helpers panel's, a helper's own shells its own, and plan bookkeeping
 * no one's. Claude Code also tracks any command that runs past a few seconds
 * as a task: while the Mate waits on its call the task is the call — a step
 * of its run, never a background task; only a command whose call returned
 * while its task ran on went to the background.
 */
export function foldBackgroundTasks(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): DockBackgroundTask[] {
  type Draft = {
    id: string;
    title: string | undefined;
    state: DockBackgroundTask["state"];
    watch: boolean;
    turnId: string | null;
    startedAt: string;
    endedAt: string | null;
    toolUseId: string | undefined;
  };
  // Each command's call, and when it returned.
  const callEndedAt = new Map<string, number | null>();
  for (const activity of activities) {
    if (!activity.kind.startsWith("tool.")) continue;
    const payload =
      activity.payload !== null && typeof activity.payload === "object"
        ? (activity.payload as Record<string, unknown>)
        : null;
    if (payload === null || payload.itemType !== "command_execution") continue;
    const callId = payloadString(payload, "toolCallId");
    if (callId === undefined) continue;
    const ended = activity.kind === "tool.completed" ? Date.parse(activity.createdAt) : null;
    if (!callEndedAt.has(callId) || ended !== null) callEndedAt.set(callId, ended);
  }
  const byId = new Map<string, Draft>();
  for (const activity of activities) {
    if (
      activity.kind !== "task.started" &&
      activity.kind !== "task.progress" &&
      activity.kind !== "task.completed"
    ) {
      continue;
    }
    const payload =
      activity.payload !== null && typeof activity.payload === "object"
        ? (activity.payload as Record<string, unknown>)
        : null;
    const taskId = payload === null ? undefined : payloadString(payload, "taskId");
    if (payload === null || taskId === undefined) continue;
    if (payload.agentKind === "agent" || payloadString(payload, "agentId") !== undefined) continue;
    const taskType = payloadString(payload, "taskType");
    if (taskType !== undefined && INERT_TASK_TYPES.has(taskType)) continue;
    const title =
      payloadString(payload, "title") ??
      (activity.kind === "task.started" ? payloadString(payload, "detail") : undefined);
    const toolUseId = payloadString(payload, "toolUseId");
    let draft = byId.get(taskId);
    if (draft === undefined) {
      draft = {
        id: taskId,
        title,
        state: "running",
        watch: taskType !== undefined && WATCH_TASK_TYPES.has(taskType),
        turnId: activity.turnId,
        startedAt: activity.createdAt,
        endedAt: null,
        toolUseId,
      };
      byId.set(taskId, draft);
    } else {
      if (draft.title === undefined) draft.title = title;
      if (draft.toolUseId === undefined) draft.toolUseId = toolUseId;
    }
    if (activity.kind === "task.completed") {
      const status = payloadString(payload, "status");
      draft.state =
        status === "failed" || activity.tone === "error"
          ? "failed"
          : status === "lost"
            ? "lost"
            : status !== undefined && STOPPED_STATUSES.has(status)
              ? "stopped"
              : "done";
      draft.endedAt = activity.createdAt;
    }
  }
  const tracksACall = (draft: Draft): boolean => {
    if (draft.toolUseId === undefined || !callEndedAt.has(draft.toolUseId)) return false;
    const returned = callEndedAt.get(draft.toolUseId) ?? null;
    if (returned === null) return true;
    return draft.endedAt !== null && Date.parse(draft.endedAt) - returned <= TRACKED_TOLERANCE_MS;
  };
  return [...byId.values()]
    .filter((draft) => !tracksACall(draft))
    .map(({ toolUseId: _toolUseId, ...draft }) => ({
      ...draft,
      title: draft.title ?? "A background task",
    }));
}

/**
 * The background bar while something in it runs: what runs, and what the
 * running turn sent to the background or saw end — so a task that finishes
 * fills its segment and the count of what finished only rises (run 9: a bar
 * of running tasks only read full beside "0/3", and fell from 5 to 4). An
 * earlier turn's task that ended before this one began is its own card's.
 * Nothing runs: no bar.
 */
function backgroundRunning(
  tasks: ReadonlyArray<DockBackgroundTask>,
  turn: { readonly id: string | null; readonly startedMs: number },
): DockModel["background"] {
  if (!tasks.some((task) => task.state === "running")) return null;
  return backgroundGroup(
    tasks.filter(
      (task) =>
        task.state === "running" ||
        (turn.id !== null && task.turnId === turn.id) ||
        (task.endedAt !== null && Date.parse(task.endedAt) >= turn.startedMs),
    ),
  );
}

function backgroundGroup(tasks: ReadonlyArray<DockBackgroundTask>): DockModel["background"] {
  return tasks.length === 0
    ? null
    : {
        tasks,
        running: tasks.filter((task) => task.state === "running").length,
        done: tasks.filter((task) => task.state === "done").length,
        failed: tasks.filter((task) => task.state === "failed").length,
      };
}

const HELPER_STATE: Record<
  RuntimeSubagent["status"],
  { readonly tone: ServiceStatusToneId; readonly word: string }
> = {
  pending: { tone: "busy", word: "Starting" },
  running: { tone: "busy", word: "Working" },
  waiting: { tone: "attention", word: "Waiting for you" },
  idle: { tone: "off", word: "Idle" },
  completed: { tone: "ok", word: "Done" },
  failed: { tone: "failed", word: "Failed" },
  cancelled: { tone: "off", word: "Stopped" },
  // Its session went before it reported (a restart's `lost`): ended, and waiting on no one.
  interrupted: { tone: "off", word: "Cut off" },
};

function helperTitle(agent: RuntimeSubagent): string {
  const title = agent.title.trim();
  if (title.length > 0) return title.charAt(0).toUpperCase() + title.slice(1);
  return agent.role ? `A ${agent.role.replace(/[-_]/g, " ")} helper` : "A helper";
}

function spanStart(agent: RuntimeSubagent): string {
  const { since, ranMs } = helperSpan(agent);
  if (since !== null) return since;
  if (agent.completedAt !== null && ranMs !== null) {
    return new Date(Date.parse(agent.completedAt) - ranMs).toISOString();
  }
  return agent.startedAt ?? agent.firstSeenAt;
}

/**
 * The helpers of the turn running now, flattened: the direct ones and each
 * workflow's members — those it started, and any from before still working.
 * A helper an earlier turn finished is that turn's history, not this one's.
 */
export function dockHelpers(
  model: AgentPanelModel,
  turnStartedAt: string | null = null,
): ReadonlyArray<DockHelper> {
  const since = turnStartedAt === null ? Number.NEGATIVE_INFINITY : Date.parse(turnStartedAt);
  const agents = [
    ...model.directAgents,
    ...model.workflows.flatMap((group) => group.phases.flatMap((phase) => phase.members)),
  ].filter(
    (agent) =>
      agent.completedAt === null || Date.parse(agent.startedAt ?? agent.firstSeenAt) >= since,
  );
  return agents.map((agent) => {
    const state = HELPER_STATE[agent.status];
    return {
      id: agent.id,
      title: helperTitle(agent),
      tone: state.tone,
      // Working, it says what it does now (`helperNowWords`); waiting on the
      // person or settled, its state.
      word: (agent.status === "waiting" ? null : helperNowWords(agent)) ?? state.word,
      // Its clock by its driver's own count where it keeps one (`helperSpan`).
      startedAt: spanStart(agent),
      endedAt: agent.completedAt,
    };
  });
}

export function deriveDock(input: {
  readonly timelineEntries: ReadonlyArray<TimelineEntry>;
  readonly isWorking: boolean;
  readonly runningTurnId: string | null;
  /** When the running turn started: helpers an earlier turn finished are not its own. */
  readonly turnStartedAt?: string | null;
  readonly agentPanelModel: AgentPanelModel;
  readonly plan: ActivePlanState | null;
  /** The thread's background tasks, folded from its activities. */
  readonly backgroundTasks?: ReadonlyArray<DockBackgroundTask>;
  /** The server's word on work that outlived the turn. */
  readonly backgroundLiveness?: "working" | "monitoring" | null;
  /** The jobs the server holds live (`liveJobs.logic`): a running one it does not is lost. */
  readonly liveJobs?: LiveJobs | null;
  /** The thread is held by a usage limit: when it resets, if known. */
  readonly pause: { readonly resetsAt: string | null } | null;
  /**
   * Stand-ups whose builds ran on after their call returned and that the
   * store's reading of their services says are done, by key (`useStandupsDone`).
   */
  readonly standupsDone?: ReadonlySet<string>;
}): DockModel | null {
  // A task that never reported and that the server holds no longer is lost:
  // never running in the band (the run card's line says so too).
  const backgroundTasks = (input.backgroundTasks ?? []).map((task) =>
    task.state === "running" &&
    jobLost(
      { id: task.id, ofLiveTurn: input.isWorking && task.turnId === input.runningTurnId },
      input.liveJobs ?? null,
    )
      ? { ...task, state: "lost" as const }
      : task,
  );
  // Work that outlived the turn: what still runs, and nothing else.
  const afterTurn = input.isWorking ? null : (input.backgroundLiveness ?? null);
  if (afterTurn !== null) {
    const rows = dockHelpers(input.agentPanelModel).filter(
      (row) => row.tone === "busy" || row.tone === "attention",
    );
    return {
      operations: [],
      helpers: rows.length === 0 ? null : { rows, working: rows.length, done: 0, failed: 0 },
      tasks: null,
      // After the turn its card's line is the record of what ended: only what runs.
      background: backgroundGroup(backgroundTasks.filter((task) => task.state === "running")),
      afterTurn,
      pause: null,
    };
  }

  // A bar stands for what runs without the Mate waiting on it: the running
  // turn's pipelines whose call returned while they run on (a stand-up's
  // builds). One the Mate waits on is the live slot's; one that ended leaves
  // — its line stays in the record, what is still broken goes to the result.
  // A batch deploy is a row per service.
  // A stand-up's call settles it as its report said (`standupRunsOn`): it
  // runs on while that report says a service builds, until the store's
  // reading of its services says they are done.
  // A session whose follow-up call the Mate waits on (`openedAt`) is the
  // live slot's, never the band's.
  const runsOn = (operation: ZeropsOperation) =>
    (operation.phase === "running" &&
      operation.returnedAt !== undefined &&
      operation.openedAt === undefined) ||
    (standupRunsOn(operation) && !(input.standupsDone?.has(operation.key) ?? false));
  const operations =
    input.isWorking && input.runningTurnId !== null
      ? input.timelineEntries.flatMap((entry) =>
          entry.kind === "operation" &&
          DOCKED_KINDS.has(entry.operation.kind) &&
          entry.operation.turnId === input.runningTurnId &&
          runsOn(entry.operation)
            ? splitBatchDeploy(entry.operation).filter(
                (operation) => operation.phase === "running" || runsOn(operation),
              )
            : [],
        )
      : [];

  const rows = input.isWorking
    ? dockHelpers(input.agentPanelModel, input.turnStartedAt ?? null)
    : [];
  const helpers = !rows.some((row) => row.tone === "busy" || row.tone === "attention")
    ? null
    : {
        rows,
        working: rows.filter((row) => row.tone === "busy" || row.tone === "attention").length,
        done: rows.filter((row) => row.tone === "ok").length,
        failed: rows.filter((row) => row.tone === "failed").length,
      };

  const plan = input.plan;
  const tasks =
    input.isWorking &&
    plan !== null &&
    plan.steps.length > 1 &&
    plan.steps.some((step) => step.status !== "completed") &&
    (input.runningTurnId === null || plan.turnId === input.runningTurnId)
      ? {
          steps: plan.steps,
          done: plan.steps.filter((step) => step.status === "completed").length,
          current:
            plan.steps.find((step) => step.status === "inProgress")?.step ??
            plan.steps.find((step) => step.status === "pending")?.step ??
            null,
        }
      : null;

  // When the running turn began: the server's word, else its first entry.
  const firstOfTurn = input.timelineEntries.find(
    (entry) => input.runningTurnId !== null && timelineEntryTurnId(entry) === input.runningTurnId,
  );
  const turnStart =
    input.turnStartedAt != null
      ? Date.parse(input.turnStartedAt)
      : firstOfTurn === undefined
        ? Number.NaN
        : Date.parse(firstOfTurn.createdAt);
  // What runs in the background now, from this turn or before, with what
  // this turn sent along that finished (`backgroundRunning`).
  const background = input.isWorking
    ? backgroundRunning(backgroundTasks, { id: input.runningTurnId, startedMs: turnStart })
    : null;

  const pause = input.isWorking ? null : input.pause;
  // What ended this turn: a bar the person watched shows its ending a moment.
  // A batch deploy ends a row per service, as the band drew it.
  const endings =
    input.isWorking && input.runningTurnId !== null
      ? {
          operations: input.timelineEntries.flatMap((entry) =>
            entry.kind === "operation" &&
            DOCKED_KINDS.has(entry.operation.kind) &&
            entry.operation.turnId === input.runningTurnId
              ? splitBatchDeploy(entry.operation).filter(
                  (operation) => operation.phase !== "running" && !runsOn(operation),
                )
              : [],
          ),
          // One started before this turn ends in it too.
          tasks: backgroundTasks.filter(
            (task) =>
              task.state !== "running" &&
              (task.turnId === input.runningTurnId ||
                (task.endedAt !== null && Date.parse(task.endedAt) >= turnStart)),
          ),
          helpers:
            helpers === null && rows.length > 0
              ? {
                  rows,
                  working: 0,
                  done: rows.filter((row) => row.tone === "ok").length,
                  failed: rows.filter((row) => row.tone === "failed").length,
                }
              : null,
          todo:
            tasks === null &&
            plan !== null &&
            plan.steps.length > 1 &&
            plan.steps.every((step) => step.status === "completed") &&
            (input.runningTurnId === null || plan.turnId === input.runningTurnId)
              ? { steps: plan.steps, done: plan.steps.length, current: null }
              : null,
        }
      : null;
  const ends =
    endings !== null &&
    (endings.operations.length > 0 ||
      endings.tasks.length > 0 ||
      endings.helpers !== null ||
      endings.todo !== null);
  return operations.length === 0 &&
    helpers === null &&
    tasks === null &&
    background === null &&
    pause === null &&
    !ends
    ? null
    : {
        operations,
        helpers,
        tasks,
        background,
        afterTurn: null,
        pause,
        ...(ends ? { endings } : {}),
      };
}
