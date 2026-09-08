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
  type AccountRef,
  type AccountScope,
  type DesiredInterestState,
  type IngestionStamp,
  type InterestIdentity,
  type ProjectRef,
  type ServiceRef,
  type ProcessRef,
  type RegistrationRequest,
  type ReadTarget,
  type ReadTicket,
} from "@t3tools/client-runtime/zerops/data";
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
  }) as ReadTicket & { readonly target: Target };
