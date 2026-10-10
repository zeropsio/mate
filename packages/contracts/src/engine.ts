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
import { MateRestart } from "./zeropsAttention.ts";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

import { CommandId, PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProviderOptionSelection } from "./model.ts";
import {
  ChatFileAttachment,
  ChatImageAttachment,
  ProviderInteractionMode,
  ProviderUserInputAnswers,
  RuntimeMode,
  UserInputAttachments,
} from "./orchestration.ts";
import { ToolPresentation } from "./providerRuntime.ts";
import { callFields } from "./engineCall.ts";
import { CrewSeam, CrewTaskId } from "./zeropsCrew.ts";
import { CREW_SESSION_REASONS, CrewHandle } from "./zeropsCrewStates.ts";

// ── ids ──────────────────────────────────────────────────────────────────────────────────────

const engineId = <Brand extends string>(brand: Parameters<typeof Schema.brand<Brand>>[0]) =>
  TrimmedNonEmptyString.pipe(Schema.brand<Brand>(brand));

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
/** Whether an id is an engine item's (`${run}/i/${ordinal}`), never a V1 message's. */
export const isEngineItemId = (id: string): boolean => /\/r\/\d+\/i\/\d+$/.test(id);
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

// ── owners ──────────────────────────────────────────────────────────────────────────────────

/**
 * Whose events a row of the engine's log is: a conversation's, or a Mate's crew (its own
 * `decide`, one writer per crew). An owner kind from a newer build decodes as `unknown`.
 */
export const OWNER_KINDS = ["conversation", "crew"] as const;
export const OwnerKind = forwardCompatibleLiterals(OWNER_KINDS);
export type OwnerKind = typeof OwnerKind.Type;

/**
 * The crew owner's id: one crew per Mate. It lives in the conversations' id space, so its events,
 * effects and wakes derive their ids as a conversation's do; a conversation is named by its thread
 * or its crewmate (`crew-<crew>-<handle>-<n>`), never with a slash, so none takes this one.
 */
export const CREW_OWNER_ID: ConversationId = ConversationId.make("crew/main");

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
      restart: Schema.optionalKey(MateRestart),
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

/**
 * Why a run exists: a person's message, or a wake (`cause: "self"` for an agent-started turn), or
 * a turn the conversation had on the engine before this one, copied in as it ended (`imported`:
 * never sent, never woken, its requests never answerable).
 */
export const RunTrigger = forwardCompatibleUnion({
  key: "kind",
  known: ["person", "wake", "imported", "unknown"],
  members: [
    Schema.Struct({ kind: Schema.Literal("person"), itemId: ItemId }),
    Schema.Struct({
      kind: Schema.Literal("wake"),
      cause: Schema.String,
      wakeId: Schema.NullOr(WakeId),
    }),
    Schema.Struct({
      kind: Schema.Literal("imported"),
      /** The engine the turn ran on (`v1`) and its id there; null for a message never sent. */
      from: Schema.String,
      turn: Schema.NullOr(Schema.String),
    }),
  ],
  fallback: unknownKind,
  toFallback: toUnknownKind,
});
export type RunTrigger = typeof RunTrigger.Type;

/** The existing turn presentation, projected by the server; null when the end is unknown. */
export const RunTurnState = Schema.NullOr(
  forwardCompatibleLiterals(["running", "completed", "interrupted", "error"]),
);
export type RunTurnState = typeof RunTurnState.Type;

/** The current run's existing session presentation, excluding queued messages and background jobs. */
export const ConversationRunStatus = forwardCompatibleLiterals(["running", "error", "ready"]);

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

// ── crew on the record ──────────────────────────────────────────────────────────────────────

/**
 * What a crew card is for: a task's first turn, carrying it on in a new session, resolving a
 * merge's conflicts, fixing a failed check, reworking after a review, the lead's review or a
 * crewmate's question put to the lead, the lead's answer, the one nudge after a turn without a
 * report, and showing work on a dev service or giving it back.
 */
export const CREW_CARD_KINDS = [
  "task",
  "continue",
  "resolve",
  "fix",
  "rework",
  "review",
  "question",
  "answer",
  "nudge",
  "claim-start",
  "claim-release",
] as const;

