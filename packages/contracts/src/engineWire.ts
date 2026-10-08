/**
 * The Mate engine's conversation wire: what a client subscribes to and calls to show and drive a
 * conversation that runs on the engine (capability `mateEngine.protocol`).
 *
 * - **Records arrive ready to draw.** A run carries its summary, an item its body cut to the wire's
 *   budget (the whole part read on demand), a request what it asks; a client renders, never derives.
 * - **Revision** = the Mate's start epoch + the conversation's gapless sequence (`seq`, every
 *   record's `rev`), inside one sequence space (`origin`, the engine's tables). A subscribe returns
 *   a window snapshot, or resumes from a cursor with only what changed since; then `synchronized`,
 *   then changes as they commit.
 * - **Streamed text is never a record.** It rides `live.*` frames keyed by item, and the item's
 *   boundary record replaces it (`live.settle`).
 * - **Every union tolerates unknown members**: an unknown frame, record kind or literal decodes to
 *   its `unknown` member, a damaged record is dropped alone, never the frame.
 * - **Versioned.** Every input names the protocol it speaks; a server that cannot serve it answers
 *   `unserved` (`protocol`: route the person to update; `not-on-engine`: this Mate's conversation
 *   is on the V1 wire), never a failure.
 * - **Calls are idempotent by the engine's command id**: a retry returns the stored receipt; a send
 *   is confirmed when the engine accepts it.
 *
 * @module engineWire
 */
import * as Schema from "effect/Schema";

import { CommandId, ForwardCompatibleArray } from "./baseSchemas.ts";
import {
  CommandResult,
  ConversationAgent,
  ConversationId,
  ConversationRow,
  ConversationRunStatus,
  Item,
  ItemId,
  Millis,
  Request,
  RequestId,
  Run,
  RunId,
  RunTurnState,
  forwardCompatibleLiterals,
  forwardCompatibleUnion,
} from "./engine.ts";
import { ProviderOptionSelection } from "./model.ts";
import {
  ChatFileAttachment,
  ChatImageAttachment,
  ProviderApprovalDecision,
  ProviderInteractionMode,
  ProviderUserInputAnswers,
  RuntimeMode,
  UserInputAttachments,
} from "./orchestration.ts";
import { ThreadTokenUsageSnapshot } from "./providerRuntime.ts";

/** The protocols this build serves; a client speaks the highest it shares with the server. */
export const MATE_ENGINE_PROTOCOLS: ReadonlyArray<number> = [1];

/**
 * What the server's encoder holds every record and frame to (UTF-8 bytes unless named): a record
 * over its budget is cut (`Item.cut` names the part), a frame over its budget is split, a snapshot
 * over its budget carries fewer older run groups.
 */
export const ENGINE_WIRE_BUDGETS = {
  /** An item's body besides its text. */
  itemBytes: 4 * 1024,
  /** A person's or the agent's words inline; the rest is read on demand. */
  itemTextBytes: 16 * 1024,
  runBytes: 8 * 1024,
  requestBytes: 8 * 1024,
  snapshotBytes: 256 * 1024,
  changesBytes: 256 * 1024,
  /** Run groups (a run and the wakes that join it) a snapshot opens with. */
  windowGroups: 10,
  earlierGroupsMax: 20,
  earlierBytes: 256 * 1024,
  /** The live run's newest items a window carries. */
  liveTailItems: 40,
  runPageItems: 200,
  runPageBytes: 512 * 1024,
  detailBytes: 256 * 1024,
  liveFrameBytes: 4 * 1024,
  /** Records a resume may carry; past it the subscriber is reset to a fresh snapshot. */
  resumeRecords: 2_000,
} as const;

// ── records ─────────────────────────────────────────────────────────────────────────────────

