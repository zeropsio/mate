import type { ZeropsDataPolicy } from "./policy.ts";
import { commandTarget } from "./commands.ts";
import { observeServiceDeploys, type ServiceDeployObserved } from "./deployedVersion.ts";
import {
  denyInventoryScope,
  makeInitialInventoryState,
  reduceInventoryObservation,
  releaseInventoryMembershipMarkers,
  type DomainObservationOutcome,
  type InventoryQueryState,
  type InventoryState,
} from "./inventory.ts";
import {
  deferFailedTableRowRead,
  makeInitialEntityTableState,
  reduceTableObservation,
  releaseTableLists,
  retryAbsentTableRows,
  tableRowsWanted,
  type EntityTableState,
} from "./entityTable.ts";
import {
  makeInitialObservabilityState,
  reduceObservabilityObservation,
  type CurrentMetricQueryState,
  type HistoryAdmission,
  type ObservabilityState,
} from "./observability.ts";
import type {
  AccessState,
  AccountRef,
  AccountScope,
  AdmittedObservation,
  CommandAttemptState,
  DispatchOrdinal,
  DesiredInterestState,
  IngestionInput,
  HistorySeriesMapKey,
  HistorySeriesState,
  InterestIdentity,
  InterestKey,
  InterestProgress,
  InterestState,
  PlatformObservation,
  ProjectRecord,
  QueryKey,
  ReadContribution,
  ReadState,
  ReadTicket,
  ReceiptOrdinal,
  RegistrationRequest,
  OrganizationRef,
  ServiceRecord,
  SharedReadOwnership,
  TableEntity,
  ZeropsCommandAttemptId,
  ZeropsRequestId,
} from "./types.ts";
import { entityKeyOf, organizationKeyOf, projectKeyOf, queryKeyOf } from "./types.ts";

interface ReadAccumulator {
  readonly applied: ReadonlyArray<ReadContribution>;
  readonly suppressed: ReadonlyArray<ReadContribution>;
  readonly unresolvedRequiredFields: ReadonlyArray<string>;
}

export type RetentionTarget =
  | {
      readonly kind: "entity";
      readonly entity: "project" | "service";
      readonly keys: ReadonlyArray<string>;
    }
  | {
      readonly kind: "current-metric";
      readonly query: QueryKey;
      readonly keys: ReadonlyArray<string>;
    }
  | {
      readonly kind: "history-bucket";
      readonly series: string;
      readonly keys: ReadonlyArray<string>;
    }
  | {
      readonly kind: "membership-marker";
      readonly query: QueryKey;
      readonly keys: ReadonlyArray<string>;
    };

export interface RetentionNotice {
  readonly id: number;
  readonly status: "partial-before-eviction" | "evicted";
  readonly reason:
    | "project-budget"
    | "service-budget"
    | "current-metric-budget"
    | "history-bucket-budget"
    | "membership-marker-budget";
  readonly target: RetentionTarget;
}

export interface RetentionState {
  readonly nextId: number;
  readonly notices: ReadonlyArray<RetentionNotice>;
  readonly pending: ReadonlyArray<RetentionNotice>;
}

export interface ZeropsDataState {
  readonly scope: AccountScope;
  readonly closed: boolean;
  readonly access: AccessState;
  readonly inventory: InventoryState;
  readonly observability: ObservabilityState;
  /** The entities held as the platform sends them (`entityTable.ts`). */
  readonly table: EntityTableState;
  readonly reads: ReadonlyMap<ZeropsRequestId, ReadState>;
  readonly readAccumulators: ReadonlyMap<ZeropsRequestId, ReadAccumulator>;
  readonly sharedReads: ReadonlyMap<ZeropsRequestId, SharedReadOwnership>;
  readonly interests: ReadonlyMap<InterestKey, DesiredInterestState>;
  readonly commands: ReadonlyMap<ZeropsCommandAttemptId, CommandAttemptState>;
  readonly retention: RetentionState;
  readonly lastReceiptOrdinal: ReceiptOrdinal | null;
  readonly lastDispatchOrdinal: DispatchOrdinal | null;
}

export type RuntimeControlInput =
  | { readonly kind: "runtime-closed" }
  | { readonly kind: "interest-upserted"; readonly interest: DesiredInterestState }
  | {
      readonly kind: "interest-released";
      readonly key: InterestKey;
      readonly identity: InterestIdentity;
    }
  | { readonly kind: "read-started"; readonly ticket: ReadTicket }
  | {
      readonly kind: "shared-read-upserted";
      readonly requestId: ZeropsRequestId;
      readonly ownership: SharedReadOwnership;
    }
  | { readonly kind: "shared-read-released"; readonly requestId: ZeropsRequestId }
  | {
      readonly kind: "metadata-retry-requested";
      readonly organization: OrganizationRef;
      readonly serviceIds: ReadonlyArray<string>;
      readonly atMs: number;
    }
  | { readonly kind: "inactive-queries-released"; readonly queryKeys: ReadonlyArray<QueryKey> }
  /** What the services whose variables are held run now, as the account's store holds them. */
  | {
      readonly kind: "service-deploys-observed";
      readonly deploys: ReadonlyArray<ServiceDeployObserved>;
      readonly atMs: number;
    };

export type ZeropsDataModelInput = IngestionInput | RuntimeControlInput;

export type ZeropsDataFollowUp =
  | {
      readonly kind: "hydrate-unresolved-query-members";
      readonly query: QueryKey;
    }
  | {
      /** Rows the entity table is owed, read by id after a short grace (`entityTable.ts`). */
      readonly kind: "read-table-rows";
      readonly entity: TableEntity;
      readonly organization: OrganizationRef;
      readonly ids: ReadonlyArray<string>;
    };

export interface ZeropsDataReduction {
  readonly state: ZeropsDataState;
  readonly followUps: ReadonlyArray<ZeropsDataFollowUp>;
}

export function makeInitialZeropsDataState(
  scope: AccountScope,
  access: AccessState = { status: "unverified" },
): ZeropsDataState {
  return {
    scope,
    closed: false,
    access,
    inventory: makeInitialInventoryState(),
    observability: makeInitialObservabilityState(),
    table: makeInitialEntityTableState(),
    reads: new Map(),
    readAccumulators: new Map(),
    sharedReads: new Map(),
    interests: new Map(),
    commands: new Map(),
    retention: { nextId: 1, notices: [], pending: [] },
    lastReceiptOrdinal: null,
    lastDispatchOrdinal: null,
  };
}

