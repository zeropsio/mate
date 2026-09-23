/**
 * Hosts the container store (DESIGN §4.5) in today's account tree: one per account epoch, beside
 * the exchange driver. Every Mate container's level, every probe of one, and our own restarts and
 * updates live there; surfaces read it through `useZeropsContainers`, and verbs tell it what they
 * started through `intendContainer`.
 *
 * An interim host: the account runtime's post-grant stage constructs the store (3.4).
 */
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { readZeropsContainer } from "@t3tools/client-runtime/zerops/containerHealth";
import { ZeropsServiceId, type ProjectRef } from "@t3tools/client-runtime/zerops/data";
import {
  makeContainerStore,
  systemExchangeClock,
  type ContainerMachine,
  type ContainerStore,
  type ContainerTarget,
  type IntentRequest,
  type MateFlag,
  type ProbeReading,
  type TargetKey,
} from "@t3tools/client-runtime/zerops/environments";
import type { ZeropsContainerHealth } from "@t3tools/client-runtime/zerops/provisioning";
import * as Effect from "effect/Effect";
import { useEffect, useMemo, useSyncExternalStore } from "react";

import { accountStorageKey, currentAccountEpoch, onAccountLifetimeClose } from "./accountLifetime";
import { findInventoryProjectRef, type Inventory } from "./inventoryContext";
import { readZeropsResourceOnce } from "./useZeropsDeployedVersion";
import {
  useZeropsAtomSelections,
  useZeropsData,
  type ZeropsDataContextValue,
} from "./zeropsDataContext";

// ── One store per account epoch ──────────────────────────────────────────────────────────────

/** What the store's Mate flag port reads through: the newest the shell committed. */
export interface ContainerInputs {
  readonly runtime: ZeropsDataContextValue["runtime"];
  readonly inventory: Inventory;
  readonly clientId: string | undefined;
}

let hosted: {
  readonly epoch: number;
  readonly store: ContainerStore;
  inputs: ContainerInputs | null;
} | null = null;

onAccountLifetimeClose(() => {
  hosted?.store.dispose();
  hosted = null;
});

