import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { readActivityAppVersion } from "../activity/dto.ts";

import type {
  CurrentMetricObservation,
  CurrentMetricSample,
  EntityObservation,
  EntityQueryDescriptor,
  HistoryMetricBucket,
  HistoryMetricObservation,
  PlatformCommand,
  PlatformObservation,
  ProcessRef,
  ProcessStatus,
  ProjectRef,
  QueryBaselineObservation,
  QueryCoverage,
  QueryMembershipObservation,
  ReadTicket,
  RegistrationDescriptor,
  RegistrationRequest,
  ServiceRef,
  SourceMetadata,
} from "./types.ts";
import {
  ZeropsContainerId,
  ZeropsProcessId,
  ZeropsProjectId,
  ZeropsServiceId,
  ZeropsWireSubscriptionName,
} from "./types.ts";

const OptionalString = Schema.optionalKey(Schema.String);
const OptionalNullableString = Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]));
const OptionalNumber = Schema.optionalKey(Schema.Finite);
const OptionalBoolean = Schema.optionalKey(Schema.Boolean);
const OptionalStringArray = Schema.optionalKey(Schema.Array(Schema.String));

const SourceMetadataRow = {
  _version: OptionalNumber,
  lastUpdate: OptionalNullableString,
  sequence: OptionalNumber,
  parentId: OptionalNullableString,
  rootId: OptionalNullableString,
};

const ProjectRow = Schema.Struct({
  id: Schema.String,
  name: OptionalString,
  status: OptionalString,
  created: OptionalNullableString,
  description: OptionalNullableString,
  tagList: OptionalStringArray,
  publicZone: OptionalNullableString,
  zeropsSubdomainHost: OptionalNullableString,
  mode: OptionalNullableString,
  ...SourceMetadataRow,
});

const PortRow = Schema.Struct({
  port: Schema.Finite,
  protocol: OptionalNullableString,
  scheme: OptionalNullableString,
  httpSupport: OptionalBoolean,
});

const TypeInfoRow = Schema.Struct({
  serviceStackTypeVersionName: OptionalString,
  serviceStackTypeName: OptionalString,
  serviceStackTypeCategory: OptionalNullableString,
});

const GitIntegrationRow = Schema.Struct({
  branchName: OptionalNullableString,
  tagName: OptionalNullableString,
  commit: OptionalNullableString,
  repositoryFullName: OptionalNullableString,
});

const AppVersionRow = Schema.Struct({
  source: OptionalString,
  created: OptionalNullableString,
  lastUpdate: OptionalNullableString,
  name: OptionalNullableString,
  githubIntegration: Schema.optionalKey(Schema.Union([GitIntegrationRow, Schema.Null])),
  gitlabIntegration: Schema.optionalKey(Schema.Union([GitIntegrationRow, Schema.Null])),
  publicGitSource: Schema.optionalKey(
    Schema.Union([
      Schema.Struct({
        branchName: OptionalNullableString,
        repositoryUrl: OptionalNullableString,
      }),
      Schema.Null,
    ]),
  ),
});

const AutoscalingResourceRow = Schema.Struct({
  cpuCoreCount: Schema.optionalKey(Schema.Union([Schema.Finite, Schema.Null])),
  memoryGBytes: Schema.optionalKey(Schema.Union([Schema.Finite, Schema.Null])),
  diskGBytes: Schema.optionalKey(Schema.Union([Schema.Finite, Schema.Null])),
});

const AutoscalingRow = Schema.Struct({
  horizontalAutoscaling: Schema.optionalKey(
    Schema.Union([
      Schema.Struct({
        minContainerCount: Schema.optionalKey(Schema.Union([Schema.Finite, Schema.Null])),
        maxContainerCount: Schema.optionalKey(Schema.Union([Schema.Finite, Schema.Null])),
      }),
      Schema.Null,
    ]),
  ),
  verticalAutoscaling: Schema.optionalKey(
    Schema.Union([
      Schema.Struct({
        minResource: Schema.optionalKey(Schema.Union([AutoscalingResourceRow, Schema.Null])),
        maxResource: Schema.optionalKey(Schema.Union([AutoscalingResourceRow, Schema.Null])),
        cpuMode: OptionalNullableString,
      }),
      Schema.Null,
    ]),
  ),
});

const ServiceRow = Schema.Struct({
  id: Schema.String,
  projectId: OptionalString,
  name: OptionalString,
  isSystem: Schema.optionalKey(Schema.Boolean),
  versionNumber: OptionalNullableString,
  status: OptionalString,
  created: OptionalNullableString,
  subdomainAccess: Schema.optionalKey(Schema.Union([Schema.Boolean, Schema.Null])),
  ports: Schema.optionalKey(Schema.Array(PortRow)),
  serviceStackTypeInfo: Schema.optionalKey(Schema.Union([TypeInfoRow, Schema.Null])),
  mode: OptionalNullableString,
  activeAppVersion: Schema.optionalKey(Schema.Union([AppVersionRow, Schema.Null])),
  currentAutoscaling: Schema.optionalKey(Schema.Union([AutoscalingRow, Schema.Null])),
  ...SourceMetadataRow,
});

const EmbeddedServiceRow = Schema.Struct({ id: Schema.String });
const ProcessAppVersionRow = Schema.Struct({
  id: OptionalNullableString,
  status: OptionalNullableString,
  build: Schema.optionalKey(
    Schema.Union([
      Schema.Struct({
        serviceStackId: OptionalNullableString,
        pipelineStart: OptionalNullableString,
        pipelineFinish: OptionalNullableString,
        pipelineFailed: OptionalNullableString,
        startDate: OptionalNullableString,
        endDate: OptionalNullableString,
      }),
      Schema.Null,
    ]),
  ),
  prepareCustomRuntime: Schema.optionalKey(
    Schema.Union([
      Schema.Struct({
        serviceStackId: OptionalNullableString,
        startDate: OptionalNullableString,
        endDate: OptionalNullableString,
      }),
      Schema.Null,
    ]),
  ),
  activationDate: OptionalNullableString,
});
const ProcessRow = Schema.Struct({
  id: Schema.String,
  projectId: OptionalString,
  actionName: OptionalString,
  created: OptionalString,
  status: OptionalString,
  started: OptionalNullableString,
  finished: OptionalNullableString,
  serviceStackId: OptionalNullableString,
  serviceStacks: Schema.optionalKey(Schema.Array(EmbeddedServiceRow)),
  appVersion: Schema.optionalKey(Schema.Union([ProcessAppVersionRow, Schema.Null])),
  ...SourceMetadataRow,
});

