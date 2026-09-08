import type {
  AccessState,
  AccountRef,
  AccountScope,
  DesiredInterestState,
  EntityQueryDescriptor,
  IngestionStamp,
  InterestIdentity,
  ProjectRef,
  ReadTarget,
  ReadTicket,
  RegistrationRequest,
  ServiceRef,
  ProcessRef,
  VerifiedAccessGrant,
} from "../types.ts";
import {
  AccountEpoch,
  DispatchOrdinal,
  InterestEpoch,
  InterestKey,
  ReadStartOrdinal,
  ReceiptOrdinal,
  ReceiverEpoch,
  ZeropsAccountId,
  ZeropsOrganizationId,
  ZeropsProcessId,
  ZeropsProjectId,
  ZeropsReceiverId,
  ZeropsRequestId,
  ZeropsServiceId,
  ZeropsWireSubscriptionName,
  makeZeropsApiOrigin,
  queryKeyOf,
} from "../types.ts";

export const account: AccountRef = {
  apiOrigin: makeZeropsApiOrigin("https://api.example.test"),
  accountId: ZeropsAccountId.make("account-1"),
};

export const scope = (epoch = 1): AccountScope => ({ account, epoch: AccountEpoch.make(epoch) });

export const organization = {
  kind: "organization" as const,
  account,
  organizationId: ZeropsOrganizationId.make("org-1"),
};

export const project = (id = "project-1"): ProjectRef => ({
  kind: "project",
  organization,
  projectId: ZeropsProjectId.make(id),
});

export const service = (id = "service-1", owner = project()): ServiceRef => ({
  kind: "service",
  project: owner,
  serviceId: ZeropsServiceId.make(id),
});

export const process = (id = "process-1", owner = project()): ProcessRef => ({
  kind: "process",
  project: owner,
  processId: ZeropsProcessId.make(id),
});

export const stamp = (ordinal: number, observedAtMs = ordinal * 10): IngestionStamp => ({
  receiptOrdinal: ReceiptOrdinal.make(ordinal),
  observedAtMs,
});

export const identity = (
  epoch = 1,
  receiver = 1,
  interest = 1,
  name = "interest",
): InterestIdentity => ({
  receiver: {
    accountEpoch: AccountEpoch.make(epoch),
    receiverEpoch: ReceiverEpoch.make(receiver),
    receiverId: ZeropsReceiverId.make(`receiver-${receiver}`),
  },
  interestEpoch: InterestEpoch.make(interest),
  key: InterestKey.make(name),
});

export const desiredInterest = (
  id = identity(),
  requiredReads = 0,
  required = true,
): DesiredInterestState => ({
  descriptor: { kind: "project-topology", project: project(), includeCurrentMetrics: true },
  key: id.key,
  leases: 1,
  required,
  registrationAttemptsOnReceiver: 0,
  interest: {
    status: "establishing",
    identity: id,
    startedAtMs: 0,
    deadlineMs: 60_000,
    progress: {
      requiredRegistrations: 1,
      completedRegistrations: 0,
      requiredReads,
      completedReads: 0,
      crossedReceiptOrdinal: ReceiptOrdinal.make(0),
    },
  },
  wire: {
    status: "registering",
    receiver: id.receiver,
    subscriptionName: ZeropsWireSubscriptionName.make(`wire-${id.key}`),
  },
});

export const entityRegistration = <Entity extends "project" | "service" | "process">(
  entity: Entity,
  id = identity(),
): RegistrationRequest & {
  readonly descriptor: {
    readonly kind: "entity-updates";
    readonly entity: Entity;
    readonly organization: typeof organization;
  };
} =>
  ({
    identity: id,
    subscriptionName: ZeropsWireSubscriptionName.make(`wire-${entity}`),
    descriptor: { kind: "entity-updates", entity, organization },
    baselineTicket: null,
  }) as RegistrationRequest & {
    readonly descriptor: {
      readonly kind: "entity-updates";
      readonly entity: Entity;
      readonly organization: typeof organization;
    };
  };

export const queryRegistration = <Descriptor extends EntityQueryDescriptor>(
  descriptor: Descriptor,
  id = identity(),
  baseline = queryTicket(descriptor, id, 1, 1, 1),
): RegistrationRequest & {
  readonly descriptor: { readonly kind: "query-membership"; readonly query: Descriptor };
  readonly baselineTicket: ReadTicket & {
    readonly target: { readonly kind: "query"; readonly descriptor: Descriptor };
  };
} =>
  ({
    identity: id,
    subscriptionName: ZeropsWireSubscriptionName.make(`wire-${queryKeyOf(descriptor)}`),
    descriptor: { kind: "query-membership", query: descriptor },
    baselineTicket: baseline,
  }) as RegistrationRequest & {
    readonly descriptor: { readonly kind: "query-membership"; readonly query: Descriptor };
    readonly baselineTicket: ReadTicket & {
      readonly target: { readonly kind: "query"; readonly descriptor: Descriptor };
    };
  };

export const directTicket = <Target extends ReadTarget>(
  target: Target,
  id = identity(),
  start = 1,
  receipt = 1,
  dispatch = start,
): ReadTicket & { readonly target: Target } =>
  ({
    kind: target.kind === "query" ? "baseline" : "direct",
    requestId: ZeropsRequestId.make(`request-${start}-${receipt}-${dispatch}`),
    owner: { kind: "interest", identity: id },
    target,
    receiptOrdinalAtStart: ReceiptOrdinal.make(receipt),
    readStartOrdinal: ReadStartOrdinal.make(start),
    dispatchOrdinal: DispatchOrdinal.make(dispatch),
    startedAtMs: start,
    ...(target.kind === "query" &&
    (target.descriptor.kind === "projects-of-organization" ||
      target.descriptor.kind === "services-of-project" ||
      target.descriptor.kind === "running-processes-of-project" ||
      target.descriptor.kind === "process-history-window")
      ? { membershipReceiptOrdinalAtStart: ReceiptOrdinal.make(receipt) }
      : {}),
  }) as unknown as ReadTicket & { readonly target: Target };

export const queryTicket = <Descriptor extends EntityQueryDescriptor>(
  descriptor: Descriptor,
  id = identity(),
  start = 1,
  receipt = 1,
  dispatch = start,
): ReadTicket & {
  readonly kind: "baseline";
  readonly target: { readonly kind: "query"; readonly descriptor: Descriptor };
  readonly membershipReceiptOrdinalAtStart: ReceiptOrdinal;
} =>
  directTicket(
    { kind: "query", descriptor },
    id,
    start,
    receipt,
    dispatch,
  ) as unknown as ReadTicket & {
    readonly kind: "baseline";
    readonly target: { readonly kind: "query"; readonly descriptor: Descriptor };
    readonly membershipReceiptOrdinalAtStart: ReceiptOrdinal;
  };

export const grant = (epoch = 1, deadlineMs = 10_000): VerifiedAccessGrant => ({
  account,
  accountEpoch: AccountEpoch.make(epoch),
  verifiedAtMs: 0,
  deadlineMs,
  mutationsAllowed: true,
  organizations: [{ organization, mutationsAllowed: true }],
  projects: [{ project: project(), role: "OWNER", mutationsAllowed: true }],
});

export const verifiedAccess = (epoch = 1, deadlineMs = 10_000): AccessState => ({
  status: "verified",
  ...grant(epoch, deadlineMs),
});
