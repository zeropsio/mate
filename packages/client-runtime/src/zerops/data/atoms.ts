import { Atom } from "effect/unstable/reactivity";

import { projectServices } from "../../data/projections/services.ts";
import { accountReadsAtom, NOT_READ_SERVICES } from "../../data/reads.ts";
import {
  selectCommandAttempt,
  selectHistory,
  selectService,
  selectTopology,
  selectUsage,
} from "./projection.ts";
import { runtimeServicesRead } from "./serviceBridge.ts";
import type { Shown } from "../knowledge/known.ts";
import {
  selectDeployedVersion,
  selectMateFlag,
  selectSetupMarker,
  type ZeropsServiceDeployedVersion,
} from "./deployedVersion.ts";
import type { ZeropsDataState } from "./state.ts";
import type {
  CollectionRead,
  CommandAttemptRef,
  EntityRead,
  HistoryReadView,
  HistorySeriesKey,
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
import { historySeriesKeyOf, projectKeyOf, serviceKeyOf } from "./types.ts";

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

function collectionReadsEqual<Record extends ProjectRecord | ServiceRecord>(
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

/** Two statements of what a service runs say the same. */
function shownVersionsEqual(
  left: Shown<ZeropsServiceDeployedVersion>,
  right: Shown<ZeropsServiceDeployedVersion>,
): boolean {
  if (left === right) return true;
  if (left.state !== right.state) return false;
  if (left.state === "known" && right.state === "known")
    return (
      left.value.activeId === right.value.activeId &&
      left.value.source === right.value.source &&
      left.value.name === right.value.name
    );
  if (left.state === "failed" && right.state === "failed")
    return left.retryAtMs === right.retryAtMs && left.attempt === right.attempt;
  return left.state === "unread";
}

type RefRegistry<Ref> = Map<string, Ref>;

function remember<Ref>(refs: RefRegistry<Ref>, key: string, ref: Ref): string {
  if (!refs.has(key)) refs.set(key, ref);
  return key;
}

/**
 * A project's services as the runtime's readers take them: the account's store's, through the
 * in-transit bridge (`serviceBridge.ts`).
 */
export function bridgedServicesOf(
  get: Atom.AtomContext,
  project: ProjectRef,
): CollectionRead<ServiceRecord> {
  const account = get(accountReadsAtom);
  return runtimeServicesRead(
    project,
    account === null
      ? NOT_READ_SERVICES
      : get(
          account.data.project(projectServices, {
            orgId: project.organization.organizationId,
            projectId: project.projectId,
          }),
        ),
  );
}

/** One service's record as the account's store holds it; none while it is not listed. */
const bridgedServiceOf = (
  get: Atom.AtomContext,
  service: ServiceRef,
): ServiceRecord | undefined => {
  for (const entry of bridgedServicesOf(get, service.project).value)
    if (entry.knowledge === "observed" && entry.record.ref.serviceId === service.serviceId)
      return entry.record;
  return undefined;
};

/**
 * One value derived from the runtime's state and the account's store, published only when it
 * reads differently.
 */
function stableBridgedAtom<Value>(
  stateAtom: Atom.Atom<ZeropsDataState>,
  select: (state: ZeropsDataState, get: Atom.AtomContext) => Value,
  equal: (left: Value, right: Value) => boolean,
  label: string,
): Atom.Atom<Value> {
  let previous: Value | undefined;
  return Atom.make((get) => {
    const next = select(get(stateAtom), get);
    if (previous !== undefined && equal(previous, next)) return previous;
    previous = next;
    return next;
  }).pipe(Atom.withLabel(label));
}

/** Creates account-data projections without owning or disposing the application AtomRegistry. */
export function createZeropsDataAtoms(stateAtom: Atom.Atom<ZeropsDataState>): {
  readonly stateAtom: Atom.Atom<ZeropsDataState>;
  readonly reads: ZeropsDataReads;
} {
  const projects = new Map<string, ProjectRef>();
  const services = new Map<string, ServiceRef>();
  const history = new Map<string, HistorySeriesKey>();
  const attempts = new Map<string, CommandAttemptRef>();

  const serviceAtom = Atom.family((key: string) =>
    stableBridgedAtom(
      stateAtom,
      (state, get) =>
        selectService(state, services.get(key)!, bridgedServiceOf(get, services.get(key)!)),
      entityReadsEqual,
      `zerops-service:${key}`,
    ),
  );
  const servicesOfAtom = Atom.family((key: string) =>
    stableBridgedAtom(
      stateAtom,
      (_state, get) => bridgedServicesOf(get, projects.get(key)!),
      collectionReadsEqual,
      `zerops-services:${key}`,
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
    stableBridgedAtom(
      stateAtom,
      (state, get) =>
        selectTopology(state, projects.get(key)!, bridgedServicesOf(get, projects.get(key)!)),
      (left: ProjectTopologyRead, right: ProjectTopologyRead) =>
        entityReadsEqual(left.project, right.project) &&
        collectionReadsEqual(left.services, right.services) &&
        observationsEqual(left.observation, right.observation),
      `zerops-topology:${key}`,
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

  const deployedVersionAtom = Atom.family((key: string) =>
    stableBridgedAtom(
      stateAtom,
      (state, get) =>
        selectDeployedVersion(state, services.get(key)!, bridgedServiceOf(get, services.get(key)!)),
      shownVersionsEqual,
      `zerops-deployed-version:${key}`,
    ),
  );
  const mateFlagAtom = Atom.family((key: string) =>
    stableAtom(
      stateAtom,
      (state) => selectMateFlag(state, services.get(key)!),
      Object.is,
      `zerops-mate-flag:${key}`,
    ),
  );

  const setupMarkerAtom = Atom.family((key: string) =>
    stableBridgedAtom(
      stateAtom,
      (state, get) =>
        selectSetupMarker(state, services.get(key)!, bridgedServiceOf(get, services.get(key)!)),
      Object.is,
      `zerops-setup-marker:${key}`,
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
      service: (ref) => serviceAtom(remember(services, serviceKeyOf(ref), ref)),
      servicesOf: (ref) => servicesOfAtom(remember(projects, projectKeyOf(ref), ref)),
      usage: (ref) => usageAtom(remember(services, serviceKeyOf(ref), ref)),
      history: (ref) => historyAtom(remember(history, historySeriesKeyOf(ref), ref)),
      topology: (ref) => topologyAtom(remember(projects, projectKeyOf(ref), ref)),
      commandAttempt: (ref) => commandAtom(remember(attempts, attemptKey(ref), ref)),
      deployedVersion: (ref) => deployedVersionAtom(remember(services, serviceKeyOf(ref), ref)),
      mateFlag: (ref) => mateFlagAtom(remember(services, serviceKeyOf(ref), ref)),
      setupMarker: (ref) => setupMarkerAtom(remember(services, serviceKeyOf(ref), ref)),
    },
  };
}
