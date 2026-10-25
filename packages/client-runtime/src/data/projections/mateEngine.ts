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
  CREW_SEAM_ACTIVITY_KIND,
  MATE_TASKS_CONVERSATION_ID,
  MessageId,
  PROVIDER_DISPLAY_NAMES,
  queuedBehind,
  STEP_ITEM_KINDS,
  TurnId,
  WORK_ALIVE,
  type ChatAttachment,
  type ConversationRow,
  type CrewCard,
  type MateTaskMessage,
  type MateTaskSource,
  type CrewSeam,
  type ConversationHeader,
  type Item,
  type OrchestrationLatestTurn,
  type OrchestrationMessage,
  type OrchestrationSession,
  type OrchestrationShellSnapshot,
  type OrchestrationThread,
  type OrchestrationThreadActivity,
  type OrchestrationThreadShell,
  type Principal,
  type Request,
  type RequestAsk,
  type RuntimeMode,
  type ThreadCrewOrigin,
  type RunRecord,
  isCardAsk,
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
  engineFactId,
  engineRowsKey,
  type EngineConversationKey,
  type EngineFact,
} from "../families/mateEngine.ts";
import type { ProjectionReads, Projection } from "../store.ts";
import { crewSeamWords, crewSessionWord } from "../../zerops/crew/phrases.ts";
import { sameValue } from "./equal.ts";

const iso = (ms: number | null | undefined) =>
  DateTime.formatIso(DateTime.makeUnsafe(ms === null || ms === undefined ? 0 : ms));

const RUN_STATE_UNAVAILABLE =
  "This Mate does not provide the current run state this app needs. Update the Mate to continue.";

/** What the engine reader (the web and desktop, which load the hosted client) says: a reload fixes it. */
const UPDATE_WORDS =
  "This Mate speaks a newer conversation protocol. Reload or update this app to keep talking to it.";

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

/** The latest run as the turn the view reads: on its card, which a run that continues shares. */
const latestTurnOf = (run: RunRecord, card: RunRecord): OrchestrationLatestTurn | null =>
  run.turnState == null || run.turnState === "unknown"
    ? null
    : {
        turnId: TurnId.make(card.id),
        state: run.turnState,
        requestedAt: iso(card.queuedAt),
        startedAt:
          (card.startedAt ?? run.startedAt) === null ? null : iso(card.startedAt ?? run.startedAt),
        completedAt: run.endedAt === null ? null : iso(run.endedAt),
        assistantMessageId: run.summary
          .answerItemId as OrchestrationLatestTurn["assistantMessageId"],
      };

const RESENT = "#next";

/**
 * The send id of a message whose steer the engine refused as its run ended: it goes as the next
 * run instead, under its own id with this mark, since the engine keeps the steer's refusal as the
 * receipt of the message's id (a duplicate returns it).
 */
export const engineResendId = (messageId: string) => `${messageId}${RESENT}`;

/** The message id a person's words go by: the send's own id, so its pending bubble is this row. */
const personMessageId = (item: Extract<Item, { kind: "person" }>) => {
  const id = item.sendId ?? item.id;
  return id.endsWith(RESENT) ? id.slice(0, -RESENT.length) : id;
};

/**
 * The card an item draws on: its run's, or — for a run that continues another (`joins`) — the
 * card of the run it continues, which they share while nothing on it has answered (`cardsOf`).
 */
type CardOf = (runId: string | null) => string | null;

/**
 * A message as the engine's record draws it: a crew card carries its typed card, so the timeline
 * draws the card from it and never reads the words the agent got.
 */
export interface EngineMessage extends OrchestrationMessage {
  readonly crewCard?: CrewCard;
  /** A task's first message on an automated Mate: the issue it brings, drawn as its card. */
  readonly task?: MateTaskSource;
  /** With `task`: what its asker wrote where they asked, drawn as theirs; never the brief. */
  readonly taskAsk?: string;
  /** Something said about a task its Mate took, told to it: drawn as its author's. */
  readonly taskMessage?: MateTaskMessage;
  /**
   * HQ's id of the task the message is for (its brief, a follow-up): every task of an automated
   * Mate runs in its one conversation. Absent on an older task's own conversation, which names it.
   */
  readonly taskId?: string;
  /** The person's message waits in the engine's queue: no run has taken it yet. */
  readonly queued?: true;
  /** A person's message whose run is still queued: no agent has it, and the person may withdraw it. */
  readonly heldRunId?: string;
}

/** Whether a run ended without ever starting: its message never reached the agent. */
type NeverStarted = (runId: string | null) => boolean;

