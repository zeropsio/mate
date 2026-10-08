/**
 * A V1 thread as the engine's record: what the import copies in when a Mate's conversation first
 * runs on the engine. Pure: `planOf` orders the thread's turns and the records each holds from
 * V1's light columns; `recordsOf` turns a slice of that plan, with the bodies read for it, into
 * the engine's imported records.
 *
 * - A V1 turn is a run that ended (trigger `imported`), its ordinal its place among the turns.
 * - A person's message is a person item; the agent's message a note; its reasoning a thought.
 * - A tool's lifecycle is one call, in its last state (its completion, once heard), its V1
 *   payload kept as the call's data (pictures out: they travel by reference, never inline). A
 *   task's is one piece of work.
 * - An approval or a question is a request in its final state, never answerable here.
 * - A compaction, an error, a warning, a plan, a capture's gap is a marker.
 *
 * What V1 shows nowhere (a progress tick, the context meter, a checkpoint captured) is not copied.
 *
 * @module engine/history/v1
 */
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  ChatImageAttachment,
  CommandId,
  ItemId,
  RequestId,
  ToolPresentation,
  classifyTaskAgentKind,
  importedCallFields,
  itemId as deriveItemId,
  requestId as deriveRequestId,
  runId as deriveRunId,
  type ConversationId,
  type ItemActor,
  type ItemBody,
  type PersonAttachment,
  type Principal,
  type RequestAsk,
  type RunEnd,
  type RunEndSource,
  type RunId,
} from "@t3tools/contracts";
import { projectActivityPayload } from "../../orchestration/ActivityPayloadProjection.ts";
import type { ImportedRecord, ItemDataDraft, ItemDetailDraft } from "../domain/command.ts";
import { ITEM_TEXT_LIMIT, THOUGHT_PREVIEW } from "../pump/toCore.ts";

// ── bounds ──────────────────────────────────────────────────────────────────────────────────

/** The newest turns a conversation brings over; older ones stay with V1. */
export const HISTORY_TURN_LIMIT = 200;
/** The records it brings over at most: past it, the oldest turns stay, the newest whole. */
export const HISTORY_RECORD_LIMIT = 10_000;
/** A call's V1 payload kept as its data, at most (JSON characters). */
export const CALL_DATA_LIMIT = 64 * 1024;

// ── what the plan reads ─────────────────────────────────────────────────────────────────────

/** A row of `projection_turns`: `key` is its turn id, or `pending:<message>` before it started. */
export interface V1Turn {
  readonly key: string;
  readonly turnId: string | null;
  readonly pendingMessageId: string | null;
  readonly state: string;
  readonly requestedAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
}

/** A message's light columns. */
export interface V1MessageHead {
  readonly id: string;
  readonly role: string;
  readonly turnId: string | null;
  readonly createdAt: string;
}

/**
 * An activity's light columns; `payload` only for the kinds whose payload is small (everything
 * but a tool's or a task's), which the plan reads whole.
 */
export interface V1ActivityHead {
  readonly id: string;
  readonly kind: string;
  readonly summary: string;
  readonly turnId: string | null;
  readonly callId: string | null;
  readonly taskId: string | null;
  readonly createdAt: string;
  readonly sequence: number | null;
  readonly payload: unknown;
}

export interface V1Skeleton {
  readonly turns: ReadonlyArray<V1Turn>;
  readonly messages: ReadonlyArray<V1MessageHead>;
  readonly activities: ReadonlyArray<V1ActivityHead>;
}

/** What a slice of the plan needs read whole: messages' words, tools' and tasks' payloads. */
export interface V1Bodies {
  readonly messages: ReadonlyMap<
    string,
    { readonly text: string; readonly attachments: ReadonlyArray<unknown> }
  >;
  readonly activities: ReadonlyMap<
    string,
    { readonly kind: string; readonly summary: string; readonly payload: unknown }
  >;
}

// ── the plan ────────────────────────────────────────────────────────────────────────────────

