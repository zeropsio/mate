import type { ZeropsCellAdapter } from "./cells.ts";
import type * as Clock from "effect/Clock";
import type * as Effect from "effect/Effect";
import type * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import type * as Stream from "effect/Stream";
import type { Atom } from "effect/unstable/reactivity";
import type { ActivityAppVersion } from "../activity/dto.ts";
import type { ZeropsProject } from "../api.ts";
import type { Shown } from "../knowledge/known.ts";
import type { ZeropsServiceDeployedVersion } from "./deployedVersion.ts";
import type { ZeropsAgentType } from "../newProject.ts";

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

/**
 * A ref's key, computed once per ref object. Refs are immutable, and every publication keys the
 * account's refs again, so a key is serialized once rather than on every read.
 */
function keyedOnce<Ref extends object, Key>(keyOf: (ref: Ref) => Key): (ref: Ref) => Key {
  const keys = new WeakMap<Ref, Key>();
  return (ref) => {
    let key = keys.get(ref);
    if (key === undefined) {
      key = keyOf(ref);
      keys.set(ref, key);
    }
    return key;
  };
}

export const organizationKeyOf = keyedOnce((ref: OrganizationRef): OrganizationKey =>
  OrganizationKey.make(
    scopedKey(["organization", ref.account.apiOrigin, ref.account.accountId, ref.organizationId]),
  ),
);