function messageOf(
  item: Item,
  cardOf: CardOf,
  neverStarted: NeverStarted = () => false,
  queued: (runId: string) => boolean = () => false,
  refusedAtAdmission: NeverStarted = () => false,
): EngineMessage | null {
  const base = {
    turnId: cardOf(item.runId) as OrchestrationMessage["turnId"],
    createdAt: iso(item.at),
    updatedAt: iso(item.at),
  };
  switch (item.kind) {
    case "person":
      // Refused before anything of its run ran (admission): its words go back to its sender.
      if (item.delivery.state === "refused" && refusedAtAdmission(item.runId)) return null;
      return {
        ...base,
        // A message whose run ended before it began names no run, as a V1 message no run took.
        ...(neverStarted(item.runId) ? { turnId: null } : {}),
        ...(item.delivery.state === "queued" ? { queued: true as const } : {}),
        ...(item.runId !== null && queued(item.runId) ? { heldRunId: item.runId } : {}),
        id: MessageId.make(personMessageId(item)),
        role: "user",
        text: item.text,
        ...(item.task === undefined ? {} : { task: item.task }),
        ...(item.taskAsk === undefined ? {} : { taskAsk: item.taskAsk }),
        ...(item.taskMessage === undefined ? {} : { taskMessage: item.taskMessage }),
        ...(item.taskId === undefined ? {} : { taskId: item.taskId }),
        attachments: item.attachments.filter(
          (attachment): attachment is Extract<ChatAttachment, { type: "image" | "file" }> =>
            attachment.type === "image" || attachment.type === "file",
        ),
        streaming: false,
      };
    case "note":
      // The crew's card opens its run as V1's card message did, typed.
      if (item.card !== undefined)
        return {
          ...base,
          id: MessageId.make(item.id),
          role: "user",
          text: item.text,
          streaming: false,
          crewCard: item.card,
        };
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

/**
 * Background work's end as V1's task lifecycle says it. `lost` is the engine's own word that its
 * session went before it reported — what V1 judges from the live set (`jobLost`), said outright.
 */
const WORK_END_STATUS: Readonly<Record<string, string>> = {
  completed: "completed",
  failed: "failed",
  stopped: "stopped",
  lost: "lost",
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
 * A call's line before its input arrived: its tool's name and an empty input (`Bash: {}`), which
 * the agent's adapter writes while the input still streams. It says nothing; the row says what
 * the call is by its tool until the input comes (Milo's stress run's working line read "Bash: {}").
 */
const inputNotArrived = (line: string) => /^[\w.-]+:\s*\{\s*\}$/u.test(line.trim());

/**
 * A call as V1's tool lifecycle: its start (the anchor its row keeps), then its progress while it
 * runs or its completion once it ended, each with the call's line, facts and result. Its title is
 * the activity's summary, as V1's: a V1 tool payload carries none of its own.
 */
function callActivities(
  item: Extract<Item, { kind: "call" }>,
  cardOf: CardOf,
  /** The work it started was stopped: its call ended failed only as the stop broke it off. */
  workStopped = false,
): ReadonlyArray<OrchestrationThreadActivity> {
  const title = item.words ?? item.presentation?.title ?? item.tool.name;
  const payload = {
    itemType:
      STEP_ITEM_KINDS[item.step] ??
      (item.tool.server === undefined ? "dynamic_tool_call" : "mcp_tool_call"),
    toolCallId: item.id,
    ...(item.input === undefined || inputNotArrived(item.input) ? {} : { detail: item.input }),
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
        status:
          workStopped && item.state === "failed"
            ? "stopped"
            : (CALL_STATUS[item.state] ?? "completed"),
        ...(item.state === "unreturned" ? { unreturned: true } : {}),
      },
      card,
      item.endedAt ?? item.at,
      item.rev,
    ),
  ];
}

/**
 * Background work as V1's task lifecycle: a helper on the helpers' surface, the rest jobs. A
 * helper's own work is the helper's, as V1 stamps it (`agentId`): never the Mate's row. The call
 * that started it is its tool use, as V1 names it: its job is that command's.
 */
function workActivities(
  item: Extract<Item, { kind: "work" }>,
  cardOf: CardOf,
): ReadonlyArray<OrchestrationThreadActivity> {
  const taskType = WORK_TASK_TYPES[item.workKind];
  const payload = {
    taskId: item.work,
    // A helper batches with the others its run started, never with a later run's on its card.
    ...(item.workKind === "helper"
      ? { agentKind: "agent", ...(item.runId === null ? {} : { spawnRunId: item.runId }) }
      : {}),
    ...(item.by.kind === "helper" ? { agentId: item.by.helperId } : {}),
    ...(taskType === undefined ? {} : { taskType }),
    ...(item.title === null ? {} : { title: item.title }),
    ...(item.call === undefined ? {} : { toolUseId: item.call }),
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
  // Resting or waiting on the person is no end: the helper reads so, never as working.
  if (end === undefined)
    return item.workKind === "helper" && (item.status === "idle" || item.status === "waiting")
      ? [
          started,
          activity(
            `${item.id}#${item.status}`,
            "task.updated",
            summary,
            { ...payload, status: item.status },
            card,
            item.at,
            item.rev,
          ),
        ]
      : [started];
  return [
    started,
    activity(
      item.id,
      "task.completed",
      summary,
      { ...payload, status: end, ...(item.report === undefined ? {} : { detail: item.report }) },
      card,
      // When it ended, which says what its end woke; a record from before the engine kept it, when
      // it started.
      item.endedAt ?? item.at,
      item.rev,
      end === "failed" ? "error" : "info",
    ),
  ];
}

/** A marker in a run, as V1 draws the same event: a compaction, an error, a capture's gap. */
/** The activity kind of the line where the history import cut a conversation's earlier turns. */
export const HISTORY_CUT_KIND = "history.cut";

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
    case "warning":
      // V1 labels a warning by its own words.
      return marker.reason === undefined
        ? null
        : activity(
            item.id,
            "runtime.warning",
            marker.reason,
            { message: marker.reason },
            card,
            item.at,
            item.seq,
          );
    case "plan":
      // The plan's steps are the item's data, not its record: its words, as V1's update says them.
      return activity(
        item.id,
        "turn.plan.updated",
        "Plan updated",
        marker.reason === undefined ? {} : { explanation: marker.reason },
        card,
        item.at,
        item.seq,
      );
    case "runtime.note":
      return marker.reason === undefined
        ? null
        : activity(item.id, "runtime.note", marker.reason, {}, card, item.at, item.seq);
    case "crew.seam": {
      const seam = marker.seam;
      if (seam === undefined || seam.seam === "unknown") return null;
      return activity(
        item.id,
        CREW_SEAM_ACTIVITY_KIND,
        marker.reason ?? crewSeamWords(seam),
        seam as CrewSeam as Record<string, unknown>,
        card,
        item.at,
        item.seq,
      );
    }
    case "session-rotated":
      // One conversation per crewmate: a new session is a line in it, never a link elsewhere.
      return activity(
        item.id,
        CREW_SEAM_ACTIVITY_KIND,
        crewSessionWord(marker.reason),
        { seam: "stint", previousThreadId: null },
        card,
        item.at,
        item.seq,
      );
    case "history-cut":
      // Drawn by the timeline as a line at the conversation's top, never a step of its run.
      return activity(
        item.id,
        HISTORY_CUT_KIND,
        marker.reason ?? "Earlier turns stayed with the previous engine.",
        {},
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

/** The usage-limit notice still read by the separate limit presentation. */
function usageLimitActivity(run: RunRecord, card: string): OrchestrationThreadActivity | null {
  const end = run.end;
  if (end?.kind !== "usage-limit") return null;
  // Whose limit it was, on the record itself: never read later from the session or the composer.
  const provider =
    end.driver === undefined
      ? undefined
      : Object.entries(PROVIDER_DISPLAY_NAMES).find(([driver]) => driver === end.driver)?.[1];
  return activity(
    `${run.id}#limit`,
    "runtime.error",
    "Runtime error",
    {
      message: "The agent reached its usage limit.",
      turnEnd: "usage-limit",
      ...(provider === undefined ? {} : { provider }),
      ...(end.window === undefined ? {} : { window: end.window }),
    },
    card,
    run.endedAt ?? run.queuedAt,
    run.rev,
    "error",
  );
}

/** The activity a value asked of the person is: one card in its run, its state as it stands. */
export const VAULT_ASK_ACTIVITY_KIND = "vault.requested";

/**
 * What the card for a value asked of the person reads: the ask, and how it stands — open, saved
 * or declined (who and when), or closed some other way. Never a value: the engine holds none.
 */
export interface VaultAskActivityPayload {
  readonly requestId: string;
  readonly key: string;
  /** What it is, in people's words ("Stripe secret key"); `null` from an older zcp. */
  readonly label: string | null;
  readonly scope: Extract<RequestAsk, { readonly kind: "vault" }>["scope"];
  readonly sensitive: boolean;
  readonly reason: string | null;
  readonly state: "open" | "saved" | "declined" | "closed";
  readonly answer: { readonly by: Principal; readonly at: number } | null;
}

const VAULT_ASK_STATES: Readonly<Record<string, VaultAskActivityPayload["state"]>> = {
  open: "open",
  answered: "saved",
  declined: "declined",
};

function vaultAskActivity(
  request: Request,
  ask: Extract<RequestAsk, { readonly kind: "vault" }>,
  card: string | null,
): OrchestrationThreadActivity {
  const payload: VaultAskActivityPayload = {
    requestId: request.id,
    key: ask.key,
    label: ask.label ?? null,
    scope: ask.scope,
    sensitive: ask.sensitive,
    reason: ask.reason,
    state: VAULT_ASK_STATES[request.state] ?? "closed",
    answer: request.answer === undefined ? null : { by: request.answer.by, at: request.answer.at },
  };
  return activity(
    `${request.id}#vault`,
    VAULT_ASK_ACTIVITY_KIND,
    "Secret requested",
    { ...payload },
    card,
    request.at,
    request.seq,
  );
}

/** The activity an origin asked of the person is: one card in its run, its state as it stands. */
export const ORIGIN_ASK_ACTIVITY_KIND = "origin.requested";

/**
 * What the card for an origin asked of the person reads: the repository the agent asks about, the
 * HQ repository it names, and how the ask stands — open, kept on GitHub (`connected`) or in Mate
 * (`declined`), who and when, or closed some other way. Never a token: the engine holds none.
 */
export interface OriginAskActivityPayload {
  readonly requestId: string;
  readonly url: string;
  readonly repo: string;
  readonly reason: string | null;
  readonly state: "open" | "connected" | "declined" | "closed";
  readonly answer: { readonly by: Principal; readonly at: number } | null;
}

const ORIGIN_ASK_STATES: Readonly<Record<string, OriginAskActivityPayload["state"]>> = {
  open: "open",
  answered: "connected",
  declined: "declined",
};

function originAskActivity(
  request: Request,
  ask: Extract<RequestAsk, { readonly kind: "origin" }>,
  card: string | null,
): OrchestrationThreadActivity {
  const payload: OriginAskActivityPayload = {
    requestId: request.id,
    url: ask.url,
    repo: ask.repo,
    reason: ask.reason,
    state: ORIGIN_ASK_STATES[request.state] ?? "closed",
    answer: request.answer === undefined ? null : { by: request.answer.by, at: request.answer.at },
  };
  return activity(
    `${request.id}#origin`,
    ORIGIN_ASK_ACTIVITY_KIND,
    "Origin requested",
    { ...payload },
    card,
    request.at,
    request.seq,
  );
}

/** A request as the asks the panels answer, and its resolution once it is no longer open. */
function requestActivities(
  request: Request,
  cardOf: CardOf,
): ReadonlyArray<OrchestrationThreadActivity> {
  const { ask } = request;
  const card = cardOf(request.runId);
  if (ask.kind === "vault") return [vaultAskActivity(request, ask, card)];
  if (ask.kind === "origin") return [originAskActivity(request, ask, card)];
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
            {
              requestId: request.id,
              questions: ask.questions,
              // A question its agent does not wait on is one V1 asks by message: dismissible.
              ...(ask.dismissible ? { responseMode: "message" } : {}),
            },
            card,
            request.at,
            request.seq,
          )
        : null;
  if (asked === null) return [];
  if (request.state === "open" && request.answerable) return [asked];
  const answer = request.answer;
  const answered =
    answer?.answers === undefined
      ? {}
      : {
          answers: answer.answers,
          ...(answer.attachmentsByQuestionId === undefined
            ? {}
            : { attachmentsByQuestionId: answer.attachmentsByQuestionId }),
        };
  const resolved = activity(
    `${request.id}#resolved`,
    ask.kind === "approval" ? "approval.resolved" : "user-input.resolved",
    answer?.summary ?? "Resolved",
    { requestId: request.id, ...answered },
    card,
    answer?.at ?? request.at,
    request.rev,
  );
  const pictures = Object.values(answer?.attachmentsByQuestionId ?? {}).flat();
  if (ask.kind !== "question" || answer?.answers === undefined || pictures.length === 0)
    return [asked, resolved];
  // The answer's pictures, as V1 records an answer that carries them.
  return [
    asked,
    resolved,
    activity(
      `${request.id}#answer-pictures`,
      "user-input.answer-submitted",
      "Question answer submitted",
      {
        requestId: request.id,
        answers: answer.answers,
        questionTextById: Object.fromEntries(
          ask.questions.flatMap((question) => {
            const { id, question: text } = (question ?? {}) as { id?: unknown; question?: unknown };
            return typeof id === "string" && typeof text === "string" ? [[id, text]] : [];
          }),
        ),
        attachmentsByQuestionId: answer.attachmentsByQuestionId,
        detail: pictures.map((picture) => picture.name).join("\n"),
      },
      card,
      answer.at,
      request.rev,
    ),
  ];
}

/** A mode a newer engine named and this build does not know reads as not said. */
const known = <Mode extends string>(
  mode: Mode | undefined,
): Exclude<Mode, "unknown"> | undefined =>
  mode === "unknown" ? undefined : (mode as Exclude<Mode, "unknown"> | undefined);

const shellThreadOf = (read: ProjectionReads, key: EngineConversationKey) => {
  const shell = read.fact("mateShell", key.environmentId);
  if (shell.kind !== "known") return null;
  return Option.match(shell.value.state.snapshot, {
    onNone: () => null,
    onSome: (snapshot) =>
      snapshot.threads.find((thread) => thread.id === key.conversationId) ?? null,
  });
};

/** A held conversation's runs, oldest first, with the card each draws on. */
function cardsOf(read: ProjectionReads, conversationKey: string, header?: ConversationHeader) {
  const runs = valuesOf(read, "mateEngineRun", "engineRunsIn", conversationKey).sort(
    (left, right) => left.ordinal - right.ordinal,
  );
  const byId = new Map(runs.map((run) => [run.id as string, run]));
  // The run whose card each run draws on, oldest first: the first of the runs it continues. A run
  // that goes on with a card's work — a turn the agent opened itself as a background job ended, a
  // note of work lost, a restart's or a usage limit's continuation — draws its own card once a run
  // on that card answered, under the answer: words said before it never stand under work done
  // after them (Milo's stress run 4A; the owner, 2026-10-12, of a usage resume: "this state, where
  // it has answer and then it's still working above is quite strange"). A run cut before it said
  // anything goes on as it worked, on its card.
  //
  // A person's message sent while a run worked, on a driver that takes it only after its turn (and
  // so queued as the next run), is part of that work as a steered one is: it stands above the
  // working card, a line of it, and its run goes on in that card (the owner, 2026-10-13: the same
  // for every agent and every message).
  const roots = new Map<string, RunRecord>();
  const answered = new Set<string>();
  for (const run of runs) {
    const behind =
      run.joins === null && run.trigger.kind === "person" ? queuedBehind(runs, run) : undefined;
    const joined = run.joins === null ? undefined : roots.get(run.joins);
    const root =
      behind !== undefined
        ? (roots.get(behind.id) ?? behind)
        : joined === undefined || answered.has(joined.id)
          ? run
          : joined;
    roots.set(run.id, root);
    if (run.summary.answerItemId !== null) answered.add(root.id);
  }
  const rootOf = (run: RunRecord): RunRecord => roots.get(run.id) ?? run;
  const cardOf: CardOf = (runId) => {
    if (runId === null) return null;
    const run = byId.get(runId);
    return run === undefined ? runId : rootOf(run).id;
  };
  // The turn is the live run; a queued run is a message waiting its turn (behind a working run, or
  // held by a usage-limit pause), never the work Stop ends.
  const active = header?.activeRunId == null ? null : (byId.get(header.activeRunId) ?? null);
  const latest = header?.latestRunId == null ? null : (byId.get(header.latestRunId) ?? null);
  const turn: HeldTurn = {
    latestTurn: latest === null ? null : latestTurnOf(latest, rootOf(latest)),
    status: header?.runStatus === "unknown" ? "stopped" : (header?.runStatus ?? "stopped"),
    activeTurnId: active === null ? null : rootOf(active).id,
    runtimeMode: known(header?.runtimeMode) ?? null,
  };
  return { runs, rootOf, cardOf, latest, turn };
}

/**
 * The run a Stop on a turn ends: the live run drawn on that card (a run that continues another
 * draws on its root's, which ended), else the run the turn names.
 */
export function engineStopTarget(
  read: ProjectionReads,
  key: EngineConversationKey,
  turnId: string,
): string {
  const conversationKey = engineConversationId(key);
  const conversation = read.fact("mateEngineConversation", conversationKey);
  if (conversation.kind !== "known")
    throw new Error("Open the conversation before stopping its run.");
  const activeId = conversation.value.header.activeRunId;
  const { runs, rootOf } = cardsOf(read, conversationKey);
  const active = runs.find((run) => run.id === activeId);
  return active !== undefined && rootOf(active).id === turnId ? active.id : turnId;
}

/**
 * The run a message sent now goes into, as V1 sends a message into its running turn: the run that
 * works (or waits on the person) while the session it runs in can take a message — with pictures
 * or files only where its steer carries them; else none, and the message is the next run.
 */
export function engineSteerTarget(
  read: ProjectionReads,
  key: EngineConversationKey,
  attachments = false,
): string | null {
  const conversation = read.fact("mateEngineConversation", engineConversationId(key));
  if (conversation.kind !== "known") return null;
  const { session, activeRunId } = conversation.value.header;
  if (session?.steer !== true || (attachments && session.steerAttachments !== true)) return null;
  return activeRunId ?? null;
}

/** A held conversation's turn as its own records say it: the live run, on the card it draws on. */
export interface HeldTurn {
  readonly latestTurn: OrchestrationLatestTurn | null;
  readonly status: "running" | "error" | "ready" | "stopped";
  readonly activeTurnId: string | null;
  /** The access the engine's record holds once a person set it: what the next run works with. */
  readonly runtimeMode?: RuntimeMode | null;
  /** Archived, as its header says: the menu's row never says so. */
  readonly archived?: boolean;
}

/** The engine conversation, held or not, as the thread the view draws. */
export function engineThreadOf(
  read: ProjectionReads,
  key: EngineConversationKey,
): OrchestrationThread | null {
  const conversation = read.fact("mateEngineConversation", engineConversationId(key));
  if (conversation.kind !== "known") return null;
  const { header } = conversation.value;
  const conversationKey = engineConversationId(key);
  const { runs, rootOf, cardOf, latest, turn } = cardsOf(read, conversationKey, header);
  const items = valuesOf(read, "mateEngineItem", "engineItemsIn", conversationKey).sort(
    (left, right) => left.seq - right.seq,
  );
  const requests = valuesOf(read, "mateEngineRequest", "engineRequestsIn", conversationKey).sort(
    (left, right) => left.seq - right.seq,
  );
  const messages: EngineMessage[] = [];
  const activities: OrchestrationThreadActivity[] = [];
  const runById = new Map(runs.map((run) => [run.id as string, run]));
  const neverStarted: NeverStarted = (runId) => {
    const run = runId === null ? undefined : runById.get(runId);
    return run !== undefined && run.state === "ended" && run.startedAt === null;
  };
  // Only admission ends a run failed before anything of it ran.
  const refusedAtAdmission: NeverStarted = (runId) =>
    neverStarted(runId) && runById.get(runId!)?.end?.kind === "failed";
  // A call whose work the person stopped: Stop ends the call failed and the work stopped.
  const stoppedCalls = new Set(
    items.flatMap((item) =>
      item.kind === "work" && item.status === "stopped" && item.call !== undefined
        ? [item.call as string]
        : [],
    ),
  );
  for (const item of items) {
    const message = messageOf(
      item,
      cardOf,
      neverStarted,
      (runId) => runById.get(runId)?.state === "queued",
      refusedAtAdmission,
    );
    if (message !== null) messages.push(message);
    switch (item.kind) {
      case "call":
        activities.push(...callActivities(item, cardOf, stoppedCalls.has(item.id)));
        break;
      case "work":
        activities.push(...workActivities(item, cardOf));
        break;
      case "marker": {
        // Every task of an automated Mate's one conversation starts afresh: its card marks where.
        if (
          item.marker.kind === "session-rotated" &&
          item.marker.reason === "task" &&
          key.conversationId === MATE_TASKS_CONVERSATION_ID
        )
          break;
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
    const broke = usageLimitActivity(run, cardOf(run.id) ?? run.id);
    if (broke !== null) activities.push(broke);
  }
  activities.sort((left, right) => (left.sequence ?? 0) - (right.sequence ?? 0));
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
  const shell = shellThreadOf(read, key);
  const agent = header.agent;
  const crew = engineCrewOrigin(key.conversationId, agent);
  const updatedAt = iso(Math.max(items.at(-1)?.at ?? 0, latest?.endedAt ?? latest?.queuedAt ?? 0));
  const session: OrchestrationSession = {
    threadId: key.conversationId as OrchestrationSession["threadId"],
    status: turn.status,
    providerName: (header.session?.driver ??
      agent?.driver ??
      null) as OrchestrationSession["providerName"],
    ...(agent === null
      ? {}
      : { providerInstanceId: agent.instanceId as OrchestrationSession["providerInstanceId"] }),
    runtimeMode: known(header.runtimeMode) ?? shell?.runtimeMode ?? "full-access",
    activeTurnId: turn.activeTurnId as OrchestrationSession["activeTurnId"],
    lastError:
      header.runStatus === undefined || header.runStatus === "unknown"
        ? RUN_STATE_UNAVAILABLE
        : latest?.end?.kind === "failed" || latest?.end?.kind === "crashed"
          ? (latest.end.reason as OrchestrationSession["lastError"])
          : null,
    updatedAt,
  };
  return {
    id: key.conversationId as OrchestrationThread["id"],
    projectId: (shell?.projectId ?? key.environmentId) as OrchestrationThread["projectId"],
    title: (shell?.title ??
      (agent?.profile.kind === "crewmate"
        ? agent.profile.name
        : "Conversation")) as OrchestrationThread["title"],
    modelSelection:
      agent !== null
        ? ({
            instanceId: agent.instanceId,
            model: header.model ?? agent.model ?? shell?.modelSelection.model ?? "default",
            ...(agent.options === undefined ? {} : { options: agent.options }),
          } as OrchestrationThread["modelSelection"])
        : (shell?.modelSelection ??
          ({ instanceId: "unknown", model: "default" } as OrchestrationThread["modelSelection"])),
    // The engine's own word once a person set the mode or sent a message; V1's until then.
    runtimeMode: known(header.runtimeMode) ?? shell?.runtimeMode ?? "full-access",
    interactionMode: known(header.interactionMode) ?? shell?.interactionMode ?? "default",
    branch: shell?.branch ?? null,
    worktreePath: shell?.worktreePath ?? null,
    latestTurn: turn.latestTurn,
    createdAt: shell?.createdAt ?? iso(runs[0]?.queuedAt ?? 0),
    updatedAt,
    archivedAt: header.archived ? updatedAt : null,
    settledOverride: null,
    settledAt: null,
    deletedAt: null,
    messages,
    proposedPlans: [],
    activities,
    session,
    ...(crew === null ? {} : { crew }),
  };
}

/** A card's typed runs, and the conversation verdict when the row names that card. */
export interface EngineRunCard {
  readonly runs: ReadonlyArray<RunRecord>;
  readonly openerMessageId?: string;
  /** Its message, refused before anything of it ran: the words go back to the composer. */
  readonly refused?: { readonly messageId: string; readonly text: string };
  readonly state?: ConversationRow["state"];
  /** Whether it holds any of its runs' background work: then that work says what it waits on. */
  readonly holdsWork?: true;
  /**
   * Its runs over, the background work they started that still runs, by what it is: the card waits
   * on it, from the same change that ended its run (the row's word on it comes a moment later).
   */
  readonly waitsOn?: EngineCardWait;
}

/** What a card whose runs are over still waits on: its helpers, and the commands it backgrounded. */
export interface EngineCardWait {
  readonly helpers: number;
  readonly commands: number;
}

/** The typed records on each card, in source order; joining identity decides no run state. */
export const engineRunCards: Projection<
  EngineConversationKey,
  Readonly<Record<string, EngineRunCard>> | null
> = {
  name: "engineRunCards",
  keyOf: engineConversationId,
  equals: sameValue,
  derive: (read, key) => {
    const id = engineConversationId(key);
    if (read.fact("mateEngineConversation", id).kind !== "known") return null;
    const { runs, cardOf } = cardsOf(read, id);
    const cards: Record<
      string,
      {
        runs: RunRecord[];
        openerMessageId?: string;
        refused?: { messageId: string; text: string };
        state?: ConversationRow["state"];
        holdsWork?: true;
        waitsOn?: EngineCardWait;
      }
    > = {};
    for (const run of runs) (cards[cardOf(run.id) ?? run.id] ??= { runs: [] }).runs.push(run);
    for (const card of Object.values(cards)) {
      // What its runs left running in the background, once they are over (a monitor watches for
      // hours: never waited on).
      let helpers = 0;
      let commands = 0;
      for (const run of card.runs)
        for (const itemId of read.index(
          "engineItemsOfRun",
          engineFactId(key.environmentId, run.id),
        )) {
          const item = read.fact("mateEngineItem", itemId);
          if (item.kind !== "known" || item.value.kind !== "work") continue;
          card.holdsWork = true;
          // What runs, or waits on the person, as the server's row reads it (`WORK_ALIVE`): an idle
          // helper rests, resumable, so its card closes (the helpers' surface says Idle).
          if (!WORK_ALIVE.has(item.value.status) || item.value.workKind === "monitor") continue;
          // A helper's own command is its helper's work, never one the Mate sent (Milo's third
          // stress run waited on "its helpers and 2 background commands": the helper's own).
          if (item.value.workKind === "helper" || item.value.by.kind === "helper") helpers += 1;
          else commands += 1;
        }
      if (card.runs.at(-1)?.state === "ended" && helpers + commands > 0)
        card.waitsOn = { helpers, commands };
      const first = card.runs[0];
      if (first?.trigger.kind !== "person") continue;
      const opener = read.fact(
        "mateEngineItem",
        engineFactId(key.environmentId, first.trigger.itemId),
      );
      if (opener.kind === "known" && opener.value.kind === "person") {
        card.openerMessageId = personMessageId(opener.value);
        if (
          opener.value.delivery.state === "refused" &&
          first.state === "ended" &&
          first.startedAt === null &&
          first.end?.kind === "failed"
        )
          card.refused = { messageId: card.openerMessageId, text: opener.value.text };
      }
    }
    const row = read.fact("mateEngineRow", engineFactId(key.environmentId, key.conversationId));
    if (row.kind === "known" && row.value.latestRun !== null) {
      const current = cardOf(row.value.latestRun.id);
      if (current !== null && cards[current]?.runs.at(-1)?.id === row.value.latestRun.id)
        cards[current].state = row.value.state;
    }
    return cards;
  },
};

/**
 * Whether the latest run's card says `error` itself: a run that broke off once it ran draws its
 * reason on its card. One refused before anything of it ran has no card line; the banner says it.
 */
export function engineCardsShowError(
  cards: Readonly<Record<string, EngineRunCard>> | null,
  error: string | null,
): boolean {
  if (cards === null || error === null) return false;
  const latest = Object.values(cards)
    .flatMap((card) => card.runs)
    .reduce<RunRecord | undefined>(
      (a, b) => (a === undefined || b.ordinal > a.ordinal ? b : a),
      undefined,
    );
  return (
    latest?.startedAt != null &&
    (latest.end?.kind === "failed" || latest.end?.kind === "crashed") &&
    latest.end.reason === error
  );
}

/** What a card's runs' calls came to, as the server counts them (`RunSummary`). */
export interface EngineCardCounts {
  readonly calls: Readonly<Record<string, number>>;
  readonly tools: Readonly<Record<string, number>>;
  /** Files edited, each once; `null` when a summary did not count them. */
  readonly edited: number | null;
  /** A run of the card answered the person in words. */
  readonly answered?: boolean;
}

/**
 * A card whose runs were not held whole when it painted: its worked line counts its effort from its
 * runs' summaries, whatever of them is held, and its scroll holds the lines from `since` through
 * `through` (times; `null` is its start, or its end) — the rest page in as it opens and reaches
 * them, through the pages of the run each way names (`pageRuns`): one run at a time, in the order
 * the card draws them.
 */
export interface EngineCardPaging {
  /** The run its scroll reads its next page from, each way; null where it holds every line. */
  readonly pageRuns: { readonly earlier: string | null; readonly later: string | null };
  readonly counts: EngineCardCounts;
  /** Whether its runs did anything its scroll draws: its "Show work" has something to open. */
  readonly hasWork: boolean;
  /** Whether any of its lines are held: none until its card first opens. */
  readonly holdsLines: boolean;
  readonly since: string | null;
  readonly through: string | null;
  readonly reading: "earlier" | "later" | null;
}

const sumInto = (into: Record<string, number>, counts: Readonly<Record<string, number>>) => {
  for (const [name, count] of Object.entries(counts)) into[name] = (into[name] ?? 0) + count;
};

/**
 * What a card's runs' calls came to, as the server counts them from its items (`RunSummary`): the
 * one count of a card's effort, live and after a reload alike, whatever of its items is held.
 */
export function engineCardCounts(runs: ReadonlyArray<RunRecord>): EngineCardCounts {
  const calls: Record<string, number> = {};
  const tools: Record<string, number> = {};
  let edited: number | null = 0;
  for (const run of runs) {
    sumInto(calls, run.summary.calls);
    sumInto(tools, run.summary.tools ?? {});
    edited =
      edited === null || run.summary.edited === undefined ? null : edited + run.summary.edited;
  }
  const answered = runs.some((run) => run.summary.answerItemId != null);
  return { calls, tools, edited, ...(answered ? { answered } : {}) };
}

/** The cards of a conversation not held whole, by the card's id (the turn the view draws). */
export function engineCardPagingOf(
  read: ProjectionReads,
  key: EngineConversationKey,
): Readonly<Record<string, EngineCardPaging>> {
  const conversationKey = engineConversationId(key);
  const spans = [...read.index("engineSpansIn", conversationKey)].flatMap((id) => {
    const fact = read.fact("mateEngineSpan", id);
    return fact.kind === "known" ? [fact.value] : [];
  });
  if (spans.length === 0) return NO_PAGING;
  const { runs, cardOf } = cardsOf(read, conversationKey);
  /** When the run's item at `seq` happened: where its card's held lines end. */
  const timeAt = (runId: string, seq: number, otherwise: number) => {
    for (const id of read.index("engineItemsOfRun", engineFactId(key.environmentId, runId))) {
      const fact = read.fact("mateEngineItem", id);
      if (fact.kind === "known" && fact.value.seq === seq) return iso(fact.value.at);
    }
    return iso(otherwise);
  };
  const personItemsOf = (runId: string) => {
    let count = 0;
    for (const id of read.index("engineItemsOfRun", engineFactId(key.environmentId, runId))) {
      const fact = read.fact("mateEngineItem", id);
      if (fact.kind === "known" && fact.value.kind === "person") count++;
    }
    return count;
  };
  const spanOf = new Map(spans.map((span) => [span.runId as string, span]));
  /** Where a stretch that starts with `run` starts: its first line held, else its queueing. */
  const startOf = (run: RunRecord) => {
    let first = run.queuedAt;
    for (const id of read.index("engineItemsOfRun", engineFactId(key.environmentId, run.id))) {
      const fact = read.fact("mateEngineItem", id);
      if (fact.kind === "known" && fact.value.at < first) first = fact.value.at;
    }
    return iso(first);
  };
  type Stretch = Pick<EngineCardPaging, "pageRuns" | "holdsLines" | "since" | "through">;
  /**
   * The stretch from the start, or from the last run before the first gap whose start is not held,
   * through the first run whose end is not held (a run read from its start), so the next page each
   * way is always beside it.
   */
  const fromStart = (members: ReadonlyArray<RunRecord>): Stretch => {
    const laterAt = members.findIndex((member) => (spanOf.get(member.id)?.to ?? null) !== null);
    const later = laterAt === -1 ? undefined : members[laterAt];
    const earlier = (laterAt === -1 ? members : members.slice(0, laterAt + 1)).findLast(
      (member) => (spanOf.get(member.id)?.from ?? null) !== null,
    );
    const laterSpan = later === undefined ? undefined : spanOf.get(later.id);
    const earlierSpan = earlier === undefined ? undefined : spanOf.get(earlier.id);
    return {
      pageRuns: { earlier: earlier?.id ?? null, later: later?.id ?? null },
      // None until it first opens: its first run read from its start, nothing of it read yet.
      holdsLines: earlierSpan !== undefined || laterAt !== 0 || laterSpan?.to !== 0,
      since:
        earlier === undefined || earlierSpan === undefined || earlierSpan.from === null
          ? null
          : timeAt(earlier.id, earlierSpan.from, earlier.endedAt ?? earlier.queuedAt),
      through:
        later === undefined || laterSpan === undefined || laterSpan.to === null
          ? null
          : timeAt(later.id, laterSpan.to, later.queuedAt),
    };
  };
  /**
   * The stretch through the end, back through every run held whole to the first, from the end,
   * not held from its start; a run whose end is not held (read from its start, or not at all) stops
   * it at the start of the run after it, and is the one it pages back into, from its end.
   */
  const fromEnd = (members: ReadonlyArray<RunRecord>): Stretch => {
    const at = members.findLastIndex((member) => {
      const span = spanOf.get(member.id);
      return span !== undefined && (span.from !== null || span.to !== null);
    });
    const gap = members[at];
    const span = gap === undefined ? undefined : spanOf.get(gap.id);
    if (gap === undefined || span === undefined)
      return {
        pageRuns: { earlier: null, later: null },
        holdsLines: true,
        since: null,
        through: null,
      };
    const next = members[at + 1];
    return {
      pageRuns: { earlier: gap.id, later: null },
      holdsLines: true,
      since:
        span.from !== null
          ? timeAt(gap.id, span.from, gap.endedAt ?? gap.queuedAt)
          : next === undefined
            ? null
            : startOf(next),
      through: null,
    };
  };
  const cards: Record<string, EngineCardPaging> = {};
  for (const span of spans) {
    const card = cardOf(span.runId);
    if (card === null || cards[card] !== undefined) continue;
    // The card's runs in the order it draws them. Its scroll holds one stretch: from its start,
    // unless its last run's newest lines are held — a run with no span, held whole as it came
    // (any run that started after the conversation opened), live or settled, or a run's whose
    // span holds its end — when it reaches its end. From its start, a live card whose earlier run
    // was not read yet held none of its work (Filip's card, Aleš, 2026-10-25), and lost what it
    // held as its live run settled.
    const members = runs.filter((member) => cardOf(member.id) === card);
    const last = members.at(-1);
    if (last === undefined) continue;
    const lastSpan = spanOf.get(last.id);
    const endHeld = lastSpan === undefined || lastSpan.to === null;
    const stretch = endHeld ? fromEnd(members) : fromStart(members);
    let hasWork = false;
    for (const member of members) {
      // Past the person's words and its answer, something it did. The words counted from the
      // run's own items (every person message is held): a loose imported run has none.
      const words = personItemsOf(member.id);
      const asked = member.trigger.kind === "person" ? Math.max(1, words) : words;
      const answered = member.summary.answerItemId === null ? 0 : 1;
      // A run a usage limit cut records no answer, and the limit's own note is no work of it: a
      // run refused before it did anything holds the person's words and that note alone.
      const limitNote =
        member.end?.kind === "usage-limit" && member.summary.answerItemId === null ? 1 : 0;
      if (
        Object.keys(member.summary.calls).length > 0 ||
        member.summary.items > asked + answered + limitNote
      )
        hasWork = true;
    }
    cards[card] = {
      ...stretch,
      counts: engineCardCounts(members),
      hasWork,
      reading:
        members.map((member) => spanOf.get(member.id)?.reading ?? null).find(Boolean) ?? null,
    };
  }
  return cards;
}

const NO_PAGING: Readonly<Record<string, EngineCardPaging>> = {};

/** A conversation's cards not held whole: what their worked lines count, what their scrolls hold. */
export const engineCardPaging: Projection<
  EngineConversationKey,
  Readonly<Record<string, EngineCardPaging>>
> = {
  name: "engineCardPaging",
  keyOf: engineConversationId,
  equals: sameValue,
  derive: engineCardPagingOf,
};

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
/**
 * The oldest run the account holds of a conversation, and whether the Mate has runs before it, as
 * the Mate said: its window for the runs it opened on, the last earlier page for the runs read
 * since. An ordinal says nothing of it: an import that failed reserved ordinals that hold nothing.
 */
export function earlierOf(
  read: ProjectionReads,
  key: EngineConversationKey,
): { readonly before: number; readonly more: boolean } | null {
  const id = engineConversationId(key);
  let oldest: number | null = null;
  for (const run of valuesOf(read, "mateEngineRun", "engineRunsIn", id))
    if (oldest === null || run.ordinal < oldest) oldest = run.ordinal;
  if (oldest === null) return null;
  const gauge = read.fact("mateEngineGauge", id);
  const paged = gauge.kind === "known" ? gauge.value.earlier : undefined;
  if (paged !== undefined && paged.before === oldest) return paged;
  const conversation = read.fact("mateEngineConversation", id);
  const window = conversation.kind === "known" ? conversation.value.window : null;
  if (window !== null && (window.oldestOrdinal === null || window.oldestOrdinal <= oldest))
    return { before: oldest, more: window.earlier };
  return { before: oldest, more: oldest > 1 };
}

function pageOf(
  read: ProjectionReads,
  key: EngineConversationKey,
): Option.Option<EnvironmentThreadPageState> {
  const earlier = earlierOf(read, key);
  if (earlier === null || !earlier.more) return Option.none();
  const phase = read.stream(engineEarlierScope(key)).phase;
  return Option.some({
    beforeCursor: String(earlier.before),
    hasMore: true,
    loadingOlder: phase === "connecting" || phase === "baselining",
  });
}

/** The update route's words, for a Mate whose engine protocol this build does not speak. */
export const ENGINE_UPDATE_WORDS = UPDATE_WORDS;
/** The same news on the phone: only an update of the app fixes it. */
export const NATIVE_UPDATE_WORDS =
  "This Mate speaks a newer conversation protocol. Update the app to keep talking to it.";
/** A Mate from before the engine: only its update fixes it. */
export const MATE_OLDER_WORDS =
  "This Mate is older than this app. Update the Mate to talk to it here.";

/**
 * The conversation's last words as its row says them, over the V1 thread the engine took over:
 * that thread's words are from before the flip, and a menu read off it showed them days old.
 * A row with no words yet leaves the thread's.
 */
/**
 * When the row's run began, as the engine's records give it: the run on, or the message waiting its
 * turn, from its own start (`since`) — never the row's last change. Otherwise its last run ended,
 * and what was asked of it was asked before then: a row rewritten later (a restart rereads every
 * row) names no new message.
 */
const rowRunAt = (row: ConversationRow): number => {
  const { state } = row;
  if (state.kind === "queued" || (state.kind === "working" && !state.waitsOnHelpers))
    return state.since;
  const ended = row.latestRun?.endedAt ?? null;
  return ended === null ? row.at : Math.min(row.at, ended);
};

const rowWords = (
  row: ConversationRow,
): Pick<
  OrchestrationThreadShell,
  "latestUserMessageAt" | "latestUserMessagePreview" | "latestMessagePreview"
> | null => {
  if (row.subject === null && row.snippet === null) return null;
  const createdAt = iso(rowRunAt(row));
  const asked =
    row.subject === null ? null : { role: "user" as const, text: row.subject, createdAt };
  return {
    latestUserMessageAt: asked === null ? null : createdAt,
    latestUserMessagePreview: asked,
    latestMessagePreview:
      row.snippet === null ? asked : { role: "assistant", text: row.snippet, createdAt },
  };
};

/** A conversation row onto the thread shell the menu draws: its state, its turn, its agent, its words. */
export function overlayEngineRow(
  thread: OrchestrationThreadShell,
  row: ConversationRow,
  held?: HeldTurn,
): OrchestrationThreadShell {
  const latest = row.latestRun;
  const latestTurn: OrchestrationLatestTurn | null =
    latest === null || latest.turnState == null || latest.turnState === "unknown"
      ? null
      : {
          turnId: TurnId.make(latest.id),
          state: latest.turnState,
          requestedAt: iso(rowRunAt(row)),
          startedAt: iso(rowRunAt(row)),
          completedAt: latest.endedAt === null ? null : iso(latest.endedAt),
          assistantMessageId: null,
        };
  // The engine's record says the access (held, its header; else its row): V1's thread never hears
  // of a pick made on an engine conversation.
  const runtimeMode = held?.runtimeMode ?? known(row.runtimeMode) ?? thread.runtimeMode;
  const archived = held?.archived ?? row.archived;
  return {
    ...thread,
    runtimeMode,
    // The pool container its agent leased, as its record says: the V1 thread never had one.
    lease: row.lease ?? null,
    ...(row.agent === null
      ? {}
      : {
          modelSelection: {
            instanceId: row.agent.instanceId,
            model: row.agent.model ?? thread.modelSelection.model,
            ...(row.agent.options === undefined ? {} : { options: row.agent.options }),
          } as OrchestrationThreadShell["modelSelection"],
        }),
    // Held, its records name the turn; until they do, the row's run — never the V1 thread's.
    latestTurn: held?.latestTurn ?? latestTurn,
    // Whether it is archived, as its records say — held, its header; else its row (an older server's
    // never says) — the V1 thread never heard of it. Nobody holds one archived by Archive and start
    // fresh: read live, a review's Fix asked it on a hidden composer (lab A.3).
    ...(archived === undefined
      ? {}
      : { archivedAt: archived ? (thread.archivedAt ?? thread.updatedAt) : null }),
    ...rowWords(row),
    // Its turn over, its helpers work on: the row says so, never the V1 thread's liveness.
    backgroundLiveness: row.state.kind === "working" && row.state.waitsOnHelpers ? "working" : null,
    // What that work is, by name, where the row names it.
    backgroundWork:
      row.state.kind === "working" && row.state.waitsOnHelpers ? row.state.work : undefined,
    // A person's Stop in force, whichever control or device sent it.
    stopping: row.state.kind === "working" && row.state.stopping === true,
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
        lastError: null,
      }),
      runtimeMode,
      // A conversation the account holds says its turn by its own records: the live run, never a
      // queued one, on the card it draws on. The row names only a run.
      status:
        held?.status ?? (row.runStatus === "unknown" ? "stopped" : row.runStatus) ?? "stopped",
      activeTurnId: (held === undefined
        ? (row.activeRunId ?? null)
        : held.activeTurnId) as OrchestrationSession["activeTurnId"],
      interruption: null,
      lastError: row.state.kind === "failed" ? row.state.errorLine : null,
      updatedAt: iso(row.at),
    },
    hasPendingApprovals: row.state.kind === "waiting" && row.state.on === "approval",
    hasPendingUserInput:
      row.state.kind === "waiting" && (row.state.on === "question" || isCardAsk(row.state.on)),
    pendingAsk: row.state.kind === "waiting" && row.state.on === "vault" ? "key" : null,
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

/** The turn of each conversation of a Mate the account holds, by conversation id. */
export const engineHeldTurns: Projection<string, Readonly<Record<string, HeldTurn>>> = {
  name: "engineHeldTurns",
  keyOf: (environmentId) => environmentId,
  equals: sameValue,
  derive: (read, environmentId) => {
    const turns: Record<string, HeldTurn> = {};
    for (const id of read.index("engineRowsOf", engineRowsKey(environmentId))) {
      const row = read.fact("mateEngineRow", id);
      if (row.kind !== "known") continue;
      const conversationKey = engineConversationId({
        environmentId,
        conversationId: row.value.conversationId,
      });
      const conversation = read.fact("mateEngineConversation", conversationKey);
      if (conversation.kind !== "known") continue;
      turns[row.value.conversationId] = {
        ...cardsOf(read, conversationKey, conversation.value.header).turn,
        archived: conversation.value.header.archived === true,
      };
    }
    return turns;
  },
};

/**
 * A crewmate's conversation as a crew thread's origin: the crewmate its agent's profile names, and
 * the crew and the `n` its id carries (`crew-<crew>-<handle>-<n>`); `null` for any other agent.
 */
export function engineCrewOrigin(
  conversationId: string,
  agent: ConversationRow["agent"],
): ThreadCrewOrigin | null {
  const profile = agent?.profile;
  if (profile?.kind !== "crewmate") return null;
  const mark = `-${profile.id}-`;
  const at = conversationId.lastIndexOf(mark);
  const n = Number(conversationId.slice(at + mark.length));
  const named = conversationId.startsWith("crew-") && at > "crew-".length - 1;
  return {
    crew: named ? conversationId.slice("crew-".length, at) : "main",
    crewmate: profile.id,
    stint: named && Number.isInteger(n) && n > 0 ? n : 1,
  } as ThreadCrewOrigin;
}

/**
 * A conversation V1's shell never had: the engine's row gives fresh drafts and crewmates their
 * canonical thread identity, agent and verdict in the Mate's project.
 */
function engineConversationShell(
  row: ConversationRow,
  origin: ThreadCrewOrigin | null,
  projectId: OrchestrationThreadShell["projectId"],
): OrchestrationThreadShell {
  const at = iso(row.at);
  const agent = row.agent;
  return {
    id: row.conversationId as unknown as OrchestrationThreadShell["id"],
    projectId,
    title: (agent?.profile.kind === "crewmate"
      ? agent.profile.name
      : (row.subject ?? "New thread")) as OrchestrationThreadShell["title"],
    modelSelection: {
      instanceId: agent?.instanceId ?? "unknown",
      model: agent?.model ?? "default",
    } as OrchestrationThreadShell["modelSelection"],
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: at,
    updatedAt: at,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    session: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...(origin === null ? {} : { crew: origin }),
  };
}

/**
 * A Mate's shell with its engine conversations' rows laid over their thread shells, including
 * fresh conversations the V1 shell never had.
 */
export function overlayEngineShell(
  shell: EnvironmentShellState,
  rows: ReadonlyArray<ConversationRow>,
  held: Readonly<Record<string, HeldTurn>> = {},
): EnvironmentShellState {
  if (rows.length === 0) return shell;
  const byConversation = new Map(rows.map((row) => [row.conversationId as string, row]));
  return {
    ...shell,
    snapshot: Option.map(shell.snapshot, (snapshot): OrchestrationShellSnapshot => {
      const known = new Set<string>(snapshot.threads.map((thread) => thread.id));
      const projectId = snapshot.projects[0]?.id ?? snapshot.threads[0]?.projectId;
      const engineThreads = rows.flatMap((row) => {
        const origin = engineCrewOrigin(row.conversationId, row.agent);
        return projectId === undefined || known.has(row.conversationId)
          ? []
          : [engineConversationShell(row, origin, projectId)];
      });
      return {
        ...snapshot,
        threads: [...snapshot.threads, ...engineThreads].map((thread) => {
          const row = byConversation.get(thread.id);
          return row === undefined ? thread : overlayEngineRow(thread, row, held[thread.id]);
        }),
      };
    }),
  };
}
