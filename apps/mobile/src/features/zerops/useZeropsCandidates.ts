import {
  knownServicesOf,
  projectKeyOf,
  ZeropsOrganizationId,
  ZeropsProjectId,
  type CollectionRead,
  type InterestLease,
  type ProjectRef,
  type ServiceRecord,
} from "@t3tools/client-runtime/zerops/data";
import {
  knownRoster,
  type EnvironmentMachine,
  type TargetKey,
} from "@t3tools/client-runtime/zerops/environments";
import type { Known } from "@t3tools/client-runtime/zerops/knowledge";
import {
  addressFactsOf,
  NO_ADDRESS_MEMORY,
  learnAddresses,
  selectCandidates,
  serviceUpdatedAtIn,
  subdomainEnableIn,
  type AddressMemory,
  type CandidateRow,
} from "@t3tools/client-runtime/zerops/projections";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { mobileCandidates, type MobileCandidate } from "./candidate-listing";
import { useZeropsData } from "./ZeropsDataProvider";
import { useZeropsSession } from "./ZeropsSessionProvider";
import {
  NOT_READ_PROJECTS,
  projectProcessesAtom,
  shownProjectsAtom,
  type OrganizationProjects,
} from "@t3tools/client-runtime/data";

/** A read, and the moment this device saw it change (`known.ts` dates a read with no value by it). */
interface StampedRead<Read> {
  readonly read: Read;
  readonly atMs: number;
}

/** The reads the listing is made of, as last published. */
interface InventoryReads {
  /** The active organization's projects, as the account's store lists them. */
  readonly projects: StampedRead<OrganizationProjects>;
  /** The services of each project this view holds the inventory of, by project key. */
  readonly services: ReadonlyMap<string, StampedRead<CollectionRead<ServiceRecord>>>;
  /** The organization's candidates, derived from these reads at `atMs`. */
  readonly listing: Known<ReadonlyArray<CandidateRow>>;
  readonly atMs: number;
}

const UNREAD: Known<never> = { state: "unread", waitingFor: null };
const NO_MACHINES: ReadonlyMap<TargetKey, EnvironmentMachine> = new Map();
const NO_SUBSCRIPTION = () => () => undefined;
const noMachines = () => NO_MACHINES;

/** The read held until it changes, so its stamp does not tick with every publication. */
function stamped<Read>(previous: StampedRead<Read> | undefined, read: Read): StampedRead<Read> {
  return previous !== undefined && previous.read === read ? previous : { read, atMs: Date.now() };
}

