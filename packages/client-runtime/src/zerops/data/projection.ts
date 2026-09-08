import { isRunningProcess, isTerminalProcess } from "./activity.ts";
import type { ZeropsDataState } from "./state.ts";
import type {
  CollectionRead,
  CommandAttemptRef,
  CommandAttemptState,
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
  ProjectRecord,
  ProjectRef,
  ProjectTopologyRead,
  QueryState,
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

const observationOf = (state: ZeropsDataState, project?: ProjectRef): ViewObservation => {
  const required: InterestState[] = [];
  const optional: InterestState[] = [];
  for (const desired of state.interests.values()) {
    const descriptor = desired.descriptor;
    const descriptorProject = "project" in descriptor ? descriptor.project : undefined;
    if (
      project !== undefined &&
      descriptorProject !== undefined &&
      projectKeyOf(descriptorProject) !== projectKeyOf(project)
    )
      continue;
    (desired.required ? required : optional).push(desired.interest);
  }
  return { required, optional, access: state.access };
};

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

export function selectServicesOf(
  state: ZeropsDataState,
  project: ProjectRef,
): CollectionRead<ServiceRecord> {
  const indexed = [...state.inventory.queries.values()].find(
    (candidate) =>
      candidate.descriptor.kind === "services-of-project" &&
      projectKeyOf(candidate.descriptor.project) === projectKeyOf(project),
  ) as QueryState<ServiceQuery> | undefined;
  const query = indexed ?? unresolvedServiceQuery(project);
  const relationshipKeys = new Set(query.memberKeys);
  for (const [key, record] of state.inventory.services) {
    if (projectKeyOf(record.ref.project) === projectKeyOf(project)) relationshipKeys.add(key);
  }
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
