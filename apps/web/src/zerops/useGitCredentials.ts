import {
  makeGitCredentialStore,
  type HqApi,
  type GitCredentialSnapshot,
} from "@t3tools/client-runtime/zerops/hq";
import { useEffect, useSyncExternalStore, useState } from "react";
import { useOfficialHq } from "./accountHq";
import { captureAccountLifetime, onAccountLifetimeClose } from "./accountLifetime";

const stores = new Map<HqApi, Map<string, ReturnType<typeof makeGitCredentialStore>>>();
onAccountLifetimeClose(() => {
  for (const byApp of stores.values()) for (const store of byApp.values()) store.close();
  stores.clear();
});
const UNREAD: GitCredentialSnapshot = {
  credentials: { state: "unread", waitingFor: null },
  action: { kind: "idle" },
};
const NO_SUBSCRIBE = () => () => undefined;
function storeFor(api: HqApi, appId: string) {
  let byApp = stores.get(api);
  if (byApp === undefined) {
    byApp = new Map();
    stores.set(api, byApp);
  }
  let store = byApp.get(appId);
  if (store === undefined) {
    store = makeGitCredentialStore({
      list: () => api.gitCredentials(appId),
      issue: () => api.issueGitCredential(appId),
      revoke: (id) => api.revokeGitCredential(appId, id),
      now: () => Date.now(),
    });
    byApp.set(appId, store);
  }
  return store;
}
export function useGitCredentials(appId: string) {
  const hq = useOfficialHq();
  const store = hq === null ? null : storeFor(hq.api, appId);
  const state = useSyncExternalStore(
    store?.subscribe ?? NO_SUBSCRIBE,
    store?.snapshot ?? (() => UNREAD),
  );
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    if (store !== null) void store.load();
    return () => store?.forgetPassword();
  }, [store]);
  return {
    state,
    address: hq?.address,
    onIssue: () => {
      setCopied(null);
      if (store !== null) void store.issue();
    },
    onRevoke: (id: string) => {
      setCopied(null);
      if (store !== null) void store.revoke(id);
    },
    onAgain: () => {
      if (store !== null) void store.again();
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
