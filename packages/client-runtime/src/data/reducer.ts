/**
 * The account's one writer: every input — a stream event, a baseline, a membership
 * delta, versioned rows, evidence of deletion or access — enters here and is dispatched to the one
 * reducer of its family. A reduction names the read keys it changed, for keyed publication, and
 * the work it asks of the runtime. No transport event deletes a fact: only proven deletion does.
 *
 * Pure: no clock (time arrives in the input), no I/O.
 *
 * @module data/reducer
 */
import {
  FAMILIES,
  familySpec,
  ownScopeOf,
  scopeListing,
  scopeSpec,
  streamMode,
} from "./families/index.ts";
import { sameValue } from "./projections/equal.ts";

import type { FamilyIndex } from "./families/spec.ts";
import {
  factKey,
  type Access,
  type AccountState,
  type Delivery,
  type Fact,
  type FactKey,
  type Family,
  type FamilyValues,
  type Membership,
  type MemberState,
  type MembershipDelta,
  type ReadKey,
  type Revision,
  type ScopeKey,
  type StreamKey,
} from "./model.ts";
import {
  isOperationInput,
  reduceOperation,
  requestIdOf,
  type OperationInput,
} from "./operations/receipts.ts";
import {
  initialStream,
  transition,
  type StreamDirective,
  type StreamEvent,
  type StreamState,
} from "./streamMachine.ts";

export type Row = {
  readonly [F in Family]: {
    readonly family: F;
    readonly id: string;
    readonly value: FamilyValues[F];
    readonly revision: Revision;
    readonly producer?: "up" | "down";
  };
}[Family];

export type AccountInput =
  | OperationInput
  | {
      readonly kind: "stream";
      readonly key: StreamKey;
      readonly event: StreamEvent;
      readonly now: number;
    }
  | { readonly kind: "baseline-begin"; readonly scope: ScopeKey; readonly generation: number }
  /** A scope's whole answer: its members and their rows, admitted together or not at all. */
  | {
      readonly kind: "baseline-commit";
      readonly scope: ScopeKey;
      readonly generation: number;
      readonly via: Delivery;
      readonly members: ReadonlyArray<string>;
      readonly rows: ReadonlyArray<Row>;
      /** Cut at its page limit, or holding a row it could not read: its absences say nothing. */
      readonly partial?: boolean;
    }
  /** The owner proved the entity gone: the one input that deletes a fact. */
  | {
      readonly kind: "proven-deletion";
      readonly scope?: ScopeKey;
      readonly family: Family;
      readonly id: string;
      readonly evidence: string;
    }
  /** The owner's word on the viewer's access; denial withholds and purges, never deletes. */
  | {
      readonly kind: "access";
      readonly scope?: ScopeKey;
      readonly family: Family;
      readonly id: string;
      readonly access: Access;
    }
  | {
      readonly kind: "membership";
      readonly scope: ScopeKey;
      readonly generation: number;
      readonly delta: MembershipDelta;
    }
  /**
   * The owner places a member that left the scope elsewhere (another organization): it leaves the
   * scope, its fact kept — neither deleted nor withheld.
   */
  | {
      readonly kind: "left";
      readonly scope: ScopeKey;
      readonly generation: number;
      readonly id: string;
    }
  /**
   * One HQ scope delivery: its records of every family it holds and its explicit removals,
   * committed together or — from a superseded registration — not at all. A `reset` starts the
   * scope's revision afresh; the records it leaves out stay.
   */
  | {
      readonly kind: "hq-delivery";
      readonly scopes: ReadonlyArray<HqDeliveryScope>;
      readonly reset: boolean;
      readonly rows: ReadonlyArray<Row>;
      readonly removals: ReadonlyArray<HqRemovalInput>;
    }
  /** HQ's catchup of these scopes ended: what they list is the whole. */
  | { readonly kind: "hq-ready"; readonly scopes: ReadonlyArray<HqDeliveryScope> }
  | {
      readonly kind: "rows";
      readonly scope: ScopeKey;
      readonly generation: number;
      readonly method: "baseline" | "push" | "read";
      readonly via: Delivery;
      readonly rows: ReadonlyArray<Row>;
    };

