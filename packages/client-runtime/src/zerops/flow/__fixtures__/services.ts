/**
 * A project's service listing as the data runtime publishes it, for the flow's tests: records with
 * their deployment facets, listed completely unless a test says otherwise.
 */
import { identity, project, service, stamp } from "../../data/__fixtures__/index.ts";
import {
  AccountEpoch,
  DispatchOrdinal,
  ReadStartOrdinal,
  ReceiptOrdinal,
  queryKeyOf,
  type CollectionRead,
  type FacetAdmission,
  type InterestState,
  type ProjectRef,
  type QueryCoverage,
  type ServiceDeployInfo,
  type ServiceRecord,
} from "../../data/types.ts";

const admission: FacetAdmission = {
  lastNativeReceiptOrdinal: null,
  lastAppliedAuthoritativeDispatchOrdinal: null,
  hasAuthoritativeObservation: true,
};

export function deployed(activeDeploy: ServiceDeployInfo | null): ServiceRecord["deployment"] {
  return {
    knowledge: "observed",
    fields: { versionNumber: null, mode: null, activeDeploy },
    unresolvedRequiredFields: [],
    source: "direct-read",
    stamp: stamp(4),
    admission,
  };
}

export const UNRESOLVED_DEPLOYMENT: ServiceRecord["deployment"] = {
  knowledge: "unresolved",
  fields: {},
  unresolvedRequiredFields: [],
  admission,
};

export const UNAVAILABLE_DEPLOYMENT: ServiceRecord["deployment"] = {
  knowledge: "unavailable",
  reason: "forbidden",
  previousFields: {},
  stamp: stamp(5),
  fence: {
    accountEpoch: AccountEpoch.make(1),
    readStartOrdinal: ReadStartOrdinal.make(1),
    dispatchOrdinal: DispatchOrdinal.make(1),
    verifiedAccessDeadlineMs: 0,
  },
  admission,
};

export function record(
  id: string,
  hostname: string,
  deployment: ServiceRecord["deployment"],
  options: {
    readonly isSystem?: boolean;
    readonly type?: string;
    readonly project?: ProjectRef;
  } = {},
): ServiceRecord {
  return {
    ref: service(id, options.project),
    identity: {
      knowledge: "observed",
      fields: {
        hostname,
        isSystem: options.isSystem ?? false,
        type: { versionName: options.type ?? "nodejs@22", displayName: null, category: null },
      },
      unresolvedRequiredFields: [],
      source: "direct-read",
      stamp: stamp(1),
      admission,
    },
    lifecycle: {
      knowledge: "observed",
      fields: { status: "ACTIVE", createdAt: null, updatedAt: null },
      unresolvedRequiredFields: [],
      source: "direct-read",
      stamp: stamp(1),
      admission,
    },
    routing: { knowledge: "unresolved", fields: {}, unresolvedRequiredFields: [], admission },
    deployment,
    scaling: { knowledge: "unresolved", fields: {}, unresolvedRequiredFields: [], admission },
  };
}

const COMPLETE: QueryCoverage = {
  kind: "exhausted-traversal",
  traversedPages: 1,
  observedTotal: null,
  guarantee: "non-atomic",
};

export function servicesRead(
  records: ReadonlyArray<ServiceRecord | "unresolved">,
  options: {
    readonly coverage?: QueryCoverage;
    readonly interest?: InterestState;
    readonly project?: ProjectRef;
  } = {},
): CollectionRead<ServiceRecord> {
  const coverage = options.coverage ?? COMPLETE;
  const descriptor = {
    kind: "services-of-project" as const,
    project: options.project ?? project(),
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
        ? { knowledge: "unresolved", ref: service(`unresolved-${index}`) }
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
