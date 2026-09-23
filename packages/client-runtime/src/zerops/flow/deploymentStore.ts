/**
 * The deployment store (DESIGN §2.D D6, §4.7 "Deployment"): what each stop's services run, one
 * fact per service, for the account epoch's post-grant stage.
 *
 * A stop is one Zerops project of a group. A view demands it; while it does, the store follows
 * the data runtime's listing of that project's services — the platform's pushed deployment facet
 * is where existence, time, name and commit come from (§6.1) — and publishes the stop each time
 * the listing changes, with each service's deployment beside it (`stopServices`). A stop nobody
 * demands shows `unread`.
 *
 * A `deployment` invalidation (§6.2) publishes the stop holding that service again. The pushed
 * facet is the store's one source so far: what a deploy that finished changed arrives as a push,
 * and the invalidation is where the build process frames and the read of the active app version
 * by id join (A11).
 *
 * @module flow/deploymentStore
 */
import {
  projectKeyOf,
  type CollectionRead,
  type ProjectRef,
  type ServiceRecord,
  type ServiceRef,
} from "../data/types.ts";
import type { Invalidation } from "../knowledge/invalidation.ts";
import type { Shown } from "../knowledge/known.ts";
import { stopServices, type StopService } from "./deployment.ts";

/** The invalidations the deployment store answers (§6.2). */
export type DeploymentInvalidation = Extract<Invalidation, { readonly topic: "deployment" }>;

export interface DeploymentStorePorts {
  /** The project's service listing, as the data runtime holds it now. */
  readonly services: (project: ProjectRef) => CollectionRead<ServiceRecord>;
  /** Tells `changed` each time that listing changes, until the returned stop. */
  readonly watch: (project: ProjectRef, changed: () => void) => () => void;
  readonly nowMs: () => number;
}

export interface DeploymentStore {
  /** Shows the stop until the returned release. */
  readonly demand: (project: ProjectRef) => () => void;
  /** The stop's runtime services and what each runs; `unread` while nobody demands it. */
  readonly stop: (project: ProjectRef) => Shown<ReadonlyArray<StopService>>;
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
  shown: Shown<ReadonlyArray<StopService>>;
  readonly unwatch: () => void;
}

const UNREAD: Shown<never> = { state: "unread", waitingFor: null };

export function makeDeploymentStore(ports: DeploymentStorePorts): DeploymentStore {
  const entries = new Map<string, Entry>();
  const listeners = new Set<(project: ProjectRef) => void>();
  let disposed = false;

  const publish = (entry: Entry): void => {
    entry.shown = stopServices(ports.services(entry.project), ports.nowMs());
    for (const listener of listeners) listener(entry.project);
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
          shown: stopServices(ports.services(project), ports.nowMs()),
          unwatch: ports.watch(project, () => publish(created)),
        };
        entries.set(key, created);
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
        held.unwatch();
        entries.delete(key);
      };
    },
    stop: (project) => entries.get(projectKeyOf(project))?.shown ?? UNREAD,
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
      for (const entry of entries.values()) entry.unwatch();
      entries.clear();
      listeners.clear();
    },
  };
}