/** A scope an HQ delivery commits into, as the attempt registered it. */
export interface HqDeliveryScope {
  readonly scope: ScopeKey;
  readonly generation: number;
}

/** A record HQ removed explicitly, and why: the one way an HQ record leaves. */
export interface HqRemovalInput {
  readonly family: Family;
  readonly id: string;
  readonly reason: "deleted" | "no-access";
}

export type RuntimeDirective =
  | (StreamDirective & { readonly key: StreamKey })
  /** Members whose rows this store does not hold: read them by id. */
  | { readonly kind: "resolve-rows"; readonly key: ScopeKey; readonly ids: ReadonlyArray<string> }
  /** Members gone from a scope whose leaving may be deletion or lost access: ask which. */
  | {
      readonly kind: "verify-absence";
      readonly key: ScopeKey;
      readonly ids: ReadonlyArray<string>;
    };

export interface Reduction {
  readonly state: AccountState;
  readonly changed: ReadonlySet<ReadKey>;
  readonly directives: ReadonlyArray<RuntimeDirective>;
}

/** A scope's stream is the child of its link's: `zerops:org:projects` of `zerops:org`. */
function parentOf(key: StreamKey): string | null {
  const parts = key.split(":");
  return parts.length > 2 ? `${parts[0]}:${parts[1]}` : null;
}

export function streamOf(state: AccountState, key: StreamKey): StreamState {
  return state.streams.get(key) ?? initialStream({ parent: parentOf(key), mode: streamMode(key) });
}

/**
 * Whether `incoming` may replace `current` in its owner's ordering. Revisions compare only inside
 * their own domain: a Mate's own attention revision always outranks HQ's relay of it, which never
 * replaces it back; another incarnation of an HQ scope is not ordered, so only a baseline replaces
 * it; a Mate's runs order by their epoch, a later run's value replacing an earlier run's by
 * whichever path and delivery it comes, live or stored, and never the other way round; between two
 * environments of a Mate, which have no order, only a live value replaces; an engine
 * conversation's records order by epoch, then sequence, and another environment's only through a
 * baseline; a value of another domain never replaces one. Time never decides.
 */
export function supersedes(
  current: Revision,
  incoming: Revision,
  method: "baseline" | "push" | "read",
): boolean {
  switch (incoming.kind) {
    case "mate-browser-frame":
      return (
        current.kind === "mate-browser-frame" &&
        current.callId === incoming.callId &&
        incoming.revision > current.revision
      );
    case "zerops":
      if (current.kind !== "zerops") return false;
      if (incoming.version === null) return current.version === null;
      return current.version === null || incoming.version > current.version;
    case "hq":
      if (current.kind !== "hq") return false;
      return current.incarnation === incoming.incarnation
        ? incoming.revision > current.revision
        : method === "baseline";
    case "mate-attention":
      if (current.kind === "hq") return true;
      if (current.kind !== "mate-attention") return false;
      if (current.environmentId !== incoming.environmentId) return incoming.live;
      if (current.epoch !== incoming.epoch) return incoming.epoch > current.epoch;
      return current.incarnation === incoming.incarnation && incoming.revision > current.revision;
    case "mate-link":
      return current.kind === "mate-link" && incoming.sequence > current.sequence;
    case "mate-conversation":
      if (current.kind !== "mate-conversation") return false;
      if (current.environmentId !== incoming.environmentId) return method === "baseline";
      return incoming.epoch !== current.epoch
        ? incoming.epoch > current.epoch
        : incoming.seq > current.seq;
  }
}

/**
 * Whether a row replaces the fact held for it: a newer revision does. A denial is restored only
 * by an owner answer — a baseline, or a read of a member — never by a push, which says nothing
 * of the viewer's access having returned.
 */