const sameAccount = (left: AccountRef, right: AccountRef): boolean =>
  left.apiOrigin === right.apiOrigin && left.accountId === right.accountId;

const sameInterestIdentity = (left: InterestIdentity, right: InterestIdentity): boolean =>
  left.key === right.key &&
  left.interestEpoch === right.interestEpoch &&
  left.receiver.receiverId === right.receiver.receiverId &&
  left.receiver.receiverEpoch === right.receiver.receiverEpoch &&
  left.receiver.accountEpoch === right.receiver.accountEpoch;

const compareInterestIdentity = (left: InterestIdentity, right: InterestIdentity): number => {
  if (left.receiver.accountEpoch !== right.receiver.accountEpoch) {
    return Number(left.receiver.accountEpoch) - Number(right.receiver.accountEpoch);
  }
  if (left.receiver.receiverEpoch !== right.receiver.receiverEpoch) {
    return Number(left.receiver.receiverEpoch) - Number(right.receiver.receiverEpoch);
  }
  return Number(left.interestEpoch) - Number(right.interestEpoch);
};

const ticketAccountEpoch = (ticket: ReadTicket): number =>
  ticket.owner.kind === "interest"
    ? ticket.owner.identity.receiver.accountEpoch
    : ticket.owner.account.epoch;

const ticketIsCurrent = (state: ZeropsDataState, ticket: ReadTicket): boolean => {
  if (ticketAccountEpoch(ticket) !== state.scope.epoch) return false;
  if (ticket.owner.kind === "interest") {
    const current = state.interests.get(ticket.owner.identity.key);
    return (
      current !== undefined &&
      sameInterestIdentity(current.interest.identity, ticket.owner.identity)
    );
  }
  const ownership = state.sharedReads.get(ticket.requestId);
  return (
    ownership !== undefined &&
    ownership.status === "active" &&
    sameAccount(ownership.owner.account.account, state.scope.account) &&
    ownership.owner.account.epoch === state.scope.epoch &&
    [...ownership.dependents.values()].some((dependent) => {
      const current = state.interests.get(dependent.key);
      return current !== undefined && sameInterestIdentity(current.interest.identity, dependent);
    })
  );
};

const registrationIsCurrent = (state: ZeropsDataState, request: RegistrationRequest): boolean => {
  const current = state.interests.get(request.identity.key);
  return (
    request.identity.receiver.accountEpoch === state.scope.epoch &&
    current !== undefined &&
    sameInterestIdentity(current.interest.identity, request.identity)
  );
};

const observationTicket = (observation: PlatformObservation): ReadTicket | null => {
  if (observation.kind === "query-baseline-observed" || observation.kind === "entity-unavailable") {
    return observation.ticket;
  }
  if (
    observation.kind === "current-metrics-replaced" ||
    observation.kind === "metric-history-window-observed" ||
    observation.kind === "table-rows-observed"
  ) {
    return observation.source === "direct-read" ? observation.ticket : null;
  }
  if (observation.kind === "table-membership-observed") return null;
  if ("observation" in observation) {
    const source = observation.observation;
    if (source.source === "direct-read" || source.source === "indexed-search") return source.ticket;
    if (source.source === "embedded" && source.cause.kind === "read") return source.cause.ticket;
  }
  return null;
};

const observationRegistration = (observation: PlatformObservation): RegistrationRequest | null => {
  if (
    observation.kind === "query-membership-observed" ||
    observation.kind === "table-membership-observed"
  )
    return observation.registration;
  if (
    observation.kind === "current-metrics-replaced" ||
    observation.kind === "metric-history-window-observed" ||
    observation.kind === "table-rows-observed"
  ) {
    return observation.source === "native-push" ? observation.registration : null;
  }
  if ("observation" in observation) {
    const source = observation.observation;
    if (source.source === "native-push") return source.registration;
    if (source.source === "embedded" && source.cause.kind === "native")
      return source.cause.registration;
  }
  return null;
};

const observationCommandEpoch = (observation: PlatformObservation): number | null => {
  if ("observation" in observation) {
    const source = observation.observation;
    if (source.source === "command-response") return source.command.accountEpoch;
    if (source.source === "embedded" && source.cause.kind === "command") {
      return source.cause.command.accountEpoch;
    }
  }
  return null;
};

function observationIsCurrent(state: ZeropsDataState, admitted: AdmittedObservation): boolean {
  const ticket = observationTicket(admitted.input);
  if (ticket !== null && !ticketIsCurrent(state, ticket)) return false;
  const registration = observationRegistration(admitted.input);
  if (registration !== null && !registrationIsCurrent(state, registration)) return false;
  const commandEpoch = observationCommandEpoch(admitted.input);
  if (commandEpoch !== null && commandEpoch !== state.scope.epoch) return false;
  if ("ref" in admitted.input) {
    const ref = admitted.input.ref;
    const account =
      ref.kind === "project" ? ref.organization.account : ref.project.organization.account;
    if (!sameAccount(account, state.scope.account)) return false;
  }
  return true;
}

const mergeUnique = <Value>(
  left: ReadonlyArray<Value>,
  right: ReadonlyArray<Value>,
): ReadonlyArray<Value> => {
  if (right.length === 0) return left;
  const next = [...left];
  for (const value of right) if (!next.includes(value)) next.push(value);
  return next;
};

function accumulateRead(
  state: ZeropsDataState,
  outcome: DomainObservationOutcome,
  ticket: ReadTicket | null,
): ZeropsDataState {
  if (outcome.readRequestId === null || ticket === null) return state;
  const requestId = ticket.requestId;
  const previous = state.readAccumulators.get(requestId) ?? {
    applied: [],
    suppressed: [],
    unresolvedRequiredFields: [],
  };
  const accumulator: ReadAccumulator = {
    applied: mergeUnique(previous.applied, outcome.applied),
    suppressed: mergeUnique(previous.suppressed, outcome.suppressed),
    unresolvedRequiredFields: mergeUnique(
      previous.unresolvedRequiredFields,
      outcome.unresolvedRequiredFields,
    ),
  };
  const readAccumulators = new Map(state.readAccumulators);
  readAccumulators.set(requestId, accumulator);
  const reads = state.reads.has(requestId)
    ? state.reads
    : new Map(state.reads).set(requestId, { status: "pending", ticket });
  return { ...state, reads, readAccumulators };
}

