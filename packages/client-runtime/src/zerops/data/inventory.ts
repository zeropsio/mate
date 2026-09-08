import type {
  AccessDenialScope,
  AccountScope,
  AdmittedObservation,
  DispatchOrdinal,
  EntityRef,
  EntityObservation,
  EntityUnavailableObservation,
  FacetAdmission,
  FacetPatch,
  FacetState,
  IngestionStamp,
  ObservedFacetFields,
  ProjectFacetName,
  ProjectIdentityFields,
  ProjectIdentityRequiredField,
  ProjectKey,
  ProjectLifecycleFields,
  ProjectLifecycleRequiredField,
  ProjectPlacementFields,
  ProjectPresentationFields,
  ProjectRecord,
  ProjectRef,
  QueryBaselineObservation,
  QueryCoverage,
  QueryKey,
  QueryMembershipObservation,
  QueryState,
  ReadTicket,
  RegistrationRequest,
  PlatformCommand,
  SourceMetadata,
  ReadContribution,
  ReadStartOrdinal,
  ReceiptOrdinal,
  ServiceDeploymentFields,
  ServiceFacetName,
  ServiceIdentityFields,
  ServiceIdentityRequiredField,
  ServiceKey,
  ServiceLifecycleFields,
  ServiceLifecycleRequiredField,
  ServiceRecord,
  ServiceRef,
  ServiceRoutingFields,
  ServiceScalingFields,
  VerifiedAccessGrant,
} from "./types.ts";
import {
  entityKeyOf,
  projectKeyOf,
  projectRoleGrantsAccess,
  queryKeyOf,
  serviceKeyOf,
} from "./types.ts";

export interface InventoryState {
  readonly projects: ReadonlyMap<ProjectKey, ProjectRecord>;
  readonly services: ReadonlyMap<ServiceKey, ServiceRecord>;
  readonly memberRefs: ReadonlyMap<ProjectKey | ServiceKey, ProjectRef | ServiceRef>;
  readonly queries: ReadonlyMap<QueryKey, InventoryQueryState>;
}

type ProjectQuery = Extract<
  QueryBaselineObservation["ticket"]["target"]["descriptor"],
  { readonly kind: "projects-of-organization" }
>;
type ServiceQuery = Extract<
  QueryBaselineObservation["ticket"]["target"]["descriptor"],
  { readonly kind: "services-of-project" }
>;
export type InventoryQueryState = QueryState<ProjectQuery> | QueryState<ServiceQuery>;

export interface DomainObservationOutcome {
  readonly readRequestId: string | null;
  readonly applied: ReadonlyArray<ReadContribution>;
  readonly suppressed: ReadonlyArray<ReadContribution>;
  readonly unresolvedRequiredFields: ReadonlyArray<string>;
}

export interface InventoryReduction {
  readonly state: InventoryState;
  readonly outcome: DomainObservationOutcome;
}

export const EMPTY_ADMISSION: FacetAdmission = Object.freeze({
  lastNativeReceiptOrdinal: null,
  lastAppliedAuthoritativeDispatchOrdinal: null,
  hasAuthoritativeObservation: false,
});

export const noOutcome = (): DomainObservationOutcome => ({
  readRequestId: null,
  applied: [],
  suppressed: [],
  unresolvedRequiredFields: [],
});

export const makeInitialInventoryState = (): InventoryState => ({
  projects: new Map(),
  services: new Map(),
  memberRefs: new Map(),
  queries: new Map(),
});

const makeUnresolvedFacet = <Fields, RequiredField extends keyof Fields>(
  required: ReadonlyArray<RequiredField>,
): FacetState<Fields, RequiredField> => ({
  knowledge: "unresolved",
  fields: {} as FacetPatch<Fields>,
  unresolvedRequiredFields: required,
  admission: EMPTY_ADMISSION,
});

export const makeUnresolvedProject = (ref: ProjectRecord["ref"]): ProjectRecord => ({
  ref,
  identity: makeUnresolvedFacet<ProjectIdentityFields, ProjectIdentityRequiredField>(["name"]),
  lifecycle: makeUnresolvedFacet<ProjectLifecycleFields, ProjectLifecycleRequiredField>(["status"]),
  presentation: makeUnresolvedFacet<ProjectPresentationFields, never>([]),
  placement: makeUnresolvedFacet<ProjectPlacementFields, never>([]),
});

export const makeUnresolvedService = (ref: ServiceRecord["ref"]): ServiceRecord => ({
  ref,
  identity: makeUnresolvedFacet<ServiceIdentityFields, ServiceIdentityRequiredField>(["hostname"]),
  lifecycle: makeUnresolvedFacet<ServiceLifecycleFields, ServiceLifecycleRequiredField>(["status"]),
  routing: makeUnresolvedFacet<ServiceRoutingFields, never>([]),
  deployment: makeUnresolvedFacet<ServiceDeploymentFields, never>([]),
  scaling: makeUnresolvedFacet<ServiceScalingFields, never>([]),
});

