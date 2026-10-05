/**
 * The account's knowledge, as one store holds it (HANDOFF §4.4): facts keyed by domain id, never
 * by the source that delivered them, each carrying its value, its owner's revision, the scope that
 * observed it (its coverage, and through that scope's stream its freshness) and its access state,
 * each apart. Memberships say which ids a scope admits; they never say an entity exists.
 *
 * Types only. The writers are the family reducers (`reducer.ts`); readers get {@link PublicRead}.
 *
 * @module data/model
 */
import type { StreamState } from "./streamMachine.ts";

/** A connection: one per source, organization and renderer. */
export type LinkKey = `zerops:${string}` | `hq:${string}` | `mate:${string}`;

/** A logical scope one connection serves; its stream is a child of the link's. */
export type ScopeKey =
  | `zerops:${string}:projects`
  | `zerops:${string}:running`
  | `hq:${string}:navigation`
  | `mate:${string}:attention`;

export type StreamKey = LinkKey | ScopeKey;

export const scopeKeys = {
  zeropsLink: (orgId: string): LinkKey => `zerops:${orgId}`,
  projects: (orgId: string): ScopeKey => `zerops:${orgId}:projects`,
  running: (orgId: string): ScopeKey => `zerops:${orgId}:running`,
  hqLink: (orgId: string): LinkKey => `hq:${orgId}`,
  navigation: (orgId: string): ScopeKey => `hq:${orgId}:navigation`,
  mateLink: (projectId: string): LinkKey => `mate:${projectId}`,
  attention: (projectId: string): ScopeKey => `mate:${projectId}:attention`,
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

export type Authority = "zerops" | "hq" | "mate";
export type Delivery = "zerops-realtime" | "zerops-read" | "hq-stream" | "mate-direct";
export type Access = "allowed" | "unverified" | "denied";

export interface ProjectValue {
  readonly id: string;
  readonly name: string;
  readonly status: string;
}

export interface ProcessValue {
  readonly id: string;
  readonly projectId: string;
  readonly status: string;
  readonly actionName: string | null;
}

/** Where HQ places a project: in an application as one of its kinds, or a Mate in none. */
export type PlacementValue =
  | {
      readonly kind: "app";
      readonly appId: string;
      readonly appName: string;
      readonly role: string;
    }
  | { readonly kind: "outside" };

/**
 * One Mate's attention, the value its Mate authors (HANDOFF §4.2): main and latest chat, how many
 * chats work and wait, the ids of results and questions to react to, and whether the list was cut.
 * Whether the viewer saw them is the viewer's own fact, computed by HQ (§5 invariant 11).
 */
export interface AttentionValue {
  readonly mainChatId: string | null;
  readonly latestChatId: string | null;
  readonly working: number;
  readonly waiting: number;
  readonly resultIds: ReadonlyArray<string>;
  readonly questionIds: ReadonlyArray<string>;
  readonly truncated: boolean;
}

export interface FamilyValues {
  readonly project: ProjectValue;
  readonly process: ProcessValue;
  readonly placement: PlacementValue;
  readonly attention: AttentionValue;
}
export type Family = keyof FamilyValues;

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
   * cannot make a value whose producer is down live (HANDOFF §4.2).
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

export interface Membership {
  /** `complete` only once a baseline committed; deltas alone never complete a scope. */
  readonly coverage: "unknown" | "complete";
  readonly members: ReadonlyMap<string, MemberState>;
  /** While a baseline is under way: the ids known when it began, and the deltas since. */
  readonly baseline: {
    readonly knownAtBegin: ReadonlySet<string>;
    readonly staged: ReadonlyArray<MembershipDelta>;
  } | null;
}

/** What the person asked an owner to do; the skeleton's one operation moves a project. */
export interface OperationIntent {
  readonly kind: "move-project";
  readonly projectId: string;
  readonly to: { readonly appId: string; readonly role: string };
}

/** The owner's word on a request: accepted or refused, and later how it ended. */
export interface OperationReceipt {
  readonly requestId: string;
  readonly operationId: string;
  readonly executor: Authority;
  readonly affected: ReadonlyArray<{ readonly family: Family; readonly id: string }>;
  readonly acceptance:
    | { readonly kind: "accepted" }
    | { readonly kind: "refused"; readonly reason: string };
  readonly outcome:
    | { readonly kind: "pending" }
    | { readonly kind: "succeeded" | "failed" | "cancelled"; readonly evidence: string };
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
  /** Observation ended without the owner's word: who must act next, never an invented failure. */
  readonly unresolved: { readonly nextActor: string } | null;
}

export interface AccountState {
  readonly streams: ReadonlyMap<StreamKey, StreamState>;
  readonly project: ReadonlyMap<string, Fact<ProjectValue>>;
  readonly process: ReadonlyMap<string, Fact<ProcessValue>>;
  readonly placement: ReadonlyMap<string, Fact<PlacementValue>>;
  readonly attention: ReadonlyMap<string, Fact<AttentionValue>>;
  readonly memberships: ReadonlyMap<ScopeKey, Membership>;
  /** Running process ids by project, maintained by the process reducer. */
  readonly running: ReadonlyMap<string, ReadonlySet<string>>;
  /** Project ids by the application HQ currently places them in, maintained by the same. */
  readonly apps: ReadonlyMap<string, ReadonlySet<string>>;
  readonly operations: ReadonlyMap<string, OperationRecord>;
}

export const emptyAccount: AccountState = {
  streams: new Map(),
  project: new Map(),
  process: new Map(),
  placement: new Map(),
  attention: new Map(),
  memberships: new Map(),
  running: new Map(),
  apps: new Map(),
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
  | `running:${string}`
  | `app:${string}`
  | `stream:${StreamKey}`
  | `operation:${string}`;
