/**
 * The Mate engine's domain and event contracts.
 *
 * Ids are derived from their cause, never random: a retry or a restart derives the same id and
 * converges on the same row. Every stored event carries a schema version `v`; a reader decodes a
 * tag it does not know as `Unknown` (keeping its order and run) and refuses a known tag whose body
 * is damaged. Times are epoch milliseconds on the server clock; the wire adapter formats them.
 *
 * @module engine
 */
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

import { CommandId, TrimmedNonEmptyString } from "./baseSchemas.ts";

// ── ids ──────────────────────────────────────────────────────────────────────────────────────

const engineId = <Brand extends string>(brand: Brand) =>
  TrimmedNonEmptyString.pipe(Schema.brand(brand));

export const ConversationId = engineId("EngineConversationId");
export type ConversationId = typeof ConversationId.Type;
export const RunId = engineId("EngineRunId");
export type RunId = typeof RunId.Type;
export const ItemId = engineId("EngineItemId");
export type ItemId = typeof ItemId.Type;
export const RequestId = engineId("EngineRequestId");
export type RequestId = typeof RequestId.Type;
export const EffectId = engineId("EngineEffectId");
export type EffectId = typeof EffectId.Type;
export const WakeId = engineId("EngineWakeId");
export type WakeId = typeof WakeId.Type;
export const SessionId = engineId("EngineSessionId");
export type SessionId = typeof SessionId.Type;
export const BootId = engineId("EngineBootId");
export type BootId = typeof BootId.Type;

/** `${conversation}/r/${ordinal}`: the conversation's n-th run. */
export const runId = (conversation: ConversationId, ordinal: number): RunId =>
  RunId.make(`${conversation}/r/${ordinal}`);
/** `${run}/i/${ordinal}`: the run's n-th item. */
export const itemId = (run: RunId, ordinal: number): ItemId => ItemId.make(`${run}/i/${ordinal}`);
/** `${run}/q/${ordinal}`: the run's n-th request. */
export const requestId = (run: RunId, ordinal: number): RequestId =>
  RequestId.make(`${run}/q/${ordinal}`);
/** `${cause}/e/${kind}/${n}`: the n-th effect of a kind its cause asked for. */
export const effectId = (cause: string, kind: string, n: number): EffectId =>
  EffectId.make(`${cause}/e/${kind}/${n}`);
/** `${owner}/w/${kind}/${key}`: one wake per owner, kind and key; arming it again moves it. */
export const wakeId = (owner: ConversationId, kind: string, key: string): WakeId =>
  WakeId.make(`${owner}/w/${kind}/${key}`);

/** Epoch milliseconds on the server clock. */
export const Millis = Schema.Number;
export type Millis = typeof Millis.Type;

// ── forward compatibility ───────────────────────────────────────────────────────────────────

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * A union discriminated by `key` whose member set grows: a known discriminator decodes strictly
 * (a damaged body fails), an unknown one decodes to the fallback member built by `toFallback`.
 */
const forwardCompatibleUnion = <
  const Members extends ReadonlyArray<Schema.Top>,
  Fallback extends Schema.Top,
>(options: {
  readonly key: string;
  readonly known: ReadonlyArray<string>;
  readonly members: Members;
  readonly fallback: Fallback;
  readonly toFallback: (raw: Record<string, unknown>, tag: string) => Fallback["Encoded"];
}) => {
  const known = new Set(options.known);
  const union = Schema.Union([...options.members, options.fallback]);
  return Schema.Unknown.pipe(
    Schema.decodeTo(
      union,
      SchemaTransformation.transform<(typeof union)["Encoded"], unknown>({
        decode: (raw) => {
          if (!isRecord(raw)) return raw as (typeof union)["Encoded"];
          const tag = raw[options.key];
          if (typeof tag !== "string" || known.has(tag)) return raw as (typeof union)["Encoded"];
          return options.toFallback(raw, tag);
        },
        encode: (value) => value,
      }),
    ),
  );
};

// ── principals and actors ───────────────────────────────────────────────────────────────────

/** Whose authority a run or an answer carries (D6). */
export const Principal = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("person"), subject: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("crew"), startedBy: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("standup"), startedBy: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("engine") }),
]);
export type Principal = typeof Principal.Type;