/** What a run holds, counted by the server: a closed card draws from it alone. */
export const RunSummary = Schema.Struct({
  /** Items under the run: the card is whole once this many are held. */
  items: Schema.Int,
  /** Calls by step (`command`, `edit`, `web`, `look`, `helper`, `tool`, …). */
  calls: Schema.Record(Schema.String, Schema.Int),
  /**
   * The generic and MCP calls (`tool`, `mcp`) by the tool's name: a card counts some by what they
   * did ("the workflow checked"), some not at all (a deploy is a row of its result).
   */
  tools: Schema.optionalKey(Schema.Record(Schema.String, Schema.Int)),
  /** The files its edits changed, each once, and one for each edit naming none. */
  edited: Schema.optionalKey(Schema.Int),
  /** The agent's last whole words in the run: its answer. */
  answerItemId: Schema.NullOr(ItemId),
  lastItemSeq: Schema.NullOr(Schema.Int),
});
export type RunSummary = typeof RunSummary.Type;

/** A run as the wire carries it. */
export const RunRecord = Schema.Struct({
  ...Run.fields,
  summary: RunSummary,
  turnState: Schema.optionalKey(RunTurnState),
});
export type RunRecord = typeof RunRecord.Type;

/** A mode a newer build may add: any this build does not know decodes as `unknown`. */
const TolerantRuntimeMode = forwardCompatibleLiterals(RuntimeMode.literals);
const TolerantInteractionMode = forwardCompatibleLiterals(ProviderInteractionMode.literals);

/** The conversation's own facts: its agent, its session, what holds its queue. */
export const ConversationHeader = Schema.Struct({
  conversationId: ConversationId,
  agent: Schema.NullOr(ConversationAgent),
  archived: Schema.Boolean,
  /** Current run verdict and identities, from the same server projection as the menu row. */
  runStatus: Schema.optionalKey(ConversationRunStatus),
  activeRunId: Schema.optionalKey(Schema.NullOr(RunId)),
  latestRunId: Schema.optionalKey(Schema.NullOr(RunId)),
  model: Schema.NullOr(Schema.String),
  /** The session open now; `steer` says whether a message may go into a running turn. */
  session: Schema.NullOr(
    Schema.Struct({
      driver: Schema.String,
      model: Schema.NullOr(Schema.String),
      steer: Schema.Boolean,
    }),
  ),
  /** A usage limit holds the queue until then (`unknown`: until a probe or the person). */
  pausedUntil: Schema.NullOr(Schema.Union([Millis, Schema.Literal("unknown")])),
  /** Messages waiting their turn. */
  queued: Schema.Int,
  /** How freely the agent works, once a person set it; absent: the workspace's mode. */
  runtimeMode: Schema.optionalKey(TolerantRuntimeMode),
  /** The interaction mode of the person's latest message; absent: default. */
  interactionMode: Schema.optionalKey(TolerantInteractionMode),
});
export type ConversationHeader = typeof ConversationHeader.Type;

/** Where a subscriber stands: its sequence space, the epoch it was served in, its sequence. */
export const EngineCursor = Schema.Struct({
  epoch: Schema.Int,
  origin: Schema.String,
  seq: Schema.Int,
});
export type EngineCursor = typeof EngineCursor.Type;

const RunRecords = ForwardCompatibleArray(RunRecord);
const ItemRecords = ForwardCompatibleArray(Item);
const RequestRecords = ForwardCompatibleArray(Request);

/** The window a snapshot or a page covers: whether older run groups exist before it. */
export const EngineWindow = Schema.Struct({
  /** The oldest run ordinal held; none when the conversation has no run. */
  oldestOrdinal: Schema.NullOr(Schema.Int),
  earlier: Schema.Boolean,
});
export type EngineWindow = typeof EngineWindow.Type;

// ── frames ──────────────────────────────────────────────────────────────────────────────────

const Unserved = Schema.Struct({
  type: Schema.Literal("unserved"),
  /** `protocol`: update the app (or the Mate); `not-on-engine`: the V1 wire owns it. */
  reason: forwardCompatibleLiterals(["protocol", "not-on-engine"]),
  protocols: Schema.Array(Schema.Int),
  message: Schema.String,
});
export type EngineUnserved = typeof Unserved.Type;

const unknownFrame = Schema.Struct({ type: Schema.Literal("unknown"), was: Schema.String });
const toUnknownFrame = (_raw: Record<string, unknown>, was: string) => ({
  type: "unknown" as const,
  was,
});

