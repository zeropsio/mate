import { RegistryContext } from "@effect/atom-react";
import {
  zeropsResourceKeyOf,
  type EntityKnowledge,
  type ManagedZeropsDataRuntime,
  type OrganizationRef,
  type ProjectRef,
  type RuntimeInterestDescriptor,
  type ZeropsEntityRecord,
  type ZeropsResourceRequest,
  type ZeropsResourceSnapshot,
  type ZeropsResourceValue,
} from "@t3tools/client-runtime/zerops/data";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { Atom, type AtomRegistry } from "effect/unstable/reactivity";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

export interface ZeropsDataContextValue {
  readonly runtime: ManagedZeropsDataRuntime;
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
): Promise<Value> {
  const outcome = await Effect.runPromise(
    command.pipe(
      Effect.match({
        onFailure: (error) => ({ ok: false as const, error }),
        onSuccess: (execution) => ({ ok: true as const, value: execution.value }),
      }),
    ),
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

/** Combines a dynamic set of narrow projections without observing their account root atom. */
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
    const releases = entries.map(([, atom]) => registry.subscribe(atom, refresh));
    refresh();
    return () => {
      for (const release of releases) release();
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
export function useZeropsDataInterest(
  descriptor: RuntimeInterestDescriptor | null,
  refreshKey: number = 0,
): void {
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
  }, [runtime, identity, refreshKey]);
}

/** Holds one demand-scoped configuration resource lease for the mounted consumer. */
export function useZeropsResource<Request extends ZeropsResourceRequest>(
  request: Request | null,
): ZeropsResourceSnapshot<ZeropsResourceValue<Request>> {
  const { runtime } = useZeropsData();
  const key = request === null ? null : zeropsResourceKeyOf(request);
  const [current, setCurrent] = useState<{
    readonly key: string | null;
    readonly snapshot: ZeropsResourceSnapshot<ZeropsResourceValue<Request>>;
  }>({ key: null, snapshot: { status: "released" } });

  useEffect(() => {
    if (request === null || key === null) {
      setCurrent({ key: null, snapshot: { status: "released" } });
      return;
    }
    const controller = new AbortController();
    void Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const lease = yield* runtime.resources.acquire(request);
          if (controller.signal.aborted) return;
          setCurrent({ key, snapshot: yield* lease.snapshot });
          yield* Stream.runForEach(lease.changes, (snapshot) =>
            Effect.sync(() => {
              if (!controller.signal.aborted) setCurrent({ key, snapshot });
            }),
          );
        }),
      ),
      { signal: controller.signal },
    ).catch(() => {
      if (!controller.signal.aborted) {
        setCurrent({
          key,
          snapshot: {
            status: "failure",
            attempt: 1,
            failure: {
              _tag: "ZeropsResourceReadFailure",
              kind: "unexpected",
              retryable: false,
            },
          },
        });
      }
    });
    return () => {
      controller.abort();
    };
    // `request` is intentionally not a dep: every caller memoizes it so it
    // changes exactly when `key` does. Depending on `runtime.resources`
    // (stable per runtime) instead avoids re-leasing on an un-memoized
    // caller's per-render request identity.
  }, [key, runtime.resources]);

  if (current.key === key) return current.snapshot;
  return key === null ? { status: "released" } : { status: "loading", attempt: 1 };
}
