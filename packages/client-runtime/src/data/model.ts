/**
 * The account's knowledge, as one store holds it: facts keyed by domain id, never
 * by the source that delivered them, each carrying its value, its owner's revision, the scope that
 * observed it (its coverage, and through that scope's stream its freshness) and its access state,
 * each apart. Memberships say which ids a scope admits; they never say an entity exists.
 *
 * Types only. The one writer is `reducer.ts`, looping over the families `families/` registers;
 * readers get {@link PublicRead}.
 *
 * @module data/model
 */
import type { StreamState } from "./streamMachine.ts";

/** The sources the account reads, each the owner of its families. */
export type Source = "zerops" | "hq" | "mate";

/** A connection: one per source, organization (or Mate) and renderer. */
export type LinkKey = `${Source}:${string}`;

/** A logical scope one connection serves, named by its family's suffix; a child of the link's. */
export type ScopeKey = `${Source}:${string}:${string}`;

export type StreamKey = LinkKey | ScopeKey;

export const linkKeys = {
  zerops: (orgId: string): LinkKey => `zerops:${orgId}`,
  hq: (orgId: string): LinkKey => `hq:${orgId}`,
  mate: (projectId: string): LinkKey => `mate:${projectId}`,
} as const;

/** An owner's ordering of its own values. Revisions of different kinds never compare. */
export type Revision =
  /** A Zerops entity row's `_version`; `null` where the row carried none. */
  | { readonly kind: "zerops"; readonly version: number | null }
  /**
   * Today's HQ stream carries no revision: an observation is ordered only by the connection
   * generation that delivered it and its place in that connection.
   */
  | { readonly kind: "hq-observation"; readonly generation: number; readonly sequence: number }
  /** A Mate's own attention revision, inside one incarnation of its store. */
  | { readonly kind: "mate-attention"; readonly incarnation: string; readonly revision: number };

export type Authority = Source;
export type Delivery = "zerops-realtime" | "zerops-read" | "hq-stream" | "mate-direct";
export type Access = "allowed" | "unverified" | "denied";

/**
 * Each fact family's value, by its name. Empty here: every family module adds its own entry
 * (`declare module "../model.ts"`), so a new family touches no shared type.
 */
export interface FamilyValues {}
export type Family = keyof FamilyValues & string;

export type FactContent<T> =
  | { readonly kind: "value"; readonly value: T }
  | { readonly kind: "deleted"; readonly evidence: string }
  /** Authoritatively denied: the payload is gone, the entity is not claimed deleted. */
  | { readonly kind: "purged" };

export interface Fact<T> {
  readonly content: FactContent<T>;
  readonly revision: Revision;
  readonly authority: Authority;
  readonly via: Delivery;
  readonly method: "baseline" | "push" | "read";
  /** The scope that observed it: its coverage, and through its stream its freshness. */
  readonly scope: ScopeKey;
  readonly access: Access;
  /**
   * A relayed value's producer leg: whether its author's link to the relay is up. A healthy relay
   * cannot make a value whose producer is down live.
   */
  readonly producer?: "up" | "down";
}

export type MemberState =
  | "member"
  /** Left the scope or missing from a fresh baseline; deleted or inaccessible is not known yet. */
  | "absent-unverified"
  /** Left a scope whose leaving says nothing of existence (a process stopped running). */
  | "removed";

export interface MembershipDelta {
  readonly add: ReadonlyArray<string>;
  readonly remove: ReadonlyArray<string>;
}

export type Coverage = "unknown" | "complete" | "partial";

export interface Membership {
  /**
   * `complete` only once a baseline committed whole; deltas alone never complete a scope.
   * `partial`: a baseline committed that was cut at its page limit or held a row it could not
   * read — its absences say nothing.
   */
  readonly coverage: Coverage;
  readonly members: ReadonlyMap<string, MemberState>;
  /** While a baseline is under way: the ids known when it began, and the deltas since. */
  readonly baseline: {
    readonly knownAtBegin: ReadonlySet<string>;
    readonly staged: ReadonlyArray<MembershipDelta>;
  } | null;
}

/**
 * Each operation's intent, by its kind. Empty here: every operation module adds its own entry
 * (`declare module "../model.ts"`).
 */