const FRAME_TYPES = [
  "snapshot",
  "changes",
  "synchronized",
  "reset",
  "live.open",
  "live.append",
  "live.settle",
  "progress",
  "context",
  "unserved",
  "unknown",
] as const;

/** One frame of a conversation's subscription. */
export const EngineConversationFrame = forwardCompatibleUnion({
  key: "type",
  known: FRAME_TYPES,
  members: [
    /** The window: the newest run groups, the live run's tail, every open request. */
    Schema.Struct({
      type: Schema.Literal("snapshot"),
      protocol: Schema.Int,
      epoch: Schema.Int,
      origin: Schema.String,
      head: Schema.Int,
      header: ConversationHeader,
      runs: RunRecords,
      items: ItemRecords,
      requests: RequestRecords,
      window: EngineWindow,
    }),
    /**
     * Every record that changed in `(from, to]`, whole, upserted by id. A split frame's parts
     * share `from`; all but the last say `to = from`, so a cursor moves only with the last.
     */
    Schema.Struct({
      type: Schema.Literal("changes"),
      epoch: Schema.Int,
      from: Schema.Int,
      to: Schema.Int,
      header: Schema.optionalKey(ConversationHeader),
      runs: RunRecords,
      items: ItemRecords,
      requests: RequestRecords,
    }),
    /** What the subscriber holds is the record at `head`: from here on, live. */
    Schema.Struct({ type: Schema.Literal("synchronized"), epoch: Schema.Int, head: Schema.Int }),
    /**
     * The cursor cannot resume: forget what is held of this conversation, the next frame is a
     * snapshot. `origin`: another sequence space; `epoch`: an epoch from ahead of the server's (a
     * restored state); `ahead`: a sequence past the head; `gap`: more changed than a resume carries.
     */
    Schema.Struct({
      type: Schema.Literal("reset"),
      reason: forwardCompatibleLiterals(["origin", "epoch", "ahead", "gap"]),
    }),
    /** An item's streamed text so far, replacing what the subscriber held of that stream. */
    Schema.Struct({
      type: Schema.Literal("live.open"),
      itemId: ItemId,
      stream: Schema.String,
      text: Schema.String,
    }),
    /** More streamed text, placed at `offset` (in UTF-16 code units) of the stream's text. */
    Schema.Struct({
      type: Schema.Literal("live.append"),
      itemId: ItemId,
      stream: Schema.String,
      offset: Schema.Int,
      text: Schema.String,
    }),
    /** The item's record is whole: drop its streamed text, draw the record. */
    Schema.Struct({ type: Schema.Literal("live.settle"), itemId: ItemId }),
    /** A running call's progress (`null`: none to show any more). */
    Schema.Struct({ type: Schema.Literal("progress"), itemId: ItemId, value: Schema.Unknown }),
    /** How full the agent's context is. */
    Schema.Struct({ type: Schema.Literal("context"), usage: ThreadTokenUsageSnapshot }),
    Unserved,
  ],
  fallback: unknownFrame,
  toFallback: toUnknownFrame,
});
export type EngineConversationFrame = typeof EngineConversationFrame.Type;

/** One frame of a Mate's conversation rows (the menu). */
export const EngineRowsFrame = forwardCompatibleUnion({
  key: "type",
  known: ["snapshot", "row", "synchronized", "unserved", "unknown"],
  members: [
    Schema.Struct({
      type: Schema.Literal("snapshot"),
      protocol: Schema.Int,
      epoch: Schema.Int,
      rows: ForwardCompatibleArray(ConversationRow),
    }),
    Schema.Struct({ type: Schema.Literal("row"), row: ConversationRow }),
    Schema.Struct({ type: Schema.Literal("synchronized"), epoch: Schema.Int }),
    Unserved,
  ],
  fallback: unknownFrame,
  toFallback: toUnknownFrame,
});
export type EngineRowsFrame = typeof EngineRowsFrame.Type;

// ── inputs ──────────────────────────────────────────────────────────────────────────────────

const protocol = { protocol: Schema.Int };

