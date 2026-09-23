import {
  connectionCatalogDisplayUrl,
  type EnvironmentConnectionPresentation,
} from "@t3tools/client-runtime/connection";
import type { ZeropsService, ZeropsStatHistoryItem } from "@t3tools/client-runtime/zerops";
import {
  knownProjectsOf,
  knownServicesOf,
  processRecordToActivityProcess,
  projectKeyOf,
  projectRecordToZeropsProject,
  projectsSourceOf,
  serviceRecordToZeropsService,
  servicesSourceOf,
  type CollectionRead,
  type HistoryReadView,
  type ManagedZeropsDataRuntime,
  type MetricWindow,
  type OrganizationRef,
  type ProjectRecord,
  type ProjectRef,
  type ProjectTopologyRead,
  type ServiceRecord,
  type ServiceRef,
  type UsageRead,
} from "@t3tools/client-runtime/zerops/data";
import type { RegistrationRecord } from "@t3tools/client-runtime/zerops/environments";
import type { Known, Shown } from "@t3tools/client-runtime/zerops/knowledge";
import {
  admittedOnly,
  heldCandidates,
  selectCandidates,
  type CandidateRow,
} from "@t3tools/client-runtime/zerops/projections";
import { projectTopology, type ZeropsTopologyView } from "@t3tools/client-runtime/zerops/topology";
import type { EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { registeredZeropsOrigins, rowEnvironment } from "../zerops/environmentOrigins";
import { createZeropsFeedAtoms } from "../zerops/feeds";
import { findInventoryProjectRef, type InventoryProjection } from "../zerops/inventoryContext";
import { zeropsKnowledgeArraysEqual } from "../zerops/zeropsDataContext";
import type {
  ZeropsOrganizationStatus,
  ZeropsSessionStatus,
} from "../zerops/ZeropsSessionProvider";
import { environmentPresentations } from "./presentation";

export const zeropsFeeds = createZeropsFeedAtoms(connectionAtomRuntime);

/**
 * `deriveZeropsThreadModel`, re-exported from thread state alongside the
 * other Zerops derivations this module owns. Not an Effect `Atom` in its
 * own right — the model has no subscription to hold: it is a pure
 * projection of activities (already local component state) and the
 * lifecycle feed (`useZeropsLifecycle`), so the caller memoizes it on
 * reference identity the same way it memoizes every other thread
 * derivation (`useMemo`), rather than this module owning a second copy of
 * that state behind an atom.
 */
export { deriveZeropsThreadModel } from "@t3tools/client-runtime/zerops/model";

/**
 * The account's platform-data runtime, published by `ZeropsInventoryProvider` into the account's
 * atom registry, which starts over when the account closes: null before this account's runtime
 * stands. The three published atoms are kept alive: what is published holds until the account's
 * registry is disposed, whether or not anything reads it meanwhile. Every derivation below reads the platform through it, so none holds a value of its own
 * that could outlive the account.
 */
export const zeropsDataRuntimeAtom = Atom.make<ManagedZeropsDataRuntime | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("zerops:data-runtime"),
);

/** The Zerops session as the account's product last saw it, and the organization it shows. */
export interface ZeropsSessionView {
  readonly status: ZeropsSessionStatus;
  readonly organizationStatus: ZeropsOrganizationStatus;
  readonly activeOrganization: OrganizationRef | null;
}

/** Published beside the runtime; null before the account's product is mounted. */
export const zeropsSessionAtom = Atom.make<ZeropsSessionView | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("zerops:session"),
);

/** The account's inventory as `ZeropsInventoryProvider` projects it; null before its first grant. */
export const zeropsInventoryAtom = Atom.make<InventoryProjection | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("zerops:inventory"),
);

/** One environment this renderer registered, as the connection catalog presents it. */
export interface ZeropsEnvironmentEntry {
  readonly environmentId: EnvironmentId;
  readonly displayUrl: string | null;
  readonly connection: EnvironmentConnectionPresentation;
  /**
   * The Zerops project its own descriptor states (`zerops.projectId`): null for a server that runs
   * outside Zerops, undefined while its server has not answered.
   */
  readonly zeropsProjectId: string | null | undefined;
}

/** Every registered environment: the environments atom the listing, names and Mates join. */
export const zeropsEnvironmentsAtom = Atom.make((get): ReadonlyArray<ZeropsEnvironmentEntry> =>
  [...get(environmentPresentations.presentationsAtom)].map(([environmentId, presentation]) => ({
    environmentId,
    displayUrl: connectionCatalogDisplayUrl(presentation.entry),
    connection: presentation.connection,
    zeropsProjectId:
      presentation.serverConfig === null
        ? undefined
        : (presentation.serverConfig.environment.zerops?.projectId ?? null),
  })),
).pipe(Atom.withLabel("zerops:environments"));

