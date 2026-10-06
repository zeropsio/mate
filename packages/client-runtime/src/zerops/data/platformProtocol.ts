import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { coverageFor } from "./coverage.ts";
import { decodeTableFrame, decodeTableSearch } from "./tableProtocol.ts";

import type {
  EntityObservation,
  MembershipQueryDescriptor,
  PlatformCommand,
  PlatformObservation,
  ProjectRef,
  QueryBaselineObservation,
  QueryMembershipObservation,
  ReadTicket,
  RegistrationDescriptor,
  RegistrationRequest,
  ServiceRef,
  SourceMetadata,
} from "./types.ts";
import {
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
  userRoles: Schema.optionalKey(
    Schema.Array(Schema.Struct({ clientUserId: Schema.String, roleCode: Schema.String })),
  ),
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
  id: OptionalNullableString,
  status: OptionalNullableString,
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
  userData: Schema.optionalKey(
    Schema.Array(Schema.Struct({ key: OptionalString, content: OptionalNullableString })),
  ),
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

const decodeProjectRow = Schema.decodeUnknownOption(ProjectRow);
const decodeServiceRow = Schema.decodeUnknownOption(ServiceRow);

const decodeSearchEnvelope = Schema.decodeUnknownOption(SearchEnvelope);
const decodeDirectListEnvelope = Schema.decodeUnknownOption(DirectListEnvelope);
const decodeProjectId = Schema.decodeUnknownOption(ZeropsProjectId);
const decodeServiceId = Schema.decodeUnknownOption(ZeropsServiceId);
const decodeProcessId = Schema.decodeUnknownOption(ZeropsProcessId);
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

export interface ProtocolDecodeIssue {
  readonly kind: "malformed-envelope" | "malformed-row" | "contradictory-coverage";
  readonly message: string;
  readonly rowIndex?: number;
}

/** An issue of one row, which drops that row alone and never the read or registration it rode. */
export const isRowIssue = (issue: ProtocolDecodeIssue): boolean => issue.kind === "malformed-row";

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

/**
 * The active version's name. The app-version API never returns one; the
 * service's `appVersionName` variable does, but it names the newest STARTED
 * build — the active version only while `appVersionId` beside it is that
 * version's id (A14, measured 2026-09-23).
 */
function activeVersionName(raw: typeof ServiceRow.Type): string | null {
  const version = raw.activeAppVersion;
  if (version === null || version === undefined) return null;
  if (version.name !== undefined && version.name !== null) return version.name;
  const variable = (key: string) =>
    raw.userData?.find((entry) => entry.key === key)?.content?.trim() || null;
  const id = version.id ?? null;
  return id !== null && variable("appVersionId") === id ? variable("appVersionName") : null;
}

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
                  raw.activeAppVersion === null
                    ? null
                    : {
                        id: raw.activeAppVersion.id ?? null,
                        status: raw.activeAppVersion.status ?? null,
                        source: raw.activeAppVersion.source ?? null,
                        activatedAt:
                          raw.activeAppVersion.lastUpdate || raw.activeAppVersion.created || null,
                        name: activeVersionName(raw),
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

/**
 * The project a row belongs to: the one an organization-wide row names, or the one a project's
 * query was asked for. `undefined` when an organization-wide row names none, or a project's row
 * names another.
 */
const rowProject = (
  descriptor: MembershipQueryDescriptor,
  projectId: string | undefined,
): ProjectRef | undefined => {
  if (!("project" in descriptor)) return undefined;
  return projectId === undefined || projectId === descriptor.project.projectId
    ? descriptor.project
    : undefined;
};

function decodeRows(
  descriptor: MembershipQueryDescriptor,
  rows: ReadonlyArray<unknown>,
  cause: ObservationCause,
): {
  readonly observations: ReadonlyArray<PlatformObservation>;
  readonly members: ReadonlyArray<ProjectRef | ServiceRef>;
  readonly issues: ReadonlyArray<ProtocolDecodeIssue>;
} {
  const observations: PlatformObservation[] = [];
  const members: Array<ProjectRef | ServiceRef> = [];
  const issues: ProtocolDecodeIssue[] = [];
  const seenMembers = new Set<string>();
  const retainMember = (ref: ProjectRef | ServiceRef, rowIndex: number): boolean => {
    const key = ref.kind === "project" ? `project:${ref.projectId}` : `service:${ref.serviceId}`;
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
      const ref: ProjectRef = {
        kind: "project",
        organization: descriptor.organization,
        projectId: ZeropsProjectId.make(decoded.id),
      };
      if (!retainMember(ref, rowIndex)) return;
      observations.push(...projectObservations(ref, decoded, cause));
      return;
    }
    if (descriptor.kind === "services-of-project") {
      const decoded = Option.getOrUndefined(decodeServiceRow(row));
      const project = rowProject(descriptor, decoded?.projectId);
      if (
        !decoded ||
        !hasValidServiceIds(decoded) ||
        decoded.name === undefined ||
        decoded.status === undefined ||
        project === undefined
      ) {
        issues.push({
          kind: "malformed-row",
          message: "Service row lacks identity, status or its project.",
          rowIndex,
        });
        return;
      }
      const ref: ServiceRef = {
        kind: "service",
        project,
        serviceId: ZeropsServiceId.make(decoded.id),
      };
      if (!retainMember(ref, rowIndex)) return;
      observations.push(...serviceObservations(ref, decoded, cause));
      return;
    }
  });
  return { observations, members, issues };
}