export const projectKeyOf = keyedOnce((ref: ProjectRef): ProjectKey =>
  ProjectKey.make(
    scopedKey([
      "project",
      ref.organization.account.apiOrigin,
      ref.organization.account.accountId,
      ref.organization.organizationId,
      ref.projectId,
    ]),
  ),
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

/**
 * A service's active app version. `null` is "not stated by this observation":
 * a native service frame carries only `{base, created, id, lastUpdate, os,
 * status}` (measured 2026-09-23), so its source and name stay unknown while
 * the deploy itself is known to exist.
 */
export interface ServiceDeployInfo {
  /** The app version's id — what a build process's `appVersion.id` names. */
  readonly id: string | null;
  readonly status: string | null;
  /** `CLI`, `GIT`, `GITHUB`, `GITLAB`, `GUI` or `NONE` (a runtime never deployed). */
  readonly source: string | null;
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

type QueryForTarget<Target extends EntityReadTarget> = Target["kind"] extends "project"
  ? Extract<EntityQueryDescriptor, { readonly kind: "projects-of-organization" }>
  : Extract<EntityQueryDescriptor, { readonly kind: "services-of-project" }>;

type EntityUpdateRegistrationForTarget<Target extends EntityReadTarget> = RegistrationRequest & {
  readonly descriptor: Extract<RegistrationDescriptor, { readonly kind: "entity-updates" }> & {
    readonly entity: Target["kind"];
  };
};

export type FieldObservation<Fields, Target extends EntityReadTarget> =
  | {
      readonly source: "indexed-search";
      readonly ticket: ReadTicket & {
        readonly target: MembershipQueryReadTarget<QueryForTarget<Target>>;
      };
      readonly fields: FacetPatch<Fields>;
      readonly metadata: SourceMetadata;
    }
  | {
      readonly source: "direct-read";
      readonly ticket: ReadTicket & {
        readonly target: Target | MembershipQueryReadTarget<QueryForTarget<Target>>;
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

export type QueryDescriptor =
  | {
      readonly kind: "projects-of-organization";
      readonly organization: OrganizationRef;
      readonly statuses: ReadonlyArray<string>;
      readonly schemaVersion: 1;
    }
  | {
      /**
       * One project's services, read directly and lag-free (`GET /project/{id}/service-stack`),
       * never subscribed: only the confirming read an absence asks for (§9 C19).
       */
      readonly kind: "services-of-project";
      readonly project: ProjectRef;
      readonly schemaVersion: 1;
    }
  | {
      /**
       * The organization's service variables of these keys (`POST /user-data/search`, `key in`):
       * the Mate flag and the deploy a service last started, for every service in one search.
       */
      readonly kind: "service-variables-of-services";
      readonly organization: OrganizationRef;
      readonly serviceIds: ReadonlyArray<string>;
      readonly keys: ReadonlyArray<string>;
      /** Only these variables: a read by id of rows the list's frames named (`entityTable.ts`). */
      readonly ids?: ReadonlyArray<string>;
      readonly schemaVersion: 1;
    };

/** The searches whose rows the entity table holds as the platform sends them (`entityTable.ts`). */
export type TableQueryDescriptor = Extract<
  QueryDescriptor,
  { readonly kind: "service-variables-of-services" }
>;

/** The platform entities the entity table holds, by their search's path. */
export type TableEntity = "user-data";

export type EntityQueryDescriptor = Extract<
  QueryDescriptor,
  {
    readonly kind: "projects-of-organization" | "services-of-project";
  }
>;

/** The entity queries the runtime reads and subscribes: an organization's projects, a project's services. */
export type MembershipQueryDescriptor = Extract<
  EntityQueryDescriptor,
  { readonly kind: "projects-of-organization" | "services-of-project" }
>;

export type QueryMemberRef<Descriptor extends EntityQueryDescriptor> =
  Descriptor["kind"] extends "projects-of-organization"
    ? ProjectRef
    : Descriptor["kind"] extends "services-of-project" | "services-of-project"
      ? ServiceRef
      : ProcessRef;

const canonicalStringSet = (values: ReadonlyArray<string>): string =>
  JSON.stringify([...new Set(values)].sort());

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
    case "service-variables-of-services":
      return QueryKey.make(
        scopedKey([
          descriptor.kind,
          organizationKeyOf(descriptor.organization),
          canonicalStringSet(descriptor.serviceIds),
          canonicalStringSet(descriptor.keys),
          descriptor.ids === undefined ? "" : canonicalStringSet(descriptor.ids),
          String(descriptor.schemaVersion),
        ]),
      );
  }
};

export type ProjectFacetName = "identity" | "lifecycle" | "presentation" | "placement";
export type ServiceFacetName = "identity" | "lifecycle" | "routing" | "deployment" | "scaling";

export const PROJECT_READ_FACETS = ["identity", "lifecycle", "presentation", "placement"] as const;
export const SERVICE_READ_FACETS = [
  "identity",
  "lifecycle",
  "routing",
  "deployment",
  "scaling",
] as const;

export interface ProjectReadTarget {
  readonly kind: "project";
  readonly ref: ProjectRef;
}

export interface ServiceReadTarget {
  readonly kind: "service";
  readonly ref: ServiceRef;
}

export type EntityReadTarget = ProjectReadTarget | ServiceReadTarget;

export interface MembershipQueryReadTarget<
  Descriptor extends MembershipQueryDescriptor = MembershipQueryDescriptor,
> {
  readonly kind: "query";
  readonly descriptor: Descriptor;
}

export interface TableQueryReadTarget<
  Descriptor extends TableQueryDescriptor = TableQueryDescriptor,
> {
  readonly kind: "query";
  readonly descriptor: Descriptor;
}

export type ReadTarget = EntityReadTarget | MembershipQueryReadTarget | TableQueryReadTarget;

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
      readonly kind: "baseline";
      readonly target: MembershipQueryReadTarget;
      /** Native membership after this marker overlays an admitted baseline. */
      readonly membershipReceiptOrdinalAtStart: ReceiptOrdinal;
    })
  | (ReadTicketBase & {
      readonly kind: "baseline";
      readonly target: TableQueryReadTarget;
      /** Membership frames after this marker overlay an admitted baseline. */
      readonly membershipReceiptOrdinalAtStart: ReceiptOrdinal;
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
  | "query-membership"
  | "table";

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

type QueryBaselineFor<Descriptor extends MembershipQueryDescriptor> =
  Descriptor extends MembershipQueryDescriptor
    ? {
        readonly kind: "query-baseline-observed";
        readonly members: ReadonlyArray<QueryMemberRef<Descriptor>>;
        readonly unresolvedMembers: ReadonlyArray<QueryMemberRef<Descriptor>>;
        readonly observedTotal: number | null;
        readonly coverage: QueryCoverage;
        readonly source: "indexed-search" | "direct-read";
        readonly ticket: ReadTicketBase & {
          readonly kind: "baseline";
          readonly target: MembershipQueryReadTarget<Descriptor>;
          /** Native membership after this marker overlays an admitted baseline. */
          readonly membershipReceiptOrdinalAtStart: ReceiptOrdinal;
        };
      }
    : never;

export type QueryBaselineObservation = QueryBaselineFor<MembershipQueryDescriptor>;

type QueryMembershipFor<Descriptor extends MembershipQueryDescriptor> =
  Descriptor extends MembershipQueryDescriptor
    ? {
        readonly kind: "query-membership-observed";
        readonly operation: "add" | "remove";
        readonly member: QueryMemberRef<Descriptor>;
        readonly registration: RegistrationRequest & {
          readonly descriptor: { readonly kind: "query-membership"; readonly query: Descriptor };
        };
      }
    : never;

export type QueryMembershipObservation = QueryMembershipFor<MembershipQueryDescriptor>;

export interface EntityUnavailableObservation {
  readonly kind: "entity-unavailable";
  readonly ref: ProjectRef | ServiceRef;
  readonly reason: "forbidden" | "not-found" | "access-revoked";
  readonly ticket: ReadTicket & { readonly target: EntityReadTarget };
}

/** One service variable, as `POST /user-data/search` states it. */
export interface ServiceVariableRow {
  readonly id: string;
  readonly serviceId: string | null;
  readonly projectId: string | null;
  readonly key: string;
  readonly content: string | null;
}

export type TableRow = ServiceVariableRow;

export interface TableRowsOf {
  readonly "user-data": ServiceVariableRow;
}

/**
 * Rows of a table entity: a search's whole answer (`direct-read`, which also states the list's
 * members), or the rows an update frame carries (`native-push`), each the full row.
 */
export type TableRowsObservation = {
  readonly kind: "table-rows-observed";
  readonly entity: TableEntity;
  readonly rows: ReadonlyArray<TableRow>;
} & (
  | {
      readonly source: "direct-read";
      readonly coverage: QueryCoverage;
      readonly ticket: ReadTicket & { readonly target: TableQueryReadTarget };
    }
  | {
      readonly source: "native-push";
      readonly registration: RegistrationRequest & {
        readonly descriptor: { readonly kind: "table-updates" };
      };
    }
);

/** An id a table list's stream added or deleted. */
export interface TableMembershipObservation {
  readonly kind: "table-membership-observed";
  readonly operation: "add" | "remove";
  readonly id: string;
  readonly registration: RegistrationRequest & {
    readonly descriptor: { readonly kind: "table-list" };
  };
}

export type TableObservation = TableRowsObservation | TableMembershipObservation;

export type PlatformObservation =
  | EntityObservation
  | QueryBaselineObservation
  | QueryMembershipObservation
  | EntityUnavailableObservation
  | TableObservation;

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
      : never;

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
  /**
   * The project's own grants, every member's, as the read that verified it carried them (its
   * `userRoles`): what HQ's rule weighs above the org role, and who its `OWNER` is. Absent where no
   * read said — access the runtime holds for a project it made itself — and empty for one hidden
   * from the viewer, whose grants are not theirs to know.
   */
  readonly userRoles?: ReadonlyArray<ProjectGrant>;
}

/** One member's grant on a project, as its `userRoles` names it. */
export interface ProjectGrant {
  /** The `clientUser` id: the member row the grant names. */
  readonly clientUserId: string;
  readonly roleCode: string;
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
 * - "any-role": cells.ts and logs.ts callers — any admitted role (including READ_ONLY) may read.
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

export type CommandTarget = OrganizationRef | ProjectRef;

export type PlatformCommandKind =
  | "import-development-container"
  | "create-project"
  | "import-project"
  | "import-services"
  | "harden-mate";

interface CommandAttemptBase {
  readonly attemptId: ZeropsCommandAttemptId;
  readonly accountEpoch: AccountEpoch;
  readonly commandKind: PlatformCommandKind;
  readonly target: CommandTarget;
  readonly requestedAtMs: number;
  readonly startedAtReceiptOrdinal: ReceiptOrdinal;
}

export type CommandAttemptState =
  | (CommandAttemptBase & { readonly status: "pending" })
  | (CommandAttemptBase & { readonly status: "accepted" })
  | (CommandAttemptBase & { readonly status: "rejected"; readonly reason: string })
  | (CommandAttemptBase & { readonly status: "uncertain"; readonly reason: string });

export type RuntimeInterestDescriptor =
  | { readonly kind: "organization-inventory"; readonly organization: OrganizationRef }
  /**
   * The organization's service variables the app reads (`SERVICE_VARIABLE_KEYS`): the Mate flag
   * and the deploy a service last started, listed and streamed.
   */
  | {
      readonly kind: "project-variables";
      readonly project: ProjectRef;
      readonly serviceIds: ReadonlyArray<string>;
    }
  | {
      readonly kind: "project-topology";
      readonly project: ProjectRef;
    }
  | { readonly kind: "project-inventory"; readonly project: ProjectRef }
  /**
   * A project its organization's list does not carry yet — one this tab just created, which the
   * platform answers for before its lists do: read on its own, lag-free.
   */
  | { readonly kind: "project-record"; readonly project: ProjectRef }
  /** A visible permission decision demands its access facts; the grant owns the sole read. */
  | { readonly kind: "project-access"; readonly project: ProjectRef };

export type RegistrationDescriptor =
  | {
      readonly kind: "entity-updates";
      readonly entity: "project";
      readonly organization: OrganizationRef;
    }
  | {
      readonly kind: "entity-updates";
      readonly entity: "service";
      readonly project: ProjectRef;
      readonly organization: OrganizationRef;
    }
  | { readonly kind: "query-membership"; readonly query: MembershipQueryDescriptor }
  /** A table list's membership stream (`listStream`): the ids its search admits, as they change. */
  | { readonly kind: "table-list"; readonly query: TableQueryDescriptor }
  /** A table entity's update stream (`updateStream`) restricted to its service IDs. */
  | {
      readonly kind: "table-updates";
      readonly entity: TableEntity;
      readonly organization: OrganizationRef;
      readonly serviceIds: ReadonlyArray<string>;
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
  /**
   * The HTTP error status the platform refused the request with. Absent when no answer came back
   * (a timeout, a lost connection, a cancellation), when an answer could not be read, and when
   * the request failed before it was sent.
   */
  readonly status?: number;
  /** How long a 429 asked to wait (its `Retry-After`), when it said. */
  readonly retryAfterMs?: number;
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

type MembershipRegistrationRequest<Descriptor extends MembershipQueryDescriptor> =
  Descriptor extends MembershipQueryDescriptor
    ? RegistrationRequestBase & {
        readonly descriptor: { readonly kind: "query-membership"; readonly query: Descriptor };
        /** Also fences the subscription response's indexed baseline. */
        readonly baselineTicket: ReadTicket & {
          readonly owner: { readonly kind: "interest"; readonly identity: InterestIdentity };
          readonly target: MembershipQueryReadTarget<Descriptor>;
        };
      }
    : never;

export type RegistrationRequest =
  | (RegistrationRequestBase & {
      readonly descriptor: Extract<RegistrationDescriptor, { readonly kind: "entity-updates" }>;
      readonly baselineTicket: null;
    })
  | MembershipRegistrationRequest<MembershipQueryDescriptor>
  | (RegistrationRequestBase & {
      readonly descriptor: Extract<RegistrationDescriptor, { readonly kind: "table-updates" }>;
      readonly baselineTicket: null;
    })
  | (RegistrationRequestBase & {
      readonly descriptor: Extract<RegistrationDescriptor, { readonly kind: "table-list" }>;
      /** Also fences the subscription response's search answer. */
      readonly baselineTicket: ReadTicket & {
        readonly owner: { readonly kind: "interest"; readonly identity: InterestIdentity };
        readonly target: TableQueryReadTarget;
      };
    });

export interface RegistrationReceipt {
  readonly responseObservations: ReadonlyArray<PlatformObservation>;
}

export type PlatformReadRequest = ReadTicket;

export interface PlatformReadResult {
  /** Direct project answer, retained for access classification of this same read. */
  readonly project?: ZeropsProject;
  readonly observations: ReadonlyArray<PlatformObservation>;
}

export interface ImportDevelopmentContainerCommandIntent {
  readonly kind: "import-development-container";
  readonly project: ProjectRef;
  /** The project's name: the Mate's key is named after it (`zcp-<name>`). */
  readonly projectName: string;
  readonly zcpVersion?: string;
  readonly agents?: ReadonlyArray<ZeropsAgentType>;
  /** The tier's runtimes, for zcp to import on boot (`MATE_SETUP_RUNTIMES`). */
  readonly setupRuntimesYaml?: string;
}

export interface CreateProjectCommandIntent {
  readonly kind: "create-project";
  readonly organization: OrganizationRef;
  readonly name: string;
  readonly tagList: ReadonlyArray<string>;
  readonly location?: string;
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

/**
 * The birth's hardening, whole (`ZeropsApiClient.hardenMate`, spec-mate §3
 * B-1/B-2/B-3): the Mate's own token lowered off `ADMIN` and out of the org,
 * every delegation it carries dropped, then `envIsolation` to `service`,
 * `ZCP_API_KEY` moved onto the container, the project entry deleted, every
 * service that runs the project's code restarted. Idempotent — a hardened
 * Mate makes it a read.

 */
export interface HardenMateCommandIntent {
  readonly kind: "harden-mate";
  readonly project: ProjectRef;
  /** The key the Mate named to HQ by its id: that one alone is hardened (audit K3). */
  readonly keyTokenId?: string;
}

export type PlatformCommandIntent =
  | ImportDevelopmentContainerCommandIntent
  | CreateProjectCommandIntent
  | ImportProjectCommandIntent
  | ImportServicesCommandIntent
  | HardenMateCommandIntent;

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
  | {
      readonly kind: "import-development-container";
      readonly value: {
        readonly serviceName: string;
        readonly imported: boolean;
        readonly processId?: string;
      };
    }
  | { readonly kind: "create-project"; readonly value: ZeropsProject }
  | { readonly kind: "import-project"; readonly value: { readonly projectId: string } }
  | { readonly kind: "import-services"; readonly value: void }
  | {
      readonly kind: "harden-mate";
      readonly value: {
        readonly tokenLowered: boolean;
        /** Why a key of the Mate's could not be lowered: the platform refused this account. */
        readonly keyNotLowered: string | null;
        readonly delegationsDropped: number;
        readonly isolationSteps: number;
        readonly restarted: boolean;
      };
    };

export interface PlatformCommandReceipt {
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
  /** The reads no stream carries, one per cell kind (`cells.ts`); without them, none answers. */
  readonly cells?: ZeropsCellAdapter;
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
  /**
   * The project this collection read belongs to, for service and process scopes.
   */
  readonly project?: ProjectRef;
}

export interface ProjectTopologyRead {
  readonly project: EntityRead<ProjectRecord>;
  readonly services: CollectionRead<ServiceRecord>;
  readonly observation: ViewObservation;
}

export interface CommandAttemptRef {
  readonly account: AccountRef;
  readonly accountEpoch: AccountEpoch;
  readonly attemptId: ZeropsCommandAttemptId;
}

export interface ZeropsDataReads {
  readonly access: Atom.Atom<AccessState>;
  readonly service: (ref: ServiceRef) => Atom.Atom<EntityRead<ServiceRecord>>;
  readonly servicesOf: (project: ProjectRef) => Atom.Atom<CollectionRead<ServiceRecord>>;
  readonly topology: (project: ProjectRef) => Atom.Atom<ProjectTopologyRead>;
  readonly commandAttempt: (attempt: CommandAttemptRef) => Atom.Atom<CommandAttemptState | null>;
  /** What the service runs, as the account's store states it (`deployedVersion.ts`). */
  readonly deployedVersion: (service: ServiceRef) => Atom.Atom<Shown<ZeropsServiceDeployedVersion>>;
  /** The service's Mate flag, as the account's store states it (`deployedVersion.ts`). */
  readonly mateFlag: (service: ServiceRef) => Atom.Atom<boolean | "unknown" | "unread">;
  /** Whether the service carries the new press's marker (`deployedVersion.ts`). */
  readonly setupMarker: (service: ServiceRef) => Atom.Atom<boolean | "unknown" | "unread">;
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
  readonly importDevelopmentContainer: (
    input: Omit<ImportDevelopmentContainerCommandIntent, "kind" | "project"> & {
      readonly project: ProjectRef;
    },
  ) => Effect.Effect<
    CommandExecution<{
      readonly serviceName: string;
      readonly imported: boolean;
      readonly processId?: string;
    }>,
    CommandAdmissionError | AdapterError
  >;
  readonly createProject: (
    input: Omit<CreateProjectCommandIntent, "kind" | "organization"> & {
      readonly organization: OrganizationRef;
    },
  ) => Effect.Effect<CommandExecution<ZeropsProject>, CommandAdmissionError | AdapterError>;
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
  readonly isolateProjectEnv: (
    project: ProjectRef,
    keyTokenId?: string,
  ) => Effect.Effect<
    CommandExecution<{
      readonly tokenLowered: boolean;
      /** Why a key of the Mate's could not be lowered: the platform refused this account. */
      readonly keyNotLowered: string | null;
      readonly delegationsDropped: number;
      readonly isolationSteps: number;
      readonly restarted: boolean;
    }>,
    CommandAdmissionError | AdapterError
  >;
}

export interface ZeropsDataRuntime {
  readonly scope: AccountScope;
  readonly reads: ZeropsDataReads;
  readonly commands: ZeropsDataCommands;
  readonly acquire: (
    descriptor: RuntimeInterestDescriptor,
  ) => Effect.Effect<InterestLease, LeaseAdmissionError, Scope.Scope>;
  /**
   * Takes a lease for each descriptor in one admission pass: the account sees them in one
   * publication, and their establishments start together after it. Each result is its
   * descriptor's lease or the reason it was refused; a refusal takes nothing from the others.
   */
  readonly acquireMany: (
    descriptors: ReadonlyArray<RuntimeInterestDescriptor>,
  ) => Effect.Effect<
    ReadonlyArray<Result.Result<InterestLease, LeaseAdmissionError>>,
    never,
    Scope.Scope
  >;
  /** An explicit attempt re-establishes held demand in this org or project, retaining its values. */
  readonly refresh: (scope: OrganizationRef | ProjectRef) => Effect.Effect<void>;
  /**
   * Idempotent. It closes admission and advances the account fence before
   * interrupting work, closing receivers and clearing retained grants/model state.
   */
  readonly shutdown: (
    reason: "logout" | "account-replaced" | "application-close",
  ) => Effect.Effect<void>;
}
