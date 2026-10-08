/**
 * A conversation's state: what `decide` reads and `evolve` folds. Plain JSON, so a snapshot is
 * `JSON.stringify` of it. It holds what the rules need, never the record: every run not ended
 * plus the last ended one, the open items and requests, the armed wakes and the effects in flight.
 *
 * @module engine/domain/state
 */
import type {
  ConversationAgent,
  HistorySource,
  ConversationId,
  EffectId,
  ItemActor,
  ItemBody,
  ItemId,
  Principal,
  ProviderInteractionMode,
  ProviderOptionSelection,
  RequestAsk,
  RequestId,
  RotateSessionReason,
  RunEnd,
  RunEndSource,
  RunId,
  RunState,
  RunTrigger,
  RuntimeMode,
  SessionCapabilities,
  SessionCloseReason,
  SessionId,
  TurnHandle,
  WakeId,
} from "@t3tools/contracts";

/** How many ended runs the state keeps. */
export const KEPT_ENDED_RUNS = 16;

/** Bumped whenever the shape changes: a snapshot of another version is ignored and refolded. */
export const STATE_VERSION = 8;

export interface RunRecord {
  readonly id: RunId;
  readonly ordinal: number;
  /** Sequence of its `RunQueued`. */
  readonly seq: number;
  /** Sequence of its own person message, else of its `RunQueued`: a person message after it is newer. */
  readonly sinceSeq: number;
  readonly trigger: RunTrigger;
  readonly joins: RunId | null;
  readonly principal: Principal;
  readonly maintenance: boolean;
  readonly text: string;
  readonly state: RunState;
  readonly sessionId: SessionId | null;
  readonly providerTurnId: string | null;
  /** The turn the run lives in, once it is sending or started. */
  readonly turn: TurnHandle | null;
  readonly waitingOn: RequestId | null;
  readonly stopAsked: { readonly by: Principal; readonly at: number } | null;
  readonly end: RunEnd | null;
  readonly endSource: RunEndSource | null;
  readonly queuedAt: number;
  readonly admittedAt: number | null;
  readonly startedAt: number | null;
  readonly endedAt: number | null;
  readonly lastActivityAt: number | null;
  readonly unresponsiveSince: number | null;
  readonly nextItemOrdinal: number;
  readonly nextRequestOrdinal: number;
  readonly sessionOpenAttempts: number;
  /** Sends asked for this run: a run requeued before its send started sends again. */
  readonly sendAttempts: number;
  /** Its workspace capture (`run.prepare`): none asked, asked, or settled — the send waits on it. */
  readonly prepare: "none" | "asked" | "done";
  /** The person message that queued it, as the record shows it. */
  readonly personBody: PersonBody | null;
  /** The turn's interaction mode: `plan` asks the agent for a plan. */
  readonly interactionMode: ProviderInteractionMode;
}

export type PersonBody = Extract<ItemBody, { readonly kind: "person" }>;

export interface OpenItem {
  readonly id: ItemId;
  readonly runId: RunId | null;
  readonly key: string | null;
  readonly by: ItemActor;
  readonly body: ItemBody;
}

/** An item the driver closed, kept by its key so a signal delivered again changes nothing. */
export interface ClosedItem {
  readonly itemId: ItemId;
  readonly runId: RunId | null;
  /** `contentDigest` of its body as recorded. */
  readonly digest: string;
}

export interface OpenRequest {
  readonly id: RequestId;
  readonly runId: RunId;
  readonly key: string;
  readonly answerable: boolean;
  readonly principal: Principal;
  /** Answers given so far: one the provider failed to take is given again as a new effect. */
  readonly answers: number;
  /** What it asks; absent in a snapshot taken before it was kept. */
  readonly kind?: RequestAsk["kind"];
  /** A question its agent does not wait on (asked by message): it may close unanswered. */
  readonly dismissible?: boolean;
  /** A question asked by message: what it asks, by question id, to word the answer's message. */
  readonly questions?: ReadonlyArray<{ readonly id: string; readonly question: string }>;
}

export interface ArmedWake {
  readonly id: WakeId;
  readonly kind: string;
  readonly dueAt: number;
  readonly cron: string | null;
  readonly principal: Principal;
  readonly joins: RunId | null;
  readonly text: string | null;
  /** Sequence of its `WakeArmed`: a person message after it is newer work. */
  readonly armedSeq: number;
}

export interface EffectInFlight {
  readonly id: EffectId;
  readonly kind: string;
  readonly runId: RunId | null;
}

export interface SessionRecord {
  readonly id: SessionId;
  readonly driver: string;
  /** The model the engine asked for when it opened: what fit compares. */
  readonly requestedModel: string | null;
  /** The provider instance it was opened on; null for one opened before the engine said. */
  readonly instanceId: string | null;
  /** The model the driver reports, in its own spelling. */
  readonly model: string | null;
  /** The model options it opened with; null for one opened before the engine said. */
  readonly options: ReadonlyArray<ProviderOptionSelection> | null;
  /** The runtime mode it opened with; null for one opened before the engine said. */
  readonly runtimeMode: RuntimeMode | null;
  readonly nativeRef: string | null;
  readonly capabilities: SessionCapabilities;
  /** Closes asked of it: one an idle check kept is asked again later as a new effect. */
  readonly closeAttempts: number;
}

