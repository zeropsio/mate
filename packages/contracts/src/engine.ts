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
import { ProviderOptionSelection } from "./model.ts";
import {
  ChatImageAttachment,
  ProviderUserInputAnswers,
  UserInputAttachments,
} from "./orchestration.ts";
import { ToolPresentation } from "./providerRuntime.ts";

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
/**
 * One turn the bridge reports on: the engine's handle for a message it sent (its run's id), or
 * the bridge's for a turn the agent opened itself. Every turn-scoped signal names one, so a late
 * signal lands on its own run.
 */
export const TurnHandle = TrimmedNonEmptyString.pipe(Schema.brand("TurnHandle"));
export type TurnHandle = typeof TurnHandle.Type;

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
export const forwardCompatibleUnion = <
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

/**
 * A literal set that grows: a known literal decodes as itself, any other string as `"unknown"`;
 * encoding takes only the known literals (and `"unknown"`), so a writer never stores a stray one.
 */
export const forwardCompatibleLiterals = <const Literals extends ReadonlyArray<string>>(
  literals: Literals,
) => {
  const known = new Set<string>(literals);
  const schema = Schema.Literals([...literals, "unknown"] as readonly [...Literals, "unknown"]);
  type Known = Literals[number] | "unknown";
  const transformation = SchemaTransformation.transform<Known, unknown>({
    decode: (raw) => (typeof raw === "string" && !known.has(raw) ? "unknown" : (raw as Known)),
    encode: (value) => value,
  });
  // The generic literal set hides the transformation's exact types from the checker.
  return Schema.Unknown.pipe(Schema.decodeTo(schema, transformation as never));
};

/** The member a newer build's union member decodes to: its kind kept as `type`. */
const unknownKind = Schema.Struct({ kind: Schema.Literal("unknown"), type: Schema.String });
const toUnknownKind = (_raw: Record<string, unknown>, type: string) => ({
  kind: "unknown" as const,
  type,
});

// ── principals and actors ───────────────────────────────────────────────────────────────────

/** Whose authority a run or an answer carries (D6). */
export const Principal = forwardCompatibleUnion({
  key: "kind",
  known: ["person", "crew", "standup", "engine", "unknown"],
  members: [
    Schema.Struct({ kind: Schema.Literal("person"), subject: Schema.String }),
    Schema.Struct({ kind: Schema.Literal("crew"), startedBy: Schema.String }),
    Schema.Struct({ kind: Schema.Literal("standup"), startedBy: Schema.String }),
    Schema.Struct({ kind: Schema.Literal("engine") }),
  ],
  fallback: unknownKind,
  toFallback: toUnknownKind,
});
export type Principal = typeof Principal.Type;

/** Who made an item. */
export const ItemActor = forwardCompatibleUnion({
  key: "kind",
  known: ["mate", "helper", "person", "engine", "unknown"],
  members: [
    Schema.Struct({ kind: Schema.Literal("mate") }),
    Schema.Struct({ kind: Schema.Literal("helper"), helperId: Schema.String }),
    Schema.Struct({ kind: Schema.Literal("person"), principal: Principal }),
    Schema.Struct({ kind: Schema.Literal("engine") }),
  ],
  fallback: unknownKind,
  toFallback: toUnknownKind,
});
export type ItemActor = typeof ItemActor.Type;

// ── runs ────────────────────────────────────────────────────────────────────────────────────

const RUN_STATES = ["queued", "admitted", "sending", "running", "waiting", "ended"] as const;
/** A run's state as this build's rules know it. */
export const RunState = Schema.Literals(RUN_STATES);
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
      /** What the platform said about the restart, shown to the person. */
      words: Schema.optionalKey(Schema.String),
    }),
  ],
  fallback: Schema.Struct({ kind: Schema.Literal("unknown"), type: Schema.String }),
  toFallback: (_raw, type) => ({ kind: "unknown" as const, type }),
});
export type RunEnd = typeof RunEnd.Type;
export type RunEndKind = RunEnd["kind"];

/**
 * Who says a turn ended, as the bridge reports it:
 * - `agent`: the driver reported the end, and no Stop was asked;
 * - `stop-confirmed`: a Stop was asked and the agent itself acknowledged it;
 * - `stop-asked`: a Stop was asked and the end is local, without the agent confirming;
 * - `inferred-from-crash`: no terminal came; the process died or the session was found gone;
 * - `inferred-from-close`: the host closed the session with the turn open;
 * - `inferred-from-next-turn`: the driver opened another turn first.
 */
