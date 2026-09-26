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

/** The `keys` of `record` that read as non-empty strings — every other one is left out. */
function readStringFields<Key extends string>(
  record: Record<string, unknown>,
  keys: ReadonlyArray<Key>,
): { readonly [Field in Key]?: string } {
  const fields: { [Field in Key]?: string } = {};
  for (const key of keys) {
    const value = readString(record[key]);
    if (value !== undefined) {
      fields[key] = value;
    }
  }
  return fields;
}

/** `internal/ops` fields off `AppVersionBuild` the pipeline steps are derived from. */
export interface ActivityAppVersionBuild {
  readonly pipelineStart?: string;
  readonly startDate?: string;
  readonly endDate?: string;
  /** When the pipeline failed or was cancelled — the end of whichever step it stopped in. */
  readonly pipelineFailed?: string;
  /** The build container's own service, e.g. `zbuilder@<appVersionId>` log tags. */
  readonly serviceStackId?: string;
  /** Set once the whole pipeline (build → prepare → deploy) has finished. */
  readonly pipelineFinish?: string;
  /** When the platform began creating the build container. */
  readonly containerCreationStart?: string;
  /** The build container's service name — the GUI's `<name>.zerops` container host. */
  readonly serviceStackName?: string;
}

const BUILD_FIELDS = [
  "pipelineStart",
  "startDate",
  "endDate",
  "pipelineFailed",
  "serviceStackId",
  "pipelineFinish",
  "containerCreationStart",
  "serviceStackName",
] as const satisfies ReadonlyArray<keyof ActivityAppVersionBuild>;

/** Fields off `PrepareCustomRuntime` the pipeline steps are derived from. */
export interface ActivityPrepareCustomRuntime {
  readonly startDate?: string;
  readonly endDate?: string;
  readonly serviceStackId?: string;
  /** When the platform began creating the prepare container — a build-less pipeline's start. */
  readonly containerCreationStart?: string;
  /** The prepare container's service name, once the platform has named it. */
  readonly serviceStackName?: string;
}

const PREPARE_FIELDS = [
  "startDate",
  "endDate",
  "serviceStackId",
  "containerCreationStart",
  "serviceStackName",
] as const satisfies ReadonlyArray<keyof ActivityPrepareCustomRuntime>;

/** The slice of `AppVersionJsonObject` the pipeline-state port reads. */
export interface ActivityAppVersion {
  readonly id?: string;
  /** The name the deploy was given — the commit sha on a Mate's deploys. */
  readonly name?: string;
  /** One of the `AppVersionStatusEnum` values, e.g. `BUILDING`, `WAITING_TO_DEPLOY`. */
  readonly status?: string;
  /** When the version was created. */
  readonly created?: string;
  /** Where the version came from: `CLI`, `GUI`, `GITHUB`, `GITLAB` or `GIT`. */
  readonly source?: string;
  readonly build?: ActivityAppVersionBuild;
  readonly prepareCustomRuntime?: ActivityPrepareCustomRuntime;
  readonly activationDate?: string;
}

const APP_VERSION_FIELDS = [
  "id",
  "name",
  "status",
  "created",
  "source",
  "activationDate",
] as const satisfies ReadonlyArray<keyof ActivityAppVersion>;

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
  readonly started?: string;
  readonly finished?: string;
  readonly appVersion?: ActivityAppVersion;
}

export function readActivityAppVersion(value: unknown): ActivityAppVersion | undefined {
  const record = readRecord(value);
  if (record === undefined) {
    return undefined;
  }
  const build = readRecord(record.build);
  const prepareCustomRuntime = readRecord(record.prepareCustomRuntime);
  return {
    ...readStringFields(record, APP_VERSION_FIELDS),
    ...(build === undefined ? {} : { build: readStringFields(build, BUILD_FIELDS) }),
    ...(prepareCustomRuntime === undefined
      ? {}
      : { prepareCustomRuntime: readStringFields(prepareCustomRuntime, PREPARE_FIELDS) }),
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
  const appVersion = readActivityAppVersion(entry.appVersion);
  const started = readString(entry.started);
  const finished = readString(entry.finished);
  return {
    id,
    projectId,
    serviceStackIds: readServiceStackIds(entry),
    status,
    actionName,
    created,
    ...(started === undefined ? {} : { started }),
    ...(finished === undefined ? {} : { finished }),
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
 *
 * No production caller remains: it now serves only as the test-only parity
 * oracle `apps/web/src/zerops/topologyDataParity.test.ts` decodes the same
 * raw process document against, to prove the migrated
 * `decodeEntityDirectResponse` pipeline reproduces this reader's output.
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