function reduceObservation(state: ZeropsDataState, admitted: AdmittedObservation): ZeropsDataState {
  if (!observationIsCurrent(state, admitted)) return state;
  const inventory = reduceInventoryObservation(state.inventory, state.scope, admitted);
  const observability = reduceObservabilityObservation(state.observability, admitted);
  const table = reduceTableObservation(state.table, admitted);
  const changed =
    inventory.state !== state.inventory ||
    observability.state !== state.observability ||
    table.state !== state.table;
  const outcome: DomainObservationOutcome = {
    readRequestId:
      inventory.outcome.readRequestId ??
      observability.outcome.readRequestId ??
      table.outcome.readRequestId,
    applied: mergeUnique(
      mergeUnique(inventory.outcome.applied, observability.outcome.applied),
      table.outcome.applied,
    ),
    suppressed: mergeUnique(
      mergeUnique(inventory.outcome.suppressed, observability.outcome.suppressed),
      table.outcome.suppressed,
    ),
    unresolvedRequiredFields: mergeUnique(
      inventory.outcome.unresolvedRequiredFields,
      observability.outcome.unresolvedRequiredFields,
    ),
  };
  let next = changed
    ? {
        ...state,
        inventory: inventory.state,
        observability: observability.state,
        table: table.state,
      }
    : state;
  next = accumulateRead(next, outcome, observationTicket(admitted.input));
  return next;
}

const interestProgress = (state: DesiredInterestState): InterestProgress => {
  if (state.interest.status === "establishing") {
    return state.interest.progress;
  }
  return {
    requiredRegistrations: 1,
    completedRegistrations: state.wire.status === "registered" ? 1 : 0,
    requiredReads: state.wire.status === "registered" ? 0 : 1,
    completedReads: 0,
    crossedReceiptOrdinal: 0 as ReceiptOrdinal,
  };
};

/**
 * A late failure cannot restart a paused or already failed interest. Only foreground resume
 * of healthy paused demand or a manual attempt gives those interests a fresh identity.
 */
const acceptsFailure = (interest: InterestState): boolean =>
  interest.status !== "paused" && interest.status !== "failed";

function advanceInterest(
  state: ZeropsDataState,
  identity: InterestIdentity,
  kind: "registration" | "read",
  receiptOrdinal: ReceiptOrdinal,
  failedReason?: string,
): ZeropsDataState {
  const desired = state.interests.get(identity.key);
  if (desired === undefined || !sameInterestIdentity(desired.interest.identity, identity))
    return state;
  if (!acceptsFailure(desired.interest)) return state;
  if (failedReason !== undefined) {
    const interests = new Map(state.interests);
    interests.set(identity.key, {
      ...desired,
      interest: {
        status: "failed",
        identity,
        reason: failedReason,
        attempts: 1,
        retryable: true,
        retryAtMs: null,
      },
      wire:
        kind === "registration" && desired.wire.status !== "absent"
          ? { ...desired.wire, status: "failed", reason: failedReason }
          : desired.wire,
    });
    return { ...state, interests };
  }
  const progress = interestProgress(desired);
  const nextProgress: InterestProgress = {
    ...progress,
    completedRegistrations:
      kind === "registration"
        ? Math.min(progress.requiredRegistrations, progress.completedRegistrations + 1)
        : progress.completedRegistrations,
    completedReads:
      kind === "read"
        ? Math.min(progress.requiredReads, progress.completedReads + 1)
        : progress.completedReads,
    crossedReceiptOrdinal: receiptOrdinal,
  };
  const complete =
    nextProgress.completedRegistrations >= nextProgress.requiredRegistrations &&
    nextProgress.completedReads >= nextProgress.requiredReads;
  const nextInterest: InterestState =
    complete && desired.interest.status === "observing"
      ? desired.interest
      : complete
        ? {
            status: "observing",
            identity,
            guarantee: "source-order-unverified",
            sinceReceiptOrdinal: receiptOrdinal,
          }
        : desired.interest.status === "establishing"
          ? { ...desired.interest, progress: nextProgress }
          : desired.interest;
  const nextWire =
    kind === "registration" && desired.wire.status !== "absent"
      ? { ...desired.wire, status: "registered" as const }
      : desired.wire;
  if (nextInterest === desired.interest && nextWire === desired.wire) return state;
  const interests = new Map(state.interests);
  interests.set(identity.key, {
    ...desired,
    interest: nextInterest,
    wire: nextWire,
  });
  return { ...state, interests };
}

function completeRead(
  state: ZeropsDataState,
  input: Extract<IngestionInput, { readonly kind: "read-completion" }>,
): ZeropsDataState {
  const ticket = input.completion.ticket;
  if (!ticketIsCurrent(state, ticket)) return state;
  const accumulator = state.readAccumulators.get(ticket.requestId) ?? {
    applied: [],
    suppressed: [],
    unresolvedRequiredFields: [],
  };
  const target = ticket.target;
  let table = state.table;
  let incomplete = false;
  if (
    target.kind === "query" &&
    target.descriptor.kind === "service-variables-of-services" &&
    target.descriptor.ids !== undefined
  ) {
    const entity = "user-data";
    // A failed read asks again after its wait; a read that answered settled each id itself.
    if (input.completion.kind === "read-failed")
      table = deferFailedTableRowRead(
        state.table,
        entity,
        target.descriptor.organization,
        target.descriptor.ids,
        ticket.receiptOrdinalAtStart,
        input.stamp.observedAtMs,
      );
    incomplete = target.descriptor.ids.some((id) => {
      const owed = table.wanted.get(`${entity}:${id}`);
      return owed !== undefined && owed.since <= ticket.receiptOrdinalAtStart;
    });
  } else if (ticket.kind === "hydration" && target.kind !== "query") {
    const key = entityKeyOf(target.ref);
    incomplete = [...state.inventory.queries.values()].some((query) =>
      query.unresolvedMemberKeys.some((memberKey) => memberKey === key),
    );
  }
  const reads = new Map(state.reads);
  reads.set(
    ticket.requestId,
    input.completion.kind === "read-succeeded" && !incomplete
      ? {
          status: "succeeded",
          ticket,
          completedAtReceiptOrdinal: input.stamp.receiptOrdinal,
          appliedFacets: accumulator.applied,
          suppressedFacets: accumulator.suppressed,
          unresolvedRequiredFields: accumulator.unresolvedRequiredFields,
        }
      : {
          status: "failed",
          ticket,
          completedAtReceiptOrdinal: input.stamp.receiptOrdinal,
          failure:
            input.completion.kind === "read-failed" ? input.completion.failure : "incomplete",
        },
  );
  let readAccumulators = state.readAccumulators;
  if (state.readAccumulators.has(ticket.requestId)) {
    const retained = new Map(state.readAccumulators);
    retained.delete(ticket.requestId);
    readAccumulators = retained;
  }
  let next: ZeropsDataState = { ...state, table, reads, readAccumulators };
  if (ticket.owner.kind === "interest") {
    next = advanceInterest(
      next,
      ticket.owner.identity,
      "read",
      input.stamp.receiptOrdinal,
      input.completion.kind === "read-failed" ? input.completion.failure : undefined,
    );
  }
  return releaseObsoleteMembershipMarkers(next);
}