export const facetFields = <Fields, RequiredField extends keyof Fields>(
  facet: FacetState<Fields, RequiredField>,
): FacetPatch<Fields> => (facet.knowledge === "unavailable" ? facet.previousFields : facet.fields);

const presentKeys = <Fields>(fields: FacetPatch<Fields>): ReadonlyArray<keyof Fields> =>
  Object.keys(fields) as unknown as ReadonlyArray<keyof Fields>;

const hasOwn = <Fields>(fields: FacetPatch<Fields>, key: keyof Fields): boolean =>
  Object.prototype.hasOwnProperty.call(fields, key);

const missingRequired = <Fields, RequiredField extends keyof Fields>(
  fields: FacetPatch<Fields>,
  required: ReadonlyArray<RequiredField>,
): ReadonlyArray<RequiredField> => required.filter((field) => !hasOwn(fields, field));

type FacetObservation<Fields> =
  | {
      readonly source: "indexed-search" | "direct-read";
      readonly ticket: ReadTicket;
      readonly fields: FacetPatch<Fields>;
      readonly metadata: SourceMetadata;
    }
  | {
      readonly source: "native-push";
      readonly registration: RegistrationRequest;
      readonly fields: FacetPatch<Fields>;
      readonly metadata: SourceMetadata;
    }
  | {
      readonly source: "embedded";
      readonly owner: EntityRef;
      readonly cause:
        | { readonly kind: "read"; readonly ticket: ReadTicket }
        | { readonly kind: "native"; readonly registration: RegistrationRequest }
        | { readonly kind: "command"; readonly command: PlatformCommand };
      readonly fields: FacetPatch<Fields>;
      readonly metadata: SourceMetadata;
    }
  | {
      readonly source: "command-response";
      readonly command: PlatformCommand;
      readonly fields: FacetPatch<Fields>;
      readonly metadata: SourceMetadata;
    };

export interface FacetApplyResult<Fields, RequiredField extends keyof Fields> {
  readonly facet: FacetState<Fields, RequiredField>;
  readonly status: "applied" | "suppressed" | "noop";
  readonly requestId: string | null;
  readonly unresolvedRequiredFields: ReadonlyArray<RequiredField>;
}

const observationRequestId = <Fields>(observation: FacetObservation<Fields>): string | null => {
  if (observation.source === "direct-read" || observation.source === "indexed-search") {
    return observation.ticket.requestId;
  }
  if (observation.source === "embedded" && observation.cause.kind === "read") {
    return observation.cause.ticket.requestId;
  }
  return null;
};

const authoritativeOrder = <Fields>(
  observation: FacetObservation<Fields>,
): { readonly dispatch: DispatchOrdinal; readonly readStart: ReadStartOrdinal | null } | null => {
  if (observation.source === "direct-read") {
    return {
      dispatch: observation.ticket.dispatchOrdinal,
      readStart: observation.ticket.readStartOrdinal,
    };
  }
  if (observation.source === "command-response") {
    return { dispatch: observation.command.dispatchOrdinal, readStart: null };
  }
  return null;
};

const sourceReceiptStart = <Fields>(
  observation: FacetObservation<Fields>,
): ReceiptOrdinal | null => {
  if (observation.source === "direct-read" || observation.source === "indexed-search") {
    return observation.ticket.receiptOrdinalAtStart;
  }
  if (observation.source === "command-response") {
    return observation.command.startedAtReceiptOrdinal;
  }
  if (observation.source === "embedded") {
    if (observation.cause.kind === "read") return observation.cause.ticket.receiptOrdinalAtStart;
    if (observation.cause.kind === "command") {
      return observation.cause.command.startedAtReceiptOrdinal;
    }
  }
  return null;
};

const canReopenUnavailable = <Fields, RequiredField extends keyof Fields>(
  facet: FacetState<Fields, RequiredField>,
  observation: FacetObservation<Fields>,
  accessEvidence: VerifiedAccessGrant | null,
  observedAtMs: number,
): boolean => {
  if (facet.knowledge !== "unavailable" || observation.source !== "direct-read") return false;
  if (accessEvidence === null || observedAtMs > accessEvidence.deadlineMs) return false;
  if (observation.ticket.dispatchOrdinal <= facet.fence.dispatchOrdinal) return false;
  const target = observation.ticket.target;
  if (target.kind === "project") {
    return projectRoleGrantsAccess(accessEvidence, target.ref, "no-read-only");
  }
  if (target.kind === "service" || target.kind === "process") {
    return projectRoleGrantsAccess(accessEvidence, target.ref.project, "no-read-only");
  }
  return false;
};

