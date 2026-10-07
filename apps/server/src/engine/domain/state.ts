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
  WakeId,
} from "@t3tools/contracts";

/** How many ended runs the state keeps. */
export const KEPT_ENDED_RUNS = 16;

/** Bumped whenever the shape changes: a snapshot of another version is ignored and refolded. */
export const STATE_VERSION = 1;

export interface RunRecord {
  readonly id: RunId;
  readonly ordinal: number;
  /** Sequence of its `RunQueued`, or of its own person message: a person message after it is newer. */
  readonly seq: number;
  readonly trigger: RunTrigger;
  readonly joins: RunId | null;
  readonly principal: Principal;
  readonly maintenance: boolean;
  readonly text: string;
  readonly state: RunState;
  readonly sessionId: SessionId | null;
  readonly providerTurnId: string | null;
  readonly waitingOn: RequestId | null;
  readonly stopAsked: { readonly by: Principal; readonly at: number } | null;
  readonly end: RunEnd | null;
  readonly endSource: RunEndSource | null;
  readonly queuedAt: number;
  readonly startedAt: number | null;
  readonly endedAt: number | null;
  readonly lastActivityAt: number | null;
  readonly unresponsiveSince: number | null;
  readonly nextItemOrdinal: number;
  readonly nextRequestOrdinal: number;
  readonly sessionOpenAttempts: number;
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
  /** Sequence of the latest person message (a sent or steered one). */
  readonly lastPersonSeq: number;
  readonly session: SessionRecord | null;
  /** The native thread of the last session, so the next one resumes it. */
  readonly lastNativeRef: string | null;
  /** Usage limit: queued runs wait until then. */
  readonly pausedUntil: number | null;
  readonly items: Readonly<Record<string, OpenItem>>;
  readonly requests: Readonly<Record<string, OpenRequest>>;
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
  lastPersonSeq: 0,
  session: null,
  lastNativeRef: null,
  pausedUntil: null,
  items: {},
  requests: {},
  wakes: {},
  effects: {},
});

export const activeRun = (state: ConversationState): RunRecord | undefined =>
  state.activeRunId === null ? undefined : state.runs[state.activeRunId];