function releaseObsoleteMembershipMarkers(state: ZeropsDataState): ZeropsDataState {
  const activeMarkers = new Map<QueryKey, ReceiptOrdinal>();
  for (const read of state.reads.values()) {
    if (read.status !== "pending" || read.ticket.target.kind !== "query") continue;
    if (read.ticket.membershipReceiptOrdinalAtStart === undefined) continue;
    const query = queryKeyOf(read.ticket.target.descriptor);
    const previous = activeMarkers.get(query);
    if (previous === undefined || read.ticket.membershipReceiptOrdinalAtStart < previous) {
      activeMarkers.set(query, read.ticket.membershipReceiptOrdinalAtStart);
    }
  }
  const inventory = releaseInventoryMembershipMarkers(state.inventory, activeMarkers);
  return inventory === state.inventory ? state : { ...state, inventory };
}

function cancelPendingReads(
  state: ZeropsDataState,
  matches: (ticket: ReadTicket) => boolean,
): ZeropsDataState {
  let reads: Map<ZeropsRequestId, ReadState> | null = null;
  let readAccumulators: Map<ZeropsRequestId, ReadAccumulator> | null = null;
  const completedAtReceiptOrdinal = state.lastReceiptOrdinal ?? (0 as ReceiptOrdinal);
  for (const [requestId, read] of state.reads) {
    if (read.status !== "pending" || !matches(read.ticket)) continue;
    reads ??= new Map(state.reads);
    reads.set(requestId, {
      status: "failed",
      ticket: read.ticket,
      completedAtReceiptOrdinal,
      failure: "cancelled",
    });
    if (state.readAccumulators.has(requestId)) {
      readAccumulators ??= new Map(state.readAccumulators);
      readAccumulators.delete(requestId);
    }
  }
  if (reads === null) return state;
  return releaseObsoleteMembershipMarkers({
    ...state,
    reads,
    readAccumulators: readAccumulators ?? state.readAccumulators,
  });
}

function reduceAccess(
  state: ZeropsDataState,
  input: Extract<IngestionInput, { readonly kind: "access-observation" }>,
): ZeropsDataState {
  const observation = input.observation;
  if (
    (observation.kind === "access-verified"
      ? observation.grant.accountEpoch
      : observation.accountEpoch) !== state.scope.epoch
  )
    return state;
  if (observation.kind === "access-verification-started") {
    const previous =
      state.access.status === "verified"
        ? state.access
        : "previous" in state.access
          ? state.access.previous
          : null;
    return { ...state, access: { status: "verifying", accountEpoch: state.scope.epoch, previous } };
  }
  if (observation.kind === "access-verified") {
    if (!sameAccount(observation.grant.account, state.scope.account)) return state;
    return { ...state, access: { status: "verified", ...observation.grant } };
  }
  if (observation.kind === "project-access-established") {
    if (
      state.access.status !== "verified" ||
      !sameAccount(observation.project.organization.account, state.scope.account) ||
      !state.access.organizations.some(
        (entry) =>
          organizationKeyOf(entry.organization) ===
            organizationKeyOf(observation.project.organization) && entry.mutationsAllowed,
      ) ||
      state.access.projects.some(
        (entry) => projectKeyOf(entry.project) === projectKeyOf(observation.project),
      )
    ) {
      return state;
    }
    return {
      ...state,
      access: {
        ...state.access,
        projects: [
          ...state.access.projects,
          { project: observation.project, role: "OWNER", mutationsAllowed: true },
        ],
      },
    };
  }
  if (observation.kind === "access-verification-failed") {
    const previous =
      state.access.status === "verified"
        ? state.access
        : "previous" in state.access
          ? state.access.previous
          : null;
    return {
      ...state,
      access: {
        status: "failed",
        accountEpoch: state.scope.epoch,
        failedAtMs: observation.failedAtMs,
        retryable: observation.retryable,
        reason: observation.reason,
        previous,
        mutationsAllowed: false,
      },
    };
  }
  if (observation.kind === "access-expired") {
    const previous =
      state.access.status === "verified"
        ? state.access
        : "previous" in state.access
          ? state.access.previous
          : null;
    return previous === null
      ? state
      : {
          ...state,
          access: {
            status: "expired",
            accountEpoch: state.scope.epoch,
            expiredAtMs: observation.expiredAtMs,
            previous,
          },
        };
  }
  const previous =
    state.access.status === "verified"
      ? state.access
      : "previous" in state.access
        ? state.access.previous
        : null;
  const access: AccessState = {
    status: "denied",
    accountEpoch: state.scope.epoch,
    scope: observation.scope,
    deniedAtMs: observation.deniedAtMs,
    previous,
  };
  return {
    ...state,
    access,
    inventory: denyInventoryScope(
      state.inventory,
      state.scope,
      observation.scope,
      input.stamp,
      state.lastDispatchOrdinal ?? (0 as DispatchOrdinal),
    ),
  };
}

const commandAdmissionReason = (
  state: ZeropsDataState,
  input: Extract<IngestionInput, { readonly kind: "command-execution-requested" }>,
): string | null => {
  const command = input.request.command;
  if (command.accountEpoch !== state.scope.epoch) return "account generation changed";
  if (state.access.status !== "verified") return `access is ${state.access.status}`;
  if (input.stamp.observedAtMs > state.access.deadlineMs) return "access expired";
  if (!state.access.mutationsAllowed) return "account mutations are denied";
  const target = commandTarget(command);
  const project =
    target.kind === "organization" ? null : target.kind === "project" ? target : target.project;
  if (project !== null) {
    const role = state.access.projects.find(
      (candidate) => projectKeyOf(candidate.project) === projectKeyOf(project),
    );
    if (role === undefined || !role.mutationsAllowed) return "project mutations are denied";
  }
  return null;
};

