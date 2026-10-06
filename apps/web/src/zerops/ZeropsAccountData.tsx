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
  NOT_READ_SERVICES,
  projectServicesAtom,
  projectsServicesAtom,
  repairZeropsSession,
  accountReadsAtom,
  type AccountObservation,
  type ProjectServices,
  type AccountReads,
  type BuildLogRegistry,
  type DetailDemand,
  type Projection,
} from "@t3tools/client-runtime/data";
import { Atom } from "effect/unstable/reactivity";
import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";

import { useAccountBuildLogs } from "./accountBuildLogs";
import { onAccountLifetimeClose } from "./accountLifetime";
import { accountOperations, AccountOperationsContext } from "./accountOperations";
import { useMateResultsSeen, useOpenMatesAttention } from "./mateAttentionLinks";
import { useZeropsSession } from "./ZeropsSessionProvider";

/**
 * What a screen may reach of the account's data: the store's reads, never its writer, the
 * person's "try now" for what it observes, and the builds' logs a card holds while it shows one.
 */
export interface AccountData extends AccountReads {
  readonly retry: () => void;
  /** The organization's official HQ, once known (`ZeropsHqNavigation`); `null` while none is. */
  readonly showHq: AccountObservation["showHq"];
  /** Asks HQ where a Mate may move, as the move opens. */
  readonly moveOffers: AccountObservation["moveOffers"];
  /** Asks HQ whom a Mate may be handed over to, as the hand-over opens. */
  readonly handoverCandidates: AccountObservation["handoverCandidates"];
  /** `null` until the mount has made them. */
  readonly logs: BuildLogRegistry | null;
  /** A detail held until its read settles: `true` once read, `false` once it failed or was refused. */
  readonly readDetail: AccountObservation["readDetail"];
  /** Our own write changed a sampled detail: it is read again. */
  readonly revalidate: AccountObservation["revalidate"];
  /** The person's "try again" on one detail. */
  readonly retryDetail: AccountObservation["retryDetail"];
  /** Asks HQ what lies between two commits, while a surface shows it. */
  readonly compare: AccountObservation["compare"];
}

/** The mounted account's data; a test mounts its own account's here. */
export const AccountDataContext = createContext<AccountData | null>(null);

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
  const logs = useAccountBuildLogs(client, store);
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
      renewHeld: observation.renewHeld,
      readDetail: observation.readDetail,
      revalidate: observation.revalidate,
      retryDetail: observation.retryDetail,
      retry: observation.retry,
      showHq: observation.showHq,
      moveOffers: observation.moveOffers,
      handoverCandidates: observation.handoverCandidates,
      logs,
      compare: observation.compare,
    }),
    [logs, observation, orgId, store],
  );
  // Each open Mate's attention straight from it, and what the person saw of its results to HQ.
  useOpenMatesAttention(store);
  useMateResultsSeen(orgId, observation.seen);
  // The operations are built here, over the store this mount owns: no screen reaches its writer.
  const operations = useMemo(
    () =>
      accountOperations(store, registry, client, observation.demandDetail, observation.revalidate),
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

const UNREAD_SERVICES = Atom.make(NOT_READ_SERVICES);

/** One project's services, as the organization's services listing holds them. */
export function useProjectServices(projectId: string | null | undefined): ProjectServices {
  return useAtomValue(projectId == null ? UNREAD_SERVICES : projectServicesAtom(projectId));
}

/** Each listed project's services, as the organization's services listing holds them, by id. */
export function useProjectsServices(
  projectIds: ReadonlyArray<string>,
): Readonly<Record<string, ProjectServices>> {
  return useAtomValue(projectsServicesAtom(projectIds.join(",")));
}

/**
 * Holds a detail for an owner while the caller is drawn with one: one of a family's detail
 * listings, or with no `listing` a detail family's own scope.
 */
export function useDetailDemand(
  family: DetailDemand["family"],
  listing: string | undefined,
  ownerId: string | null,
): void {
  const demandDetail = useAtomValue(accountReadsAtom)?.demandDetail;
  useEffect(() => {
    if (demandDetail === undefined || ownerId === null) return;
    return demandDetail({ family, ...(listing === undefined ? {} : { listing }), ownerId });
  }, [demandDetail, family, listing, ownerId]);
}
