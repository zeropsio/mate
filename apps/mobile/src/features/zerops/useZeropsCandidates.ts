import {
  knownRoster,
  knownServices,
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
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { mobileCandidates, type MobileCandidate } from "./candidate-listing";
import { useZeropsData } from "./ZeropsAccountEnvironmentProvider";
import { useZeropsSession } from "./ZeropsSessionProvider";
import {
  NOT_READ_PROJECTS,
  projectProcessesAtom,
  projectServicesAtom,
  shownMateLinksAtom,
  shownProjectsAtom,
  type ProjectServices,
} from "@t3tools/client-runtime/data";

/** A read, and the moment this device saw it change (`known.ts` dates a read with no value by it). */
interface StampedRead<Read> {
  readonly read: Read;
  readonly atMs: number;
}

/** The listing, as last published. */
interface InventoryReads {
  /** The organization's candidates, derived from the store's reads at `atMs`. */
  readonly listing: Known<ReadonlyArray<CandidateRow>>;
  readonly atMs: number;
}

const UNREAD: Known<never> = { state: "unread", waitingFor: null };
const NO_MACHINES: ReadonlyMap<TargetKey, EnvironmentMachine> = new Map();

/** The read held until it changes, so its stamp does not tick with every publication. */
function stamped<Read>(previous: StampedRead<Read> | undefined, read: Read): StampedRead<Read> {
  return previous !== undefined && previous.read === read ? previous : { read, atMs: Date.now() };
}

export function useZeropsCandidates(): {
  /**
   * The active organization's candidates as knowledge (DESIGN §3), each with its Mate's reachability:
   * "no projects" is only ever read off a known, complete listing (`candidatePickerBody`).
   */
  readonly listing: Known<ReadonlyArray<MobileCandidate>>;
  /** When the listing's reads last changed: the moment its notice is worded at. */
  readonly readAtMs: number;
  readonly error: string | null;
  /** The person's "try now" for what the account observes. */
  readonly refresh: () => void;
} {
  const { status, activeOrganization } = useZeropsSession();
  const { binding, error: runtimeError } = useZeropsData();
  const [reads, setReads] = useState<InventoryReads | null>(null);
  const organizationId = activeOrganization?.id ?? "";
  // What this view saw of each container's address, for as long as it lives: one seen with its
  // address never waits for it again, and one watched coming up stays watched (`AddressMemory`).
  // Read and written only where the rows are derived, in the demand's publish.
  const addresses = useRef<AddressMemory>(NO_ADDRESS_MEMORY);

  // The organization's projects and every project's services are the account store's.
  useEffect(() => {
    if (status !== "signed-in" || binding === null) {
      setReads(null);
      return;
    }

    const { registry } = binding;
    let cancelled = false;
    const projectUnsubscribes = new Map<string, () => void>();
    let rosterWay = "";
    let rosterSince = 0;
    let serviceReads = new Map<string, StampedRead<ProjectServices>>();

    /** Each active project's services and processes, heard while the roster lists it. */
    const follow = (projectIds: ReadonlySet<string>) => {
      for (const [projectId, unsubscribe] of projectUnsubscribes) {
        if (projectIds.has(projectId)) continue;
        unsubscribe();
        projectUnsubscribes.delete(projectId);
      }
      for (const projectId of projectIds) {
        if (projectUnsubscribes.has(projectId)) continue;
        const services = registry.subscribe(projectServicesAtom(projectId), publish, {
          immediate: false,
        });
        // Whether a container's address is being turned on is its project's processes' word.
        const activity = registry.subscribe(projectProcessesAtom(projectId), publish, {
          immediate: false,
        });
        projectUnsubscribes.set(projectId, () => {
          services();
          activity();
        });
      }
    };

    function publish(): void {
      if (cancelled) return;
      // The store's roster of the organization this view reads; another one's is not read here.
      const shown = registry.get(shownProjectsAtom);
      const roster = shown.orgId === organizationId ? shown : NOT_READ_PROJECTS;
      const active = new Set(
        roster.projects.filter(({ status }) => status === "ACTIVE").map(({ id }) => id),
      );
      follow(active);
      serviceReads = new Map(
        [...active].map((projectId) => [
          projectId,
          stamped(serviceReads.get(projectId), registry.get(projectServicesAtom(projectId))),
        ]),
      );
      const atMs = Date.now();
      // The roster's own way of waiting or falling behind dates it: a new way, a new moment.
      const way = `${roster.read}/${roster.live}/${roster.reconnecting}/${roster.unavailableReason ?? ""}`;
      if (way !== rosterWay) {
        rosterWay = way;
        rosterSince = atMs;
      }
      const facts = addressFactsOf(addresses.current, atMs, (projectId, serviceId) => {
        const services = serviceReads.get(projectId);
        if (services === undefined) return undefined;
        return subdomainEnableIn(
          registry.get(projectProcessesAtom(projectId)),
          serviceId,
          serviceUpdatedAtIn(services.read.services, serviceId),
        );
      });
      const listing = selectCandidates(
        knownRoster(roster, rosterSince),
        (project) => {
          const services = serviceReads.get(project.id);
          return services === undefined ? UNREAD : knownServices(services.read, services.atMs);
        },
        facts,
      );
      addresses.current = learnAddresses(addresses.current, [listing]).memory;
      setReads({ listing, atMs });
    }

    setReads(null);
    const unsubscribeRoster = registry.subscribe(shownProjectsAtom, publish, { immediate: false });
    publish();

    return () => {
      cancelled = true;
      unsubscribeRoster();
      for (const unsubscribe of projectUnsubscribes.values()) unsubscribe();
      projectUnsubscribes.clear();
    };
  }, [binding, organizationId, status]);

  const organizationListing = reads?.listing ?? null;

  // Every Mate's machine, as the account's store holds it (§4.4).
  const registry = binding?.registry ?? null;
  const subscribeMates = useCallback(
    (listener: () => void) =>
      registry === null ? () => undefined : registry.subscribe(shownMateLinksAtom, listener),
    [registry],
  );
  const readMates = useCallback(
    () => (registry === null ? NO_MACHINES : registry.get(shownMateLinksAtom).machines),
    [registry],
  );
  const machines = useSyncExternalStore(subscribeMates, readMates);

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

  // The person's "try now": the account's observation.
  const refresh = useCallback(() => {
    binding?.accountData.observation.retry();
  }, [binding]);

  return { listing, readAtMs: reads?.atMs ?? 0, error: runtimeError?.message ?? null, refresh };
}
