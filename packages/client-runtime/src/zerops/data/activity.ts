import type {
  AccessDenialScope,
  AccountScope,
  AdmittedObservation,
  DispatchOrdinal,
  EntityObservation,
  EntityUnavailableObservation,
  FacetState,
  IngestionStamp,
  ProcessFacetName,
  ProcessKey,
  ProcessRecord,
  ProcessRef,
  QueryBaselineObservation,
  QueryCoverage,
  QueryKey,
  QueryMembershipObservation,
  QueryState,
  ReadContribution,
  ReceiptOrdinal,
} from "./types.ts";
import { processKeyOf, projectKeyOf, queryKeyOf } from "./types.ts";
import {
  applyFacet,
  denialFence,
  denyFacet,
  EMPTY_ADMISSION,
  makeUnresolvedQueryState,
  noOutcome,
  releaseMembershipMarkersIn,
  resolveMemberKnowledgeIn,
  unavailableFacet,
  unavailableReadIsCurrent,
  type DomainObservationOutcome,
} from "./inventory.ts";

export interface ActivityState {
  readonly processes: ReadonlyMap<ProcessKey, ProcessRecord>;
  readonly memberRefs: ReadonlyMap<ProcessKey, ProcessRef>;
  readonly queries: ReadonlyMap<QueryKey, ActivityQueryState>;
}

type RunningQuery = Extract<
  QueryBaselineObservation["ticket"]["target"]["descriptor"],
  { readonly kind: "running-processes-of-project" }
>;
type HistoryQuery = Extract<
  QueryBaselineObservation["ticket"]["target"]["descriptor"],
  { readonly kind: "process-history-window" }
>;
export type ActivityQueryState = QueryState<RunningQuery> | QueryState<HistoryQuery>;

export interface ActivityReduction {
  readonly state: ActivityState;
  readonly outcome: DomainObservationOutcome;
}

export const makeInitialActivityState = (): ActivityState => ({
  processes: new Map(),
  memberRefs: new Map(),
  queries: new Map(),
});

export const makeUnresolvedProcess = (ref: ProcessRecord["ref"]): ProcessRecord => ({
  ref,
  identity: {
    knowledge: "unresolved",
    fields: {},
    unresolvedRequiredFields: ["actionName", "createdAt"],
    admission: EMPTY_ADMISSION,
  },
  lifecycle: {
    knowledge: "unresolved",
    fields: {},
    unresolvedRequiredFields: ["status"],
    admission: EMPTY_ADMISSION,
  },
  pipeline: {
    knowledge: "unresolved",
    fields: {},
    unresolvedRequiredFields: [],
    admission: EMPTY_ADMISSION,
  },
});

const setProcess = (state: ActivityState, record: ProcessRecord): ActivityState => {
  const key = processKeyOf(record.ref);
  if (state.processes.get(key) === record) return state;
  const processes = new Map(state.processes);
  processes.set(key, record);
  return { ...state, processes };
};

const resolveMemberKnowledge = (
  state: ActivityState,
  key: ProcessKey,
  resolved: boolean,
): ActivityState => {
  const queries = resolveMemberKnowledgeIn(state.queries, key, resolved);
  return queries === state.queries ? state : { ...state, queries };
};

const processFacet = (
  observation: Extract<EntityObservation, { readonly ref: ProcessRecord["ref"] }>,
): { readonly name: ProcessFacetName; readonly required: ReadonlyArray<string> } => {
  switch (observation.kind) {
    case "process-identity-observed":
      return { name: "identity", required: ["actionName", "createdAt"] };
    case "process-lifecycle-observed":
      return { name: "lifecycle", required: ["status"] };
    case "process-pipeline-observed":
      return { name: "pipeline", required: [] };
  }
};

function reduceProcessObservation(
  state: ActivityState,
  admitted: AdmittedObservation,
  observation: Extract<EntityObservation, { readonly ref: ProcessRecord["ref"] }>,
): ActivityReduction {
  const existing =
    state.processes.get(processKeyOf(observation.ref)) ?? makeUnresolvedProcess(observation.ref);
  const facet = processFacet(observation);
  const current = existing[facet.name] as FacetState<Record<string, unknown>, string>;
  const result = applyFacet(
    current,
    facet.required,
    observation.observation,
    admitted.stamp,
    admitted.accessEvidence,
  );
  const contribution = `process:${facet.name}` as ReadContribution;
  const outcome: DomainObservationOutcome = {
    readRequestId:
      observation.observation.source === "direct-read" ||
      observation.observation.source === "indexed-search"
        ? observation.observation.ticket.requestId
        : observation.observation.source === "embedded" &&
            observation.observation.cause.kind === "read"
          ? observation.observation.cause.ticket.requestId
          : null,
    applied: result.status === "applied" ? [contribution] : [],
    suppressed: result.status === "suppressed" ? [contribution] : [],
    unresolvedRequiredFields: result.unresolvedRequiredFields.map(
      (field) => `${contribution}.${field}`,
    ),
  };
  if (result.facet === current) return { state, outcome };
  const record = { ...existing, [facet.name]: result.facet } as ProcessRecord;
  const next = setProcess(state, record);
  return {
    state: resolveMemberKnowledge(
      next,
      processKeyOf(record.ref),
      record.identity.knowledge === "observed" && record.lifecycle.knowledge === "observed",
    ),
    outcome,
  };
}