export function applyFacet<Fields, RequiredField extends keyof Fields>(
  facet: FacetState<Fields, RequiredField>,
  required: ReadonlyArray<RequiredField>,
  observation: FacetObservation<Fields>,
  stamp: IngestionStamp,
  accessEvidence: VerifiedAccessGrant | null,
): FacetApplyResult<Fields, RequiredField> {
  const keys = presentKeys(observation.fields);
  const requestId = observationRequestId(observation);
  const currentFields = facetFields(facet);
  const unresolved = missingRequired(currentFields, required);
  if (keys.length === 0) {
    return { facet, status: "noop", requestId, unresolvedRequiredFields: unresolved };
  }

  if (facet.knowledge === "unavailable") {
    if (!canReopenUnavailable(facet, observation, accessEvidence, stamp.observedAtMs)) {
      return { facet, status: "suppressed", requestId, unresolvedRequiredFields: unresolved };
    }
  }

  const source = observation.source;
  const admission = facet.admission;
  const receiptStart = sourceReceiptStart(observation);
  const order = authoritativeOrder(observation);
  if (
    order !== null &&
    ((admission.lastNativeReceiptOrdinal !== null &&
      receiptStart !== null &&
      admission.lastNativeReceiptOrdinal > receiptStart) ||
      (admission.lastAppliedAuthoritativeDispatchOrdinal !== null &&
        admission.lastAppliedAuthoritativeDispatchOrdinal >= order.dispatch))
  ) {
    return { facet, status: "suppressed", requestId, unresolvedRequiredFields: unresolved };
  }

  let patch: FacetPatch<Fields> = observation.fields;
  if (source === "indexed-search" || source === "embedded") {
    const seedEntries = keys
      .filter((key) => !hasOwn(currentFields, key))
      .map((key) => [key, observation.fields[key]] as const);
    if (seedEntries.length === 0) {
      return { facet, status: "suppressed", requestId, unresolvedRequiredFields: unresolved };
    }
    patch = Object.fromEntries(seedEntries) as FacetPatch<Fields>;
  }

  const fields = { ...currentFields, ...patch };
  const unresolvedRequiredFields = missingRequired<Fields, RequiredField>(
    fields as FacetPatch<Fields>,
    required,
  );
  const nextAdmission: FacetAdmission = {
    lastNativeReceiptOrdinal:
      source === "native-push" ? stamp.receiptOrdinal : admission.lastNativeReceiptOrdinal,
    lastAppliedAuthoritativeDispatchOrdinal:
      order?.dispatch ?? admission.lastAppliedAuthoritativeDispatchOrdinal,
    hasAuthoritativeObservation:
      admission.hasAuthoritativeObservation ||
      source === "direct-read" ||
      source === "native-push" ||
      source === "command-response",
  };

  if (unresolvedRequiredFields.length > 0) {
    return {
      facet: {
        knowledge: "unresolved",
        fields,
        unresolvedRequiredFields,
        admission: nextAdmission,
      },
      status: "applied",
      requestId,
      unresolvedRequiredFields,
    };
  }

  const preserveProvenance =
    facet.knowledge === "observed" && (source === "indexed-search" || source === "embedded");
  return {
    facet: {
      knowledge: "observed",
      fields: fields as ObservedFacetFields<Fields, RequiredField>,
      unresolvedRequiredFields: [],
      source: preserveProvenance ? facet.source : source,
      stamp: preserveProvenance ? facet.stamp : stamp,
      admission: nextAdmission,
    } as FacetState<Fields, RequiredField>,
    status: "applied",
    requestId,
    unresolvedRequiredFields: [],
  };
}

function reduceRecordFacet<EntityRecord extends ProjectRecord | ServiceRecord>(
  record: EntityRecord,
  facetName: keyof EntityRecord,
  contribution: ReadContribution,
  required: ReadonlyArray<string>,
  observation: EntityObservation["observation"],
  admitted: AdmittedObservation,
): { readonly record: EntityRecord; readonly outcome: DomainObservationOutcome } {
  const facet = record[facetName] as unknown as FacetState<Record<string, unknown>, string>;
  const result = applyFacet(
    facet,
    required,
    observation as unknown as FacetObservation<Record<string, unknown>>,
    admitted.stamp,
    admitted.accessEvidence,
  );
  const outcome: DomainObservationOutcome = {
    readRequestId: result.requestId,
    applied: result.status === "applied" ? [contribution] : [],
    suppressed: result.status === "suppressed" ? [contribution] : [],
    unresolvedRequiredFields: result.unresolvedRequiredFields.map(
      (field) => `${contribution}.${field}`,
    ),
  };
  if (result.facet === facet) return { record, outcome };
  return { record: { ...record, [facetName]: result.facet }, outcome } as {
    readonly record: EntityRecord;
    readonly outcome: DomainObservationOutcome;
  };
}

