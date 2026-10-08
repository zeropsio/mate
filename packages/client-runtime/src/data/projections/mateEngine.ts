/**
 * An engine conversation as today's view reads a conversation: the engine's records projected
 * onto the thread the timeline, the composer and the approval panels already draw
 * (`OrchestrationThread`), and its rows onto the thread shells the menu draws. Records arrive
 * ready to draw; this only renames — the person's items are user messages under the id their send
 * was given (so a pending bubble is the same row), notes are the agent's messages, requests are
 * the asks the panels answer, calls are tool steps, the latest run is the latest turn.
 *
 * The view lane replaces this with timeline rows read straight from the records.
 *
 * @module data/projections/mateEngine
 */
import {
  MessageId,
  TurnId,
  type ChatAttachment,
  type ConversationRow,
  type Item,
  type OrchestrationLatestTurn,
  type OrchestrationMessage,
  type OrchestrationSession,
  type OrchestrationShellSnapshot,
  type OrchestrationThread,
  type OrchestrationThreadActivity,
  type OrchestrationThreadShell,
  type Request,
  type RunRecord,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";

import {
  EMPTY_ENVIRONMENT_THREAD_STATE,
  type EnvironmentThreadPageState,
  type EnvironmentThreadState,
} from "../../state/threadState.ts";
import type { EnvironmentShellState } from "../adapters/mateShellReplay.ts";
import {
  engineConversationId,
  engineConversationScopes,
  engineEarlierScope,
  engineRowsKey,
  type EngineConversationKey,
  type EngineFact,
} from "../families/mateEngine.ts";
import type { ProjectionReads, Projection } from "../store.ts";
import { sameValue } from "./equal.ts";

const iso = (ms: number | null | undefined) =>
  DateTime.formatIso(DateTime.makeUnsafe(ms === null || ms === undefined ? 0 : ms));

const UPDATE_WORDS =
  "This Mate speaks a newer conversation protocol. Update the app to keep talking to it.";

function valuesOf<F extends "mateEngineRun" | "mateEngineItem" | "mateEngineRequest">(
  read: ProjectionReads,
  family: F,
  index: string,
  key: string,
) {
  const values: Array<
    F extends "mateEngineRun"
      ? EngineFact<RunRecord>
      : F extends "mateEngineItem"
        ? EngineFact<Item>
        : EngineFact<Request>
  > = [];
  for (const id of read.index(index, key)) {
    const fact = read.fact(family, id);
    if (fact.kind === "known") values.push(fact.value as (typeof values)[number]);
  }
  return values;
}

/** A run's end as the turn the view reads. */
function turnState(run: RunRecord): OrchestrationLatestTurn["state"] {
  if (run.state !== "ended") return "running";
  switch (run.end?.kind) {
    case "completed":
      return "completed";
    case "failed":
    case "crashed":
      return "error";
    default:
      return "interrupted";
  }
}

/** The latest run as the turn the view reads: on its card, which a run that continues shares. */
const latestTurnOf = (run: RunRecord, card: RunRecord): OrchestrationLatestTurn => ({
  turnId: TurnId.make(card.id),
  state: turnState(run),
  requestedAt: iso(card.queuedAt),
  startedAt:
    (card.startedAt ?? run.startedAt) === null ? null : iso(card.startedAt ?? run.startedAt),
  completedAt: run.endedAt === null ? null : iso(run.endedAt),
  assistantMessageId: run.summary.answerItemId as OrchestrationLatestTurn["assistantMessageId"],
});

/** The message id a person's words go by: the send's own id, so its pending bubble is this row. */
const personMessageId = (item: Extract<Item, { kind: "person" }>) => item.sendId ?? item.id;

/**
 * The card an item draws on: its run's, or — for a run that continues another (`joins`) — the
 * card of the run it continues, which they share.
 */
type CardOf = (runId: string | null) => string | null;

function messageOf(item: Item, cardOf: CardOf): OrchestrationMessage | null {
  const base = {
    turnId: cardOf(item.runId) as OrchestrationMessage["turnId"],
    createdAt: iso(item.at),
    updatedAt: iso(item.at),
  };
  switch (item.kind) {
    case "person":
      return {
        ...base,
        id: MessageId.make(personMessageId(item)),
        role: "user",
        text: item.text,
        attachments: item.attachments.filter(
          (attachment): attachment is Extract<ChatAttachment, { type: "image" }> =>
            attachment.type === "image",
        ),
        streaming: false,
      };
    case "note":
      return {
        ...base,
        id: MessageId.make(item.id),
        role: "assistant",
        text: item.text,
        streaming: item.streaming,
      };
    case "thought":
      // A thought still being written is drawn from its first word, which the live text holds.
      return item.preview.length === 0 && !item.streaming
        ? null
        : {
            ...base,
            id: MessageId.make(item.id),
            role: "reasoning",
            text: item.preview,
            streaming: item.streaming,
          };
    default:
      return null;
  }
}

/** A call's step as V1's runtimes name the item that made it: the inverse of the bridge's. */
const STEP_ITEM_TYPES: Readonly<Record<string, string>> = {
  command: "command_execution",
  edit: "file_change",
  web: "web_search",
  look: "image_view",
  helper: "collab_agent_tool_call",
  mcp: "mcp_tool_call",
  tool: "dynamic_tool_call",
  read: "dynamic_tool_call",
  search: "dynamic_tool_call",
};

/** A call's state as V1's lifecycle says it. */
const CALL_STATUS: Readonly<Record<string, string>> = {
  running: "inProgress",
  done: "completed",
  failed: "failed",
  declined: "declined",
  stopped: "stopped",
  unreturned: "completed",
};

/** Background work's kind as V1's task lifecycle names it. */
const WORK_TASK_TYPES: Readonly<Record<string, string>> = {
  helper: "local_agent",
  shell: "local_bash",
  monitor: "monitor",
};

/** Background work's end as V1's task lifecycle says it; `lost` never reports, so it stopped. */
const WORK_END_STATUS: Readonly<Record<string, string>> = {
  completed: "completed",
  failed: "failed",
  stopped: "stopped",
  lost: "stopped",
};

function activity(
  id: string,
  kind: string,
  summary: string,
  payload: Record<string, unknown>,
  runId: string | null,
  at: number,
  sequence: number,
  tone?: OrchestrationThreadActivity["tone"],
): OrchestrationThreadActivity {
  return {
    id: id as OrchestrationThreadActivity["id"],
    tone:
      tone ??
      (kind.startsWith("approval.") ? "approval" : kind.startsWith("tool.") ? "tool" : "info"),
    kind,
    summary,
    payload,
    turnId: runId as OrchestrationThreadActivity["turnId"],
    sequence,
    createdAt: iso(at),
  };
}

/** Who made an item, as V1 says it of a helper's own calls: they are the helper's, not the run's. */
const helperOf = (item: Item) =>
  item.by.kind === "helper" ? { agentId: item.by.helperId } : ({} as Record<string, never>);

/**
 * What a call's row reads, as V1's activity payload carries it: the facts the server read the
 * same way V1 does (`shows`) and its Zerops result; a record with no facts of its own is named
 * by its tool.
 */
function callData(item: Extract<Item, { kind: "call" }>): Record<string, unknown> {
  const named =
    item.shows ??
    ({
      toolName: item.tool.name,
      ...(item.tool.server === undefined ? {} : { server: item.tool.server }),
    } as Record<string, unknown>);
  return item.result === undefined ? { ...named } : { ...named, zerops: item.result };
}

/**
 * A call as V1's tool lifecycle: its start (the anchor its row keeps), then its progress while it
 * runs or its completion once it ended, each with the call's line, facts and result. Its title is
 * the activity's summary, as V1's: a V1 tool payload carries none of its own.
 */
function callActivities(
  item: Extract<Item, { kind: "call" }>,
  cardOf: CardOf,
): ReadonlyArray<OrchestrationThreadActivity> {
  const title = item.words ?? item.presentation?.title ?? item.tool.name;
  const payload = {
    itemType:
      STEP_ITEM_TYPES[item.step] ??
      (item.tool.server === undefined ? "dynamic_tool_call" : "mcp_tool_call"),
    toolCallId: item.id,
    ...(item.input === undefined ? {} : { detail: item.input }),
    data: callData(item),
    ...(item.presentation === undefined ? {} : { presentation: item.presentation }),
    ...helperOf(item),
  };
  const card = cardOf(item.runId);
  const started = activity(
    `${item.id}#started`,
    "tool.started",
    title,
    { ...payload, status: "inProgress" },
    card,
    item.at,
    item.seq,
  );
  if (item.state === "running")
    return [
      started,
      activity(
        `${item.id}#updated`,
        "tool.updated",
        title,
        { ...payload, status: "inProgress" },
        card,
        item.at,
        item.rev,
      ),
    ];
  return [
    started,
    activity(
      item.id,
      "tool.completed",
      title,
      {
        ...payload,
        status: CALL_STATUS[item.state] ?? "completed",
        ...(item.state === "unreturned" ? { unreturned: true } : {}),
      },
      card,
      item.endedAt ?? item.at,
      item.rev,
    ),
  ];
}

/** Background work as V1's task lifecycle: a helper on the helpers' surface, the rest jobs. */
function workActivities(
  item: Extract<Item, { kind: "work" }>,
  cardOf: CardOf,
): ReadonlyArray<OrchestrationThreadActivity> {
  const taskType = WORK_TASK_TYPES[item.workKind];
  const payload = {
    taskId: item.work,
    ...(item.workKind === "helper" ? { agentKind: "agent" } : {}),
    ...(taskType === undefined ? {} : { taskType }),
    ...(item.title === null ? {} : { title: item.title }),
  };
  const card = cardOf(item.runId);
  const summary = item.title ?? "Background task";
  const started = activity(
    `${item.id}#started`,
    "task.started",
    summary,
    payload,
    card,
    item.at,
    item.seq,
  );
  const end = WORK_END_STATUS[item.status];
  if (end === undefined) return [started];
  return [
    started,
    activity(
      item.id,
      "task.completed",
      summary,
      { ...payload, status: end },
      card,
      item.at,
      item.rev,
      end === "failed" ? "error" : "info",
    ),
  ];
}

/** A marker in a run, as V1 draws the same event: a compaction, an error, a capture's gap. */
function markerActivity(
  item: Extract<Item, { kind: "marker" }>,
  cardOf: CardOf,
): OrchestrationThreadActivity | null {
  const { marker } = item;
  const card = cardOf(item.runId);
  switch (marker.kind) {
    case "compacted":
      return activity(
        item.id,
        "context-compaction",
        "Context compacted",
        {},
        card,
        item.at,
        item.seq,
      );
    case "error":
      return activity(
        item.id,
        "runtime.error",
        "Runtime error",
        { message: marker.reason ?? "Something went wrong." },
        card,
        item.at,
        item.seq,
        "error",
      );
    case "capture-gap":
      return activity(
        item.id,
        "runtime.warning",
        "The workspace was not captured",
        marker.reason === undefined ? {} : { message: marker.reason },
        card,
        item.at,
        item.seq,
      );
    default:
      return null;
  }
}

/** An item of a newer build: its summary, when it gives one; nothing, when it does not. */
function unknownActivity(
  item: Extract<Item, { kind: "unknown" }>,
  cardOf: CardOf,
): OrchestrationThreadActivity | null {
  return item.summary === null
    ? null
    : activity(item.id, "engine.item", item.summary, {}, cardOf(item.runId), item.at, item.seq);
}

/**
 * What the engine says live of the conversation, as V1 records it: how full the context is (the
 * meter reads the latest), and each running call's progress (the stand-up's, by its call).
 */
function gaugeActivities(
  read: ProjectionReads,
  key: EngineConversationKey,
  cardOfCall: (itemId: string) => string | null,
  card: string | null,
  at: number,
  after: number,
): ReadonlyArray<OrchestrationThreadActivity> {
  const gauge = read.fact("mateEngineGauge", engineConversationId(key));
  if (gauge.kind !== "known") return [];
  const { usage, progress } = gauge.value;
  return [
    ...Object.entries(progress).map(([itemId, value], index) =>
      activity(
        `${itemId}#progress`,
        "tool.progress",
        "Progress",
        { toolCallId: itemId, zeropsStandUp: value },
        cardOfCall(itemId),
        at,
        after + 1 + index,
      ),
    ),
    ...(usage === null
      ? []
      : [
          activity(
            `${key.conversationId}#context`,
            "context-window.updated",
            "Context window updated",
            usage as unknown as Record<string, unknown>,
            card,
            at,
            after + 1 + Object.keys(progress).length,
          ),
        ]),
  ];
}

/** How a run ended, where V1 records a break: a crash, a failure, the usage limit. */
function breakActivity(run: RunRecord, card: string): OrchestrationThreadActivity | null {
  const end = run.end;
  if (end === null) return null;
  const turnEnd =
    end.kind === "crashed"
      ? "crash"
      : end.kind === "failed"
        ? "failed"
        : end.kind === "usage-limit"
          ? "usage-limit"
          : null;
  if (turnEnd === null) return null;
  const message =
    end.kind === "crashed" || end.kind === "failed"
      ? end.reason
      : "The agent reached its usage limit.";
  return activity(
    `${run.id}#break`,
    "runtime.error",
    "Runtime error",
    { message, turnEnd },
    card,
    run.endedAt ?? run.queuedAt,
    run.rev,
    "error",
  );
}

/** A request as the asks the panels answer, and its resolution once it is no longer open. */
function requestActivities(
  request: Request,
  cardOf: CardOf,
): ReadonlyArray<OrchestrationThreadActivity> {
  const { ask } = request;
  const card = cardOf(request.runId);
  const asked =
    ask.kind === "approval"
      ? activity(
          `${request.id}#asked`,
          "approval.requested",
          "Approval requested",
          { requestId: request.id, requestKind: ask.requestKind, detail: ask.detail },
          card,
          request.at,
          request.seq,
        )
      : ask.kind === "question"
        ? activity(
            `${request.id}#asked`,
            "user-input.requested",
            "User input requested",
            { requestId: request.id, questions: ask.questions },
            card,
            request.at,
            request.seq,
          )
        : null;
  if (asked === null) return [];
  if (request.state === "open" && request.answerable) return [asked];
  return [
    asked,
    activity(
      `${request.id}#resolved`,
      ask.kind === "approval" ? "approval.resolved" : "user-input.resolved",
      request.answer?.summary ?? "Resolved",
      { requestId: request.id },
      card,
      request.answer?.at ?? request.at,
      request.rev,
    ),
  ];
}

const shellThreadOf = (read: ProjectionReads, key: EngineConversationKey) => {
  const shell = read.fact("mateShell", key.environmentId);
  if (shell.kind !== "known") return null;
  return Option.match(shell.value.state.snapshot, {
    onNone: () => null,
    onSome: (snapshot) =>
      snapshot.threads.find((thread) => thread.id === key.conversationId) ?? null,
  });
};

/** The engine conversation, held or not, as the thread the view draws. */
export function engineThreadOf(
  read: ProjectionReads,
  key: EngineConversationKey,
): OrchestrationThread | null {
  const conversation = read.fact("mateEngineConversation", engineConversationId(key));
  if (conversation.kind !== "known") return null;
  const { header } = conversation.value;
  const conversationKey = engineConversationId(key);
  const runs = valuesOf(read, "mateEngineRun", "engineRunsIn", conversationKey).sort(
    (left, right) => left.ordinal - right.ordinal,
  );
  const items = valuesOf(read, "mateEngineItem", "engineItemsIn", conversationKey).sort(
    (left, right) => left.seq - right.seq,
  );
  const requests = valuesOf(read, "mateEngineRequest", "engineRequestsIn", conversationKey).sort(
    (left, right) => left.seq - right.seq,
  );
  const byId = new Map(runs.map((run) => [run.id as string, run]));
  /** The run whose card a run draws on: the first of the runs it continues. */
  const rootOf = (run: RunRecord): RunRecord => {
    let root = run;
    for (let hops = 0; root.joins !== null && hops < runs.length; hops++) {
      const joined = byId.get(root.joins);
      if (joined === undefined) break;
      root = joined;
    }
    return root;
  };
  const cardOf: CardOf = (runId) => {
    if (runId === null) return null;
    const run = byId.get(runId);
    return run === undefined ? runId : rootOf(run).id;
  };
  const messages: OrchestrationMessage[] = [];
  const activities: OrchestrationThreadActivity[] = [];
  for (const item of items) {
    const message = messageOf(item, cardOf);
    if (message !== null) messages.push(message);
    switch (item.kind) {
      case "call":
        activities.push(...callActivities(item, cardOf));
        break;
      case "work":
        activities.push(...workActivities(item, cardOf));
        break;
      case "marker": {
        const marked = markerActivity(item, cardOf);
        if (marked !== null) activities.push(marked);
        break;
      }
      case "unknown": {
        const said = unknownActivity(item, cardOf);
        if (said !== null) activities.push(said);
        break;
      }
    }
  }
  for (const request of requests) activities.push(...requestActivities(request, cardOf));
  for (const run of runs) {
    const broke = breakActivity(run, cardOf(run.id) ?? run.id);
    if (broke !== null) activities.push(broke);
  }
  activities.sort((left, right) => (left.sequence ?? 0) - (right.sequence ?? 0));
  const latest = runs.at(-1) ?? null;
  activities.push(
    ...gaugeActivities(
      read,
      key,
      (itemId) => {
        const call = items.find((item) => item.id === itemId);
        return call === undefined ? null : cardOf(call.runId);
      },
      latest === null ? null : rootOf(latest).id,
      Math.max(items.at(-1)?.at ?? 0, latest?.queuedAt ?? 0),
      activities.at(-1)?.sequence ?? 0,
    ),
  );
  const active = runs.findLast((run) => run.state !== "ended") ?? null;
  const shell = shellThreadOf(read, key);
  const agent = header.agent;
  const failed = latest?.end?.kind === "failed" || latest?.end?.kind === "crashed";
  const updatedAt = iso(Math.max(items.at(-1)?.at ?? 0, latest?.endedAt ?? latest?.queuedAt ?? 0));
  const session: OrchestrationSession = {
    threadId: key.conversationId as OrchestrationSession["threadId"],
    status: active !== null ? "running" : failed ? "error" : "ready",
    providerName: (header.session?.driver ??
      agent?.driver ??
      null) as OrchestrationSession["providerName"],
    ...(agent === null
      ? {}
      : { providerInstanceId: agent.instanceId as OrchestrationSession["providerInstanceId"] }),
    runtimeMode: shell?.runtimeMode ?? "full-access",
    activeTurnId: (active === null
      ? null
      : rootOf(active).id) as OrchestrationSession["activeTurnId"],
    lastError:
      latest?.end?.kind === "failed" || latest?.end?.kind === "crashed"
        ? (latest.end.reason as OrchestrationSession["lastError"])
        : null,
    updatedAt,
  };
  return {
    id: key.conversationId as OrchestrationThread["id"],
    projectId: (shell?.projectId ?? key.environmentId) as OrchestrationThread["projectId"],
    title: (shell?.title ?? "Conversation") as OrchestrationThread["title"],
    modelSelection:
      agent !== null
        ? ({
            instanceId: agent.instanceId,
            model: agent.model ?? header.model ?? shell?.modelSelection.model ?? "default",
            ...(agent.options === undefined ? {} : { options: agent.options }),
          } as OrchestrationThread["modelSelection"])
        : (shell?.modelSelection ??
          ({ instanceId: "unknown", model: "default" } as OrchestrationThread["modelSelection"])),
    runtimeMode: shell?.runtimeMode ?? "full-access",
    interactionMode: shell?.interactionMode ?? "default",
    branch: shell?.branch ?? null,
    worktreePath: shell?.worktreePath ?? null,
    latestTurn: latest === null ? null : latestTurnOf(latest, rootOf(latest)),
    createdAt: shell?.createdAt ?? iso(runs[0]?.queuedAt ?? 0),
    updatedAt,
    archivedAt: header.archived ? updatedAt : null,
    settledOverride: null,
    settledAt: null,
    deletedAt: null,
    messages,
    proposedPlans: [],
    activities,
    checkpoints: [],
    session,
  };
}

/** What a fault on the conversation's link says to a person, if anything. */
function faultWords(read: ProjectionReads, key: EngineConversationKey): string | null {
  const scope = engineConversationScopes(key).item;
  const fault = read.stream(scope).fault;
  if (fault === null) return null;
  return fault.code === "update" ? UPDATE_WORDS : fault.message;
}

/** The engine conversation as the thread state the view reads: live, cached or still opening. */
export const engineThread: Projection<EngineConversationKey, EnvironmentThreadState> = {
  name: "engineThread",
  keyOf: engineConversationId,
  equals: sameValue,
  derive: (read, key) => {
    const stream = read.stream(engineConversationScopes(key).item);
    const withheld =
      stream.fault?.outcome === "access-unverified" ||
      stream.fault?.outcome === "authoritative-denial";
    const thread = withheld ? null : engineThreadOf(read, key);
    const error = faultWords(read, key);
    if (thread === null)
      return {
        ...EMPTY_ENVIRONMENT_THREAD_STATE,
        status: ["connecting", "baselining"].includes(stream.phase) ? "synchronizing" : "empty",
        error: error === null ? Option.none() : Option.some(error),
      };
    return {
      data: Option.some(thread),
      status: stream.phase === "live" ? "live" : "cached",
      error: error === null ? Option.none() : Option.some(error),
      page: pageOf(read, key),
    };
  },
};

/**
 * Whether older run groups exist before the oldest held — run ordinals are gapless, so any held
 * run past the first says so — and whether reading them is in flight.
 */
function pageOf(
  read: ProjectionReads,
  key: EngineConversationKey,
): Option.Option<EnvironmentThreadPageState> {
  let oldest: number | null = null;
  for (const run of valuesOf(read, "mateEngineRun", "engineRunsIn", engineConversationId(key)))
    if (oldest === null || run.ordinal < oldest) oldest = run.ordinal;
  if (oldest === null || oldest <= 1) return Option.none();
  const phase = read.stream(engineEarlierScope(key)).phase;
  return Option.some({
    beforeCursor: String(oldest),
    hasMore: true,
    loadingOlder: phase === "connecting" || phase === "baselining",
  });
}

/** The update route's words, for a Mate whose engine protocol this build does not speak. */
export const ENGINE_UPDATE_WORDS = UPDATE_WORDS;

/** A conversation row onto the thread shell the menu draws: its state, its turn, its agent. */
export function overlayEngineRow(
  thread: OrchestrationThreadShell,
  row: ConversationRow,
): OrchestrationThreadShell {
  const working =
    row.state.kind === "working" || row.state.kind === "queued" || row.state.kind === "waiting";
  const latest = row.latestRun;
  const latestTurn: OrchestrationLatestTurn | null =
    latest === null
      ? thread.latestTurn
      : {
          turnId: TurnId.make(latest.id),
          state:
            latest.end === null
              ? "running"
              : latest.end.kind === "completed"
                ? "completed"
                : latest.end.kind === "failed" || latest.end.kind === "crashed"
                  ? "error"
                  : "interrupted",
          requestedAt: iso(row.at),
          startedAt: iso(row.at),
          completedAt: latest.endedAt === null ? null : iso(latest.endedAt),
          assistantMessageId: null,
        };
  return {
    ...thread,
    ...(row.agent === null
      ? {}
      : {
          modelSelection: {
            instanceId: row.agent.instanceId,
            model: row.agent.model ?? thread.modelSelection.model,
            ...(row.agent.options === undefined ? {} : { options: row.agent.options }),
          } as OrchestrationThreadShell["modelSelection"],
        }),
    latestTurn,
    // A conversation the engine started never had a V1 session: the row is its session.
    session: {
      ...(thread.session ?? {
        threadId: thread.id,
        providerName: (row.agent?.driver ?? null) as OrchestrationSession["providerName"],
        ...(row.agent === null
          ? {}
          : {
              providerInstanceId: row.agent
                .instanceId as OrchestrationSession["providerInstanceId"],
            }),
        runtimeMode: thread.runtimeMode,
        lastError: null,
      }),
      status: working ? "running" : row.state.kind === "failed" ? "error" : "ready",
      activeTurnId: (row.activeRunId ?? null) as OrchestrationSession["activeTurnId"],
      updatedAt: iso(row.at),
    },
    hasPendingApprovals: row.state.kind === "waiting" && row.state.on === "approval",
    hasPendingUserInput:
      row.state.kind === "waiting" && (row.state.on === "question" || row.state.on === "vault"),
    updatedAt: iso(row.at),
  };
}

/** A Mate's engine conversation rows, as its rows subscription holds them. */
export const engineRows: Projection<string, ReadonlyArray<ConversationRow>> = {
  name: "engineRows",
  keyOf: (environmentId) => environmentId,
  equals: sameValue,
  derive: (read, environmentId) => {
    const rows: ConversationRow[] = [];
    for (const id of read.index("engineRowsOf", engineRowsKey(environmentId))) {
      const row = read.fact("mateEngineRow", id);
      if (row.kind === "known") rows.push(row.value);
    }
    return rows;
  },
};

/** A Mate's shell with its engine conversations' rows laid over their thread shells. */
export function overlayEngineShell(
  shell: EnvironmentShellState,
  rows: ReadonlyArray<ConversationRow>,
): EnvironmentShellState {
  if (rows.length === 0) return shell;
  const byConversation = new Map(rows.map((row) => [row.conversationId as string, row]));
  return {
    ...shell,
    snapshot: Option.map(shell.snapshot, (snapshot): OrchestrationShellSnapshot => ({
      ...snapshot,
      threads: snapshot.threads.map((thread) => {
        const row = byConversation.get(thread.id);
        return row === undefined ? thread : overlayEngineRow(thread, row);
      }),
    })),
  };
}