export interface OperationIntents {}
type DeclaredIntent = {
  readonly [Kind in keyof OperationIntents & string]: {
    readonly kind: Kind;
  } & OperationIntents[Kind];
}[keyof OperationIntents & string];
/** Every declared intent; until a kind declares one, an intent no value can be — but still has a kind. */
export type OperationIntent = [DeclaredIntent] extends [never]
  ? { readonly kind: never }
  : DeclaredIntent;

/** The owner's word on a request: accepted or refused, and later how it ended. */
export interface OperationReceipt {
  readonly requestId: string;
  readonly operationId: string;
  readonly executor: Authority;
  readonly affected: ReadonlyArray<{ readonly family: Family; readonly id: string }>;
  /** The owner's external handles for it — a Zerops process id — to follow it and to ask by. */
  readonly handles: ReadonlyArray<string>;
  readonly acceptance:
    | { readonly kind: "accepted" }
    | { readonly kind: "refused"; readonly reason: string };
  readonly outcome:
    | { readonly kind: "pending" }
    | { readonly kind: "succeeded" | "failed" | "cancelled"; readonly evidence: string };
}

/**
 * The owner can no longer observe an operation: who must act, and — where the owner names it — the
 * next action ("Start the Mate"), never one the client would take blindly.
 */
export interface Unobservable {
  readonly nextActor: string;
  readonly nextAction?: string;
}

/**
 * An operation as this account knows it: the intent and request id recorded before sending, the
 * owner's receipt once it answers, and how its observation stands. Acceptance, reflection and
 * outcome are separate: reflection is read from the affected facts, the outcome only from the owner.
 */
export interface OperationRecord {
  readonly requestId: string;
  readonly intent: OperationIntent;
  /** `uncertain`: sent, its answer lost — ask the owner by this id, never send again blindly. */
  readonly submission:
    | "recorded"
    /** Not taken (refused at the door, never arrived): send again under the same id. */
    | "unsent"
    /** Answer lost, the owner being asked by the id. */
    | "uncertain"
    /** Answer lost and the owner could not be asked: ask again, never send blindly. */
    | "uncertain-unasked"
    | "answered";
  readonly receipt: OperationReceipt | null;
  /**
   * The effect handles the owner's facts showed when it was sent (its kind's `effectHandles`):
   * none of these can be its own. `null` where it was not sent from here (resumed).
   */
  readonly before: ReadonlyArray<string> | null;
  /** The owner's handles this account knows for it — given on resume, or from a receipt. */
  readonly handles: ReadonlyArray<string>;
  /** The owner can no longer observe it: who must act next, never an invented failure. */
  readonly unresolved: Unobservable | null;
}

/** A fact's key in the one facts map: its family and its domain id. */
export type FactKey = `${Family}:${string}`;
export const factKey = (family: Family, id: string): FactKey => `${family}:${id}`;

export interface AccountState {
  readonly streams: ReadonlyMap<StreamKey, StreamState>;
  readonly facts: ReadonlyMap<FactKey, Fact<unknown>>;
  readonly memberships: ReadonlyMap<ScopeKey, Membership>;
  /** Every family index, by `name:key`: the ids counted under that key, kept by the reducer. */
  readonly indexes: ReadonlyMap<string, ReadonlySet<string>>;
  readonly operations: ReadonlyMap<string, OperationRecord>;
}

export const emptyAccount: AccountState = {
  streams: new Map(),
  facts: new Map(),
  memberships: new Map(),
  indexes: new Map(),
  operations: new Map(),
};

/** What a reader gets for one fact: never a raw record, never a withheld payload. */
export type PublicRead<T> =
  | {
      readonly kind: "known";
      readonly value: T;
      readonly revision: Revision;
      readonly scope: ScopeKey;
      readonly producer?: "up" | "down";
    }
  | { readonly kind: "unknown" }
  | { readonly kind: "deleted"; readonly evidence: string }
  | { readonly kind: "withheld"; readonly reason: "unverified" | "denied" };

/** The keys a reduction publishes: one per fact, membership, index and stream. */
export type ReadKey =
  | `${Family}:${string}`
  | `members:${ScopeKey}`
  | `coverage:${ScopeKey}`
  | `index:${string}`
  | `stream:${StreamKey}`
  | `operation:${string}`;