function sameMembers<Record extends ProjectRecord | ServiceRecord>(
  left: CollectionRead<Record>,
  right: CollectionRead<Record>,
): boolean {
  return (
    left.query === right.query &&
    zeropsKnowledgeArraysEqual(left.value, right.value) &&
    left.observation.access === right.observation.access
  );
}

/**
 * Whether two reads of the organization's projects are the same knowledge:
 * the same query, members and access, and the same interest they are as
 * current as. That interest failing leaves the query as it was, and is a new
 * read; any other interest the account holds changing is not.
 */
export function sameProjectsRead(
  left: CollectionRead<ProjectRecord>,
  right: CollectionRead<ProjectRecord>,
): boolean {
  return sameMembers(left, right) && projectsSourceOf(left) === projectsSourceOf(right);
}

/** Whether two reads of a project's services are the same knowledge, like `sameProjectsRead`. */
export function sameServicesRead(
  left: CollectionRead<ServiceRecord>,
  right: CollectionRead<ServiceRecord>,
): boolean {
  return sameMembers(left, right) && servicesSourceOf(left) === servicesSourceOf(right);
}

/** A read, and the moment this client saw it change. */
interface StampedRead<Read> {
  readonly read: Read;
  readonly atMs: number;
}

const stampedReads = new WeakMap<Atom.Atom<unknown>, Atom.Atom<StampedRead<unknown>>>();

/**
 * Holds a read until it changes, stamped with the moment it did. The stamp is
 * what `known.ts` dates a read with no value yet by (when it failed, or began
 * to recover); taken here, it never ticks, so no clock re-derives the rows and
 * hands every consumer a new array of the same candidates. One per read.
 */
function stampedRead<Read>(
  source: Atom.Atom<Read>,
  same: (left: Read, right: Read) => boolean,
): Atom.Atom<StampedRead<Read>> {
  const held = stampedReads.get(source);
  if (held !== undefined) return held as Atom.Atom<StampedRead<Read>>;
  let previous: StampedRead<Read> | undefined;
  const stamped = Atom.make((get) => {
    const read = get(source);
    if (previous !== undefined && same(previous.read, read)) return previous;
    previous = { read, atMs: Date.now() };
    return previous;
  });
  stampedReads.set(source, stamped);
  return stamped;
}

const UNREAD: Known<never> = { state: "unread", waitingFor: null };

/**
 * The active organization's candidate rows (DESIGN §2.B B4) over the runtime's reads of its
 * projects and of each admitted project's services: unread until the account's product has
 * published a signed-in session with an organization chosen, its runtime and its inventory.
 * Only projects the inventory admits are read, and withholding is applied here, at the read
 * (§3.1, §4.2 G12): withheld whole while the account's access lapses, and without the rows of a
 * project the grant withholds alone, which leaves the listing partial. Derived, so nothing it
 * held outlives the account.
 */
export const candidateRowsAtom = Atom.make((get): Shown<ReadonlyArray<CandidateRow>> => {
  const session = get(zeropsSessionAtom);
  const runtime = get(zeropsDataRuntimeAtom);
  const inventory = get(zeropsInventoryAtom);
  if (
    session === null ||
    runtime === null ||
    inventory === null ||
    session.status !== "signed-in" ||
    session.organizationStatus !== "selected" ||
    session.activeOrganization === null
  ) {
    return UNREAD;
  }
  if (inventory.account.kind === "withheld") {
    return { state: "withheld", reason: inventory.account.reason, cause: inventory.account.cause };
  }
  const projectsRead = get(
    stampedRead(runtime.reads.projectsOf(session.activeOrganization), sameProjectsRead),
  );
  const projects = admittedOnly(
    knownProjectsOf(projectsRead.read, projectsRead.atMs),
    (record) =>
      inventory.projectRefs.has(projectKeyOf(record.ref)) &&
      inventory.authority.get(projectKeyOf(record.ref))?.kind !== "withheld",
  );
  return selectCandidates(projects, (ref) => {
    const servicesRead = get(stampedRead(runtime.reads.servicesOf(ref), sameServicesRead));
    return knownServicesOf(servicesRead.read, servicesRead.atMs);
  });
}).pipe(Atom.withLabel("zerops:candidate-rows"));