function admits(
  state: AccountState,
  input: Pick<Extract<AccountInput, { readonly kind: "rows" }>, "scope" | "method">,
  current: Fact<unknown>,
  row: Row,
): boolean {
  if (current.content.kind === "purged" && input.method === "push") return false;
  if (supersedes(current.revision, row.revision, input.method)) return true;
  // A read with no revision — a by-id read, or a detail listing's baseline read — newer by the
  // owner's own word (`FamilySpec.readIsNewer`). A push always carries its revision.
  const readIsNewer = familySpec(row.family).readIsNewer as
    | ((held: unknown, read: unknown) => boolean)
    | undefined;
  if (
    readIsNewer !== undefined &&
    input.method !== "push" &&
    row.revision.kind === "zerops" &&
    row.revision.version === null &&
    current.content.kind === "value" &&
    readIsNewer(current.content.value, row.value)
  )
    return true;
  // An end a read brings is the owner's last word, over a value that is no end (`FamilySpec.ended`).
  const ended = familySpec(row.family).ended as ((value: unknown) => boolean) | undefined;
  if (
    ended !== undefined &&
    input.method !== "push" &&
    current.content.kind === "value" &&
    ended(row.value) &&
    !ended(current.content.value)
  )
    return true;
  if (current.content.kind !== "purged") return false;
  if (supersedes(row.revision, current.revision, input.method)) return false;
  return (
    input.method === "baseline" ||
    (input.method === "read" &&
      state.memberships.get(input.scope)?.members.get(row.id) === "member")
  );
}

function reduceRows(
  state: AccountState,
  input: Pick<
    Extract<AccountInput, { readonly kind: "rows" }>,
    "scope" | "via" | "method" | "rows"
  >,
  changed: Set<ReadKey>,
): AccountState {
  // One copy of the facts a reduction writes, never one per row.
  let draft: Map<FactKey, Fact<unknown>> | null = null;
  let memberships = state.memberships;
  for (const row of input.rows) {
    const key = factKey(row.family, row.id);
    const current = (draft ?? state.facts).get(key);
    if (current !== undefined && !admits(state, input, current, row)) {
      const held = current.revision;
      const incoming = row.revision;
      // A direct confirmation of the held revision proves this path observed it, without
      // replacing its value. A live path carrying an older run proves no freshness for it.
      if (
        input.via !== "mate-direct" ||
        current.content.kind !== "value" ||
        held.kind !== "mate-attention" ||
        incoming.kind !== "mate-attention" ||
        !incoming.live ||
        held.environmentId !== incoming.environmentId ||
        held.epoch !== incoming.epoch ||
        held.incarnation !== incoming.incarnation ||
        held.revision !== incoming.revision ||
        current.scope === input.scope
      )
        continue;
      draft ??= new Map(state.facts);
      draft.set(key, {
        ...current,
        revision: incoming,
        via: input.via,
        method: input.method,
        scope: input.scope,
      });
      changed.add(key);
      continue;
    }
    const spec = familySpec(row.family);
    const merge = spec.merge as ((held: unknown, pushed: unknown) => unknown) | undefined;
    const keepUnsaid = spec.keepUnsaid as
      | ((held: unknown, row: unknown, own: boolean) => unknown)
      | undefined;
    const held = current?.content.kind === "value" ? current.content : null;
    const merged =
      merge !== undefined && input.method === "push" && held !== null
        ? merge(held.value, row.value)
        : row.value;
    const value =
      keepUnsaid === undefined
        ? merged
        : keepUnsaid(held?.value, merged, scopeListing(input.scope).detail?.member === true);
    const label = (spec.labelOf as ((value: unknown) => string) | undefined)?.(value);
    const fact: Fact<unknown> = {
      ...(label === undefined ? {} : { label }),
      content: { kind: "value", value },
      revision: row.revision,
      // The family's owner, whichever path delivered it: HQ's relay of attention stays the Mate's.
      authority: spec.authority,
      via: input.via,
      method: input.method,
      scope: input.scope,
      // The owner delivering a value is its word that the viewer reads it; unverified stays so.
      access: current?.access === "unverified" ? "unverified" : "allowed",
      ...(row.producer === undefined ? {} : { producer: row.producer }),
    };
    // Zerops rows are plain DTOs. Other owners may hold runtime values such as Maps.
    if (
      spec.authority === "zerops" &&
      current !== undefined &&
      sameValue(current, { ...fact, method: current.method, via: current.via })
    )
      continue;
    draft ??= new Map(state.facts);
    draft.set(key, fact);
    // Only a fresh owner answer restores an excluded entity, never a transport event or delta.
    if (current?.content.kind === "purged" || current?.content.kind === "deleted") {
      for (const [scope, membership] of memberships) {
        if (scopeSpec(scope).family !== row.family || !membership.excluded.has(row.id)) continue;
        const excluded = new Set(membership.excluded);
        excluded.delete(row.id);
        memberships = new Map(memberships).set(scope, { ...membership, excluded });
        changed.add(`members:${scope}`);
      }
    }
    changed.add(key);
  }
  return draft === null ? state : { ...state, facts: draft, memberships };
}