const SearchEnvelope = Schema.Struct({
  items: Schema.Array(Schema.Unknown),
  limit: Schema.optionalKey(Schema.Finite),
  offset: Schema.optionalKey(Schema.Finite),
  totalHits: Schema.optionalKey(Schema.Finite),
  totalCount: Schema.optionalKey(Schema.Finite),
});

const DirectListEnvelope = Schema.Struct({
  list: Schema.Array(Schema.Unknown),
  totalCount: Schema.optionalKey(Schema.Finite),
});

const StatPairRow = Schema.Struct({ used: Schema.Finite, limit: Schema.Finite });
const CurrentMetricRow = Schema.Struct({
  serviceStackId: Schema.String,
  containerId: Schema.String,
  cpu: Schema.optionalKey(StatPairRow),
  vCpu: Schema.optionalKey(StatPairRow),
  ramGBytes: Schema.optionalKey(StatPairRow),
  diskGBytes: Schema.optionalKey(StatPairRow),
});
const HistoryMetricRow = Schema.Struct({
  serviceStackId: Schema.String,
  from: Schema.String,
  till: Schema.String,
  containerCount: OptionalNumber,
  cpuLimit: OptionalNumber,
  cpuUsed: OptionalNumber,
  vCpuLimit: OptionalNumber,
  vCpuUsed: OptionalNumber,
  ramLimit: OptionalNumber,
  ramUsed: OptionalNumber,
  diskLimit: OptionalNumber,
  diskUsed: OptionalNumber,
});

const decodeProjectRow = Schema.decodeUnknownOption(ProjectRow);
const decodeServiceRow = Schema.decodeUnknownOption(ServiceRow);
const decodeProcessRow = Schema.decodeUnknownOption(ProcessRow);

/**
 * An embedded `serviceStacks[]` entry that omits `id` entirely is a benign
 * projection gap, not a malformed Process: it is dropped before schema
 * decoding so the rest of the row still decodes, and its removal is reported
 * as a diagnostic issue rather than failing the whole row/frame. An entry
 * that carries an `id` (even an invalid one) is left for the existing id
 * validation, which still fails the row — only a missing key is lenient.
 */
function sanitizeEmbeddedServiceStacks(input: unknown): {
  readonly value: unknown;
  readonly dropped: number;
} {
  if (
    typeof input !== "object" ||
    input === null ||
    !("serviceStacks" in input) ||
    !Array.isArray((input as { serviceStacks: unknown }).serviceStacks)
  )
    return { value: input, dropped: 0 };
  const stacks = (input as { serviceStacks: ReadonlyArray<unknown> }).serviceStacks;
  let dropped = 0;
  const kept = stacks.filter((entry) => {
    const hasId = typeof entry === "object" && entry !== null && "id" in entry;
    if (!hasId) dropped += 1;
    return hasId;
  });
  if (dropped === 0) return { value: input, dropped: 0 };
  return { value: { ...input, serviceStacks: kept }, dropped };
}

function decodeProcessRowLenient(input: unknown): {
  readonly row: typeof ProcessRow.Type | undefined;
  readonly droppedServiceStacks: number;
} {
  const sanitized = sanitizeEmbeddedServiceStacks(input);
  return {
    row: Option.getOrUndefined(decodeProcessRow(sanitized.value)),
    droppedServiceStacks: sanitized.dropped,
  };
}

const droppedServiceStacksIssue = (rowIndex?: number): ProtocolDecodeIssue => ({
  kind: "malformed-row",
  message: "Process embedded serviceStacks entries without an id were skipped.",
  ...(rowIndex === undefined ? {} : { rowIndex }),
});
const decodeSearchEnvelope = Schema.decodeUnknownOption(SearchEnvelope);
const decodeDirectListEnvelope = Schema.decodeUnknownOption(DirectListEnvelope);
const decodeCurrentMetricRow = Schema.decodeUnknownOption(CurrentMetricRow);
const decodeHistoryMetricRow = Schema.decodeUnknownOption(HistoryMetricRow);
const decodeProjectId = Schema.decodeUnknownOption(ZeropsProjectId);
const decodeServiceId = Schema.decodeUnknownOption(ZeropsServiceId);
const decodeProcessId = Schema.decodeUnknownOption(ZeropsProcessId);
const decodeContainerId = Schema.decodeUnknownOption(ZeropsContainerId);
const decodeSubscriptionName = Schema.decodeUnknownOption(ZeropsWireSubscriptionName);
const decodeRegistrationSuccess = Schema.decodeUnknownOption(
  Schema.Union([
    Schema.Struct({ success: Schema.Literal(true) }),
    Schema.Struct({ data: Schema.Struct({ Success: Schema.Literal(true) }) }),
  ]),
);

const isProjectId = (value: string): boolean => Option.isSome(decodeProjectId(value));
const isServiceId = (value: string): boolean => Option.isSome(decodeServiceId(value));
const isProcessId = (value: string): boolean => Option.isSome(decodeProcessId(value));
const isContainerId = (value: string): boolean => Option.isSome(decodeContainerId(value));

const hasValidMetadataIds = (row: {
  readonly parentId?: string | null;
  readonly rootId?: string | null;
}): boolean =>
  (row.parentId == null || isProcessId(row.parentId)) &&
  (row.rootId == null || isProcessId(row.rootId));

const hasValidProjectIds = (row: typeof ProjectRow.Type): boolean =>
  isProjectId(row.id) && hasValidMetadataIds(row);

const hasValidServiceIds = (row: typeof ServiceRow.Type): boolean =>
  isServiceId(row.id) &&
  (row.projectId === undefined || isProjectId(row.projectId)) &&
  hasValidMetadataIds(row);

const hasValidProcessIds = (row: typeof ProcessRow.Type): boolean =>
  isProcessId(row.id) &&
  (row.projectId === undefined || isProjectId(row.projectId)) &&
  (row.serviceStackId == null || isServiceId(row.serviceStackId)) &&
  (row.serviceStacks?.every((service) => isServiceId(service.id)) ?? true) &&
  (row.appVersion?.build?.serviceStackId == null ||
    isServiceId(row.appVersion.build.serviceStackId)) &&
  (row.appVersion?.prepareCustomRuntime?.serviceStackId == null ||
    isServiceId(row.appVersion.prepareCustomRuntime.serviceStackId)) &&
  hasValidMetadataIds(row);

export interface ProtocolDecodeIssue {
  readonly kind: "malformed-envelope" | "malformed-row" | "contradictory-coverage";
  readonly message: string;
  readonly rowIndex?: number;
}

export interface ProtocolDecodeResult {
  readonly observations: ReadonlyArray<PlatformObservation>;
  readonly issues: ReadonlyArray<ProtocolDecodeIssue>;
}