/**
 * The conversation's earlier record being copied in: its source, how many turns it reserved, and
 * the next record of its plan. `importing` holds the queue.
 */
export interface HistoryImport {
  readonly state: "importing" | "complete" | "failed";
  readonly source: HistorySource;
  readonly runs: number;
  readonly cursor: number;
}

export interface ConversationState {
  readonly conversationId: ConversationId;
  readonly headSeq: number;
  readonly archived: boolean;
  /** The agent the conversation belongs to, once assigned. */
  readonly agent: ConversationAgent | null;
  readonly model: string | null;
  /** How freely the agent works, once a person set it; null: the workspace's mode. */
  readonly runtimeMode: RuntimeMode | null;
  /** The interaction mode of the person's latest message; null before one. */
  readonly interactionMode: ProviderInteractionMode | null;
  /**
   * The generation of the conversation's provider thread: bumped when the conversation moves to
   * another instance or driver, whose saved resume state does not carry over, so its next session
   * starts fresh on a thread of its own.
   */
  readonly threadGeneration: number;
  readonly nextRunOrdinal: number;
  readonly runs: Readonly<Record<string, RunRecord>>;
  /** Queued runs, oldest first. */
  readonly queue: ReadonlyArray<RunId>;
  /** The run admitted, sending, running or waiting: one at a time. */
  readonly activeRunId: RunId | null;
  readonly latestRunId: RunId | null;
  /** The latest ended runs, oldest first, kept so a wake or a self-started turn can join them. */
  readonly endedRuns: ReadonlyArray<RunId>;
  /** Each known turn's run: every turn-scoped signal is routed through it. Pruned with the runs. */
  readonly turns: Readonly<Record<string, RunId>>;
  /** Sequence of the latest person message (a sent or steered one). */
  readonly lastPersonSeq: number;
  readonly session: SessionRecord | null;
  /** The close the engine asked of the session; nothing goes into it meanwhile. */
  readonly closing: {
    readonly sessionId: SessionId;
    readonly reason: SessionCloseReason;
    readonly effectId: EffectId;
  } | null;
  /** The session a model switch closed: the next one opened rotates from it. */
  readonly rotatingFrom: SessionId | null;
  /**
   * A rotation asked between turns (`RotateSession`): the open session closes before the next run
   * and the next one opens as it says. Cleared once that session has opened.
   */
  readonly rotation: {
    readonly reason: RotateSessionReason;
    readonly fresh: boolean;
    readonly seed: string | null;
  } | null;
  /** The native thread of the last session, so the next one resumes it. */
  readonly lastNativeRef: string | null;
  /**
   * A usage limit holds the queue until then; `"unknown"` until a probe or a known reset ends it,
   * or the person writes again.
   */
  readonly pausedUntil: number | "unknown" | null;
  /** The last usage probe's delay: the next one waits twice as long, up to an hour. */
  readonly usageProbeMs: number | null;
  readonly items: Readonly<Record<string, OpenItem>>;
  /** Closed items of the kept runs, by the driver's key. */
  readonly closedItems: Readonly<Record<string, ClosedItem>>;
  /** Every request key the kept runs were asked, and its run: a request is asked once. */
  readonly askedKeys: Readonly<Record<string, RunId>>;
  readonly requests: Readonly<Record<string, OpenRequest>>;
  /** Answered requests whose answer the provider has not taken yet, by the answer's effect. */
  readonly answering: Readonly<Record<string, OpenRequest>>;
  readonly wakes: Readonly<Record<string, ArmedWake>>;
  readonly effects: Readonly<Record<string, EffectInFlight>>;
  /** The earlier record's import, once one was started. */
  readonly history: HistoryImport | null;
}

export const initialState = (conversationId: ConversationId): ConversationState => ({
  conversationId,
  headSeq: 0,
  archived: false,
  agent: null,
  model: null,
  runtimeMode: null,
  interactionMode: null,
  threadGeneration: 1,
  nextRunOrdinal: 1,
  runs: {},
  queue: [],
  activeRunId: null,
  latestRunId: null,
  endedRuns: [],
  turns: {},
  lastPersonSeq: 0,
  session: null,
  closing: null,
  rotatingFrom: null,
  rotation: null,
  lastNativeRef: null,
  pausedUntil: null,
  usageProbeMs: null,
  items: {},
  closedItems: {},
  askedKeys: {},
  requests: {},
  answering: {},
  wakes: {},
  effects: {},
  history: null,
});

export const activeRun = (state: ConversationState): RunRecord | undefined =>
  state.activeRunId === null ? undefined : state.runs[state.activeRunId];

/** A short digest of a body's content: a signal delivered again carries the same one. */
export const contentDigest = (value: unknown): string => {
  const text = JSON.stringify(value) ?? "";
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${(hash >>> 0).toString(16)}:${text.length}`;
};

/** The run a turn belongs to, while the state still keeps it. */
export const runOfTurn = (state: ConversationState, turn: string): RunRecord | undefined => {
  const id = state.turns[turn];
  return id === undefined ? undefined : state.runs[id];
};
