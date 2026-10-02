/**
 * The web's binding to the account runtime's project flow (DESIGN §7.3): the post-grant stage's
 * forge — the person's Gitea sessions, the forge store and the flow's command attempts — and its
 * deployment store, bound once the epoch's first grant built them, and the hooks surfaces read
 * them through. The stores are the runtime's; nothing here holds a fact of its own.
 *
 * It also carries the Mates' pushes into the account's bus: a lifecycle envelope and a checkout's
 * VCS status name the forge and deployment facts they made old (`flow/envelopeInvalidations.ts`).
 *
 * Closing the account lifetime unbinds it at once: a reader after sign-out sees nothing of it.
 */
import type {
  AccountForge,
  AccountForgePorts,
  PostGrantStage,
} from "@t3tools/client-runtime/zerops/account/runtime";
import {
  envelopeInvalidations,
  stopDeploymentOf,
  type Deployment,
  type DeploymentStore,
  type EnvelopeServices,
  type StopService,
} from "@t3tools/client-runtime/zerops/flow";
import { projectKeyOf, type ProjectRef } from "@t3tools/client-runtime/zerops/data";
import type { Shown } from "@t3tools/client-runtime/zerops/knowledge";
import type { ZeropsStateEnvelope } from "@t3tools/contracts";
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";

import { randomUUID } from "../lib/utils";
import { bindAccountGiteaSessions } from "./accountGiteaSessions";
import { invalidateZerops } from "./accountInvalidations";
import { onAccountLifetimeClose } from "./accountLifetime";
import { batchedPerTask } from "./taskBatch";

/** The browser's half of the forge: fetch, the clocks and timers. */
export const webForgePorts: AccountForgePorts = {
  fetch: (input, init) => globalThis.fetch(input, init),
  now: () => ({ wall: Date.now(), mono: performance.now() }),
  random: Math.random,
  nonce: randomUUID,
  setTimer: (delayMs, fire) => {
    const timer = setTimeout(fire, delayMs);
    return () => clearTimeout(timer);
  },
};

// ── The binding ──────────────────────────────────────────────────────────────────────────────

interface AccountFlow {
  readonly forge: AccountForge | null;
  readonly deployments: DeploymentStore;
  readonly services: EnvelopeServices;
}

let bound: AccountFlow | null = null;
const listeners = new Set<() => void>();

function publish(next: AccountFlow | null): void {
  bound = next;
  for (const listener of listeners) listener();
}

onAccountLifetimeClose(() => {
  if (bound !== null) publish(null);
});

/**
 * Makes the open account's post-grant stage the one the flow's surfaces read, its Gitea sessions
 * with it. Returns the way to unbind it, which leaves a newer binding alone.
 */
export function bindAccountFlow(
  stage: Pick<PostGrantStage, "forge" | "deployments" | "services">,
): () => void {
  const flow: AccountFlow = {
    forge: stage.forge,
    deployments: stage.deployments,
    services: stage.services,
  };
  publish(flow);
  const unbindSessions =
    stage.forge === null ? () => undefined : bindAccountGiteaSessions(stage.forge.sessions);
  return () => {
    unbindSessions();
    if (bound === flow) publish(null);
  };
}

