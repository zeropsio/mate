import type * as Clock from "effect/Clock";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import type * as Stream from "effect/Stream";
import type { Atom } from "effect/unstable/reactivity";
import type { ActivityAppVersion } from "../activity/dto.ts";
import type { ZeropsProject } from "../api.ts";
import type { ZeropsProjectGrant } from "../groupReach.ts";
import type { ZeropsEnvironmentRole } from "../groups.ts";
import type { ZeropsAgentType } from "../newProject.ts";
import type { ZeropsToolKind } from "../tools.ts";

/**
 * Stable platform identities. Adapters decode untrusted values with these
 * schemas before they create domain references.
 */
const SourceId = Schema.String.check(Schema.isTrimmed(), Schema.isNonEmpty());
const NonNegativeOrdinal = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

const canonicalApiOrigin = (input: string): string | null => {
  try {
    const url = new URL(input);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
};

export const ZeropsApiOrigin = SourceId.check(
  Schema.makeFilter(
    (input) =>
      canonicalApiOrigin(input) === input ||
      "ZeropsApiOrigin must be a canonical HTTP(S) origin without path, query or fragment",
  ),
).pipe(Schema.brand("ZeropsApiOrigin"));
export type ZeropsApiOrigin = typeof ZeropsApiOrigin.Type;
export const makeZeropsApiOrigin = (input: string): ZeropsApiOrigin => {
  const normalized = canonicalApiOrigin(input.trim());
  if (normalized === null) {
    throw new TypeError("Zerops API origin must use HTTP(S).");
  }
  return ZeropsApiOrigin.make(normalized);
};
export const ZeropsAccountId = SourceId.pipe(Schema.brand("ZeropsAccountId"));
export type ZeropsAccountId = typeof ZeropsAccountId.Type;
export const ZeropsOrganizationId = SourceId.pipe(Schema.brand("ZeropsOrganizationId"));
export type ZeropsOrganizationId = typeof ZeropsOrganizationId.Type;
export const ZeropsProjectId = SourceId.pipe(Schema.brand("ZeropsProjectId"));
export type ZeropsProjectId = typeof ZeropsProjectId.Type;
export const ZeropsServiceId = SourceId.pipe(Schema.brand("ZeropsServiceId"));
export type ZeropsServiceId = typeof ZeropsServiceId.Type;
export const ZeropsProcessId = SourceId.pipe(Schema.brand("ZeropsProcessId"));
export type ZeropsProcessId = typeof ZeropsProcessId.Type;
export const ZeropsContainerId = SourceId.pipe(Schema.brand("ZeropsContainerId"));
export type ZeropsContainerId = typeof ZeropsContainerId.Type;
export const ZeropsReceiverId = SourceId.pipe(Schema.brand("ZeropsReceiverId"));
export type ZeropsReceiverId = typeof ZeropsReceiverId.Type;
export const ZeropsWireSubscriptionName = SourceId.pipe(Schema.brand("ZeropsWireSubscriptionName"));
export type ZeropsWireSubscriptionName = typeof ZeropsWireSubscriptionName.Type;
export const ZeropsRequestId = SourceId.pipe(Schema.brand("ZeropsRequestId"));
export type ZeropsRequestId = typeof ZeropsRequestId.Type;
export const ZeropsCommandAttemptId = SourceId.pipe(Schema.brand("ZeropsCommandAttemptId"));
export type ZeropsCommandAttemptId = typeof ZeropsCommandAttemptId.Type;
export const ZeropsLeaseId = SourceId.pipe(Schema.brand("ZeropsLeaseId"));
export type ZeropsLeaseId = typeof ZeropsLeaseId.Type;
export const ZeropsSharedReadId = SourceId.pipe(Schema.brand("ZeropsSharedReadId"));
export type ZeropsSharedReadId = typeof ZeropsSharedReadId.Type;

export const AccountEpoch = NonNegativeOrdinal.pipe(Schema.brand("ZeropsAccountEpoch"));
export type AccountEpoch = typeof AccountEpoch.Type;
export const ReceiverEpoch = NonNegativeOrdinal.pipe(Schema.brand("ZeropsReceiverEpoch"));
export type ReceiverEpoch = typeof ReceiverEpoch.Type;
export const InterestEpoch = NonNegativeOrdinal.pipe(Schema.brand("ZeropsInterestEpoch"));
export type InterestEpoch = typeof InterestEpoch.Type;
export const ReceiptOrdinal = NonNegativeOrdinal.pipe(Schema.brand("ZeropsReceiptOrdinal"));
export type ReceiptOrdinal = typeof ReceiptOrdinal.Type;
export const ReadStartOrdinal = NonNegativeOrdinal.pipe(Schema.brand("ZeropsReadStartOrdinal"));
export type ReadStartOrdinal = typeof ReadStartOrdinal.Type;
export const DispatchOrdinal = NonNegativeOrdinal.pipe(Schema.brand("ZeropsDispatchOrdinal"));
export type DispatchOrdinal = typeof DispatchOrdinal.Type;

export interface AccountRef {
  readonly apiOrigin: ZeropsApiOrigin;
  readonly accountId: ZeropsAccountId;
}

export interface AccountScope {
  readonly account: AccountRef;
  readonly epoch: AccountEpoch;
}

export interface OrganizationRef {
  readonly kind: "organization";
  readonly account: AccountRef;
  readonly organizationId: ZeropsOrganizationId;
}

export interface ProjectRef {
  readonly kind: "project";
  readonly organization: OrganizationRef;
  readonly projectId: ZeropsProjectId;
}

export interface ServiceRef {
  readonly kind: "service";
  readonly project: ProjectRef;
  readonly serviceId: ZeropsServiceId;
}

export interface ProcessRef {
  readonly kind: "process";
  readonly project: ProjectRef;
  readonly processId: ZeropsProcessId;
}

export type EntityRef = ProjectRef | ServiceRef | ProcessRef;

export const OrganizationKey = Schema.String.pipe(Schema.brand("ZeropsOrganizationKey"));
export type OrganizationKey = typeof OrganizationKey.Type;
export const ProjectKey = Schema.String.pipe(Schema.brand("ZeropsProjectKey"));
export type ProjectKey = typeof ProjectKey.Type;
export const ServiceKey = Schema.String.pipe(Schema.brand("ZeropsServiceKey"));
export type ServiceKey = typeof ServiceKey.Type;
export const ProcessKey = Schema.String.pipe(Schema.brand("ZeropsProcessKey"));
export type ProcessKey = typeof ProcessKey.Type;
export type EntityKey = ProjectKey | ServiceKey | ProcessKey;
export const QueryKey = Schema.String.pipe(Schema.brand("ZeropsQueryKey"));
export type QueryKey = typeof QueryKey.Type;
export const InterestKey = Schema.String.pipe(Schema.brand("ZeropsInterestKey"));
export type InterestKey = typeof InterestKey.Type;

const scopedKey = (parts: ReadonlyArray<string>): string => JSON.stringify(parts);

export const organizationKeyOf = (ref: OrganizationRef): OrganizationKey =>
  OrganizationKey.make(
    scopedKey(["organization", ref.account.apiOrigin, ref.account.accountId, ref.organizationId]),
  );

export const projectKeyOf = (ref: ProjectRef): ProjectKey =>
  ProjectKey.make(
    scopedKey([
      "project",
      ref.organization.account.apiOrigin,
      ref.organization.account.accountId,
      ref.organization.organizationId,
      ref.projectId,
    ]),
  );

export const serviceKeyOf = (ref: ServiceRef): ServiceKey =>
  ServiceKey.make(
    scopedKey([
      "service",
      ref.project.organization.account.apiOrigin,
      ref.project.organization.account.accountId,
      ref.project.organization.organizationId,
      ref.project.projectId,
      ref.serviceId,
    ]),
  );

export const processKeyOf = (ref: ProcessRef): ProcessKey =>
  ProcessKey.make(
    scopedKey([
      "process",
      ref.project.organization.account.apiOrigin,
      ref.project.organization.account.accountId,
      ref.project.organization.organizationId,
      ref.project.projectId,
      ref.processId,
    ]),
  );

export const entityKeyOf = (ref: EntityRef): EntityKey => {
  switch (ref.kind) {
    case "project":
      return projectKeyOf(ref);
    case "service":
      return serviceKeyOf(ref);
    case "process":
      return processKeyOf(ref);
  }
};

export interface ReceiverIdentity {
  readonly accountEpoch: AccountEpoch;
  readonly receiverEpoch: ReceiverEpoch;
  readonly receiverId: ZeropsReceiverId;
}

export interface InterestIdentity {
  readonly receiver: ReceiverIdentity;
  readonly interestEpoch: InterestEpoch;
  readonly key: InterestKey;
}

export interface SourceMetadata {
  /** Retained as opaque source metadata; it is not a proven revision clock. */
  readonly version?: number;
  readonly lastUpdate?: string;
  readonly sequence?: number;
  readonly parentId?: ZeropsProcessId | null;
  readonly rootId?: ZeropsProcessId | null;
}

export interface ZeropsProjectRole {
  readonly clientUserId: string;
  readonly roleCode: string;
}

export interface ProjectIdentityFields {
  readonly name: string;
  readonly createdAt: string | null;
}

export type ProjectIdentityRequiredField = "name";

export interface ProjectLifecycleFields {
  readonly status: string;
}

export type ProjectLifecycleRequiredField = "status";

export interface ProjectPresentationFields {
  readonly description: string | null;
  /** A present array replaces this facet's previous array. */
  readonly tags: ReadonlyArray<string>;
}

export interface ProjectPlacementFields {
  readonly publicZone: string | null;
  readonly zeropsSubdomainHost: string | null;
  readonly mode: string | null;
}

export interface ServicePort {
  readonly port: number;
  readonly protocol: string | null;
  readonly scheme: string | null;
  readonly httpSupport: boolean | null;
}

export interface ServiceTypeInfo {
  readonly versionName: string;
  readonly displayName: string | null;
  readonly category: string | null;
}

export interface ServiceDeployInfo {
  readonly source: string;
  readonly activatedAt: string | null;
  readonly name: string | null;
  readonly branch: string | null;
  readonly commit: string | null;
  readonly tag: string | null;
  readonly repository: string | null;
}

export interface ServiceIdentityFields {
  readonly hostname: string;
  readonly isSystem: boolean;
  readonly type: ServiceTypeInfo | null;
}

export type ServiceIdentityRequiredField = "hostname";

export interface ServiceLifecycleFields {
  readonly status: string;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
}

export type ServiceLifecycleRequiredField = "status";

export interface ServiceRoutingFields {
  readonly ports: ReadonlyArray<ServicePort>;
  readonly subdomainAccess: boolean | null;
}

export interface ServiceDeploymentFields {
  readonly versionNumber: string | null;
  readonly mode: string | null;
  readonly activeDeploy: ServiceDeployInfo | null;
}

export interface AutoscalingRange {
  readonly min: number | null;
  readonly max: number | null;
}

export interface ServiceScalingFields {
  readonly containers: AutoscalingRange | null;
  readonly cpu: AutoscalingRange | null;
  readonly memoryGb: AutoscalingRange | null;
  readonly diskGb: AutoscalingRange | null;
  readonly cpuMode: string | null;
}

export type KnownProcessStatus =
  | "PENDING"
  | "RUNNING"
  | "ROLLBACKING"
  | "CANCELING"
  | "FINISHED"
  | "FAILED"
  | "CANCELED";

export type RunningProcessStatus = Extract<
  KnownProcessStatus,
  "PENDING" | "RUNNING" | "ROLLBACKING" | "CANCELING"
>;

export type ProcessStatus = KnownProcessStatus | { readonly kind: "unknown"; readonly raw: string };

/** Preserve the original nested build/prepare/activation fields consumed by pipeline and log attribution. */
export type ProcessAppVersionInfo = ActivityAppVersion;

export interface ProcessIdentityFields {
  readonly actionName: string;
  readonly createdAt: string;
  readonly serviceIds: ReadonlyArray<ZeropsServiceId>;
}

export type ProcessIdentityRequiredField = "actionName" | "createdAt";

export interface ProcessLifecycleFields {
  readonly status: ProcessStatus;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
}

export type ProcessLifecycleRequiredField = "status";

export interface ProcessPipelineFields {
  readonly appVersion: ProcessAppVersionInfo | null;
}

export type ObservationSource =
  | "indexed-search"
  | "direct-read"
  | "native-push"
  | "embedded"
  | "command-response";

/**
 * Optional properties mean omitted by the source. A present null clears a
 * nullable field, and a present array replaces the prior array for that facet.
 */
export type FacetPatch<Fields> = Readonly<Partial<Fields>>;

type IndexedQueryForTarget<Target extends EntityReadTarget> = Target["kind"] extends "project"
  ? Extract<EntityQueryDescriptor, { readonly kind: "projects-of-organization" }>
  : Target["kind"] extends "service"
    ? Extract<EntityQueryDescriptor, { readonly kind: "services-of-project" }>
    : Extract<
        EntityQueryDescriptor,
        { readonly kind: "running-processes-of-project" | "process-history-window" }
      >;

type DirectCollectionQueryForTarget<Target extends EntityReadTarget> =
  Target["kind"] extends "project"
    ? Extract<EntityQueryDescriptor, { readonly kind: "projects-of-organization" }>
    : Target["kind"] extends "service"
      ? Extract<EntityQueryDescriptor, { readonly kind: "services-of-project" }>
      : Target["kind"] extends "process"
        ? Extract<
            EntityQueryDescriptor,
            { readonly kind: "running-processes-of-project" | "process-history-window" }
          >
        : never;

type EntityUpdateRegistrationForTarget<Target extends EntityReadTarget> = RegistrationRequest & {
  readonly descriptor: {
    readonly kind: "entity-updates";
    readonly entity: Target["kind"];
    readonly organization: OrganizationRef;
  };
};

export type FieldObservation<Fields, Target extends EntityReadTarget> =
  | {
      readonly source: "indexed-search";
      readonly ticket: ReadTicket & {
        readonly target: MembershipQueryReadTarget<IndexedQueryForTarget<Target>>;
      };
      readonly fields: FacetPatch<Fields>;
      readonly metadata: SourceMetadata;
    }
  | {
      readonly source: "direct-read";
      readonly ticket: ReadTicket & {
        readonly target: Target | MembershipQueryReadTarget<DirectCollectionQueryForTarget<Target>>;
      };
      readonly fields: FacetPatch<Fields>;
      readonly metadata: SourceMetadata;
    }
  | {
      readonly source: "native-push";
      readonly registration: EntityUpdateRegistrationForTarget<Target>;
      readonly fields: FacetPatch<Fields>;
      readonly metadata: SourceMetadata;
    }
  | {
      readonly source: "embedded";
      readonly owner: EntityRef;
      readonly cause:
        | { readonly kind: "read"; readonly ticket: ReadTicket }
        | { readonly kind: "native"; readonly registration: RegistrationRequest }
        | {
            readonly kind: "command";
            readonly command: PlatformCommand;
          };
      readonly fields: FacetPatch<Fields>;
      readonly metadata: SourceMetadata;
    }
  | {
      readonly source: "command-response";
      /** Its account and start fences come from the exact command passed to the adapter. */
      readonly command: PlatformCommand;
      readonly fields: FacetPatch<Fields>;
      readonly metadata: SourceMetadata;
    };

export type EntityObservation =
  | {
      readonly kind: "project-identity-observed";
      readonly ref: ProjectRef;
      readonly observation: FieldObservation<ProjectIdentityFields, ProjectReadTarget>;
    }
  | {
      readonly kind: "project-lifecycle-observed";
      readonly ref: ProjectRef;
      readonly observation: FieldObservation<ProjectLifecycleFields, ProjectReadTarget>;
    }
  | {
      readonly kind: "project-presentation-observed";
      readonly ref: ProjectRef;
      readonly observation: FieldObservation<ProjectPresentationFields, ProjectReadTarget>;
    }
  | {
      readonly kind: "project-placement-observed";
      readonly ref: ProjectRef;
      readonly observation: FieldObservation<ProjectPlacementFields, ProjectReadTarget>;
    }
  | {
      readonly kind: "service-identity-observed";
      readonly ref: ServiceRef;
      readonly observation: FieldObservation<ServiceIdentityFields, ServiceReadTarget>;
    }
  | {
      readonly kind: "service-lifecycle-observed";
      readonly ref: ServiceRef;
      readonly observation: FieldObservation<ServiceLifecycleFields, ServiceReadTarget>;
    }
  | {
      readonly kind: "service-routing-observed";
      readonly ref: ServiceRef;
      readonly observation: FieldObservation<ServiceRoutingFields, ServiceReadTarget>;
    }
  | {
      readonly kind: "service-deployment-observed";
      readonly ref: ServiceRef;
      readonly observation: FieldObservation<ServiceDeploymentFields, ServiceReadTarget>;
    }
  | {
      readonly kind: "service-scaling-observed";
      readonly ref: ServiceRef;
      readonly observation: FieldObservation<ServiceScalingFields, ServiceReadTarget>;
    }
  | {
      readonly kind: "process-identity-observed";
      readonly ref: ProcessRef;
      readonly observation: FieldObservation<ProcessIdentityFields, ProcessReadTarget>;
    }
  | {
      readonly kind: "process-lifecycle-observed";
      readonly ref: ProcessRef;
      readonly observation: FieldObservation<ProcessLifecycleFields, ProcessReadTarget>;
    }
  | {
      readonly kind: "process-pipeline-observed";
      readonly ref: ProcessRef;
      readonly observation: FieldObservation<ProcessPipelineFields, ProcessReadTarget>;
    };

export type QueryCoverage =
  | { readonly kind: "none" }
  | {
      readonly kind: "exhausted-traversal";
      readonly traversedPages: number;
      readonly observedTotal: number | null;
      readonly guarantee: "non-atomic";
    }
  | {
      readonly kind: "partial-window";
      readonly offset: number;
      readonly limit: number;
      readonly traversedPages: number;
      readonly observedTotal: number | null;
    }
  | {
      readonly kind: "partial";
      readonly reason: "malformed" | "contradictory-total" | "overflow" | "budget" | "read-failed";
    };

export interface MetricWindow {
  readonly timeGroupBy: "1m" | "1h" | "1d" | "1w" | "1M";
  readonly limit: number;
  readonly timeZone: string;
}

export type QueryDescriptor =
  | {
      readonly kind: "projects-of-organization";
      readonly organization: OrganizationRef;
      readonly statuses: ReadonlyArray<string>;
      readonly schemaVersion: 1;
    }
  | {
      readonly kind: "services-of-project";
      readonly project: ProjectRef;
      readonly schemaVersion: 1;
    }
  | {
      readonly kind: "running-processes-of-project";
      readonly project: ProjectRef;
      /** Wire filters admit only known status strings. Unknown values are observation data. */
      readonly statuses: ReadonlyArray<RunningProcessStatus>;
      readonly schemaVersion: 1;
    }
  | {
      readonly kind: "process-history-window";
      readonly project: ProjectRef;
      readonly before: string | null;
      readonly limit: number;
      readonly schemaVersion: 1;
    }
  | {
      readonly kind: "current-metrics-of-project";
      readonly project: ProjectRef;
      readonly groupBy: "containerId";
      readonly schemaVersion: 1;
    }
  | {
      readonly kind: "metric-history-of-project";
      readonly project: ProjectRef;
      readonly groupBy: "serviceStackId";
      readonly window: MetricWindow;
      readonly schemaVersion: 1;
    };

export type EntityQueryDescriptor = Extract<
  QueryDescriptor,
  {
    readonly kind:
      | "projects-of-organization"
      | "services-of-project"
      | "running-processes-of-project"
      | "process-history-window";
  }
>;

export type QueryMemberRef<Descriptor extends EntityQueryDescriptor> =
  Descriptor["kind"] extends "projects-of-organization"
    ? ProjectRef
    : Descriptor["kind"] extends "services-of-project"
      ? ServiceRef
      : ProcessRef;

const canonicalStringSet = (values: ReadonlyArray<string>): string =>
  JSON.stringify([...new Set(values)].toSorted());

export const queryKeyOf = (descriptor: QueryDescriptor): QueryKey => {
  switch (descriptor.kind) {
    case "projects-of-organization":
      return QueryKey.make(
        scopedKey([
          descriptor.kind,
          organizationKeyOf(descriptor.organization),
          canonicalStringSet(descriptor.statuses),
          String(descriptor.schemaVersion),
        ]),
      );
    case "services-of-project":
      return QueryKey.make(
        scopedKey([
          descriptor.kind,
          projectKeyOf(descriptor.project),
          String(descriptor.schemaVersion),
        ]),
      );
    case "running-processes-of-project":
      return QueryKey.make(
        scopedKey([
          descriptor.kind,
          projectKeyOf(descriptor.project),
          canonicalStringSet(descriptor.statuses),
          String(descriptor.schemaVersion),
        ]),
      );
    case "process-history-window":
      return QueryKey.make(
        scopedKey([
          descriptor.kind,
          projectKeyOf(descriptor.project),
          descriptor.before ?? "",
          String(descriptor.limit),
          String(descriptor.schemaVersion),
        ]),
      );
    case "current-metrics-of-project":
      return QueryKey.make(
        scopedKey([
          descriptor.kind,
          projectKeyOf(descriptor.project),
          descriptor.groupBy,
          String(descriptor.schemaVersion),
        ]),
      );
    case "metric-history-of-project":
      return QueryKey.make(
        scopedKey([
          descriptor.kind,
          projectKeyOf(descriptor.project),
          descriptor.groupBy,
          descriptor.window.timeGroupBy,
          String(descriptor.window.limit),
          descriptor.window.timeZone,
          String(descriptor.schemaVersion),
        ]),
      );
  }
};

export type ProjectFacetName = "identity" | "lifecycle" | "presentation" | "placement";
export type ServiceFacetName = "identity" | "lifecycle" | "routing" | "deployment" | "scaling";
export type ProcessFacetName = "identity" | "lifecycle" | "pipeline";

export const PROJECT_READ_FACETS = ["identity", "lifecycle", "presentation", "placement"] as const;
export const SERVICE_READ_FACETS = [
  "identity",
  "lifecycle",
  "routing",
  "deployment",
  "scaling",
] as const;
export const PROCESS_READ_FACETS = ["identity", "lifecycle", "pipeline"] as const;

export interface ProjectReadTarget {
  readonly kind: "project";
  readonly ref: ProjectRef;
}

export interface ServiceReadTarget {
  readonly kind: "service";
  readonly ref: ServiceRef;
}

export interface ProcessReadTarget {
  readonly kind: "process";
  readonly ref: ProcessRef;
}

export type EntityReadTarget = ProjectReadTarget | ServiceReadTarget | ProcessReadTarget;

export interface MembershipQueryReadTarget<
  Descriptor extends EntityQueryDescriptor = EntityQueryDescriptor,
> {
  readonly kind: "query";
  readonly descriptor: Descriptor;
}

export interface MetricQueryReadTarget<
  Descriptor extends Extract<
    QueryDescriptor,
    { readonly kind: "current-metrics-of-project" | "metric-history-of-project" }
  > = Extract<
    QueryDescriptor,
    { readonly kind: "current-metrics-of-project" | "metric-history-of-project" }
  >,
> {
  readonly kind: "query";
  readonly descriptor: Descriptor;
}

export type ReadTarget = EntityReadTarget | MembershipQueryReadTarget | MetricQueryReadTarget;

export type ReadOwner =
  | { readonly kind: "interest"; readonly identity: InterestIdentity }
  | {
      readonly kind: "shared";
      readonly account: AccountScope;
      readonly sharedReadId: ZeropsSharedReadId;
    };

export interface SharedReadOwnership {
  readonly owner: Extract<ReadOwner, { readonly kind: "shared" }>;
  readonly target: ReadTarget;
  /** Each dependent is fenced by its complete identity, not by a bare epoch number. */
  readonly dependents: ReadonlyMap<InterestKey, InterestIdentity>;
  readonly status: "active" | "cancelled" | "completed";
}

interface ReadTicketBase {
  readonly requestId: ZeropsRequestId;
  readonly owner: ReadOwner;
  readonly receiptOrdinalAtStart: ReceiptOrdinal;
  readonly readStartOrdinal: ReadStartOrdinal;
  /** One account-wide counter shared by read and command dispatch. */
  readonly dispatchOrdinal: DispatchOrdinal;
  readonly startedAtMs: number;
}

export type ReadTicket =
  | (ReadTicketBase & {
      readonly kind: "direct" | "hydration";
      readonly target: EntityReadTarget;
      readonly membershipReceiptOrdinalAtStart?: never;
    })
  | (ReadTicketBase & {
      readonly kind: "baseline" | "history";
      readonly target: MembershipQueryReadTarget;
      /** Native membership after this marker overlays an admitted baseline. */
      readonly membershipReceiptOrdinalAtStart: ReceiptOrdinal;
    })
  | (ReadTicketBase & {
      readonly kind: "baseline" | "history";
      readonly target: MetricQueryReadTarget;
      readonly membershipReceiptOrdinalAtStart?: never;
    });

export type ReadFailureKind =
  | "cancelled"
  | "timeout"
  | "network"
  | "unauthorized"
  | "forbidden"
  | "not-found"
  | "server"
  | "malformed"
  | "incomplete";

export type ReadContribution =
  | `project:${ProjectFacetName}`
  | `service:${ServiceFacetName}`
  | `process:${ProcessFacetName}`
  | "query-membership"
  | "current-metrics"
  | "metric-history";

export type ReadState =
  | { readonly status: "pending"; readonly ticket: ReadTicket }
  | {
      readonly status: "succeeded";
      readonly ticket: ReadTicket;
      readonly completedAtReceiptOrdinal: ReceiptOrdinal;
      readonly appliedFacets: ReadonlyArray<ReadContribution>;
      readonly suppressedFacets: ReadonlyArray<ReadContribution>;
      readonly unresolvedRequiredFields: ReadonlyArray<string>;
    }
  | {
      readonly status: "failed";
      readonly ticket: ReadTicket;
      readonly completedAtReceiptOrdinal: ReceiptOrdinal;
      readonly failure: ReadFailureKind;
    };

/**
 * Enqueued after every decoded response observation. Establishment may use a
 * completion only after this marker crosses the serialized ingestion queue.
 */
export type ReadCompletionInput =
  | { readonly kind: "read-succeeded"; readonly ticket: ReadTicket }
  | {
      readonly kind: "read-failed";
      readonly ticket: ReadTicket;
      readonly failure: ReadFailureKind;
    };

export interface IngestionStamp {
  readonly receiptOrdinal: ReceiptOrdinal;
  readonly observedAtMs: number;
}

type QueryBaselineFor<Descriptor extends EntityQueryDescriptor> =
  Descriptor extends EntityQueryDescriptor
    ? {
        readonly kind: "query-baseline-observed";
        readonly members: ReadonlyArray<QueryMemberRef<Descriptor>>;
        readonly unresolvedMembers: ReadonlyArray<QueryMemberRef<Descriptor>>;
        readonly observedTotal: number | null;
        readonly coverage: QueryCoverage;
        readonly source: "indexed-search" | "direct-read";
        readonly ticket: ReadTicketBase & {
          readonly kind: "baseline" | "history";
          readonly target: MembershipQueryReadTarget<Descriptor>;
          /** Native membership after this marker overlays an admitted baseline. */
          readonly membershipReceiptOrdinalAtStart: ReceiptOrdinal;
        };
      }
    : never;

export type QueryBaselineObservation = QueryBaselineFor<EntityQueryDescriptor>;

type QueryMembershipFor<Descriptor extends EntityQueryDescriptor> =
  Descriptor extends EntityQueryDescriptor
    ? {
        readonly kind: "query-membership-observed";
        readonly operation: "add" | "remove";
        readonly member: QueryMemberRef<Descriptor>;
        readonly registration: RegistrationRequest & {
          readonly descriptor: { readonly kind: "query-membership"; readonly query: Descriptor };
        };
      }
    : never;

export type QueryMembershipObservation = QueryMembershipFor<EntityQueryDescriptor>;

export interface EntityUnavailableObservation {
  readonly kind: "entity-unavailable";
  readonly ref: EntityRef;
  readonly reason: "forbidden" | "not-found" | "access-revoked";
  readonly ticket: ReadTicket & { readonly target: EntityReadTarget };
}

export interface CurrentMetricKey {
  readonly service: ServiceRef;
  readonly containerId: ZeropsContainerId;
  readonly groupBy: "containerId";
  readonly schemaVersion: 1;
}

export const CurrentMetricMapKey = Schema.String.pipe(Schema.brand("ZeropsCurrentMetricMapKey"));
export type CurrentMetricMapKey = typeof CurrentMetricMapKey.Type;

export interface HistorySeriesKey {
  readonly service: ServiceRef;
  readonly groupBy: "serviceStackId";
  readonly window: MetricWindow;
  readonly schemaVersion: 1;
}

export const HistorySeriesMapKey = Schema.String.pipe(Schema.brand("ZeropsHistorySeriesMapKey"));
export type HistorySeriesMapKey = typeof HistorySeriesMapKey.Type;

export interface HistoryBucketKey {
  readonly series: HistorySeriesKey;
  readonly from: string;
  readonly till: string;
}

export const HistoryBucketMapKey = Schema.String.pipe(Schema.brand("ZeropsHistoryBucketMapKey"));
export type HistoryBucketMapKey = typeof HistoryBucketMapKey.Type;

export const currentMetricKeyOf = (key: CurrentMetricKey): CurrentMetricMapKey =>
  CurrentMetricMapKey.make(
    scopedKey([serviceKeyOf(key.service), key.containerId, key.groupBy, String(key.schemaVersion)]),
  );

export const historySeriesKeyOf = (key: HistorySeriesKey): HistorySeriesMapKey =>
  HistorySeriesMapKey.make(
    scopedKey([
      serviceKeyOf(key.service),
      key.groupBy,
      key.window.timeGroupBy,
      String(key.window.limit),
      key.window.timeZone,
      String(key.schemaVersion),
    ]),
  );

export const historyBucketKeyOf = (key: HistoryBucketKey): HistoryBucketMapKey =>
  HistoryBucketMapKey.make(scopedKey([historySeriesKeyOf(key.series), key.from, key.till]));

export interface StatPair {
  readonly used: number;
  readonly limit: number;
}

export interface CurrentMetricSample {
  readonly key: CurrentMetricKey;
  readonly cpu: StatPair | null;
  readonly virtualCpu: StatPair | null;
  readonly memoryGb: StatPair | null;
  readonly diskGb: StatPair | null;
}

interface CurrentMetricObservationBase {
  readonly kind: "current-metrics-replaced";
  readonly samples: ReadonlyArray<CurrentMetricSample>;
  readonly coverage: QueryCoverage;
}

export type CurrentMetricObservation = CurrentMetricObservationBase &
  (
    | {
        readonly source: "direct-read";
        readonly ticket: ReadTicket & {
          readonly target: MetricQueryReadTarget<
            Extract<QueryDescriptor, { readonly kind: "current-metrics-of-project" }>
          >;
        };
      }
    | {
        readonly source: "native-push";
        readonly registration: RegistrationRequest & {
          readonly descriptor: { readonly kind: "current-metrics" };
        };
      }
  );

export interface HistoryMetricBucket {
  readonly key: HistoryBucketKey;
  readonly containers: number | null;
  readonly cpu: StatPair | null;
  readonly virtualCpu: StatPair | null;
  readonly memoryGb: StatPair | null;
  readonly diskGb: StatPair | null;
}

interface HistoryMetricObservationBase {
  readonly kind: "metric-history-window-observed";
  readonly buckets: ReadonlyArray<HistoryMetricBucket>;
  readonly coverage: QueryCoverage;
  /** Replacement is a full admitted window; correction replaces matching bucket keys only. */
  readonly operation: "replace-window" | "correct-buckets";
}

export type HistoryMetricObservation = HistoryMetricObservationBase &
  (
    | {
        readonly source: "direct-read";
        readonly ticket: ReadTicket & {
          readonly target: MetricQueryReadTarget<
            Extract<QueryDescriptor, { readonly kind: "metric-history-of-project" }>
          >;
        };
      }
    | {
        readonly source: "native-push";
        readonly registration: RegistrationRequest & {
          readonly descriptor: { readonly kind: "metric-history" };
        };
      }
  );

export type PlatformObservation =
  | EntityObservation
  | QueryBaselineObservation
  | QueryMembershipObservation
  | EntityUnavailableObservation
  | CurrentMetricObservation
  | HistoryMetricObservation;

export interface AdmittedObservation {
  readonly stamp: IngestionStamp;
  readonly input: PlatformObservation;
  /** Runtime-owned enrichment; adapters never manufacture access verification. */
  readonly accessEvidence: VerifiedAccessGrant | null;
}

export type RegistrationCompletionInput =
  | {
      readonly kind: "registration-succeeded";
      readonly request: RegistrationRequest;
    }
  | {
      readonly kind: "registration-failed";
      readonly request: RegistrationRequest;
      readonly reason: string;
    };

export type CommandCompletionInput =
  | {
      readonly kind: "command-accepted";
      readonly command: PlatformCommand;
      readonly processRefs: ReadonlyArray<ProcessRef>;
    }
  | {
      readonly kind: "command-rejected" | "command-uncertain";
      readonly command: PlatformCommand;
      readonly reason: string;
    };

export type IngestionInput =
  | { readonly kind: "observation"; readonly observation: AdmittedObservation }
  | {
      readonly kind: "read-completion";
      readonly stamp: IngestionStamp;
      readonly completion: ReadCompletionInput;
    }
  | {
      readonly kind: "registration-completion";
      readonly stamp: IngestionStamp;
      readonly completion: RegistrationCompletionInput;
    }
  | {
      readonly kind: "command-completion";
      readonly stamp: IngestionStamp;
      readonly completion: CommandCompletionInput;
    }
  | {
      readonly kind: "access-observation";
      readonly stamp: IngestionStamp;
      readonly observation: AccessObservation;
    }
  | {
      readonly kind: "command-execution-requested";
      readonly stamp: IngestionStamp;
      readonly request: CommandExecutionRequest;
    };

export interface FacetAdmission {
  readonly lastNativeReceiptOrdinal: ReceiptOrdinal | null;
  readonly lastAppliedAuthoritativeDispatchOrdinal: DispatchOrdinal | null;
  readonly hasAuthoritativeObservation: boolean;
}

export type ObservedFacetFields<Fields, RequiredField extends keyof Fields> = Readonly<
  Pick<Fields, RequiredField> & Partial<Fields>
>;

export type FacetState<Fields, RequiredField extends keyof Fields> =
  | {
      readonly knowledge: "unresolved";
      readonly fields: FacetPatch<Fields>;
      readonly unresolvedRequiredFields: ReadonlyArray<RequiredField>;
      readonly admission: FacetAdmission;
    }
  | {
      readonly knowledge: "observed";
      readonly fields: ObservedFacetFields<Fields, RequiredField>;
      readonly unresolvedRequiredFields: readonly [];
      /** Source that established observed knowledge; later search seeds do not replace it. */
      readonly source: ObservationSource;
      readonly stamp: IngestionStamp;
      readonly admission: FacetAdmission;
    }
  | {
      readonly knowledge: "unavailable";
      readonly reason: "forbidden" | "not-found" | "access-revoked";
      readonly previousFields: FacetPatch<Fields>;
      readonly stamp: IngestionStamp;
      /** Old push callbacks cannot reopen the facet across this verified fence. */
      readonly fence: {
        readonly accountEpoch: AccountEpoch;
        readonly readStartOrdinal: ReadStartOrdinal;
        readonly dispatchOrdinal: DispatchOrdinal;
        readonly verifiedAccessDeadlineMs: number;
      };
      readonly admission: FacetAdmission;
    };

export type EntityKnowledge<Record extends { readonly ref: EntityRef }> =
  | { readonly knowledge: "unresolved"; readonly ref: Record["ref"] }
  | { readonly knowledge: "observed"; readonly record: Record }
  | {
      readonly knowledge: "unavailable";
      readonly ref: Record["ref"];
      readonly reason: "forbidden" | "not-found" | "access-revoked";
      readonly since: IngestionStamp;
    };

export interface ProjectRecord {
  readonly ref: ProjectRef;
  readonly identity: FacetState<ProjectIdentityFields, ProjectIdentityRequiredField>;
  readonly lifecycle: FacetState<ProjectLifecycleFields, ProjectLifecycleRequiredField>;
  readonly presentation: FacetState<ProjectPresentationFields, never>;
  readonly placement: FacetState<ProjectPlacementFields, never>;
}

export interface ServiceRecord {
  readonly ref: ServiceRef;
  readonly identity: FacetState<ServiceIdentityFields, ServiceIdentityRequiredField>;
  readonly lifecycle: FacetState<ServiceLifecycleFields, ServiceLifecycleRequiredField>;
  readonly routing: FacetState<ServiceRoutingFields, never>;
  readonly deployment: FacetState<ServiceDeploymentFields, never>;
  readonly scaling: FacetState<ServiceScalingFields, never>;
}

export interface ProcessRecord {
  readonly ref: ProcessRef;
  readonly identity: FacetState<ProcessIdentityFields, ProcessIdentityRequiredField>;
  readonly lifecycle: FacetState<ProcessLifecycleFields, ProcessLifecycleRequiredField>;
  readonly pipeline: FacetState<ProcessPipelineFields, never>;
}

export type ZeropsEntityRecord = ProjectRecord | ServiceRecord | ProcessRecord;

export type CollectionQueryForRecord<Record extends ZeropsEntityRecord> =
  Record extends ProjectRecord
    ? Extract<EntityQueryDescriptor, { readonly kind: "projects-of-organization" }>
    : Record extends ServiceRecord
      ? Extract<EntityQueryDescriptor, { readonly kind: "services-of-project" }>
      : Extract<
          EntityQueryDescriptor,
          { readonly kind: "running-processes-of-project" | "process-history-window" }
        >;

export interface RetainedMembershipOperation<Member extends EntityRef = EntityRef> {
  readonly member: Member;
  readonly receiptOrdinal: ReceiptOrdinal;
  readonly operation: "add" | "remove";
}

export type QueryMemberKey<Descriptor extends EntityQueryDescriptor> =
  QueryMemberRef<Descriptor> extends ProjectRef
    ? ProjectKey
    : QueryMemberRef<Descriptor> extends ServiceRef
      ? ServiceKey
      : ProcessKey;

type QueryStateFor<Descriptor extends EntityQueryDescriptor> =
  Descriptor extends EntityQueryDescriptor
    ?
        | {
            readonly status: "unresolved";
            readonly descriptor: Descriptor;
            readonly key: QueryKey;
            readonly memberKeys: ReadonlyArray<QueryMemberKey<Descriptor>>;
            readonly unresolvedMemberKeys: ReadonlyArray<QueryMemberKey<Descriptor>>;
            readonly coverage: Extract<QueryCoverage, { readonly kind: "none" | "partial" }>;
            readonly lastAppliedReadStartOrdinal: ReadStartOrdinal | null;
            /** Latest operation per ID is retained while an older baseline can complete. */
            readonly membershipOperations: ReadonlyMap<
              QueryMemberKey<Descriptor>,
              RetainedMembershipOperation<QueryMemberRef<Descriptor>>
            >;
          }
        | {
            readonly status: "observed";
            readonly descriptor: Descriptor;
            readonly key: QueryKey;
            readonly memberKeys: ReadonlyArray<QueryMemberKey<Descriptor>>;
            readonly unresolvedMemberKeys: ReadonlyArray<QueryMemberKey<Descriptor>>;
            readonly observedTotal: number | null;
            readonly coverage: Exclude<QueryCoverage, { readonly kind: "none" }>;
            readonly source: "indexed-search" | "direct-read";
            readonly stamp: IngestionStamp;
            readonly lastAppliedReadStartOrdinal: ReadStartOrdinal;
            readonly membershipOperations: ReadonlyMap<
              QueryMemberKey<Descriptor>,
              RetainedMembershipOperation<QueryMemberRef<Descriptor>>
            >;
          }
    : never;

export type QueryState<Descriptor extends EntityQueryDescriptor = EntityQueryDescriptor> =
  QueryStateFor<Descriptor>;

export type HistorySeriesState =
  | {
      readonly status: "unresolved";
      readonly key: HistorySeriesKey;
      readonly buckets: ReadonlyMap<HistoryBucketMapKey, HistoryMetricBucket>;
      readonly coverage: Extract<QueryCoverage, { readonly kind: "none" | "partial" }>;
    }
  | {
      readonly status: "observed";
      readonly key: HistorySeriesKey;
      readonly buckets: ReadonlyMap<HistoryBucketMapKey, HistoryMetricBucket>;
      readonly coverage: Exclude<QueryCoverage, { readonly kind: "none" }>;
      readonly stamp: IngestionStamp;
    };

export interface InterestProgress {
  readonly requiredRegistrations: number;
  readonly completedRegistrations: number;
  readonly requiredReads: number;
  readonly completedReads: number;
  readonly crossedReceiptOrdinal: ReceiptOrdinal;
}

export type InterestState =
  | {
      readonly status: "establishing";
      readonly identity: InterestIdentity;
      readonly startedAtMs: number;
      readonly deadlineMs: number;
      readonly progress: InterestProgress;
    }
  | {
      readonly status: "observing";
      readonly identity: InterestIdentity;
      readonly guarantee: "source-order-unverified";
      readonly sinceReceiptOrdinal: ReceiptOrdinal;
    }
  | {
      readonly status: "recovering";
      readonly identity: InterestIdentity;
      readonly reason: "disconnect" | "registration" | "malformed" | "overflow" | "foreground";
      readonly attempt: number;
      readonly nextRetryAtMs: number;
      readonly progress: InterestProgress;
    }
  | {
      readonly status: "paused";
      readonly identity: InterestIdentity;
      readonly reason: "background" | "offline" | "no-leases";
    }
  | {
      readonly status: "failed";
      readonly identity: InterestIdentity;
      readonly reason: string;
      readonly retryable: boolean;
      readonly attempts: number;
      readonly retryAtMs: number | null;
    };

export type WireRegistrationState =
  | { readonly status: "absent" }
  | {
      readonly status: "registering" | "registered";
      readonly receiver: ReceiverIdentity;
      readonly subscriptionName: ZeropsWireSubscriptionName;
    }
  | {
      readonly status: "failed";
      readonly receiver: ReceiverIdentity;
      readonly subscriptionName: ZeropsWireSubscriptionName;
      readonly reason: string;
    };

export interface DesiredInterestState {
  readonly descriptor: RuntimeInterestDescriptor;
  readonly key: InterestKey;
  readonly leases: number;
  readonly required: boolean;
  readonly registrationAttemptsOnReceiver: number;
  readonly interest: InterestState;
  readonly wire: WireRegistrationState;
}

export type ProjectAccessRole = "OWNER" | "ADMIN" | "BASIC_USER" | "READ_ONLY" | "NO_ACCESS";

export interface ProjectEffectiveAccess {
  readonly project: ProjectRef;
  readonly role: ProjectAccessRole;
  readonly mutationsAllowed: boolean;
}

export interface OrganizationEffectiveAccess {
  readonly organization: OrganizationRef;
  readonly mutationsAllowed: boolean;
}

export interface VerifiedAccessGrant {
  readonly account: AccountRef;
  readonly accountEpoch: AccountEpoch;
  readonly verifiedAtMs: number;
  readonly deadlineMs: number;
  readonly mutationsAllowed: boolean;
  readonly organizations: ReadonlyArray<OrganizationEffectiveAccess>;
  readonly projects: ReadonlyArray<ProjectEffectiveAccess>;
}

/**
 * Which project roles a caller admits for read access, beyond an outright `NO_ACCESS` entry.
 * - "any-role": resources.ts and logs.ts callers — any admitted role (including READ_ONLY) may read.
 * - "no-read-only": inventory.ts's unavailable-reopen fence — READ_ONLY may not reopen an
 *   unavailable facet, matching account-lifecycle.md's "READ_ONLY may not operate Mate".
 * These two behaviours are intentionally different today (F4); this predicate keeps each
 * caller's existing admission unchanged rather than silently widening or narrowing either one.
 */
export type ProjectRoleAdmission = "any-role" | "no-read-only";

export const projectRoleGrantsAccess = (
  grant: VerifiedAccessGrant,
  project: ProjectRef,
  admission: ProjectRoleAdmission,
): boolean => {
  const entry = grant.projects.find(
    (candidate) => projectKeyOf(candidate.project) === projectKeyOf(project),
  );
  if (entry === undefined || entry.role === "NO_ACCESS") return false;
  if (admission === "no-read-only" && entry.role === "READ_ONLY") return false;
  return true;
};

export type AccessDenialScope =
  | { readonly kind: "account"; readonly account: AccountRef }
  | { readonly kind: "project"; readonly project: ProjectRef };

export type AccessState =
  | { readonly status: "unverified" }
  | {
      readonly status: "verifying";
      readonly accountEpoch: AccountEpoch;
      readonly previous: VerifiedAccessGrant | null;
    }
  | ({ readonly status: "verified" } & VerifiedAccessGrant)
  | {
      readonly status: "expired";
      readonly accountEpoch: AccountEpoch;
      readonly expiredAtMs: number;
      readonly previous: VerifiedAccessGrant;
    }
  | {
      readonly status: "denied";
      readonly accountEpoch: AccountEpoch;
      readonly scope: AccessDenialScope;
      readonly deniedAtMs: number;
      readonly previous: VerifiedAccessGrant | null;
    }
  | {
      readonly status: "failed";
      readonly accountEpoch: AccountEpoch;
      readonly failedAtMs: number;
      readonly retryable: boolean;
      readonly reason: string;
      /** Retained content is usable only until this grant's unchanged deadline. */
      readonly previous: VerifiedAccessGrant | null;
      readonly mutationsAllowed: false;
    };

export type AccessObservation =
  | {
      readonly kind: "access-verification-started";
      readonly accountEpoch: AccountEpoch;
    }
  | { readonly kind: "access-verified"; readonly grant: VerifiedAccessGrant }
  | {
      /** A successful organization-authorized create proves access until the current grant expires. */
      readonly kind: "project-access-established";
      readonly accountEpoch: AccountEpoch;
      readonly project: ProjectRef;
    }
  | {
      readonly kind: "access-verification-failed";
      readonly accountEpoch: AccountEpoch;
      readonly failedAtMs: number;
      readonly retryable: boolean;
      readonly reason: string;
    }
  | {
      readonly kind: "access-expired";
      readonly accountEpoch: AccountEpoch;
      readonly expiredAtMs: number;
    }
  | {
      readonly kind: "access-denied";
      readonly accountEpoch: AccountEpoch;
      readonly scope: AccessDenialScope;
      readonly deniedAtMs: number;
    };

export const UNAVAILABLE_REOPEN_ADMISSION = Object.freeze({
  requiredSource: "direct-read-with-fresh-runtime-supplied-effective-access",
  accountFence: "ticket-owner-and-access-grant-must-match-current-account-epoch",
  deadline: "ingestion-time-must-be-before-access-grant-deadline",
  projectRole: "effective-project-role-must-be-OWNER-ADMIN-or-BASIC_USER",
  ordering: "direct-dispatch-ordinal-must-be-newer-than-unavailable-fence",
  staleNativePush: "cannot-reopen-unavailable-state",
} as const);

export const ENTITY_UNAVAILABLE_ADMISSION = Object.freeze({
  transportEvidence: "direct-read-403-or-404-only",
  accessEvidence: "fresh-non-null-runtime-supplied-grant-required",
  roleEvaluation: "use-effective-role-including-READ_ONLY-and-NO_ACCESS-denial",
  accessDeniedObservation: "independently-fences-the-affected-scope",
  timeoutServerDecode: "read-failure-never-unavailable",
} as const);

export type CommandTarget = OrganizationRef | ProjectRef | ServiceRef;

export type PlatformCommandKind =
  | "restart-service"
  | "name-project-agent"
  | "update-project-group-tags"
  | "import-development-container"
  | "enable-zerops-mate"
  | "enable-subdomain-access"
  | "create-project"
  | "create-project-with-mate"
  | "import-project"
  | "import-services"
  | "create-tool-project"
  | "set-integration-token-projects";

interface CommandAttemptBase {
  readonly attemptId: ZeropsCommandAttemptId;
  readonly accountEpoch: AccountEpoch;
  readonly commandKind: PlatformCommandKind;
  readonly target: CommandTarget;
  readonly requestedAtMs: number;
  readonly startedAtReceiptOrdinal: ReceiptOrdinal;
  readonly processRefs: ReadonlyArray<ProcessRef>;
}

export type CommandAttemptState =
  | (CommandAttemptBase & { readonly status: "pending" })
  | (CommandAttemptBase & { readonly status: "accepted" })
  | (CommandAttemptBase & { readonly status: "rejected"; readonly reason: string })
  | (CommandAttemptBase & { readonly status: "uncertain"; readonly reason: string });

export type RuntimeInterestDescriptor =
  | { readonly kind: "organization-inventory"; readonly organization: OrganizationRef }
  | {
      readonly kind: "project-topology";
      readonly project: ProjectRef;
      /** Compatibility request bit; runtimes expose metrics as a separate optional interest. */
      readonly includeCurrentMetrics: boolean;
    }
  | { readonly kind: "project-inventory"; readonly project: ProjectRef }
  | { readonly kind: "project-current-metrics"; readonly project: ProjectRef }
  | { readonly kind: "project-activity"; readonly project: ProjectRef }
  | {
      readonly kind: "project-process-history";
      readonly project: ProjectRef;
      readonly before: string | null;
      readonly limit: number;
    }
  | {
      readonly kind: "project-metric-history";
      readonly project: ProjectRef;
      readonly window: MetricWindow;
    };

export type RegistrationDescriptor =
  | {
      readonly kind: "entity-updates";
      readonly entity: "project" | "service" | "process";
      readonly organization: OrganizationRef;
    }
  | { readonly kind: "query-membership"; readonly query: EntityQueryDescriptor }
  | {
      readonly kind: "current-metrics";
      readonly query: Extract<QueryDescriptor, { readonly kind: "current-metrics-of-project" }>;
    }
  | {
      readonly kind: "metric-history";
      readonly query: Extract<QueryDescriptor, { readonly kind: "metric-history-of-project" }>;
    };

export interface RequestContext {
  /** Effect interruption aborts the underlying fetch/socket work through this signal. */
  readonly abortSignal: AbortSignal;
  readonly deadlineMs: number;
  /** Rechecks current runtime authorization immediately before each mutating HTTP request. */
  readonly beforeProjectWrite?: () => Promise<void>;
}

export interface ZeropsVisibility {
  readonly current: Effect.Effect<"visible" | "hidden">;
  readonly changes: Stream.Stream<"visible" | "hidden">;
}

export interface ZeropsDataRuntimeServices {
  readonly clock: Clock.Clock;
  readonly visibility: ZeropsVisibility;
}

export type AdapterErrorKind =
  | ReadFailureKind
  | "socket-open"
  | "socket-greeting"
  | "socket-closed"
  | "registration"
  | "overflow"
  | "rejected"
  | "uncertain";

export interface AdapterError {
  readonly _tag: "ZeropsDataAdapterError";
  readonly kind: AdapterErrorKind;
  readonly message: string;
  readonly retryable: boolean;
  /** A background 401 is scoped failure evidence and cannot revoke the account by itself. */
  readonly accountRevocationEvidence: false;
}

export type ReceiverEvent =
  | { readonly kind: "observation"; readonly input: PlatformObservation; readonly bytes: number }
  | { readonly kind: "pong" }
  | { readonly kind: "malformed"; readonly subscriptionName?: ZeropsWireSubscriptionName }
  | { readonly kind: "closed"; readonly reason: string };

export interface ReceiverHandle {
  readonly identity: ReceiverIdentity;
  readonly organization: OrganizationRef;
  /** The adapter buffers from open onward; exactly one runtime consumer drains this hot stream. */
  readonly delivery: "hot-single-consumer-buffered-before-open-resolves";
  readonly events: Stream.Stream<ReceiverEvent, AdapterError>;
}

export type ReceiverState =
  | { readonly status: "closed"; readonly identity: ReceiverIdentity | null }
  | {
      readonly status: "opening" | "greeting" | "open";
      readonly identity: ReceiverIdentity;
      readonly openedAtMs: number;
      readonly registrationAttempts: number;
    }
  | {
      readonly status: "retiring";
      readonly identity: ReceiverIdentity;
      readonly reason: "registration-churn" | "reconnect" | "shutdown";
      readonly registrationAttempts: number;
    }
  | {
      readonly status: "failed";
      readonly identity: ReceiverIdentity;
      readonly reason: string;
      readonly retryAtMs: number | null;
    };

interface RegistrationRequestBase {
  readonly identity: InterestIdentity;
  readonly subscriptionName: ZeropsWireSubscriptionName;
}

type MembershipRegistrationRequest<Descriptor extends EntityQueryDescriptor> =
  Descriptor extends EntityQueryDescriptor
    ? RegistrationRequestBase & {
        readonly descriptor: { readonly kind: "query-membership"; readonly query: Descriptor };
        /** Also fences the subscription response's indexed baseline. */
        readonly baselineTicket: ReadTicket & {
          readonly owner: { readonly kind: "interest"; readonly identity: InterestIdentity };
          readonly target: MembershipQueryReadTarget<Descriptor>;
        };
      }
    : never;

type MetricRegistrationRequest<
  Descriptor extends Extract<
    QueryDescriptor,
    { readonly kind: "current-metrics-of-project" | "metric-history-of-project" }
  >,
> = Descriptor extends QueryDescriptor
  ? RegistrationRequestBase & {
      readonly descriptor: Descriptor["kind"] extends "current-metrics-of-project"
        ? { readonly kind: "current-metrics"; readonly query: Descriptor }
        : { readonly kind: "metric-history"; readonly query: Descriptor };
      readonly baselineTicket: ReadTicket & {
        readonly owner: { readonly kind: "interest"; readonly identity: InterestIdentity };
        readonly target: MetricQueryReadTarget<Descriptor>;
      };
    }
  : never;

export type RegistrationRequest =
  | (RegistrationRequestBase & {
      readonly descriptor: Extract<RegistrationDescriptor, { readonly kind: "entity-updates" }>;
      readonly baselineTicket: null;
    })
  | MembershipRegistrationRequest<EntityQueryDescriptor>
  | MetricRegistrationRequest<
      Extract<QueryDescriptor, { readonly kind: "current-metrics-of-project" }>
    >
  | MetricRegistrationRequest<
      Extract<QueryDescriptor, { readonly kind: "metric-history-of-project" }>
    >;

export interface RegistrationReceipt {
  readonly responseObservations: ReadonlyArray<PlatformObservation>;
}

export type PlatformReadRequest = ReadTicket;

export interface PlatformReadResult {
  readonly observations: ReadonlyArray<PlatformObservation>;
}

export interface RestartServiceCommandIntent {
  readonly kind: "restart-service";
  readonly service: ServiceRef;
}

export interface NameProjectAgentCommandIntent {
  readonly kind: "name-project-agent";
  readonly project: ProjectRef;
  readonly name: string;
}

export interface UpdateProjectGroupTagsCommandIntent {
  readonly kind: "update-project-group-tags";
  readonly project: ProjectRef;
  readonly next: {
    readonly groupId?: string;
    readonly role?: ZeropsEnvironmentRole;
    readonly label?: string;
  };
}

export interface ImportDevelopmentContainerCommandIntent {
  readonly kind: "import-development-container";
  readonly project: ProjectRef;
  readonly existingServiceNames?: ReadonlyArray<string>;
  readonly zcpVersion?: string;
  readonly agents?: ReadonlyArray<ZeropsAgentType>;
}

export interface EnableZeropsMateCommandIntent {
  readonly kind: "enable-zerops-mate";
  readonly service: ServiceRef;
}

export interface EnableSubdomainAccessCommandIntent {
  readonly kind: "enable-subdomain-access";
  readonly service: ServiceRef;
}

export interface CreateProjectCommandIntent {
  readonly kind: "create-project";
  readonly organization: OrganizationRef;
  readonly name: string;
  readonly tagList: ReadonlyArray<string>;
  readonly location?: string;
}

export interface CreateProjectWithMateCommandIntent {
  readonly kind: "create-project-with-mate";
  readonly organization: OrganizationRef;
  readonly name: string;
  readonly existingServiceNames?: ReadonlyArray<string>;
  readonly location?: string;
  readonly zcpVersion?: string;
  readonly agents?: ReadonlyArray<ZeropsAgentType>;
  readonly group?: {
    readonly groupId: string;
    readonly role?: ZeropsEnvironmentRole;
    readonly label?: string;
  };
  readonly botName?: string;
}

export interface ImportProjectCommandIntent {
  readonly kind: "import-project";
  readonly organization: OrganizationRef;
  readonly yaml: string;
}

export interface ImportServicesCommandIntent {
  readonly kind: "import-services";
  readonly project: ProjectRef;
  readonly yaml: string;
}

export interface CreateToolProjectCommandIntent {
  readonly kind: "create-tool-project";
  readonly organization: OrganizationRef;
  readonly toolKind: ZeropsToolKind;
  readonly name: string;
  readonly location?: string;
}

export interface SetIntegrationTokenProjectsCommandIntent {
  readonly kind: "set-integration-token-projects";
  readonly organization: OrganizationRef;
  readonly tokenId: string;
  readonly name: string;
  /** Whole-record replacement, never a partial project-grant patch. */
  readonly projects: ReadonlyArray<ZeropsProjectGrant>;
}

export type PlatformCommandIntent =
  | RestartServiceCommandIntent
  | NameProjectAgentCommandIntent
  | UpdateProjectGroupTagsCommandIntent
  | ImportDevelopmentContainerCommandIntent
  | EnableZeropsMateCommandIntent
  | EnableSubdomainAccessCommandIntent
  | CreateProjectCommandIntent
  | CreateProjectWithMateCommandIntent
  | ImportProjectCommandIntent
  | ImportServicesCommandIntent
  | CreateToolProjectCommandIntent
  | SetIntegrationTokenProjectsCommandIntent;

export interface RestartServiceCommand extends RestartServiceCommandIntent {
  readonly attemptId: ZeropsCommandAttemptId;
  readonly accountEpoch: AccountEpoch;
  readonly startedAtReceiptOrdinal: ReceiptOrdinal;
  /** Allocated from the same account-wide counter as ReadTicket.dispatchOrdinal. */
  readonly dispatchOrdinal: DispatchOrdinal;
}

export type PlatformCommand = PlatformCommandIntent & {
  readonly attemptId: ZeropsCommandAttemptId;
  readonly accountEpoch: AccountEpoch;
  readonly startedAtReceiptOrdinal: ReceiptOrdinal;
  /** Allocated from the same account-wide counter as ReadTicket.dispatchOrdinal. */
  readonly dispatchOrdinal: DispatchOrdinal;
};

export interface CommandExecutionRequest {
  readonly command: PlatformCommand;
  readonly enqueuedAtMs: number;
}

export const COMMAND_EXECUTION_ADMISSION = Object.freeze({
  ordering: "serialize-with-access-observations",
  beforeNetworkWrite: "recheck-account-epoch-access-state-and-deadline-with-effect-clock",
  betweenMultistepWrites: "repeat-the-same-check",
  deniedExecution: "reject-attempt-without-network-write",
  uncertainResponse: "never-auto-retry-non-idempotent-command",
} as const);

export type PlatformCommandResult =
  | { readonly kind: "restart-service"; readonly value: void }
  | { readonly kind: "name-project-agent"; readonly value: ZeropsProject }
  | { readonly kind: "update-project-group-tags"; readonly value: ZeropsProject }
  | {
      readonly kind: "import-development-container";
      readonly value: { readonly serviceName: string };
    }
  | { readonly kind: "enable-zerops-mate"; readonly value: void }
  | { readonly kind: "enable-subdomain-access"; readonly value: void }
  | { readonly kind: "create-project"; readonly value: ZeropsProject }
  | {
      readonly kind: "create-project-with-mate";
      readonly value: { readonly project: ZeropsProject; readonly serviceName: string };
    }
  | { readonly kind: "import-project"; readonly value: { readonly projectId: string } }
  | { readonly kind: "import-services"; readonly value: void }
  | {
      readonly kind: "create-tool-project";
      readonly value: { readonly project: ZeropsProject };
    }
  | { readonly kind: "set-integration-token-projects"; readonly value: void };

export interface PlatformCommandReceipt {
  readonly processRefs: ReadonlyArray<ProcessRef>;
  readonly observations: ReadonlyArray<PlatformObservation>;
  /** Legacy/fake adapters may omit this; public typed execution rejects that response. */
  readonly result?: PlatformCommandResult;
}

export interface CommandExecution<Value> {
  readonly attempt: CommandAttemptRef;
  readonly value: Value;
}

/**
 * The caller owns the request identity. After a successful read/execute Effect it
 * enqueues returned observations and then the matching completion. Registration
 * success enqueues observations, the baseline read completion when present, then
 * registration completion. All markers use the original request/command; adapter
 * results never repeat IDs. openReceiver succeeds only after its bounded ingress
 * buffer and subscription-name routing are ready to retain incoming frames.
 */
export interface ZeropsDataAdapter {
  readonly openReceiver: (
    scope: AccountScope,
    organization: OrganizationRef,
    receiver: ReceiverIdentity,
    context: RequestContext,
  ) => Effect.Effect<ReceiverHandle, AdapterError, Scope.Scope>;
  readonly register: <Request extends RegistrationRequest>(
    receiver: ReceiverHandle,
    request: Request,
    context: RequestContext,
  ) => Effect.Effect<RegistrationReceipt, AdapterError>;
  readonly read: <Request extends PlatformReadRequest>(
    request: Request,
    context: RequestContext,
  ) => Effect.Effect<PlatformReadResult, AdapterError>;
  readonly execute: <Command extends PlatformCommand>(
    command: Command,
    context: RequestContext,
  ) => Effect.Effect<PlatformCommandReceipt, AdapterError>;
  readonly closeReceiver: (receiver: ReceiverHandle) => Effect.Effect<void>;
}

export type InterestLease = {
  readonly leaseId: ZeropsLeaseId;
  readonly interest: InterestKey;
  /** Idempotent; scope finalization invokes the same release path. */
  readonly release: Effect.Effect<void>;
};

export interface LeaseAdmissionError {
  readonly _tag: "ZeropsLeaseAdmissionError";
  readonly reason: "runtime-closed" | "account-mismatch" | "receiver-capacity" | "account-capacity";
  readonly message: string;
}

export interface ViewObservation {
  readonly required: ReadonlyArray<InterestState>;
  readonly optional: ReadonlyArray<InterestState>;
  readonly access: AccessState;
}

export interface EntityRead<Record extends ZeropsEntityRecord> {
  readonly value: EntityKnowledge<Record>;
  readonly observation: ViewObservation;
}

export interface CollectionRead<Record extends ZeropsEntityRecord> {
  readonly value: ReadonlyArray<EntityKnowledge<Record>>;
  readonly query: QueryState<CollectionQueryForRecord<Record>>;
  readonly observation: ViewObservation;
}

export interface ServiceUsage {
  readonly containers: number;
  /** Dedicated plus shared CPU, in cores, summed across the service's containers. */
  readonly cpu: StatPair;
  readonly memoryGb: StatPair;
  readonly diskGb: StatPair;
}

export interface UsageRead {
  readonly value: ServiceUsage | null;
  readonly coverage: QueryCoverage;
  readonly observation: ViewObservation;
}

export interface ProjectTopologyRead {
  readonly project: EntityRead<ProjectRecord>;
  readonly services: CollectionRead<ServiceRecord>;
  readonly runningProcesses: CollectionRead<ProcessRecord>;
  readonly observation: ViewObservation;
}

export interface HistoryReadView {
  readonly series: HistorySeriesState;
  readonly observation: ViewObservation;
}

export interface ProjectActivityRead {
  readonly running: CollectionRead<ProcessRecord>;
  readonly retainedHistory: ReadonlyArray<EntityKnowledge<ProcessRecord>>;
  readonly observation: ViewObservation;
}

export interface OperationProgressView {
  readonly attempt: CommandAttemptState | null;
  readonly processes: ReadonlyArray<EntityKnowledge<ProcessRecord>>;
  readonly observation: ViewObservation;
}

export interface CommandAttemptRef {
  readonly account: AccountRef;
  readonly accountEpoch: AccountEpoch;
  readonly attemptId: ZeropsCommandAttemptId;
}

export interface ZeropsDataReads {
  readonly access: Atom.Atom<AccessState>;
  readonly project: (ref: ProjectRef) => Atom.Atom<EntityRead<ProjectRecord>>;
  readonly projectsOf: (organization: OrganizationRef) => Atom.Atom<CollectionRead<ProjectRecord>>;
  readonly service: (ref: ServiceRef) => Atom.Atom<EntityRead<ServiceRecord>>;
  readonly servicesOf: (project: ProjectRef) => Atom.Atom<CollectionRead<ServiceRecord>>;
  readonly runningProcessesOf: (project: ProjectRef) => Atom.Atom<CollectionRead<ProcessRecord>>;
  readonly usage: (service: ServiceRef) => Atom.Atom<UsageRead>;
  readonly history: (key: HistorySeriesKey) => Atom.Atom<HistoryReadView>;
  readonly topology: (project: ProjectRef) => Atom.Atom<ProjectTopologyRead>;
  readonly activity: (project: ProjectRef) => Atom.Atom<ProjectActivityRead>;
  readonly operationProgress: (attempt: CommandAttemptRef) => Atom.Atom<OperationProgressView>;
  readonly commandAttempt: (attempt: CommandAttemptRef) => Atom.Atom<CommandAttemptState | null>;
}

export interface CommandAdmissionError {
  readonly _tag: "ZeropsCommandAdmissionError";
  readonly reason:
    | "runtime-closed"
    | "access-unverified"
    | "access-expired"
    | "access-denied"
    | "command-capacity";
  readonly message: string;
}

export interface ZeropsDataCommands {
  /** Creates pending state before transport starts in the runtime-owned scope. */
  readonly startCommand: (
    intent: PlatformCommandIntent,
  ) => Effect.Effect<CommandAttemptRef, CommandAdmissionError>;
  readonly restartService: (
    service: ServiceRef,
  ) => Effect.Effect<CommandExecution<void>, CommandAdmissionError | AdapterError>;
  readonly nameProjectAgent: (
    project: ProjectRef,
    name: string,
  ) => Effect.Effect<CommandExecution<ZeropsProject>, CommandAdmissionError | AdapterError>;
  readonly updateProjectGroupTags: (
    project: ProjectRef,
    next: UpdateProjectGroupTagsCommandIntent["next"],
  ) => Effect.Effect<CommandExecution<ZeropsProject>, CommandAdmissionError | AdapterError>;
  readonly importDevelopmentContainer: (
    input: Omit<ImportDevelopmentContainerCommandIntent, "kind" | "project"> & {
      readonly project: ProjectRef;
    },
  ) => Effect.Effect<
    CommandExecution<{ readonly serviceName: string }>,
    CommandAdmissionError | AdapterError
  >;
  readonly enableZeropsMate: (
    service: ServiceRef,
  ) => Effect.Effect<CommandExecution<void>, CommandAdmissionError | AdapterError>;
  readonly enableSubdomainAccess: (
    service: ServiceRef,
  ) => Effect.Effect<CommandExecution<void>, CommandAdmissionError | AdapterError>;
  readonly createProject: (
    input: Omit<CreateProjectCommandIntent, "kind" | "organization"> & {
      readonly organization: OrganizationRef;
    },
  ) => Effect.Effect<CommandExecution<ZeropsProject>, CommandAdmissionError | AdapterError>;
  readonly createProjectWithMate: (
    input: Omit<CreateProjectWithMateCommandIntent, "kind" | "organization"> & {
      readonly organization: OrganizationRef;
    },
  ) => Effect.Effect<
    CommandExecution<{ readonly project: ZeropsProject; readonly serviceName: string }>,
    CommandAdmissionError | AdapterError
  >;
  readonly importProject: (
    organization: OrganizationRef,
    yaml: string,
  ) => Effect.Effect<
    CommandExecution<{ readonly projectId: string }>,
    CommandAdmissionError | AdapterError
  >;
  readonly importServices: (
    project: ProjectRef,
    yaml: string,
  ) => Effect.Effect<CommandExecution<void>, CommandAdmissionError | AdapterError>;
  readonly createToolProject: (
    input: Omit<CreateToolProjectCommandIntent, "kind" | "organization"> & {
      readonly organization: OrganizationRef;
    },
  ) => Effect.Effect<
    CommandExecution<{ readonly project: ZeropsProject }>,
    CommandAdmissionError | AdapterError
  >;
  readonly setIntegrationTokenProjects: (
    input: Omit<SetIntegrationTokenProjectsCommandIntent, "kind" | "organization"> & {
      readonly organization: OrganizationRef;
    },
  ) => Effect.Effect<CommandExecution<void>, CommandAdmissionError | AdapterError>;
}

export interface ZeropsDataRuntime {
  readonly scope: AccountScope;
  readonly reads: ZeropsDataReads;
  readonly commands: ZeropsDataCommands;
  readonly acquire: (
    descriptor: RuntimeInterestDescriptor,
  ) => Effect.Effect<InterestLease, LeaseAdmissionError, Scope.Scope>;
  /**
   * Idempotent. It closes admission and advances the account fence before
   * interrupting work, closing receivers and clearing retained grants/model state.
   */
  readonly shutdown: (
    reason: "logout" | "account-replaced" | "application-close",
  ) => Effect.Effect<void>;
}