/** Who made an item. */
export const ItemActor = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("mate") }),
  Schema.Struct({ kind: Schema.Literal("helper"), helperId: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("person"), principal: Principal }),
  Schema.Struct({ kind: Schema.Literal("engine") }),
]);
export type ItemActor = typeof ItemActor.Type;

// ── runs ────────────────────────────────────────────────────────────────────────────────────

export const RunState = Schema.Literals([
  "queued",
  "admitted",
  "sending",
  "running",
  "waiting",
  "ended",
]);
export type RunState = typeof RunState.Type;

/** What ended a run. */
export const RunEnd = forwardCompatibleUnion({
  key: "kind",
  known: ["completed", "stopped", "failed", "crashed", "usage-limit", "cut-by-restart", "unknown"],
  members: [
    Schema.Struct({ kind: Schema.Literal("completed") }),
    Schema.Struct({ kind: Schema.Literal("stopped"), by: Principal }),
    Schema.Struct({
      kind: Schema.Literal("failed"),
      reason: Schema.String,
      next: Schema.NullOr(Schema.String),
    }),
    Schema.Struct({ kind: Schema.Literal("crashed"), reason: Schema.String }),
    Schema.Struct({ kind: Schema.Literal("usage-limit"), resetsAt: Schema.NullOr(Millis) }),
    Schema.Struct({
      kind: Schema.Literal("cut-by-restart"),
      continuedBy: Schema.NullOr(RunId),
      notContinued: Schema.optionalKey(Schema.String),
    }),
  ],
  fallback: Schema.Struct({ kind: Schema.Literal("unknown"), type: Schema.String }),
  toFallback: (_raw, type) => ({ kind: "unknown" as const, type }),
});
export type RunEnd = typeof RunEnd.Type;
export type RunEndKind = RunEnd["kind"];

/**
 * Who said the run ended: the agent itself; the bridge, inferring it from a crash or a failed
 * effect; the engine on a Stop no provider confirmed; or the provider confirming a Stop.
 */
export const RunEndSource = Schema.Literals(["agent", "inferred", "stop-asked", "stop-confirmed"]);
export type RunEndSource = typeof RunEndSource.Type;

/** Why a run exists: a person's message, or a wake (`cause: "self"` for an agent-started turn). */
export const RunTrigger = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("person"), itemId: ItemId }),
  Schema.Struct({
    kind: Schema.Literal("wake"),
    cause: Schema.String,
    wakeId: Schema.NullOr(WakeId),
  }),
]);
export type RunTrigger = typeof RunTrigger.Type;

/** A run as the engine projects it. */
export const Run = Schema.Struct({
  id: RunId,
  conversationId: ConversationId,
  ordinal: Schema.Int,
  seq: Schema.Int,
  rev: Schema.Int,
  trigger: RunTrigger,
  /** The run this one continues: a wake folds into the run it reports on, by fact. */
  joins: Schema.NullOr(RunId),
  principal: Principal,
  state: RunState,
  /** A maintenance command (`/compact`, `/logout`): never continued after a restart. */
  maintenance: Schema.Boolean,
  waitingOn: Schema.NullOr(
    Schema.Struct({ kind: Schema.Literal("request"), requestId: RequestId }),
  ),
  stopAsked: Schema.NullOr(Schema.Struct({ by: Principal, at: Millis })),
  end: Schema.NullOr(RunEnd),
  endSource: Schema.NullOr(RunEndSource),
  sessionId: Schema.NullOr(SessionId),
  providerTurnId: Schema.NullOr(Schema.String),
  queuedAt: Millis,
  admittedAt: Schema.NullOr(Millis),
  startedAt: Schema.NullOr(Millis),
  endedAt: Schema.NullOr(Millis),
  /** "unresponsive": a mark, never an end. */
  unresponsiveSince: Schema.NullOr(Millis),
});
export type Run = typeof Run.Type;

// ── items ───────────────────────────────────────────────────────────────────────────────────