const EMPTY_MEMBERSHIP: Membership = {
  coverage: "unknown",
  members: new Map(),
  excluded: new Set(),
  baseline: null,
};

function reduceMembership(
  state: AccountState,
  scope: ScopeKey,
  delta: MembershipDelta,
  changed: Set<ReadKey>,
  directives: RuntimeDirective[],
): AccountState {
  const {
    spec: { family },
    leaving,
  } = scopeListing(scope);
  const membership = state.memberships.get(scope) ?? EMPTY_MEMBERSHIP;
  // While a baseline is read, a delta may be older or newer than its answer: replay it after.
  if (membership.baseline !== null)
    return withMembership(state, scope, {
      ...membership,
      baseline: { ...membership.baseline, staged: [...membership.baseline.staged, delta] },
    });
  let members: Map<string, MemberState> | null = null;
  for (const id of delta.add) {
    if ((members ?? membership.members).get(id) === "member") continue;
    members ??= new Map(membership.members);
    members.set(id, "member");
  }
  const removed = delta.remove.filter((id) => !membership.excluded.has(id));
  for (const id of removed) {
    if ((members ?? membership.members).get(id) === leaving) continue;
    members ??= new Map(membership.members);
    members.set(id, leaving);
  }
  const unresolved = delta.add.filter((id) => {
    const fact = state.facts.get(factKey(family, id));
    return fact === undefined || fact.content.kind === "purged";
  });
  if (unresolved.length > 0) directives.push({ kind: "resolve-rows", key: scope, ids: unresolved });
  if (leaving === "absent-unverified" && removed.length > 0)
    directives.push({ kind: "verify-absence", key: scope, ids: removed });
  if (members === null) return state;
  const membershipChanged = [...delta.add, ...removed].some(
    (id) => members.get(id) !== membership.members.get(id),
  );
  if (!membershipChanged) return state;
  changed.add(`members:${scope}`);
  return withMembership(state, scope, { ...membership, members });
}

const withMembership = (
  state: AccountState,
  scope: ScopeKey,
  membership: Membership,
): AccountState => ({ ...state, memberships: new Map(state.memberships).set(scope, membership) });

function beginBaseline(state: AccountState, scope: ScopeKey): AccountState {
  const prefix = `${scopeSpec(scope).family}:`;
  const membership = state.memberships.get(scope) ?? EMPTY_MEMBERSHIP;
  const knownAtBegin = new Set<string>();
  for (const [id, member] of membership.members) if (member === "member") knownAtBegin.add(id);
  // A fact the owner proved gone or withheld is no longer listed: its absence asks nothing again.
  for (const [key, fact] of state.facts)
    if (fact.scope === scope && fact.content.kind === "value" && key.startsWith(prefix))
      knownAtBegin.add(key.slice(prefix.length));
  return withMembership(state, scope, { ...membership, baseline: { knownAtBegin, staged: [] } });
}

/**
 * The baseline's members replace the scope's; what was known when it began and is missing from it
 * left the scope — which says nothing yet of deletion. Then the deltas staged meanwhile replay.
 */
