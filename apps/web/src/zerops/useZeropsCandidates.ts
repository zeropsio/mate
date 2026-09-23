import { useZeropsInventory } from "./ZeropsInventoryProvider";
/** Web projection over the active organization's shared project/service records. */

import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import type {
  EnvironmentConnectionPhase,
  EnvironmentConnectionPresentation,
} from "@t3tools/client-runtime/connection";
import { useCallback, useEffect, useMemo } from "react";

import {
  derivePublicRouteOffers,
  derivePublicRoutes,
  summarizeEnvironmentServices,
  type ZeropsEnvironmentServices,
  type ZeropsPublicRoute,
  type ZeropsRouteOffer,
} from "@t3tools/client-runtime/zerops";

import { useEnvironments } from "../state/environments";
import { normalizeOrigin } from "@t3tools/client-runtime/zerops/candidates";
import {
  knownProjectsOf,
  knownServicesOf,
  projectKeyOf,
  projectsSourceOf,
  servicesSourceOf,
  type CollectionRead,
  type ProjectRecord,
  type ServiceRecord,
} from "@t3tools/client-runtime/zerops/data";
import type { Known } from "@t3tools/client-runtime/zerops/knowledge";
import {
  admittedOnly,
  candidateMembers,
  presentCandidates,
  selectCandidates,
  type CandidateRow,
} from "@t3tools/client-runtime/zerops/projections";
import { Atom } from "effect/unstable/reactivity";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { zeropsEnvironmentNamesAtom, zeropsMatesAtom } from "../state/zerops";
import { writeCachedZeropsMates } from "./mateIdentitiesCache";
import { refreshZeropsCandidates } from "./candidatesRefresh";
import { zeropsEnvironmentNames } from "./environmentNames";
import { zeropsMateIdentities } from "./mateIdentities";
import { inventoryProjectRefKey } from "./inventoryContext";
import { useZeropsSession } from "./ZeropsSessionProvider";
import {
  useZeropsAtomSelections,
  useZeropsData,
  zeropsKnowledgeArraysEqual,
} from "./zeropsDataContext";

export interface ZeropsCandidatePresentation extends CandidateRow {
  readonly connection?: EnvironmentConnectionPresentation;
  /**
   * Where the environment is reachable from outside, read off the same
   * service list the candidate came from. Absent while that list is unread
   * (a project whose services failed to load), so a row can tell "unknown"
   * from "none".
   */
  readonly routes?: ReadonlyArray<ZeropsPublicRoute>;
  /** Services that serve HTTP with their subdomain off (`publicRoutes.ts`). */
  readonly routeOffers?: ReadonlyArray<ZeropsRouteOffer>;
  /**
   * What the environment holds — the developer's services and when its code
   * last landed — read off the same list. Absent while it is unread, like
   * `routes`.
   */
  readonly services?: ZeropsEnvironmentServices;
}

/** Authenticated environments keyed by origin, so a derived container origin can be matched. */
export function authenticatedZeropsOrigins(
  environments: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly displayUrl: string | null;
    readonly connection: { readonly phase: EnvironmentConnectionPhase };
  }>,
): ReadonlyMap<string, EnvironmentId> {
  const byOrigin = new Map<string, EnvironmentId>();
  for (const environment of environments) {
    if (environment.connection.phase !== "connected" || !environment.displayUrl) continue;
    const origin = normalizeOrigin(environment.displayUrl);
    if (origin) byOrigin.set(origin, environment.environmentId);
  }
  return byOrigin;
}

/**
 * A ready candidate whose origin a connected environment serves is connected
 * to it. `selectCandidates` mixes no socket phase in; this is the join.
 */
export function withZeropsConnection(
  row: CandidateRow,
  connectedOrigins: ReadonlyMap<string, EnvironmentId>,
): CandidateRow {
  if (row.group !== "ready" || row.containerOrigin === undefined) return row;
  const environmentId = connectedOrigins.get(
    normalizeOrigin(row.containerOrigin) ?? row.containerOrigin,
  );
  return environmentId === undefined ? row : { ...row, group: "connected", environmentId };
}

function sameMembers<Record extends ProjectRecord | ServiceRecord>(
  left: CollectionRead<Record>,
  right: CollectionRead<Record>,
): boolean {
  return (
    left.query === right.query &&
    zeropsKnowledgeArraysEqual(left.value, right.value) &&
    left.observation.access === right.observation.access
  );
}

/**
 * Whether two reads of the organization's projects are the same knowledge:
 * the same query, members and access, and the same interest they are as
 * current as. That interest failing leaves the query as it was, and is a new
 * read; any other interest the account holds changing is not.
 */
