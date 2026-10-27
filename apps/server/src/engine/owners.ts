/**
 * Owners: who writes a stream of the engine's log. A conversation is one kind; a Mate's crew is
 * another. Each kind brings its `Domain` — its pure `decide`, its `evolve`, its initial state and
 * its projections — and gets the same machinery: one actor (one writer) per owner, the receipt,
 * events and projections in one transaction, the outbox, wakes and boot recovery.
 *
 * Every owner shares the conversations' id space (`CREW_OWNER_ID` is `crew/main`), so its events,
 * effects and wakes derive their ids as a conversation's do, and the store keys every row by it.
 * The engine's own fibers speak to any owner with the same three inputs: an effect settled, a wake
 * fired, the server restarted ({@link EngineInput}).
 *
 * @module engine/owners
 */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";
import type * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";
import type {
  CommandId,
  CommandResult,
  ConversationId,
  OwnerKind,
  Principal,
  Rejection,
} from "@t3tools/contracts";

import type { Command, EffectDraft, ItemDataDraft, ItemDetailDraft } from "./domain/command.ts";

/**
 * What the engine's own fibers tell any owner (the worker, the scheduler and boot): every kind's
 * commands include these three.
 */
export const ENGINE_INPUTS = ["EffectSettled", "WakeFired", "Recovered"] as const;
export type EngineInput = Extract<Command, { readonly _tag: (typeof ENGINE_INPUTS)[number] }>;

/** The header the store stamps on every owner's event. */
export interface EventHeader {
  readonly v: number;
  readonly conversationId: ConversationId;
  readonly seq: number;
  readonly at: number;
  readonly commandId: CommandId;
}

/** An event as an owner's log holds it: its tag, the header, its own fields. */
export interface OwnerEvent extends EventHeader {
  readonly _tag: string;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** An event before the store stamps its header. */
export type DraftOf<E> = DistributiveOmit<E, keyof EventHeader>;

export interface OwnerEnvelope<C> {
  readonly commandId: CommandId;
  /** The owner's id: a conversation's, or `crew/main`. */
  readonly conversationId: ConversationId;
  readonly principal: Principal;
  readonly command: C;
}

export interface OwnerStep<D> {
  readonly events: ReadonlyArray<D>;
  readonly effects: ReadonlyArray<EffectDraft>;
  readonly details: ReadonlyArray<ItemDetailDraft>;
  readonly data?: ReadonlyArray<ItemDataDraft>;
  readonly result: Extract<CommandResult, { _tag: "Accepted" }>;
}

export type OwnerDecision<D> =
  | { readonly _tag: "Accept"; readonly step: OwnerStep<D> }
  | { readonly _tag: "Reject"; readonly rejection: Rejection };

/**
 * One owner kind's rules and record. `decide` and `evolve` are pure; `project` writes what one
 * event changes in the kind's own projections, inside the step's transaction. The store writes
 * the projections every kind shares (an effect's outcome, a wake armed, fired or cancelled) for
 * events of those tags, which every kind takes from the contracts.
 */
export interface Domain<
  S extends { readonly headSeq: number },
  C extends { readonly _tag: string },
  E extends OwnerEvent,
  D = DraftOf<E>,
> {
  readonly kind: OwnerKind;
  /** Whether an owner id is this kind's; the conversation kind takes every id no other claims. */
  readonly owns: (owner: ConversationId) => boolean;
  /** Bumped whenever the state's shape changes: a snapshot of another version is refolded. */
  readonly stateVersion: number;
  readonly initial: (owner: ConversationId) => S;
  readonly decide: (state: S, envelope: OwnerEnvelope<C>, now: number) => OwnerDecision<D>;
  readonly evolve: (state: S, event: E) => S;
  /** A stored row, header included, read back; fails for one this build cannot read. */
  readonly decode: (row: Readonly<Record<string, unknown>>) => Effect.Effect<E, Schema.SchemaError>;
  /** Fails for an event this build could not read back: such a step is refused whole. */
  readonly encode: (event: E) => Effect.Effect<unknown, Schema.SchemaError>;
  readonly project: (event: E, state: S) => Effect.Effect<void, SqlError, SqlClient.SqlClient>;
  /** What the owner's row keeps beside its head (a conversation's agent); `null` for none. */
  readonly rowAgent: (state: S) => unknown;
  /** The run an event is about, for the log's index. */
  readonly runOf: (event: E) => string | null;
}

export type AnyDomain = Domain<any, any, any, any>;

/**
 * The owner kinds besides the conversation, as the wiring registers them (crew's, once it runs on
 * the engine). Absent: conversations only.
 */
export class OwnerDomains extends Context.Service<OwnerDomains, ReadonlyArray<AnyDomain>>()(
  "t3/engine/owners/OwnerDomains",
) {}

/** The tags whose projections the store writes for every owner kind. */
export const SHARED_EVENT_TAGS = new Set([
  "EffectRequested",
  "EffectOutcomeRecorded",
  "WakeArmed",
  "WakeFired",
  "WakeCancelled",
]);
