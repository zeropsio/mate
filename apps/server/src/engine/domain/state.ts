/**
 * A conversation's state: what `decide` reads and `evolve` folds. Plain JSON, so a snapshot is
 * `JSON.stringify` of it. It holds what the rules need, never the record: every run not ended
 * plus the last ended one, the open items and requests, the armed wakes and the effects in flight.
 *
 * @module engine/domain/state
 */
import type {
  ConversationId,
  EffectId,
  ItemActor,
  ItemBody,
  ItemId,
  Principal,
  RequestId,
  RunEnd,
  RunEndSource,
  RunId,
  RunState,
  RunTrigger,
  SessionCapabilities,
  SessionId,
  TurnHandle,
  WakeId,
} from "@t3tools/contracts";

/** How many ended runs the state keeps. */
export const KEPT_ENDED_RUNS = 16;

/** Bumped whenever the shape changes: a snapshot of another version is ignored and refolded. */
export const STATE_VERSION = 2;

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
  /** The person message that queued it, as the record shows it. */
  readonly personBody: PersonBody | null;
}

export type PersonBody = Extract<ItemBody, { readonly kind: "person" }>;

export interface OpenItem {
  readonly id: ItemId;
  readonly runId: RunId | null;
  readonly key: string | null;
  readonly by: ItemActor;
  readonly body: ItemBody;
}

export interface OpenRequest {
  readonly id: RequestId;
  readonly runId: RunId;
  readonly key: string;
  readonly answerable: boolean;
  readonly principal: Principal;
  /** Answers given so far: one the provider failed to take is given again as a new effect. */
  readonly answers: number;
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
  /** The model the driver reports, in its own spelling. */
  readonly model: string | null;
  readonly nativeRef: string | null;
  readonly capabilities: SessionCapabilities;
}

export interface ConversationState {
  readonly conversationId: ConversationId;
  readonly headSeq: number;
  readonly archived: boolean;
  readonly model: string | null;
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
  readonly requests: Readonly<Record<string, OpenRequest>>;
  /** Answered requests whose answer the provider has not taken yet, by the answer's effect. */
  readonly answering: Readonly<Record<string, OpenRequest>>;
  readonly wakes: Readonly<Record<string, ArmedWake>>;
  readonly effects: Readonly<Record<string, EffectInFlight>>;
}

export const initialState = (conversationId: ConversationId): ConversationState => ({
  conversationId,
  headSeq: 0,
  archived: false,
  model: null,
  nextRunOrdinal: 1,
  runs: {},
  queue: [],
  activeRunId: null,
  latestRunId: null,
  endedRuns: [],
  turns: {},
  lastPersonSeq: 0,
  session: null,
  lastNativeRef: null,
  pausedUntil: null,
  usageProbeMs: null,
  items: {},
  requests: {},
  answering: {},
  wakes: {},
  effects: {},
});

export const activeRun = (state: ConversationState): RunRecord | undefined =>
  state.activeRunId === null ? undefined : state.runs[state.activeRunId];

/** The run a turn belongs to, while the state still keeps it. */
export const runOfTurn = (state: ConversationState, turn: string): RunRecord | undefined => {
  const id = state.turns[turn];
  return id === undefined ? undefined : state.runs[id];
};