function subscribeBinding(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function currentAccountFlow(): AccountFlow | null {
  return bound;
}

function useAccountFlow(): AccountFlow | null {
  return useSyncExternalStore(subscribeBinding, currentAccountFlow, currentAccountFlow);
}

// ── The Mates' pushes ────────────────────────────────────────────────────────────────────────

/** A Mate's lifecycle envelope moved on: what it made old is read again (§6.1). */
export function lifecycleEnvelopeChanged(
  previous: ZeropsStateEnvelope | undefined,
  next: ZeropsStateEnvelope | undefined,
): void {
  if (bound === null) return;
  for (const invalidation of envelopeInvalidations(previous, next, bound.services)) {
    invalidateZerops(invalidation);
  }
}

// ── What surfaces read ───────────────────────────────────────────────────────────────────────

/** Subscribes to the bound stores, moving their counter once per task however often they publish. */
function useFlowSubscription(flow: AccountFlow | null): (listener: () => void) => () => void {
  return useCallback(
    (listener: () => void) => {
      if (flow === null) return () => undefined;
      const batched = batchedPerTask(() => {
        versions.set(flow, (versions.get(flow) ?? 0) + 1);
        listener();
      });
      const unsubscribes = [flow.deployments.subscribe(batched.notify)];
      if (flow.forge !== null) {
        unsubscribes.push(
          flow.forge.store.subscribe(batched.notify),
          flow.forge.sessions.subscribe(batched.notify),
        );
      }
      return () => {
        for (const unsubscribe of unsubscribes) unsubscribe();
        batched.cancel();
      };
    },
    [flow],
  );
}

/** The bound stores' counter, as `useFlowSubscription` moves it. */
function flowVersionOf(flow: AccountFlow | null): number {
  return flow === null ? 0 : (versions.get(flow) ?? 0);
}

const versions = new WeakMap<AccountFlow, number>();

/**
 * What the stops run as of the stores' counter: one immutable map per counter value, so the
 * answer moves exactly when the store does, whatever array the stops arrive in.
 */
function stopDeploymentsSnapshot(
  flow: AccountFlow | null,
  stopKeys: string,
): () => ReadonlyMap<string, Shown<Deployment>> {
  const projects = JSON.parse(stopKeys) as ReadonlyArray<ProjectRef>;
  let read: {
    readonly version: number;
    readonly stops: ReadonlyMap<string, Shown<Deployment>>;
  } | null = null;
  return () => {
    const version = flowVersionOf(flow);
    if (read === null || read.version !== version) {
      read = {
        version,
        stops: new Map(
          projects.map((project) => [
            project.projectId,
            flow === null ? UNBOUND : stopDeploymentOf(flow.deployments.stop(project)),
          ]),
        ),
      };
    }
    return read.stops;
  };
}

/** Nothing is read before the epoch's first grant built the stores. */
const UNBOUND: Shown<never> = { state: "unread", waitingFor: "access-grant" };

/**
 * What each stop runs (§4.7), by project id: demands the stops of the deployment store for as long
 * as the calling surface is mounted, and reads each again once per task however often it publishes.
 * A stop keeps its demand, and with it what its builds named, for as long as the surface draws it:
 * another stop joining or leaving the rows, or the same stops in a new array, never lets it go.
 */
export function useStopDeployments(
  projects: ReadonlyArray<ProjectRef>,
): ReadonlyMap<string, Shown<Deployment>> {
  const flow = useAccountFlow();
  const stopKeys = JSON.stringify(projects);

  // The store's answers as of its counter: read through the store, never memoised on the stops.
  // Subscribed before the stops are demanded, so what a demand publishes at once is heard.
  const subscribe = useFlowSubscription(flow);
  const snapshot = useMemo(() => stopDeploymentsSnapshot(flow, stopKeys), [flow, stopKeys]);
  const stops = useSyncExternalStore(subscribe, snapshot, snapshot);

  // Each stop's release, by project key, while the surface draws it from this flow.
  const demanded = useRef(new Map<string, () => void>());
  useEffect(() => {
    if (flow === null) return;
    const releases = demanded.current;
    return () => {
      for (const release of releases.values()) release();
      releases.clear();
    };
  }, [flow]);

  useEffect(() => {
    if (flow === null) return;
    const drawn = new Map<string, ProjectRef>(
      (JSON.parse(stopKeys) as ReadonlyArray<ProjectRef>).map((project) => [
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
      if (!releases.has(key)) releases.set(key, flow.deployments.demand(project));
    }
  }, [flow, stopKeys]);

  return stops;
}

/**
 * What one stop runs service by service (§4.7), unreduced: its runtime services, each with its own
 * deployment. Demands the stop for as long as the calling surface draws it, whoever else does, and
 * reads it again once per task however often the store publishes. `null` reads nothing.
 */
export function useStopServices(project: ProjectRef | null): Shown<ReadonlyArray<StopService>> {
  const flow = useAccountFlow();
  const projectKey = project === null ? null : JSON.stringify(project);

  // Subscribed before the stop is demanded, so what a demand publishes at once is heard.
  const subscribe = useFlowSubscription(flow);
  const snapshot = useMemo(() => stopServicesSnapshot(flow, projectKey), [flow, projectKey]);
  const services = useSyncExternalStore(subscribe, snapshot, snapshot);

  useEffect(() => {
    if (flow === null || projectKey === null) return;
    return flow.deployments.demand(JSON.parse(projectKey) as ProjectRef);
  }, [flow, projectKey]);

  return services;
}

/** One stop's services as of the stores' counter: one answer per counter value. */
function stopServicesSnapshot(
  flow: AccountFlow | null,
  projectKey: string | null,
): () => Shown<ReadonlyArray<StopService>> {
  if (flow === null || projectKey === null) return () => UNBOUND;
  const project = JSON.parse(projectKey) as ProjectRef;
  let read: {
    readonly version: number;
    readonly services: Shown<ReadonlyArray<StopService>>;
  } | null = null;
  return () => {
    const version = flowVersionOf(flow);
    if (read === null || read.version !== version) {
      read = { version, services: flow.deployments.stop(project) };
    }
    return read.services;
  };
}
