/**
 * The signed-in account's data layer: one store per account (its atom registry), and the active
 * organization's Zerops navigation observed for as long as it is shown, with the details screens
 * hold. Components read the store through projections only.
 */
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import {
  buildsUnderWay,
  makeAccountStore,
  makeZeropsWire,
  observeAccount,
  repairZeropsSession,
  accountReadsAtom,
  type AccountReads,
  type DetailDemand,
  type Projection,
} from "@t3tools/client-runtime/data";
import { Atom } from "effect/unstable/reactivity";
import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";

import { onAccountLifetimeClose } from "./accountLifetime";
import { accountOperations, AccountOperationsContext } from "./accountOperations";
import { useZeropsSession } from "./ZeropsSessionProvider";

/**
 * What a screen may reach of the account's data: the store's reads, never its writer, and the
 * person's "try now" for what it observes.
 */
export interface AccountData extends AccountReads {
  readonly retry: () => void;
}

const AccountDataContext = createContext<AccountData | null>(null);

export function ZeropsAccountData({ children }: { readonly children: ReactNode }) {
  const { client, status, activeOrganization } = useZeropsSession();
  const registry = useContext(RegistryContext);
  const store = useMemo(() => makeAccountStore(registry), [registry]);
  const observation = useMemo(
    () =>
      observeAccount({
        store,
        wire: makeZeropsWire({ client }),
        repairSession: repairZeropsSession(client),
      }),
    [client, store],
  );
  const orgId = status === "signed-in" ? (activeOrganization?.id ?? null) : null;
  // The account's lifetime closes (sign-out, another account) before React unmounts this, and
  // disposes the registry right after: the account's data ends first, so what the unmounting
  // screens still release publishes nothing.
  useEffect(() => onAccountLifetimeClose(observation.close), [observation]);
  useEffect(() => {
    observation.show(orgId);
  }, [observation, orgId]);
  useEffect(() => () => observation.stop(), [observation]);
  const value = useMemo(
    () => ({
      data: store.data,
      orgId,
      demandDetail: observation.demandDetail,
      retry: observation.retry,
    }),
    [observation, orgId, store],
  );
  // The operations are built here, over the store this mount owns: no screen reaches its writer.
  const operations = useMemo(
    () => accountOperations(store, registry, client, observation.demandDetail),
    [client, observation, registry, store],
  );
  // The account's reads move to each new value as it comes, never unset between: a moment without
  // them would read every organization's listing as gone. They go only with this mount.
  useEffect(() => {
    if (!observation.closed()) registry.set(accountReadsAtom, value);
  }, [observation, registry, value]);
  useEffect(
    () => () => {
      if (!observation.closed()) registry.set(accountReadsAtom, null);
    },
    [observation, registry],
  );
  return (
    <AccountDataContext value={value}>
      <AccountOperationsContext value={operations}>{children}</AccountOperationsContext>
    </AccountDataContext>
  );
}

export function useAccountData(): AccountData {
  const value = useContext(AccountDataContext);
  if (value === null) throw new Error("useAccountData must be used inside ZeropsAccountData.");
  return value;
}

/** The account's data layer; `null` outside an account (a test, the hand-over page). */
export function useAccountDataOptional(): AccountData | null {
  return useContext(AccountDataContext);
}

/** The organization the account observes now; `null` outside an account or before one is chosen. */
export function useAccountOrgId(): string | null {
  return useAccountDataOptional()?.orgId ?? null;
}

/**
 * What one projection derives for a key, or `fallback`'s value outside an account or without a
 * key. The store keeps one atom per projection and key, so asking again each render is free.
 */
export function useProjection<Key, Value>(
  projection: Projection<Key, Value>,
  key: Key | null,
  fallback: Atom.Atom<Value>,
): Value {
  const data = useAccountDataOptional()?.data;
  return useAtomValue(
    data === undefined || key === null ? fallback : data.project(projection, key),
  );
}

const NO_BUILDS: ReadonlyArray<string> = [];
const NOTHING_BUILDING = Atom.make(NO_BUILDS);

/** The listed projects a build or deploy runs on now, as the menu's indicator reads them. */
export function useBuildsUnderWay(projectIds: ReadonlyArray<string>): ReadonlySet<string> {
  const orgId = useAccountOrgId();
  const building = useProjection(
    buildsUnderWay,
    orgId === null ? null : { orgId, projectIds },
    NOTHING_BUILDING,
  );
  return useMemo(() => new Set(building), [building]);
}

/** Holds one of a family's detail listings for an owner while the caller is drawn with one. */
export function useDetailDemand(
  family: DetailDemand["family"],
  listing: string,
  ownerId: string | null,
): void {
  const demandDetail = useAccountDataOptional()?.demandDetail;
  useEffect(() => {
    if (demandDetail === undefined || ownerId === null) return;
    return demandDetail({ family, listing, ownerId });
  }, [demandDetail, family, listing, ownerId]);
}
