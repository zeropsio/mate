/**
 * The account's one writer (HANDOFF §4.4): every input — a stream event, a baseline, a membership
 * delta, versioned rows, evidence of deletion or access — enters here and is dispatched to the one
 * reducer of its family. A reduction names the read keys it changed, for keyed publication, and
 * the work it asks of the runtime. No transport event deletes a fact: only proven deletion does.
 *
 * Pure: no clock (time arrives in the input), no I/O.
 *
 * @module data/reducer
 */
import { RUNNING_PROCESS_STATUSES } from "./demand.ts";
import type {
  Access,
  AccountState,
  Authority,
  Delivery,
  Fact,
  Family,
  FamilyValues,
  MemberState,
  Membership,
  MembershipDelta,
  ReadKey,
  Revision,
  ScopeKey,
  StreamKey,
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
    }
  /** The owner proved the entity gone: the one input that deletes a fact. */
  | {
      readonly kind: "proven-deletion";
      readonly family: Family;
      readonly id: string;
      readonly evidence: string;
    }
  /** The owner's word on the viewer's access; denial withholds and purges, never deletes. */
  | {
      readonly kind: "access";
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
  | {
      readonly kind: "rows";
      readonly scope: ScopeKey;
      readonly generation: number;
      readonly method: "baseline" | "push" | "read";
      readonly via: Delivery;
      readonly rows: ReadonlyArray<Row>;
    };

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

/** Who owns each family, whichever path delivered it: HQ's relay of attention stays the Mate's. */
const AUTHORITY: Readonly<Record<Family, Authority>> = {
  project: "zerops",
  process: "zerops",
  placement: "hq",
  attention: "mate",
};

/** A scope's stream is the child of its link's: `zerops:org:projects` of `zerops:org`. */
function parentOf(key: StreamKey): string | null {
  const parts = key.split(":");
  return parts.length > 2 ? `${parts[0]}:${parts[1]}` : null;
}

export function streamOf(state: AccountState, key: StreamKey): StreamState {
  return state.streams.get(key) ?? initialStream({ parent: parentOf(key), mode: "realtime" });
}

/**
 * Whether `incoming` may replace `current` in its owner's ordering. Revisions compare only inside
 * their own domain: a Mate's own attention revision always outranks HQ's unrevisioned relay of it,
 * which never replaces it back; another incarnation of a Mate is not ordered, so only a baseline
 * replaces it; a value of another domain never replaces one. Time never decides.
 */
export function supersedes(
  current: Revision,
  incoming: Revision,
  method: "baseline" | "push" | "read",
): boolean {
  switch (incoming.kind) {
    case "zerops":
      if (current.kind !== "zerops") return false;
      if (incoming.version === null) return current.version === null;
      return current.version === null || incoming.version > current.version;
    case "hq-observation":
      if (current.kind !== "hq-observation") return false;
      return (
        incoming.generation > current.generation ||
        (incoming.generation === current.generation && incoming.sequence > current.sequence)
      );
    case "mate-attention":
      if (current.kind === "hq-observation") return true;
      if (current.kind !== "mate-attention") return false;
      return current.incarnation === incoming.incarnation
        ? incoming.revision > current.revision
        : method === "baseline";
  }
}

/**
 * Whether a row replaces the fact held for it: a newer revision does. After a denial purged it, the
 * same revision restores it only from an answer that lists it — a baseline, or a read of a member
 * — never from a push, which says nothing of the viewer's access having returned.
 */
function admits(
  state: AccountState,
  input: Pick<Extract<AccountInput, { readonly kind: "rows" }>, "scope" | "method">,
  current: Fact<unknown>,
  row: Row,
): boolean {
  if (supersedes(current.revision, row.revision, input.method)) return true;
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
  // One copy per family a reduction writes, never one per row.
  const drafts = new Map<Family, Map<string, Fact<unknown>>>();
  for (const row of input.rows) {
    const facts =
      drafts.get(row.family) ?? (state[row.family] as ReadonlyMap<string, Fact<unknown>>);
    const current = facts.get(row.id);
    if (current !== undefined && !admits(state, input, current, row)) continue;
    const fact: Fact<unknown> = {
      content: { kind: "value", value: row.value },
      revision: row.revision,
      authority: AUTHORITY[row.family],
      via: input.via,
      method: input.method,
      scope: input.scope,
      // The owner delivering a value is its word that the viewer reads it; unverified stays so.
      access: current?.access === "unverified" ? "unverified" : "allowed",
      ...(row.producer === undefined ? {} : { producer: row.producer }),
    };
    const draft = drafts.get(row.family) ?? new Map(facts);
    drafts.set(row.family, draft.set(row.id, fact));
    changed.add(`${row.family}:${row.id}`);
  }
  return drafts.size === 0 ? state : { ...state, ...Object.fromEntries(drafts) };
}

/** The family a scope's members are, and what leaving it says of them. */
const SCOPE_FAMILY = {
  projects: { family: "project", leaving: "absent-unverified" },
  running: { family: "process", leaving: "removed" },
  navigation: { family: "placement", leaving: "removed" },
  attention: { family: "attention", leaving: "removed" },
} as const satisfies Record<string, { family: Family; leaving: MemberState }>;

const scopeFamily = (scope: ScopeKey) =>
  SCOPE_FAMILY[scope.split(":")[2] as keyof typeof SCOPE_FAMILY];

const EMPTY_MEMBERSHIP: Membership = { coverage: "unknown", members: new Map(), baseline: null };

function reduceMembership(
  state: AccountState,
  scope: ScopeKey,
  delta: MembershipDelta,
  changed: Set<ReadKey>,
  directives: RuntimeDirective[],
): AccountState {
  const { family, leaving } = scopeFamily(scope);
  const membership = state.memberships.get(scope) ?? EMPTY_MEMBERSHIP;
  changed.add(`members:${scope}`);
  // While a baseline is read, a delta may be older or newer than its answer: replay it after.
  if (membership.baseline !== null)
    return withMembership(state, scope, {
      ...membership,
      baseline: { ...membership.baseline, staged: [...membership.baseline.staged, delta] },
    });
  const members = new Map(membership.members);
  for (const id of delta.add) members.set(id, "member");
  for (const id of delta.remove) members.set(id, leaving);
  const facts = state[family] as ReadonlyMap<string, unknown>;
  const unresolved = delta.add.filter((id) => !facts.has(id));
  if (unresolved.length > 0) directives.push({ kind: "resolve-rows", key: scope, ids: unresolved });
  if (leaving === "absent-unverified" && delta.remove.length > 0)
    directives.push({ kind: "verify-absence", key: scope, ids: delta.remove });
  return withMembership(state, scope, { ...membership, members });
}

const withMembership = (
  state: AccountState,
  scope: ScopeKey,
  membership: Membership,
): AccountState => ({ ...state, memberships: new Map(state.memberships).set(scope, membership) });

function beginBaseline(state: AccountState, scope: ScopeKey, changed: Set<ReadKey>): AccountState {
  const { family } = scopeFamily(scope);
  const membership = state.memberships.get(scope) ?? EMPTY_MEMBERSHIP;
  const knownAtBegin = new Set<string>();
  for (const [id, member] of membership.members) if (member === "member") knownAtBegin.add(id);
  for (const [id, fact] of state[family] as ReadonlyMap<string, Fact<unknown>>)
    if (fact.scope === scope) knownAtBegin.add(id);
  changed.add(`members:${scope}`);
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
  if (membership.coverage !== "complete") changed.add(`coverage:${scope}`);
  next = withMembership(next, scope, {
    coverage: "complete",
    members: new Map(membership.members),
    baseline: null,
  });
  const admitted = new Set(input.members);
  next = reduceMembership(
    next,
    scope,
    { add: input.members, remove: [...knownAtBegin].filter((id) => !admitted.has(id)) },
    changed,
    directives,
  );
  for (const delta of staged) next = reduceMembership(next, scope, delta, changed, directives);
  return next;
}

/** The entity's id leaves every scope of its family: it is gone, or not the viewer's to list. */
function unlist(state: AccountState, family: Family, id: string, changed: Set<ReadKey>) {
  let memberships = state.memberships;
  for (const [scope, membership] of state.memberships) {
    if (scopeFamily(scope).family !== family || !membership.members.has(id)) continue;
    const members = new Map(membership.members);
    members.delete(id);
    memberships = new Map(memberships).set(scope, { ...membership, members });
    changed.add(`members:${scope}`);
  }
  return memberships;
}

function reduceEvidence(
  state: AccountState,
  input: Extract<AccountInput, { readonly kind: "proven-deletion" | "access" }>,
  changed: Set<ReadKey>,
): AccountState {
  const facts = state[input.family] as ReadonlyMap<string, Fact<unknown>>;
  const current = facts.get(input.id);
  if (current === undefined) return state;
  const fact: Fact<unknown> =
    input.kind === "proven-deletion"
      ? { ...current, content: { kind: "deleted", evidence: input.evidence } }
      : input.access === "denied"
        ? { ...current, content: { kind: "purged" }, access: "denied" }
        : { ...current, access: input.access };
  changed.add(`${input.family}:${input.id}`);
  const unlisted = input.kind === "proven-deletion" || input.access === "denied";
  return {
    ...state,
    [input.family]: new Map(facts).set(input.id, fact),
    memberships: unlisted ? unlist(state, input.family, input.id, changed) : state.memberships,
  };
}

const RUNNING_STATUSES: ReadonlySet<string> = new Set(RUNNING_PROCESS_STATUSES);

/**
 * The running index for these processes: a process runs while its newest row is not terminal and
 * its running scope has not let it go. A terminal row clears it without saying how it ended beyond
 * that row; leaving the scope clears it without inventing any end at all.
 */
function reindexRunning(
  before: AccountState,
  state: AccountState,
  ids: ReadonlySet<string>,
  changed: Set<ReadKey>,
): AccountState {
  // One copy of the index and of each project's set a reduction moves, never one per process.
  const drafts = new Map<string, Set<string>>();
  for (const id of ids) {
    const fact = state.process.get(id);
    const was = before.process.get(id)?.content;
    const value = fact?.content.kind === "value" ? fact.content.value : undefined;
    // A deleted or withheld process keeps the project its last value named, to leave it.
    const projectId = value?.projectId ?? (was?.kind === "value" ? was.value.projectId : null);
    if (fact === undefined || projectId === null) continue;
    const runs =
      value !== undefined &&
      RUNNING_STATUSES.has(value.status) &&
      state.memberships.get(fact.scope)?.members.get(id) !== "removed";
    const current = drafts.get(projectId) ?? state.running.get(projectId) ?? new Set<string>();
    if (current.has(id) === runs) continue;
    const draft = drafts.get(projectId) ?? new Set(current);
    if (runs) draft.add(id);
    else draft.delete(id);
    drafts.set(projectId, draft);
    changed.add(`running:${projectId}`);
  }
  if (drafts.size === 0) return state;
  const running = new Map(state.running);
  for (const [projectId, draft] of drafts) running.set(projectId, draft);
  return { ...state, running };
}

/** The application a project is placed in, while its navigation scope still lists it. */
function appOf(state: AccountState, projectId: string): string | null {
  const fact = state.placement.get(projectId);
  if (fact?.content.kind !== "value" || fact.content.value.kind !== "app") return null;
  return state.memberships.get(fact.scope)?.members.get(projectId) === "member"
    ? fact.content.value.appId
    : null;
}

/** The application index for these projects: moved out of where they were, into where they are. */
function reindexApps(
  before: AccountState,
  after: AccountState,
  ids: ReadonlySet<string>,
  changed: Set<ReadKey>,
): AccountState {
  const drafts = new Map<string, Set<string>>();
  const draftOf = (appId: string) => {
    let draft = drafts.get(appId);
    if (draft === undefined) {
      draft = new Set(after.apps.get(appId));
      drafts.set(appId, draft);
    }
    changed.add(`app:${appId}`);
    return draft;
  };
  for (const id of ids) {
    const was = appOf(before, id);
    const is = appOf(after, id);
    if (was === is) continue;
    if (was !== null) draftOf(was).delete(id);
    if (is !== null) draftOf(is).add(id);
  }
  if (drafts.size === 0) return after;
  const apps = new Map(after.apps);
  for (const [appId, draft] of drafts) apps.set(appId, draft);
  return { ...after, apps };
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
    if (scopeFamily(scope).family !== family) continue;
    const old = before.memberships.get(scope)?.members;
    for (const [id, member] of after.memberships.get(scope)?.members ?? [])
      if (old?.get(id) !== member) ids.add(id);
  }
  return ids;
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
  // A superseded attempt's input is late: its scope already re-registered.
  if ("generation" in input && input.generation !== streamOf(state, input.scope).generation)
    return { state, changed, directives: [] };
  const directives: RuntimeDirective[] = [];
  const next =
    input.kind === "proven-deletion" || input.kind === "access"
      ? reduceEvidence(state, input, changed)
      : input.kind === "baseline-begin"
        ? beginBaseline(state, input.scope, changed)
        : input.kind === "baseline-commit"
          ? commitBaseline(state, input, changed, directives)
          : input.kind === "membership"
            ? reduceMembership(state, input.scope, input.delta, changed, directives)
            : reduceRows(state, input, changed);
  const indexed = reindexRunning(state, next, touched("process", state, next, changed), changed);
  return {
    state: reindexApps(state, indexed, touched("placement", state, next, changed), changed),
    changed,
    directives,
  };
}