/** Something a card names that a client can open. */
export const CrewCardLink = forwardCompatibleUnion({
  key: "kind",
  known: ["crewmate", "path", "commit", "host", "conversation", "unknown"],
  members: [
    Schema.Struct({ kind: Schema.Literal("crewmate"), handle: CrewHandle }),
    Schema.Struct({ kind: Schema.Literal("path"), path: Schema.String }),
    Schema.Struct({ kind: Schema.Literal("commit"), commit: TrimmedNonEmptyString }),
    Schema.Struct({ kind: Schema.Literal("host"), host: TrimmedNonEmptyString }),
    Schema.Struct({ kind: Schema.Literal("conversation"), conversationId: ConversationId }),
  ],
  fallback: unknownKind,
  toFallback: toUnknownKind,
});
export type CrewCardLink = typeof CrewCardLink.Type;

/**
 * A crew card: what the crew sent a crewmate (or the lead) as a turn, typed on its `note` item so
 * a client draws it without reading the words the agent got.
 */
export const CrewCard = Schema.Struct({
  kind: forwardCompatibleLiterals(CREW_CARD_KINDS),
  /** `null` for a card about no task (showing work on dev). */
  taskId: Schema.NullOr(CrewTaskId),
  /** The task's `#N`; `null` with `taskId`. */
  number: Schema.NullOr(PositiveInt),
  /** The task's title, or the heading of a card about no task. */
  title: Schema.String,
  /**
   * The words the card exists for: the task's brief, the question, the answer, the failed check's
   * output, the review's note. Empty when its kind says it all.
   */
  why: Schema.String,
  /** The task's *Done when*; `null` when it has none, or the card is not a task's first. */
  doneWhen: Schema.NullOr(Schema.String),
  links: Schema.Array(CrewCardLink),
});
export type CrewCard = typeof CrewCard.Type;

/** A crew seam as a `crew.seam` marker holds it: a seam from a newer build decodes as unknown. */
export const RecordedCrewSeam = forwardCompatibleUnion({
  key: "seam",
  known: ["landed", "closed", "saved", "stint", "swept", "unknown"],
  members: CrewSeam.members,
  fallback: Schema.Struct({ seam: Schema.Literal("unknown"), type: Schema.String }),
  toFallback: (_raw, type) => ({ seam: "unknown" as const, type }),
});
export type RecordedCrewSeam = typeof RecordedCrewSeam.Type;

// ── items ───────────────────────────────────────────────────────────────────────────────────

/**
 * What a person's message carries besides its text: a picture as main's chat attachment, its
 * bytes held by the asset store and referenced by occurrence. A newer build's kind of
 * attachment decodes as `unknown`, keeping its type.
 */
