import { RegistryContext } from "@effect/atom-react";
import type {
  AccountScope,
  OrganizationRef,
  ProjectRef,
} from "@t3tools/client-runtime/zerops/data";
import type { PlatformSignals } from "@t3tools/client-runtime/zerops/knowledge";
import { type Atom, type AtomRegistry } from "effect/unstable/reactivity";
import { createContext, useContext, useMemo, useSyncExternalStore } from "react";

import { batchedPerTask } from "./taskBatch";

export interface ZeropsDataContextValue {
  readonly scope: AccountScope;
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

export type ZeropsAtomSelection<Value> = readonly [key: string, atom: Atom.Atom<Value>];

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