function reduceCommandRequest(
  state: ZeropsDataState,
  input: Extract<IngestionInput, { readonly kind: "command-execution-requested" }>,
): ZeropsDataState {
  const command = input.request.command;
  if (
    command.accountEpoch !== state.scope.epoch ||
    state.commands.has(command.attemptId) ||
    (state.lastDispatchOrdinal !== null && command.dispatchOrdinal <= state.lastDispatchOrdinal)
  )
    return state;
  const reason = commandAdmissionReason(state, input);
  const attempt: CommandAttemptState = {
    attemptId: command.attemptId,
    accountEpoch: command.accountEpoch,
    commandKind: command.kind,
    target: commandTarget(command),
    requestedAtMs: input.request.enqueuedAtMs,
    startedAtReceiptOrdinal: command.startedAtReceiptOrdinal,
    ...(reason === null ? { status: "pending" as const } : { status: "rejected" as const, reason }),
  };
  const commands = new Map(state.commands);
  commands.set(command.attemptId, attempt);
  return { ...state, commands, lastDispatchOrdinal: command.dispatchOrdinal };
}

function reduceCommandCompletion(
  state: ZeropsDataState,
  input: Extract<IngestionInput, { readonly kind: "command-completion" }>,
): ZeropsDataState {
  const completion = input.completion;
  if (completion.command.accountEpoch !== state.scope.epoch) return state;
  const existing = state.commands.get(completion.command.attemptId);
  if (existing === undefined || existing.status !== "pending") return state;
  const attempt: CommandAttemptState =
    completion.kind === "command-accepted"
      ? { ...existing, status: "accepted" }
      : completion.kind === "command-rejected"
        ? { ...existing, status: "rejected", reason: completion.reason }
        : { ...existing, status: "uncertain", reason: completion.reason };
  const commands = new Map(state.commands);
  commands.set(completion.command.attemptId, attempt);
  return { ...state, commands };
}

function reduceRegistrationCompletion(
  state: ZeropsDataState,
  input: Extract<IngestionInput, { readonly kind: "registration-completion" }>,
): ZeropsDataState {
  const request = input.completion.request;
  if (!registrationIsCurrent(state, request)) return state;
  return advanceInterest(
    state,
    request.identity,
    "registration",
    input.stamp.receiptOrdinal,
    input.completion.kind === "registration-failed" ? input.completion.reason : undefined,
  );
}

function releaseInactiveQueries(
  state: ZeropsDataState,
  queryKeys: ReadonlyArray<QueryKey>,
): ZeropsDataState {
  if (queryKeys.length === 0) return state;
  const released = new Set(queryKeys);
  let next = cancelPendingReads(
    state,
    (ticket) =>
      ticket.target.kind === "query" && released.has(queryKeyOf(ticket.target.descriptor)),
  );
  let inventoryQueries: Map<QueryKey, InventoryQueryState> | null = null;
  let current: Map<QueryKey, CurrentMetricQueryState> | null = null;
  for (const key of released) {
    if (next.inventory.queries.has(key)) {
      inventoryQueries ??= new Map(next.inventory.queries);
      inventoryQueries.delete(key);
    }
    if (next.observability.current.has(key)) {
      current ??= new Map(next.observability.current);
      current.delete(key);
    }
  }

  let history: Map<HistorySeriesMapKey, HistorySeriesState> | null = null;
  let historyAdmission: Map<HistorySeriesMapKey, HistoryAdmission> | null = null;
  for (const [seriesKey, series] of next.observability.history) {
    const key = queryKeyOf({
      kind: "metric-history-of-project",
      project: series.key.service.project,
      groupBy: series.key.groupBy,
      window: series.key.window,
      schemaVersion: series.key.schemaVersion,
    });
    if (!released.has(key)) continue;
    history ??= new Map(next.observability.history);
    historyAdmission ??= new Map(next.observability.historyAdmission);
    history.delete(seriesKey);
    historyAdmission.delete(seriesKey);
  }
  const table = releaseTableLists(next.table, released);
  if (table !== next.table) next = { ...next, table };
  if (inventoryQueries === null && current === null && history === null) return next;

  let inventory = next.inventory;
  if (inventoryQueries !== null) {
    const inventoryMemberKeys = new Set<string>();
    for (const query of inventoryQueries.values()) {
      for (const key of query.memberKeys) inventoryMemberKeys.add(key);
      for (const key of query.membershipOperations.keys()) inventoryMemberKeys.add(key);
    }
    const memberRefs = new Map(
      [...inventory.memberRefs].filter(([key]) => inventoryMemberKeys.has(key)),
    );
    inventory = { ...inventory, queries: inventoryQueries, memberRefs };
  }

  const observability =
    current === null && history === null
      ? next.observability
      : {
          ...next.observability,
          current: current ?? next.observability.current,
          history: history ?? next.observability.history,
          historyAdmission: historyAdmission ?? next.observability.historyAdmission,
        };
  next = {
    ...next,
    inventory,
    observability,
  };
  return next;
}