export type Entry =
  | { readonly kind: "run"; readonly run: number }
  /** The bounds left older turns with V1: the first thing the oldest run brought over says so. */
  | {
      readonly kind: "cut";
      readonly run: number;
      readonly item: number;
      readonly left: number;
      readonly at: number;
    }
  | {
      readonly kind: "message";
      readonly run: number;
      readonly item: number;
      readonly id: string;
      readonly role: string;
      readonly at: number;
    }
  | {
      readonly kind: "call" | "work";
      readonly run: number;
      readonly item: number;
      /** The lifecycle's activities, oldest first. */
      readonly ids: ReadonlyArray<string>;
      readonly at: number;
      readonly endedAt: number | null;
    }
  | {
      readonly kind: "request";
      readonly run: number;
      readonly item: number;
      readonly request: number;
      readonly activities: ReadonlyArray<V1ActivityHead>;
      readonly at: number;
    }
  | {
      readonly kind: "marker";
      readonly run: number;
      readonly item: number;
      readonly activity: V1ActivityHead;
      readonly at: number;
    };

export interface PlannedRun {
  readonly turn: V1Turn;
  /** The error that ended the turn, as V1 recorded its break. */
  readonly brokeOff: { readonly words: string; readonly turnEnd: string } | null;
  /** When its last record was made: the end of a turn V1 never closed. */
  readonly lastAt: number;
}

export interface Plan {
  readonly runs: ReadonlyArray<PlannedRun>;
  /** Every record in order: each run, then what it holds. The import's cursor indexes it. */
  readonly entries: ReadonlyArray<Entry>;
  /** Turns older than the bounds: left with V1. */
  readonly leftTurns: number;
}

const ms = (iso: string): number => {
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : 0;
};

const TOOL = new Set(["tool.started", "tool.updated", "tool.completed"]);
const TASK = new Set(["task.started", "task.progress", "task.updated", "task.completed"]);
const REQUEST = new Set([
  "approval.requested",
  "approval.resolved",
  "user-input.requested",
  "user-input.resolved",
  "user-input.answer-submitted",
]);
/** What V1 draws nowhere: live ticks, the meter's readings, a capture that went well. */
const UNSHOWN = new Set(["tool.progress", "context-window.updated", "checkpoint.captured"]);

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const asText = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value : undefined;

const requestKeyOf = (activity: V1ActivityHead): string =>
  asText(asRecord(activity.payload)?.requestId) ?? `activity:${activity.id}`;

const byTime = <A extends { readonly at: number; readonly order: number; readonly id: string }>(
  left: A,
  right: A,
) => left.at - right.at || left.order - right.order || left.id.localeCompare(right.id);

/**
 * The thread's turns in order, the newest `HISTORY_TURN_LIMIT` (fewer when they hold more than
 * `HISTORY_RECORD_LIMIT` records, the newest turn always whole), and what each holds: by its turn
 * id, a person's message by the turn it started, anything else by the turn it was made in.
 */
