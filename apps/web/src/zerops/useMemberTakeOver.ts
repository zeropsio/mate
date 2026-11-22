/**
 * A member's take-over, read and written through the account (`makeTakeOver`): the integration
 * tokens they minted that keep Zerops refusing their removal, read while their page shows them.
 */
import {
  makeTakeOver,
  memberTakeOver,
  type AccountStore,
  type MemberTakeOverRead,
} from "@t3tools/client-runtime/data";
import type { ZeropsApiClient } from "@t3tools/client-runtime/zerops";
import type { HqApi } from "@t3tools/client-runtime/zerops/hq";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { useEffect, useMemo } from "react";

import { randomUUID } from "../lib/utils";
import { useOfficialHq } from "./accountHq";
import { onAccountLifetimeClose } from "./accountLifetime";
import { useAccountOrgId, useAccountStoreForAdapters } from "./ZeropsAccountData";
import { useZeropsSessionOptional } from "./sessionContext";

const hosts = new WeakMap<AccountStore, WeakMap<HqApi, ReturnType<typeof makeTakeOver>>>();
/** One host per store and HQ api; the HQ api is made per Zerops client, so `client` is its own. */
function hostFor(store: AccountStore, api: HqApi, client: ZeropsApiClient) {
  let byApi = hosts.get(store);
  if (byApi === undefined) {
    byApi = new WeakMap();
    hosts.set(store, byApi);
  }
  let host = byApi.get(api);
  if (host === undefined) {
    host = makeTakeOver({
      store,
      api,
      tokens: (orgId) => client.integrationTokens(orgId),
      makeId: randomUUID,
    });
    byApi.set(api, host);
    onAccountLifetimeClose(host.close);
  }
  return host;
}

const UNREAD = Atom.make<MemberTakeOverRead>({
  list: { state: "unread" },
  action: { kind: "idle" },
  last: null,
});

/** The member's tokens to take over, read while `userId` is given; replaced one by one from here. */
export function useMemberTakeOver(userId: string | undefined) {
  const hq = useOfficialHq();
  const client = useZeropsSessionOptional()?.client;
  const store = useAccountStoreForAdapters();
  const orgId = useAccountOrgId();
  const host =
    hq === null || store === null || client === undefined ? null : hostFor(store, hq.api, client);
  const key = useMemo(
    () => (orgId === null || userId === undefined ? null : { orgId, userId }),
    [orgId, userId],
  );
  const read = useAtomValue(
    store === null || key === null ? UNREAD : store.data.project(memberTakeOver, key),
  );
  useEffect(() => {
    if (host !== null && key !== null) return host.demand(key);
  }, [host, key]);
  return {
    read,
    replace: (tokenId: string, ownerUserId?: string) => {
      if (host !== null && key !== null) void host.replace(key, tokenId, ownerUserId);
    },
    again: () => {
      if (host !== null && key !== null) host.again(key);
    },
  };
}
