import type { ZeropsDataState } from "./state.ts";
import type {
  CollectionRead,
  CommandAttemptRef,
  CommandAttemptState,
  DesiredInterestState,
  EntityKnowledge,
  EntityRead,
  HistoryReadView,
  HistorySeriesKey,
  InterestState,
  EntityQueryDescriptor,
  ProjectKey,
  ProjectRecord,
  ProjectRef,
  ProjectTopologyRead,
  QueryState,
  ServiceKey,
  ServiceRecord,
  ServiceRef,
  UsageRead,
  ViewObservation,
} from "./types.ts";
import { historySeriesKeyOf, projectKeyOf, queryKeyOf, serviceKeyOf } from "./types.ts";

type Interests = ZeropsDataState["interests"];
type InterestsOfView = Pick<ViewObservation, "required" | "optional">;

/**
 * The interests one view observes, by project: a project's own interests and those of no project
 * (an organization's inventory), in the order the state holds them. Every project's view is read on
 * each publication, so the interests are indexed once per interests map, not once per project.
 */
interface InterestIndex {
  /** In state order. */
  readonly interests: ReadonlyArray<DesiredInterestState>;
  /** The positions of each project's own interests, and under `null` those of no project. */
  readonly positions: ReadonlyMap<ProjectKey | null, ReadonlyArray<number>>;
  /** The views already read, by project key; `undefined` for the view of every interest. */
  readonly views: Map<ProjectKey | undefined, InterestsOfView>;
}

const interestIndexes = new WeakMap<Interests, InterestIndex>();

function interestIndexOf(interests: Interests): InterestIndex {
  const held = interestIndexes.get(interests);
  if (held !== undefined) return held;
  const ordered: Array<DesiredInterestState> = [];
  const positions = new Map<ProjectKey | null, Array<number>>();
  for (const desired of interests.values()) {
    const descriptor = desired.descriptor;
    const key = "project" in descriptor ? projectKeyOf(descriptor.project) : null;
    const position = ordered.length;
    ordered.push(desired);
    const atKey = positions.get(key);
    if (atKey === undefined) positions.set(key, [position]);
    else atKey.push(position);
  }
  const index: InterestIndex = { interests: ordered, positions, views: new Map() };
  interestIndexes.set(interests, index);
  return index;
}

function interestsOfView(index: InterestIndex, project: ProjectKey | undefined): InterestsOfView {
  const held = index.views.get(project);
  if (held !== undefined) return held;
  const own = project === undefined ? [] : (index.positions.get(project) ?? []);
  const unscoped = project === undefined ? [] : (index.positions.get(null) ?? []);
  const required: InterestState[] = [];
  const optional: InterestState[] = [];
  const take = (position: number) => {
    const desired = index.interests[position]!;
    (desired.required ? required : optional).push(desired.interest);
  };
  if (project === undefined) {
    index.interests.forEach((_, position) => take(position));
  } else {
    // Both position lists are ascending: merged, they keep the state's order.
    let o = 0;
    let u = 0;
    while (o < own.length || u < unscoped.length) {
      if (u >= unscoped.length || (o < own.length && own[o]! < unscoped[u]!)) take(own[o++]!);
      else take(unscoped[u++]!);
    }
  }
  const view = { required, optional };
  index.views.set(project, view);
  return view;
}

const observationOf = (state: ZeropsDataState, project?: ProjectRef): ViewObservation => ({
  ...interestsOfView(
    interestIndexOf(state.interests),
    project === undefined ? undefined : projectKeyOf(project),
  ),
  access: state.access,
});

const runtimeViews = new WeakMap<Interests, Map<ProjectKey, InterestsOfView>>();

/**
 * A project's service listing depends on its service stream alone. Metadata, history and metrics
 * can fail independently after a deploy; their failure must not stale a current runtime answer.
 */
