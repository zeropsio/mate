/**
 * A project's running processes as the data runtime publishes them, for the flow's tests: a
 * `stack.build` names the service it builds for and the app version it builds (A11), listed
 * completely unless a test says otherwise.
 */
import { identity, process, project, stamp } from "../../data/__fixtures__/index.ts";
import {
  ReadStartOrdinal,
  ReceiptOrdinal,
  ZeropsServiceId,
  queryKeyOf,
  type CollectionRead,
  type FacetAdmission,
  type InterestState,
  type ProcessRecord,
  type ProjectRef,
  type QueryCoverage,
} from "../../data/types.ts";

const admission: FacetAdmission = {
  lastNativeReceiptOrdinal: null,
  lastAppliedAuthoritativeDispatchOrdinal: null,
  hasAuthoritativeObservation: true,
};

/** A running process for the services; `appVersion` only on a build. */
export function runningProcess(
  id: string,
  options: {
    readonly actionName?: string;
    readonly serviceIds: ReadonlyArray<string>;
    readonly appVersion?: { readonly id: string; readonly name?: string; readonly status?: string };
    readonly project?: ProjectRef;
  },
): ProcessRecord {
  return {
    ref: process(id, options.project),
    identity: {
      knowledge: "observed",
      fields: {
        actionName: options.actionName ?? "stack.build",
        createdAt: "2026-09-23T10:00:00Z",
        serviceIds: options.serviceIds.map((serviceId) => ZeropsServiceId.make(serviceId)),
      },
      unresolvedRequiredFields: [],
      source: "native-push",
      stamp: stamp(6),
      admission,
    },
    lifecycle: {
      knowledge: "observed",
      fields: { status: "RUNNING", startedAt: "2026-09-23T10:00:01Z", finishedAt: null },
      unresolvedRequiredFields: [],
      source: "native-push",
      stamp: stamp(6),
      admission,
    },
    pipeline:
      options.appVersion === undefined
        ? { knowledge: "unresolved", fields: {}, unresolvedRequiredFields: [], admission }
        : {
            knowledge: "observed",
            fields: { appVersion: options.appVersion },
            unresolvedRequiredFields: [],
            source: "native-push",
            stamp: stamp(6),
            admission,
          },
  };
}

const COMPLETE: QueryCoverage = {
  kind: "exhausted-traversal",
  traversedPages: 1,
  observedTotal: null,
  guarantee: "non-atomic",
};

export function processesRead(
  records: ReadonlyArray<ProcessRecord | "unresolved">,
  options: {
    readonly coverage?: QueryCoverage;
    readonly interest?: InterestState;
    readonly project?: ProjectRef;
  } = {},
): CollectionRead<ProcessRecord> {
  const coverage = options.coverage ?? COMPLETE;
  const owner = options.project ?? project();
  const descriptor = {
    kind: "running-processes-of-project" as const,
    project: owner,
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
    value: records.map((entry, index) =>
      entry === "unresolved"
        ? { knowledge: "unresolved", ref: process(`unresolved-${index}`, owner) }
        : { knowledge: "observed", record: entry },
    ),
    observation: {
      required: [
        options.interest ?? {
          status: "observing",
          identity: identity(),
          guarantee: "source-order-unverified",
          sinceReceiptOrdinal: ReceiptOrdinal.make(1),
        },
      ],
      optional: [],
      access: { status: "unverified" },
    },
    query:
      coverage.kind === "none" || coverage.kind === "partial"
        ? { ...common, status: "unresolved", coverage, lastAppliedReadStartOrdinal: null }
        : {
            ...common,
            status: "observed",
            coverage,
            observedTotal: records.length,
            source: "direct-read",
            stamp: stamp(2),
            lastAppliedReadStartOrdinal: ReadStartOrdinal.make(1),
          },
  };
}
