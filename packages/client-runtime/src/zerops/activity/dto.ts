/**
 * Narrow readers over the direct process read a project's live activity is
 * built from: `GET /project/{id}/process` (zcp's `GetProjectProcessesDirect`,
 * SDK `dto/output/process.go` + `appVersionJsonObject.go` + `appVersionBuild.go`
 * + `prepareCustomRuntime.go`).
 *
 * This is a platform read, not a zcp tool result: it feeds the pending-card
 * *overlay* only (`docs/../plans/mate-live-activity-2026-09-02.md` §0), never a
 * card's verdict. Every reader is total — an unrecognised or missing field
 * degrades to `undefined` rather than throwing, and a process missing an
 * identifying field is dropped rather than corrupting the read around it
 * (§7 edge 17).
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const readRecord = (value: unknown): Record<string, unknown> | undefined =>
  isRecord(value) ? value : undefined;

const readRecordArray = (value: unknown): ReadonlyArray<Record<string, unknown>> =>
  Array.isArray(value) ? value.filter(isRecord) : [];

/** `internal/ops` fields off `AppVersionBuild` the pipeline steps are derived from. */
export interface ActivityAppVersionBuild {
  readonly pipelineStart?: string;
  readonly startDate?: string;
  readonly endDate?: string;
  /** A timestamp in the API; only its presence is read (`!!pipelineFailed`). */
  readonly pipelineFailed?: string;
}

/** Fields off `PrepareCustomRuntime` the pipeline steps are derived from. */
export interface ActivityPrepareCustomRuntime {
  readonly startDate?: string;
  readonly endDate?: string;
}

/** The slice of `AppVersionJsonObject` the pipeline-state port reads. */
export interface ActivityAppVersion {
  /** One of the `AppVersionStatusEnum` values, e.g. `BUILDING`, `WAITING_TO_DEPLOY`. */
  readonly status?: string;
  readonly build?: ActivityAppVersionBuild;
  readonly prepareCustomRuntime?: ActivityPrepareCustomRuntime;
  readonly activationDate?: string;
}

/** The slice of `Process` attribution and rendering read. */
export interface ActivityProcess {
  readonly id: string;
  readonly projectId: string;
  /** `serviceStackId` and every `serviceStacks[].id`, deduplicated. */
  readonly serviceStackIds: ReadonlyArray<string>;
  /** One of `ProcessStatusEnum`: `PENDING`, `RUNNING`, `ROLLBACKING`, `CANCELING`, `FINISHED`, `FAILED`, `CANCELED`. */
  readonly status: string;
  readonly actionName: string;
  /** ISO timestamp; the platform's own clock, never the browser's. */
  readonly created: string;
  readonly appVersion?: ActivityAppVersion;
}

function readAppVersion(value: unknown): ActivityAppVersion | undefined {
  const record = readRecord(value);
  if (record === undefined) {
    return undefined;
  }
  const build = readRecord(record.build);
  const prepareCustomRuntime = readRecord(record.prepareCustomRuntime);
  return {
    ...(readString(record.status) === undefined ? {} : { status: readString(record.status)! }),
    ...(build === undefined
      ? {}
      : {
          build: {
            ...(readString(build.pipelineStart) === undefined
              ? {}
              : { pipelineStart: readString(build.pipelineStart)! }),
            ...(readString(build.startDate) === undefined
              ? {}
              : { startDate: readString(build.startDate)! }),
            ...(readString(build.endDate) === undefined
              ? {}
              : { endDate: readString(build.endDate)! }),
            ...(readString(build.pipelineFailed) === undefined
              ? {}
              : { pipelineFailed: readString(build.pipelineFailed)! }),
          },
        }),
    ...(prepareCustomRuntime === undefined
      ? {}
      : {
          prepareCustomRuntime: {
            ...(readString(prepareCustomRuntime.startDate) === undefined
              ? {}
              : { startDate: readString(prepareCustomRuntime.startDate)! }),
            ...(readString(prepareCustomRuntime.endDate) === undefined
              ? {}
              : { endDate: readString(prepareCustomRuntime.endDate)! }),
          },
        }),
    ...(readString(record.activationDate) === undefined
      ? {}
      : { activationDate: readString(record.activationDate)! }),
  };
}

function readServiceStackIds(entry: Record<string, unknown>): ReadonlyArray<string> {
  const ids = new Set<string>();
  const single = readString(entry.serviceStackId);
  if (single !== undefined) {
    ids.add(single);
  }
  for (const stack of readRecordArray(entry.serviceStacks)) {
    const id = readString(stack.id);
    if (id !== undefined) {
      ids.add(id);
    }
  }
  return [...ids];
}

function readActivityProcess(entry: Record<string, unknown>): ActivityProcess | undefined {
  const id = readString(entry.id);
  const projectId = readString(entry.projectId);
  const status = readString(entry.status);
  const actionName = readString(entry.actionName);
  const created = readString(entry.created);
  if (
    id === undefined ||
    projectId === undefined ||
    status === undefined ||
    actionName === undefined ||
    created === undefined
  ) {
    return undefined;
  }
  const appVersion = readAppVersion(entry.appVersion);
  return {
    id,
    projectId,
    serviceStackIds: readServiceStackIds(entry),
    status,
    actionName,
    created,
    ...(appVersion === undefined ? {} : { appVersion }),
  };
}

/**
 * Reads `{ list: Process[] }` into the processes the activity overlay uses.
 *
 * Returns `undefined` when the document itself cannot be read as that shape —
 * that is "no observation" (§7 edge 17), distinct from an empty `list`, which
 * is a valid observation that just found nothing. A process entry that is
 * missing an identifying field is dropped, not allowed to corrupt the read.
 */
export function readProjectProcesses(
  document: unknown,
): ReadonlyArray<ActivityProcess> | undefined {
  const record = readRecord(document);
  if (record === undefined || !Array.isArray(record.list)) {
    return undefined;
  }
  return record.list.filter(isRecord).flatMap((entry) => {
    const process = readActivityProcess(entry);
    return process === undefined ? [] : [process];
  });
}
