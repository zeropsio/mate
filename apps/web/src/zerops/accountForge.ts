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
  checkoutInvalidations,
  envelopeInvalidations,
  groupFlow,
  groupFlowFacts,
  groupFlowInputs,
  groupFlowStops,
  stopDeploymentOf,
  unboundGroupFlowInputs,
  type Deployment,
  type DeploymentStore,
  type EnvelopeServices,
  type FlowAttempt,
  type FlowCommand,
  type ForgeRepository,
  type GroupFlow,
  type GroupFlowSource,
} from "@t3tools/client-runtime/zerops/flow";
import { projectKeyOf, type ProjectRef } from "@t3tools/client-runtime/zerops/data";
import type { ForgeFact, ForgePriority } from "@t3tools/client-runtime/zerops/forge";
import type { GitCheckoutState } from "@t3tools/client-runtime/zerops";
import type { Shown } from "@t3tools/client-runtime/zerops/knowledge";
import type { ZeropsStateEnvelope } from "@t3tools/contracts";
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";

import { randomUUID } from "../lib/utils";
import { bindAccountGiteaSessions } from "./accountGiteaSessions";
import { invalidateZerops } from "./accountInvalidations";
import { onAccountLifetimeClose } from "./accountLifetime";
import { batchedPerTask } from "./taskBatch";
import { useNowMs } from "./useNowMs";

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

/**
 * One checkout's VCS statuses as pushes: a status that shows commits leaving for the remote
 * re-reads its Gitea repository (§6.1). `null` while the checkout has not answered: only a status
 * it reported is compared, so its first answer, or one after a refetch, is no push.
 */
export function useCheckoutPushes(
  status: GitCheckoutState | null,
  repository: ForgeRepository | null,
): void {
  const heard = useRef<GitCheckoutState | undefined>(undefined);
  useEffect(() => {
    if (status === null) return;
    for (const invalidation of checkoutInvalidations(heard.current, status, repository)) {
      invalidateZerops(invalidation);
    }
    heard.current = status;
  }, [repository, status]);
}

// ── What surfaces read ───────────────────────────────────────────────────────────────────────

/** What one group's flow is read from, and how it is weighed. */
export interface UseGroupFlowSource extends GroupFlowSource {
  readonly mayRelease: boolean;
  /** The route's group reads first, then what is on screen (§4.7 "Scheduling"). */
  readonly priority?: ForgePriority;
}

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

/** A counter the bound stores move, once per task however often they publish. */
function useFlowVersion(flow: AccountFlow | null): number {
  const subscribe = useFlowSubscription(flow);
  const snapshot = useCallback(() => flowVersionOf(flow), [flow]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
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
 * One group's flow (§4.7): demands every fact it reads from the forge and the deployment store for
 * as long as the calling surface is mounted, and answers `groupFlow` over them — read again once
 * per task however often the stores publish.
 */
export function useGroupFlow(source: UseGroupFlowSource): GroupFlow {
  const { entry, giteaOrigin, members, mayRelease, priority } = source;
  const flow = useAccountFlow();
  const version = useFlowVersion(flow);
  const nowMs = useNowMs();

  // The stores' answers as of `version`: what the group reads, and what it is read from.
  const read = useMemo(() => {
    if (flow === null) return null;
    const stores = { forge: flow.forge?.store ?? null, deployments: flow.deployments };
    const current = { entry, giteaOrigin, members };
    return {
      version,
      inputs: groupFlowInputs(stores, current),
      facts: groupFlowFacts(stores, current),
    };
  }, [entry, flow, giteaOrigin, members, version]);

  // What the group reads is demanded as what is known names more of it.
  const store = flow?.forge?.store ?? null;
  const factKeys = JSON.stringify(read?.facts ?? []);
  useEffect(() => {
    if (store === null) return;
    const releases = (JSON.parse(factKeys) as ReadonlyArray<ForgeFact>).map((fact) =>
      store.demand(fact, priority),
    );
    return () => {
      for (const release of releases) release();
    };
  }, [factKeys, priority, store]);

  useEffect(() => {
    if (flow === null) return;
    const releases = groupFlowStops({ entry, giteaOrigin, members }).map((project) =>
      flow.deployments.demand(project),
    );
    return () => {
      for (const release of releases) release();
    };
  }, [entry, flow, giteaOrigin, members]);

  return useMemo(
    () =>
      groupFlow(read?.inputs ?? unboundGroupFlowInputs({ entry, members }), { mayRelease }, nowMs),
    [entry, mayRelease, members, nowMs, read],
  );
}

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
 * One flow verb as a command attempt (§4.9): how its latest attempt on that target stands, and the
 * way to run it; `run` is `null` while the account has no forge or nothing to run.
 */
export function useFlowCommand(command: FlowCommand | null): {
  readonly attempt: FlowAttempt | null;
  readonly run: (() => Promise<FlowAttempt>) | null;
} {
  const flow = useAccountFlow();
  const commands = flow?.forge?.commands ?? null;
  const subscribe = useCallback(
    (listener: () => void) => commands?.subscribe(() => listener()) ?? (() => undefined),
    [commands],
  );
  const snapshot = useCallback(
    () => (commands === null || command === null ? null : commands.attempt(command)),
    [command, commands],
  );
  const attempt = useSyncExternalStore(subscribe, snapshot, snapshot);
  const run = useMemo(
    () => (commands === null || command === null ? null : () => commands.run(command)),
    [command, commands],
  );
  return { attempt, run };
}
