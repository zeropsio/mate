import {
  makeRepoGovernance,
  hqRepoGovernance,
  type AccountStore,
  type RepoGovernanceProjection,
} from "@t3tools/client-runtime/data";
import type { HqApi } from "@t3tools/client-runtime/zerops/hq";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { useCallback, useEffect, useMemo } from "react";

import { useOfficialHq } from "./accountHq";
import { onAccountLifetimeClose } from "./accountLifetime";
import { useAccountOrgId, useAccountStoreForAdapters } from "./ZeropsAccountData";

const EMPTY = Atom.make<RepoGovernanceProjection>({ wanted: false, of: {} });

const hosts = new WeakMap<AccountStore, WeakMap<HqApi, ReturnType<typeof makeRepoGovernance>>>();
function hostFor(store: AccountStore, api: HqApi) {
  let byApi = hosts.get(store);
  if (byApi === undefined) {
    byApi = new WeakMap();
    hosts.set(store, byApi);
  }
  let host = byApi.get(api);
  if (host === undefined) {
    host = makeRepoGovernance({ store, api });
    byApi.set(api, host);
    onAccountLifetimeClose(host.close);
  }
  return host;
}

export function useRepoGovernance(appId: string | null) {
  const hq = useOfficialHq();
  const store = useAccountStoreForAdapters();
  const orgId = useAccountOrgId();
  const key = useMemo(
    () => (orgId === null || appId === null ? null : { orgId, appId }),
    [orgId, appId],
  );
  const host = hq === null || store === null ? null : hostFor(store, hq.api);
  const { wanted, of } = useAtomValue(
    store === null || key === null ? EMPTY : store.data.project(hqRepoGovernance, key),
  );
  useEffect(() => {
    if (wanted && host !== null && key !== null) return host.demand(key);
  }, [host, key, wanted]);
  const again = useCallback(() => {
    if (key !== null) host?.again(key);
  }, [host, key]);
  return { of, again };
}