export const PersonAttachment = forwardCompatibleUnion({
  key: "type",
  known: ["image", "file", "unknown"],
  members: [ChatImageAttachment, ChatFileAttachment],
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
    /** Pictures by reference (their asset occurrence) and files by id, never bytes. */
    attachments: Schema.Array(PersonAttachment),
    sendId: CommandId,
    delivery: Schema.Struct({
      /** `unknown`: a restart cut its send mid-flight; it may or may not have arrived. */
      state: forwardCompatibleLiterals(["queued", "delivered", "steered", "refused", "unknown"]),
      at: Schema.NullOr(Millis),
    }),
  },
  note: {
    text: Schema.String,
    streaming: Schema.Boolean,
    answer: Schema.Boolean,
    /** The crew's card, on a note the crew sent as a turn. */
    card: Schema.optionalKey(CrewCard),
  },
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
    ...callFields,
  },
  request: { requestId: RequestId },
  /** Background work the agent started (a helper, a shell, a monitor), under the run it served. */
  work: {
    work: Schema.String,
    workKind: forwardCompatibleLiterals(WORK_KINDS),
    status: forwardCompatibleLiterals(WORK_STATUSES),
    title: Schema.NullOr(Schema.String),
    /** The call that started it: the command sent to the background, the helper's launch. */
    call: Schema.optionalKey(ItemId),
    /** What it said as it ended, in a line: `Background command "…" failed with exit code 3`. */
    report: Schema.optionalKey(Schema.String),
  },
  context: { notes: Schema.Array(Schema.String) },
  marker: {
    marker: Schema.Struct({
      kind: Schema.String,
      reason: Schema.optionalKey(Schema.String),
      model: Schema.optionalKey(Schema.String),
      /** A crew seam's facts, on a marker of kind `crew.seam`. */
      seam: Schema.optionalKey(RecordedCrewSeam),
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
      /** What it waits on; one a later engine adds reads as `unknown`, never a refusal. */
      on: forwardCompatibleLiterals(["approval", "question", "vault", "plan"]),
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
  runStatus: Schema.optionalKey(ConversationRunStatus),
  latestRun: Schema.NullOr(
    Schema.Struct({
      id: RunId,
      end: Schema.NullOr(RunEnd),
      endedAt: Schema.NullOr(Millis),
      turnState: Schema.optionalKey(RunTurnState),
    }),
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
 * turn; it sat idle; a setting only a new session runs with (a model option, the runtime mode).
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
  "settings",
] as const;
export const SessionCloseReason = forwardCompatibleLiterals(SESSION_CLOSE_REASONS);
export type SessionCloseReason = typeof SessionCloseReason.Type;

export const SessionCapabilities = Schema.Struct({
  /** The driver really injects a message into a running turn. */
  steer: Schema.Boolean,
  /**
   * The model options the session takes on its next send (`all`: every option goes per turn); a
   * change of any other needs a new session. Absent: none.
   */
  inSessionOptions: Schema.optionalKey(
    Schema.Union([Schema.Literal("all"), Schema.Array(Schema.String)]),
  ),
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
  /** The turn's interaction mode (`plan`: the agent plans, changes nothing); absent: default. */
  interactionMode: Schema.optionalKey(ProviderInteractionMode),
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
/**
 * What a run's end says beyond its kind: it outgrew its context, the provider broke it off, or it
 * was refused (admission's sentence in `refusal`).
 */
export const RunEndDetail = forwardCompatibleLiterals(["overflow", "provider-error", "refused"]);
export type RunEndDetail = typeof RunEndDetail.Type;

export const RunEnded = event("RunEnded", {
  runId: RunId,
  end: RunEnd,
  source: RunEndSource,
  /** What the run cost, as its driver reported it; absent when it reported none. */
  costUsd: Schema.optionalKey(Schema.Number),
  /** The context the conversation held when the run ended: its last gauge reading. */
  contextTokens: Schema.optionalKey(Schema.Int),
  detail: Schema.optionalKey(RunEndDetail),
  /** The refusal's own words, for a run that was refused. */
  refusal: Schema.optionalKey(Schema.String),
});
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
  /** The model options it opened with. */
  options: Schema.optionalKey(Schema.Array(ProviderOptionSelection)),
  /** The runtime mode it opened with: a session fits only the conversation's. */
  runtimeMode: Schema.optionalKey(RuntimeMode),
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
/** Why a conversation's session is rotated between turns (`zeropsCrewStates.ts` says each). */
export const RotateSessionReason = forwardCompatibleLiterals(CREW_SESSION_REASONS);
export type RotateSessionReason = typeof RotateSessionReason.Type;

/**
 * The conversation's session is rotated between turns: the open one closes before the next run
 * (never under a running turn), and the next one opens fresh on a thread of its own (`fresh`) or
 * resumes, told `seed` as it starts. The boundary is recorded as a marker and the seed as a
 * `context` item.
 */
export const SessionRotated = event("SessionRotated", {
  reason: RotateSessionReason,
  fresh: Schema.Boolean,
  seed: Schema.NullOr(Schema.String),
});
/** A usage limit whose reset nobody knew stops holding the queue (the person wrote again). */
export const UsagePauseLifted = event("UsagePauseLifted", { reason: Schema.String });
/**
 * The conversation is given the agent it belongs to (and runs that agent's model). `keepsThread`:
 * an instance of the same driver whose sessions resume the old one's, so its thread carries over.
 */
export const AgentAssigned = event("AgentAssigned", {
  agent: ConversationAgent,
  by: Principal,
  keepsThread: Schema.optionalKey(Schema.Boolean),
});
/** The conversation's next model and, when given, its options (absent: the options it had). */
export const ModelSwitched = event("ModelSwitched", {
  model: Schema.String,
  by: Principal,
  options: Schema.optionalKey(Schema.Array(ProviderOptionSelection)),
});
/** How freely the agent works from its next session on (a live session reopens between runs). */
export const RuntimeModeSet = event("RuntimeModeSet", { runtimeMode: RuntimeMode, by: Principal });
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

// ── imported history ────────────────────────────────────────────────────────────────────────

/**
 * One V1 thread of a chain: a crewmate's stint. `reason` is why it opened, as a crewmate's
 * session reason (`null` for the first); `words` are V1's own words for it.
 */
export const HistoryStint = Schema.Struct({
  threadId: Schema.String,
  reason: Schema.NullOr(Schema.String),
  words: Schema.NullOr(Schema.String),
});
export type HistoryStint = typeof HistoryStint.Type;

/**
 * Where a conversation's earlier record comes from: the V1 thread it continues, or, for a
 * crewmate, the chain of its stints oldest first (`threadId` is then the first of them).
 */
export const HistorySource = Schema.Struct({
  kind: Schema.Literal("v1"),
  threadId: Schema.String,
  chain: Schema.optionalKey(Schema.Array(HistoryStint)),
});
export type HistorySource = typeof HistorySource.Type;

/**
 * A conversation starts copying its earlier record in, once: its first `runs` ordinals are the
 * imported turns', and no run is admitted until the import ends.
 */
export const HistoryImportStarted = event("HistoryImportStarted", {
  source: HistorySource,
  runs: Schema.Int,
});
/** A turn of the earlier record, as it ended. `happenedAt` is when it was asked, there. */
export const RunImported = event("RunImported", {
  runId: RunId,
  ordinal: Schema.Int,
  trigger: RunTrigger,
  principal: Principal,
  end: RunEnd,
  source: RunEndSource,
  happenedAt: Millis,
  startedAt: Schema.NullOr(Millis),
  endedAt: Schema.NullOr(Millis),
});
/** An item of the earlier record, closed as it was left. `happenedAt` is when it was made. */
export const ItemImported = event("ItemImported", {
  runId: Schema.NullOr(RunId),
  itemId: ItemId,
  by: ItemActor,
  body: ItemBody,
  happenedAt: Millis,
});
/** A request of the earlier record, in its final state: never answerable here. */
export const RequestImported = event("RequestImported", {
  runId: RunId,
  requestId: RequestId,
  ask: RequestAsk,
  state: StoredRequestState,
  answer: Schema.optionalKey(Schema.Struct({ by: Principal, at: Millis, summary: Schema.String })),
  principal: Principal,
  happenedAt: Millis,
});
/** How far the import has come: the next record of its plan. */
export const HistoryBatchImported = event("HistoryBatchImported", { cursor: Schema.Int });
/** The import is over: every record copied, or the rest could not be read (`failed`). */
export const HistoryImportEnded = event("HistoryImportEnded", {
  outcome: Schema.Literals(["complete", "failed"]),
  reason: Schema.optionalKey(Schema.String),
});

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
  SessionRotated,
  UsagePauseLifted,
  AgentAssigned,
  ModelSwitched,
  RuntimeModeSet,
  ConversationArchived,
  ConversationUnarchived,
  EffectRequested,
  EffectOutcomeRecorded,
  WakeArmed,
  WakeFired,
  WakeCancelled,
  HistoryImportStarted,
  RunImported,
  ItemImported,
  RequestImported,
  HistoryBatchImported,
  HistoryImportEnded,
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

// ── internal commands ───────────────────────────────────────────────────────────────────────

/**
 * The crew's command to a crewmate's conversation: close its session between turns and open the
 * next one. `fresh` opens it without resuming (a `budget` rotation resumes); `seed` is the state
 * packet, recorded as a `context` item at the boundary and given to the agent as its session
 * starts. Its own schema, since a `crew.deliver` effect stores it.
 */
export const RotateSession = Schema.TaggedStruct("RotateSession", {
  reason: RotateSessionReason,
  fresh: Schema.Boolean,
  seed: Schema.NullOr(Schema.String),
});
export type RotateSession = typeof RotateSession.Type;

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
  /** A picture the call carries could not be claimed: the detail says why, in V1's words. */
  "attachment-refused",
  "stale-session",
  "unknown-effect",
  "wake-not-armed",
  "invalid-wake",
  "invalid-signal",
  "invalid-principal",
  /** The id names another owner (the crew), which takes no conversation's command. */
  "not-a-conversation",
  /** The agent's background work lives in the session a change would replace. */
  "background-work",
  /** The conversation started on another driver: its agent cannot change to this one. */
  "agent-locked",
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