export const planOf = (
  skeleton: V1Skeleton,
  limits: { readonly turns: number; readonly records: number } = {
    turns: HISTORY_TURN_LIMIT,
    records: HISTORY_RECORD_LIMIT,
  },
): Plan => {
  const turns = skeleton.turns.toSorted(
    (left, right) =>
      ms(left.requestedAt) - ms(right.requestedAt) || left.key.localeCompare(right.key),
  );
  const starts = turns.map((turn) => ms(turn.requestedAt));
  const byTurnId = new Map(
    turns.flatMap((turn, index) => (turn.turnId === null ? [] : [[turn.turnId, index] as const])),
  );
  const byPending = new Map(
    turns.flatMap((turn, index) =>
      turn.pendingMessageId === null ? [] : [[turn.pendingMessageId, index] as const],
    ),
  );
  /** The turn a record made at `at` falls in: the latest asked at or before it. */
  const turnAt = (at: number): number => {
    let low = 0;
    let high = starts.length - 1;
    let found = -1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (starts[middle]! <= at) {
        found = middle;
        low = middle + 1;
      } else high = middle - 1;
    }
    return found;
  };

  type Placed = { readonly at: number; readonly order: number; readonly id: string };
  const held = turns.map(() => ({
    messages: [] as Array<Placed & { readonly head: V1MessageHead }>,
    activities: [] as Array<Placed & { readonly head: V1ActivityHead }>,
  }));
  for (const head of skeleton.messages) {
    const at = ms(head.createdAt);
    const turn =
      (head.role === "user" ? byPending.get(head.id) : undefined) ??
      (head.turnId === null ? undefined : byTurnId.get(head.turnId)) ??
      turnAt(at);
    if (turn >= 0) held[turn]!.messages.push({ at, order: -1, id: head.id, head });
  }
  /**
   * The turn each call is drawn in, as V1 draws it (`callTurns` in the web's conversation): the
   * first turn one of its activities names, else where its first activity falls. Claude can start a
   * call before the turn that files its completion; the call is one, in that turn.
   */
  const callTurn = new Map<string, number>();
  const callNamed = new Set<string>();
  for (const head of skeleton.activities.toSorted(
    (left, right) =>
      ms(left.createdAt) - ms(right.createdAt) ||
      (left.sequence ?? 0) - (right.sequence ?? 0) ||
      left.id.localeCompare(right.id),
  )) {
    if (!TOOL.has(head.kind) || head.callId === null || callNamed.has(head.callId)) continue;
    const named = head.turnId === null ? undefined : byTurnId.get(head.turnId);
    if (named !== undefined) {
      callTurn.set(head.callId, named);
      callNamed.add(head.callId);
    } else if (!callTurn.has(head.callId)) callTurn.set(head.callId, turnAt(ms(head.createdAt)));
  }
  for (const head of skeleton.activities) {
    if (UNSHOWN.has(head.kind)) continue;
    const at = ms(head.createdAt);
    const turn =
      (TOOL.has(head.kind) && head.callId !== null ? callTurn.get(head.callId) : undefined) ??
      (head.turnId === null ? undefined : byTurnId.get(head.turnId)) ??
      turnAt(at);
    if (turn >= 0)
      held[turn]!.activities.push({ at, order: head.sequence ?? 0, id: head.id, head });
  }

  // What each turn's records come to: one per message, one per lifecycle, one per marker.
  const sized = held.map((turn) => {
    const groups = new Set<string>();
    for (const { head } of turn.activities) {
      groups.add(
        TOOL.has(head.kind) && head.callId !== null
          ? `call:${head.callId}`
          : TASK.has(head.kind) && head.taskId !== null
            ? `task:${head.taskId}`
            : REQUEST.has(head.kind)
              ? `request:${requestKeyOf(head)}`
              : `one:${head.id}`,
      );
    }
    return 1 + turn.messages.length + groups.size;
  });
  let first = Math.max(0, turns.length - limits.turns);
  let total = sized.slice(first).reduce((sum, size) => sum + size, 0);
  // The marker a cut leaves counts too.
  while (first < turns.length - 1 && total + (first > 0 ? 1 : 0) > limits.records) {
    total -= sized[first]!;
    first++;
  }

  const runs: Array<PlannedRun> = [];
  const entries: Array<Entry> = [];
  for (let index = first; index < turns.length; index++) {
    const run = index - first + 1;
    const turn = turns[index]!;
    const { messages, activities } = held[index]!;
    let items = 0;
    let requests = 0;
    let brokeOff: PlannedRun["brokeOff"] = null;
    const placed: Array<Placed & { readonly entry: (item: number) => Entry }> = [];
    for (const message of messages) {
      if (message.head.role === "system") continue;
      placed.push({
        ...message,
        entry: (item) => ({
          kind: "message",
          run,
          item,
          id: message.head.id,
          role: message.head.role,
          at: message.at,
        }),
      });
    }
    const lifecycles = new Map<string, Array<Placed & { readonly head: V1ActivityHead }>>();
    const requestsByKey = new Map<string, Array<V1ActivityHead>>();
    for (const activity of activities.toSorted(byTime)) {
      const { head } = activity;
      const lifecycle =
        TOOL.has(head.kind) && head.callId !== null
          ? `call:${head.callId}`
          : TASK.has(head.kind) && head.taskId !== null
            ? `task:${head.taskId}`
            : undefined;
      if (lifecycle !== undefined) {
        const known = lifecycles.get(lifecycle);
        if (known !== undefined) {
          known.push(activity);
          continue;
        }
        const group = [activity];
        lifecycles.set(lifecycle, group);
        const kind = TOOL.has(head.kind) ? ("call" as const) : ("work" as const);
        placed.push({
          ...activity,
          entry: (item) => ({
            kind,
            run,
            item,
            ids: group.map((member) => member.head.id),
            at: activity.at,
            endedAt: endOf(
              kind,
              group.map((member) => member.head),
            ),
          }),
        });
        continue;
      }
      if (TOOL.has(head.kind) || TASK.has(head.kind)) {
        const kind = TOOL.has(head.kind) ? ("call" as const) : ("work" as const);
        placed.push({
          ...activity,
          entry: (item) => ({
            kind,
            run,
            item,
            ids: [head.id],
            at: activity.at,
            endedAt: endOf(kind, [head]),
          }),
        });
        continue;
      }
      if (REQUEST.has(head.kind)) {
        const key = requestKeyOf(head);
        const known = requestsByKey.get(key);
        if (known !== undefined) {
          known.push(head);
          continue;
        }
        const group = [head];
        requestsByKey.set(key, group);
        placed.push({
          ...activity,
          entry: (item) => ({
            kind: "request",
            run,
            item,
            request: ++requests,
            activities: group,
            at: activity.at,
          }),
        });
        continue;
      }
      const turnEnd = asText(asRecord(head.payload)?.turnEnd);
      if (head.kind === "runtime.error" && turnEnd !== undefined) {
        // The break that ended the turn: the run's end says it, as V1's row did.
        brokeOff = { words: asText(asRecord(head.payload)?.message) ?? head.summary, turnEnd };
        continue;
      }
      placed.push({
        ...activity,
        entry: (item) => ({ kind: "marker", run, item, activity: head, at: activity.at }),
      });
    }
    entries.push({ kind: "run", run });
    if (run === 1 && first > 0) {
      entries.push({
        kind: "cut",
        run: 1,
        item: ++items,
        left: first,
        at: ms(turn.requestedAt) - 1,
      });
    }
    let lastAt = ms(turn.requestedAt);
    for (const record of placed.toSorted(byTime)) {
      const entry = record.entry(++items);
      lastAt = Math.max(lastAt, record.at);
      entries.push(entry);
    }
    runs.push({ turn, brokeOff, lastAt });
  }
  return { runs, entries, leftTurns: first };
};