const setProject = (state: InventoryState, record: ProjectRecord): InventoryState => {
  const key = projectKeyOf(record.ref);
  if (state.projects.get(key) === record) return state;
  const projects = new Map(state.projects);
  projects.set(key, record);
  return { ...state, projects };
};

const setService = (state: InventoryState, record: ServiceRecord): InventoryState => {
  const key = serviceKeyOf(record.ref);
  if (state.services.get(key) === record) return state;
  const services = new Map(state.services);
  services.set(key, record);
  return { ...state, services };
};

/**
 * Shared by inventory and activity: drops `key` from every query's `unresolvedMemberKeys`
 * once it resolves. Generic over the query-state shape so both domains reuse one body.
 */
export function resolveMemberKnowledgeIn<
  Query extends { readonly unresolvedMemberKeys: ReadonlyArray<string> },
>(
  queries: ReadonlyMap<QueryKey, Query>,
  key: string,
  resolved: boolean,
): ReadonlyMap<QueryKey, Query> {
  if (!resolved) return queries;
  let next: Map<QueryKey, Query> | null = null;
  for (const [queryKey, query] of queries) {
    if (!query.unresolvedMemberKeys.includes(key)) continue;
    next ??= new Map(queries);
    next.set(queryKey, {
      ...query,
      unresolvedMemberKeys: query.unresolvedMemberKeys.filter((candidate) => candidate !== key),
    });
  }
  return next ?? queries;
}

const resolveMemberKnowledge = (
  state: InventoryState,
  key: ProjectKey | ServiceKey,
  resolved: boolean,
): InventoryState => {
  const queries = resolveMemberKnowledgeIn(state.queries, key, resolved);
  return queries === state.queries ? state : { ...state, queries };
};

const projectObservationFacet = (
  observation: Extract<EntityObservation, { readonly ref: ProjectRecord["ref"] }>,
): { readonly name: ProjectFacetName; readonly required: ReadonlyArray<string> } => {
  switch (observation.kind) {
    case "project-identity-observed":
      return { name: "identity", required: ["name"] };
    case "project-lifecycle-observed":
      return { name: "lifecycle", required: ["status"] };
    case "project-presentation-observed":
      return { name: "presentation", required: [] };
    case "project-placement-observed":
      return { name: "placement", required: [] };
  }
};

const serviceObservationFacet = (
  observation: Extract<EntityObservation, { readonly ref: ServiceRecord["ref"] }>,
): { readonly name: ServiceFacetName; readonly required: ReadonlyArray<string> } => {
  switch (observation.kind) {
    case "service-identity-observed":
      return { name: "identity", required: ["hostname"] };
    case "service-lifecycle-observed":
      return { name: "lifecycle", required: ["status"] };
    case "service-routing-observed":
      return { name: "routing", required: [] };
    case "service-deployment-observed":
      return { name: "deployment", required: [] };
    case "service-scaling-observed":
      return { name: "scaling", required: [] };
  }
};

function reduceEntityObservation(
  state: InventoryState,
  admitted: AdmittedObservation,
  observation: EntityObservation,
): InventoryReduction {
  if (observation.ref.kind === "project") {
    const existing =
      state.projects.get(projectKeyOf(observation.ref)) ?? makeUnresolvedProject(observation.ref);
    const facet = projectObservationFacet(
      observation as Extract<EntityObservation, { readonly ref: ProjectRecord["ref"] }>,
    );
    const reduced = reduceRecordFacet(
      existing,
      facet.name,
      `project:${facet.name}`,
      facet.required,
      observation.observation,
      admitted,
    );
    const next = setProject(state, reduced.record);
    return {
      state: resolveMemberKnowledge(
        next,
        projectKeyOf(reduced.record.ref),
        reduced.record.identity.knowledge === "observed" &&
          reduced.record.lifecycle.knowledge === "observed",
      ),
      outcome: reduced.outcome,
    };
  }
  if (observation.ref.kind === "service") {
    const existing =
      state.services.get(serviceKeyOf(observation.ref)) ?? makeUnresolvedService(observation.ref);
    const facet = serviceObservationFacet(
      observation as Extract<EntityObservation, { readonly ref: ServiceRecord["ref"] }>,
    );
    const reduced = reduceRecordFacet(
      existing,
      facet.name,
      `service:${facet.name}`,
      facet.required,
      observation.observation,
      admitted,
    );
    const next = setService(state, reduced.record);
    return {
      state: resolveMemberKnowledge(
        next,
        serviceKeyOf(reduced.record.ref),
        reduced.record.identity.knowledge === "observed" &&
          reduced.record.lifecycle.knowledge === "observed",
      ),
      outcome: reduced.outcome,
    };
  }
  return { state, outcome: noOutcome() };
}