function runtimeObservationOf(state: ZeropsDataState, project: ProjectRef): ViewObservation {
  let views = runtimeViews.get(state.interests);
  if (views === undefined) {
    views = new Map();
    runtimeViews.set(state.interests, views);
  }
  const key = projectKeyOf(project);
  let view = views.get(key);
  if (view === undefined) {
    const index = interestIndexOf(state.interests);
    const services: InterestState[] = [];
    const optionalServices: InterestState[] = [];
    for (const position of index.positions.get(key) ?? []) {
      const desired = index.interests[position]!;
      const kind = desired.descriptor.kind;
      if (kind === "project-topology" || kind === "project-inventory")
        (desired.required ? services : optionalServices).push(desired.interest);
    }
    view = { required: services, optional: optionalServices };
    views.set(key, view);
  }
  return { ...view, access: state.access };
}

const projectKnowledge = (
  record: ProjectRecord | undefined,
  ref: ProjectRef,
): EntityKnowledge<ProjectRecord> => {
  if (record === undefined) return { knowledge: "unresolved", ref };
  if (record.identity.knowledge === "unavailable") {
    return {
      knowledge: "unavailable",
      ref,
      reason: record.identity.reason,
      since: record.identity.stamp,
    };
  }
  if (record.identity.knowledge === "observed" && record.lifecycle.knowledge === "observed") {
    return { knowledge: "observed", record };
  }
  return { knowledge: "unresolved", ref };
};

const serviceKnowledge = (
  record: ServiceRecord | undefined,
  ref: ServiceRef,
): EntityKnowledge<ServiceRecord> => {
  if (record === undefined) return { knowledge: "unresolved", ref };
  if (record.identity.knowledge === "unavailable") {
    return {
      knowledge: "unavailable",
      ref,
      reason: record.identity.reason,
      since: record.identity.stamp,
    };
  }
  if (record.identity.knowledge === "observed" && record.lifecycle.knowledge === "observed") {
    return { knowledge: "observed", record };
  }
  return { knowledge: "unresolved", ref };
};

export const selectProject = (
  state: ZeropsDataState,
  ref: ProjectRef,
): EntityRead<ProjectRecord> => ({
  value: projectKnowledge(state.inventory.projects.get(projectKeyOf(ref)), ref),
  observation: observationOf(state, ref),
});

export const selectService = (
  state: ZeropsDataState,
  ref: ServiceRef,
): EntityRead<ServiceRecord> => ({
  value: serviceKnowledge(state.inventory.services.get(serviceKeyOf(ref)), ref),
  observation: observationOf(state, ref.project),
});

type ServiceQuery = Extract<EntityQueryDescriptor, { readonly kind: "services-of-project" }>;

const unresolvedServiceQuery = (project: ProjectRef): QueryState<ServiceQuery> => {
  const descriptor: ServiceQuery = {
    kind: "services-of-project",
    project,
    schemaVersion: 1,
  };
  return {
    status: "unresolved",
    descriptor,
    key: queryKeyOf(descriptor),
    memberKeys: [],
    unresolvedMemberKeys: [],
    coverage: { kind: "none" },
    lastAppliedReadStartOrdinal: null,
    membershipOperations: new Map(),
  };
};

type InventoryServices = ZeropsDataState["inventory"]["services"];

/** Each project's service keys, once per service map, in the order the map holds them. */
const serviceKeyIndexes = new WeakMap<
  InventoryServices,
  ReadonlyMap<ProjectKey, ReadonlyArray<ServiceKey>>
>();

function serviceKeysOf(
  services: InventoryServices,
  project: ProjectKey,
): ReadonlyArray<ServiceKey> {
  let index = serviceKeyIndexes.get(services);
  if (index === undefined) {
    const byProject = new Map<ProjectKey, Array<ServiceKey>>();
    for (const [key, record] of services) {
      const owner = projectKeyOf(record.ref.project);
      const keys = byProject.get(owner);
      if (keys === undefined) byProject.set(owner, [key]);
      else keys.push(key);
    }
    index = byProject;
    serviceKeyIndexes.set(services, index);
  }
  return index.get(project) ?? [];
}

/**
 * One project's services: its slice of the organization's services read (DESIGN §4.1), whose
 * state says whether they are known. A member the read names but has not resolved yet is the
 * project's when its ref says so.
 */