/** When a lifecycle ended; none while V1 never heard its end. */
const endOf = (kind: "call" | "work", heads: ReadonlyArray<V1ActivityHead>): number | null => {
  if (kind === "call") {
    const completed = heads.findLast((head) => head.kind === "tool.completed");
    return completed === undefined ? null : ms(completed.createdAt);
  }
  const last = heads.at(-1);
  return last?.kind === "task.completed" ? ms(last.createdAt) : null;
};

// ── the records ─────────────────────────────────────────────────────────────────────────────

/** Who the import acts for: the person who wrote is not recorded in V1, so the engine vouches. */
const IMPORTER: Principal = { kind: "engine" };
const MATE: ItemActor = { kind: "mate" };
const PERSON: ItemActor = { kind: "person", principal: IMPORTER };
const ENGINE: ItemActor = { kind: "engine" };

const isPresentation = Schema.is(ToolPresentation);
const decodeImage = Schema.decodeUnknownOption(ChatImageAttachment);

/** How a V1 turn ended, as a run's end and who said so. */
const endOfRun = (run: PlannedRun): { readonly end: RunEnd; readonly source: RunEndSource } => {
  const broke = run.brokeOff;
  if (broke !== null) {
    switch (broke.turnEnd) {
      case "crash":
        return { end: { kind: "crashed", reason: broke.words }, source: "inferred-from-crash" };
      case "usage-limit":
        return { end: { kind: "usage-limit", resetsAt: null }, source: "agent" };
      default:
        return { end: { kind: "failed", reason: broke.words, next: null }, source: "agent" };
    }
  }
  switch (run.turn.state) {
    case "completed":
      return { end: { kind: "completed" }, source: "agent" };
    case "interrupted":
      return { end: { kind: "stopped", by: IMPORTER }, source: "stop-asked" };
    case "error":
      return {
        end: { kind: "failed", reason: "The turn failed.", next: null },
        source: "agent",
      };
    case "pending":
      return {
        end: {
          kind: "failed",
          reason: "It was never sent: the conversation moved to the new engine first.",
          next: null,
        },
        source: "inferred-from-restart",
      };
    default:
      return {
        end: {
          kind: "cut-by-restart",
          continuedBy: null,
          notContinued: "it ran on the previous engine",
          words: "The Mate moved to the new engine.",
        },
        source: "inferred-from-restart",
      };
  }
};