export function decodeEntityQueryPages(
  descriptor: MembershipQueryDescriptor,
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

export function decodeEntityQueryResponse(
  descriptor: MembershipQueryDescriptor,
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
    // A malformed row is that row's alone: it is dropped, and the read still covers every row it
    // was handed. One project's broken row never leaves the organization's other projects unread.
    decoded.issues.some((issue) => !isRowIssue(issue)),
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

type ProjectResponseCommand = Extract<PlatformCommand, { readonly kind: "create-project" }>;

/** Decodes a Project returned by a mutation before it can enter the shared model. */
export function decodeProjectCommandResponse(
  command: ProjectResponseCommand,
  input: unknown,
): ProtocolDecodeResult {
  const row = Option.getOrUndefined(decodeProjectRow(input));
  if (!row || !hasValidProjectIds(row) || row.name === undefined || row.status === undefined)
    return {
      observations: [],
      issues: [
        {
          kind: "malformed-row",
          message: "Command response is not the expected complete Project.",
        },
      ],
    };
  const ref: ProjectRef = {
    kind: "project",
    organization: command.organization,
    projectId: ZeropsProjectId.make(row.id),
  };
  return {
    observations: projectObservations(ref, row, { source: "command-response", command }),
    issues: [],
  };
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
const decodeMembershipDelta = Schema.decodeUnknownOption(MembershipDelta);
const decodeUpdateEnvelope = Schema.decodeUnknownOption(UpdateEnvelope);

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
  if (
    registration.descriptor.kind === "table-list" ||
    registration.descriptor.kind === "table-updates"
  ) {
    const decoded = decodeTableFrame(
      registration as RegistrationRequest & {
        readonly descriptor: { readonly kind: "table-list" | "table-updates" };
      },
      frame.data,
    );
    return decoded === null
      ? { kind: "malformed", subscriptionName: name, message: "Table frame is malformed." }
      : { kind: "observations", ...decoded };
  }
  if (registration.descriptor.kind === "query-membership") {
    const delta = Option.getOrUndefined(decodeMembershipDelta(frame.data));
    const query = registration.descriptor.query;
    const hasValidMemberId = query.kind === "projects-of-organization" ? isProjectId : isServiceId;
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
    const memberFor = (id: string): ProjectRef | ServiceRef =>
      query.kind === "projects-of-organization"
        ? { kind: "project", organization: query.organization, projectId: ZeropsProjectId.make(id) }
        : { kind: "service", project: query.project, serviceId: ZeropsServiceId.make(id) };
    const membershipOf = (operation: "add" | "remove") => (id: string) => {
      const member = memberFor(id);
      return member === undefined
        ? []
        : [
            {
              kind: "query-membership-observed" as const,
              operation,
              member,
              registration,
            } as never as QueryMembershipObservation,
          ];
    };
    const observations: QueryMembershipObservation[] = [
      ...delta.add.flatMap(membershipOf("add")),
      ...delta.delete.flatMap(membershipOf("remove")),
    ];
    return { kind: "observations", observations, issues: [] };
  }
  const descriptor = registration.descriptor;
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
    } else {
      const row = Option.getOrUndefined(decodeServiceRow(raw));
      if (
        !row ||
        !hasValidServiceIds(row) ||
        row.projectId === undefined ||
        row.projectId !== entityDescriptor.project.projectId
      ) {
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
    }
  });
  return { kind: "observations", observations, issues };
}

export function decodeRegistrationResponse(
  request: RegistrationRequest,
  input: unknown,
): ProtocolDecodeResult {
  const descriptor = request.descriptor;
  if (descriptor.kind === "table-list")
    return decodeTableSearch(request.baselineTicket as ReadTicket, input);
  if (descriptor.kind === "entity-updates" || descriptor.kind === "table-updates")
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
  return decodeEntityQueryResponse(
    descriptor.query,
    request.baselineTicket as ReadTicket,
    input,
    "indexed-search",
  );
}
