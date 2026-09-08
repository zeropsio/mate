import { Atom } from "effect/unstable/reactivity";

import {
  selectActivity,
  selectCommandAttempt,
  selectHistory,
  selectOperationProgress,
  selectProject,
  selectProjectsOf,
  selectRunningProcessesOf,
  selectService,
  selectServicesOf,
  selectTopology,
  selectUsage,
} from "./projection.ts";
import type { ZeropsDataState } from "./state.ts";
import type {
  CollectionRead,
  CommandAttemptRef,
  EntityRead,
  HistoryReadView,
  HistorySeriesKey,
  OperationProgressView,
  OrganizationRef,
  ProcessRecord,
  ProjectActivityRead,
  ProjectRecord,
  ProjectRef,
  ProjectTopologyRead,
  ServiceRecord,
  ServiceRef,
  UsageRead,
  ViewObservation,
  EntityKnowledge,
  ZeropsEntityRecord,
  ZeropsDataReads,
} from "./types.ts";
import { historySeriesKeyOf, organizationKeyOf, projectKeyOf, serviceKeyOf } from "./types.ts";

function arrayReferencesEqual<Value>(
  left: ReadonlyArray<Value>,
  right: ReadonlyArray<Value>,
): boolean {
  return (
    left === right ||
    (left.length === right.length && left.every((value, index) => value === right[index]))
  );
}

function observationsEqual(left: ViewObservation, right: ViewObservation): boolean {
  return (
    left === right ||
    (left.access === right.access &&
      arrayReferencesEqual(left.required, right.required) &&
      arrayReferencesEqual(left.optional, right.optional))
  );
}

function entityKnowledgeEqual<Record extends ZeropsEntityRecord>(
  left: EntityKnowledge<Record>,
  right: EntityKnowledge<Record>,
): boolean {
  if (left === right) return true;
  if (left.knowledge !== right.knowledge) return false;
  if (left.knowledge === "observed" && right.knowledge === "observed") {
    return left.record === right.record;
  }
  if (left.knowledge === "unavailable" && right.knowledge === "unavailable") {
    return left.ref === right.ref && left.reason === right.reason && left.since === right.since;
  }
  return left.knowledge === "unresolved" && right.knowledge === "unresolved"
    ? left.ref === right.ref
    : false;
}

function entityReadsEqual<Record extends ZeropsEntityRecord>(
  left: EntityRead<Record>,
  right: EntityRead<Record>,
): boolean {
  return (
    entityKnowledgeEqual(left.value, right.value) &&
    observationsEqual(left.observation, right.observation)
  );
}

function knowledgeArraysEqual<Record extends ZeropsEntityRecord>(
  left: ReadonlyArray<EntityKnowledge<Record>>,
  right: ReadonlyArray<EntityKnowledge<Record>>,
): boolean {
  return (
    left === right ||
    (left.length === right.length &&
      left.every((value, index) => entityKnowledgeEqual(value, right[index]!)))
  );
}

function collectionReadsEqual<Record extends ProjectRecord | ServiceRecord | ProcessRecord>(
  left: CollectionRead<Record>,
  right: CollectionRead<Record>,
): boolean {
  return (
    left.query === right.query &&
    knowledgeArraysEqual(left.value, right.value) &&
    observationsEqual(left.observation, right.observation)
  );
}

function stableAtom<Value>(
  stateAtom: Atom.Atom<ZeropsDataState>,
  select: (state: ZeropsDataState) => Value,
  equal: (left: Value, right: Value) => boolean,
  label: string,
): Atom.Atom<Value> {
  let previous: Value | undefined;
  return Atom.make((get) => {
    const next = select(get(stateAtom));
    if (previous !== undefined && equal(previous, next)) return previous;
    previous = next;
    return next;
  }).pipe(Atom.withLabel(label));
}

type RefRegistry<Ref> = Map<string, Ref>;

function remember<Ref>(refs: RefRegistry<Ref>, key: string, ref: Ref): string {
  if (!refs.has(key)) refs.set(key, ref);
  return key;
}

