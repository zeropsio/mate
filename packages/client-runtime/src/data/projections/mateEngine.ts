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
  type EnvironmentThreadState,
} from "../../state/threadState.ts";
import type { EnvironmentShellState } from "../adapters/mateShellReplay.ts";
import {
  engineConversationId,
  engineConversationScopes,
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

/** The run states in which the agent works on the run (or is about to): the turn. */
const LIVE_RUN_STATES: ReadonlySet<string> = new Set(["admitted", "sending", "running", "waiting"]);

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

const latestTurnOf = (run: RunRecord): OrchestrationLatestTurn => ({
  turnId: TurnId.make(run.id),
  state: turnState(run),
  requestedAt: iso(run.queuedAt),
  startedAt: run.startedAt === null ? null : iso(run.startedAt),
  completedAt: run.endedAt === null ? null : iso(run.endedAt),
  assistantMessageId: run.summary.answerItemId as OrchestrationLatestTurn["assistantMessageId"],
});

/** The message id a person's words go by: the send's own id, so its pending bubble is this row. */
const personMessageId = (item: Extract<Item, { kind: "person" }>) => item.sendId ?? item.id;

function messageOf(item: Item): OrchestrationMessage | null {
  const base = {
    turnId: item.runId as OrchestrationMessage["turnId"],
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
      return item.preview.length === 0
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

const STEP_ITEM_TYPES: Readonly<Record<string, string>> = {
  command: "command_execution",
  edit: "file_change",
  read: "file_read",
  search: "web_search",
  web: "web_search",
  tool: "mcp_tool_call",
};

function activity(
  id: string,
  kind: string,
  summary: string,
  payload: Record<string, unknown>,
  runId: string | null,
  at: number,
  sequence: number,
): OrchestrationThreadActivity {
  return {
    id: id as OrchestrationThreadActivity["id"],
    tone: kind.startsWith("approval.") ? "approval" : kind.startsWith("tool.") ? "tool" : "info",
    kind,
    summary,
    payload,
    turnId: runId as OrchestrationThreadActivity["turnId"],
    sequence,
    createdAt: iso(at),
  };
}

function callActivity(item: Extract<Item, { kind: "call" }>): OrchestrationThreadActivity {
  const running = item.state === "running";
  return activity(
    item.id,
    running ? "tool.started" : "tool.completed",
    item.words ?? item.tool.name,
    {
      itemType: STEP_ITEM_TYPES[item.step] ?? "dynamic_tool_call",
      title: item.presentation?.title ?? item.tool.name,
      detail: item.words,
      status: running ? "inProgress" : item.state === "done" ? "completed" : item.state,
    },
    item.runId,
    item.endedAt ?? item.at,
    item.rev,
  );
}

/** A request as the asks the panels answer, and its resolution once it is no longer open. */
function requestActivities(request: Request): ReadonlyArray<OrchestrationThreadActivity> {
  const { ask } = request;
  const asked =
    ask.kind === "approval"
      ? activity(
          `${request.id}#asked`,
          "approval.requested",
          "Approval requested",
          { requestId: request.id, requestKind: ask.requestKind, detail: ask.detail },
          request.runId,
          request.at,
          request.seq,
        )
      : ask.kind === "question"
        ? activity(
            `${request.id}#asked`,
            "user-input.requested",
            "User input requested",
            { requestId: request.id, questions: ask.questions },
            request.runId,
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
      request.runId,
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
  const messages: OrchestrationMessage[] = [];
  const activities: OrchestrationThreadActivity[] = [];
  for (const item of items) {
    const message = messageOf(item);
    if (message !== null) messages.push(message);
    if (item.kind === "call") activities.push(callActivity(item));
  }
  for (const request of requests) activities.push(...requestActivities(request));
  activities.sort((left, right) => (left.sequence ?? 0) - (right.sequence ?? 0));
  // The turn is the live run; a queued run is a message waiting its turn (behind a working run, or
  // held by a usage-limit pause), never the work Stop ends.
  const active = runs.findLast((run) => LIVE_RUN_STATES.has(run.state)) ?? null;
  const latest = active ?? runs.findLast((run) => run.state === "ended") ?? null;
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
    activeTurnId: (active?.id ?? null) as OrchestrationSession["activeTurnId"],
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
            model: header.model ?? agent.model ?? shell?.modelSelection.model ?? "default",
            ...(agent.options === undefined ? {} : { options: agent.options }),
          } as OrchestrationThread["modelSelection"])
        : (shell?.modelSelection ??
          ({ instanceId: "unknown", model: "default" } as OrchestrationThread["modelSelection"])),
    runtimeMode: shell?.runtimeMode ?? "full-access",
    interactionMode: shell?.interactionMode ?? "default",
    branch: shell?.branch ?? null,
    worktreePath: shell?.worktreePath ?? null,
    latestTurn: latest === null ? null : latestTurnOf(latest),
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
      page: Option.none(),
    };
  },
};

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
    session:
      thread.session === null
        ? null
        : {
            ...thread.session,
            status: working ? "running" : row.state.kind === "failed" ? "error" : "ready",
            activeTurnId: (row.activeRunId ?? null) as OrchestrationSession["activeTurnId"],
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
      if (row.kind !== "known") continue;
      // A held conversation's header is its newest word on the model it runs.
      const held = read.fact(
        "mateEngineConversation",
        engineConversationId({ environmentId, conversationId: row.value.conversationId }),
      );
      const model = held.kind === "known" ? held.value.header.model : null;
      rows.push(
        row.value.agent === null || model === null || model === row.value.agent.model
          ? row.value
          : { ...row.value, agent: { ...row.value.agent, model } },
      );
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