export interface DirectListPage {
  readonly rows: ReadonlyArray<unknown>;
  readonly totalCount: number | null;
}

export function decodeDirectListPage(input: unknown): DirectListPage | null {
  const envelope = Option.getOrUndefined(decodeDirectListEnvelope(input));
  if (!envelope) return null;
  return { rows: envelope.list, totalCount: envelope.totalCount ?? null };
}

/**
 * Decodes one page of the `/project/search` fallback used when the direct,
 * lag-free `/client/{id}/project` read is forbidden for this membership
 * (Developer/Guest roles). Same page shape as {@link decodeDirectListPage},
 * over the indexed-search envelope (`items`/`totalHits`) instead of the
 * direct-list one (`list`/`totalCount`).
 */
export function decodeSearchListPage(input: unknown): DirectListPage | null {
  const envelope = Option.getOrUndefined(decodeSearchEnvelope(input));
  if (!envelope) return null;
  return { rows: envelope.items, totalCount: envelope.totalHits ?? null };
}

const metadataOf = (row: {
  readonly _version?: number;
  readonly lastUpdate?: string | null;
  readonly sequence?: number;
  readonly parentId?: string | null;
  readonly rootId?: string | null;
}): SourceMetadata => ({
  ...(row._version === undefined ? {} : { version: row._version }),
  ...(row.lastUpdate == null ? {} : { lastUpdate: row.lastUpdate }),
  ...(row.sequence === undefined ? {} : { sequence: row.sequence }),
  ...(row.parentId === undefined
    ? {}
    : { parentId: row.parentId === null ? null : ZeropsProcessId.make(row.parentId) }),
  ...(row.rootId === undefined
    ? {}
    : { rootId: row.rootId === null ? null : ZeropsProcessId.make(row.rootId) }),
});

function processStatus(raw: string): ProcessStatus {
  switch (raw) {
    case "PENDING":
    case "RUNNING":
    case "ROLLBACKING":
    case "CANCELING":
    case "FINISHED":
    case "FAILED":
    case "CANCELED":
      return raw;
    default:
      return { kind: "unknown", raw };
  }
}

type ObservationCause =
  | { readonly source: "indexed-search" | "direct-read"; readonly ticket: ReadTicket }
  | { readonly source: "native-push"; readonly registration: RegistrationRequest }
  | { readonly source: "command-response"; readonly command: PlatformCommand };

function observationFields<Cause extends ObservationCause>(
  cause: Cause,
  fields: Readonly<Record<string, unknown>>,
  metadata: SourceMetadata,
): Cause extends { readonly source: "native-push" }
  ? {
      readonly source: "native-push";
      readonly registration: RegistrationRequest;
      readonly fields: Readonly<Record<string, unknown>>;
      readonly metadata: SourceMetadata;
    }
  : Cause extends { readonly source: "command-response" }
    ? {
        readonly source: "command-response";
        readonly command: PlatformCommand;
        readonly fields: Readonly<Record<string, unknown>>;
        readonly metadata: SourceMetadata;
      }
    : {
        readonly source: "indexed-search" | "direct-read";
        readonly ticket: ReadTicket;
        readonly fields: Readonly<Record<string, unknown>>;
        readonly metadata: SourceMetadata;
      } {
  return {
    source: cause.source,
    ...(cause.source === "native-push"
      ? { registration: cause.registration }
      : cause.source === "command-response"
        ? { command: cause.command }
        : { ticket: cause.ticket }),
    fields,
    metadata,
  } as never;
}

function projectObservations(
  ref: ProjectRef,
  raw: typeof ProjectRow.Type,
  cause: ObservationCause,
): ReadonlyArray<EntityObservation> {
  const metadata = metadataOf(raw);
  const observations: EntityObservation[] = [];
  if (raw.name !== undefined || raw.created !== undefined)
    observations.push({
      kind: "project-identity-observed",
      ref,
      observation: observationFields(
        cause,
        {
          ...(raw.name === undefined ? {} : { name: raw.name }),
          ...(raw.created === undefined ? {} : { createdAt: raw.created }),
        },
        metadata,
      ) as never,
    });
  if (raw.status !== undefined)
    observations.push({
      kind: "project-lifecycle-observed",
      ref,
      observation: observationFields(cause, { status: raw.status }, metadata) as never,
    });
  if (raw.description !== undefined || raw.tagList !== undefined)
    observations.push({
      kind: "project-presentation-observed",
      ref,
      observation: observationFields(
        cause,
        {
          ...(raw.description === undefined ? {} : { description: raw.description }),
          ...(raw.tagList === undefined ? {} : { tags: raw.tagList }),
        },
        metadata,
      ) as never,
    });
  if (
    raw.publicZone !== undefined ||
    raw.zeropsSubdomainHost !== undefined ||
    raw.mode !== undefined
  )
    observations.push({
      kind: "project-placement-observed",
      ref,
      observation: observationFields(
        cause,
        {
          ...(raw.publicZone === undefined ? {} : { publicZone: raw.publicZone }),
          ...(raw.zeropsSubdomainHost === undefined
            ? {}
            : { zeropsSubdomainHost: raw.zeropsSubdomainHost }),
          ...(raw.mode === undefined ? {} : { mode: raw.mode }),
        },
        metadata,
      ) as never,
    });
  return observations;
}

const nullable = <T>(value: T | null | undefined): T | null => value ?? null;
const scalingRange = (minimum: number | null | undefined, maximum: number | null | undefined) =>
  minimum === undefined && maximum === undefined
    ? null
    : { min: nullable(minimum), max: nullable(maximum) };