/** This tab's intents, under the account's key (C8); unreadable storage keeps none. */
const intentStorage = {
  read: (): string | null => {
    const key = accountStorageKey("container-intents.v1");
    try {
      return key === null ? null : window.sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  write: (value: string | null): void => {
    const key = accountStorageKey("container-intents.v1");
    if (key === null) return;
    try {
      if (value === null) window.sessionStorage.removeItem(key);
      else window.sessionStorage.setItem(key, value);
    } catch {
      // A storage policy that refuses the write leaves the intent in memory only.
    }
  },
};

/** `ZCP_MATE_ENABLED` for a target's service, read in the account's scope. */
async function readMateFlag(inputs: ContainerInputs | null, key: TargetKey): Promise<MateFlag> {
  const [projectId, serviceId] = key.split(":");
  if (inputs === null || projectId === undefined || serviceId === undefined) return "unknown";
  const project: ProjectRef | null = findInventoryProjectRef(
    inputs.inventory,
    projectId,
    inputs.clientId,
  );
  if (project === null) return "unknown";
  const value = await readZeropsResourceOnce(inputs.runtime.resources, {
    kind: "service-mate-flag",
    account: inputs.runtime.scope,
    service: { kind: "service", project, serviceId: ZeropsServiceId.make(serviceId) },
  });
  return value === undefined ? "unknown" : value.enabled;
}

export function hostContainerStore(): ContainerStore {
  const epoch = currentAccountEpoch();
  if (hosted !== null && hosted.epoch === epoch) return hosted.store;
  hosted?.store.dispose();
  const host: NonNullable<typeof hosted> = {
    epoch,
    inputs: null,
    store: makeContainerStore({
      clock: systemExchangeClock,
      probe: (origin, signal) =>
        readZeropsContainer(origin, globalThis.fetch.bind(globalThis), signal),
      readMateFlag: (key) => readMateFlag(host.inputs, key),
      intents: intentStorage,
    }),
  };
  hosted = host;
  return host.store;
}

export function bindContainerInputs(inputs: ContainerInputs): void {
  if (hosted !== null) hosted.inputs = inputs;
}

/** Our verb was accepted for this target: its container shows it until a read fact settles it. */
export function intendContainer(key: TargetKey, intent: IntentRequest): void {
  hosted?.store.intend(key, intent);
}

/** The reading of a probe of this origin started from now on, through the tab's one pool. */
export function nextContainerReading(origin: string): Promise<ProbeReading> {
  return hostContainerStore().next(origin);
}

/** Each inventory candidate as the store's target: its origin and its platform statuses. */
export function containerTargetsOf(
  candidates: ReadonlyArray<ZeropsCandidate>,
): ReadonlyArray<ContainerTarget> {
  return candidates.map((candidate) => ({
    key: candidate.key,
    origin: candidate.containerOrigin ?? null,
    platform: { project: candidate.project.status, service: candidate.service?.status ?? null },
  }));
}

// ── Processes ────────────────────────────────────────────────────────────────────────────────

/**
 * The platform's processes for every booting target's project: a boot's cap runs from the moment
 * the last process ends (§4.5), so a long restart or start is never overdue while it runs.
 */
export function useContainerProcesses(
  store: ContainerStore,
  candidates: ReadonlyArray<ZeropsCandidate>,
  inventory: Inventory,
  clientId: string | undefined,
): void {
  const { runtime } = useZeropsData();
  const machines = useSyncExternalStore(store.subscribe, store.machines);
  const booting = [...machines]
    .filter(([, machine]) => machine.state.level === "booting")
    .map(([key]) => key);
  const bootingKey = booting.sort().join(",");

  const projectRefs = useMemo(() => {
    const byProjectId = new Map<string, ProjectRef>();
    for (const key of bootingKey === "" ? [] : bootingKey.split(",")) {
      const projectId = key.split(":")[0];
      if (projectId === undefined || byProjectId.has(projectId)) continue;
      const ref = findInventoryProjectRef(inventory, projectId, clientId);
      if (ref !== null) byProjectId.set(projectId, ref);
    }
    return byProjectId;
  }, [bootingKey, inventory, clientId]);
  const projectIdsKey = [...projectRefs.keys()].sort().join(",");

  useEffect(() => {
    const controllers = [...projectRefs.values()].map((project) => {
      const controller = new AbortController();
      void Effect.runPromise(
        Effect.scoped(
          runtime.acquire({ kind: "project-activity", project }).pipe(Effect.andThen(Effect.never)),
        ),
        { signal: controller.signal },
      ).catch(() => undefined);
      return controller;
    });
    return () => {
      for (const controller of controllers) controller.abort();
    };
    // `projectIdsKey` is `projectRefs`'s identity; depending on the map itself would tear the
    // subscriptions down and rebuild them every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectIdsKey, runtime]);

  const activityEntries = useMemo(
    () =>
      [...projectRefs.entries()].map(
        ([projectId, ref]) => [projectId, runtime.reads.activity(ref)] as const,
      ),
    [projectRefs, runtime.reads],
  );
  const activitySelections = useZeropsAtomSelections(activityEntries);

  useEffect(() => {
    for (const candidate of candidates) {
      const activity = activitySelections.get(candidate.project.id);
      if (activity === undefined) continue;
      const running = activity.running.value.some((entry) => {
        if (entry.knowledge !== "observed") return false;
        const identity = entry.record.identity;
        if (identity.knowledge !== "observed") return false;
        return (
          candidate.service === undefined ||
          (identity.fields.serviceIds ?? []).includes(ZeropsServiceId.make(candidate.service.id))
        );
      });
      store.process(candidate.key, running);
    }
  }, [activitySelections, candidates, store]);
}

// ── What surfaces read ───────────────────────────────────────────────────────────────────────

export interface ContainerSnapshot {
  /** The row vocabulary of each target's container; absent until something was read. */
  readonly health: ReadonlyMap<TargetKey, ZeropsContainerHealth>;
  /** The server version each target's descriptor last reported. */
  readonly serverVersions: ReadonlyMap<TargetKey, string>;
  /** `ZCP_MATE_ENABLED` as read for a target that predates Mate. */
  readonly mateFlags: ReadonlyMap<TargetKey, MateFlag>;
}

/**
 * The container machine in the rows' words: `stalled` is a boot past its cap, a restart or an
 * update of ours is still coming up, and a verdict that needs an action predates Mate.
 */
export function containerHealthOf(machine: ContainerMachine): ZeropsContainerHealth | undefined {
  const reading = machine.reading?.reading.kind;
  switch (machine.state.level) {
    case "ready":
      return "ready";
    case "booting":
      if (machine.overdue) return "stalled";
      return reading === "unreachable" ? "unreachable" : "initializing";
    case "restarting":
    case "updating":
      return machine.overdue ? "stalled" : "initializing";
    case "needs-enable":
    case "needs-update":
    case "not-yet-available":
      return "predates-mate";
    case "unknown":
    case "creating":
    case "provisioning":
    case "inactive":
      return reading;
  }
}

export function containerSnapshotOf(
  machines: ReadonlyMap<TargetKey, ContainerMachine>,
): ContainerSnapshot {
  const health = new Map<TargetKey, ZeropsContainerHealth>();
  const serverVersions = new Map<TargetKey, string>();
  const mateFlags = new Map<TargetKey, MateFlag>();
  for (const [key, machine] of machines) {
    const verdict = containerHealthOf(machine);
    if (verdict !== undefined) health.set(key, verdict);
    const reading = machine.reading?.reading;
    if (reading?.kind === "ready") serverVersions.set(key, reading.descriptor.serverVersion);
    if (machine.mateFlag !== null) mateFlags.set(key, machine.mateFlag);
  }
  return { health, serverVersions, mateFlags };
}

/** Every Mate container of the account, as the container store holds it now. */
export function useZeropsContainers(): ContainerSnapshot {
  const store = hostContainerStore();
  const machines = useSyncExternalStore(store.subscribe, store.machines);
  return useMemo(() => containerSnapshotOf(machines), [machines]);
}
