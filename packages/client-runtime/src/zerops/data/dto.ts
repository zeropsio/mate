/** Compatibility projections shared by all clients while UI consumes the existing Zerops DTOs. */
import type { ZeropsProject, ZeropsService } from "../api.ts";
import type { ActivityProcess } from "../activity/dto.ts";
import type { ProjectRecord, ServiceRecord, ProcessRecord } from "./types.ts";

export function projectRecordToZeropsProject(record: ProjectRecord): ZeropsProject | null {
  if (record.identity.knowledge !== "observed" || record.lifecycle.knowledge !== "observed")
    return null;
  return {
    id: record.ref.projectId,
    clientId: record.ref.organization.organizationId,
    name: record.identity.fields.name,
    status: record.lifecycle.fields.status,
    ...(record.identity.fields.createdAt === null || record.identity.fields.createdAt === undefined
      ? {}
      : { created: record.identity.fields.createdAt }),
    ...(record.presentation.knowledge === "observed"
      ? {
          tagList: record.presentation.fields.tags ?? [],
          ...(record.presentation.fields.description === null ||
          record.presentation.fields.description === undefined
            ? {}
            : { description: record.presentation.fields.description }),
        }
      : {}),
    ...(record.placement.knowledge === "observed"
      ? {
          ...(record.placement.fields.publicZone === null ||
          record.placement.fields.publicZone === undefined
            ? {}
            : { publicZone: record.placement.fields.publicZone }),
          ...(record.placement.fields.zeropsSubdomainHost === null ||
          record.placement.fields.zeropsSubdomainHost === undefined
            ? {}
            : { zeropsSubdomainHost: record.placement.fields.zeropsSubdomainHost }),
          ...(record.placement.fields.mode === null || record.placement.fields.mode === undefined
            ? {}
            : { mode: record.placement.fields.mode }),
        }
      : {}),
  };
}

export function serviceRecordToZeropsService(record: ServiceRecord): ZeropsService | null {
  if (record.identity.knowledge !== "observed" || record.lifecycle.knowledge !== "observed")
    return null;
  const type = record.identity.fields.type;
  const routing = record.routing.knowledge === "observed" ? record.routing.fields : null;
  const deployment = record.deployment.knowledge === "observed" ? record.deployment.fields : null;
  const scaling = record.scaling.knowledge === "observed" ? record.scaling.fields : null;
  return {
    id: record.ref.serviceId,
    name: record.identity.fields.hostname,
    ...(record.identity.fields.isSystem === undefined
      ? {}
      : { isSystem: record.identity.fields.isSystem }),
    status: record.lifecycle.fields.status,
    ...(record.lifecycle.fields.createdAt === null ||
    record.lifecycle.fields.createdAt === undefined
      ? {}
      : { created: record.lifecycle.fields.createdAt }),
    ...(record.lifecycle.fields.updatedAt === null ||
    record.lifecycle.fields.updatedAt === undefined
      ? {}
      : { lastUpdate: record.lifecycle.fields.updatedAt }),
    ...(type === null || type === undefined
      ? {}
      : {
          serviceStackTypeInfo: {
            serviceStackTypeVersionName: type.versionName,
            ...(type.displayName === null ? {} : { serviceStackTypeName: type.displayName }),
            ...(type.category === null ? {} : { serviceStackTypeCategory: type.category }),
          },
        }),
    ...(routing === null
      ? {}
      : {
          ...(routing.subdomainAccess === null ? {} : { subdomainAccess: routing.subdomainAccess }),
          ports: (routing.ports ?? []).map((port) => ({
            port: port.port,
            ...(port.protocol === null ? {} : { protocol: port.protocol }),
            ...(port.scheme === null ? {} : { scheme: port.scheme }),
            ...(port.httpSupport === null ? {} : { httpSupport: port.httpSupport }),
          })),
        }),
    ...(deployment === null
      ? {}
      : {
          ...(deployment.versionNumber == null ? {} : { versionNumber: deployment.versionNumber }),
          mode: deployment.mode,
          activeAppVersion:
            deployment.activeDeploy === null || deployment.activeDeploy === undefined
              ? null
              : {
                  source: deployment.activeDeploy.source,
                  ...(deployment.activeDeploy.activatedAt === null
                    ? {}
                    : { lastUpdate: deployment.activeDeploy.activatedAt }),
                  ...(deployment.activeDeploy.name === null
                    ? {}
                    : { name: deployment.activeDeploy.name }),
                  githubIntegration: {
                    branchName: deployment.activeDeploy.branch,
                    commit: deployment.activeDeploy.commit,
                    tagName: deployment.activeDeploy.tag,
                    repositoryFullName: deployment.activeDeploy.repository,
                  },
                  publicGitSource: {
                    branchName: deployment.activeDeploy.branch,
                    repositoryUrl: deployment.activeDeploy.repository,
                  },
                },
        }),
    ...(scaling === null
      ? {}
      : {
          currentAutoscaling: {
            horizontalAutoscaling:
              scaling.containers === null || scaling.containers === undefined
                ? null
                : {
                    ...(scaling.containers.min === undefined
                      ? {}
                      : { minContainerCount: scaling.containers.min }),
                    ...(scaling.containers.max === undefined
                      ? {}
                      : { maxContainerCount: scaling.containers.max }),
                  },
            verticalAutoscaling: {
              minResource: {
                ...(scaling.cpu?.min === undefined ? {} : { cpuCoreCount: scaling.cpu.min }),
                ...(scaling.memoryGb?.min === undefined
                  ? {}
                  : { memoryGBytes: scaling.memoryGb.min }),
                ...(scaling.diskGb?.min === undefined ? {} : { diskGBytes: scaling.diskGb.min }),
              },
              maxResource: {
                ...(scaling.cpu?.max === undefined ? {} : { cpuCoreCount: scaling.cpu.max }),
                ...(scaling.memoryGb?.max === undefined
                  ? {}
                  : { memoryGBytes: scaling.memoryGb.max }),
                ...(scaling.diskGb?.max === undefined ? {} : { diskGBytes: scaling.diskGb.max }),
              },
              ...(scaling.cpuMode === undefined ? {} : { cpuMode: scaling.cpuMode }),
            },
          },
        }),
  };
}

function processStatus(record: ProcessRecord): string {
  if (record.lifecycle.knowledge !== "observed") return "UNKNOWN";
  const status = record.lifecycle.fields.status;
  return typeof status === "string" ? status : status.raw;
}

export function processRecordToActivityProcess(record: ProcessRecord): ActivityProcess | null {
  if (record.identity.knowledge !== "observed" || record.lifecycle.knowledge !== "observed")
    return null;
  const pipeline =
    record.pipeline.knowledge === "observed" ? record.pipeline.fields.appVersion : null;
  return {
    id: record.ref.processId,
    projectId: record.ref.project.projectId,
    serviceStackIds: record.identity.fields.serviceIds ?? [],
    status: processStatus(record),
    actionName: record.identity.fields.actionName,
    created: record.identity.fields.createdAt,
    ...(record.lifecycle.fields.startedAt === null ||
    record.lifecycle.fields.startedAt === undefined
      ? {}
      : { started: record.lifecycle.fields.startedAt }),
    ...(record.lifecycle.fields.finishedAt === null ||
    record.lifecycle.fields.finishedAt === undefined
      ? {}
      : { finished: record.lifecycle.fields.finishedAt }),
    ...(pipeline === null || pipeline === undefined
      ? {}
      : {
          appVersion: pipeline,
        }),
  };
}