const itemBodyFields = {
  person: {
    text: Schema.String,
    attachments: Schema.Array(Schema.String),
    sendId: CommandId,
    delivery: Schema.Struct({
      state: Schema.Literals(["queued", "delivered", "steered", "refused"]),
      at: Schema.NullOr(Millis),
    }),
  },
  note: { text: Schema.String, streaming: Schema.Boolean, answer: Schema.Boolean },
  thought: { preview: Schema.String, length: Schema.Int, streaming: Schema.Boolean },
  call: {
    step: Schema.String,
    tool: Schema.Struct({ name: Schema.String, server: Schema.optionalKey(Schema.String) }),
    words: Schema.NullOr(Schema.String),
    state: Schema.Literals(["running", "done", "failed", "declined", "stopped", "unreturned"]),
    endedAt: Schema.NullOr(Millis),
  },
  request: { requestId: RequestId },
  context: { notes: Schema.Array(Schema.String) },
  marker: {
    marker: Schema.Struct({
      kind: Schema.String,
      reason: Schema.optionalKey(Schema.String),
      model: Schema.optionalKey(Schema.String),
    }),
  },
} as const;
const unknownItemFields = { type: Schema.String, summary: Schema.NullOr(Schema.String) };
const itemKinds = [...Object.keys(itemBodyFields), "unknown"];

/** What an item is, without where it sits: the part a driver's signal carries. */
export const ItemBody = forwardCompatibleUnion({
  key: "kind",
  known: itemKinds,
  members: [
    Schema.Struct({ kind: Schema.Literal("person"), ...itemBodyFields.person }),
    Schema.Struct({ kind: Schema.Literal("note"), ...itemBodyFields.note }),
    Schema.Struct({ kind: Schema.Literal("thought"), ...itemBodyFields.thought }),
    Schema.Struct({ kind: Schema.Literal("call"), ...itemBodyFields.call }),
    Schema.Struct({ kind: Schema.Literal("request"), ...itemBodyFields.request }),
    Schema.Struct({ kind: Schema.Literal("context"), ...itemBodyFields.context }),
    Schema.Struct({ kind: Schema.Literal("marker"), ...itemBodyFields.marker }),
  ],
  fallback: Schema.Struct({ kind: Schema.Literal("unknown"), ...unknownItemFields }),
  toFallback: (raw, type) => ({
    kind: "unknown" as const,
    type,
    summary: typeof raw.summary === "string" ? raw.summary : null,
  }),
});
export type ItemBody = typeof ItemBody.Type;

const itemBaseFields = {
  id: ItemId,
  conversationId: ConversationId,
  runId: Schema.NullOr(RunId),
  /** Conversation sequence at creation: THE order. */
  seq: Schema.Int,
  /** Conversation sequence of its latest change. */
  rev: Schema.Int,
  at: Millis,
  by: ItemActor,
};

/** An item of the conversation's record, flattened as the clients read it. */
export const Item = forwardCompatibleUnion({
  key: "kind",
  known: itemKinds,
  members: [
    Schema.Struct({ ...itemBaseFields, kind: Schema.Literal("person"), ...itemBodyFields.person }),
    Schema.Struct({ ...itemBaseFields, kind: Schema.Literal("note"), ...itemBodyFields.note }),
    Schema.Struct({
      ...itemBaseFields,
      kind: Schema.Literal("thought"),
      ...itemBodyFields.thought,
    }),
    Schema.Struct({ ...itemBaseFields, kind: Schema.Literal("call"), ...itemBodyFields.call }),
    Schema.Struct({
      ...itemBaseFields,
      kind: Schema.Literal("request"),
      ...itemBodyFields.request,
    }),
    Schema.Struct({
      ...itemBaseFields,
      kind: Schema.Literal("context"),
      ...itemBodyFields.context,
    }),
    Schema.Struct({ ...itemBaseFields, kind: Schema.Literal("marker"), ...itemBodyFields.marker }),
  ],
  fallback: Schema.Struct({
    ...itemBaseFields,
    kind: Schema.Literal("unknown"),
    ...unknownItemFields,
  }),
  toFallback: (raw, type) => ({
    id: raw.id as string,
    conversationId: raw.conversationId as string,
    runId: (raw.runId ?? null) as string | null,
    seq: raw.seq as number,
    rev: raw.rev as number,
    at: raw.at as number,
    by: raw.by as ItemActor,
    kind: "unknown" as const,
    type,
    summary: typeof raw.summary === "string" ? raw.summary : null,
  }),
});
export type Item = typeof Item.Type;

// ── requests ────────────────────────────────────────────────────────────────────────────────

