/** Account contexts and projection consumers, independent of account assembly. */
import { useAtomValue } from "@effect/atom-react";
import {
  buildsUnderWay,
  accountReadsAtom,
  NOT_READ_SERVICES,
  projectServicesAtom,
  projectsServicesAtom,
  type AccountObservation,
  type AccountStore,
  type AccountReads,
  type BuildLogRegistry,
  type DetailDemand,
  type DatabaseReads,
  type Projection,
  type VaultReveal,
  type ProjectServices,
} from "@t3tools/client-runtime/data";
import { Atom } from "effect/reactivity";
import { createContext, useContext, useEffect, useMemo } from "react";
import { sameValue } from "../lib/sameValue";

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
