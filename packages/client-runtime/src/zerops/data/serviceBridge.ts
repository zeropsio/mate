/**
 * IN TRANSIT — owned by the slice that deletes the data runtime; deleted with it.
 *
 * The runtime's readers still take a project's services in its old shapes
 * (`CollectionRead<ServiceRecord>`): the stops' deployments, the topology, the Mate's setup marker.
 * This bridge derives them, read only, from the account's store — the organization's services
 * listing (`projectServices`) — so services come from one source and the runtime reads none of its
 * own. Its freshness is the listing's own, stated as the project inventory's interest. Nothing here
 * reads Zerops or holds a value of its own: each record is derived again from the store's value.
 *
 * @module zerops/data/serviceBridge
 */
import type { ServiceValue } from "../../data/families/service.ts";
import type { ProjectServices } from "../../data/projections/services.ts";
import type { ZeropsAppVersion, ZeropsAutoscalingResource } from "../api.ts";
import { interestKeyOf } from "./runtime.ts";
import {
  AccountEpoch,
  InterestEpoch,
  ReadStartOrdinal,
  ReceiptOrdinal,
  ReceiverEpoch,
  ZeropsReceiverId,
  ZeropsServiceId,
  queryKeyOf,
  serviceKeyOf,
  type CollectionRead,
  type FacetAdmission,
  type InterestState,
  type ProjectRef,
  type ServiceDeployInfo,
  type ServiceRecord,
} from "./types.ts";

const ADMISSION: FacetAdmission = {
  lastNativeReceiptOrdinal: null,
  lastAppliedAuthoritativeDispatchOrdinal: null,
  hasAuthoritativeObservation: true,
};

/** The store's revisions are the listing's own: the runtime's receipt order says nothing of them. */
const STAMP = { receiptOrdinal: ReceiptOrdinal.make(0), observedAtMs: 0 };

const observed = <Fields>(fields: Fields) =>
  ({
    knowledge: "observed",
    fields,
    unresolvedRequiredFields: [],
    source: "native-push",
    stamp: STAMP,
    admission: ADMISSION,
  }) as const;

const UNSAID = {
  knowledge: "unresolved",
  fields: {},
  unresolvedRequiredFields: [],
  admission: ADMISSION,
} as const;

const nullable = <T>(value: T | null | undefined): T | null => value ?? null;

const range = (minimum: number | null | undefined, maximum: number | null | undefined) =>
  minimum === undefined && maximum === undefined
    ? null
    : { min: nullable(minimum), max: nullable(maximum) };

const resource = (
  bound: ZeropsAutoscalingResource | null | undefined,
  field: keyof ZeropsAutoscalingResource,
) => bound?.[field];

/**
 * The active version's name: its own, or the service's `appVersionName` variable while
 * `appVersionId` beside it names that version (A14).
 */
function activeVersionName(value: ServiceValue, version: ZeropsAppVersion): string | null {
  if (version.name !== undefined && version.name !== null) return version.name;
  const variable = (key: string) =>
    value.userData?.find((entry) => entry.key === key)?.content?.trim() || null;
  const id = version.id ?? null;
  return id !== null && variable("appVersionId") === id ? variable("appVersionName") : null;
}

function deployOf(value: ServiceValue, version: ZeropsAppVersion): ServiceDeployInfo {
  return {
    id: version.id ?? null,
    status: version.status ?? null,
    source: version.source ?? null,
    activatedAt: version.lastUpdate || version.created || null,
    name: activeVersionName(value, version),
    branch:
      version.githubIntegration?.branchName ??
      version.gitlabIntegration?.branchName ??
      version.publicGitSource?.branchName ??
      null,
    commit: version.githubIntegration?.commit ?? version.gitlabIntegration?.commit ?? null,
    tag: version.githubIntegration?.tagName ?? version.gitlabIntegration?.tagName ?? null,
    repository:
      version.githubIntegration?.repositoryFullName ??
      version.gitlabIntegration?.repositoryFullName ??
      version.publicGitSource?.repositoryUrl ??
      null,
  };
}

/** One record per store value and project: an unchanged service is the same record to every reader. */
const records = new WeakMap<ServiceValue, Map<string, ServiceRecord>>();

