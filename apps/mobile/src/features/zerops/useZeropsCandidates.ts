import {
  knownProjectsOf,
  knownServicesOf,
  projectKeyOf,
  ZeropsOrganizationId,
  type CollectionRead,
  type InterestLease,
  type OrganizationRef,
  type ProjectRecord,
  type ProjectRef,
  type ServiceRecord,
} from "@t3tools/client-runtime/zerops/data";
import type { EnvironmentMachine, TargetKey } from "@t3tools/client-runtime/zerops/environments";
import type { Known } from "@t3tools/client-runtime/zerops/knowledge";
import { selectCandidates, type CandidateRow } from "@t3tools/client-runtime/zerops/projections";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { mobileCandidates, type MobileCandidate } from "./candidate-listing";
import { useZeropsData, type ZeropsDataBinding } from "./ZeropsDataProvider";
import { useZeropsSession } from "./ZeropsSessionProvider";

/** A read, and the moment this device saw it change (`known.ts` dates a read with no value by it). */
interface StampedRead<Read> {
  readonly read: Read;
  readonly atMs: number;
}

/** The inventory's reads the listing is made of, as last published. */
interface InventoryReads {
  /** Each organization's projects, in the session's order. */
  readonly projects: ReadonlyArray<StampedRead<CollectionRead<ProjectRecord>>>;
  /** The services of each project this view holds the inventory of, by project key. */
  readonly services: ReadonlyMap<string, StampedRead<CollectionRead<ServiceRecord>>>;
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

const isActiveProject = (
  member: CollectionRead<ProjectRecord>["value"][number],
): member is Extract<typeof member, { readonly knowledge: "observed" }> =>
  member.knowledge === "observed" &&
  member.record.lifecycle.knowledge === "observed" &&
  member.record.lifecycle.fields.status === "ACTIVE";

/** The session's organizations, in the account the binding holds. */
function organizationRefsOf(
  binding: ZeropsDataBinding,
  organizationIdsKey: string,
): ReadonlyArray<OrganizationRef> {
  return organizationIdsKey === ""
    ? []
    : organizationIdsKey.split(",").map((organizationId) => ({
        kind: "organization",
        account: binding.account.account,
        organizationId: ZeropsOrganizationId.make(organizationId),
      }));
}

export function useZeropsCandidates(): {
  /**
   * Every organization's candidates as knowledge (DESIGN §3), each with its Mate's reachability:
   * "no projects" is only ever read off a known, complete listing (`candidatePickerBody`).
   */
  readonly listing: Known<ReadonlyArray<MobileCandidate>>;
  /** When the listing's reads last changed: the moment its notice is worded at. */
  readonly readAtMs: number;
  readonly error: string | null;
  /** Reads every organization's inventory again; retries the demand a failure refused. */
  readonly refresh: () => void;
} {
  const { status, organizations } = useZeropsSession();
  const { binding, environments, error: runtimeError } = useZeropsData();
  const [reads, setReads] = useState<InventoryReads | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [demandAttempt, setDemandAttempt] = useState(0);
  const organizationIdsKey = organizations.map((organization) => organization.id).join(",");

  // The view's demand on the inventory: each organization's projects and each active project's
  // services. It follows the account and its organizations only — never a connection's phase.
  useEffect(() => {
    if (status !== "signed-in" || binding === null) {
      setReads(null);
      setError(runtimeError?.message ?? null);
      return;
    }

    const { runtime, registry } = binding;
    const organizationRefs = organizationRefsOf(binding, organizationIdsKey);
    let cancelled = false;
    let scope: Scope.Closeable | null = null;
    let scopeClosed = false;
    const inventoryLeases = new Map<string, InterestLease>();
    const pendingInventory = new Map<string, Promise<InterestLease>>();
    const projectUnsubscribes: Array<() => void> = [];
    const serviceUnsubscribes = new Map<string, () => void>();
    let desiredInventory = new Map<string, ProjectRef>();
    let projectReads: ReadonlyArray<StampedRead<CollectionRead<ProjectRecord>>> = [];
    let serviceReads = new Map<string, StampedRead<CollectionRead<ServiceRecord>>>();

    // Scope creation is asynchronous. Cleanup can win that race, so closing is
    // centralized and guarded before this hook starts any demand acquisition.
    const closeScope = (target: Scope.Closeable) => {
      if (scopeClosed) return;
      scopeClosed = true;
      void Effect.runPromise(Scope.close(target, Exit.void));
    };

    const unsubscribeAll = () => {
      for (const unsubscribe of projectUnsubscribes) unsubscribe();
      projectUnsubscribes.length = 0;
      for (const unsubscribe of serviceUnsubscribes.values()) unsubscribe();
      serviceUnsubscribes.clear();
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
    };

    function publish(): void {
      if (cancelled) return;
      projectReads = organizationRefs.map((organization, index) =>
        stamped(projectReads[index], registry.get(runtime.reads.projectsOf(organization))),
      );
      desiredInventory = new Map(
        projectReads.flatMap(({ read }) =>
          read.value
            .filter(isActiveProject)
            .map((project) => [projectKeyOf(project.record.ref), project.record.ref] as const),
        ),
      );
      synchronizeServiceSubscriptions();
      reconcileInventoryDemand();
      // A project's services are this listing's only while it holds their inventory: the
      // organization's baseline alone cannot say which containers a project has.
      serviceReads = new Map(
        [...desiredInventory]
          .filter(([key]) => inventoryLeases.has(key))
          .map(([key, project]) => [
            key,
            stamped(serviceReads.get(key), registry.get(runtime.reads.servicesOf(project))),
          ]),
      );
      setReads({ projects: projectReads, services: serviceReads, atMs: Date.now() });
    }

    setError(null);
    setReads(null);

    void Effect.runPromise(Scope.make()).then(async (nextScope) => {
      scope = nextScope;
      if (cancelled) {
        closeScope(nextScope);
        return;
      }
      try {
        await Promise.all(
          organizationRefs.map((organization) =>
            Effect.runPromise(
              runtime
                .acquire({ kind: "organization-inventory", organization })
                .pipe(Scope.provide(nextScope)),
            ),
          ),
        );
        if (cancelled) return;
        projectUnsubscribes.push(
          ...organizationRefs.map((organization) =>
            registry.subscribe(runtime.reads.projectsOf(organization), publish, {
              immediate: false,
            }),
          ),
        );
        publish();
      } catch (cause) {
        if (!cancelled) refused(cause);
      }
    });

    return () => {
      cancelled = true;
      unsubscribeAll();
      desiredInventory = new Map();
      for (const lease of inventoryLeases.values()) void Effect.runPromise(lease.release);
      inventoryLeases.clear();
      if (scope !== null) closeScope(scope);
    };
  }, [binding, demandAttempt, organizationIdsKey, runtimeError, status]);

  const organizationListings = useMemo(
    (): ReadonlyArray<Known<ReadonlyArray<CandidateRow>>> | null =>
      reads === null
        ? null
        : reads.projects.map(({ read, atMs }) =>
            selectCandidates(knownProjectsOf(read, atMs), (project) => {
              const services = reads.services.get(projectKeyOf(project));
              return services === undefined
                ? UNREAD
                : knownServicesOf(services.read, services.atMs);
            }),
          ),
    [reads],
  );

  // Every Mate's machine, as the account runtime's exchange driver holds it (§4.4).
  const machines = useSyncExternalStore(
    environments?.subscribe ?? NO_SUBSCRIPTION,
    environments?.machines ?? noMachines,
  );

  const listing = useMemo(
    (): Known<ReadonlyArray<MobileCandidate>> =>
      status !== "signed-in" || reads === null || organizationListings === null
        ? UNREAD
        : mobileCandidates({
            organizations: organizationListings,
            machines,
            nowMs: reads.atMs,
          }),
    [machines, organizationListings, reads, status],
  );

  const refresh = useCallback(() => {
    if (error !== null) {
      setDemandAttempt((attempt) => attempt + 1);
      return;
    }
    if (binding === null) return;
    for (const organization of organizationRefsOf(binding, organizationIdsKey)) {
      void Effect.runPromise(binding.runtime.refresh(organization));
    }
  }, [binding, error, organizationIdsKey]);

  return { listing, readAtMs: reads?.atMs ?? 0, error, refresh };
}