export const EngineSubscribeInput = Schema.Struct({
  ...protocol,
  conversationId: ConversationId,
  /** Resume from here; absent: a fresh snapshot. */
  after: Schema.optionalKey(EngineCursor),
  /** Run groups the window opens with (default and cap: the budget's). */
  groups: Schema.optionalKey(Schema.Int),
});
export type EngineSubscribeInput = typeof EngineSubscribeInput.Type;

export const EngineSubscribeRowsInput = Schema.Struct({ ...protocol });
export type EngineSubscribeRowsInput = typeof EngineSubscribeRowsInput.Type;

/** Older run groups, whole: their runs, the person's messages, answers and requests. */
export const EngineReadEarlierInput = Schema.Struct({
  ...protocol,
  conversationId: ConversationId,
  beforeOrdinal: Schema.Int,
  groups: Schema.optionalKey(Schema.Int),
});
export type EngineReadEarlierInput = typeof EngineReadEarlierInput.Type;

/**
 * A run's items, the newest page first (`beforeSeq` pages back); with `afterSeq`, the oldest page
 * after it (`more`: later ones exist). `only: "outcome"` reads just the items a closed card draws
 * its result from: calls with a result or a picture looked at, and background work.
 */
export const EngineReadRunInput = Schema.Struct({
  ...protocol,
  conversationId: ConversationId,
  runId: RunId,
  beforeSeq: Schema.optionalKey(Schema.Int),
  afterSeq: Schema.optionalKey(Schema.Int),
  only: Schema.optionalKey(Schema.Literal("outcome")),
  limit: Schema.optionalKey(Schema.Int),
});
export type EngineReadRunInput = typeof EngineReadRunInput.Type;

/**
 * An item's whole part: `text` (a cut message), `detail` (a call's output as the driver gave it),
 * `data` (a call's own record). A range reads bytes from `from`; `tail` the last budget's worth.
 */
export const EngineReadDetailInput = Schema.Struct({
  ...protocol,
  conversationId: ConversationId,
  itemId: ItemId,
  part: Schema.String,
  range: Schema.optionalKey(
    Schema.Union([
      Schema.Struct({ from: Schema.Int, bytes: Schema.optionalKey(Schema.Int) }),
      Schema.Literal("tail"),
    ]),
  ),
});
export type EngineReadDetailInput = typeof EngineReadDetailInput.Type;

export const EngineReceiptInput = Schema.Struct({
  ...protocol,
  conversationId: ConversationId,
  commandId: CommandId,
});
export type EngineReceiptInput = typeof EngineReceiptInput.Type;

const call = { ...protocol, conversationId: ConversationId, commandId: CommandId };

/**
 * A person's message: queued, or sent at once when nothing is on. Pictures by reference, files by
 * the id they were uploaded under; `plan` asks the agent for a plan.
 */
export const EngineSendInput = Schema.Struct({
  ...call,
  text: Schema.String,
  attachments: Schema.optionalKey(
    Schema.Array(Schema.Union([ChatImageAttachment, ChatFileAttachment])),
  ),
  interactionMode: Schema.optionalKey(TolerantInteractionMode),
});
export type EngineSendInput = typeof EngineSendInput.Type;

/** Stop the run on (or the named one). */
export const EngineStopInput = Schema.Struct({ ...call, runId: Schema.optionalKey(RunId) });
export type EngineStopInput = typeof EngineStopInput.Type;

/** The person's answer to a request, as its kind takes it. */
export const EngineAnswer = forwardCompatibleUnion({
  key: "kind",
  known: ["approval", "input", "unknown"],
  members: [
    Schema.Struct({ kind: Schema.Literal("approval"), decision: ProviderApprovalDecision }),
    Schema.Struct({
      kind: Schema.Literal("input"),
      answers: ProviderUserInputAnswers,
      /** The pictures attached to each question's answer, by reference (V1's shape). */
      attachmentsByQuestionId: Schema.optionalKey(UserInputAttachments),
    }),
  ],
  fallback: Schema.Struct({ kind: Schema.Literal("unknown"), type: Schema.String }),
  toFallback: (_raw, type) => ({ kind: "unknown" as const, type }),
});
export type EngineAnswer = typeof EngineAnswer.Type;

