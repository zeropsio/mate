import {
  makeGitCredentials,
  gitCredentials,
  type AccountStore,
} from "@t3tools/client-runtime/data";
import type { HqApi } from "@t3tools/client-runtime/zerops/hq";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { useEffect, useMemo, useState } from "react";
import { useOfficialHq } from "./accountHq";
import { captureAccountLifetime, onAccountLifetimeClose } from "./accountLifetime";
import { useAccountOrgId, useAccountStoreForAdapters } from "./ZeropsAccountData";
import { randomUUID } from "../lib/utils";
const UNREAD = Atom.make({ credentials: { state: "unread" }, action: { kind: "idle" } } as const);
const hosts = new WeakMap<AccountStore, WeakMap<HqApi, ReturnType<typeof makeGitCredentials>>>();
function hostFor(store: AccountStore, api: HqApi) {
  let byApi = hosts.get(store);
  if (byApi === undefined) {
    byApi = new WeakMap();
    hosts.set(store, byApi);
  }
  let host = byApi.get(api);
  if (host === undefined) {
    host = makeGitCredentials({ store, api, makeId: randomUUID });
    byApi.set(api, host);
    onAccountLifetimeClose(host.close);
  }
  return host;
}
export function useGitCredentials(appId: string) {
  const hq = useOfficialHq();
  const account = useAccountStoreForAdapters();
  const orgId = useAccountOrgId();
  const key = useMemo(() => (orgId === null ? null : { orgId, appId }), [orgId, appId]);
  const store = hq === null || account === null ? null : hostFor(account, hq.api);
  const state = useAtomValue(
    account === null || key === null ? UNREAD : account.data.project(gitCredentials, key),
  );
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    if (store !== null && key !== null) return store.demand(key);
  }, [store, key]);
  return {
    state,
    address: hq?.address,
    onIssue: () => {
      setCopied(null);
      if (store !== null && key !== null) void store.issue(key);
    },
    onRevoke: (id: string) => {
      setCopied(null);
      if (store !== null && key !== null) void store.revoke(key, id);
    },
    onAgain: () => {
      if (store !== null && key !== null) store.again(key);
    },
    onCopy: () => {
      const current = captureAccountLifetime();
      if (state.action.kind !== "issued") return;
      void navigator.clipboard.writeText(state.action.credential.token).then(
        () => {
          if (current()) setCopied("Password copied.");
        },
        () => {
          if (current()) setCopied("Could not copy. Select the password and copy it.");
        },
      );
    },
    copied,
  };
}