export function selectServicesOf(
  state: ZeropsDataState,
  project: ProjectRef,
): CollectionRead<ServiceRecord> {
  const projectKey = projectKeyOf(project);
  const descriptor: ServiceQuery = {
    kind: "services-of-project",
    project: project,
    schemaVersion: 1,
  };
  const query =
    (state.inventory.queries.get(queryKeyOf(descriptor)) as QueryState<ServiceQuery> | undefined) ??
    unresolvedServiceQuery(project);
  const relationshipKeys = new Set<ServiceKey>();
  for (const key of query.memberKeys) {
    const ref = state.inventory.memberRefs.get(key);
    if (ref?.kind === "service" && projectKeyOf(ref.project) === projectKey)
      relationshipKeys.add(key as ServiceKey);
  }
  for (const key of serviceKeysOf(state.inventory.services, projectKey)) relationshipKeys.add(key);
  return {
    value: [...relationshipKeys].flatMap((key) => {
      const record = state.inventory.services.get(key);
      const ref = state.inventory.memberRefs.get(key);
      if (record !== undefined) return [serviceKnowledge(record, record.ref)];
      return ref?.kind === "service" ? [{ knowledge: "unresolved" as const, ref }] : [];
    }),
    query,
    observation: runtimeObservationOf(state, project),
    project,
  };
}

const sumPair = (pairs: ReadonlyArray<{ readonly used: number; readonly limit: number } | null>) =>
  pairs.every((pair) => pair !== null)
    ? pairs.reduce(
        (total, pair) => ({
          used: total.used + (pair?.used ?? 0),
          limit: total.limit + (pair?.limit ?? 0),
        }),
        { used: 0, limit: 0 },
      )
    : null;

export function selectUsage(state: ZeropsDataState, service: ServiceRef): UsageRead {
  const query = state.observability.current.get(
    queryKeyOf({
      kind: "current-metrics-of-project",
      project: service.project,
      groupBy: "containerId",
      schemaVersion: 1,
    }),
  );
  const samples = [...(query?.samples.values() ?? [])].filter(
    (sample) => serviceKeyOf(sample.key.service) === serviceKeyOf(service),
  );
  const coverage = query?.coverage ?? { kind: "none" as const };
  // Shared services report cpu=0/0 and their allocation in vCpu. Either field
  // may be omitted; a sample with neither remains unknown.
  const cpu = sumPair(
    samples.map((sample) =>
      sample.cpu === null && sample.virtualCpu === null
        ? null
        : {
            used: (sample.cpu?.used ?? 0) + (sample.virtualCpu?.used ?? 0),
            limit: (sample.cpu?.limit ?? 0) + (sample.virtualCpu?.limit ?? 0),
          },
    ),
  );
  const memoryGb = sumPair(samples.map((sample) => sample.memoryGb));
  const diskGb = sumPair(samples.map((sample) => sample.diskGb));
  return {
    value:
      samples.length > 0 && cpu !== null && memoryGb !== null && diskGb !== null
        ? { containers: samples.length, cpu, memoryGb, diskGb }
        : null,
    coverage,
    observation: observationOf(state, service.project),
  };
}

export function selectHistory(state: ZeropsDataState, key: HistorySeriesKey): HistoryReadView {
  const series = state.observability.history.get(historySeriesKeyOf(key)) ?? {
    status: "unresolved" as const,
    key,
    buckets: new Map(),
    coverage: { kind: "none" as const },
  };
  return { series, observation: observationOf(state, key.service.project) };
}

export function selectTopology(state: ZeropsDataState, project: ProjectRef): ProjectTopologyRead {
  const projectRead = selectProject(state, project);
  const services = selectServicesOf(state, project);
  return {
    project: projectRead,
    services,
    observation: observationOf(state, project),
  };
}

export const selectCommandAttempt = (
  state: ZeropsDataState,
  attempt: CommandAttemptRef,
): CommandAttemptState | null => {
  if (
    attempt.accountEpoch !== state.scope.epoch ||
    attempt.account.apiOrigin !== state.scope.account.apiOrigin ||
    attempt.account.accountId !== state.scope.account.accountId
  )
    return null;
  return state.commands.get(attempt.attemptId) ?? null;
};
