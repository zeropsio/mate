/**
 * The signed-in account's data layer on mobile: one store and atom registry per account, and the
 * active organization's Zerops navigation observed while it is shown. Screens read the store
 * through projections only.
 */
import {
  accountReadsAtom,
  makeAccountStore,
  makeZeropsWire,
  observeAccount,
  repairZeropsSession,
  type AccountStore,
  type DetailDemand,
  type ZeropsWireClient,
} from "@t3tools/client-runtime/data";
import type { AtomRegistry } from "effect/unstable/reactivity";
import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";

/** What a screen may reach of the account's data: the store's reads, never its writer. */
interface AccountData {
  readonly data: AccountStore["data"];
  readonly registry: AtomRegistry.AtomRegistry;
  /** The organization whose navigation is observed; `null` before one is chosen. */
  readonly orgId: string | null;
  /** A screen's hold on a detail while it is drawn; the release lets it go. */
  readonly demandDetail: (demand: DetailDemand) => () => void;
}

const AccountDataContext = createContext<AccountData | null>(null);

export function ZeropsAccountData({
  account,
  registry,
  activeOrganizationId,
  children,
}: {
  readonly account: { readonly client: ZeropsWireClient; readonly userId: string } | null;
  /**
   * The account's atom registry, which its data provider owns: the store publishes into the
   * registry the account runtime's derivations read, so they read one store.
   */
  readonly registry: AtomRegistry.AtomRegistry | null;
  readonly activeOrganizationId: string | null;
  readonly children: ReactNode;
}) {
  const client = account?.client ?? null;
  // One store per account and registry: a new account starts empty, nothing carries over.
  const held = useMemo(() => {
    if (registry === null || client === null) return null;
    const store = makeAccountStore(registry);
    const observation = observeAccount({
      store,
      wire: makeZeropsWire({ client }),
      repairSession: repairZeropsSession(client),
    });
    return { registry, store, observation };
  }, [client, registry]);
  useEffect(() => (held === null ? undefined : () => held.observation.stop()), [held]);
  useEffect(() => {
    held?.observation.show(activeOrganizationId);
  }, [activeOrganizationId, held]);
  const value = useMemo(
    () =>
      held === null
        ? null
        : {
            data: held.store.data,
            registry: held.registry,
            orgId: activeOrganizationId,
            demandDetail: held.observation.demandDetail,
          },
    [activeOrganizationId, held],
  );
  useEffect(() => {
    if (value === null) return;
    value.registry.set(accountReadsAtom, value);
    return () => value.registry.set(accountReadsAtom, null);
  }, [value]);
  return <AccountDataContext value={value}>{children}</AccountDataContext>;
}

/** The account's data layer; `null` while no account is signed in. */
export function useAccountData(): AccountData | null {
  return useContext(AccountDataContext);
}