function serviceObservations(
  ref: ServiceRef,
  raw: typeof ServiceRow.Type,
  cause: ObservationCause,
): ReadonlyArray<EntityObservation> {
  const metadata = metadataOf(raw);
  const observations: EntityObservation[] = [];
  if (
    raw.name !== undefined ||
    raw.isSystem !== undefined ||
    raw.serviceStackTypeInfo !== undefined
  )
    observations.push({
      kind: "service-identity-observed",
      ref,
      observation: observationFields(
        cause,
        {
          ...(raw.name === undefined ? {} : { hostname: raw.name }),
          ...(raw.isSystem === undefined ? {} : { isSystem: raw.isSystem }),
          ...(raw.serviceStackTypeInfo === undefined
            ? {}
            : {
                type:
                  raw.serviceStackTypeInfo === null ||
                  raw.serviceStackTypeInfo.serviceStackTypeVersionName === undefined
                    ? null
                    : {
                        versionName: raw.serviceStackTypeInfo.serviceStackTypeVersionName,
                        displayName: raw.serviceStackTypeInfo.serviceStackTypeName ?? null,
                        category: raw.serviceStackTypeInfo.serviceStackTypeCategory ?? null,
                      },
              }),
        },
        metadata,
      ) as never,
    });
  if (raw.status !== undefined || raw.created !== undefined || raw.lastUpdate !== undefined)
    observations.push({
      kind: "service-lifecycle-observed",
      ref,
      observation: observationFields(
        cause,
        {
          ...(raw.status === undefined ? {} : { status: raw.status }),
          ...(raw.created === undefined ? {} : { createdAt: raw.created }),
          ...(raw.lastUpdate === undefined ? {} : { updatedAt: raw.lastUpdate }),
        },
        metadata,
      ) as never,
    });
  if (raw.ports !== undefined || raw.subdomainAccess !== undefined)
    observations.push({
      kind: "service-routing-observed",
      ref,
      observation: observationFields(
        cause,
        {
          ...(raw.ports === undefined
            ? {}
            : {
                ports: raw.ports.map((port) => ({
                  port: port.port,
                  protocol: port.protocol ?? null,
                  scheme: port.scheme ?? null,
                  httpSupport: port.httpSupport ?? null,
                })),
              }),
          ...(raw.subdomainAccess === undefined ? {} : { subdomainAccess: raw.subdomainAccess }),
        },
        metadata,
      ) as never,
    });
  if (
    raw.mode !== undefined ||
    raw.versionNumber !== undefined ||
    raw.activeAppVersion !== undefined
  )
    observations.push({
      kind: "service-deployment-observed",
      ref,
      observation: observationFields(
        cause,
        {
          ...(raw.mode === undefined ? {} : { mode: raw.mode }),
          ...(raw.versionNumber === undefined ? {} : { versionNumber: raw.versionNumber }),
          ...(raw.activeAppVersion === undefined
            ? {}
            : {
                activeDeploy:
                  raw.activeAppVersion === null || raw.activeAppVersion.source === undefined
                    ? null
                    : {
                        source: raw.activeAppVersion.source,
                        activatedAt:
                          raw.activeAppVersion.lastUpdate || raw.activeAppVersion.created || null,
                        name: raw.activeAppVersion.name ?? null,
                        branch:
                          raw.activeAppVersion.githubIntegration?.branchName ??
                          raw.activeAppVersion.gitlabIntegration?.branchName ??
                          raw.activeAppVersion.publicGitSource?.branchName ??
                          null,
                        commit:
                          raw.activeAppVersion.githubIntegration?.commit ??
                          raw.activeAppVersion.gitlabIntegration?.commit ??
                          null,
                        tag:
                          raw.activeAppVersion.githubIntegration?.tagName ??
                          raw.activeAppVersion.gitlabIntegration?.tagName ??
                          null,
                        repository:
                          raw.activeAppVersion.githubIntegration?.repositoryFullName ??
                          raw.activeAppVersion.gitlabIntegration?.repositoryFullName ??
                          raw.activeAppVersion.publicGitSource?.repositoryUrl ??
                          null,
                      },
              }),
        },
        metadata,
      ) as never,
    });
  if (raw.currentAutoscaling !== undefined)
    observations.push({
      kind: "service-scaling-observed",
      ref,
      observation: observationFields(
        cause,
        raw.currentAutoscaling === null
          ? { containers: null, cpu: null, memoryGb: null, diskGb: null, cpuMode: null }
          : {
              containers: scalingRange(
                raw.currentAutoscaling.horizontalAutoscaling?.minContainerCount,
                raw.currentAutoscaling.horizontalAutoscaling?.maxContainerCount,
              ),
              cpu: scalingRange(
                raw.currentAutoscaling.verticalAutoscaling?.minResource?.cpuCoreCount,
                raw.currentAutoscaling.verticalAutoscaling?.maxResource?.cpuCoreCount,
              ),
              memoryGb: scalingRange(
                raw.currentAutoscaling.verticalAutoscaling?.minResource?.memoryGBytes,
                raw.currentAutoscaling.verticalAutoscaling?.maxResource?.memoryGBytes,
              ),
              diskGb: scalingRange(
                raw.currentAutoscaling.verticalAutoscaling?.minResource?.diskGBytes,
                raw.currentAutoscaling.verticalAutoscaling?.maxResource?.diskGBytes,
              ),
              cpuMode: raw.currentAutoscaling.verticalAutoscaling?.cpuMode ?? null,
            },
        metadata,
      ) as never,
    });
  return observations;
}

function processObservations(
  ref: ProcessRef,
  raw: typeof ProcessRow.Type,
  cause: ObservationCause,
): ReadonlyArray<EntityObservation> {
  const metadata = metadataOf(raw);
  const observations: EntityObservation[] = [];
  if (
    raw.actionName !== undefined ||
    raw.created !== undefined ||
    raw.serviceStacks !== undefined ||
    raw.serviceStackId !== undefined
  ) {
    const serviceIds = [
      ...(raw.serviceStackId ? [raw.serviceStackId] : []),
      ...(raw.serviceStacks?.map((service) => service.id) ?? []),
    ];
    observations.push({
      kind: "process-identity-observed",
      ref,
      observation: observationFields(
        cause,
        {
          ...(raw.actionName === undefined ? {} : { actionName: raw.actionName }),
          ...(raw.created === undefined ? {} : { createdAt: raw.created }),
          ...(raw.serviceStacks === undefined && raw.serviceStackId === undefined
            ? {}
            : { serviceIds: [...new Set(serviceIds)].map((id) => ZeropsServiceId.make(id)) }),
        },
        metadata,
      ) as never,
    });
  }
  if (raw.status !== undefined || raw.started !== undefined || raw.finished !== undefined)
    observations.push({
      kind: "process-lifecycle-observed",
      ref,
      observation: observationFields(
        cause,
        {
          ...(raw.status === undefined ? {} : { status: processStatus(raw.status) }),
          ...(raw.started === undefined ? {} : { startedAt: raw.started }),
          ...(raw.finished === undefined ? {} : { finishedAt: raw.finished }),
        },
        metadata,
      ) as never,
    });
  if (raw.appVersion !== undefined)
    observations.push({
      kind: "process-pipeline-observed",
      ref,
      observation: observationFields(
        cause,
        {
          appVersion: readActivityAppVersion(raw.appVersion) ?? null,
        },
        metadata,
      ) as never,
    });
  return observations;
}

const projectRefFor = (descriptor: EntityQueryDescriptor, id: string): ProjectRef => {
  switch (descriptor.kind) {
    case "projects-of-organization":
      return {
        kind: "project",
        organization: descriptor.organization,
        projectId: ZeropsProjectId.make(id),
      };
    default:
      return descriptor.project;
  }
};