export function sameProjectsRead(
  left: CollectionRead<ProjectRecord>,
  right: CollectionRead<ProjectRecord>,
): boolean {
  return sameMembers(left, right) && projectsSourceOf(left) === projectsSourceOf(right);
}

/** Whether two reads of a project's services are the same knowledge, like `sameProjectsRead`. */
export function sameServicesRead(
  left: CollectionRead<ServiceRecord>,
  right: CollectionRead<ServiceRecord>,
): boolean {
  return sameMembers(left, right) && servicesSourceOf(left) === servicesSourceOf(right);
}

/** A read, and the moment this client saw it change. */
interface StampedRead<Read> {
  readonly read: Read;
  readonly atMs: number;
}

/**
 * Holds a read until it changes, stamped with the moment it did. The stamp is
 * what `known.ts` dates a read with no value yet by (when it failed, or began
 * to recover); taken here, it never ticks, so no clock re-derives the rows and
 * hands every consumer a new array of the same candidates.
 */
function stampedReadAtom<Read>(
  source: Atom.Atom<Read>,
  same: (left: Read, right: Read) => boolean,
): Atom.Atom<StampedRead<Read>> {
  let previous: StampedRead<Read> | undefined;
  return Atom.make((get) => {
    const read = get(source);
    if (previous !== undefined && same(previous.read, read)) return previous;
    previous = { read, atMs: Date.now() };
    return previous;
  });
}

/** Every registered environment keyed by origin, socket up or not — who lives where is known before it connects. */
function registeredZeropsOrigins(
  environments: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly displayUrl: string | null;
  }>,
): ReadonlyMap<string, EnvironmentId> {
  const byOrigin = new Map<string, EnvironmentId>();
  for (const environment of environments) {
    if (!environment.displayUrl) continue;
    const origin = normalizeOrigin(environment.displayUrl);
    if (origin) byOrigin.set(origin, environment.environmentId);
  }
  return byOrigin;
}

function zeropsConnectionsByOrigin(
  environments: ReadonlyArray<{
    readonly displayUrl: string | null;
    readonly connection: EnvironmentConnectionPresentation;
  }>,
): ReadonlyMap<string, EnvironmentConnectionPresentation> {
  const byOrigin = new Map<string, EnvironmentConnectionPresentation>();
  for (const environment of environments) {
    if (!environment.displayUrl) continue;
    const origin = normalizeOrigin(environment.displayUrl);
    if (origin) byOrigin.set(origin, environment.connection);
  }
  return byOrigin;
}

/** A project that is not up holds nothing anyone deployed. */
const NO_SERVICES: ZeropsEnvironmentServices = {
  hostnames: [],
  deployedAt: undefined,
  deployable: [],
};
const EMPTY_PROJECTS_READ_ATOM = Atom.make<StampedRead<CollectionRead<ProjectRecord>> | null>(
  null,
).pipe(Atom.withLabel("zerops:candidates-projects-empty"));

const UNREAD: Known<never> = { state: "unread", waitingFor: null };