/**
 * A tool's V1 payload, bounded: past the limit its result text goes, then its output, then all
 * but its words and its pictures' references (`pictures.ts` already made them references).
 */
export const boundedCallData = (payload: unknown): unknown => {
  const record = asRecord(payload);
  if (record === undefined) return payload;
  let kept: Record<string, unknown> = record;
  const fits = () => JSON.stringify(kept).length <= CALL_DATA_LIMIT;
  if (fits()) return kept;
  const keptData = asRecord(kept.data);
  const keptZerops = asRecord(keptData?.zerops);
  if (keptZerops?.resultText !== undefined) {
    kept = {
      ...kept,
      data: { ...keptData, zerops: { ...without(keptZerops, "resultText"), truncated: true } },
    };
    if (fits()) return kept;
  }
  kept = without(
    { ...kept, data: without(asRecord(kept.data) ?? {}, "rawOutput", "result", "output") },
    "result",
    "output",
  );
  if (fits()) return kept;
  const detail = asText(kept.detail);
  const pictures = asRecord(asRecord(kept.data)?.zerops)?.images;
  return {
    ...(kept.itemType === undefined ? {} : { itemType: kept.itemType }),
    ...(kept.toolCallId === undefined ? {} : { toolCallId: kept.toolCallId }),
    ...(kept.status === undefined ? {} : { status: kept.status }),
    ...(kept.title === undefined ? {} : { title: kept.title }),
    ...(detail === undefined ? {} : { detail: detail.slice(0, 2_000) }),
    data: {
      toolName: asRecord(kept.data)?.toolName ?? null,
      // Its pictures are references: they stay whatever else had to go.
      ...(Array.isArray(pictures) ? { zerops: { images: pictures, truncated: true } } : {}),
    },
    truncated: true,
  };
};

const without = (record: Record<string, unknown>, ...keys: ReadonlyArray<string>) =>
  Object.fromEntries(Object.entries(record).filter(([key]) => !keys.includes(key)));

const CALL_STATES: Readonly<Record<string, Extract<ItemBody, { kind: "call" }>["state"]>> = {
  completed: "done",
  failed: "failed",
  declined: "declined",
  stopped: "stopped",
};

const WORK_STATES: Readonly<Record<string, Extract<ItemBody, { kind: "work" }>["status"]>> = {
  completed: "completed",
  failed: "failed",
  stopped: "stopped",
  cancelled: "stopped",
  interrupted: "stopped",
};

const attachmentOf = (raw: unknown): PersonAttachment => {
  const image = decodeImage(raw);
  if (Option.isSome(image)) return image.value;
  const type = asText(asRecord(raw)?.type);
  return { type: "unknown", was: type ?? "unknown" };
};

const capped = (text: string): { readonly text: string; readonly detail?: string } =>
  text.length > ITEM_TEXT_LIMIT ? { text: text.slice(0, ITEM_TEXT_LIMIT), detail: text } : { text };

export interface Records {
  readonly records: ReadonlyArray<ImportedRecord>;
  readonly details: ReadonlyArray<ItemDetailDraft>;
  readonly data: ReadonlyArray<ItemDataDraft>;
}

