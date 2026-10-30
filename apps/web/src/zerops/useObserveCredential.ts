/** Opening this page demands metadata only; the two commands require a person's press. */
import {
  makeObserveCredential,
  observeCredential,
  type AccountStore,
  type ObserveCredentialRead,
} from "@t3tools/client-runtime/data";
import type { HqApi } from "@t3tools/client-runtime/zerops/hq";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { useEffect, useMemo } from "react";
import { useOfficialHq } from "./accountHq";
import { onAccountLifetimeClose } from "./accountLifetime";
import { useAccountOrgId, useAccountStoreForAdapters } from "./ZeropsAccountData";
import { randomUUID } from "../lib/utils";
const UNREAD = Atom.make<ObserveCredentialRead>({
  metadata: { state: "unread" },
  action: { kind: "idle" },
});
const hosts = new WeakMap<AccountStore, WeakMap<HqApi, ReturnType<typeof makeObserveCredential>>>();
function hostFor(store: AccountStore, api: HqApi) {
  let byApi = hosts.get(store);
  if (byApi === undefined) {
    byApi = new WeakMap();
    hosts.set(store, byApi);
  }
  let host = byApi.get(api);
  if (host === undefined) {
    host = makeObserveCredential({ store, api, makeId: randomUUID });
    byApi.set(api, host);
    onAccountLifetimeClose(host.close);
  }
  return host;
}
export function useObserveCredential(projectId: string | null) {
  const hq = useOfficialHq();
  const account = useAccountStoreForAdapters();
  const orgId = useAccountOrgId();
  const key = useMemo(
    () => (orgId === null || projectId === null ? null : { orgId, projectId }),
    [orgId, projectId],
  );
  const host = hq === null || account === null ? null : hostFor(account, hq.api);
  const state = useAtomValue(
    account === null || key === null ? UNREAD : account.data.project(observeCredential, key),
  );
  useEffect(() => {
    if (host !== null && key !== null) return host.demand(key);
  }, [host, key]);
  return {
    state,
    available: host !== null && key !== null,
    authorize: () => {
      if (host !== null && key !== null) void host.authorize(key);
    },
    revoke: () => {
      if (host !== null && key !== null) void host.revoke(key);
    },
    again: () => {
      if (host !== null && key !== null) host.again(key);
    },
  };
}
