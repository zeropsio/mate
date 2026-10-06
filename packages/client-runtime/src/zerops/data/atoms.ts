import { Atom } from "effect/unstable/reactivity";

import { projectServices } from "../../data/projections/services.ts";
import { accountReadsAtom, NOT_READ_SERVICES } from "../../data/reads.ts";
import { selectCommandAttempt, selectService, selectTopology } from "./projection.ts";
import { runtimeServicesRead } from "./serviceBridge.ts";
import type { ZeropsDataState } from "./state.ts";
import type {
  CollectionRead,
  CommandAttemptRef,
  EntityRead,
  ProjectRecord,
  ProjectRef,
  ProjectTopologyRead,
  ServiceRecord,
  ServiceRef,
  ViewObservation,
  EntityKnowledge,
  ZeropsEntityRecord,
  ZeropsDataReads,
} from "./types.ts";
import { projectKeyOf, serviceKeyOf } from "./types.ts";

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

type RefRegistry<Ref> = Map<string, Ref>;

function remember<Ref>(refs: RefRegistry<Ref>, key: string, ref: Ref): string {
  if (!refs.has(key)) refs.set(key, ref);
  return key;
}

/**
 * A project's services as the runtime's readers take them: the account's store's, through the
 * in-transit bridge (`serviceBridge.ts`).
 */
function bridgedServicesOf(
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
      topology: (ref) => topologyAtom(remember(projects, projectKeyOf(ref), ref)),
      commandAttempt: (ref) => commandAtom(remember(attempts, attemptKey(ref), ref)),
    },
  };
}