const queryMemberKey = (
  member: QueryBaselineObservation["members"][number],
): ProjectKey | ServiceKey => {
  if (member.kind === "project") return projectKeyOf(member);
  if (member.kind === "service") return serviceKeyOf(member);
  return entityKeyOf(member) as ProjectKey | ServiceKey;
};

const ensureInventoryMember = (
  state: InventoryState,
  member: QueryBaselineObservation["members"][number],
): InventoryState => {
  const key = queryMemberKey(member);
  let next = state;
  if (member.kind === "project") {
    next = state.projects.has(projectKeyOf(member))
      ? state
      : setProject(state, makeUnresolvedProject(member));
  } else if (member.kind === "service") {
    next = state.services.has(serviceKeyOf(member))
      ? state
      : setService(state, makeUnresolvedService(member));
  }
  if (member.kind !== "project" && member.kind !== "service") return next;
  if (next.memberRefs.get(key) === member) return next;
  const memberRefs = new Map(next.memberRefs);
  memberRefs.set(key, member);
  return { ...next, memberRefs };
};

/** Shared by inventory and activity: an unresolved query state for a not-yet-seen descriptor. */
export function makeUnresolvedQueryState<QState>(
  observation: QueryBaselineObservation | QueryMembershipObservation,
): QState {
  const descriptor =
    observation.kind === "query-baseline-observed"
      ? observation.ticket.target.descriptor
      : observation.registration.descriptor.query;
  return {
    status: "unresolved",
    descriptor,
    key: queryKeyOf(descriptor),
    memberKeys: [],
    unresolvedMemberKeys: [],
    coverage: { kind: "none" },
    lastAppliedReadStartOrdinal: null,
    membershipOperations: new Map(),
  } as unknown as QState;
}

const makeUnresolvedQuery = (
  observation: QueryBaselineObservation | QueryMembershipObservation,
): InventoryQueryState => makeUnresolvedQueryState<InventoryQueryState>(observation);

function reduceQueryBaseline(
  state: InventoryState,
  admitted: AdmittedObservation,
  observation: QueryBaselineObservation,
): InventoryReduction {
  const descriptor = observation.ticket.target.descriptor;
  if (descriptor.kind !== "projects-of-organization" && descriptor.kind !== "services-of-project") {
    return { state, outcome: noOutcome() };
  }
  const key = queryKeyOf(descriptor);
  const existing = state.queries.get(key) ?? makeUnresolvedQuery(observation);
  if (
    existing.lastAppliedReadStartOrdinal !== null &&
    existing.lastAppliedReadStartOrdinal >= observation.ticket.readStartOrdinal
  ) {
    return {
      state,
      outcome: {
        readRequestId: observation.ticket.requestId,
        applied: [],
        suppressed: ["query-membership"],
        unresolvedRequiredFields: [],
      },
    };
  }
  if (observation.coverage.kind === "partial") {
    const queries = new Map(state.queries);
    queries.set(key, {
      ...existing,
      coverage: observation.coverage,
      lastAppliedReadStartOrdinal: observation.ticket.readStartOrdinal,
    } as unknown as InventoryQueryState);
    return {
      state: { ...state, queries },
      outcome: {
        readRequestId: observation.ticket.requestId,
        applied: ["query-membership"],
        suppressed: [],
        unresolvedRequiredFields: [],
      },
    };
  }

  let next = state;
  for (const member of observation.members) next = ensureInventoryMember(next, member);
  for (const member of observation.unresolvedMembers) next = ensureInventoryMember(next, member);

  const baselineKeys = observation.members.map(queryMemberKey);
  const unresolvedKeys = new Set(observation.unresolvedMembers.map(queryMemberKey));
  let memberKeys: ReadonlyArray<ProjectKey | ServiceKey>;
  if (observation.coverage.kind === "partial-window") {
    const before = existing.memberKeys.slice(0, observation.coverage.offset);
    const after = existing.memberKeys.slice(
      observation.coverage.offset + observation.coverage.limit,
    );
    memberKeys = [...before, ...baselineKeys, ...after] as ReadonlyArray<ProjectKey | ServiceKey>;
  } else {
    memberKeys = baselineKeys;
  }

  for (const operation of existing.membershipOperations.values()) {
    const marker = observation.ticket.membershipReceiptOrdinalAtStart;
    if (marker === undefined || operation.receiptOrdinal <= marker) continue;
    const memberKey = queryMemberKey(operation.member);
    if (operation.operation === "remove") {
      memberKeys = memberKeys.filter((candidate) => candidate !== memberKey);
      unresolvedKeys.delete(memberKey);
    } else if (!memberKeys.includes(memberKey)) {
      memberKeys = [...memberKeys, memberKey];
      unresolvedKeys.add(memberKey);
      next = ensureInventoryMember(next, operation.member);
    }
  }

  const query = {
    status: "observed",
    descriptor,
    key,
    memberKeys,
    unresolvedMemberKeys: memberKeys.filter((candidate) => unresolvedKeys.has(candidate)),
    observedTotal: observation.observedTotal,
    coverage: observation.coverage as Exclude<QueryCoverage, { readonly kind: "none" }>,
    source: observation.source,
    stamp: admitted.stamp,
    lastAppliedReadStartOrdinal: observation.ticket.readStartOrdinal,
    membershipOperations: existing.membershipOperations,
  } as unknown as InventoryQueryState;
  const queries = new Map(next.queries);
  queries.set(key, query);
  return {
    state: { ...next, queries },
    outcome: {
      readRequestId: observation.ticket.requestId,
      applied: ["query-membership"],
      suppressed: [],
      unresolvedRequiredFields: [],
    },
  };
}