export const RequestAsk = forwardCompatibleUnion({
  key: "kind",
  known: ["approval", "question", "vault", "plan", "unknown"],
  members: [
    Schema.Struct({
      kind: Schema.Literal("approval"),
      requestKind: Schema.String,
      detail: Schema.String,
    }),
    Schema.Struct({
      kind: Schema.Literal("question"),
      questions: Schema.Array(Schema.Unknown),
      dismissible: Schema.Boolean,
    }),
    Schema.Struct({
      kind: Schema.Literal("vault"),
      key: Schema.String,
      scope: Schema.Union([
        Schema.Struct({ kind: Schema.Literal("shared") }),
        Schema.Struct({ kind: Schema.Literal("service"), hostname: Schema.String }),
      ]),
      sensitive: Schema.Boolean,
      reason: Schema.NullOr(Schema.String),
    }),
    Schema.Struct({ kind: Schema.Literal("plan"), planItemId: ItemId }),
  ],
  fallback: Schema.Struct({ kind: Schema.Literal("unknown"), type: Schema.String }),
  toFallback: (_raw, type) => ({ kind: "unknown" as const, type }),
});
export type RequestAsk = typeof RequestAsk.Type;

export const RequestState = Schema.Literals([
  "open",
  "answered",
  "declined",
  "dismissed",
  "lapsed",
]);
export type RequestState = typeof RequestState.Type;

export const Request = Schema.Struct({
  id: RequestId,
  conversationId: ConversationId,
  runId: RunId,
  seq: Schema.Int,
  rev: Schema.Int,
  at: Millis,
  ask: RequestAsk,
  state: RequestState,
  /** False once the session that owned the callback is gone. */
  answerable: Schema.Boolean,
  answer: Schema.optionalKey(Schema.Struct({ by: Principal, at: Millis, summary: Schema.String })),
  principal: Principal,
});
export type Request = typeof Request.Type;

// ── the conversation row ────────────────────────────────────────────────────────────────────

export const ConversationRowState = forwardCompatibleUnion({
  key: "kind",
  known: ["idle", "queued", "working", "waiting", "paused", "failed", "unknown"],
  members: [
    Schema.Struct({ kind: Schema.Literal("idle") }),
    Schema.Struct({ kind: Schema.Literal("queued"), since: Millis }),
    Schema.Struct({
      kind: Schema.Literal("working"),
      since: Millis,
      waitsOnHelpers: Schema.Boolean,
    }),
    Schema.Struct({
      kind: Schema.Literal("waiting"),
      on: Schema.Literals(["approval", "question", "vault", "plan"]),
      words: Schema.NullOr(Schema.String),
    }),
    Schema.Struct({ kind: Schema.Literal("paused"), resetsAt: Schema.NullOr(Millis) }),
    Schema.Struct({ kind: Schema.Literal("failed"), errorLine: Schema.String }),
  ],
  fallback: Schema.Struct({ kind: Schema.Literal("unknown") }),
  toFallback: () => ({ kind: "unknown" as const }),
});
export type ConversationRowState = typeof ConversationRowState.Type;

/** The menu row, the face, HQ's relayed row. */
export const ConversationRow = Schema.Struct({
  conversationId: ConversationId,
  agent: Schema.Union([
    Schema.Struct({ kind: Schema.Literal("mate") }),
    Schema.Struct({ kind: Schema.Literal("crewmate"), id: Schema.String, name: Schema.String }),
  ]),
  revision: Schema.Struct({ environmentId: Schema.String, epoch: Schema.Int, seq: Schema.Int }),
  state: ConversationRowState,
  activeRunId: Schema.NullOr(RunId),
  latestRun: Schema.NullOr(
    Schema.Struct({ id: RunId, end: Schema.NullOr(RunEnd), endedAt: Schema.NullOr(Millis) }),
  ),
  subject: Schema.NullOr(Schema.String),
  snippet: Schema.NullOr(Schema.String),
  at: Millis,
  askedAt: Schema.NullOr(Millis),
});
export type ConversationRow = typeof ConversationRow.Type;

// ── sessions, effects, wakes ────────────────────────────────────────────────────────────────

export const SessionCloseReason = Schema.Literals(["model", "exited", "restart", "closed"]);
export type SessionCloseReason = typeof SessionCloseReason.Type;

export const SessionCapabilities = Schema.Struct({
  /** The driver really injects a message into a running turn. */
  steer: Schema.Boolean,
});
export type SessionCapabilities = typeof SessionCapabilities.Type;

