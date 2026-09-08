/** React binding from a connected Mate environment to the central Zerops read model. */
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type {
  ZeropsProject,
  ZeropsService,
  ZeropsStatHistoryItem,
} from "@t3tools/client-runtime/zerops";
import { deriveZeropsCandidates, normalizeOrigin } from "@t3tools/client-runtime/zerops/candidates";
import {
  projectRecordToZeropsProject,
  serviceRecordToZeropsService,
  processRecordToActivityProcess,
  type ManagedZeropsDataRuntime,
  type HistoryReadView,
  type MetricWindow,
  type ProjectTopologyRead,
  type RuntimeInterestDescriptor,
  type UsageRead,
} from "@t3tools/client-runtime/zerops/data";
import {
  lookupEnvironmentProjectRef,
  rememberEnvironmentProjectRef,
  type EnvironmentProjectRef,
} from "@t3tools/client-runtime/zerops/environmentProjectRef";
import { projectTopology, type ZeropsTopologyView } from "@t3tools/client-runtime/zerops/topology";
import type { EnvironmentId } from "@t3tools/contracts";
import { Atom, type AtomRegistry } from "effect/unstable/reactivity";
import { useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { appAtomRegistry } from "../rpc/atomRegistry";
import { useEnvironment } from "../state/environments";
import { projectTopologyViewAtom } from "../state/zerops";
import { findInventoryProjectRef, useZeropsInventory } from "./inventoryContext";
import { browserZeropsStorage } from "./storage";
import {
  makeZeropsAtomSelectionStore,
  useZeropsData,
  useZeropsDataInterest,
} from "./zeropsDataContext";

export type ProjectTopologyLiveness = "live" | "recovering";

export interface ProjectTopologySnapshot {
  readonly view: ZeropsTopologyView | undefined;
  readonly liveness: ProjectTopologyLiveness | undefined;
  readonly lastReadAt: number | undefined;
  readonly error: string | undefined;
}

export const EMPTY_PROJECT_TOPOLOGY_SNAPSHOT: ProjectTopologySnapshot = {
  view: undefined,
  liveness: undefined,
  lastReadAt: undefined,
  error: undefined,
};

const EMPTY_PROJECT_TOPOLOGY_READ_ATOM = Atom.make<ProjectTopologyRead | null>(null).pipe(
  Atom.withLabel("zerops:project-topology-read-empty"),
);
const EMPTY_USAGE_READS: ReadonlyMap<string, UsageRead> = new Map();

function latestObservedAt(topology: ProjectTopologyRead): number | undefined {
  const stamps: number[] = [];
  if (topology.project.value.knowledge === "observed") {
    const record = topology.project.value.record;
    if (record.identity.knowledge === "observed") stamps.push(record.identity.stamp.observedAtMs);
    if (record.lifecycle.knowledge === "observed") stamps.push(record.lifecycle.stamp.observedAtMs);
  }
  for (const knowledge of [...topology.services.value, ...topology.runningProcesses.value]) {
    if (knowledge.knowledge !== "observed") continue;
    if (knowledge.record.identity.knowledge === "observed")
      stamps.push(knowledge.record.identity.stamp.observedAtMs);
    if (knowledge.record.lifecycle.knowledge === "observed")
      stamps.push(knowledge.record.lifecycle.stamp.observedAtMs);
  }
  return stamps.length === 0 ? undefined : Math.max(...stamps);
}

export function projectTopologySnapshotFromRead(
  topology: ProjectTopologyRead,
  usageByService: ReadonlyMap<string, UsageRead> = EMPTY_USAGE_READS,
  historyByService: ReadonlyMap<string, HistoryReadView> = EMPTY_HISTORY_READS,
): ProjectTopologySnapshot {
  const required = topology.observation.required;
  const failed = required.find((interest) => interest.status === "failed");
  const liveness: ProjectTopologyLiveness =
    required.length > 0 && required.every((interest) => interest.status === "observing")
      ? "live"
      : "recovering";
  if (topology.project.value.knowledge !== "observed") {
    return {
      view: undefined,
      liveness,
      lastReadAt: latestObservedAt(topology),
      error: failed?.reason,
    };
  }
  const projectDto = projectRecordToZeropsProject(topology.project.value.record);
  if (projectDto === null)
    return { view: undefined, liveness, lastReadAt: undefined, error: failed?.reason };
  const services: ZeropsService[] = [];
  for (const knowledge of topology.services.value) {
    if (knowledge.knowledge !== "observed") continue;
    const service = serviceRecordToZeropsService(knowledge.record);
    if (service !== null) services.push(service);
  }
  const processes = topology.runningProcesses.value.flatMap((knowledge) => {
    if (knowledge.knowledge !== "observed") return [];
    const process = processRecordToActivityProcess(knowledge.record);
    return process === null ? [] : [process];
  });
  const history: ZeropsStatHistoryItem[] = [...historyByService.values()].flatMap(({ series }) =>
    [...series.buckets.values()].map((bucket) => ({
      serviceStackId: bucket.key.series.service.serviceId,
      from: bucket.key.from,
      till: bucket.key.till,
      containerCount: bucket.containers ?? 0,
      cpuUsed: bucket.cpu?.used ?? 0,
      cpuLimit: bucket.cpu?.limit ?? 0,
      vCpuUsed: bucket.virtualCpu?.used ?? 0,
      vCpuLimit: bucket.virtualCpu?.limit ?? 0,
      ramUsed: bucket.memoryGb?.used ?? 0,
      ramLimit: bucket.memoryGb?.limit ?? 0,
      diskUsed: bucket.diskGb?.used ?? 0,
      diskLimit: bucket.diskGb?.limit ?? 0,
    })),
  );
  // Native corrections can arrive out of order; chart points must remain chronological.
  history.sort((a, b) => Date.parse(a.from) - Date.parse(b.from));
  const base = projectTopology(projectDto, services, processes, undefined, history);
  let usageRead = false;
  const rows = base.services.map((row) => {
    const usage = usageByService.get(row.serviceId);
    if (usage === undefined) return row;
    if (usage.coverage.kind !== "none") usageRead = true;
    return usage.value === null
      ? row
      : {
          ...row,
          usage: {
            containers: usage.value.containers,
            cores: usage.value.cpu,
            memoryGb: usage.value.memoryGb,
            diskGb: usage.value.diskGb,
          },
        };
  });
  return {
    view: { ...base, services: rows, usageRead },
    liveness,
    lastReadAt: latestObservedAt(topology),
    error: failed?.reason,
  };
}

export function makeUsageStore(
  registry: AtomRegistry.AtomRegistry,
  runtime: ManagedZeropsDataRuntime,
  topology: ProjectTopologyRead | null,
) {
  const entries =
    topology?.services.value.flatMap((knowledge) =>
      knowledge.knowledge === "observed"
        ? ([[knowledge.record.ref.serviceId, runtime.reads.usage(knowledge.record.ref)]] as const)
        : [],
    ) ?? [];
  return makeZeropsAtomSelectionStore(registry, entries);
}

function useProjectUsageReads(
  runtime: ManagedZeropsDataRuntime,
  topology: ProjectTopologyRead | null,
): ReadonlyMap<string, UsageRead> {
  const registry = useContext(RegistryContext);
  const store = useMemo(
    () => makeUsageStore(registry, runtime, topology),
    [registry, runtime, topology],
  );
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

const EMPTY_HISTORY_READS: ReadonlyMap<string, HistoryReadView> = new Map();

export function makeHistoryStore(
  registry: AtomRegistry.AtomRegistry,
  runtime: ManagedZeropsDataRuntime,
  topology: ProjectTopologyRead | null,
  window: MetricWindow,
) {
  const entries =
    topology?.services.value.flatMap((knowledge) =>
      knowledge.knowledge === "observed"
        ? ([
            [
              knowledge.record.ref.serviceId,
              runtime.reads.history({
                service: knowledge.record.ref,
                groupBy: "serviceStackId",
                window,
                schemaVersion: 1,
              }),
            ],
          ] as const)
        : [],
    ) ?? [];
  return makeZeropsAtomSelectionStore(registry, entries);
}

function useProjectHistoryReads(
  runtime: ManagedZeropsDataRuntime,
  topology: ProjectTopologyRead | null,
  window: MetricWindow,
): ReadonlyMap<string, HistoryReadView> {
  const registry = useContext(RegistryContext);
  const store = useMemo(
    () => makeHistoryStore(registry, runtime, topology, window),
    [registry, runtime, topology, window],
  );
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

function matchProjectRef(
  displayUrl: string | null,
  projects: ReadonlyArray<ZeropsProject>,
  services: ReadonlyMap<
    string,
    { readonly status: string; readonly services?: ReadonlyArray<ZeropsService> }
  >,
): { readonly projectId: string; readonly orgId: string } | null {
  const origin = displayUrl === null ? null : normalizeOrigin(displayUrl);
  if (origin === null) return null;
  for (const project of projects) {
    const outcome = services.get(project.id);
    if (outcome?.status !== "resolved" || project.clientId === undefined) continue;
    const candidate = deriveZeropsCandidates(project, outcome.services ?? [], new Map()).find(
      (entry) =>
        entry.containerOrigin !== undefined && normalizeOrigin(entry.containerOrigin) === origin,
    );
    if (candidate !== undefined) return { projectId: project.id, orgId: project.clientId };
  }
  return null;
}

export function useProjectTopology(environmentId: EnvironmentId | null): ProjectTopologySnapshot {
  const { runtime } = useZeropsData();
  const inventory = useZeropsInventory();
  const environment = useEnvironment(environmentId);
  const [remembered, setRemembered] = useState<EnvironmentProjectRef | undefined>(undefined);

  useEffect(() => {
    if (environmentId === null) {
      setRemembered(undefined);
      return;
    }
    let cancelled = false;
    void lookupEnvironmentProjectRef(browserZeropsStorage, environmentId).then(async (stored) => {
      if (cancelled) return;
      if (
        stored !== undefined &&
        findInventoryProjectRef(inventory, stored.projectId, stored.orgId) !== null
      ) {
        setRemembered(stored);
        return;
      }
      const matched = matchProjectRef(
        environment?.displayUrl ?? null,
        inventory.projects,
        inventory.services,
      );
      if (matched === null) {
        setRemembered(undefined);
        return;
      }
      await rememberEnvironmentProjectRef(browserZeropsStorage, environmentId, {
        ...matched,
        source: "match",
      });
      if (!cancelled) setRemembered({ ...matched, source: "match", learnedAt: Date.now() });
    });
    return () => {
      cancelled = true;
    };
  }, [
    environment?.displayUrl,
    environmentId,
    inventory.projectRefs,
    inventory.projects,
    inventory.services,
  ]);

  const project =
    remembered === undefined
      ? null
      : findInventoryProjectRef(inventory, remembered.projectId, remembered.orgId);
  const topologyDescriptor = useMemo<RuntimeInterestDescriptor | null>(
    () =>
      project === null ? null : { kind: "project-topology", project, includeCurrentMetrics: false },
    [project],
  );
  const metricsDescriptor = useMemo<RuntimeInterestDescriptor | null>(
    () => (project === null ? null : { kind: "project-current-metrics", project }),
    [project],
  );
  const historyWindow = useMemo<MetricWindow>(
    () => ({
      timeGroupBy: "1h",
      limit: 24,
      timeZone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
    }),
    [],
  );
  const historyDescriptor = useMemo<RuntimeInterestDescriptor | null>(
    () =>
      project === null ? null : { kind: "project-metric-history", project, window: historyWindow },
    [project, historyWindow],
  );
  useZeropsDataInterest(topologyDescriptor);
  useZeropsDataInterest(metricsDescriptor);
  useZeropsDataInterest(historyDescriptor);

  const topologyAtom = useMemo(
    () => (project === null ? EMPTY_PROJECT_TOPOLOGY_READ_ATOM : runtime.reads.topology(project)),
    [project, runtime],
  );
  const topology = useAtomValue(topologyAtom);
  const usageByService = useProjectUsageReads(runtime, topology);
  const historyByService = useProjectHistoryReads(runtime, topology, historyWindow);

  const snapshot = useMemo(
    () =>
      topology === null
        ? EMPTY_PROJECT_TOPOLOGY_SNAPSHOT
        : projectTopologySnapshotFromRead(topology, usageByService, historyByService),
    [topology, usageByService, historyByService],
  );
  useEffect(() => {
    if (environmentId !== null)
      appAtomRegistry.set(projectTopologyViewAtom(environmentId), snapshot);
  }, [environmentId, snapshot]);
  return snapshot;
}
