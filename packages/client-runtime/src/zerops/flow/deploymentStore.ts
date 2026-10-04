/**
 * The deployment store (DESIGN §2.D D6, §4.7 "Deployment"): what each stop's services run, one
 * fact per service, for the account epoch's post-grant stage.
 *
 * A stop is one Zerops project of a group. A view demands it; while it does, the store follows
 * the data runtime's listings of that project's services — the platform's pushed deployment facet
 * is where existence and time come from (§6.1) — and of its running processes, whose builds say
 * what deploys now and name the version they build (A11). It publishes the stop each time either
 * listing changes, with each service's deployment beside it (`stopServices`). The names the
 * builds gave are kept while the stop is demanded: a version that activates after its build
 * ended is still named by it. A version a push left unstated that no build named is what the
 * account's store states of the service (A14): its organization's active versions and the deploy
 * it last started, streamed — nothing is read for it. A process demand the platform refuses fails what it could
 * not prove, rather than checking forever, until a manual Again while the stop is demanded. A stop nobody demands shows `unread`.
 *
 * A stop read again keeps its last answer while nothing new is known (`heldThroughRecheck`):
 * "Checking what runs here…" is said only before the first one.
 *
 * A `deployment` invalidation (§6.2) publishes the stop holding that service again.
 *
 * @module flow/deploymentStore
 */
import {
  projectKeyOf,
  type CollectionRead,
  type LeaseAdmissionError,
  type ProcessRecord,
  type ProjectRef,
  type ServiceRecord,
  type ServiceRef,
} from "../data/types.ts";
import type { ZeropsServiceDeployedVersion } from "../data/deployedVersion.ts";
import type { Invalidation } from "../knowledge/invalidation.ts";
import type { Known, Shown } from "../knowledge/known.ts";
import {
  afterBuilds,
  buildNames,
  buildsListed,
  heldThroughRecheck,
  stopServices,
  unnamedVersions,
  type ProcessRefusal,
  type SeenBuild,
  type StopService,
} from "./deployment.ts";

/** The invalidations the deployment store answers (§6.2). */
export type DeploymentInvalidation = Extract<Invalidation, { readonly topic: "deployment" }>;

export interface DeploymentStorePorts {
  /** The project's service listing, as the data runtime holds it now. */
  readonly services: (project: ProjectRef) => CollectionRead<ServiceRecord>;
  /** The project's running processes, as the data runtime holds them now. */
  readonly processes: (project: ProjectRef) => CollectionRead<ProcessRecord>;
  /** What the account's store states the service runs now (A14), without a read. */
  readonly deployedVersion: (service: ServiceRef) => Shown<ZeropsServiceDeployedVersion>;
  /**
   * Holds the demand both listings and the services' versions need and tells `changed` each time
   * any of them changes, until the returned stop; tells `refused` once when the platform takes no
   * demand for the processes.
   */
  readonly follow: (
    project: ProjectRef,
    changed: () => void,
    refused: (reason: LeaseAdmissionError["reason"]) => void,
  ) => () => void;
  readonly nowMs: () => number;
  /** Arms a timer; the returned function disarms it. */
  readonly setTimer: (delayMs: number, fire: () => void) => () => void;
}

export interface DeploymentStore {
  /** Shows the stop until the returned release. */
  readonly demand: (project: ProjectRef) => () => void;
  /** The stop's runtime services and what each runs; `unread` while nobody demands it. */
  readonly stop: (project: ProjectRef) => Shown<ReadonlyArray<StopService>>;
  /** One manual attempt for a stop a view still shows. */
  readonly again: (project: ProjectRef) => void;
  /** Whether a view demands the stop that holds the service. */
  readonly shows: (service: ServiceRef) => boolean;
  /** Told the project of every stop that was published again. */
  readonly subscribe: (listener: (project: ProjectRef) => void) => () => void;
  readonly invalidate: (invalidation: DeploymentInvalidation) => void;
  /** The account closed: nothing is followed or published again. */
  readonly dispose: () => void;
}

interface Entry {
  readonly project: ProjectRef;
  leases: number;
  /** Every app version a build of the stop named while it was demanded, by id. */
  names: ReadonlyMap<string, string>;
  /** Why the platform took no demand for the stop's running processes, while it did not. */
  refused: ProcessRefusal | null;
  /** How often the platform refused the demand; it keeps a demand it admitted. */
  refusals: number;
  shown: Known<ReadonlyArray<StopService>>;
  /** The services seen building while demanded and not seen running since (`afterBuilds`). */
  built: ReadonlyMap<string, SeenBuild>;
  /** Disarms the read again that ends a build's grace (`AFTER_BUILD_GRACE_MS`). */
  disarmGrace: () => void;
  unfollow: () => void;
}

