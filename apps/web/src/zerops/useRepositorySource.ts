import {
  makeRepositoryStore,
  type HqApi,
  type RepositoryTarget,
} from "@t3tools/client-runtime/zerops/hq";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { useOfficialHq } from "./accountHq";
import { onAccountLifetimeClose } from "./accountLifetime";

const stores = new Map<HqApi, ReturnType<typeof makeRepositoryStore>>();
onAccountLifetimeClose(() => {
  for (const store of stores.values()) store.close();
  stores.clear();
});
const UNREAD = { state: "unread", waitingFor: null } as const;
function storeFor(api: HqApi) {
  let store = stores.get(api);
  if (store === undefined) {
    store = makeRepositoryStore({
      read: ({ appId, repo, query }, signal) => api.repositorySource(appId, repo, query, signal),
      now: () => Date.now(),
    });
    stores.set(api, store);
  }
  return store;
}
export function useRepositorySource(input: RepositoryTarget) {
  const hq = useOfficialHq();
  const store = hq === null ? null : storeFor(hq.api);
  const {
    appId,
    repo,
    query: { rev, path, kind },
  } = input;
  // A route's spelling is stable even when its component renders again.
  const target = useMemo(
    () => ({ appId, repo, query: { ...(rev === undefined ? {} : { rev }), path, kind } }),
    [appId, repo, rev, path, kind],
  );
  const subscribe = useCallback(
    (listener: () => void) => store?.subscribe(target, listener) ?? (() => undefined),
    [store, target],
  );
  const source = useSyncExternalStore(subscribe, () => store?.snapshot(target) ?? UNREAD);
  useEffect(() => {
    if (store !== null) void store.load(target);
  }, [store, target]);
  return {
    source,
    again: () => {
      if (store !== null) void store.again(target);
    },
  };
}