function applyControl(state: ZeropsDataState, input: RuntimeControlInput): ZeropsDataState {
  if (input.kind === "runtime-closed") {
    if (state.closed) return state;
    return {
      ...state,
      closed: true,
      access: { status: "unverified" },
      inventory: makeInitialInventoryState(),
      observability: makeInitialObservabilityState(),
      reads: new Map(),
      readAccumulators: new Map(),
      sharedReads: new Map(),
      interests: new Map(),
      commands: new Map(),
      retention: { ...state.retention, notices: [], pending: [] },
    };
  }
  if (state.closed) return state;
  if (input.kind === "interest-upserted") {
    if (input.interest.interest.identity.receiver.accountEpoch !== state.scope.epoch) return state;
    const current = state.interests.get(input.interest.key);
    if (current !== undefined) {
      const ordering = compareInterestIdentity(
        input.interest.interest.identity,
        current.interest.identity,
      );
      if (ordering < 0) return state;
      if (
        ordering === 0 &&
        !sameInterestIdentity(input.interest.interest.identity, current.interest.identity)
      ) {
        return state;
      }
    }
    if (current === input.interest) return state;
    const interests = new Map(state.interests);
    interests.set(input.interest.key, input.interest);
    const next = { ...state, interests };
    return current !== undefined &&
      !sameInterestIdentity(current.interest.identity, input.interest.interest.identity)
      ? cancelPendingReads(
          next,
          (ticket) =>
            ticket.owner.kind === "interest" &&
            sameInterestIdentity(ticket.owner.identity, current.interest.identity),
        )
      : next;
  }
  if (input.kind === "interest-released") {
    const current = state.interests.get(input.key);
    if (current === undefined || !sameInterestIdentity(current.interest.identity, input.identity))
      return state;
    const interests = new Map(state.interests);
    interests.delete(input.key);
    return cancelPendingReads(
      { ...state, interests },
      (ticket) =>
        ticket.owner.kind === "interest" &&
        sameInterestIdentity(ticket.owner.identity, input.identity),
    );
  }
  if (input.kind === "read-started") {
    if (
      !ticketIsCurrent(state, input.ticket) ||
      state.reads.has(input.ticket.requestId) ||
      (state.lastDispatchOrdinal !== null &&
        input.ticket.dispatchOrdinal <= state.lastDispatchOrdinal)
    )
      return state;
    const reads = new Map(state.reads);
    reads.set(input.ticket.requestId, { status: "pending", ticket: input.ticket });
    return { ...state, reads, lastDispatchOrdinal: input.ticket.dispatchOrdinal };
  }
  if (input.kind === "shared-read-upserted") {
    const ownership = input.ownership;
    if (
      ownership.owner.account.epoch !== state.scope.epoch ||
      !sameAccount(ownership.owner.account.account, state.scope.account)
    )
      return state;
    const sharedReads = new Map(state.sharedReads);
    sharedReads.set(input.requestId, ownership);
    const next = { ...state, sharedReads };
    return ownership.status === "active"
      ? next
      : cancelPendingReads(next, (ticket) => ticket.requestId === input.requestId);
  }
  if (input.kind === "metadata-retry-requested") {
    const table = retryAbsentTableRows(
      state.table,
      input.organization,
      input.serviceIds,
      input.atMs,
    );
    return table === state.table ? state : { ...state, table };
  }
  if (input.kind === "inactive-queries-released") {
    return releaseInactiveQueries(state, input.queryKeys);
  }
  if (input.kind === "service-deploys-observed") {
    return observeServiceDeploys(state, input.deploys, input.atMs);
  }
  const sharedReads = new Map(state.sharedReads);
  if (!sharedReads.delete(input.requestId)) return state;
  return cancelPendingReads(
    { ...state, sharedReads },
    (ticket) => ticket.requestId === input.requestId,
  );
}

function applyPendingRetention(state: ZeropsDataState): ZeropsDataState {
  if (state.retention.pending.length === 0) return state;
  let inventory = state.inventory;
  let observability = state.observability;
  const overflowingMembershipQueries = new Set<QueryKey>();
  for (const notice of state.retention.pending) {
    if (notice.target.kind === "entity") {
      if (notice.target.entity === "project") {
        const projects = new Map(inventory.projects);
        for (const key of notice.target.keys) projects.delete(key as never);
        inventory = { ...inventory, projects };
      } else {
        const services = new Map(inventory.services);
        for (const key of notice.target.keys) services.delete(key as never);
        inventory = { ...inventory, services };
      }
    } else if (notice.target.kind === "current-metric") {
      const query = observability.current.get(notice.target.query);
      if (query !== undefined) {
        const samples = new Map(query.samples);
        for (const key of notice.target.keys) samples.delete(key as never);
        const current = new Map(observability.current);
        current.set(notice.target.query, {
          ...query,
          samples,
          coverage: { kind: "partial", reason: "budget" },
        });
        observability = { ...observability, current };
      }
    } else if (notice.target.kind === "history-bucket") {
      const series = observability.history.get(notice.target.series as never);
      if (series !== undefined) {
        const buckets = new Map(series.buckets);
        for (const key of notice.target.keys) buckets.delete(key as never);
        const history = new Map(observability.history);
        history.set(notice.target.series as never, {
          ...series,
          buckets,
          coverage: { kind: "partial", reason: "budget" },
        });
        observability = { ...observability, history };
      }
    } else {
      overflowingMembershipQueries.add(notice.target.query);
      const inventoryQuery = inventory.queries.get(notice.target.query);
      if (inventoryQuery !== undefined) {
        const membershipOperations = new Map(
          inventoryQuery.membershipOperations as ReadonlyMap<string, unknown>,
        );
        for (const key of notice.target.keys) membershipOperations.delete(key as never);
        const queries = new Map(inventory.queries);
        queries.set(notice.target.query, {
          ...inventoryQuery,
          membershipOperations,
          coverage: { kind: "partial", reason: "budget" },
        } as unknown as typeof inventoryQuery);
        inventory = { ...inventory, queries };
      }
    }
  }
  const evicted = state.retention.pending.map((notice) => ({
    ...notice,
    status: "evicted" as const,
  }));
  let next: ZeropsDataState = {
    ...state,
    inventory,
    observability,
    retention: {
      ...state.retention,
      notices: [
        ...state.retention.notices.filter((notice) => notice.status !== "partial-before-eviction"),
        ...evicted,
      ].slice(-64),
      pending: [],
    },
  };
  if (overflowingMembershipQueries.size === 0) return next;

  let interests: Map<InterestKey, DesiredInterestState> | null = null;
  const fail = (identity: InterestIdentity): void => {
    const desired = next.interests.get(identity.key);
    if (
      desired === undefined ||
      !sameInterestIdentity(desired.interest.identity, identity) ||
      !acceptsFailure(desired.interest)
    )
      return;
    interests ??= new Map(next.interests);
    interests.set(identity.key, {
      ...desired,
      interest: {
        status: "failed",
        identity,
        reason: "overflow",
        attempts: 1,
        // Updates were lost past the budget: a person's again reads a fresh baseline.
        retryable: false,
        retryAtMs: null,
      },
    });
  };
  for (const read of next.reads.values()) {
    if (read.status !== "pending" || read.ticket.target.kind !== "query") continue;
    if (!overflowingMembershipQueries.has(queryKeyOf(read.ticket.target.descriptor))) continue;
    if (read.ticket.owner.kind === "interest") {
      fail(read.ticket.owner.identity);
    } else {
      const ownership = next.sharedReads.get(read.ticket.requestId);
      if (ownership !== undefined) {
        for (const dependent of ownership.dependents.values()) fail(dependent);
      }
    }
  }
  if (interests !== null) next = { ...next, interests };
  return cancelPendingReads(
    next,
    (ticket) =>
      ticket.target.kind === "query" &&
      overflowingMembershipQueries.has(queryKeyOf(ticket.target.descriptor)),
  );
}

