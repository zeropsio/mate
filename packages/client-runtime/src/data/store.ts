/**
 * The account's store: its state behind the one reducer, and keyed publication (HANDOFF §4.5).
 * Every read key — a fact, a scope's membership, a project's running work, a stream — has its own
 * atom, created on first read; a reduction sets only the atoms of the keys it changed, inside one
 * `Atom.batch`. A reader never gets a raw record or a writable atom: facts arrive as
 * {@link PublicRead}, withheld payloads never leave.
 *
 * `dispatch` is the adapters' door, never a component's.
 *
 * @module data/store
 */
import { Atom, type AtomRegistry } from "effect/unstable/reactivity";

import {
  emptyAccount,
  type AccountState,
  type Fact,
  type Family,
  type FamilyValues,
  type PublicRead,
  type ReadKey,
  type ScopeKey,
  type StreamKey,
} from "./model.ts";
import { reduceAccount, streamOf, type AccountInput, type RuntimeDirective } from "./reducer.ts";
import type { StreamState } from "./streamMachine.ts";

/** A scope's membership as a reader sees it: listed ids, and those whose leaving is unproven. */
export interface MembershipRead {
  readonly coverage: "unknown" | "complete";
  readonly ids: ReadonlyArray<string>;
  readonly unverified: ReadonlyArray<string>;
}

/** Everything a projection may read: keyed, filtered by access, never a whole table. */
export interface ProjectionReads {
  readonly fact: <F extends Family>(family: F, id: string) => PublicRead<FamilyValues[F]>;
  readonly members: (scope: ScopeKey) => MembershipRead;
  /** Whether a scope ever committed a baseline: what earns an empty answer. */
  readonly coverage: (scope: ScopeKey) => "unknown" | "complete";
  readonly running: (projectId: string) => ReadonlySet<string>;
  /** The projects HQ places in an application. */
  readonly app: (appId: string) => ReadonlySet<string>;
  readonly stream: (key: StreamKey) => StreamState;
}

export interface Projection<Key, Value> {
  readonly name: string;
  readonly derive: (read: ProjectionReads, key: Key) => Value;
  readonly equals: (left: Value, right: Value) => boolean;
  /** The key's identity, for one atom per projection and key. */
  readonly keyOf: (key: Key) => string;
}

export interface AccountData {
  readonly fact: <F extends Family>(
    family: F,
    id: string,
  ) => Atom.Atom<PublicRead<FamilyValues[F]>>;
  readonly stream: (key: StreamKey) => Atom.Atom<StreamState>;
  /** One atom per projection and key; it reads, and so recomputes on, only the keys it touched. */
  readonly project: <Key, Value>(projection: Projection<Key, Value>, key: Key) => Atom.Atom<Value>;
}

export interface AccountStore {
  readonly data: AccountData;
  /** The adapters' one entry: reduces, publishes the changed keys, returns the runtime's work. */
  readonly dispatch: (input: AccountInput) => ReadonlyArray<RuntimeDirective>;
  readonly state: () => AccountState;
}

const EMPTY_IDS: ReadonlySet<string> = new Set();

export function publicRead<T>(fact: Fact<T> | undefined): PublicRead<T> {
  if (fact === undefined) return { kind: "unknown" };
  switch (fact.content.kind) {
    case "deleted":
      return { kind: "deleted", evidence: fact.content.evidence };
    case "purged":
      return { kind: "withheld", reason: "denied" };
    case "value":
      return {
        kind: "known",
        value: fact.content.value,
        revision: fact.revision,
        scope: fact.scope,
        ...(fact.producer === undefined ? {} : { producer: fact.producer }),
      };
  }
}

/** The value a read key holds in `state`. */
function valueOf(state: AccountState, key: ReadKey): unknown {
  const at = key.indexOf(":");
  const head = key.slice(0, at);
  const rest = key.slice(at + 1);
  switch (head) {
    case "stream":
      return streamOf(state, rest as StreamKey);
    case "members": {
      const membership = state.memberships.get(rest as ScopeKey);
      const ids: string[] = [];
      const unverified: string[] = [];
      for (const [id, member] of membership?.members ?? []) {
        if (member === "member") ids.push(id);
        if (member === "absent-unverified") unverified.push(id);
      }
      return {
        coverage: membership?.coverage ?? "unknown",
        ids,
        unverified,
      } satisfies MembershipRead;
    }
    case "coverage":
      return state.memberships.get(rest as ScopeKey)?.coverage ?? "unknown";
    case "running":
      return state.running.get(rest) ?? EMPTY_IDS;
    case "app":
      return state.apps.get(rest) ?? EMPTY_IDS;
    default:
      return publicRead((state[head as Family] as ReadonlyMap<string, Fact<unknown>>).get(rest));
  }
}

/** Reads straight from a state: what a projection gets in a test, and inside its atom. */
export function readsOf(read: <T>(key: ReadKey) => T): ProjectionReads {
  return {
    fact: (family, id) => read(`${family}:${id}`),
    members: (scope) => read(`members:${scope}`),
    coverage: (scope) => read(`coverage:${scope}`),
    running: (projectId) => read(`running:${projectId}`),
    app: (appId) => read(`app:${appId}`),
    stream: (key) => read(`stream:${key}`),
  };
}

export const readsOfState = (state: AccountState): ProjectionReads =>
  readsOf(<T>(key: ReadKey) => valueOf(state, key) as T);

export function makeAccountStore(registry: AtomRegistry.AtomRegistry): AccountStore {
  let state = emptyAccount;
  const cells = new Map<ReadKey, Atom.Writable<unknown>>();
  const cell = <T>(key: ReadKey): Atom.Writable<T> => {
    let atom = cells.get(key);
    if (atom === undefined) {
      atom = Atom.keepAlive(Atom.make(valueOf(state, key)));
      cells.set(key, atom);
    }
    return atom as Atom.Writable<T>;
  };
  const projected = new WeakMap<Projection<never, unknown>, Map<string, Atom.Atom<unknown>>>();
  const project = <Key, Value>(projection: Projection<Key, Value>, key: Key): Atom.Atom<Value> => {
    let byKey = projected.get(projection as Projection<never, unknown>);
    if (byKey === undefined) {
      byKey = new Map();
      projected.set(projection as Projection<never, unknown>, byKey);
    }
    const id = projection.keyOf(key);
    let atom = byKey.get(id);
    if (atom === undefined) {
      atom = Atom.make((get) =>
        projection.derive(
          readsOf(<T>(readKey: ReadKey) => get(cell<T>(readKey))),
          key,
        ),
      ).pipe(Atom.withEquality(projection.equals)) as Atom.Atom<unknown>;
      byKey.set(id, atom);
    }
    return atom as Atom.Atom<Value>;
  };
  return {
    state: () => state,
    data: {
      fact: (family, id) => cell(`${family}:${id}`),
      stream: (key) => cell(`stream:${key}`),
      project,
    },
    dispatch: (input) => {
      const reduction = reduceAccount(state, input);
      state = reduction.state;
      Atom.batch(() => {
        for (const key of reduction.changed) {
          const atom = cells.get(key);
          if (atom !== undefined) registry.set(atom, valueOf(state, key));
        }
      });
      return reduction.directives;
    },
  };
}