const UNREAD: Known<never> = { state: "unread", waitingFor: null };

export function makeDeploymentStore(ports: DeploymentStorePorts): DeploymentStore {
  const entries = new Map<string, Entry>();
  const listeners = new Set<(project: ProjectRef) => void>();
  let disposed = false;

  /** The stop as its listings stand now, the names its builds gave, and what the store states. */
  const read = (entry: Entry): void => {
    const services = ports.services(entry.project);
    const processes = ports.processes(entry.project);
    entry.names = buildNames(entry.names, processes);
    const next = stopServices(
      {
        services,
        processes,
        names: entry.names,
        refused: entry.refused,
        stated: new Map(
          unnamedVersions(services, entry.names).map(({ service, versionId }) => [
            versionId,
            ports.deployedVersion(service),
          ]),
        ),
      },
      ports.nowMs(),
    );
    // A build seen to end with nothing running is the first deploy failing; no listing keeps it.
    const after = afterBuilds(entry.built, next, ports.nowMs(), buildsListed(processes));
    entry.built = after.built;
    // A grace running: read the stop again as it ends, so a failure shows without a push.
    entry.disarmGrace();
    entry.disarmGrace = () => undefined;
    if (after.wakeAtMs !== null) {
      entry.disarmGrace = ports.setTimer(after.wakeAtMs - ports.nowMs(), () => {
        if (!disposed && entries.get(projectKeyOf(entry.project)) === entry) publish(entry);
      });
    }
    // A stop read again keeps its last answer while nothing new is known (F5).
    entry.shown = heldThroughRecheck(entry.shown, after.shown, ports.nowMs());
  };

  const publish = (entry: Entry): void => {
    read(entry);
    for (const listener of listeners) listener(entry.project);
  };

  /** Asks for the stop's demand; a refusal fails the stop until it is asked for again. */
  const follow = (entry: Entry): void => {
    entry.unfollow = ports.follow(
      entry.project,
      () => publish(entry),
      (reason) => {
        if (disposed || entries.get(projectKeyOf(entry.project)) !== entry) return;
        entry.refused = { reason, attempt: ++entry.refusals };
        publish(entry);
      },
    );
  };

  /** Asked again, the stop reads as its listings say until the platform answers. */
  const askAgain = (entry: Entry): void => {
    entry.unfollow();
    const refused = entry.refused;
    follow(entry);
    // Refused again as it was asked, the stop already published its new refusal.
    if (entry.refused !== refused) return;
    entry.refused = null;
    publish(entry);
  };

  return {
    demand: (project) => {
      if (disposed) return () => undefined;
      const key = projectKeyOf(project);
      let entry = entries.get(key);
      if (entry === undefined) {
        const created: Entry = {
          project,
          leases: 0,
          names: new Map(),
          refused: null,
          refusals: 0,
          shown: UNREAD,
          built: new Map(),
          disarmGrace: () => undefined,
          unfollow: () => undefined,
        };
        // Held before it is followed: a demand refused as it is taken reaches the entry.
        entries.set(key, created);
        follow(created);
        // Its listings may be read already: the stop is known as it is first demanded.
        publish(created);
        entry = created;
      }
      const held = entry;
      held.leases += 1;
      let released = false;
      return () => {
        if (released || disposed) return;
        released = true;
        held.leases -= 1;
        if (held.leases > 0) return;
        held.disarmGrace();
        held.unfollow();
        entries.delete(key);
      };
    },
    stop: (project) => entries.get(projectKeyOf(project))?.shown ?? UNREAD,
    again: (project) => {
      if (disposed) return;
      const entry = entries.get(projectKeyOf(project));
      if (entry !== undefined) askAgain(entry);
    },
    shows: (service) => entries.has(projectKeyOf(service.project)),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    invalidate: (invalidation) => {
      if (disposed) return;
      const entry = entries.get(projectKeyOf(invalidation.service.project));
      if (entry !== undefined) publish(entry);
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const entry of entries.values()) {
        entry.disarmGrace();
        entry.unfollow();
      }
      entries.clear();
      listeners.clear();
    },
  };
}
