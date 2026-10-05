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
  type AccountStore,
  type DetailDemand,
  type Projection,
} from "@t3tools/client-runtime/data";
import { Atom } from "effect/unstable/reactivity";
import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";

import { accountOperations, AccountOperationsContext } from "./accountOperations";
import { useZeropsSession } from "./ZeropsSessionProvider";

/** What a screen may reach of the account's data: the store's reads, never its writer. */
export interface AccountData {
  readonly data: AccountStore["data"];
  /** The organization whose navigation is observed; `null` before one is chosen. */
  readonly orgId: string | null;
  /** A screen's hold on a detail while it is drawn; the release lets it go. */
  readonly demandDetail: (demand: DetailDemand) => () => void;
}

const AccountDataContext = createContext<AccountData | null>(null);

/**
 * The same account data for atoms outside React (a project's topology reads its running work
 * through it); `null` while no account is mounted.
 */
export const accountDataAtom = Atom.make<AccountData | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("zerops:account-data"),
);

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
  useEffect(() => {
    observation.show(orgId);
  }, [observation, orgId]);
  useEffect(() => () => observation.stop(), [observation]);
  const value = useMemo(
    () => ({ data: store.data, orgId, demandDetail: observation.demandDetail }),
    [observation, orgId, store],
  );
  // The operations are built here, over the store this mount owns: no screen reaches its writer.
  const operations = useMemo(
    () => accountOperations(store, registry, client, observation.demandDetail),
    [client, observation, registry, store],
  );
  useEffect(() => {
    registry.set(accountDataAtom, value);
    return () => registry.set(accountDataAtom, null);
  }, [registry, value]);
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
