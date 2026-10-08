import { useMateFeeds } from "./useMateFeeds";
/**
 * The signed-in account's data layer: one store per account (its atom registry), and the active
 * organization's Zerops navigation observed for as long as it is shown, with the details screens
 * hold. Components read the store through projections only.
 */
import { MateImages } from "../assets/MateImagesProvider";
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import {
  buildsUnderWay,
  makeAccountStore,
  closeSharedMateSetupDemand,
  mateConversationStoreAtom,
  creationPressStoreAtom,
  makeVaultReveal,
  makeZeropsWire,
  observeAccount,
  NOT_READ_SERVICES,
  projectServicesAtom,
  projectsServicesAtom,
  repairZeropsSession,
  accountReadsAtom,
  type AccountObservation,
  type AccountStore,
  type ProjectServices,
  type AccountReads,
  type BuildLogRegistry,
  type DetailDemand,
  type DatabaseReads,
  type Projection,
  type VaultReveal,
} from "@t3tools/client-runtime/data";
import { Atom } from "effect/reactivity";
import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";

import { sameValue } from "../lib/sameValue";
import { MateBrowserFrames } from "./browserStreamLinks";
import { useAccountWorkspace } from "./accountWorkspace";
import { useAccountDatabase } from "./accountDatabase";
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
  readonly database?: DatabaseReads | null;
  /** The organization's official HQ, once known (`ZeropsHqNavigation`); `null` while none is. */
  readonly showHq: AccountObservation["showHq"];
  /** Asks HQ where a Mate may move, as the move opens. */
  readonly moveOffers: AccountObservation["moveOffers"];
  /** Asks HQ whom a Mate may be handed over to, as the hand-over opens. */
  readonly handoverCandidates: AccountObservation["handoverCandidates"];
  /** `null` until the mount has made them. */
  readonly logs: BuildLogRegistry | null;
  /** A secret of the vault, decrypted for the person who asks to see it; held by nothing else. */
  readonly reveal?: VaultReveal;
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

/**
 * The account's store, for the hosts that run its adapters (`ZeropsAccountEnvironmentProvider`'s Mate adapter):
 * never a screen's — screens read projections.
 */
export const AccountStoreContext = createContext<AccountStore | null>(null);

export function ZeropsAccountData({ children }: { readonly children: ReactNode }) {
  const { client, status, activeOrganization } = useZeropsSession();
  const registry = useContext(RegistryContext);
  const store = useMemo(() => makeAccountStore(registry), [registry]);
  useEffect(() => {
    registry.set(mateConversationStoreAtom, store);
    registry.set(creationPressStoreAtom, store);
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      closeSharedMateSetupDemand(store);
      if (registry.get(mateConversationStoreAtom) === store)
        registry.set(mateConversationStoreAtom, null);
      if (registry.get(creationPressStoreAtom) === store)
        registry.set(creationPressStoreAtom, null);
    };
    const stop = onAccountLifetimeClose(close);
    return () => {
      stop();
      close();
    };
  }, [registry, store]);
  useMateFeeds(store);
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
  const reveal = useMemo(() => makeVaultReveal(client), [client]);
  const database = useAccountDatabase(store);
  useAccountWorkspace(store);
  const orgId = status === "signed-in" ? (activeOrganization?.id ?? null) : null;
  // The account's lifetime closes (sign-out, another account) before React unmounts this, and
  // disposes the registry right after: the account's data ends first, so what the unmounting
  // screens still release publishes nothing.
  useEffect(() => onAccountLifetimeClose(observation.close), [observation]);
  useEffect(() => {
    observation.show(orgId);
  }, [observation, orgId]);
  useEffect(() => () => observation.stop(), [observation]);
  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    const resume = () => {
      if (document.visibilityState === "visible" && navigator.onLine) observation.resume();
    };
    window.addEventListener("online", resume);
    window.addEventListener("focus", resume);
    window.addEventListener("pageshow", resume);
    document.addEventListener("visibilitychange", resume);
    document.addEventListener("resume", resume);
    return () => {
      window.removeEventListener("online", resume);
      window.removeEventListener("focus", resume);
      window.removeEventListener("pageshow", resume);
      document.removeEventListener("visibilitychange", resume);
      document.removeEventListener("resume", resume);
    };
  }, [observation]);
  const value = useMemo(
    () => ({
      data: store.data,
      database,
      viewer: activeOrganization ?? undefined,
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
      reveal,
      compare: observation.compare,
    }),
    [activeOrganization, database, logs, observation, orgId, reveal, store],
  );
  // Each open Mate's attention straight from it, and what the person saw of its results to HQ.
  useOpenMatesAttention(store);
  useMateResultsSeen(store, orgId, observation.seen);
  // The operations are built here, over the store this mount owns: no screen reaches its writer.
  const operations = useMemo(
    () =>
      accountOperations(
        store,
        registry,
        client,
        observation.demandDetail,
        observation.revalidate,
        observation.readDetail,
      ),
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
    <AccountStoreContext value={store}>
      <MateImages store={store}>
        <AccountDataContext value={value}>
          <MateBrowserFrames store={store}>
            <AccountOperationsContext value={operations}>{children}</AccountOperationsContext>
          </MateBrowserFrames>
        </AccountDataContext>
      </MateImages>
    </AccountStoreContext>
  );
}

export function useAccountData(): AccountData {
  const value = useContext(AccountDataContext);
  if (value === null) throw new Error("useAccountData must be used inside ZeropsAccountData.");
  return value;
}

/** The account's store for an adapter's host; `null` outside an account. */
export function useAccountStoreForAdapters(): AccountStore | null {
  return useContext(AccountStoreContext);
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

const projectsServiceValues = Atom.family((key: string) =>
  Atom.make((get): Readonly<Record<string, ProjectServices["services"]>> =>
    Object.fromEntries(
      Object.entries(get(projectsServicesAtom(key))).map(([id, read]) => [id, read.services]),
    ),
  ).pipe(Atom.withEquality(sameValue)),
);

/** Service contents for drawings that do not display the listing's freshness. */
export function useProjectsServiceValues(projectIds: ReadonlyArray<string>) {
  return useAtomValue(projectsServiceValues(projectIds.join(",")));
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