const facetReceiptOrdinal = (
  facet:
    | ProjectRecord["identity"]
    | ProjectRecord["lifecycle"]
    | ProjectRecord["presentation"]
    | ProjectRecord["placement"]
    | ServiceRecord["identity"]
    | ServiceRecord["lifecycle"]
    | ServiceRecord["routing"]
    | ServiceRecord["deployment"]
    | ServiceRecord["scaling"],
): number => (facet.knowledge === "unresolved" ? 0 : Number(facet.stamp.receiptOrdinal));

const projectReceiptOrdinal = (record: ProjectRecord): number =>
  Math.max(
    facetReceiptOrdinal(record.identity),
    facetReceiptOrdinal(record.lifecycle),
    facetReceiptOrdinal(record.presentation),
    facetReceiptOrdinal(record.placement),
  );

const serviceReceiptOrdinal = (record: ServiceRecord): number =>
  Math.max(
    facetReceiptOrdinal(record.identity),
    facetReceiptOrdinal(record.lifecycle),
    facetReceiptOrdinal(record.routing),
    facetReceiptOrdinal(record.deployment),
    facetReceiptOrdinal(record.scaling),
  );

function trimCompletedReads(state: ZeropsDataState, policy: ZeropsDataPolicy): ZeropsDataState {
  if (state.reads.size <= policy.retainedCompletedReadsPerAccount) return state;
  const completedEntries = [...state.reads.entries()].filter(
    (entry): entry is [ZeropsRequestId, Exclude<ReadState, { readonly status: "pending" }>] =>
      entry[1].status !== "pending",
  );
  const excess = completedEntries.length - policy.retainedCompletedReadsPerAccount;
  if (excess <= 0) return state;
  const completed = [...completedEntries].sort(
    ([leftKey, left], [rightKey, right]) =>
      Number(left.completedAtReceiptOrdinal) - Number(right.completedAtReceiptOrdinal) ||
      String(leftKey).localeCompare(String(rightKey)),
  );
  const reads = new Map(state.reads);
  const readAccumulators = new Map(state.readAccumulators);
  for (const [requestId] of completed.slice(0, excess)) {
    reads.delete(requestId);
    readAccumulators.delete(requestId);
  }
  return { ...state, reads, readAccumulators };
}

function trimTerminalCommands(state: ZeropsDataState, policy: ZeropsDataPolicy): ZeropsDataState {
  if (state.commands.size < policy.retainedCommandAttemptsPerAccount) return state;
  const terminalEntries = [...state.commands.entries()].filter(
    (
      entry,
    ): entry is [
      ZeropsCommandAttemptId,
      Exclude<CommandAttemptState, { readonly status: "pending" }>,
    ] => entry[1].status !== "pending",
  );
  const pendingCount = state.commands.size - terminalEntries.length;
  const retainedTotal = Math.max(pendingCount, policy.retainedCommandAttemptsPerAccount - 1);
  const excess = state.commands.size - retainedTotal;
  if (excess <= 0) return state;
  const terminal = [...terminalEntries].sort(
    ([leftKey, left], [rightKey, right]) =>
      Number(left.startedAtReceiptOrdinal) - Number(right.startedAtReceiptOrdinal) ||
      left.requestedAtMs - right.requestedAtMs ||
      String(leftKey).localeCompare(String(rightKey)),
  );
  const commands = new Map(state.commands);
  for (const [attemptId] of terminal.slice(0, excess)) commands.delete(attemptId);
  return { ...state, commands };
}

const trimDiagnostics = (state: ZeropsDataState, policy: ZeropsDataPolicy): ZeropsDataState =>
  trimTerminalCommands(trimCompletedReads(state, policy), policy);

function markRetentionViewsPartial(
  state: ZeropsDataState,
  notices: ReadonlyArray<RetentionNotice>,
): ZeropsDataState {
  const projectKeys = new Set<string>();
  const serviceKeys = new Set<string>();
  const queryKeys = new Set<QueryKey>();
  const currentQueryKeys = new Set<QueryKey>();
  const historySeriesKeys = new Set<string>();
  for (const notice of notices) {
    if (notice.target.kind === "entity") {
      const target = notice.target.entity === "project" ? projectKeys : serviceKeys;
      for (const key of notice.target.keys) target.add(key);
    } else if (notice.target.kind === "membership-marker") {
      queryKeys.add(notice.target.query);
    } else if (notice.target.kind === "current-metric") {
      currentQueryKeys.add(notice.target.query);
    } else {
      historySeriesKeys.add(notice.target.series);
    }
  }

  const serviceOrganizations = new Set<string>();
  for (const [key, record] of state.inventory.services) {
    if (serviceKeys.has(key))
      serviceOrganizations.add(organizationKeyOf(record.ref.project.organization));
  }

  let inventoryQueries: Map<QueryKey, InventoryQueryState> | null = null;
  for (const [key, query] of state.inventory.queries) {
    const entityKeys =
      query.descriptor.kind === "projects-of-organization" ? projectKeys : serviceKeys;
    const affected =
      queryKeys.has(key) ||
      query.memberKeys.some((memberKey) => entityKeys.has(memberKey)) ||
      (query.descriptor.kind === "services-of-project" &&
        serviceOrganizations.has(organizationKeyOf(query.descriptor.project.organization)));
    if (!affected) continue;
    inventoryQueries ??= new Map(state.inventory.queries);
    inventoryQueries.set(key, {
      ...query,
      coverage: { kind: "partial", reason: "budget" },
    } as InventoryQueryState);
  }

  let current: Map<QueryKey, CurrentMetricQueryState> | null = null;
  for (const key of currentQueryKeys) {
    const query = state.observability.current.get(key);
    if (query === undefined) continue;
    current ??= new Map(state.observability.current);
    current.set(key, { ...query, coverage: { kind: "partial", reason: "budget" } });
  }
  let history: Map<HistorySeriesMapKey, HistorySeriesState> | null = null;
  for (const key of historySeriesKeys) {
    const series = state.observability.history.get(key as HistorySeriesMapKey);
    if (series === undefined) continue;
    history ??= new Map(state.observability.history);
    history.set(key as HistorySeriesMapKey, {
      ...series,
      coverage: { kind: "partial", reason: "budget" },
    });
  }

  if (inventoryQueries === null && current === null && history === null) return state;
  return {
    ...state,
    inventory:
      inventoryQueries === null
        ? state.inventory
        : { ...state.inventory, queries: inventoryQueries },
    observability: {
      ...state.observability,
      current: current ?? state.observability.current,
      history: history ?? state.observability.history,
    },
  };
}

