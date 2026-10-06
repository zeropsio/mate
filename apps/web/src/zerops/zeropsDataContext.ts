import { RegistryContext } from "@effect/atom-react";
import type {
  EntityKnowledge,
  ManagedZeropsDataRuntime,
  OrganizationRef,
  ProjectRef,
  RuntimeInterestDescriptor,
  ZeropsEntityRecord,
} from "@t3tools/client-runtime/zerops/data";
import type { PlatformSignals } from "@t3tools/client-runtime/zerops/knowledge";
import * as Effect from "effect/Effect";
import { Atom, type AtomRegistry } from "effect/unstable/reactivity";
import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from "react";

import { batchedPerTask } from "./taskBatch";

export interface ZeropsDataContextValue {
  readonly runtime: ManagedZeropsDataRuntime;
  /** The tab, as every consumer of the account hears it (DESIGN §6.4). */
  readonly signals: PlatformSignals;
  readonly organizationRef: (organizationId: string) => OrganizationRef;
  readonly projectRef: (organizationId: string, projectId: string) => ProjectRef;
}

export const ZeropsDataContext = createContext<ZeropsDataContextValue | null>(null);

export function useZeropsData(): ZeropsDataContextValue {
  const value = useContext(ZeropsDataContext);
  if (value === null) throw new Error("Zerops data requires a verified account.");
  return value;
}

/** Runs one typed command while preserving its domain failure for UI error handling. */
export async function runZeropsCommand<Value, Failure>(
  command: Effect.Effect<{ readonly value: Value }, Failure>,
  /** Ends the command where it stands: one not sent yet is never sent. */
  signal?: AbortSignal,
): Promise<Value> {
  const outcome = await Effect.runPromise(
    command.pipe(
      Effect.match({
        onFailure: (error) => ({ ok: false as const, error }),
        onSuccess: (execution) => ({ ok: true as const, value: execution.value }),
      }),
    ),
    signal === undefined ? undefined : { signal },
  );
  if (outcome.ok) return outcome.value;
  throw outcome.error;
}

export type ZeropsAtomSelection<Value> = readonly [key: string, atom: Atom.Atom<Value>];

/** Prevents a broad dependency inside a runtime read from publishing when its selected value is unchanged. */
export function stabilizeZeropsAtom<Value>(
  source: Atom.Atom<Value>,
  equal: (left: Value, right: Value) => boolean,
): Atom.Atom<Value> {
  let previous: Value | undefined;
  return Atom.make((get) => {
    const next = get(source);
    if (previous !== undefined && equal(previous, next)) return previous;
    previous = next;
    return next;
  });
}

export function zeropsKnowledgeArraysEqual<Record extends ZeropsEntityRecord>(
  left: ReadonlyArray<EntityKnowledge<Record>>,
  right: ReadonlyArray<EntityKnowledge<Record>>,
): boolean {
  return (
    left.length === right.length &&
    left.every((knowledge, index) => {
      const candidate = right[index]!;
      if (knowledge.knowledge !== candidate.knowledge) return false;
      if (knowledge.knowledge === "observed" && candidate.knowledge === "observed")
        return knowledge.record === candidate.record;
      if (knowledge.knowledge === "unavailable" && candidate.knowledge === "unavailable")
        return (
          knowledge.ref === candidate.ref &&
          knowledge.reason === candidate.reason &&
          knowledge.since === candidate.since
        );
      return knowledge.knowledge === "unresolved" && candidate.knowledge === "unresolved"
        ? knowledge.ref === candidate.ref
        : false;
    })
  );
}

/**
 * Combines a dynamic set of narrow projections without observing their account root atom. A
 * subscriber hears its atoms' changes once per task, however many of them changed in it.
 */
export function makeZeropsAtomSelectionStore<Value>(
  registry: AtomRegistry.AtomRegistry,
  entries: ReadonlyArray<ZeropsAtomSelection<Value>>,
) {
  let snapshot = new Map(entries.map(([key, atom]) => [key, registry.get(atom)]));
  const getSnapshot = () => snapshot;
  const subscribe = (listener: () => void) => {
    const refresh = () => {
      const next = new Map(entries.map(([key, atom]) => [key, registry.get(atom)]));
      if (
        next.size === snapshot.size &&
        [...next].every(([key, value]) => snapshot.get(key) === value)
      )
        return;
      snapshot = next;
      listener();
    };
    const batched = batchedPerTask(refresh);
    const releases = entries.map(([, atom]) => registry.subscribe(atom, batched.notify));
    refresh();
    return () => {
      for (const release of releases) release();
      batched.cancel();
    };
  };
  return { getSnapshot, subscribe };
}

export function useZeropsAtomSelections<Value>(
  entries: ReadonlyArray<ZeropsAtomSelection<Value>>,
): ReadonlyMap<string, Value> {
  const registry = useContext(RegistryContext);
  const store = useMemo(() => makeZeropsAtomSelectionStore(registry, entries), [entries, registry]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

/** A React view owns only demand. The account runtime owns transport and data. */
export function useZeropsDataInterest(descriptor: RuntimeInterestDescriptor | null): void {
  const { runtime } = useZeropsData();
  const identity = useMemo(
    () => (descriptor === null ? null : JSON.stringify(descriptor)),
    [descriptor],
  );

  useEffect(() => {
    if (descriptor === null) return;
    const controller = new AbortController();
    void Effect.runPromise(
      Effect.scoped(runtime.acquire(descriptor).pipe(Effect.andThen(Effect.never))),
      { signal: controller.signal },
    ).catch(() => undefined);
    return () => {
      controller.abort();
    };
  }, [runtime, identity]);
}