function reduceMembership(
  state: InventoryState,
  admitted: AdmittedObservation,
  observation: QueryMembershipObservation,
): InventoryReduction {
  const descriptor = observation.registration.descriptor.query;
  if (descriptor.kind !== "projects-of-organization" && descriptor.kind !== "services-of-project") {
    return { state, outcome: noOutcome() };
  }
  const key = queryKeyOf(descriptor);
  const existing = state.queries.get(key) ?? makeUnresolvedQuery(observation);
  const memberKey = queryMemberKey(observation.member);
  const operations = existing.membershipOperations as ReadonlyMap<
    ProjectKey | ServiceKey,
    {
      readonly member: QueryMembershipObservation["member"];
      readonly receiptOrdinal: ReceiptOrdinal;
      readonly operation: "add" | "remove";
    }
  >;
  const previousOperation = operations.get(memberKey);
  if (
    previousOperation !== undefined &&
    previousOperation.receiptOrdinal >= admitted.stamp.receiptOrdinal
  ) {
    return { state, outcome: noOutcome() };
  }
  const membershipOperations = new Map(operations);
  membershipOperations.set(memberKey, {
    member: observation.member,
    receiptOrdinal: admitted.stamp.receiptOrdinal,
    operation: observation.operation,
  });
  let memberKeys = existing.memberKeys as ReadonlyArray<ProjectKey | ServiceKey>;
  let unresolvedMemberKeys = existing.unresolvedMemberKeys as ReadonlyArray<
    ProjectKey | ServiceKey
  >;
  let next = state;
  if (observation.operation === "remove") {
    memberKeys = memberKeys.filter((candidate) => candidate !== memberKey);
    unresolvedMemberKeys = unresolvedMemberKeys.filter((candidate) => candidate !== memberKey);
  } else {
    if (!memberKeys.includes(memberKey)) memberKeys = [...memberKeys, memberKey];
    next = ensureInventoryMember(next, observation.member);
    const record =
      observation.member.kind === "project"
        ? next.projects.get(projectKeyOf(observation.member))
        : observation.member.kind === "service"
          ? next.services.get(serviceKeyOf(observation.member))
          : undefined;
    const isUnresolved =
      record === undefined ||
      record.identity.knowledge !== "observed" ||
      record.lifecycle.knowledge !== "observed";
    if (isUnresolved && !unresolvedMemberKeys.includes(memberKey)) {
      unresolvedMemberKeys = [...unresolvedMemberKeys, memberKey];
    }
  }
  const queries = new Map(next.queries);
  queries.set(key, {
    ...existing,
    memberKeys,
    unresolvedMemberKeys,
    membershipOperations,
  } as unknown as InventoryQueryState);
  return { state: { ...next, queries }, outcome: noOutcome() };
}

export const unavailableFacet = <Fields, RequiredField extends keyof Fields>(
  facet: FacetState<Fields, RequiredField>,
  observation: EntityUnavailableObservation,
  stamp: IngestionStamp,
  access: VerifiedAccessGrant,
): FacetState<Fields, RequiredField> => ({
  knowledge: "unavailable",
  reason: observation.reason,
  previousFields: facetFields(facet),
  stamp,
  fence: {
    accountEpoch: access.accountEpoch,
    readStartOrdinal: observation.ticket.readStartOrdinal,
    dispatchOrdinal: observation.ticket.dispatchOrdinal,
    verifiedAccessDeadlineMs: access.deadlineMs,
  },
  admission: facet.admission,
});