/** A service as the runtime's readers take it, from the store's value of its row. */
export function serviceRecordOf(project: ProjectRef, value: ServiceValue): ServiceRecord {
  const ref = { kind: "service", project, serviceId: ZeropsServiceId.make(value.id) } as const;
  const byProject = records.get(value) ?? new Map<string, ServiceRecord>();
  records.set(value, byProject);
  const held = byProject.get(serviceKeyOf(ref));
  if (held !== undefined) return held;
  const type = value.serviceStackTypeInfo;
  const autoscaling = value.currentAutoscaling;
  const vertical = autoscaling?.verticalAutoscaling;
  const record = {
    ref,
    identity: observed({
      hostname: value.name,
      isSystem: value.isSystem ?? false,
      type:
        type?.serviceStackTypeVersionName === undefined
          ? null
          : {
              versionName: type.serviceStackTypeVersionName,
              displayName: type.serviceStackTypeName ?? null,
              category: type.serviceStackTypeCategory ?? null,
            },
    }),
    lifecycle: observed({
      status: value.status,
      createdAt: value.created ?? null,
      updatedAt: value.lastUpdate ?? null,
    }),
    routing: observed({
      ports: (value.ports ?? []).map((port) => ({
        port: port.port,
        protocol: port.protocol ?? null,
        scheme: port.scheme ?? null,
        httpSupport: port.httpSupport ?? null,
      })),
      subdomainAccess: value.subdomainAccess ?? null,
    }),
    deployment:
      value.activeAppVersion === undefined
        ? UNSAID
        : observed({
            versionNumber: value.versionNumber ?? null,
            mode: value.mode ?? null,
            activeDeploy:
              value.activeAppVersion === null ? null : deployOf(value, value.activeAppVersion),
          }),
    scaling:
      autoscaling === undefined
        ? UNSAID
        : observed(
            autoscaling === null
              ? { containers: null, cpu: null, memoryGb: null, diskGb: null, cpuMode: null }
              : {
                  containers: range(
                    autoscaling.horizontalAutoscaling?.minContainerCount,
                    autoscaling.horizontalAutoscaling?.maxContainerCount,
                  ),
                  cpu: range(
                    resource(vertical?.minResource, "cpuCoreCount"),
                    resource(vertical?.maxResource, "cpuCoreCount"),
                  ),
                  memoryGb: range(
                    resource(vertical?.minResource, "memoryGBytes"),
                    resource(vertical?.maxResource, "memoryGBytes"),
                  ),
                  diskGb: range(
                    resource(vertical?.minResource, "diskGBytes"),
                    resource(vertical?.maxResource, "diskGBytes"),
                  ),
                  cpuMode: vertical?.cpuMode ?? null,
                },
          ),
  } as ServiceRecord;
  byProject.set(serviceKeyOf(ref), record);
  return record;
}

/** The listing's freshness as the project inventory's interest states it. */
function interestOf(project: ProjectRef, read: ProjectServices): InterestState {
  const identity = {
    receiver: {
      accountEpoch: AccountEpoch.make(0),
      receiverEpoch: ReceiverEpoch.make(0),
      receiverId: ZeropsReceiverId.make("account-store"),
    },
    interestEpoch: InterestEpoch.make(0),
    key: interestKeyOf({ kind: "project-inventory", project }),
  };
  if (read.unavailableReason !== undefined)
    return {
      status: "failed",
      identity,
      reason: read.unavailableReason,
      retryable: false,
      attempts: 1,
      retryAtMs: null,
    };
  if (read.live)
    return {
      status: "observing",
      identity,
      guarantee: "source-order-unverified",
      sinceReceiptOrdinal: ReceiptOrdinal.make(0),
    };
  if (read.reconnecting)
    return {
      status: "failed",
      identity,
      reason: "catching up",
      retryable: true,
      attempts: 1,
      retryAtMs: null,
    };
  return {
    status: "establishing",
    identity,
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

/** One project's services as the runtime's readers take them, from the account's store. */
export function runtimeServicesRead(
  project: ProjectRef,
  read: ProjectServices,
): CollectionRead<ServiceRecord> {
  const descriptor = { kind: "services-of-project" as const, project, schemaVersion: 1 as const };
  const common = {
    descriptor,
    key: queryKeyOf(descriptor),
    memberKeys: [],
    unresolvedMemberKeys: [],
    membershipOperations: new Map(),
  };
  const services = read.services;
  return {
    value: (services ?? []).map((value) => ({
      knowledge: "observed" as const,
      record: serviceRecordOf(project, value),
    })),
    observation: {
      required: [interestOf(project, read)],
      optional: [],
      access: { status: "unverified" },
    },
    query:
      services === undefined
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
              observedTotal: services.length,
              guarantee: "non-atomic",
            },
            observedTotal: services.length,
            source: "indexed-search",
            stamp: STAMP,
            lastAppliedReadStartOrdinal: ReadStartOrdinal.make(0),
          },
    project,
  };
}