function commitBaseline(
  state: AccountState,
  input: Extract<AccountInput, { readonly kind: "baseline-commit" }>,
  changed: Set<ReadKey>,
  directives: RuntimeDirective[],
): AccountState {
  const { scope } = input;
  const membership = state.memberships.get(scope) ?? EMPTY_MEMBERSHIP;
  const staged = membership.baseline?.staged ?? [];
  const knownAtBegin = membership.baseline?.knownAtBegin ?? new Set<string>();
  let next = reduceRows(state, { ...input, method: "baseline" }, changed);
  const coverage = input.partial === true ? "partial" : "complete";
  if (membership.coverage !== coverage) {
    changed.add(`coverage:${scope}`);
    changed.add(`members:${scope}`);
  }
  next = withMembership(next, scope, {
    coverage,
    members: membership.members,
    excluded: next.memberships.get(scope)?.excluded ?? membership.excluded,
    baseline: null,
  });
  const admitted = new Set(input.members);
  const membershipChanges = new Set<ReadKey>();
  next = reduceMembership(
    next,
    scope,
    {
      add: input.members,
      // A partial answer's absences say nothing: what it lacks has not left the scope.
      remove: coverage === "partial" ? [] : [...knownAtBegin].filter((id) => !admitted.has(id)),
    },
    membershipChanges,
    directives,
  );
  for (const delta of staged)
    next = reduceMembership(next, scope, delta, membershipChanges, directives);
  const members = next.memberships.get(scope)!.members;
  if (
    membershipChanges.size > 0 &&
    (members.size !== membership.members.size ||
      [...members].some(([id, member]) => membership.members.get(id) !== member))
  )
    changed.add(`members:${scope}`);
  return next;
}

function leaveScope(
  state: AccountState,
  scope: ScopeKey,
  id: string,
  changed: Set<ReadKey>,
): AccountState {
  const membership = state.memberships.get(scope);
  if (membership === undefined || !membership.members.has(id)) return state;
  const members = new Map(membership.members);
  members.delete(id);
  changed.add(`members:${scope}`);
  return withMembership(state, scope, { ...membership, members });
}

/** Keep the owner's exclusion in the family scope, while removing every listed membership. */
function unlist(state: AccountState, family: Family, id: string, changed: Set<ReadKey>) {
  const fact = state.facts.get(factKey(family, id));
  const ownScope = fact === undefined ? undefined : ownScopeOf(fact.scope);
  let memberships = state.memberships;
  const scopes = new Set(state.memberships.keys());
  if (ownScope !== undefined) scopes.add(ownScope);
  for (const scope of scopes) {
    const membership = state.memberships.get(scope) ?? EMPTY_MEMBERSHIP;
    if (scopeSpec(scope).family !== family || (scope !== ownScope && !membership.members.has(id)))
      continue;
    if (!membership.members.has(id) && membership.excluded.has(id)) continue;
    const members = new Map(membership.members);
    members.delete(id);
    const excluded = new Set(membership.excluded).add(id);
    memberships = new Map(memberships).set(scope, { ...membership, members, excluded });
    changed.add(`members:${scope}`);
  }
  return memberships;
}

function reduceEvidence(
  state: AccountState,
  input: Extract<AccountInput, { readonly kind: "proven-deletion" | "access" }>,
  changed: Set<ReadKey>,
): AccountState {
  const key = factKey(input.family, input.id);
  const current =
    state.facts.get(key) ??
    (input.scope === undefined || (input.kind === "access" && input.access !== "denied")
      ? undefined
      : ({
          content: { kind: "purged" },
          revision: { kind: "zerops", version: null },
          authority: familySpec(input.family).authority,
          via: "zerops-read",
          method: "read",
          scope: input.scope,
          access: "denied",
        } satisfies Fact<unknown>));
  if (current === undefined) return state;
  const fact: Fact<unknown> =
    input.kind === "proven-deletion"
      ? { ...current, content: { kind: "deleted", evidence: input.evidence } }
      : input.access === "denied"
        ? { ...current, content: { kind: "purged" }, access: "denied" }
        : { ...current, access: input.access };
  changed.add(key);
  const unlisted = input.kind === "proven-deletion" || input.access === "denied";
  return {
    ...state,
    facts: new Map(state.facts).set(key, fact),
    memberships: unlisted ? unlist(state, input.family, input.id, changed) : state.memberships,
  };
}