/** Absence applies to the whole entity, so every facet must still precede the read. */
export const unavailableReadIsCurrent = (
  facets: ReadonlyArray<{
    readonly admission: FacetAdmission;
    readonly fence?: { readonly dispatchOrdinal: DispatchOrdinal };
  }>,
  ticket: ReadTicket,
): boolean =>
  facets.every(
    ({ admission, fence }) =>
      (admission.lastAppliedAuthoritativeDispatchOrdinal === null ||
        admission.lastAppliedAuthoritativeDispatchOrdinal < ticket.dispatchOrdinal) &&
      (admission.lastNativeReceiptOrdinal === null ||
        admission.lastNativeReceiptOrdinal <= ticket.receiptOrdinalAtStart) &&
      (fence === undefined || fence.dispatchOrdinal < ticket.dispatchOrdinal),
  );

const accessAllowsUnavailable = (
  scope: AccountScope,
  observation: EntityUnavailableObservation,
  admitted: AdmittedObservation,
): admitted is AdmittedObservation & { readonly accessEvidence: VerifiedAccessGrant } => {
  const access = admitted.accessEvidence;
  if (access === null || access.accountEpoch !== scope.epoch) return false;
  if (admitted.stamp.observedAtMs > access.deadlineMs) return false;
  return observation.ticket.owner.kind === "interest"
    ? observation.ticket.owner.identity.receiver.accountEpoch === scope.epoch
    : observation.ticket.owner.account.epoch === scope.epoch;
};

function reduceUnavailable(
  state: InventoryState,
  scope: AccountScope,
  admitted: AdmittedObservation,
  observation: EntityUnavailableObservation,
): InventoryReduction {
  if (!accessAllowsUnavailable(scope, observation, admitted))
    return { state, outcome: noOutcome() };
  if (observation.ref.kind === "project") {
    const record =
      state.projects.get(projectKeyOf(observation.ref)) ?? makeUnresolvedProject(observation.ref);
    if (
      !unavailableReadIsCurrent(
        [record.identity, record.lifecycle, record.presentation, record.placement],
        observation.ticket,
      )
    )
      return { state, outcome: noOutcome() };
    return {
      state: setProject(state, {
        ...record,
        identity: unavailableFacet(
          record.identity,
          observation,
          admitted.stamp,
          admitted.accessEvidence,
        ),
        lifecycle: unavailableFacet(
          record.lifecycle,
          observation,
          admitted.stamp,
          admitted.accessEvidence,
        ),
        presentation: unavailableFacet(
          record.presentation,
          observation,
          admitted.stamp,
          admitted.accessEvidence,
        ),
        placement: unavailableFacet(
          record.placement,
          observation,
          admitted.stamp,
          admitted.accessEvidence,
        ),
      }),
      outcome: noOutcome(),
    };
  }
  if (observation.ref.kind === "service") {
    const record =
      state.services.get(serviceKeyOf(observation.ref)) ?? makeUnresolvedService(observation.ref);
    if (
      !unavailableReadIsCurrent(
        [record.identity, record.lifecycle, record.routing, record.deployment, record.scaling],
        observation.ticket,
      )
    )
      return { state, outcome: noOutcome() };
    return {
      state: setService(state, {
        ...record,
        identity: unavailableFacet(
          record.identity,
          observation,
          admitted.stamp,
          admitted.accessEvidence,
        ),
        lifecycle: unavailableFacet(
          record.lifecycle,
          observation,
          admitted.stamp,
          admitted.accessEvidence,
        ),
        routing: unavailableFacet(
          record.routing,
          observation,
          admitted.stamp,
          admitted.accessEvidence,
        ),
        deployment: unavailableFacet(
          record.deployment,
          observation,
          admitted.stamp,
          admitted.accessEvidence,
        ),
        scaling: unavailableFacet(
          record.scaling,
          observation,
          admitted.stamp,
          admitted.accessEvidence,
        ),
      }),
      outcome: noOutcome(),
    };
  }
  return { state, outcome: noOutcome() };
}

export function reduceInventoryObservation(
  state: InventoryState,
  scope: AccountScope,
  admitted: AdmittedObservation,
): InventoryReduction {
  const observation = admitted.input;
  if (observation.kind === "entity-unavailable") {
    return reduceUnavailable(state, scope, admitted, observation);
  }
  if (observation.kind === "query-baseline-observed") {
    return reduceQueryBaseline(state, admitted, observation);
  }
  if (observation.kind === "query-membership-observed") {
    return reduceMembership(state, admitted, observation);
  }
  if (observation.kind.endsWith("-observed") && "ref" in observation) {
    return reduceEntityObservation(state, admitted, observation as EntityObservation);
  }
  return { state, outcome: noOutcome() };
}