export const TURN_END_SOURCES = [
  "agent",
  "stop-confirmed",
  "stop-asked",
  "inferred-from-crash",
  "inferred-from-close",
  "inferred-from-next-turn",
] as const;
export const TurnEndSource = forwardCompatibleLiterals(TURN_END_SOURCES);
export type TurnEndSource = typeof TurnEndSource.Type;

/**
 * Who said the run ended: the bridge's word for its turn, or the engine inferring it from a
 * restart or from an effect that failed for good.
 */
export const RunEndSource = forwardCompatibleLiterals([
  ...TURN_END_SOURCES,
  "inferred-from-restart",
  "inferred-from-effect",
]);
export type RunEndSource = typeof RunEndSource.Type;

/** Why a run exists: a person's message, or a wake (`cause: "self"` for an agent-started turn). */
export const RunTrigger = forwardCompatibleUnion({
  key: "kind",
  known: ["person", "wake", "unknown"],
  members: [
    Schema.Struct({ kind: Schema.Literal("person"), itemId: ItemId }),
    Schema.Struct({
      kind: Schema.Literal("wake"),
      cause: Schema.String,
      wakeId: Schema.NullOr(WakeId),
    }),
  ],
  fallback: unknownKind,
  toFallback: toUnknownKind,
});
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
  state: forwardCompatibleLiterals(RUN_STATES),
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

/**
 * What a person's message carries besides its text: a picture as main's chat attachment, its
 * bytes held by the asset store and referenced by occurrence. A newer build's kind of
 * attachment decodes as `unknown`, keeping its type.
 */
export const PersonAttachment = forwardCompatibleUnion({
  key: "type",
  known: ["image", "unknown"],
  members: [ChatImageAttachment],
  fallback: Schema.Struct({ type: Schema.Literal("unknown"), was: Schema.String }),
  toFallback: (_raw, was) => ({ type: "unknown" as const, was }),
});
export type PersonAttachment = typeof PersonAttachment.Type;

/** Background work's kinds and states, as the bridge reports them. */
export const WORK_KINDS = ["helper", "shell", "monitor", "other"] as const;
export const WORK_STATUSES = [
  "running",
  "waiting",
  "idle",
  "completed",
  "failed",
  "stopped",
  /** Still running when its session closed: nothing can report its end. */
  "lost",
] as const;
/** The states after which background work never reports again. */
export const WORK_ENDED: ReadonlySet<string> = new Set(["completed", "failed", "stopped", "lost"]);