function scheduleRetention(state: ZeropsDataState, policy: ZeropsDataPolicy): ZeropsDataState {
  if (state.retention.pending.length > 0) return state;
  const notices: RetentionNotice[] = [];
  const addNotice = (reason: RetentionNotice["reason"], target: RetentionTarget): void => {
    notices.push({
      id: state.retention.nextId + notices.length,
      status: "partial-before-eviction",
      reason,
      target,
    });
  };

  if (state.inventory.projects.size > policy.retainedProjectsPerAccount) {
    const projects = [...state.inventory.projects.entries()].sort(
      ([leftKey, left], [rightKey, right]) =>
        projectReceiptOrdinal(left) - projectReceiptOrdinal(right) ||
        String(leftKey).localeCompare(String(rightKey)),
    );
    addNotice("project-budget", {
      kind: "entity",
      entity: "project",
      keys: projects
        .slice(0, projects.length - policy.retainedProjectsPerAccount)
        .map(([key]) => key),
    });
  }

  if (state.inventory.services.size > policy.retainedServicesPerAccount) {
    const services = [...state.inventory.services.entries()].sort(
      ([leftKey, left], [rightKey, right]) =>
        serviceReceiptOrdinal(left) - serviceReceiptOrdinal(right) ||
        String(leftKey).localeCompare(String(rightKey)),
    );
    addNotice("service-budget", {
      kind: "entity",
      entity: "service",
      keys: services
        .slice(0, services.length - policy.retainedServicesPerAccount)
        .map(([key]) => key),
    });
  }

  let totalCurrentSamples = 0;
  for (const value of state.observability.current.values())
    totalCurrentSamples += value.samples.size;
  if (totalCurrentSamples > policy.retainedCurrentMetricSamplesPerAccount) {
    const currentSamples = [...state.observability.current.entries()]
      .flatMap(([query, value]) =>
        [...value.samples.keys()].map((key) => ({
          query,
          key,
          receiptOrdinal: value.stamp.receiptOrdinal,
        })),
      )
      .sort(
        (left, right) =>
          Number(left.receiptOrdinal) - Number(right.receiptOrdinal) ||
          String(left.key).localeCompare(String(right.key)),
      );
    const currentExcess = currentSamples.length - policy.retainedCurrentMetricSamplesPerAccount;
    if (currentExcess > 0) {
      const keysByQuery = new Map<QueryKey, string[]>();
      for (const sample of currentSamples.slice(0, currentExcess)) {
        const keys = keysByQuery.get(sample.query) ?? [];
        keysByQuery.set(sample.query, [...keys, sample.key]);
      }
      for (const [query, keys] of keysByQuery) {
        addNotice("current-metric-budget", { kind: "current-metric", query, keys });
      }
    }
  }

  for (const [seriesKey, series] of state.observability.history) {
    if (series.buckets.size <= policy.retainedHistoryBucketsPerSeries) continue;
    const buckets = [...series.buckets.entries()].sort(
      ([leftKey, left], [rightKey, right]) =>
        left.key.from.localeCompare(right.key.from) ||
        left.key.till.localeCompare(right.key.till) ||
        String(leftKey).localeCompare(String(rightKey)),
    );
    addNotice("history-bucket-budget", {
      kind: "history-bucket",
      series: seriesKey,
      keys: buckets
        .slice(0, series.buckets.size - policy.retainedHistoryBucketsPerSeries)
        .map(([key]) => key),
    });
  }

  for (const [query, value] of state.inventory.queries) {
    if (value.membershipOperations.size <= policy.membershipMarkersPerQuery) continue;
    const operations = [...value.membershipOperations.entries()].sort(
      ([leftKey, left], [rightKey, right]) =>
        Number(left.receiptOrdinal) - Number(right.receiptOrdinal) ||
        String(leftKey).localeCompare(String(rightKey)),
    );
    addNotice("membership-marker-budget", {
      kind: "membership-marker",
      query,
      keys: operations
        .slice(0, value.membershipOperations.size - policy.membershipMarkersPerQuery)
        .map(([key]) => key),
    });
  }
  if (notices.length === 0) return state;
  const partial = markRetentionViewsPartial(state, notices);
  return {
    ...partial,
    retention: {
      nextId: state.retention.nextId + notices.length,
      notices: [...state.retention.notices, ...notices].slice(-64),
      pending: notices,
    },
  };
}

export function reduceZeropsDataState(
  initial: ZeropsDataState,
  input: ZeropsDataModelInput,
  policy: ZeropsDataPolicy,
): ZeropsDataReduction {
  if (input.kind === "runtime-closed") {
    return { state: applyControl(initial, input), followUps: [] };
  }
  if (initial.closed) return { state: initial, followUps: [] };
  if (
    input.kind === "interest-upserted" ||
    input.kind === "interest-released" ||
    input.kind === "read-started" ||
    input.kind === "shared-read-upserted" ||
    input.kind === "shared-read-released" ||
    input.kind === "inactive-queries-released" ||
    input.kind === "metadata-retry-requested" ||
    input.kind === "service-deploys-observed"
  ) {
    const state = trimDiagnostics(applyControl(applyPendingRetention(initial), input), policy);
    return { state, followUps: [] };
  }

  const stamp = input.kind === "observation" ? input.observation.stamp : input.stamp;
  if (initial.lastReceiptOrdinal !== null && stamp.receiptOrdinal <= initial.lastReceiptOrdinal) {
    return { state: initial, followUps: [] };
  }
  let state = applyPendingRetention(initial);
  if (input.kind === "observation") state = reduceObservation(state, input.observation);
  else if (input.kind === "read-completion") state = completeRead(state, input);
  else if (input.kind === "registration-completion")
    state = reduceRegistrationCompletion(state, input);
  else if (input.kind === "access-observation") state = reduceAccess(state, input);
  else if (input.kind === "command-execution-requested") state = reduceCommandRequest(state, input);
  else if (input.kind === "command-completion") state = reduceCommandCompletion(state, input);

  if (state === initial) return { state: initial, followUps: [] };
  state = { ...state, lastReceiptOrdinal: stamp.receiptOrdinal };
  state = trimDiagnostics(state, policy);
  state = scheduleRetention(state, policy);
  const followUps: ZeropsDataFollowUp[] = [];
  for (const query of state.inventory.queries.values()) {
    if (query.unresolvedMemberKeys.length > 0) {
      followUps.push({ kind: "hydrate-unresolved-query-members", query: query.key });
    }
  }
  for (const wanted of tableRowsWanted(state.table))
    followUps.push({ kind: "read-table-rows", ...wanted });
  return { state, followUps };
}