/** Shared by inventory and activity: the fence a revoked-access denial stamps onto a facet. */
export interface DenialFence {
  readonly accountEpoch: AccountScope["epoch"];
  readonly readStartOrdinal: ReadStartOrdinal;
  readonly dispatchOrdinal: DispatchOrdinal;
  readonly verifiedAccessDeadlineMs: number;
}

export const denialFence = (
  scope: AccountScope,
  stamp: IngestionStamp,
  dispatchOrdinal: DispatchOrdinal,
): DenialFence => ({
  accountEpoch: scope.epoch,
  readStartOrdinal: 0 as ReadStartOrdinal,
  dispatchOrdinal,
  verifiedAccessDeadlineMs: stamp.observedAtMs,
});

export const denyFacet = <Fields, RequiredField extends keyof Fields>(
  facet: FacetState<Fields, RequiredField>,
  fence: DenialFence,
  stamp: IngestionStamp,
): FacetState<Fields, RequiredField> => ({
  knowledge: "unavailable",
  reason: "access-revoked",
  previousFields: facetFields(facet),
  stamp,
  fence,
  admission: facet.admission,
});

export function denyInventoryScope(
  state: InventoryState,
  scope: AccountScope,
  denied: AccessDenialScope,
  stamp: IngestionStamp,
  dispatchOrdinal: DispatchOrdinal,
): InventoryState {
  if (denied.kind === "account") {
    if (
      denied.account.apiOrigin !== scope.account.apiOrigin ||
      denied.account.accountId !== scope.account.accountId
    )
      return state;
  }
  const appliesToProject = (record: ProjectRecord): boolean =>
    denied.kind === "account" || projectKeyOf(record.ref) === projectKeyOf(denied.project);
  const fence = denialFence(scope, stamp, dispatchOrdinal);
  const projects = new Map(state.projects);
  const services = new Map(state.services);
  let changed = false;
  for (const [key, record] of projects) {
    if (!appliesToProject(record)) continue;
    projects.set(key, {
      ...record,
      identity: denyFacet(record.identity, fence, stamp),
      lifecycle: denyFacet(record.lifecycle, fence, stamp),
      presentation: denyFacet(record.presentation, fence, stamp),
      placement: denyFacet(record.placement, fence, stamp),
    });
    changed = true;
  }
  for (const [key, record] of services) {
    if (
      denied.kind === "project" &&
      projectKeyOf(record.ref.project) !== projectKeyOf(denied.project)
    )
      continue;
    services.set(key, {
      ...record,
      identity: denyFacet(record.identity, fence, stamp),
      lifecycle: denyFacet(record.lifecycle, fence, stamp),
      routing: denyFacet(record.routing, fence, stamp),
      deployment: denyFacet(record.deployment, fence, stamp),
      scaling: denyFacet(record.scaling, fence, stamp),
    });
    changed = true;
  }
  return changed ? { ...state, projects, services } : state;
}

/**
 * Shared by inventory and activity: drops a query's retained membership operations at or
 * before the oldest marker still relied on by a pending read (or all of them, once none is).
 */
export function releaseMembershipMarkersIn<
  Query extends {
    readonly membershipOperations: ReadonlyMap<string, { readonly receiptOrdinal: ReceiptOrdinal }>;
  },
>(
  queries: ReadonlyMap<QueryKey, Query>,
  oldestActiveMarkerByQuery: ReadonlyMap<QueryKey, ReceiptOrdinal>,
): ReadonlyMap<QueryKey, Query> {
  let next: Map<QueryKey, Query> | null = null;
  for (const [key, query] of queries) {
    const oldest = oldestActiveMarkerByQuery.get(key);
    const membershipOperations = new Map(
      [...query.membershipOperations].filter(([, operation]) =>
        oldest === undefined ? false : operation.receiptOrdinal > oldest,
      ),
    );
    if (membershipOperations.size === query.membershipOperations.size) continue;
    next ??= new Map(queries);
    next.set(key, { ...query, membershipOperations });
  }
  return next ?? queries;
}

export function releaseInventoryMembershipMarkers(
  state: InventoryState,
  oldestActiveMarkerByQuery: ReadonlyMap<QueryKey, ReceiptOrdinal>,
): InventoryState {
  const queries = releaseMembershipMarkersIn(state.queries, oldestActiveMarkerByQuery);
  return queries === state.queries ? state : { ...state, queries };
}