function decodeRows(
  descriptor: EntityQueryDescriptor,
  rows: ReadonlyArray<unknown>,
  cause: ObservationCause,
): {
  readonly observations: ReadonlyArray<PlatformObservation>;
  readonly members: ReadonlyArray<ProjectRef | ServiceRef | ProcessRef>;
  readonly issues: ReadonlyArray<ProtocolDecodeIssue>;
} {
  const observations: PlatformObservation[] = [];
  const members: Array<ProjectRef | ServiceRef | ProcessRef> = [];
  const issues: ProtocolDecodeIssue[] = [];
  const seenMembers = new Set<string>();
  const retainMember = (ref: ProjectRef | ServiceRef | ProcessRef, rowIndex: number): boolean => {
    const key =
      ref.kind === "project"
        ? `project:${ref.projectId}`
        : ref.kind === "service"
          ? `service:${ref.serviceId}`
          : `process:${ref.processId}`;
    if (seenMembers.has(key)) {
      issues.push({
        kind: "contradictory-coverage",
        message: "Entity query repeated a member id.",
        rowIndex,
      });
      return false;
    }
    seenMembers.add(key);
    members.push(ref);
    return true;
  };
  rows.forEach((row, rowIndex) => {
    if (descriptor.kind === "projects-of-organization") {
      const decoded = Option.getOrUndefined(decodeProjectRow(row));
      if (
        !decoded ||
        !hasValidProjectIds(decoded) ||
        decoded.name === undefined ||
        decoded.status === undefined
      ) {
        issues.push({
          kind: "malformed-row",
          message: "Project row lacks id, name, or status.",
          rowIndex,
        });
        return;
      }
      const ref = projectRefFor(descriptor, decoded.id);
      if (!retainMember(ref, rowIndex)) return;
      observations.push(...projectObservations(ref, decoded, cause));
      return;
    }
    if (descriptor.kind === "services-of-project") {
      const decoded = Option.getOrUndefined(decodeServiceRow(row));
      if (
        !decoded ||
        !hasValidServiceIds(decoded) ||
        decoded.name === undefined ||
        decoded.status === undefined ||
        (decoded.projectId !== undefined && decoded.projectId !== descriptor.project.projectId)
      ) {
        issues.push({
          kind: "malformed-row",
          message: "Service row lacks identity/status or contradicts its project.",
          rowIndex,
        });
        return;
      }
      const ref: ServiceRef = {
        kind: "service",
        project: descriptor.project,
        serviceId: ZeropsServiceId.make(decoded.id),
      };
      if (!retainMember(ref, rowIndex)) return;
      observations.push(...serviceObservations(ref, decoded, cause));
      return;
    }
    const { row: decoded, droppedServiceStacks } = decodeProcessRowLenient(row);
    if (
      !decoded ||
      !hasValidProcessIds(decoded) ||
      decoded.actionName === undefined ||
      decoded.created === undefined ||
      decoded.status === undefined ||
      (decoded.projectId !== undefined && decoded.projectId !== descriptor.project.projectId)
    ) {
      issues.push({
        kind: "malformed-row",
        message: "Process row lacks identity/status or contradicts its project.",
        rowIndex,
      });
      return;
    }
    if (droppedServiceStacks > 0) issues.push(droppedServiceStacksIssue(rowIndex));
    const ref: ProcessRef = {
      kind: "process",
      project: descriptor.project,
      processId: ZeropsProcessId.make(decoded.id),
    };
    observations.push(...processObservations(ref, decoded, cause));
    if (
      descriptor.kind === "running-processes-of-project" &&
      !descriptor.statuses.includes(
        processStatus(decoded.status) as (typeof descriptor.statuses)[number],
      )
    )
      return;
    if (!retainMember(ref, rowIndex)) return;
  });
  return { observations, members, issues };
}

export function decodeEntityQueryPages(
  descriptor: EntityQueryDescriptor,
  ticket: ReadTicket,
  pages: ReadonlyArray<DirectListPage>,
  source: "indexed-search" | "direct-read" = "direct-read",
): ProtocolDecodeResult {
  if (pages.length === 0)
    return {
      observations: [],
      issues: [{ kind: "malformed-envelope", message: "Entity traversal returned no page." }],
    };
  const totals = new Set(
    pages.flatMap((page) => (page.totalCount === null ? [] : [page.totalCount])),
  );
  const rows = pages.flatMap((page) => page.rows);
  const traversalIssue =
    totals.size > 1 ||
    [...totals].some((total) => !Number.isInteger(total) || total < rows.length) ||
    (totals.size === 1 && [...totals][0] !== rows.length)
      ? ({
          kind: "contradictory-coverage" as const,
          message: "Traversal totals changed or did not match the collected rows.",
        } satisfies ProtocolDecodeIssue)
      : null;
  const decoded = decodeRows(descriptor, rows, { source, ticket });
  const issues = [...(traversalIssue === null ? [] : [traversalIssue]), ...decoded.issues];
  const observedTotal = totals.size === 1 ? ([...totals][0] ?? null) : null;
  const baseline: QueryBaselineObservation = {
    kind: "query-baseline-observed",
    members: decoded.members,
    unresolvedMembers: [],
    observedTotal,
    coverage:
      issues.length === 0
        ? {
            kind: "exhausted-traversal",
            traversedPages: pages.length,
            observedTotal,
            guarantee: "non-atomic",
          }
        : {
            kind: "partial",
            reason: issues.some(
              (issue) => issue.kind === "malformed-envelope" || issue.kind === "malformed-row",
            )
              ? "malformed"
              : "contradictory-total",
          },
    source,
    ticket: ticket as never,
  } as never;
  return { observations: [...decoded.observations, baseline], issues };
}

function coverageFor(
  count: number,
  envelope: { readonly limit?: number; readonly offset?: number; readonly total?: number },
  malformed: boolean,
): QueryCoverage {
  if (malformed) return { kind: "partial", reason: "malformed" };
  const offset = envelope.offset ?? 0;
  const limit = envelope.limit ?? Math.max(count, 1);
  const total = envelope.total ?? null;
  if (
    !Number.isInteger(offset) ||
    offset < 0 ||
    !Number.isInteger(limit) ||
    limit < 0 ||
    (total !== null && (!Number.isInteger(total) || total < offset + count)) ||
    (limit > 0 && count > limit)
  )
    return { kind: "partial", reason: "contradictory-total" };
  if (total !== null && offset + count === total)
    return {
      kind: "exhausted-traversal",
      traversedPages: Math.max(1, Math.ceil(Math.max(total, 1) / Math.max(limit, 1))),
      observedTotal: total,
      guarantee: "non-atomic",
    };
  return { kind: "partial-window", offset, limit, traversedPages: 1, observedTotal: total };
}