/**
 * The derived half of the environment → project index (DESIGN §2.C C3): the project each
 * registered environment's descriptor states, and the one each listing row that reaches an
 * environment belongs to. A registration record is the third source (`environmentProjectRef`).
 */
export interface EnvironmentProjects {
  readonly described: ReadonlyMap<EnvironmentId, string>;
  readonly listed: ReadonlyMap<EnvironmentId, string>;
}

export const environmentProjectsAtom = Atom.make((get): EnvironmentProjects => {
  const environments = get(zeropsEnvironmentsAtom);
  const described = new Map<EnvironmentId, string>();
  for (const environment of environments) {
    if (typeof environment.zeropsProjectId === "string")
      described.set(environment.environmentId, environment.zeropsProjectId);
  }
  const registered = registeredZeropsOrigins(environments);
  const listed = new Map<EnvironmentId, string>();
  for (const row of heldCandidates(get(candidateRowsAtom)).rows) {
    const environmentId = rowEnvironment(row, registered);
    if (environmentId !== undefined && !listed.has(environmentId))
      listed.set(environmentId, row.project.id);
  }
  return { described, listed };
}).pipe(Atom.withLabel("zerops:environment-projects"));

/**
 * The project an environment belongs to (C3): its descriptor's word first, then its registration
 * record, then a listing row that reaches it — each resolved to the inventory's one operable
 * reference. Null while none of them places it in a project the inventory holds.
 */
export function environmentProjectRef(input: {
  readonly environmentId: EnvironmentId;
  readonly record: RegistrationRecord | undefined;
  readonly located: EnvironmentProjects;
  readonly inventory: Pick<InventoryProjection, "projectRefs">;
}): ProjectRef | null {
  const described = input.located.described.get(input.environmentId);
  const remembered = input.record?.projectRef ?? null;
  const listed = input.located.listed.get(input.environmentId);
  return (
    (described === undefined ? null : findInventoryProjectRef(input.inventory, described)) ??
    (remembered === null
      ? null
      : findInventoryProjectRef(input.inventory, remembered.projectId, remembered.orgId)) ??
    (listed === undefined ? null : findInventoryProjectRef(input.inventory, listed))
  );
}

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

/** The window a project's metric history is read in: the last day, by the hour. */
export const PROJECT_HISTORY_WINDOW: MetricWindow = {
  timeGroupBy: "1h",
  limit: 24,
  timeZone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
};

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

const EMPTY_USAGE_READS: ReadonlyMap<string, UsageRead> = new Map();
const EMPTY_HISTORY_READS: ReadonlyMap<string, HistoryReadView> = new Map();

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

const topologyProjects = new Map<string, ProjectRef>();

const projectTopologyFamily = Atom.family((key: string) =>
  Atom.make((get): ProjectTopologySnapshot => {
    const runtime = get(zeropsDataRuntimeAtom);
    const inventory = get(zeropsInventoryAtom);
    const project = topologyProjects.get(key)!;
    // Withheld at the read while the grant withholds the project (§4.2 G12): nothing of it shows.
    if (
      runtime === null ||
      inventory === null ||
      inventory.account.kind === "withheld" ||
      inventory.authority.get(key)?.kind === "withheld"
    ) {
      return EMPTY_PROJECT_TOPOLOGY_SNAPSHOT;
    }
    const topology = get(runtime.reads.topology(project));
    const services = topology.services.value.flatMap((knowledge): ReadonlyArray<ServiceRef> =>
      knowledge.knowledge === "observed" ? [knowledge.record.ref] : [],
    );
    const usage = new Map(
      services.map((service) => [service.serviceId, get(runtime.reads.usage(service))] as const),
    );
    const history = new Map(
      services.map(
        (service) =>
          [
            service.serviceId,
            get(
              runtime.reads.history({
                service,
                groupBy: "serviceStackId",
                window: PROJECT_HISTORY_WINDOW,
                schemaVersion: 1,
              }),
            ),
          ] as const,
      ),
    );
    return projectTopologySnapshotFromRead(topology, usage, history);
  }).pipe(Atom.withLabel(`zerops:project-topology:${key}`)),
);

/**
 * A project's topology (DESIGN §2.C C11): derived from the runtime's topology, usage and history
 * reads, so a pushed facet reaches every reader with nobody copying it. Protected roots read it
 * through `useZeropsTopology`; `useProjectTopology` is where a host demands it.
 */
export function projectTopologyAtom(project: ProjectRef): Atom.Atom<ProjectTopologySnapshot> {
  const key = projectKeyOf(project);
  if (!topologyProjects.has(key)) topologyProjects.set(key, project);
  return projectTopologyFamily(key);
}