const makeUnresolvedQuery = (
  observation: QueryBaselineObservation | QueryMembershipObservation,
): ActivityQueryState => makeUnresolvedQueryState<ActivityQueryState>(observation);

const ensureProcess = (state: ActivityState, ref: ProcessRecord["ref"]): ActivityState => {
  const key = processKeyOf(ref);
  let next = state.processes.has(key) ? state : setProcess(state, makeUnresolvedProcess(ref));
  if (next.memberRefs.get(key) === ref) return next;
  const memberRefs = new Map(next.memberRefs);
  memberRefs.set(key, ref);
  next = { ...next, memberRefs };
  return next;
};

function reduceQueryBaseline(
  state: ActivityState,
  admitted: AdmittedObservation,
  observation: QueryBaselineObservation,
): ActivityReduction {
  const descriptor = observation.ticket.target.descriptor;
  if (
    descriptor.kind !== "running-processes-of-project" &&
    descriptor.kind !== "process-history-window"
  )
    return { state, outcome: noOutcome() };
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
    } as unknown as ActivityQueryState);
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
  for (const member of observation.members) {
    if (member.kind === "process") next = ensureProcess(next, member);
  }
  for (const member of observation.unresolvedMembers) {
    if (member.kind === "process") next = ensureProcess(next, member);
  }
  const baselineKeys = observation.members.map((member) =>
    processKeyOf(member as ProcessRecord["ref"]),
  );
  const unresolvedKeys = new Set(
    observation.unresolvedMembers.map((member) => processKeyOf(member as ProcessRecord["ref"])),
  );
  let memberKeys: ReadonlyArray<ProcessKey>;
  if (observation.coverage.kind === "partial-window") {
    memberKeys = [
      ...existing.memberKeys.slice(0, observation.coverage.offset),
      ...baselineKeys,
      ...existing.memberKeys.slice(observation.coverage.offset + observation.coverage.limit),
    ] as ReadonlyArray<ProcessKey>;
  } else {
    memberKeys = baselineKeys;
  }
  for (const operation of existing.membershipOperations.values()) {
    const marker = observation.ticket.membershipReceiptOrdinalAtStart;
    if (marker === undefined || operation.receiptOrdinal <= marker) continue;
    const memberKey = processKeyOf(operation.member as ProcessRecord["ref"]);
    if (operation.operation === "remove") {
      memberKeys = memberKeys.filter((candidate) => candidate !== memberKey);
      unresolvedKeys.delete(memberKey);
    } else if (!memberKeys.includes(memberKey)) {
      memberKeys = [...memberKeys, memberKey];
      unresolvedKeys.add(memberKey);
      next = ensureProcess(next, operation.member as ProcessRecord["ref"]);
    }
  }
  const queries = new Map(next.queries);
  queries.set(key, {
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
  } as unknown as ActivityQueryState);
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
  state: ActivityState,
  admitted: AdmittedObservation,
  observation: QueryMembershipObservation,
): ActivityReduction {
  const descriptor = observation.registration.descriptor.query;
  if (
    descriptor.kind !== "running-processes-of-project" &&
    descriptor.kind !== "process-history-window"
  )
    return { state, outcome: noOutcome() };
  const key = queryKeyOf(descriptor);
  const existing = state.queries.get(key) ?? makeUnresolvedQuery(observation);
  const member = observation.member as ProcessRecord["ref"];
  const memberKey = processKeyOf(member);
  const operations = existing.membershipOperations as ReadonlyMap<
    ProcessKey,
    {
      readonly member: ProcessRecord["ref"];
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
    member,
    receiptOrdinal: admitted.stamp.receiptOrdinal,
    operation: observation.operation,
  });
  let memberKeys = existing.memberKeys as ReadonlyArray<ProcessKey>;
  let unresolvedMemberKeys = existing.unresolvedMemberKeys as ReadonlyArray<ProcessKey>;
  let next = state;
  if (observation.operation === "remove") {
    memberKeys = memberKeys.filter((candidate) => candidate !== memberKey);
    unresolvedMemberKeys = unresolvedMemberKeys.filter((candidate) => candidate !== memberKey);
  } else {
    if (!memberKeys.includes(memberKey)) memberKeys = [...memberKeys, memberKey];
    next = ensureProcess(next, member);
    const record = next.processes.get(memberKey);
    const unresolved =
      record === undefined ||
      record.identity.knowledge !== "observed" ||
      record.lifecycle.knowledge !== "observed";
    if (unresolved && !unresolvedMemberKeys.includes(memberKey)) {
      unresolvedMemberKeys = [...unresolvedMemberKeys, memberKey];
    }
  }
  const queries = new Map(next.queries);
  queries.set(key, {
    ...existing,
    memberKeys,
    unresolvedMemberKeys,
    membershipOperations,
  } as unknown as ActivityQueryState);
  return { state: { ...next, queries }, outcome: noOutcome() };
}

