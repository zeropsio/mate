/**
 * The signed-in account's data layer on mobile: the store and observation its data provider owns
 * over the account's registry, the active organization's Zerops navigation observed while it is
 * shown. Screens read the store through projections only.
 */
import {
  accountReadsAtom,
  type AccountObservation,
  type AccountReads,
  type AccountStore,
} from "@t3tools/client-runtime/data";
import type { AtomRegistry } from "effect/unstable/reactivity";
import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";

/** What this layer reads of the data provider's binding, which renders it. */
interface AccountBinding {
  readonly registry: AtomRegistry.AtomRegistry;
  readonly accountData: {
    readonly data: AccountStore["data"];
    readonly observation: AccountObservation;
  };
}

/** What a screen may reach of the account's data: the store's reads, never its writer. */
interface AccountData extends AccountReads {
  readonly registry: AtomRegistry.AtomRegistry;
}

const AccountDataContext = createContext<AccountData | null>(null);

export function ZeropsAccountData({
  binding,
  activeOrganizationId,
  children,
}: {
  /** The account's data provider binding; `null` while no account is open. */
  readonly binding: AccountBinding | null;
  readonly activeOrganizationId: string | null;
  readonly children: ReactNode;
}) {
  const observation = binding?.accountData.observation ?? null;
  useEffect(() => {
    observation?.show(activeOrganizationId);
  }, [activeOrganizationId, observation]);
  const value = useMemo(
    () =>
      binding === null
        ? null
        : {
            data: binding.accountData.data,
            registry: binding.registry,
            orgId: activeOrganizationId,
            demandDetail: binding.accountData.observation.demandDetail,
          },
    [activeOrganizationId, binding],
  );
  // The account's reads move to each new value as it comes, never unset between: a moment without
  // them would read every organization's listing as gone. They go only with the account's
  // registry, or this mount.
  useEffect(() => {
    if (value === null || observation === null || observation.closed()) return;
    value.registry.set(accountReadsAtom, value);
  }, [observation, value]);
  const registry = binding?.registry ?? null;
  useEffect(
    () => () => {
      // A closed account's registry may already be gone.
      if (registry !== null && observation !== null && !observation.closed())
        registry.set(accountReadsAtom, null);
    },
    [observation, registry],
  );
  return <AccountDataContext value={value}>{children}</AccountDataContext>;
}

/** The account's data layer; `null` while no account is signed in. */
export function useAccountData(): AccountData | null {
  return useContext(AccountDataContext);
}
