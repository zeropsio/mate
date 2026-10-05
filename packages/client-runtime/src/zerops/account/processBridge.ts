/**
 * IN TRANSIT — owned by the app-versions slice (VERS), deleted with `flow/deploymentStore.ts`.
 *
 * The deployment store still reads a stop's running processes in the data runtime's old shapes
 * (`CollectionRead<ProcessRecord>`, a process's `ProcessStatus`). This bridge derives them, read
 * only, from the account's store — the process family's `projectProcesses` — so processes come
 * from one source: the organization's running work. Its freshness is the running scope's own
 * phase. Nothing here reads Zerops or holds a value of its own.
 *
 * @module zerops/account/processBridge
 */
import type { ProcessValue } from "../../data/families/process.ts";
import type { PublicRead } from "../../data/model.ts";
import type { ProjectProcesses } from "../../data/projections/processes.ts";
import {
  AccountEpoch,
  InterestEpoch,
  InterestKey,
  ReadStartOrdinal,
  ReceiptOrdinal,
  ReceiverEpoch,
  ZeropsProcessId,
  ZeropsReceiverId,
  ZeropsServiceId,
  queryKeyOf,
  type CollectionRead,
  type FacetAdmission,
  type IngestionStamp,
  type InterestIdentity,
  type InterestState,
  type KnownProcessStatus,
  type ProcessRecord,
  type ProcessStatus,
  type ProjectRef,
} from "../data/types.ts";

const KNOWN: ReadonlySet<string> = new Set<KnownProcessStatus>([
  "PENDING",
  "RUNNING",
  "ROLLBACKING",
  "CANCELING",
  "FINISHED",
  "FAILED",
  "CANCELED",
]);

const statusOf = (status: string): ProcessStatus =>
  KNOWN.has(status) ? (status as KnownProcessStatus) : { kind: "unknown", raw: status };

/** How a process ended as the account's store holds it; nothing while it holds no value. */
export function processStatusOf(fact: PublicRead<ProcessValue>): ProcessStatus | undefined {
  return fact.kind === "known" ? statusOf(fact.value.status) : undefined;
}

const ADMISSION: FacetAdmission = {
  lastNativeReceiptOrdinal: null,
  lastAppliedAuthoritativeDispatchOrdinal: null,
  hasAuthoritativeObservation: true,
};

/** The identity the bridge's one interest carries: not a runtime registration's. */
const IDENTITY: InterestIdentity = {
  receiver: {
    accountEpoch: AccountEpoch.make(0),
    receiverEpoch: ReceiverEpoch.make(0),
    receiverId: ZeropsReceiverId.make("account-store"),
  },
  interestEpoch: InterestEpoch.make(0),
  key: InterestKey.make("account-store:running"),
};

/** The running scope's phase as the old interest states said it. */
function interestOf(read: ProjectProcesses): InterestState {
  if (read.unavailableReason !== undefined)
    return {
      status: "failed",
      identity: IDENTITY,
      reason: read.unavailableReason,
      retryable: false,
      attempts: 1,
      retryAtMs: null,
    };
  if (read.live)
    return {
      status: "observing",
      identity: IDENTITY,
      guarantee: "source-order-unverified",
      sinceReceiptOrdinal: ReceiptOrdinal.make(0),
    };
  if (read.reconnecting)
    return {
      status: "failed",
      identity: IDENTITY,
      reason: "catching up",
      retryable: true,
      attempts: 1,
      retryAtMs: null,
    };
  return {
    status: "establishing",
    identity: IDENTITY,
    startedAtMs: 0,
    deadlineMs: 0,
    progress: {
      requiredRegistrations: 1,
      completedRegistrations: 0,
      requiredReads: 0,
      completedReads: 0,
      crossedReceiptOrdinal: ReceiptOrdinal.make(0),
    },
  };
}

function recordOf(project: ProjectRef, process: ProcessValue): ProcessRecord {
  // The platform's own clock on the row: when it was created.
  const stamp: IngestionStamp = {
    receiptOrdinal: ReceiptOrdinal.make(0),
    observedAtMs: Date.parse(process.created) || 0,
  };
  const observed = {
    unresolvedRequiredFields: [],
    source: "native-push",
    stamp,
    admission: ADMISSION,
  } as const;
  return {
    ref: { kind: "process", project, processId: ZeropsProcessId.make(process.id) },
    identity: {
      knowledge: "observed",
      fields: {
        actionName: process.actionName,
        createdAt: process.created,
        serviceIds: process.serviceStackIds.map((id) => ZeropsServiceId.make(id)),
      },
      ...observed,
    },
    lifecycle: {
      knowledge: "observed",
      fields: {
        status: statusOf(process.status),
        startedAt: process.started ?? null,
        finishedAt: process.finished ?? null,
      },
      ...observed,
    },
    pipeline: {
      knowledge: "observed",
      fields: { appVersion: process.appVersion ?? null },
      ...observed,
    },
  };
}

/** A stop's running processes as the deployment store reads them, from the account's store. */
export function runningProcessesRead(
  project: ProjectRef,
  read: ProjectProcesses,
): CollectionRead<ProcessRecord> {
  const descriptor = {
    kind: "running-processes-of-project" as const,
    project,
    statuses: ["PENDING", "RUNNING", "ROLLBACKING", "CANCELING"] as const,
    schemaVersion: 1 as const,
  };
  const common = {
    descriptor,
    key: queryKeyOf(descriptor),
    memberKeys: [],
    unresolvedMemberKeys: [],
    membershipOperations: new Map(),
  };
  return {
    project,
    value: read.running.map((process) => ({
      knowledge: "observed" as const,
      record: recordOf(project, process),
    })),
    observation: { required: [interestOf(read)], optional: [], access: { status: "unverified" } },
    // The running work is listed whole once the organization's was first read.
    query:
      read.processes === undefined
        ? {
            ...common,
            status: "unresolved",
            coverage: { kind: "none" },
            lastAppliedReadStartOrdinal: null,
          }
        : {
            ...common,
            status: "observed",
            coverage: {
              kind: "exhausted-traversal",
              traversedPages: 1,
              observedTotal: read.running.length,
              guarantee: "non-atomic",
            },
            observedTotal: read.running.length,
            source: "indexed-search",
            stamp: { receiptOrdinal: ReceiptOrdinal.make(0), observedAtMs: 0 },
            lastAppliedReadStartOrdinal: ReadStartOrdinal.make(0),
          },
  };
}