/** Where a fact counts in one of its family's indexes now: its value and how its scope lists it. */
function indexKey(
  state: AccountState,
  family: Family,
  index: FamilyIndex<unknown>,
  id: string,
): string | null {
  const fact = state.facts.get(factKey(family, id));
  if (fact?.content.kind !== "value") return null;
  const listed = state.memberships.get(ownScopeOf(fact.scope))?.members.get(id);
  return index.keyOf(fact.content.value, listed);
}

/**
 * Each indexed family's index for the ids a reduction touched: moved out of the key it counted
 * under, into the one it counts under now. A deleted or withheld fact counts under none.
 */
function reindex(before: AccountState, after: AccountState, changed: Set<ReadKey>): AccountState {
  // One copy of the index map and of each moved set, never one per id.
  const drafts = new Map<string, Set<string>>();
  const draftOf = (key: string) => {
    let draft = drafts.get(key);
    if (draft === undefined) {
      draft = new Set(after.indexes.get(key));
      drafts.set(key, draft);
    }
    changed.add(`index:${key}`);
    return draft;
  };
  for (const spec of FAMILIES) {
    const indexes = (spec.indexes ?? []) as ReadonlyArray<FamilyIndex<unknown>>;
    if (indexes.length === 0) continue;
    for (const id of touched(spec.family, before, after, changed))
      for (const index of indexes) {
        const was = indexKey(before, spec.family, index, id);
        const is = indexKey(after, spec.family, index, id);
        if (was === is) continue;
        if (was !== null) draftOf(`${index.name}:${was}`).delete(id);
        if (is !== null) draftOf(`${index.name}:${is}`).add(id);
      }
  }
  if (drafts.size === 0) return after;
  const indexes = new Map(after.indexes);
  for (const [key, draft] of drafts) indexes.set(key, draft);
  return { ...after, indexes };
}

/** The ids of `family` a reduction touched: their facts, or their place in one of its scopes. */
function touched(
  family: Family,
  before: AccountState,
  after: AccountState,
  changed: ReadonlySet<ReadKey>,
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const key of changed) {
    if (key.startsWith(`${family}:`)) ids.add(key.slice(family.length + 1));
    if (!key.startsWith("members:")) continue;
    const scope = key.slice("members:".length) as ScopeKey;
    if (scopeSpec(scope).family !== family) continue;
    const old = before.memberships.get(scope)?.members;
    for (const [id, member] of after.memberships.get(scope)?.members ?? [])
      if (old?.get(id) !== member) ids.add(id);
  }
  return ids;
}

/** Whether every scope a delivery names is still in the registration that delivered it. */
const current = (state: AccountState, scopes: ReadonlyArray<HqDeliveryScope>) =>
  scopes.every(({ scope, generation }) => streamOf(state, scope).generation === generation);