export function useZeropsCandidates(): {
  /**
   * The rows the listing holds (`candidateMembers`): none while it is unread,
   * being read or failed, so nothing negative may be read off them — `listing`
   * says whether they are all there are.
   */
  readonly candidates: ReadonlyArray<ZeropsCandidatePresentation>;
  /**
   * The active organization's candidates as knowledge (DESIGN §3): "no
   * projects" is only ever read off a known, complete listing, and a re-read
   * keeps the list already read up while the fresh baseline lands.
   */
  readonly listing: Known<ReadonlyArray<ZeropsCandidatePresentation>>;
  /** A read is in flight: the header's spinner, never a reason to paint less. */
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly refresh: () => void;
} {
  const { activeOrganization, organizationStatus, status } = useZeropsSession();
  const { runtime, organizationRef } = useZeropsData();
  const { environments } = useEnvironments();
  const inventory = useZeropsInventory();
  const { services, error } = inventory;
  const canLoad = status === "signed-in" && organizationStatus === "selected";
  const isLoading = inventory.isLoading || !canLoad;
  const activeOrganizationRef = useMemo(
    () => (activeOrganization === null ? null : organizationRef(activeOrganization.id)),
    [activeOrganization, organizationRef],
  );
  const projectsReadAtom = useMemo(
    () =>
      activeOrganizationRef === null
        ? EMPTY_PROJECTS_READ_ATOM
        : stampedReadAtom(runtime.reads.projectsOf(activeOrganizationRef), sameProjectsRead),
    [activeOrganizationRef, runtime],
  );
  const rawProjects = useAtomValue(projectsReadAtom);
  const serviceReadEntries = useMemo(
    () =>
      activeOrganizationRef === null
        ? []
        : [...inventory.projectRefs.values()].flatMap((ref) =>
            ref.organization.organizationId === activeOrganizationRef.organizationId
              ? ([
                  [
                    projectKeyOf(ref),
                    stampedReadAtom(runtime.reads.servicesOf(ref), sameServicesRead),
                  ],
                ] as const)
              : [],
          ),
    [activeOrganizationRef, inventory.projectRefs, runtime],
  );
  const serviceReads =
    useZeropsAtomSelections<StampedRead<CollectionRead<ServiceRecord>>>(serviceReadEntries);

  const connectedOrigins = useMemo(() => authenticatedZeropsOrigins(environments), [environments]);
  const connectionsByOrigin = useMemo(
    () => zeropsConnectionsByOrigin(environments),
    [environments],
  );
  const registeredOrigins = useMemo(() => registeredZeropsOrigins(environments), [environments]);

  const listing = useMemo((): Known<ReadonlyArray<ZeropsCandidatePresentation>> => {
    if (!canLoad || activeOrganization === null || rawProjects === null) return UNREAD;
    const projects = knownProjectsOf(rawProjects.read, rawProjects.atMs);
    const allowedProjects = admittedOnly(projects, (record) => {
      const allowed = inventory.projectRefs.get(inventoryProjectRefKey(record.ref));
      return (
        allowed !== undefined &&
        projectKeyOf(allowed) === projectKeyOf(record.ref) &&
        serviceReads.has(projectKeyOf(record.ref))
      );
    });
    const selected = selectCandidates(allowedProjects, (ref) => {
      const read = serviceReads.get(projectKeyOf(ref));
      return read === undefined ? UNREAD : knownServicesOf(read.read, read.atMs);
    });
    return presentCandidates(selected, (row): ZeropsCandidatePresentation => {
      const candidate = withZeropsConnection(row, connectedOrigins);
      const project = inventory.projects.find((entry) => entry.id === candidate.project.id);
      const outcome = services.get(candidate.project.id);
      const resolved = outcome?.status === "resolved" ? outcome.services : null;
      const routes =
        project === undefined || resolved === null
          ? undefined
          : derivePublicRoutes(project, resolved);
      const routeOffers = resolved === null ? undefined : derivePublicRouteOffers(resolved);
      const held = resolved === null ? undefined : summarizeEnvironmentServices(resolved);
      const origin = candidate.containerOrigin ? normalizeOrigin(candidate.containerOrigin) : null;
      const connection = origin === null ? undefined : connectionsByOrigin.get(origin);
      return {
        ...candidate,
        ...(candidate.project.status === "ACTIVE"
          ? routes === undefined || held === undefined
            ? {}
            : { routes, routeOffers: routeOffers ?? [], services: held }
          : { routes: [], services: NO_SERVICES }),
        ...(connection === undefined ? {} : { connection }),
      };
    });
  }, [
    activeOrganization,
    canLoad,
    connectedOrigins,
    connectionsByOrigin,
    inventory.projectRefs,
    inventory.projects,
    rawProjects,
    serviceReads,
    services,
  ]);
  const candidates = candidateMembers(listing);

  // Publish the environments' names, and who lives in each, for readers that
  // never load candidates (`useZeropsEnvironmentNames`, `useZeropsMates`). A
  // reload starts from an empty list; what they had stays up until the new
  // list carries some. Nothing is published while the session is still being
  // checked or the organisation picked: an empty answer then would be a
  // guess, and the surfaces that wait on `zeropsMatesAtom` would paint their
  // other look for the first second of every reload.
  useEffect(() => {
    if (status === "loading" || status === "totp-required") return;
    if (status === "signed-in" && !canLoad) return;
    const names = zeropsEnvironmentNames(candidates);
    if (isLoading && names.size === 0) return;
    const mates = zeropsMateIdentities(candidates, registeredOrigins);
    appAtomRegistry.set(zeropsEnvironmentNamesAtom, names);
    appAtomRegistry.set(zeropsMatesAtom, mates);
    // Remembered across reloads, so the next one knows who lives where from
    // its first frame (`zeropsMatesAtom` starts from this).
    writeCachedZeropsMates(mates);
  }, [candidates, canLoad, isLoading, registeredOrigins, status]);

  const refresh = useCallback(() => {
    refreshZeropsCandidates();
  }, []);

  return { candidates, listing, isLoading, error, refresh };
}