export function useZeropsCandidates(openedProjectId: string | null = null): {
  /**
   * The active organization's candidates as knowledge (DESIGN §3), each with its Mate's reachability:
   * "no projects" is only ever read off a known, complete listing (`candidatePickerBody`).
   */
  readonly listing: Known<ReadonlyArray<MobileCandidate>>;
  /** When the listing's reads last changed: the moment its notice is worded at. */
  readonly readAtMs: number;
  readonly error: string | null;
  /** Makes a manual attempt for the active organization's held inventory demand. */
  readonly refresh: () => void;
} {
  const { status, activeOrganization } = useZeropsSession();
  const { binding, environments, error: runtimeError } = useZeropsData();
  const [reads, setReads] = useState<InventoryReads | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [demandAttempt, setDemandAttempt] = useState(0);
  const organizationId = activeOrganization?.id ?? "";
  // What this view saw of each container's address, for as long as it lives: one seen with its
  // address never waits for it again, and one watched coming up stays watched (`AddressMemory`).
  // Read and written only where the rows are derived, in the demand's publish.
  const addresses = useRef<AddressMemory>(NO_ADDRESS_MEMORY);

  // Navigation is the account store's roster; service detail follows the opened project.
  useEffect(() => {
    if (status !== "signed-in" || binding === null) {
      setReads(null);
      setError(runtimeError?.message ?? null);
      return;
    }

    const { runtime, registry } = binding;
    let cancelled = false;
    let scope: Scope.Closeable | null = null;
    let scopeClosed = false;
    const inventoryLeases = new Map<string, InterestLease>();
    const pendingInventory = new Map<string, Promise<InterestLease>>();
    const serviceUnsubscribes = new Map<string, () => void>();
    const activityUnsubscribes = new Map<string, () => void>();
    let desiredInventory = new Map<string, ProjectRef>();
    let projectsRead: StampedRead<OrganizationProjects> | undefined;
    let rosterWay = "";
    let rosterSince = 0;
    let serviceReads = new Map<string, StampedRead<CollectionRead<ServiceRecord>>>();

    // Scope creation is asynchronous. Cleanup can win that race, so closing is
    // centralized and guarded before this hook starts any demand acquisition.
    const closeScope = (target: Scope.Closeable) => {
      if (scopeClosed) return;
      scopeClosed = true;
      void Effect.runPromise(Scope.close(target, Exit.void));
    };

    const unsubscribeAll = () => {
      for (const unsubscribe of serviceUnsubscribes.values()) unsubscribe();
      serviceUnsubscribes.clear();
      for (const unsubscribe of activityUnsubscribes.values()) unsubscribe();
      activityUnsubscribes.clear();
    };

    const refused = (cause: unknown) =>
      setError(cause instanceof Error ? cause.message : "Could not load Zerops projects.");

    const reconcileInventoryDemand = () => {
      for (const [key, lease] of inventoryLeases) {
        if (desiredInventory.has(key)) continue;
        inventoryLeases.delete(key);
        void Effect.runPromise(lease.release);
      }
      if (scope === null) return;
      for (const [key, project] of desiredInventory) {
        if (inventoryLeases.has(key) || pendingInventory.has(key)) continue;
        const pending = Effect.runPromise(
          runtime.acquire({ kind: "project-inventory", project }).pipe(Scope.provide(scope)),
        );
        pendingInventory.set(key, pending);
        void pending.then(
          (lease) => {
            pendingInventory.delete(key);
            if (cancelled || !desiredInventory.has(key)) {
              void Effect.runPromise(lease.release);
              return;
            }
            inventoryLeases.set(key, lease);
            publish();
          },
          (cause: unknown) => {
            pendingInventory.delete(key);
            if (!cancelled) refused(cause);
          },
        );
      }
    };

    const synchronizeServiceSubscriptions = () => {
      for (const [key, unsubscribe] of serviceUnsubscribes) {
        if (desiredInventory.has(key)) continue;
        unsubscribe();
        serviceUnsubscribes.delete(key);
      }
      for (const [key, project] of desiredInventory) {
        if (serviceUnsubscribes.has(key)) continue;
        serviceUnsubscribes.set(
          key,
          registry.subscribe(runtime.reads.servicesOf(project), publish, {
            immediate: false,
          }),
        );
      }
      // Whether a container's address is being turned on is its project's processes' word: the
      // account runtime reads them while a container of it lacks one (`account/environments.ts`).
      for (const [key, unsubscribe] of activityUnsubscribes) {
        if (desiredInventory.has(key)) continue;
        unsubscribe();
        activityUnsubscribes.delete(key);
      }
      for (const [key, project] of desiredInventory) {
        if (activityUnsubscribes.has(key)) continue;
        activityUnsubscribes.set(
          key,
          registry.subscribe(projectProcessesAtom(project.projectId), publish, {
            immediate: false,
          }),
        );
      }
    };

    const refOf = (projectId: string): ProjectRef => ({
      kind: "project",
      organization: {
        kind: "organization",
        account: binding.account.account,
        organizationId: ZeropsOrganizationId.make(organizationId),
      },
      projectId: ZeropsProjectId.make(projectId),
    });

    function publish(): void {
      if (cancelled) return;
      // The store's roster of the organization this view reads; another one's is not read here.
      const shown = registry.get(shownProjectsAtom);
      const roster = shown.orgId === organizationId ? shown : NOT_READ_PROJECTS;
      projectsRead = stamped(projectsRead, roster);
      desiredInventory = new Map(
        roster.projects
          .filter(({ id, status }) => status === "ACTIVE" && id === openedProjectId)
          .map(({ id }) => [projectKeyOf(refOf(id)), refOf(id)] as const),
      );
      synchronizeServiceSubscriptions();
      reconcileInventoryDemand();
      // A project's services are this listing's only while it holds their inventory: the
      // organization's roster alone cannot say which containers a project has.
      serviceReads = new Map(
        [...desiredInventory]
          .filter(([key]) => inventoryLeases.has(key))
          .map(([key, project]) => [
            key,
            stamped(serviceReads.get(key), registry.get(runtime.reads.servicesOf(project))),
          ]),
      );
      const atMs = Date.now();
      // The roster's own way of waiting or falling behind dates it: a new way, a new moment.
      const way = `${roster.read}/${roster.live}/${roster.reconnecting}/${roster.unavailableReason ?? ""}`;
      if (way !== rosterWay) {
        rosterWay = way;
        rosterSince = atMs;
      }
      const opened = new Map(
        [...desiredInventory.values()].map((project) => [project.projectId as string, project]),
      );
      const facts = addressFactsOf(addresses.current, atMs, (projectId, serviceId) => {
        const project = opened.get(projectId);
        if (project === undefined) return undefined;
        const services = serviceReads.get(projectKeyOf(project));
        return subdomainEnableIn(
          registry.get(projectProcessesAtom(project.projectId)),
          serviceId,
          serviceUpdatedAtIn(services?.read ?? null, serviceId),
        );
      });
      const listing = selectCandidates(
        knownRoster(roster, rosterSince),
        (project) => {
          const services = serviceReads.get(projectKeyOf(refOf(project.id)));
          return services === undefined ? UNREAD : knownServicesOf(services.read, services.atMs);
        },
        facts,
      );
      addresses.current = learnAddresses(addresses.current, [listing]).memory;
      setReads({ projects: projectsRead, services: serviceReads, listing, atMs });
    }

    setError(null);
    setReads(null);

    const unsubscribeRoster = registry.subscribe(shownProjectsAtom, publish, { immediate: false });
    void Effect.runPromise(Scope.make()).then((nextScope) => {
      scope = nextScope;
      if (cancelled) {
        closeScope(nextScope);
        return;
      }
      publish();
    });

    return () => {
      cancelled = true;
      unsubscribeRoster();
      unsubscribeAll();
      desiredInventory = new Map();
      for (const lease of inventoryLeases.values()) void Effect.runPromise(lease.release);
      inventoryLeases.clear();
      if (scope !== null) closeScope(scope);
    };
  }, [binding, demandAttempt, organizationId, openedProjectId, runtimeError, status]);

  const organizationListing = reads?.listing ?? null;

  // Every Mate's machine, as the account runtime's exchange driver holds it (§4.4).
  const machines = useSyncExternalStore(
    environments?.subscribe ?? NO_SUBSCRIPTION,
    environments?.machines ?? noMachines,
  );

  const listing = useMemo(
    (): Known<ReadonlyArray<MobileCandidate>> =>
      status !== "signed-in" || reads === null || organizationListing === null
        ? UNREAD
        : mobileCandidates({
            organizations: [organizationListing],
            machines,
            nowMs: reads.atMs,
          }),
    [machines, organizationListing, reads, status],
  );

  // The person's "try now": the account's observation, and the demand again after an error.
  const refresh = useCallback(() => {
    if (error !== null) {
      setDemandAttempt((attempt) => attempt + 1);
      return;
    }
    binding?.accountData.observation.retry();
  }, [binding, error]);

  return { listing, readAtMs: reads?.atMs ?? 0, error, refresh };
}
