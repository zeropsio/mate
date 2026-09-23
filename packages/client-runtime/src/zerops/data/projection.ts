import { isRunningProcess, isTerminalProcess } from "./activity.ts";
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
  OperationProgressView,
  OrganizationRef,
  ProcessRecord,
  ProjectActivityRead,
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
import {
  historySeriesKeyOf,
  processKeyOf,
  projectKeyOf,
  queryKeyOf,
  serviceKeyOf,
} from "./types.ts";

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

const processKnowledge = (
  record: ProcessRecord | undefined,
  ref: ProcessRecord["ref"],
): EntityKnowledge<ProcessRecord> => {
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

type ProjectQuery = Extract<EntityQueryDescriptor, { readonly kind: "projects-of-organization" }>;
type ServiceQuery = Extract<EntityQueryDescriptor, { readonly kind: "services-of-project" }>;
type RunningQuery = Extract<
  EntityQueryDescriptor,
  { readonly kind: "running-processes-of-project" }
>;

const unresolvedProjectQuery = (
  organization: OrganizationRef,
  statuses: ReadonlyArray<string> = [],
): QueryState<ProjectQuery> => {
  const descriptor: ProjectQuery = {
    kind: "projects-of-organization",
    organization,
    statuses,
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

export function selectProjectsOf(
  state: ZeropsDataState,
  organization: OrganizationRef,
  statuses: ReadonlyArray<string> = [],
): CollectionRead<ProjectRecord> {
  const descriptor: ProjectQuery = {
    kind: "projects-of-organization",
    organization,
    statuses,
    schemaVersion: 1,
  };
  const query = state.inventory.queries.get(queryKeyOf(descriptor)) as
    | QueryState<ProjectQuery>
    | undefined;
  const resolved = query ?? unresolvedProjectQuery(organization, statuses);
  return {
    value: resolved.memberKeys.flatMap((key) => {
      const record = state.inventory.projects.get(key);
      const ref = state.inventory.memberRefs.get(key);
      if (record !== undefined) return [projectKnowledge(record, record.ref)];
      return ref?.kind === "project" ? [{ knowledge: "unresolved" as const, ref }] : [];
    }),
    query: resolved,
    observation: observationOf(state),
  };
}

const unresolvedServiceQuery = (project: ProjectRef): QueryState<ServiceQuery> => ({
  status: "unresolved",
  descriptor: { kind: "services-of-project", project, schemaVersion: 1 },
  key: queryKeyOf({ kind: "services-of-project", project, schemaVersion: 1 }),
  memberKeys: [],
  unresolvedMemberKeys: [],
  coverage: { kind: "none" },
  lastAppliedReadStartOrdinal: null,
  membershipOperations: new Map(),
});

type InventoryQueries = ZeropsDataState["inventory"]["queries"];
type InventoryServices = ZeropsDataState["inventory"]["services"];

/** Each project's services read, once per query map: the first one the map holds. */
const serviceQueryIndexes = new WeakMap<
  InventoryQueries,
  ReadonlyMap<ProjectKey, QueryState<ServiceQuery>>
>();

function serviceQueryOf(
  queries: InventoryQueries,
  project: ProjectKey,
): QueryState<ServiceQuery> | undefined {
  let index = serviceQueryIndexes.get(queries);
  if (index === undefined) {
    const byProject = new Map<ProjectKey, QueryState<ServiceQuery>>();
    for (const candidate of queries.values()) {
      if (candidate.descriptor.kind !== "services-of-project") continue;
      const key = projectKeyOf(candidate.descriptor.project);
      if (!byProject.has(key)) byProject.set(key, candidate as QueryState<ServiceQuery>);
    }
    index = byProject;
    serviceQueryIndexes.set(queries, index);
  }
  return index.get(project);
}

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

export function selectServicesOf(
  state: ZeropsDataState,
  project: ProjectRef,
): CollectionRead<ServiceRecord> {
  const projectKey = projectKeyOf(project);
  const query =
    serviceQueryOf(state.inventory.queries, projectKey) ?? unresolvedServiceQuery(project);
  const relationshipKeys = new Set(query.memberKeys);
  for (const key of serviceKeysOf(state.inventory.services, projectKey)) relationshipKeys.add(key);
  return {
    value: [...relationshipKeys].flatMap((key) => {
      const record = state.inventory.services.get(key);
      const ref = state.inventory.memberRefs.get(key);
      if (record !== undefined) return [serviceKnowledge(record, record.ref)];
      return ref?.kind === "service" ? [{ knowledge: "unresolved" as const, ref }] : [];
    }),
    query,
    observation: observationOf(state, project),
  };
}

const unresolvedRunningQuery = (project: ProjectRef): QueryState<RunningQuery> => ({
  status: "unresolved",
  descriptor: {
    kind: "running-processes-of-project",
    project,
    statuses: ["PENDING", "RUNNING", "ROLLBACKING", "CANCELING"],
    schemaVersion: 1,
  },
  key: queryKeyOf({
    kind: "running-processes-of-project",
    project,
    statuses: ["PENDING", "RUNNING", "ROLLBACKING", "CANCELING"],
    schemaVersion: 1,
  }),
  memberKeys: [],
  unresolvedMemberKeys: [],
  coverage: { kind: "none" },
  lastAppliedReadStartOrdinal: null,
  membershipOperations: new Map(),
});

export function selectRunningProcessesOf(
  state: ZeropsDataState,
  project: ProjectRef,
): CollectionRead<ProcessRecord> {
  const indexed = [...state.activity.queries.values()].find(
    (candidate) =>
      candidate.descriptor.kind === "running-processes-of-project" &&
      projectKeyOf(candidate.descriptor.project) === projectKeyOf(project),
  ) as QueryState<RunningQuery> | undefined;
  const query = indexed ?? unresolvedRunningQuery(project);
  const running = [...state.activity.processes.values()].filter(
    (record) =>
      projectKeyOf(record.ref.project) === projectKeyOf(project) && isRunningProcess(record),
  );
  return {
    value: running.map((record) => processKnowledge(record, record.ref)),
    query,
    observation: observationOf(state, project),
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
  const runningProcesses = selectRunningProcessesOf(state, project);
  return {
    project: projectRead,
    services,
    runningProcesses,
    observation: observationOf(state, project),
  };
}

export function selectActivity(state: ZeropsDataState, project: ProjectRef): ProjectActivityRead {
  const running = selectRunningProcessesOf(state, project);
  const retainedHistory = [...state.activity.processes.values()]
    .filter(
      (record) =>
        projectKeyOf(record.ref.project) === projectKeyOf(project) && isTerminalProcess(record),
    )
    .map((record) => processKnowledge(record, record.ref));
  return { running, retainedHistory, observation: observationOf(state, project) };
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

export function selectOperationProgress(
  state: ZeropsDataState,
  attempt: CommandAttemptRef,
): OperationProgressView {
  const command = selectCommandAttempt(state, attempt);
  const processes =
    command?.processRefs.map((ref) =>
      processKnowledge(state.activity.processes.get(processKeyOf(ref)), ref),
    ) ?? [];
  const project =
    command?.target.kind === "service"
      ? command.target.project
      : command?.target.kind === "project"
        ? command.target
        : undefined;
  return { attempt: command, processes, observation: observationOf(state, project) };
}