export const EngineAnswerInput = Schema.Struct({
  ...call,
  requestId: RequestId,
  answer: EngineAnswer,
  /** What the record shows of the answer: never a secret's value. */
  summary: Schema.String,
});
export type EngineAnswerInput = typeof EngineAnswerInput.Type;

/**
 * Close a request unanswered: only one its agent does not wait on (`dismissible`), which ends
 * `dismissed`. The agent is not told, as with V1's dismissal.
 */
export const EngineDismissInput = Schema.Struct({ ...call, requestId: RequestId });
export type EngineDismissInput = typeof EngineDismissInput.Type;

/** A message into the running turn: only while the session says it can steer. */
export const EngineSteerInput = Schema.Struct({ ...call, runId: RunId, text: Schema.String });
export type EngineSteerInput = typeof EngineSteerInput.Type;

/**
 * The conversation's next model and its options (effort, fast mode, thinking), on the agent it
 * already runs. An option its session takes per turn goes with the next message; any other change
 * opens a new session that resumes this one, between runs.
 */
export const EngineSwitchModelInput = Schema.Struct({
  ...call,
  model: Schema.String,
  /** Absent: the options the conversation has. */
  options: Schema.optionalKey(Schema.Array(ProviderOptionSelection)),
});
export type EngineSwitchModelInput = typeof EngineSwitchModelInput.Type;

/** How freely the agent works: from the next run on, in a session that resumes this one. */
export const EngineSetRuntimeModeInput = Schema.Struct({ ...call, runtimeMode: RuntimeMode });
export type EngineSetRuntimeModeInput = typeof EngineSetRuntimeModeInput.Type;

/**
 * The conversation's agent: another provider instance. Taken while the conversation has not
 * started; after that only an instance of its driver whose sessions resume the old one's.
 */
export const EngineAssignAgentInput = Schema.Struct({
  ...call,
  instanceId: Schema.String,
  model: Schema.String,
  options: Schema.optionalKey(Schema.Array(ProviderOptionSelection)),
});
export type EngineAssignAgentInput = typeof EngineAssignAgentInput.Type;

// ── results ─────────────────────────────────────────────────────────────────────────────────

/** A call's answer: the engine's receipt (accepted or refused by its rules), or unserved. */
export const EngineCallResult = Schema.Union([
  CommandResult,
  Schema.TaggedStruct("Unserved", { unserved: Unserved }),
]);
export type EngineCallResult = typeof EngineCallResult.Type;

/** A receipt looked up by command id: none when the engine never took that command. */
export const EngineReceiptResult = Schema.Union([
  Schema.TaggedStruct("Found", { result: CommandResult }),
  Schema.TaggedStruct("None", {}),
  Schema.TaggedStruct("Unserved", { unserved: Unserved }),
]);
export type EngineReceiptResult = typeof EngineReceiptResult.Type;

/** A page of records: older groups, or a run's items. */
export const EnginePage = Schema.Union([
  Schema.TaggedStruct("Page", {
    runs: RunRecords,
    items: ItemRecords,
    requests: RequestRecords,
    window: EngineWindow,
    /** For a run's page: older items exist before it. */
    more: Schema.Boolean,
  }),
  Schema.TaggedStruct("Unserved", { unserved: Unserved }),
]);
export type EnginePage = typeof EnginePage.Type;

export const EngineDetail = Schema.Union([
  Schema.TaggedStruct("Detail", {
    text: Schema.String,
    from: Schema.Int,
    to: Schema.Int,
    total: Schema.Int,
  }),
  Schema.TaggedStruct("Missing", {}),
  Schema.TaggedStruct("Unserved", { unserved: Unserved }),
]);
export type EngineDetail = typeof EngineDetail.Type;

/** The engine could not do what was asked now (its record unreadable): try again. */
export class EngineWireError extends Schema.TaggedError<EngineWireError>()("EngineWireError", {
  message: Schema.String,
}) {}