/** The plan's entries `from`..`to` as the engine's imported records, with their parts. */
export const recordsOf = (
  conversation: ConversationId,
  plan: Plan,
  from: number,
  to: number,
  bodies: V1Bodies,
): Records => {
  const records: Array<ImportedRecord> = [];
  const details: Array<ItemDetailDraft> = [];
  const data: Array<ItemDataDraft> = [];
  const runOf = (ordinal: number): RunId => deriveRunId(conversation, ordinal);
  const item = (
    run: number,
    ordinal: number,
    by: ItemActor,
    body: ItemBody,
    at: number,
  ): ItemId => {
    const id = deriveItemId(runOf(run), ordinal);
    records.push({ _tag: "ItemImported", runId: runOf(run), itemId: id, by, body, happenedAt: at });
    return id;
  };
  for (const entry of plan.entries.slice(from, to)) {
    switch (entry.kind) {
      case "run": {
        const planned = plan.runs[entry.run - 1]!;
        const { end, source } = endOfRun(planned);
        const turn = planned.turn;
        records.push({
          _tag: "RunImported",
          runId: runOf(entry.run),
          ordinal: entry.run,
          trigger: { kind: "imported", from: "v1", turn: turn.turnId },
          principal: IMPORTER,
          end,
          source,
          happenedAt: ms(turn.requestedAt),
          startedAt: turn.startedAt === null ? null : ms(turn.startedAt),
          endedAt: turn.completedAt === null ? planned.lastAt : ms(turn.completedAt),
        });
        break;
      }
      case "message": {
        const body = bodies.messages.get(entry.id);
        const text = body?.text ?? "";
        if (entry.role === "user") {
          item(
            entry.run,
            entry.item,
            PERSON,
            {
              kind: "person",
              text,
              attachments: (body?.attachments ?? []).map(attachmentOf),
              sendId: CommandId.make(entry.id),
              delivery: { state: "delivered", at: entry.at },
            },
            entry.at,
          );
        } else if (entry.role === "reasoning") {
          const id = item(
            entry.run,
            entry.item,
            MATE,
            {
              kind: "thought",
              preview: text.slice(0, THOUGHT_PREVIEW),
              length: text.length,
              streaming: false,
            },
            entry.at,
          );
          if (text.length > THOUGHT_PREVIEW) details.push({ itemId: id, body: text });
        } else {
          const note = capped(text);
          const id = item(
            entry.run,
            entry.item,
            MATE,
            { kind: "note", text: note.text, streaming: false, answer: false },
            entry.at,
          );
          if (note.detail !== undefined) details.push({ itemId: id, body: note.detail });
        }
        break;
      }
      case "call": {
        const lifecycle = entry.ids.flatMap((id) => {
          const activity = bodies.activities.get(id);
          return activity === undefined
            ? []
            : [{ ...activity, payload: projectedPayload(activity) }];
        });
        // A call V1 heard return has returned: an update kept after its completion (V1 records
        // one in the same millisecond) carries no end and never takes it back.
        const last =
          lifecycle.findLast((activity) => activity.kind === "tool.completed") ?? lifecycle.at(-1);
        const payload = asRecord(last?.payload) ?? {};
        const started = asRecord(lifecycle[0]?.payload) ?? {};
        const itemType =
          asText(payload.itemType) ?? asText(started.itemType) ?? "dynamic_tool_call";
        const toolData = { ...asRecord(started.data), ...asRecord(payload.data) };
        const toolName = asText(toolData.toolName) ?? itemType;
        const server = asText(toolData.server) ?? /^mcp__(.+?)__/.exec(toolName)?.[1];
        const status = asText(payload.status);
        const ended = last?.kind === "tool.completed";
        const state =
          payload.unreturned === true
            ? "unreturned"
            : ended
              ? (CALL_STATES[status ?? "completed"] ?? "done")
              : planStopped(plan, entry.run)
                ? "stopped"
                : "unreturned";
        const presentation = payload.presentation ?? started.presentation;
        const helper = asText(payload.agentId) ?? asText(started.agentId);
        // The call as V1 drew it: its start's words and input, under its last state.
        const merged = { ...started, ...payload, data: toolData };
        const callData = {
          source: "v1",
          kind: last?.kind ?? "tool.started",
          summary: last?.summary ?? null,
          payload: boundedCallData(merged),
        };
        // The record a live call of the same kind carries: its step, input line, facts, result.
        const { step, ...fields } = importedCallFields(callData);
        const id = item(
          entry.run,
          entry.item,
          helper === undefined ? MATE : { kind: "helper", helperId: helper },
          {
            kind: "call",
            step: step ?? "tool",
            ...fields,
            tool: { name: toolName, ...(server === undefined ? {} : { server }) },
            words: asText(payload.title) ?? asText(started.title) ?? last?.summary ?? null,
            state,
            endedAt: entry.endedAt,
            ...(isPresentation(presentation) ? { presentation } : {}),
          },
          entry.at,
        );
        data.push({ itemId: id, data: callData });
        break;
      }
      case "work": {
        const lifecycle = entry.ids.flatMap((id) => {
          const activity = bodies.activities.get(id);
          return activity === undefined ? [] : [activity];
        });
        const payloads = lifecycle.map((activity) => asRecord(activity.payload) ?? {});
        const first = payloads[0] ?? {};
        const last = payloads.at(-1) ?? {};
        const taskType = asText(last.taskType) ?? asText(first.taskType);
        const agentKind = asText(first.agentKind) ?? asText(last.agentKind);
        const kind = classifyTaskAgentKind({
          taskType,
          agentId: asText(first.agentId) ?? asText(last.agentId),
        });
        const workKind =
          (agentKind ?? kind) === "agent"
            ? "helper"
            : taskType === "monitor" || taskType === "monitor_mcp"
              ? "monitor"
              : taskType === "local_bash" || taskType === "shell"
                ? "shell"
                : "other";
        const endedStatus = payloads
          .map((payload) => asText(payload.status))
          .findLast((status) => status !== undefined && WORK_STATES[status] !== undefined);
        const title =
          asText(last.title) ??
          asText(first.title) ??
          asText(first.detail) ??
          lifecycle[0]?.summary ??
          null;
        item(
          entry.run,
          entry.item,
          MATE,
          {
            kind: "work",
            work: asText(first.taskId) ?? entry.ids[0]!,
            workKind,
            // Work V1 never heard end is over now: nothing will report it again.
            status: endedStatus === undefined ? "lost" : WORK_STATES[endedStatus]!,
            title,
          },
          entry.at,
        );
        break;
      }
      case "request": {
        const runId = runOf(entry.run);
        const requestId = deriveRequestId(runId, entry.request);
        const asked = entry.activities.find((head) => head.kind.endsWith(".requested"));
        const resolved = entry.activities.findLast((head) => head.kind.endsWith(".resolved"));
        const askedPayload = asRecord(asked?.payload) ?? {};
        const resolvedPayload = asRecord(resolved?.payload) ?? {};
        const isApproval = (asked ?? resolved)?.kind.startsWith("approval.") === true;
        const ask: RequestAsk = isApproval
          ? {
              kind: "approval",
              requestKind:
                asText(askedPayload.requestKind) ?? asText(askedPayload.requestType) ?? "approval",
              detail: asText(askedPayload.detail) ?? asked?.summary ?? "",
            }
          : {
              kind: "question",
              questions: Array.isArray(askedPayload.questions) ? askedPayload.questions : [],
              dismissible: false,
            };
        const { state, summary } = resolutionOf(isApproval, resolved, resolvedPayload);
        item(entry.run, entry.item, ENGINE, { kind: "request", requestId }, entry.at);
        records.push({
          _tag: "RequestImported",
          runId,
          requestId: RequestId.make(requestId),
          ask,
          state,
          ...(summary === null || resolved === undefined
            ? {}
            : { answer: { by: IMPORTER, at: ms(resolved.createdAt), summary } }),
          principal: IMPORTER,
          happenedAt: entry.at,
        });
        break;
      }
      case "cut":
        item(
          entry.run,
          entry.item,
          ENGINE,
          {
            kind: "marker",
            marker: {
              kind: "history-cut",
              reason: `${entry.left} earlier ${entry.left === 1 ? "turn" : "turns"} stayed with the previous engine: this conversation starts here.`,
            },
          },
          entry.at,
        );
        break;
      case "marker": {
        const id = item(entry.run, entry.item, ENGINE, markerOf(entry.activity), entry.at);
        // A plan's steps are its data, as V1 recorded them.
        if (
          entry.activity.kind === "turn.plan.updated" ||
          entry.activity.kind === "proposed-plan"
        ) {
          data.push({
            itemId: id,
            data: { source: "v1", kind: entry.activity.kind, payload: entry.activity.payload },
          });
        }
        break;
      }
    }
  }
  return { records, details, data };
};

