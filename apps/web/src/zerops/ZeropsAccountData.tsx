/**
 * The signed-in account's data layer: one store per account (its atom registry), and the active
 * organization's Zerops navigation observed for as long as it is shown. Components read the store
 * through projections only.
 */
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import {
  makeAccountStore,
  makeZeropsWire,
  repairZeropsSession,
  startZeropsNavigation,
  type AccountStore,
  type Projection,
} from "@t3tools/client-runtime/data";
import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";

import { useZeropsSession } from "./ZeropsSessionProvider";

interface AccountData {
  readonly store: AccountStore;
  /** The organization whose navigation is observed; `null` before one is chosen. */
  readonly orgId: string | null;
}

const AccountDataContext = createContext<AccountData | null>(null);

export function ZeropsAccountData({ children }: { readonly children: ReactNode }) {
  const { client, status, activeOrganization } = useZeropsSession();
  const registry = useContext(RegistryContext);
  const store = useMemo(() => makeAccountStore(registry), [registry]);
  const orgId = status === "signed-in" ? (activeOrganization?.id ?? null) : null;
  useEffect(() => {
    if (orgId === null) return;
    const navigation = startZeropsNavigation({
      orgId,
      store,
      wire: makeZeropsWire({ client }),
      repairSession: repairZeropsSession(client),
    });
    return navigation.stop;
  }, [client, orgId, store]);
  const value = useMemo(() => ({ store, orgId }), [store, orgId]);
  return <AccountDataContext value={value}>{children}</AccountDataContext>;
}

export function useAccountData(): AccountData {
  const value = useContext(AccountDataContext);
  if (value === null) throw new Error("useAccountData must be used inside ZeropsAccountData.");
  return value;
}

/** What one projection derives for a key, recomputed only when the keys it read change. */
export function useProjection<Key, Value>(projection: Projection<Key, Value>, key: Key): Value {
  const { store } = useAccountData();
  return useAtomValue(useMemo(() => store.data.project(projection, key), [store, projection, key]));
}