/** What an effect came to: done, failed for good, or cut by a restart before it finished. */
export const EffectOutcome = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("ok"), value: Schema.optionalKey(Schema.Unknown) }),
  Schema.Struct({ kind: Schema.Literal("failed"), reason: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("cut"), reason: Schema.String }),
]);
export type EffectOutcome = typeof EffectOutcome.Type;

// ── events ──────────────────────────────────────────────────────────────────────────────────

/** The schema version every event this build writes carries. */
export const ENGINE_EVENT_VERSION = 1;

const eventHeader = {
  v: Schema.Int,
  conversationId: ConversationId,
  /** Gapless per conversation. */
  seq: Schema.Int,
  at: Millis,
  commandId: CommandId,
};

const event = <const Tag extends string, const Fields extends Schema.Struct.Fields>(
  tag: Tag,
  fields: Fields,
) => Schema.TaggedStruct(tag, { ...eventHeader, ...fields });

export const RunQueued = event("RunQueued", {
  runId: RunId,
  ordinal: Schema.Int,
  trigger: RunTrigger,
  joins: Schema.NullOr(RunId),
  principal: Principal,
  maintenance: Schema.Boolean,
  /** What the run sends the agent when admitted. */
  text: Schema.String,
});
export const RunAdmitted = event("RunAdmitted", { runId: RunId });
export const RunSending = event("RunSending", {
  runId: RunId,
  sessionId: SessionId,
  effectId: EffectId,
});
export const RunStarted = event("RunStarted", {
  runId: RunId,
  providerTurnId: Schema.NullOr(Schema.String),
});
export const RunWaiting = event("RunWaiting", { runId: RunId, requestId: RequestId });
export const RunResumed = event("RunResumed", { runId: RunId });
export const RunStopAsked = event("RunStopAsked", {
  runId: RunId,
  by: Principal,
  effectId: Schema.NullOr(EffectId),
});
export const RunEnded = event("RunEnded", { runId: RunId, end: RunEnd, source: RunEndSource });
export const RunNotContinued = event("RunNotContinued", { runId: RunId, reason: Schema.String });
export const RunUnresponsive = event("RunUnresponsive", { runId: RunId, silentSince: Millis });
export const RunResponsive = event("RunResponsive", { runId: RunId });
export const ItemOpened = event("ItemOpened", {
  runId: Schema.NullOr(RunId),
  itemId: ItemId,
  /** The driver's own key for the item, to match its later signals. */
  key: Schema.NullOr(Schema.String),
  by: ItemActor,
  body: ItemBody,
});
export const ItemUpdated = event("ItemUpdated", {
  runId: Schema.NullOr(RunId),
  itemId: ItemId,
  body: ItemBody,
});
export const ItemClosed = event("ItemClosed", {
  runId: Schema.NullOr(RunId),
  itemId: ItemId,
  body: ItemBody,
});
export const RequestOpened = event("RequestOpened", {
  runId: RunId,
  requestId: RequestId,
  key: Schema.String,
  ask: RequestAsk,
  answerable: Schema.Boolean,
  principal: Principal,
});
export const RequestAnswered = event("RequestAnswered", {
  runId: RunId,
  requestId: RequestId,
  by: Principal,
  summary: Schema.String,
  effectId: EffectId,
});
export const RequestClosed = event("RequestClosed", {
  runId: RunId,
  requestId: RequestId,
  state: RequestState,
});
export const SessionOpened = event("SessionOpened", {
  sessionId: SessionId,
  driver: Schema.String,
  model: Schema.NullOr(Schema.String),
  nativeRef: Schema.NullOr(Schema.String),
  capabilities: SessionCapabilities,
  rotatedFrom: Schema.NullOr(SessionId),
});
export const SessionClosed = event("SessionClosed", {
  sessionId: SessionId,
  reason: SessionCloseReason,
});
export const ModelSwitched = event("ModelSwitched", { model: Schema.String, by: Principal });
export const ConversationArchived = event("ConversationArchived", { by: Principal });
export const ConversationUnarchived = event("ConversationUnarchived", { by: Principal });
export const EffectRequested = event("EffectRequested", {
  effectId: EffectId,
  kind: Schema.String,
  runId: Schema.NullOr(RunId),
});
export const EffectOutcomeRecorded = event("EffectOutcomeRecorded", {
  effectId: EffectId,
  kind: Schema.String,
  outcome: EffectOutcome,
});
export const WakeArmed = event("WakeArmed", {
  wakeId: WakeId,
  kind: Schema.String,
  dueAt: Millis,
  cron: Schema.NullOr(Schema.String),
  principal: Principal,
  joins: Schema.NullOr(RunId),
  text: Schema.NullOr(Schema.String),
});
export const WakeFired = event("WakeFired", { wakeId: WakeId, dueAt: Millis });
export const WakeCancelled = event("WakeCancelled", { wakeId: WakeId, reason: Schema.String });

