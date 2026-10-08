import {
  makeAutoUpdatePolicyReads,
  autoUpdatePolicySettings,
  type AutoUpdatePolicySettings,
  type AccountStore,
} from "@t3tools/client-runtime/data";
import type { HqApi } from "@t3tools/client-runtime/zerops/hq";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { useEffect, useMemo } from "react";
import { useOfficialHq } from "./accountHq";
import { onAccountLifetimeClose } from "./accountLifetime";
import { useAccountOrgId, useAccountStoreForAdapters } from "./ZeropsAccountData";

const UNREAD = Atom.make<AutoUpdatePolicySettings>({
  enabled: null,
  editable: false,
  pending: false,
  words: "Waiting for HQ…",
  error: null,
  retryRead: false,
  requestId: "",
});
const readers = new WeakMap<
  AccountStore,
  WeakMap<HqApi, ReturnType<typeof makeAutoUpdatePolicyReads>>
>();
function readerFor(store: AccountStore, api: HqApi) {
  let byApi = readers.get(store);
  if (byApi === undefined) {
    byApi = new WeakMap();
    readers.set(store, byApi);
  }
  let reader = byApi.get(api);
  if (reader === undefined) {
    reader = makeAutoUpdatePolicyReads(store, api);
    byApi.set(api, reader);
    onAccountLifetimeClose(reader.close);
  }
  return reader;
}
export function useAutoUpdatePolicy(admin: boolean) {
  const hq = useOfficialHq();
  const store = useAccountStoreForAdapters();
  const orgId = useAccountOrgId();
  const key = useMemo(() => (orgId === null ? null : { orgId, admin }), [orgId, admin]);
  const reader = store === null || hq === null ? null : readerFor(store, hq.api);
  const policy = useAtomValue(
    store === null || key === null ? UNREAD : store.data.project(autoUpdatePolicySettings, key),
  );
  useEffect(() => {
    if (reader === null || orgId === null) return;
    return reader.demand(orgId);
  }, [reader, orgId]);
  return {
    policy,
    again: () => {
      if (reader !== null && orgId !== null) reader.again(orgId);
    },
  };
}