function reduceUnavailable(
  state: ActivityState,
  scope: AccountScope,
  admitted: AdmittedObservation,
  observation: EntityUnavailableObservation,
): ActivityReduction {
  if (observation.ref.kind !== "process" || admitted.accessEvidence === null) {
    return { state, outcome: noOutcome() };
  }
  if (
    admitted.accessEvidence.accountEpoch !== scope.epoch ||
    admitted.stamp.observedAtMs > admitted.accessEvidence.deadlineMs
  )
    return { state, outcome: noOutcome() };
  const record =
    state.processes.get(processKeyOf(observation.ref)) ?? makeUnresolvedProcess(observation.ref);
  if (
    !unavailableReadIsCurrent(
      [record.identity, record.lifecycle, record.pipeline],
      observation.ticket,
    )
  )
    return { state, outcome: noOutcome() };
  return {
    state: setProcess(state, {
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
      pipeline: unavailableFacet(
        record.pipeline,
        observation,
        admitted.stamp,
        admitted.accessEvidence,
      ),
    }),
    outcome: noOutcome(),
  };
}

export function reduceActivityObservation(
  state: ActivityState,
  scope: AccountScope,
  admitted: AdmittedObservation,
): ActivityReduction {
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
  if ("ref" in observation && observation.ref.kind === "process") {
    return reduceProcessObservation(
      state,
      admitted,
      observation as Extract<EntityObservation, { readonly ref: ProcessRecord["ref"] }>,
    );
  }
  return { state, outcome: noOutcome() };
}

export function denyActivityScope(
  state: ActivityState,
  scope: AccountScope,
  denied: AccessDenialScope,
  stamp: IngestionStamp,
  dispatchOrdinal: DispatchOrdinal,
): ActivityState {
  const fence = denialFence(scope, stamp, dispatchOrdinal);
  let processes: Map<ProcessKey, ProcessRecord> | null = null;
  for (const [key, record] of state.processes) {
    if (
      denied.kind === "project" &&
      projectKeyOf(record.ref.project) !== projectKeyOf(denied.project)
    )
      continue;
    processes ??= new Map(state.processes);
    processes.set(key, {
      ...record,
      identity: denyFacet(record.identity, fence, stamp),
      lifecycle: denyFacet(record.lifecycle, fence, stamp),
      pipeline: denyFacet(record.pipeline, fence, stamp),
    });
  }
  return processes === null ? state : { ...state, processes };
}

export function releaseActivityMembershipMarkers(
  state: ActivityState,
  oldestActiveMarkerByQuery: ReadonlyMap<QueryKey, ReceiptOrdinal>,
): ActivityState {
  const queries = releaseMembershipMarkersIn(state.queries, oldestActiveMarkerByQuery);
  return queries === state.queries ? state : { ...state, queries };
}

export const isTerminalProcess = (record: ProcessRecord): boolean => {
  if (record.lifecycle.knowledge !== "observed") return false;
  const status = record.lifecycle.fields.status;
  return status === "FINISHED" || status === "FAILED" || status === "CANCELED";
};

export const isRunningProcess = (record: ProcessRecord): boolean => {
  if (record.lifecycle.knowledge !== "observed") return false;
  const status = record.lifecycle.fields.status;
  return (
    status === "PENDING" ||
    status === "RUNNING" ||
    status === "ROLLBACKING" ||
    status === "CANCELING"
  );
};