/** An event from a newer engine: its order and run hold, its body is not read. */
export const UnknownEngineEvent = Schema.TaggedStruct("Unknown", {
  ...eventHeader,
  type: Schema.String,
  runId: Schema.optionalKey(RunId),
});

const knownEvents = [
  RunQueued,
  RunAdmitted,
  RunSending,
  RunStarted,
  RunWaiting,
  RunResumed,
  RunStopAsked,
  RunEnded,
  RunNotContinued,
  RunUnresponsive,
  RunResponsive,
  ItemOpened,
  ItemUpdated,
  ItemClosed,
  RequestOpened,
  RequestAnswered,
  RequestClosed,
  SessionOpened,
  SessionClosed,
  ModelSwitched,
  ConversationArchived,
  ConversationUnarchived,
  EffectRequested,
  EffectOutcomeRecorded,
  WakeArmed,
  WakeFired,
  WakeCancelled,
] as const;

/** Every event this build knows: what `decide` emits and `evolve` folds. */
export const KnownEngineEvent = Schema.Union(knownEvents);
export type KnownEngineEvent = typeof KnownEngineEvent.Type;
export type EngineEventTag = KnownEngineEvent["_tag"];

/** A stored event: known tags decode strictly, a newer engine's tag decodes as `Unknown`. */
export const EngineEvent = forwardCompatibleUnion({
  key: "_tag",
  known: [...knownEvents.map((schema) => schema.fields._tag.schema.literal), "Unknown"],
  members: knownEvents,
  fallback: UnknownEngineEvent,
  toFallback: (raw, type) => ({
    _tag: "Unknown" as const,
    v: raw.v as number,
    conversationId: raw.conversationId as string,
    seq: raw.seq as number,
    at: raw.at as number,
    commandId: raw.commandId as string,
    type,
    ...(typeof raw.runId === "string" ? { runId: raw.runId } : {}),
  }),
});
export type EngineEvent = typeof EngineEvent.Type;

// ── command results ─────────────────────────────────────────────────────────────────────────

const rejectionReasons = [
  "archived",
  "empty-message",
  "unknown-run",
  "run-ended",
  "run-not-running",
  "stop-already-asked",
  "unknown-request",
  "not-answerable",
  "steer-unsupported",
  "stale-session",
  "unknown-effect",
  "wake-not-armed",
  "invalid-wake",
  "unknown",
] as const;
const knownRejectionReasons = new Set<string>(rejectionReasons);
const RejectionReasonLiterals = Schema.Literals(rejectionReasons);

/** Why a command was refused; a reason from a newer engine decodes as `"unknown"`. */
export const RejectionReason = Schema.Unknown.pipe(
  Schema.decodeTo(
    RejectionReasonLiterals,
    SchemaTransformation.transform<typeof RejectionReasonLiterals.Encoded, unknown>({
      decode: (raw) =>
        typeof raw === "string" && !knownRejectionReasons.has(raw)
          ? "unknown"
          : (raw as typeof RejectionReasonLiterals.Encoded),
      encode: (value) => value,
    }),
  ),
);
export type RejectionReason = typeof RejectionReason.Type;

export const Rejection = Schema.Struct({
  reason: RejectionReason,
  detail: Schema.optionalKey(Schema.String),
});
export type Rejection = typeof Rejection.Type;

export const CommandResult = Schema.Union([
  Schema.TaggedStruct("Accepted", {
    /** The conversation's head sequence after the step. */
    seq: Schema.Int,
    runId: Schema.optionalKey(RunId),
    itemId: Schema.optionalKey(ItemId),
    requestId: Schema.optionalKey(RequestId),
    wakeId: Schema.optionalKey(WakeId),
  }),
  Schema.TaggedStruct("Rejected", { rejection: Rejection }),
]);
export type CommandResult = typeof CommandResult.Type;