/** A tool's payload as V1's clients read it. */
const projectedPayload = (activity: {
  readonly kind: string;
  readonly summary: string;
  readonly payload: unknown;
}): unknown =>
  projectActivityPayload({
    id: "import" as never,
    tone: "tool",
    kind: activity.kind,
    summary: activity.summary,
    payload: activity.payload,
    turnId: null,
    createdAt: "1970-01-01T00:00:00.000Z" as never,
  }).payload;

const planStopped = (plan: Plan, run: number) => plan.runs[run - 1]?.turn.state === "interrupted";

/** An approval's decision or a question's answers, as the record shows them. */
const resolutionOf = (
  isApproval: boolean,
  resolved: V1ActivityHead | undefined,
  payload: Record<string, unknown>,
): {
  readonly state: "answered" | "declined" | "dismissed" | "lapsed";
  readonly summary: string | null;
} => {
  if (resolved === undefined) return { state: "lapsed", summary: null };
  if (isApproval) {
    const decision = asText(payload.decision);
    const declined = decision === "decline" || decision === "cancel";
    return {
      state: declined ? "declined" : "answered",
      summary: decision === undefined ? "Resolved" : declined ? "Declined" : "Allowed",
    };
  }
  if (resolved.summary === "User input dismissed")
    return { state: "dismissed", summary: "Dismissed" };
  const answers = asRecord(payload.answers);
  const words =
    answers === undefined
      ? []
      : Object.values(answers).flatMap((answer) =>
          typeof answer === "string"
            ? [answer]
            : Array.isArray(answer)
              ? answer.filter((part): part is string => typeof part === "string")
              : ((asRecord(answer)?.answers as ReadonlyArray<unknown> | undefined)?.filter(
                  (part): part is string => typeof part === "string",
                ) ?? []),
        );
  return { state: "answered", summary: words.length === 0 ? "Answered" : words.join(", ") };
};

