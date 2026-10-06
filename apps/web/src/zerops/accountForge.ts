/**
 * The web's binding to the account runtime's stops (DESIGN §7.3): what each stop's services run,
 * bound once the epoch's first grant built the post-grant stage, and the hooks surfaces read it
 * through. A stop's read is the runtime's atom over the account's store and the stop's listing;
 * nothing here holds a fact of its own.
 *
 * Closing the account lifetime unbinds it at once: a reader after sign-out sees nothing of it.
 */
import { useAtomValue } from "@effect/atom-react";
import type { PostGrantStage, Stops } from "@t3tools/client-runtime/zerops/account/runtime";
import {
  stopDeploymentOf,
  type Deployment,
  type StopService,
} from "@t3tools/client-runtime/zerops/flow";
import type { ZeropsServiceDeployedVersion } from "@t3tools/client-runtime/zerops/data";
import {
  projectKeyOf,
  type ProjectRef,
  type ServiceRef,
} from "@t3tools/client-runtime/zerops/data";
import type { Shown } from "@t3tools/client-runtime/zerops/knowledge";
import { Atom } from "effect/unstable/reactivity";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";

import { onAccountLifetimeClose } from "./accountLifetime";

// ── The binding ──────────────────────────────────────────────────────────────────────────────

let bound: Stops | null = null;
const listeners = new Set<() => void>();

function publish(next: Stops | null): void {
  bound = next;
  for (const listener of listeners) listener();
}

onAccountLifetimeClose(() => {
  if (bound !== null) publish(null);
});

/**
 * Makes the open account's post-grant stage the one the stops' surfaces read. Returns the way to
 * unbind it, which leaves a newer binding alone.
 */
export function bindAccountFlow(stage: Pick<PostGrantStage, "stops">): () => void {
  const stops = stage.stops;
  publish(stops);
  return () => {
    if (bound === stops) publish(null);
  };
}

function subscribeBinding(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const currentStops = (): Stops | null => bound;

function useBoundStops(): Stops | null {
  return useSyncExternalStore(subscribeBinding, currentStops, currentStops);
}

// ── What surfaces read ───────────────────────────────────────────────────────────────────────

/** Nothing is read before the epoch's first grant built the stops. */
const UNBOUND: Shown<never> = { state: "unread", waitingFor: "access-grant" };
const UNBOUND_SERVICES = Atom.make<Shown<ReadonlyArray<StopService>>>(UNBOUND);

/**
 * What each stop runs (§4.7), by project id: demands the stops for as long as the calling surface
 * is mounted. A stop keeps its demand for as long as the surface draws it: another stop joining or
 * leaving the rows, or the same stops in a new array, never lets it go.
 */
export function useStopDeployments(
  projects: ReadonlyArray<ProjectRef>,
  visible: ReadonlyArray<ProjectRef> = projects,
): ReadonlyMap<string, Shown<Deployment>> {
  const stops = useBoundStops();
  const stopKeys = JSON.stringify(projects);
  const visibleKeys = JSON.stringify(visible);

  // One answer per change of what the stops read, whatever array the stops arrive in.
  const deployments = useMemo(() => {
    const refs = JSON.parse(stopKeys) as ReadonlyArray<ProjectRef>;
    return Atom.make(
      (get): ReadonlyMap<string, Shown<Deployment>> =>
        new Map(
          refs.map((project) => [
            project.projectId,
            stops === null ? UNBOUND : stopDeploymentOf(get(stops.services(project))),
          ]),
        ),
    );
  }, [stops, stopKeys]);
  const answer = useAtomValue(deployments);

  // Each stop's release, by project key, while the surface draws it from these stops.
  const demanded = useRef(new Map<string, () => void>());
  useEffect(() => {
    if (stops === null) return;
    const releases = demanded.current;
    return () => {
      for (const release of releases.values()) release();
      releases.clear();
    };
  }, [stops]);

  useEffect(() => {
    if (stops === null) return;
    const drawn = new Map<string, ProjectRef>(
      (JSON.parse(visibleKeys) as ReadonlyArray<ProjectRef>).map((project) => [
        projectKeyOf(project),
        project,
      ]),
    );
    const releases = demanded.current;
    for (const [key, release] of releases) {
      if (drawn.has(key)) continue;
      release();
      releases.delete(key);
    }
    for (const [key, project] of drawn) {
      if (!releases.has(key)) releases.set(key, stops.demand(project));
    }
  }, [stops, visibleKeys]);

  return answer;
}

/**
 * What one stop runs service by service (§4.7), unreduced: its runtime services, each with its own
 * deployment. Demands the stop in detail for as long as the calling surface draws it, whoever else
 * does. `null` reads nothing.
 */
export function useStopServices(project: ProjectRef | null): Shown<ReadonlyArray<StopService>> {
  const stops = useBoundStops();
  const projectKey = project === null ? null : JSON.stringify(project);
  const services = useMemo(
    () =>
      stops === null || projectKey === null
        ? UNBOUND_SERVICES
        : stops.services(JSON.parse(projectKey) as ProjectRef),
    [stops, projectKey],
  );
  useStopDemand(stops, projectKey, "detail");
  return useAtomValue(services);
}

/** A drawn cell holds summary demand without reading every stop. */
export function useStopDeploymentDemand(project: ProjectRef | null): void {
  const stops = useBoundStops();
  useStopDemand(stops, project === null ? null : JSON.stringify(project), "summary");
}

function useStopDemand(
  stops: Stops | null,
  projectKey: string | null,
  scope: "summary" | "detail",
): void {
  useEffect(() => {
    if (stops === null || projectKey === null) return;
    return stops.demand(JSON.parse(projectKey) as ProjectRef, scope);
  }, [stops, projectKey, scope]);
}

/**
 * What each service runs, by service id: the version it started, its source stated where its push
 * left it unstated. One answer per change of what they read.
 */
export function useStatedVersions(
  services: ReadonlyArray<ServiceRef>,
): ReadonlyMap<string, Shown<ZeropsServiceDeployedVersion>> {
  const stops = useBoundStops();
  const serviceKeys = JSON.stringify(services);
  const versions = useMemo(() => {
    const refs = JSON.parse(serviceKeys) as ReadonlyArray<ServiceRef>;
    return Atom.make(
      (get): ReadonlyMap<string, Shown<ZeropsServiceDeployedVersion>> =>
        new Map(
          refs.map((service) => [
            service.serviceId,
            stops === null ? UNBOUND : get(stops.version(service)),
          ]),
        ),
    );
  }, [stops, serviceKeys]);
  return useAtomValue(versions);
}

/** Restarts a refused visible demand only when the person asks. The runtime refresh is the caller's. */
export function againStopDeployment(project: ProjectRef): void {
  bound?.again(project);
}
