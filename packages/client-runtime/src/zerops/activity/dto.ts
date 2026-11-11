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
import { maskSecrets } from "@t3tools/shared/messagePreview";

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
  /**
   * Why it failed, as the platform says it: its public reason
   * (`publicMeta.failReason`), else its error's code and message — the same
   * reading zcp's own direct process list makes.
   */
  readonly failReason?: string;
  /**
   * Its error as the platform gave it, where it gave one: its code and its own words, and
   * `detail`, what it said of the item that failed (`meta[].error`) where that says more than
   * `message` — one line, credentials masked.
   */
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly detail?: string;
    /**
     * The command that failed, as the platform names it (`meta[].metadata.command`), and what it
     * said of its end (`meta[].metadata.message`, e.g. `exit status 1`) — credentials masked.
     */
    readonly command?: string;
    readonly exit?: string;
  };
}

/** How much of the platform's per-item words a row keeps. */
const ERROR_DETAIL_MAX = 240;

/**
 * What the platform said of each item that failed (`error.meta[].error`), each once, where it
 * says more than `message`: its first line, credentials masked, capped.
 */
function readErrorDetail(error: Record<string, unknown> | undefined, message: string) {
  const said = new Set<string>();
  for (const item of readRecordArray(error?.meta)) {
    const words = readString(item.error)?.trim().split(/\r?\n/u)[0]?.trim();
    if (words !== undefined && words.length > 0 && words !== message.trim()) said.add(words);
  }
  if (said.size === 0) return undefined;
  const detail = maskSecrets([...said].join("; "));
  return detail.length > ERROR_DETAIL_MAX
    ? `${detail.slice(0, ERROR_DETAIL_MAX - 1).trimEnd()}…`
    : detail;
}

/** The first string of a metadata entry, which the platform sends as a one-item list. */
function readFirstWords(value: unknown): string | undefined {
  const first = Array.isArray(value) ? value.find((item) => typeof item === "string") : value;
  const words = readString(first)?.trim();
  return words === undefined || words.length === 0 ? undefined : maskSecrets(words);
}

/** The first failed item's command and end, where the platform names one. */
function readFailedCommand(error: Record<string, unknown> | undefined) {
  for (const item of readRecordArray(error?.meta)) {
    const metadata = readRecord(item.metadata);
    const command = readFirstWords(metadata?.command);
    if (command !== undefined) {
      const exit = readFirstWords(metadata?.message);
      return { command, ...(exit === undefined ? {} : { exit }) };
    }
  }
  return {};
}

function readError(entry: Record<string, unknown>): ActivityProcess["error"] {
  const error = readRecord(entry.error);
  const code = readString(error?.code) ?? "";
  const message = readString(error?.message) ?? "";
  const detail = readErrorDetail(error, message);
  if (code === "" && message === "" && detail === undefined) return undefined;
  return {
    code,
    message,
    ...(detail === undefined ? {} : { detail }),
    ...readFailedCommand(error),
  };
}

/**
 * Why a process failed, in the platform's own words: what it said of the item that failed, else
 * its message, else its public reason or code. `undefined` where it said nothing.
 */
export function processFailureWords(
  process: Pick<ActivityProcess, "error" | "failReason">,
): string | undefined {
  const words = process.error?.detail ?? process.error?.message;
  return words !== undefined && words.trim().length > 0 ? words.trim() : process.failReason;
}

function readFailReason(entry: Record<string, unknown>): string | undefined {
  const reason = readString(readRecord(entry.publicMeta)?.failReason);
  if (reason !== undefined && reason.length > 0) return reason;
  const error = readRecord(entry.error);
  const code = readString(error?.code);
  if (code === undefined || code.length === 0) return undefined;
  const message = readString(error?.message);
  return message === undefined || message.length === 0 ? code : `${code}: ${message}`;
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

/** One process row as the surfaces read it; `undefined` for a row missing its identity. */
export function readActivityProcess(value: unknown): ActivityProcess | undefined {
  const entry = readRecord(value);
  if (entry === undefined) return undefined;
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
  const failReason = readFailReason(entry);
  const error = readError(entry);
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
    ...(failReason === undefined ? {} : { failReason }),
    ...(error === undefined ? {} : { error }),
  };
}