/** The V1 events a person read as an error. */
const ERRORS = new Set(["runtime.error", "tool.denied", "checkpoint.revert.failed"]);

/** A V1 event the record keeps as a marker: what V1's row said. */
const markerOf = (activity: V1ActivityHead): ItemBody => {
  const payload = asRecord(activity.payload) ?? {};
  const words =
    asText(payload.message) ?? asText(payload.detail)?.split("\n")[0] ?? activity.summary;
  switch (activity.kind) {
    case "context-compaction":
      return { kind: "marker", marker: { kind: "compacted" } };
    case "runtime.warning":
      return { kind: "marker", marker: { kind: "warning", reason: words } };
    case "turn.plan.updated":
      return {
        kind: "marker",
        marker: { kind: "plan", reason: asText(payload.explanation) ?? activity.summary },
      };
    case "checkpoint.capture.failed":
      return { kind: "marker", marker: { kind: "capture-gap", reason: words } };
    case "proposed-plan":
      return {
        kind: "marker",
        marker: {
          kind: "plan",
          reason:
            asText(payload.planMarkdown)
              ?.split("\n")
              .find((line) => line.trim().length > 0)
              ?.replace(/^#+\s*/, "") ?? activity.summary,
        },
      };
  }
  if (ERRORS.has(activity.kind) || /^provider\..*\.failed$/.test(activity.kind)) {
    return {
      kind: "marker",
      marker: {
        kind: "error",
        reason:
          activity.kind === "runtime.error" || words === activity.summary
            ? words
            : `${activity.summary}: ${words}`,
      },
    };
  }
  // Anything else V1 noted (a runtime note, a kind of a later V1): its kind and its words.
  return { kind: "marker", marker: { kind: activity.kind, reason: activity.summary } };
};
