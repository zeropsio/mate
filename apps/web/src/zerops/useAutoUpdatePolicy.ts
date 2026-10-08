import {
  autoUpdatePolicySettings,
  type AutoUpdatePolicySettings,
} from "@t3tools/client-runtime/data";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { useMemo } from "react";
import {
  useAccountDataOptional,
  useAccountOrgId,
  useAccountStoreForAdapters,
} from "./ZeropsAccountData";

const UNREAD = Atom.make<AutoUpdatePolicySettings>({
  policy: { kind: "unknown" },
  editable: false,
  pending: false,
  words: "Waiting for HQ…",
  error: null,
  retryRead: false,
  recoverable: false,
  requestId: "",
});
export function useAutoUpdatePolicy(admin: boolean) {
  const account = useAccountDataOptional();
  const store = useAccountStoreForAdapters();
  const orgId = useAccountOrgId();
  const key = useMemo(() => (orgId === null ? null : { orgId, admin }), [orgId, admin]);
  const policy = useAtomValue(
    store === null || key === null ? UNREAD : store.data.project(autoUpdatePolicySettings, key),
  );
  return { policy, again: () => account?.retry() };
}