export function decodeEntityQueryResponse(
  descriptor: EntityQueryDescriptor,
  ticket: ReadTicket,
  input: unknown,
  source: "indexed-search" | "direct-read",
): ProtocolDecodeResult {
  const directEnvelope =
    source === "direct-read" ? Option.getOrUndefined(decodeDirectListEnvelope(input)) : undefined;
  const searchEnvelope =
    source === "indexed-search" ? Option.getOrUndefined(decodeSearchEnvelope(input)) : undefined;
  if (directEnvelope === undefined && searchEnvelope === undefined)
    return {
      observations: [],
      issues: [{ kind: "malformed-envelope", message: "Entity query response has no row array." }],
    };
  const rows = directEnvelope?.list ?? searchEnvelope!.items;
  const decoded = decodeRows(descriptor, rows, { source, ticket });
  const total = directEnvelope?.totalCount ?? searchEnvelope?.totalHits;
  const coverage = coverageFor(
    rows.length,
    {
      limit: searchEnvelope?.limit ?? Math.max(rows.length, 1),
      offset: searchEnvelope?.offset ?? 0,
      ...(total === undefined ? {} : { total }),
    },
    decoded.issues.length > 0,
  );
  const baseline: QueryBaselineObservation = {
    kind: "query-baseline-observed",
    members: decoded.members,
    unresolvedMembers: [],
    observedTotal: total ?? null,
    coverage,
    source,
    ticket: ticket as never,
  } as never;
  return { observations: [...decoded.observations, baseline], issues: decoded.issues };
}

export function decodeEntityDirectResponse(
  ticket: ReadTicket,
  input: unknown,
): ProtocolDecodeResult {
  if (ticket.target.kind === "query")
    return {
      observations: [],
      issues: [
        { kind: "malformed-envelope", message: "Direct entity decoder requires an entity target." },
      ],
    };
  const target = ticket.target;
  if (target.kind === "project") {
    const row = Option.getOrUndefined(decodeProjectRow(input));
    if (
      !row ||
      !hasValidProjectIds(row) ||
      row.id !== target.ref.projectId ||
      row.name === undefined ||
      row.status === undefined
    )
      return {
        observations: [],
        issues: [
          {
            kind: "malformed-row",
            message: "Direct Project response is incomplete or has the wrong id.",
          },
        ],
      };
    return {
      observations: projectObservations(target.ref, row, { source: "direct-read", ticket }),
      issues: [],
    };
  }
  if (target.kind === "service") {
    const row = Option.getOrUndefined(decodeServiceRow(input));
    if (
      !row ||
      !hasValidServiceIds(row) ||
      row.id !== target.ref.serviceId ||
      row.name === undefined ||
      row.status === undefined
    )
      return {
        observations: [],
        issues: [
          {
            kind: "malformed-row",
            message: "Direct ServiceStack response is incomplete or has the wrong id.",
          },
        ],
      };
    return {
      observations: serviceObservations(target.ref, row, { source: "direct-read", ticket }),
      issues: [],
    };
  }
  const { row, droppedServiceStacks } = decodeProcessRowLenient(input);
  if (
    !row ||
    !hasValidProcessIds(row) ||
    row.id !== target.ref.processId ||
    row.actionName === undefined ||
    row.created === undefined ||
    row.status === undefined
  )
    return {
      observations: [],
      issues: [
        {
          kind: "malformed-row",
          message: "Direct Process response is incomplete or has the wrong id.",
        },
      ],
    };
  return {
    observations: processObservations(target.ref, row, { source: "direct-read", ticket }),
    issues: droppedServiceStacks > 0 ? [droppedServiceStacksIssue()] : [],
  };
}

export interface RestartResponseDecodeResult extends ProtocolDecodeResult {
  readonly processRefs: ReadonlyArray<ProcessRef>;
}

type ProjectResponseCommand = Extract<
  PlatformCommand,
  {
    readonly kind:
      | "name-project-agent"
      | "update-project-group-tags"
      | "create-project"
      | "create-project-with-mate"
      | "create-tool-project";
  }
>;

/** Decodes a Project returned by a mutation before it can enter the shared model. */
export function decodeProjectCommandResponse(
  command: ProjectResponseCommand,
  input: unknown,
): ProtocolDecodeResult {
  const row = Option.getOrUndefined(decodeProjectRow(input));
  const expectedProject =
    command.kind === "name-project-agent" || command.kind === "update-project-group-tags"
      ? command.project
      : null;
  if (
    !row ||
    !hasValidProjectIds(row) ||
    row.name === undefined ||
    row.status === undefined ||
    (expectedProject !== null && row.id !== expectedProject.projectId)
  )
    return {
      observations: [],
      issues: [
        {
          kind: "malformed-row",
          message: "Command response is not the expected complete Project.",
        },
      ],
    };
  const organization: ProjectRef["organization"] = (() => {
    switch (command.kind) {
      case "name-project-agent":
      case "update-project-group-tags":
        return command.project.organization;
      case "create-project":
      case "create-project-with-mate":
      case "create-tool-project":
        return command.organization;
    }
  })();
  const ref: ProjectRef = {
    kind: "project",
    organization,
    projectId: ZeropsProjectId.make(row.id),
  };
  return {
    observations: projectObservations(ref, row, { source: "command-response", command }),
    issues: [],
  };
}

/**
 * The measured PUT /service-stack/{id}/restart response is a direct Process body.
 * Its repeated project and service ids must match the command scope; the returned
 * Process id remains an independent entity identity linked to the exact attempt.
 */
export function decodeRestartServiceResponse(
  command: Extract<PlatformCommand, { readonly kind: "restart-service" }>,
  input: unknown,
): RestartResponseDecodeResult {
  const { row, droppedServiceStacks } = decodeProcessRowLenient(input);
  if (
    !row ||
    !hasValidProcessIds(row) ||
    row.actionName !== "stack.restart" ||
    row.created === undefined ||
    row.status === undefined ||
    row.projectId !== command.service.project.projectId ||
    row.serviceStackId !== command.service.serviceId
  )
    return {
      processRefs: [],
      observations: [],
      issues: [
        {
          kind: "malformed-row",
          message: "Restart response is not the expected Process for the requested service.",
        },
      ],
    };
  const ref: ProcessRef = {
    kind: "process",
    project: command.service.project,
    processId: ZeropsProcessId.make(row.id),
  };
  return {
    processRefs: [ref],
    observations: processObservations(ref, row, { source: "command-response", command }),
    issues: droppedServiceStacks > 0 ? [droppedServiceStacksIssue()] : [],
  };
}

function pair(used: number | undefined, limit: number | undefined) {
  return used === undefined || limit === undefined ? null : { used, limit };
}

