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
import type { HqApi } from "@t3tools/client-runtime/zerops/hq";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { useEffect, useMemo } from "react";

import { randomUUID } from "../lib/utils";
import { useOfficialHq } from "./accountHq";
import { onAccountLifetimeClose } from "./accountLifetime";
import { useAccountOrgId, useAccountStoreForAdapters } from "./ZeropsAccountData";

const hosts = new WeakMap<AccountStore, WeakMap<HqApi, ReturnType<typeof makeTakeOver>>>();
function hostFor(store: AccountStore, api: HqApi) {
  let byApi = hosts.get(store);
  if (byApi === undefined) {
    byApi = new WeakMap();
    hosts.set(store, byApi);
  }
  let host = byApi.get(api);
  if (host === undefined) {
    host = makeTakeOver({ store, api, makeId: randomUUID });
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
  const store = useAccountStoreForAdapters();
  const orgId = useAccountOrgId();
  const host = hq === null || store === null ? null : hostFor(store, hq.api);
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
