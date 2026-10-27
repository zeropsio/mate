import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { EnvironmentRegistry } from "@t3tools/client-runtime/connection";
import {
  makeArchiveReads,
  makeArchiveWire,
  mateArchive,
  type AccountStore,
  type ArchiveReading,
} from "@t3tools/client-runtime/data";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { useCallback, useContext, useEffect, useMemo } from "react";

import { connectionAtomRuntime } from "../connection/runtime";
import { environmentPresentations } from "../state/presentation";
import { connectedEnvironmentIds } from "../state/queries";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { useAccountStoreForAdapters } from "../zerops/ZeropsAccountData";
import { onAccountLifetimeClose } from "../zerops/accountLifetime";

interface ArchiveHost {
  readonly store: AccountStore;
  readonly reads: ReturnType<typeof makeArchiveReads>;
  readonly close: () => void;
}
const hostAtom = Atom.keepAlive(Atom.make<ArchiveHost | null>(null));
const registryAtom = connectionAtomRuntime.atom(
  Effect.map(EnvironmentRegistry, (registry) => registry),
);
const UNREAD: ArchiveReading = {
  snapshots: [],
  failures: [],
  coverage: [],
  error: null,
  isLoading: false,
};
const unreadAtom = Atom.make(UNREAD);

export function refreshArchivedThreadsForEnvironment(environmentId: EnvironmentId): void {
  appAtomRegistry.get(hostAtom)?.reads.again(environmentId);
}

/** Archives are retained in account memory. Only connected Mates receive read demand. */
export function useArchivedThreadSnapshots(
  requestedEnvironmentIds: ReadonlyArray<EnvironmentId>,
): ArchiveReading & { readonly refresh: () => void } {
  const atoms = useContext(RegistryContext);
  const store = useAccountStoreForAdapters();
  const connection = Option.getOrUndefined(AsyncResult.value(useAtomValue(registryAtom)));
  const host = useAtomValue(hostAtom);
  const presentations = useAtomValue(environmentPresentations.presentationsAtom);
  const environmentIds = useMemo(
    () => connectedEnvironmentIds(requestedEnvironmentIds, presentations),
    [presentations, requestedEnvironmentIds],
  );
  const key = useMemo(
    () => ({ environmentIds: requestedEnvironmentIds, connectedIds: environmentIds }),
    [requestedEnvironmentIds, environmentIds],
  );
  const result = useAtomValue(store === null ? unreadAtom : store.data.project(mateArchive, key));

  // This host outlives the Settings view, so archive actions can invalidate a retained read while
  // the view is closed. Its transport owns no facts and ends with the account's store/registry.
  useEffect(() => {
    if (store === null || connection === undefined) return;
    const previous = atoms.get(hostAtom);
    if (previous?.store === store) return;
    previous?.close();
    const reads = makeArchiveReads(store, makeArchiveWire(connection));
    let unlisten = () => {};
    const made: ArchiveHost = {
      store,
      reads,
      close: () => {
        reads.close();
        unlisten();
        if (atoms.get(hostAtom) === made) atoms.set(hostAtom, null);
      },
    };
    unlisten = onAccountLifetimeClose(made.close);
    atoms.set(hostAtom, made);
  }, [atoms, connection, store]);
  useEffect(() => {
    if (host === null || host.store !== store) return;
    const releases = environmentIds.map(host.reads.demand);
    return () => {
      for (const release of releases) release();
    };
  }, [environmentIds, host, store]);
  const refresh = useCallback(() => {
    if (host?.store !== store) return;
    for (const environmentId of environmentIds) host?.reads.again(environmentId);
  }, [environmentIds, host, store]);
  return { ...result, refresh };
}