function currentMetrics(
  registration: RegistrationRequest | null,
  descriptor: Extract<
    import("./types.ts").QueryDescriptor,
    { readonly kind: "current-metrics-of-project" }
  >,
  ticket: ReadTicket | null,
  rows: ReadonlyArray<unknown>,
): ProtocolDecodeResult {
  const samples: CurrentMetricSample[] = [];
  const issues: ProtocolDecodeIssue[] = [];
  rows.forEach((raw, rowIndex) => {
    const row = Option.getOrUndefined(decodeCurrentMetricRow(raw));
    if (!row || !isServiceId(row.serviceStackId) || !isContainerId(row.containerId)) {
      issues.push({
        kind: "malformed-row",
        message: "Current metric row lacks serviceStackId or containerId.",
        rowIndex,
      });
      return;
    }
    samples.push({
      key: {
        service: {
          kind: "service",
          project: descriptor.project,
          serviceId: ZeropsServiceId.make(row.serviceStackId),
        },
        containerId: ZeropsContainerId.make(row.containerId),
        groupBy: "containerId",
        schemaVersion: 1,
      },
      cpu: row.cpu ?? null,
      virtualCpu: row.vCpu ?? null,
      memoryGb: row.ramGBytes ?? null,
      diskGb: row.diskGBytes ?? null,
    });
  });
  const base = {
    kind: "current-metrics-replaced" as const,
    samples,
    coverage: issues.length
      ? ({ kind: "partial", reason: "malformed" } as const)
      : ({
          kind: "exhausted-traversal",
          traversedPages: 1,
          observedTotal: samples.length,
          guarantee: "non-atomic",
        } as const),
  };
  const observation: CurrentMetricObservation = registration
    ? { ...base, source: "native-push", registration: registration as never }
    : { ...base, source: "direct-read", ticket: ticket as never };
  return { observations: [observation], issues };
}

function historyMetrics(
  registration: RegistrationRequest | null,
  descriptor: Extract<
    import("./types.ts").QueryDescriptor,
    { readonly kind: "metric-history-of-project" }
  >,
  ticket: ReadTicket | null,
  rows: ReadonlyArray<unknown>,
  operation: "replace-window" | "correct-buckets",
): ProtocolDecodeResult {
  const buckets: HistoryMetricBucket[] = [];
  const issues: ProtocolDecodeIssue[] = [];
  rows.forEach((raw, rowIndex) => {
    const row = Option.getOrUndefined(decodeHistoryMetricRow(raw));
    if (!row || !isServiceId(row.serviceStackId)) {
      issues.push({
        kind: "malformed-row",
        message: "History row lacks serviceStackId/from/till.",
        rowIndex,
      });
      return;
    }
    const service: ServiceRef = {
      kind: "service",
      project: descriptor.project,
      serviceId: ZeropsServiceId.make(row.serviceStackId),
    };
    const series = {
      service,
      groupBy: "serviceStackId" as const,
      window: descriptor.window,
      schemaVersion: 1 as const,
    };
    buckets.push({
      key: { series, from: row.from, till: row.till },
      containers: row.containerCount ?? null,
      cpu: pair(row.cpuUsed, row.cpuLimit),
      virtualCpu: pair(row.vCpuUsed, row.vCpuLimit),
      memoryGb: pair(row.ramUsed, row.ramLimit),
      diskGb: pair(row.diskUsed, row.diskLimit),
    });
  });
  const base = {
    kind: "metric-history-window-observed" as const,
    buckets,
    coverage: issues.length
      ? ({ kind: "partial", reason: "malformed" } as const)
      : ({
          kind: "partial-window",
          offset: 0,
          limit: descriptor.window.limit,
          traversedPages: 1,
          observedTotal: null,
        } as const),
    operation,
  };
  const observation: HistoryMetricObservation = registration
    ? { ...base, source: "native-push", registration: registration as never }
    : { ...base, source: "direct-read", ticket: ticket as never };
  return { observations: [observation], issues };
}

export type NativeFrameDecode =
  | { readonly kind: "pong" }
  | {
      readonly kind: "observations";
      readonly observations: ReadonlyArray<PlatformObservation>;
      readonly issues: ReadonlyArray<ProtocolDecodeIssue>;
    }
  | {
      readonly kind: "malformed";
      readonly subscriptionName?: ZeropsWireSubscriptionName;
      readonly message: string;
    };

const FrameEnvelope = Schema.Struct({
  type: Schema.String,
  subscriptionName: Schema.optionalKey(Schema.String),
  data: Schema.optionalKey(Schema.Unknown),
});
const decodeFrameEnvelope = Schema.decodeUnknownOption(FrameEnvelope);
const MembershipDelta = Schema.Struct({
  add: Schema.Array(Schema.String),
  delete: Schema.Array(Schema.String),
});
const UpdateEnvelope = Schema.Struct({ update: Schema.Array(Schema.Unknown) });
const CurrentEnvelope = Schema.Struct({ items: Schema.Array(Schema.Unknown) });
const decodeMembershipDelta = Schema.decodeUnknownOption(MembershipDelta);
const decodeUpdateEnvelope = Schema.decodeUnknownOption(UpdateEnvelope);
const decodeCurrentEnvelope = Schema.decodeUnknownOption(CurrentEnvelope);