const itemBodyFields = {
  person: {
    text: Schema.String,
    /** Pictures by reference (their asset occurrence), never bytes. */
    attachments: Schema.Array(PersonAttachment),
    sendId: CommandId,
    delivery: Schema.Struct({
      /** `unknown`: a restart cut its send mid-flight; it may or may not have arrived. */
      state: forwardCompatibleLiterals(["queued", "delivered", "steered", "refused", "unknown"]),
      at: Schema.NullOr(Millis),
    }),
  },
  note: { text: Schema.String, streaming: Schema.Boolean, answer: Schema.Boolean },
  thought: { preview: Schema.String, length: Schema.Int, streaming: Schema.Boolean },
  call: {
    step: Schema.String,
    tool: Schema.Struct({ name: Schema.String, server: Schema.optionalKey(Schema.String) }),
    words: Schema.NullOr(Schema.String),
    state: forwardCompatibleLiterals([
      "running",
      "done",
      "failed",
      "declined",
      "stopped",
      "unreturned",
    ]),
    endedAt: Schema.NullOr(Millis),
    /** How the call presents itself, as its agent said: an MCP tool's title and server. */
    presentation: Schema.optionalKey(ToolPresentation),
  },
  request: { requestId: RequestId },
  /** Background work the agent started (a helper, a shell, a monitor), under the run it served. */
  work: {
    work: Schema.String,
    workKind: forwardCompatibleLiterals(WORK_KINDS),
    status: forwardCompatibleLiterals(WORK_STATUSES),
    title: Schema.NullOr(Schema.String),
  },
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
    Schema.Struct({ kind: Schema.Literal("work"), ...itemBodyFields.work }),
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
  /**
   * The wire cut the item to its budget: which part, and how long it is whole (UTF-8 bytes). The
   * whole part is read on demand; a stored item never carries it.
   */
  cut: Schema.optionalKey(Schema.Struct({ part: Schema.String, total: Schema.Int })),
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
    Schema.Struct({ ...itemBaseFields, kind: Schema.Literal("work"), ...itemBodyFields.work }),
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
    ...(isRecord(raw.cut) ? { cut: raw.cut as { part: string; total: number } } : {}),
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

/** `expired`: answered, but the driver could no longer take an answer (its callback was gone). */
const REQUEST_STATES = ["open", "answered", "declined", "dismissed", "lapsed", "expired"] as const;
/** A request's state as this build's rules know it. */
export const RequestState = Schema.Literals(REQUEST_STATES);
export type RequestState = typeof RequestState.Type;
/** A request's state as stored and sent: a newer build's state reads `unknown`. */
const StoredRequestState = forwardCompatibleLiterals(REQUEST_STATES);

export const Request = Schema.Struct({
  id: RequestId,
  conversationId: ConversationId,
  runId: RunId,
  seq: Schema.Int,
  rev: Schema.Int,
  at: Millis,
  ask: RequestAsk,
  state: StoredRequestState,
  /** False once the session that owned the callback is gone. */
  answerable: Schema.Boolean,
  answer: Schema.optionalKey(
    Schema.Struct({
      by: Principal,
      at: Millis,
      summary: Schema.String,
      /** A question's answer as the person gave it, by question id. Never a vault value. */
      answers: Schema.optionalKey(ProviderUserInputAnswers),
      /** The pictures attached to each question's answer, by reference. */
      attachmentsByQuestionId: Schema.optionalKey(UserInputAttachments),
    }),
  ),
  principal: Principal,
});
export type Request = typeof Request.Type;

// ── the conversation row ────────────────────────────────────────────────────────────────────

/** Who the conversation's agent is to people: the Mate, or a crewmate of it. */
export const AgentProfile = forwardCompatibleUnion({
  key: "kind",
  known: ["mate", "crewmate", "unknown"],
  members: [
    Schema.Struct({ kind: Schema.Literal("mate") }),
    Schema.Struct({ kind: Schema.Literal("crewmate"), id: Schema.String, name: Schema.String }),
  ],
  fallback: unknownKind,
  toFallback: toUnknownKind,
});
export type AgentProfile = typeof AgentProfile.Type;

/**
 * The agent a conversation belongs to: the provider instance and driver it runs on, the model it
 * runs, and its profile. A client decides what Send may do from it alone (whose sign-in, which
 * driver), never from a model name.
 */
export const ConversationAgent = Schema.Struct({
  instanceId: Schema.String,
  driver: Schema.String,
  model: Schema.NullOr(Schema.String),
  /** The model's options its sessions open with (a new conversation's effort, D10). */
  options: Schema.optionalKey(Schema.Array(ProviderOptionSelection)),
  profile: AgentProfile,
});
export type ConversationAgent = typeof ConversationAgent.Type;

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
  /** Null until the conversation is given its agent. */
  agent: Schema.NullOr(ConversationAgent),
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

/**
 * Why a session closed: a model switch rotated it; it exited; the server restarted; it was closed
 * (a newer session replaced it); the person signed out; a second Stop; a usage limit parked its
 * turn; it sat idle.
 */
export const SESSION_CLOSE_REASONS = [
  "model",
  "exited",
  "restart",
  "closed",
  "signed-out",
  "stop",
  "usage-limit",
  "idle",
] as const;
export const SessionCloseReason = forwardCompatibleLiterals(SESSION_CLOSE_REASONS);
export type SessionCloseReason = typeof SessionCloseReason.Type;

export const SessionCapabilities = Schema.Struct({
  /** The driver really injects a message into a running turn. */
  steer: Schema.Boolean,
});
export type SessionCapabilities = typeof SessionCapabilities.Type;

/**
 * What an effect came to: done, failed for good, cut by a restart before it finished, or timed
 * out waiting on the provider.
 */
export const EffectOutcome = forwardCompatibleUnion({
  key: "kind",
  known: ["ok", "failed", "cut", "timed-out", "unknown"],
  members: [
    Schema.Struct({ kind: Schema.Literal("ok"), value: Schema.optionalKey(Schema.Unknown) }),
    Schema.Struct({
      kind: Schema.Literal("failed"),
      reason: Schema.String,
      /** The other side refused for good: an answer it can no longer take, a run it won't admit. */
      refused: Schema.optionalKey(Schema.Boolean),
      /**
       * A send's word on its message: `true` it never reached the agent (safe to send again on a
       * new session), `false` it did, `"unknown"` nobody can tell.
       */
      undelivered: Schema.optionalKey(Schema.Union([Schema.Boolean, Schema.Literal("unknown")])),
    }),
    Schema.Struct({ kind: Schema.Literal("cut"), reason: Schema.String }),
    /**
     * The provider call gave no answer within its bound: the engine stopped waiting. An effect's
     * outcome only — a run still ends on evidence, never because a call timed out.
     */
    Schema.Struct({ kind: Schema.Literal("timed-out"), after: Millis }),
  ],
  fallback: unknownKind,
  toFallback: toUnknownKind,
});
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
  /** The turn the run lives in: its own handle, or the agent's turn its message joined. */
  turn: Schema.NullOr(TurnHandle),
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
/**
 * A run goes back to the head of the queue before its message reached the agent: a restart cut
 * its send before it started, or the agent opened a turn of its own while the run was prepared.
 */
export const RunRequeued = event("RunRequeued", { runId: RunId, reason: Schema.String });
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
  /** The respond call that takes the answer; absent when a message carries it (`bySend`). */
  effectId: Schema.optionalKey(EffectId),
  /**
   * The run whose person's message carries the answer, for a question asked by message: the
   * request is answered once that message reaches the agent, and opens again if it never does.
   */
  bySend: Schema.optionalKey(RunId),
  /** A question's answer, by question id, and the pictures attached to each: what the record shows. */
  answers: Schema.optionalKey(ProviderUserInputAnswers),
  attachmentsByQuestionId: Schema.optionalKey(UserInputAttachments),
});
/** An answer the provider failed to take: the request is open again for the person. */
export const RequestReopened = event("RequestReopened", {
  runId: RunId,
  requestId: RequestId,
  key: Schema.String,
  principal: Principal,
  reason: Schema.String,
  /** Answers given so far, none taken. */
  answers: Schema.Int,
});
export const RequestClosed = event("RequestClosed", {
  runId: RunId,
  requestId: RequestId,
  state: StoredRequestState,
});
export const SessionOpened = event("SessionOpened", {
  sessionId: SessionId,
  driver: Schema.String,
  /** The model the engine asked for: a session fits by it, never by the driver's spelling. */
  requestedModel: Schema.NullOr(Schema.String),
  /** The model the driver reports, as it spells it. */
  model: Schema.NullOr(Schema.String),
  nativeRef: Schema.NullOr(Schema.String),
  capabilities: SessionCapabilities,
  rotatedFrom: Schema.NullOr(SessionId),
  /** The provider instance the engine opened it on: a session fits only its own instance. */
  instanceId: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
/** The engine asked the session to close; nothing goes into it until it has. */
export const SessionClosing = event("SessionClosing", {
  sessionId: SessionId,
  reason: SessionCloseReason,
  effectId: EffectId,
});
export const SessionClosed = event("SessionClosed", {
  sessionId: SessionId,
  reason: SessionCloseReason,
});
/** A usage limit whose reset nobody knew stops holding the queue (the person wrote again). */
export const UsagePauseLifted = event("UsagePauseLifted", { reason: Schema.String });
/** The conversation is given the agent it belongs to (and runs that agent's model). */
export const AgentAssigned = event("AgentAssigned", { agent: ConversationAgent, by: Principal });
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
  RunRequeued,
  RunUnresponsive,
  RunResponsive,
  ItemOpened,
  ItemUpdated,
  ItemClosed,
  RequestOpened,
  RequestAnswered,
  RequestReopened,
  RequestClosed,
  SessionOpened,
  SessionClosing,
  SessionClosed,
  UsagePauseLifted,
  AgentAssigned,
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
  /** A request its agent waits on: only an answer or a Stop ends it. */
  "not-dismissible",
  "steer-unsupported",
  "stale-session",
  "unknown-effect",
  "wake-not-armed",
  "invalid-wake",
  "invalid-signal",
  "invalid-principal",
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
