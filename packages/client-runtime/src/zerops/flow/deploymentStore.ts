/**
 * The deployment store (DESIGN §2.D D6, §4.7 "Deployment"): what each stop's services run, one
 * fact per service, for the account epoch's post-grant stage.
 *
 * A stop is one Zerops project of a group. Summary surfaces share service demand and the embedded
 * active deployment. Opened detail upgrades the same entry to include running processes and the
 * account's version/variable facts. Names its builds supplied stay with the entry until its last
 * surface closes. Closing the last detail releases detail work while summaries keep their demand.
 * A refused demand fails visibly until a manual Again. A stop nobody demands shows `unread`.
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
  type ProcessRef,
  type ProcessStatus,
  type ProjectRef,
  type ServiceRecord,
  type ServiceRef,
} from "../data/types.ts";
import type { ZeropsServiceDeployedVersion } from "../data/deployedVersion.ts";
import type { Invalidation } from "../knowledge/invalidation.ts";
import type { Known, Shown } from "../knowledge/known.ts";
import {
  buildEnds,
  buildNames,
  heldThroughRecheck,
  stopServices,
  unnamedVersions,
  type ProcessRefusal,
  type StopService,
} from "./deployment.ts";

/** The invalidations the deployment store answers (§6.2). */
export type DeploymentInvalidation = Extract<Invalidation, { readonly topic: "deployment" }>;

export interface DeploymentStorePorts {
  /** The project's service listing, as the data runtime holds it now. */
  readonly services: (project: ProjectRef) => CollectionRead<ServiceRecord>;
  /** The project's running processes: the organization's running work, read for every stop. */
  readonly processes: (project: ProjectRef) => CollectionRead<ProcessRecord>;
  /** What the account's store states the service runs now (A14), without a read. */
  readonly deployedVersion: (service: ServiceRef) => Shown<ZeropsServiceDeployedVersion>;
  /**
   * Holds service demand, adding processes for detail; tells `changed` when shared facts move,
   * and `refused` when the platform takes no demand. The returned stop releases this scope.
   */
  readonly follow: (
    project: ProjectRef,
    changed: () => void,
    refused: (reason: LeaseAdmissionError["reason"]) => void,
    scope: "summary" | "detail",
  ) => () => void;
  /** Where a process stands as the account's store holds it: how a build it followed ended. */
  readonly buildStatus: (process: ProcessRef) => ProcessStatus | undefined;
  readonly nowMs: () => number;
}

export interface DeploymentStore {
  /** Shows the stop until the returned release. */
  readonly demand: (project: ProjectRef, scope?: "summary" | "detail") => () => void;
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
  detailLeases: number;
  /** Every app version a build of the stop named while it was demanded, by id. */
  names: ReadonlyMap<string, string>;
  /** Why the platform took no demand for the stop's running processes, while it did not. */
  refused: ProcessRefusal | null;
  /** How often the platform refused the demand; it keeps a demand it admitted. */
  refusals: number;
  shown: Known<ReadonlyArray<StopService>>;
  /** Each service's build seen running while demanded, by its process (`buildEnds`). */
  builds: ReadonlyMap<string, ProcessRef>;
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
    // A build that ended with nothing running ended as Zerops says its process did.
    const ended = buildEnds(entry.builds, next, processes, ports.buildStatus);
    entry.builds = ended.followed;
    // A stop read again keeps its last answer while nothing new is known (F5).
    entry.shown = heldThroughRecheck(entry.shown, ended.shown, ports.nowMs());
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
      entry.detailLeases > 0 ? "detail" : "summary",
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
    demand: (project, scope = "summary") => {
      if (disposed) return () => undefined;
      const key = projectKeyOf(project);
      let entry = entries.get(key);
      if (entry === undefined) {
        const created: Entry = {
          project,
          leases: 0,
          detailLeases: scope === "detail" ? 1 : 0,
          names: new Map(),
          refused: null,
          refusals: 0,
          shown: UNREAD,
          builds: new Map(),
          unfollow: () => undefined,
        };
        // Held before it is followed: a demand refused as it is taken reaches the entry.
        entries.set(key, created);
        follow(created);
        // Its listings may be read already: the stop is known as it is first demanded.
        publish(created);
        entry = created;
      } else if (scope === "detail") {
        entry.detailLeases += 1;
        if (entry.detailLeases === 1) {
          entry.unfollow();
          follow(entry);
          publish(entry);
        }
      }
      const held = entry;
      held.leases += 1;
      let released = false;
      return () => {
        if (released || disposed) return;
        released = true;
        held.leases -= 1;
        if (scope === "detail") held.detailLeases -= 1;
        if (held.leases > 0) {
          if (scope === "detail" && held.detailLeases === 0) {
            held.unfollow();
            follow(held);
            publish(held);
          }
          return;
        }
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
      for (const entry of entries.values()) entry.unfollow();
      entries.clear();
      listeners.clear();
    },
  };
}