export function decodeNativeFrame(
  encoded: string,
  registrations: ReadonlyMap<ZeropsWireSubscriptionName, RegistrationRequest>,
): NativeFrameDecode {
  let json: unknown;
  try {
    json = JSON.parse(encoded);
  } catch {
    return { kind: "malformed", message: "Frame is not JSON." };
  }
  const frame = Option.getOrUndefined(decodeFrameEnvelope(json));
  if (!frame) return { kind: "malformed", message: "Frame envelope is malformed." };
  if (frame.type === "pong") return { kind: "pong" };
  if (frame.type !== "search" || frame.subscriptionName === undefined)
    return { kind: "malformed", message: "Frame is neither pong nor a named search frame." };
  const name = Option.getOrUndefined(decodeSubscriptionName(frame.subscriptionName));
  if (name === undefined) return { kind: "malformed", message: "Subscription name is invalid." };
  const registration = registrations.get(name);
  if (!registration)
    return {
      kind: "malformed",
      subscriptionName: name,
      message: "Frame names no active registration.",
    };
  if (registration.descriptor.kind === "query-membership") {
    const delta = Option.getOrUndefined(decodeMembershipDelta(frame.data));
    const query = registration.descriptor.query;
    const hasValidMemberId =
      query.kind === "projects-of-organization"
        ? isProjectId
        : query.kind === "services-of-project"
          ? isServiceId
          : isProcessId;
    if (
      !delta ||
      delta.add.some((id) => !hasValidMemberId(id) || delta.delete.includes(id)) ||
      delta.delete.some((id) => !hasValidMemberId(id))
    )
      return {
        kind: "malformed",
        subscriptionName: name,
        message: "Membership delta is malformed or contradictory.",
      };
    const memberFor = (id: string): ProjectRef | ServiceRef | ProcessRef => {
      if (query.kind === "projects-of-organization")
        return {
          kind: "project",
          organization: query.organization,
          projectId: ZeropsProjectId.make(id),
        };
      if (query.kind === "services-of-project")
        return { kind: "service", project: query.project, serviceId: ZeropsServiceId.make(id) };
      return { kind: "process", project: query.project, processId: ZeropsProcessId.make(id) };
    };
    const observations: QueryMembershipObservation[] = [
      ...delta.add.map(
        (id) =>
          ({
            kind: "query-membership-observed" as const,
            operation: "add" as const,
            member: memberFor(id),
            registration,
          }) as never,
      ),
      ...delta.delete.map(
        (id) =>
          ({
            kind: "query-membership-observed" as const,
            operation: "remove" as const,
            member: memberFor(id),
            registration,
          }) as never,
      ),
    ];
    return { kind: "observations", observations, issues: [] };
  }
  const descriptor = registration.descriptor;
  if (descriptor.kind === "current-metrics") {
    const data = Option.getOrUndefined(decodeCurrentEnvelope(frame.data));
    if (!data)
      return {
        kind: "malformed",
        subscriptionName: name,
        message: "Current metric frame must use data.items.",
      };
    const result = currentMetrics(registration, descriptor.query, null, data.items);
    return { kind: "observations", ...result };
  }
  if (descriptor.kind === "metric-history") {
    const data = Option.getOrUndefined(decodeUpdateEnvelope(frame.data));
    if (!data)
      return {
        kind: "malformed",
        subscriptionName: name,
        message: "History frame must use data.update.",
      };
    const result = historyMetrics(
      registration,
      descriptor.query,
      null,
      data.update,
      "correct-buckets",
    );
    return { kind: "observations", ...result };
  }
  const entityDescriptor = descriptor as Extract<
    RegistrationDescriptor,
    { readonly kind: "entity-updates" }
  >;
  const data = Option.getOrUndefined(decodeUpdateEnvelope(frame.data));
  if (!data)
    return {
      kind: "malformed",
      subscriptionName: name,
      message: "Entity update frame must use data.update.",
    };
  const observations: PlatformObservation[] = [];
  const issues: ProtocolDecodeIssue[] = [];
  data.update.forEach((raw, rowIndex) => {
    if (entityDescriptor.entity === "project") {
      const row = Option.getOrUndefined(decodeProjectRow(raw));
      if (!row || !hasValidProjectIds(row)) {
        issues.push({ kind: "malformed-row", message: "Malformed Project update.", rowIndex });
        return;
      }
      const ref: ProjectRef = {
        kind: "project",
        organization: entityDescriptor.organization,
        projectId: ZeropsProjectId.make(row.id),
      };
      observations.push(...projectObservations(ref, row, { source: "native-push", registration }));
    } else if (entityDescriptor.entity === "service") {
      const row = Option.getOrUndefined(decodeServiceRow(raw));
      if (!row || !hasValidServiceIds(row) || row.projectId === undefined) {
        issues.push({
          kind: "malformed-row",
          message: "ServiceStack update lacks projectId.",
          rowIndex,
        });
        return;
      }
      const project: ProjectRef = {
        kind: "project",
        organization: entityDescriptor.organization,
        projectId: ZeropsProjectId.make(row.projectId),
      };
      observations.push(
        ...serviceObservations(
          { kind: "service", project, serviceId: ZeropsServiceId.make(row.id) },
          row,
          { source: "native-push", registration },
        ),
      );
    } else {
      const { row, droppedServiceStacks } = decodeProcessRowLenient(raw);
      if (!row || !hasValidProcessIds(row) || row.projectId === undefined) {
        issues.push({
          kind: "malformed-row",
          message: "Process update lacks projectId.",
          rowIndex,
        });
        return;
      }
      if (droppedServiceStacks > 0) issues.push(droppedServiceStacksIssue(rowIndex));
      const project: ProjectRef = {
        kind: "project",
        organization: entityDescriptor.organization,
        projectId: ZeropsProjectId.make(row.projectId),
      };
      observations.push(
        ...processObservations(
          { kind: "process", project, processId: ZeropsProcessId.make(row.id) },
          row,
          { source: "native-push", registration },
        ),
      );
    }
  });
  return { kind: "observations", observations, issues };
}

export function decodeRegistrationResponse(
  request: RegistrationRequest,
  input: unknown,
): ProtocolDecodeResult {
  const descriptor = request.descriptor;
  if (descriptor.kind === "entity-updates")
    return Option.isSome(decodeRegistrationSuccess(input))
      ? { observations: [], issues: [] }
      : {
          observations: [],
          issues: [
            {
              kind: "malformed-envelope",
              message: "Entity update registration did not confirm success.",
            },
          ],
        };
  if (descriptor.kind === "query-membership")
    return decodeEntityQueryResponse(
      descriptor.query,
      request.baselineTicket as ReadTicket,
      input,
      "indexed-search",
    );
  const envelope = Option.getOrUndefined(decodeSearchEnvelope(input));
  if (!envelope)
    return {
      observations: [],
      issues: [
        { kind: "malformed-envelope", message: "Metric registration response has no items." },
      ],
    };
  return descriptor.kind === "current-metrics"
    ? currentMetrics(request, descriptor.query, null, envelope.items)
    : historyMetrics(request, descriptor.query, null, envelope.items, "replace-window");
}

export function decodeMetricRead(ticket: ReadTicket, input: unknown): ProtocolDecodeResult {
  if (ticket.target.kind !== "query")
    return {
      observations: [],
      issues: [{ kind: "malformed-envelope", message: "Metric read has no metric query." }],
    };
  const envelope = Option.getOrUndefined(decodeSearchEnvelope(input));
  if (!envelope)
    return {
      observations: [],
      issues: [{ kind: "malformed-envelope", message: "Metric read response has no items." }],
    };
  return ticket.target.descriptor.kind === "current-metrics-of-project"
    ? currentMetrics(null, ticket.target.descriptor, ticket, envelope.items)
    : ticket.target.descriptor.kind === "metric-history-of-project"
      ? historyMetrics(null, ticket.target.descriptor, ticket, envelope.items, "replace-window")
      : {
          observations: [],
          issues: [{ kind: "malformed-envelope", message: "Read is not a metric query." }],
        };
}
