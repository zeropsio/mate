/**
 * The organization's activity as the Settings page reads it, a page at a time through the account
 * (`makeActivity`): a page is read while the screen that shows it stays open.
 */
import {
  activityPage,
  makeActivity,
  type AccountStore,
  type ActivityPageRead,
} from "@t3tools/client-runtime/data";
import type { HqApi } from "@t3tools/client-runtime/zerops/hq";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { useEffect, useMemo } from "react";

import { useOfficialHq } from "./accountHq";
import { onAccountLifetimeClose } from "./accountLifetime";
import { useAccountOrgId, useAccountStoreForAdapters } from "./ZeropsAccountData";

const hosts = new WeakMap<AccountStore, WeakMap<HqApi, ReturnType<typeof makeActivity>>>();
function hostFor(store: AccountStore, api: HqApi) {
  let byApi = hosts.get(store);
  if (byApi === undefined) {
    byApi = new WeakMap();
    hosts.set(store, byApi);
  }
  let host = byApi.get(api);
  if (host === undefined) {
    host = makeActivity({ store, api });
    byApi.set(api, host);
    onAccountLifetimeClose(host.close);
  }
  return host;
}

const PAGE_UNREAD = Atom.make<ActivityPageRead>({ state: "unread" });

/** One page of the activity — the newest for `before` `null` — read while it is drawn. */
export function useActivityPage(before: string | null) {
  const hq = useOfficialHq();
  const store = useAccountStoreForAdapters();
  const orgId = useAccountOrgId();
  const host = hq === null || store === null ? null : hostFor(store, hq.api);
  const key = useMemo(() => (orgId === null ? null : { orgId, before }), [orgId, before]);
  const read = useAtomValue(
    store === null || key === null ? PAGE_UNREAD : store.data.project(activityPage, key),
  );
  useEffect(() => {
    if (host !== null && key !== null) return host.demand(key);
  }, [host, key]);
  return {
    read,
    again: () => {
      if (host !== null && key !== null) host.again(key);
    },
  };
}