function reduceHqDelivery(
  state: AccountState,
  input: Extract<AccountInput, { readonly kind: "hq-delivery" }>,
  changed: Set<ReadKey>,
): AccountState {
  let next = state;
  for (const { scope } of input.scopes) {
    const family = scopeSpec(scope).family;
    const rows = input.rows.filter((row) => row.family === family);
    if (rows.length === 0) continue;
    const before = next;
    next = reduceRows(
      next,
      { scope, via: "hq-stream", method: input.reset ? "baseline" : "push", rows },
      changed,
    );
    const membership = next.memberships.get(scope) ?? EMPTY_MEMBERSHIP;
    let members: Map<string, MemberState> | null = null;
    for (const row of rows) {
      const key = factKey(family, row.id);
      const fact = next.facts.get(key);
      // Only an admitted owner value lists a record; rejected rows say nothing about membership.
      if (fact === before.facts.get(key) || fact?.content.kind !== "value") continue;
      if ((members ?? membership.members).get(row.id) === "member") continue;
      members ??= new Map(membership.members);
      members.set(row.id, "member");
    }
    if (members !== null) {
      changed.add(`members:${scope}`);
      next = withMembership(next, scope, { ...membership, members });
    }
  }
  for (const removal of input.removals)
    next =
      removal.reason === "deleted"
        ? reduceEvidence(
            next,
            {
              kind: "proven-deletion",
              family: removal.family,
              id: removal.id,
              evidence: "HQ removed it as deleted",
            },
            changed,
          )
        : reduceEvidence(
            next,
            { kind: "access", family: removal.family, id: removal.id, access: "denied" },
            changed,
          );
  return next;
}

function completeScopes(
  state: AccountState,
  scopes: ReadonlyArray<HqDeliveryScope>,
  changed: Set<ReadKey>,
): AccountState {
  let next = state;
  for (const { scope } of scopes) {
    const membership = next.memberships.get(scope) ?? EMPTY_MEMBERSHIP;
    if (membership.coverage === "complete") continue;
    changed.add(`coverage:${scope}`);
    changed.add(`members:${scope}`);
    next = withMembership(next, scope, { ...membership, coverage: "complete" });
  }
  return next;
}

export function reduceAccount(state: AccountState, input: AccountInput): Reduction {
  const changed = new Set<ReadKey>();
  if (input.kind === "stream") {
    const { state: stream, directives } = transition(
      streamOf(state, input.key),
      input.event,
      input.now,
    );
    changed.add(`stream:${input.key}`);
    return {
      state: { ...state, streams: new Map(state.streams).set(input.key, stream) },
      changed,
      directives: directives.map((directive) => ({ ...directive, key: input.key })),
    };
  }
  if (isOperationInput(input)) {
    const requestId = requestIdOf(input);
    const current = state.operations.get(requestId);
    const next = reduceOperation(current, input);
    if (next === current || next === undefined) return { state, changed, directives: [] };
    changed.add(`operation:${requestId}`);
    return {
      state: { ...state, operations: new Map(state.operations).set(requestId, next) },
      changed,
      directives: [],
    };
  }
  if (input.kind === "hq-delivery" || input.kind === "hq-ready") {
    if (!current(state, input.scopes)) return { state, changed, directives: [] };
    const next =
      input.kind === "hq-delivery"
        ? reduceHqDelivery(state, input, changed)
        : completeScopes(state, input.scopes, changed);
    return { state: reindex(state, next, changed), changed, directives: [] };
  }
  // A superseded attempt's input is late: its scope already re-registered.
  if ("generation" in input && input.generation !== streamOf(state, input.scope).generation)
    return { state, changed, directives: [] };
  const directives: RuntimeDirective[] = [];
  const next =
    input.kind === "proven-deletion" || input.kind === "access"
      ? reduceEvidence(state, input, changed)
      : input.kind === "baseline-begin"
        ? beginBaseline(state, input.scope)
        : input.kind === "baseline-commit"
          ? commitBaseline(state, input, changed, directives)
          : input.kind === "membership"
            ? reduceMembership(state, input.scope, input.delta, changed, directives)
            : input.kind === "left"
              ? leaveScope(state, input.scope, input.id, changed)
              : reduceRows(state, input, changed);
  return { state: reindex(state, next, changed), changed, directives };
}

/** A fact as the store holds it: for the store's reads and for tests, never for components. */
export const factOf = (state: AccountState, family: Family, id: string) =>
  state.facts.get(factKey(family, id));

/** The ids an index counts under a key; empty when none does. */
export const indexOf = (state: AccountState, name: string, key: string): ReadonlySet<string> =>
  state.indexes.get(`${name}:${key}`) ?? EMPTY_IDS;

const EMPTY_IDS: ReadonlySet<string> = new Set();