/** Creates account-data projections without owning or disposing the application AtomRegistry. */
export function createZeropsDataAtoms(stateAtom: Atom.Atom<ZeropsDataState>): {
  readonly stateAtom: Atom.Atom<ZeropsDataState>;
  readonly reads: ZeropsDataReads;
} {
  const projects = new Map<string, ProjectRef>();
  const organizations = new Map<string, OrganizationRef>();
  const services = new Map<string, ServiceRef>();
  const history = new Map<string, HistorySeriesKey>();
  const attempts = new Map<string, CommandAttemptRef>();

  const projectAtom = Atom.family((key: string) =>
    stableAtom(
      stateAtom,
      (state) => selectProject(state, projects.get(key)!),
      entityReadsEqual,
      `zerops-project:${key}`,
    ),
  );
  const projectsOfAtom = Atom.family((key: string) =>
    stableAtom(
      stateAtom,
      (state) => selectProjectsOf(state, organizations.get(key)!),
      collectionReadsEqual,
      `zerops-projects:${key}`,
    ),
  );
  const serviceAtom = Atom.family((key: string) =>
    stableAtom(
      stateAtom,
      (state) => selectService(state, services.get(key)!),
      entityReadsEqual,
      `zerops-service:${key}`,
    ),
  );
  const servicesOfAtom = Atom.family((key: string) =>
    stableAtom(
      stateAtom,
      (state) => selectServicesOf(state, projects.get(key)!),
      collectionReadsEqual,
      `zerops-services:${key}`,
    ),
  );
  const runningAtom = Atom.family((key: string) =>
    stableAtom(
      stateAtom,
      (state) => selectRunningProcessesOf(state, projects.get(key)!),
      collectionReadsEqual,
      `zerops-running-processes:${key}`,
    ),
  );
  const usageAtom = Atom.family((key: string) =>
    stableAtom(
      stateAtom,
      (state) => selectUsage(state, services.get(key)!),
      (left: UsageRead, right: UsageRead) =>
        (left.value === right.value ||
          (left.value !== null &&
            right.value !== null &&
            left.value.containers === right.value.containers &&
            left.value.cpu.used === right.value.cpu.used &&
            left.value.cpu.limit === right.value.cpu.limit &&
            left.value.memoryGb.used === right.value.memoryGb.used &&
            left.value.memoryGb.limit === right.value.memoryGb.limit &&
            left.value.diskGb.used === right.value.diskGb.used &&
            left.value.diskGb.limit === right.value.diskGb.limit)) &&
        left.coverage === right.coverage &&
        observationsEqual(left.observation, right.observation),
      `zerops-usage:${key}`,
    ),
  );
  const historyAtom = Atom.family((key: string) =>
    stableAtom(
      stateAtom,
      (state) => selectHistory(state, history.get(key)!),
      (left: HistoryReadView, right: HistoryReadView) =>
        (left.series === right.series ||
          (left.series.status === "unresolved" &&
            right.series.status === "unresolved" &&
            historySeriesKeyOf(left.series.key) === historySeriesKeyOf(right.series.key))) &&
        observationsEqual(left.observation, right.observation),
      `zerops-history:${key}`,
    ),
  );
  const topologyAtom = Atom.family((key: string) =>
    stableAtom(
      stateAtom,
      (state) => selectTopology(state, projects.get(key)!),
      (left: ProjectTopologyRead, right: ProjectTopologyRead) =>
        entityReadsEqual(left.project, right.project) &&
        collectionReadsEqual(left.services, right.services) &&
        collectionReadsEqual(left.runningProcesses, right.runningProcesses) &&
        observationsEqual(left.observation, right.observation),
      `zerops-topology:${key}`,
    ),
  );
  const activityAtom = Atom.family((key: string) =>
    stableAtom(
      stateAtom,
      (state) => selectActivity(state, projects.get(key)!),
      (left: ProjectActivityRead, right: ProjectActivityRead) =>
        collectionReadsEqual(left.running, right.running) &&
        knowledgeArraysEqual(left.retainedHistory, right.retainedHistory) &&
        observationsEqual(left.observation, right.observation),
      `zerops-activity:${key}`,
    ),
  );
  const commandAtom = Atom.family((key: string) =>
    stableAtom(
      stateAtom,
      (state) => selectCommandAttempt(state, attempts.get(key)!),
      Object.is,
      `zerops-command:${key}`,
    ),
  );
  const operationAtom = Atom.family((key: string) =>
    stableAtom(
      stateAtom,
      (state) => selectOperationProgress(state, attempts.get(key)!),
      (left: OperationProgressView, right: OperationProgressView) =>
        left.attempt === right.attempt &&
        knowledgeArraysEqual(left.processes, right.processes) &&
        observationsEqual(left.observation, right.observation),
      `zerops-operation:${key}`,
    ),
  );

  const attemptKey = (attempt: CommandAttemptRef): string =>
    JSON.stringify([
      attempt.account.apiOrigin,
      attempt.account.accountId,
      attempt.accountEpoch,
      attempt.attemptId,
    ]);

  return {
    stateAtom,
    reads: {
      access: stableAtom(stateAtom, (state) => state.access, Object.is, "zerops-access"),
      project: (ref) => projectAtom(remember(projects, projectKeyOf(ref), ref)),
      projectsOf: (ref) => projectsOfAtom(remember(organizations, organizationKeyOf(ref), ref)),
      service: (ref) => serviceAtom(remember(services, serviceKeyOf(ref), ref)),
      servicesOf: (ref) => servicesOfAtom(remember(projects, projectKeyOf(ref), ref)),
      runningProcessesOf: (ref) => runningAtom(remember(projects, projectKeyOf(ref), ref)),
      usage: (ref) => usageAtom(remember(services, serviceKeyOf(ref), ref)),
      history: (ref) => historyAtom(remember(history, historySeriesKeyOf(ref), ref)),
      topology: (ref) => topologyAtom(remember(projects, projectKeyOf(ref), ref)),
      activity: (ref) => activityAtom(remember(projects, projectKeyOf(ref), ref)),
      operationProgress: (ref) => operationAtom(remember(attempts, attemptKey(ref), ref)),
      commandAttempt: (ref) => commandAtom(remember(attempts, attemptKey(ref), ref)),
    },
  };
}
