/**
 * The signed-in account's data layer on mobile: one store and atom registry per account, and the
 * active organization's Zerops navigation observed while it is shown. Screens read the store
 * through projections only.
 */
import {
  makeAccountStore,
  makeZeropsWire,
  observeAccount,
  repairZeropsSession,
  type AccountStore,
  type DetailDemand,
  type ZeropsWireClient,
} from "@t3tools/client-runtime/data";
import { AtomRegistry } from "effect/unstable/reactivity";
import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";

interface AccountData {
  readonly store: AccountStore;
  readonly registry: AtomRegistry.AtomRegistry;
  /** The organization whose navigation is observed; `null` before one is chosen. */
  readonly orgId: string | null;
  /** A screen's hold on a detail while it is drawn; the release lets it go. */
  readonly demandDetail: (demand: DetailDemand) => () => void;
}

const AccountDataContext = createContext<AccountData | null>(null);

export function ZeropsAccountData({
  account,
  activeOrganizationId,
  children,
}: {
  readonly account: { readonly client: ZeropsWireClient; readonly userId: string } | null;
  readonly activeOrganizationId: string | null;
  readonly children: ReactNode;
}) {
  const client = account?.client ?? null;
  const userId = account?.userId ?? null;
  // One registry and store per account: a new account starts empty, nothing carries over.
  const held = useMemo(() => {
    if (userId === null || client === null) return null;
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    const observation = observeAccount({
      store,
      wire: makeZeropsWire({ client }),
      repairSession: repairZeropsSession(client),
    });
    return { registry, store, observation };
  }, [client, userId]);
  useEffect(
    () =>
      held === null
        ? undefined
        : () => {
            held.observation.show(null);
            held.registry.dispose();
          },
    [held],
  );
  useEffect(() => {
    held?.observation.show(activeOrganizationId);
  }, [activeOrganizationId, held]);
  const value = useMemo(
    () =>
      held === null
        ? null
        : {
            store: held.store,
            registry: held.registry,
            orgId: activeOrganizationId,
            demandDetail: held.observation.demandDetail,
          },
    [activeOrganizationId, held],
  );
  return <AccountDataContext value={value}>{children}</AccountDataContext>;
}

/** The account's data layer; `null` while no account is signed in. */
export function useAccountData(): AccountData | null {
  return useContext(AccountDataContext);
}
