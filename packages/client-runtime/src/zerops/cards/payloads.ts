/**
 * One decoder per Zerops card, and the registry that picks between them.
 *
 * Each decoder is written against the Go response struct it reads, cited in its
 * doc comment, and reads ONLY the fields its card renders — so a field zcp adds
 * is ignored and a field zcp changes degrades one line rather than the card.
 *
 * Every decoder may return undefined, and the caller renders the generic tool
 * block when one does. That is the normal path for a payload this build does
 * not recognise, and it is what the brief means by a card degrading.
 */
import {
  type ZeropsCardSource,
  readBoolean,
  readNumber,
  readRecord,
  readRecordArray,
  readString,
  readStringArray,
} from "./decode.ts";

export interface ZeropsCheckLine {
  readonly name: string;
  readonly status: string;
  readonly detail?: string;
  readonly httpStatus?: number;
}

/** `internal/ops/deploy_common.go` `DeployResult` — one target's deploy. */
export interface ZeropsDeployCard {
  readonly kind: "deploy";
  readonly target: string;
  readonly status: string;
  readonly message?: string;
  readonly buildStatus?: string;
  readonly buildDuration?: string;
  readonly subdomainUrl?: string;
  readonly failedPhase?: string;
  readonly failureCause?: string;
  readonly failureAction?: string;
  readonly warnings: ReadonlyArray<string>;
  /** The platform service id of `target`. */
  readonly targetServiceId?: string;
  /** The appVersion this build produced — absent until the build resolves, and on a failed or timed-out build. */
  readonly appVersionId?: string;
  /** The `--version-name` zcp passed to the push (the commit sha, `-dirty` when uncommitted). */
  readonly versionName?: string;
  /** The build container's last lines, attached on a failed build or prepare. */
  readonly buildLogs?: ReadonlyArray<string>;
  /** The runtime container's last lines, attached on a failed init. */
  readonly runtimeLogs?: ReadonlyArray<string>;
  /** zcp stopped waiting for the build; it may still be running on the platform. */
  readonly timedOut?: true;
  readonly nextActions?: string;
}

export type ZeropsCardPayload =
  | {
      readonly kind: "error";
      /** `platform.ErrorWire.code`, e.g. `GIT_TOKEN_INVALID`. */
      readonly code: string;
      readonly message: string;
      readonly suggestion?: string;
      readonly failureClass?: string;
      readonly checks: ReadonlyArray<ZeropsCheckLine>;
    }
  | ZeropsDeployCard
  | {
      readonly kind: "deployBatch";
      readonly summary?: string;
      /** One per target, in the order the agent named them. */
      readonly entries: ReadonlyArray<{
        readonly target: string;
        /** Absent when the kickoff itself failed — `error` says why. */
        readonly result?: ZeropsDeployCard;
        readonly error?: string;
      }>;
    }
  | {
      readonly kind: "verify";
      readonly hostname: string;
      readonly status: string;
      readonly checks: ReadonlyArray<ZeropsCheckLine>;
    }
  | {
      readonly kind: "import";
      readonly projectName?: string;
      readonly services: ReadonlyArray<{
        readonly hostname: string;
        readonly status: string;
        readonly action?: string;
        readonly failReason?: string;
        /** The platform process this service's import started. */
        readonly processId?: string;
        readonly serviceId?: string;
      }>;
      readonly errors: ReadonlyArray<{ readonly hostname: string; readonly message: string }>;
      readonly summary?: string;
      readonly nextActions?: string;
    }
  | {
      readonly kind: "mount";
      readonly mounts: ReadonlyArray<{
        readonly hostname: string;
        readonly mountPath?: string;
        readonly mounted: boolean;
        readonly message?: string;
      }>;
    }
  | {
      readonly kind: "subdomain";
      readonly hostname: string;
      readonly action: string;
      readonly urls: ReadonlyArray<string>;
    }
  | {
      readonly kind: "plan";
      /**
       * Stable for the life of one bootstrap session (a `reset` or a later new
       * bootstrap gets a new one).
       */
      readonly sessionId?: string;
      readonly intent?: string;
      readonly message?: string;
      readonly completed: number;
      readonly total: number;
      readonly steps: ReadonlyArray<{ readonly name: string; readonly status: string }>;
    }
  | {
      readonly kind: "devServer";
      readonly action: string;
      readonly hostname: string;
      readonly running: boolean;
      readonly port?: number;
      readonly url?: string;
      readonly healthStatus?: number;
      readonly message?: string;
      readonly reason?: string;
      readonly logTail?: string;
    }
  | {
      readonly kind: "browser";
      readonly url: string;
      readonly consoleErrorCount: number;
      readonly pageErrorCount: number;
      readonly failedRequestCount: number;
      readonly hasScreenshot: boolean;
      readonly forkRecoveryAttempted: boolean;
      readonly message?: string;
      readonly steps: ReadonlyArray<{
        readonly label: string;
        readonly success: boolean;
        readonly errorKind?: string;
      }>;
    };

const checkLines = (value: unknown): ReadonlyArray<ZeropsCheckLine> =>
  readRecordArray(value).flatMap((entry) => {
    const name = readString(entry.name);
    const status = readString(entry.status);
    return name === undefined || status === undefined
      ? []
      : [
          {
            name,
            status,
            ...(readString(entry.detail) === undefined
              ? {}
              : { detail: readString(entry.detail)! }),
            ...(readNumber(entry.httpStatus) === undefined
              ? {}
              : { httpStatus: readNumber(entry.httpStatus)! }),
          },
        ];
  });

const optional = <K extends string>(key: K, value: string | number | undefined) =>
  value === undefined ? {} : ({ [key]: value } as Record<K, string | number>);

const nonEmptyLines = <K extends string>(key: K, value: unknown) => {
  const lines = readStringArray(value);
  return lines.length === 0 ? {} : ({ [key]: lines } as Record<K, ReadonlyArray<string>>);
};

/** `internal/tools/errwire.go` `ErrorWire`. Never carries an envelope, by contract. */
function decodeError(document: Record<string, unknown>): ZeropsCardPayload | undefined {
  const code = readString(document.code);
  const message = readString(document.error);
  if (code === undefined || message === undefined) {
    return undefined;
  }
  return {
    kind: "error",
    code,
    message,
    ...optional("suggestion", readString(document.suggestion)),
    ...optional("failureClass", readString(readRecord(document.failureClassification)?.category)),
    checks: checkLines(document.checks),
  };
}

/**
 * `internal/ops/deploy_common.go` `DeployResult`, wrapped by `deployLocalResponse`.
 * Exported for the one caller that reads it off a failed call's document,
 * which `decodeZeropsCard` deliberately never decodes as a success shape.
 */
export function decodeDeployResult(
  document: Record<string, unknown>,
): ZeropsDeployCard | undefined {
  const target = readString(document.targetService);
  const status = readString(document.status);
  if (target === undefined || status === undefined) {
    return undefined;
  }
  const classification = readRecord(document.failureClassification);
  return {
    kind: "deploy",
    target,
    status,
    ...optional("message", readString(document.message)),
    ...optional("buildStatus", readString(document.buildStatus)),
    ...optional("buildDuration", readString(document.buildDuration)),
    ...optional("subdomainUrl", readString(document.subdomainUrl)),
    ...optional("failedPhase", readString(document.failedPhase)),
    ...optional("failureCause", readString(classification?.likelyCause)),
    ...optional("failureAction", readString(classification?.suggestedAction)),
    warnings: readStringArray(document.warnings),
    ...optional("targetServiceId", readString(document.targetServiceId)),
    ...optional("appVersionId", readString(document.appVersionId)),
    ...optional("versionName", readString(document.versionName)),
    ...nonEmptyLines("buildLogs", document.buildLogs),
    ...nonEmptyLines("runtimeLogs", document.runtimeLogs),
    ...(document.timedOut === true ? { timedOut: true as const } : {}),
    ...optional("nextActions", readString(document.nextActions)),
  };
}

/** `internal/ops/deploy_batch.go` `DeployBatchResult`, wrapped by `deployBatchResponse`. */
function decodeDeployBatch(document: Record<string, unknown>): ZeropsCardPayload | undefined {
  const entries = readRecordArray(document.entries).flatMap((entry) => {
    const target = readString(readRecord(entry.target)?.targetService);
    if (target === undefined) {
      return [];
    }
    const result = readRecord(entry.result);
    const decoded = result === undefined ? undefined : decodeDeployResult(result);
    return [
      {
        target,
        ...(decoded === undefined ? {} : { result: decoded }),
        ...optional("error", readString(entry.error)),
      },
    ];
  });
  if (entries.length === 0) {
    return undefined;
  }
  return { kind: "deployBatch", ...optional("summary", readString(document.summary)), entries };
}

/** `internal/ops/verify.go` `VerifyResult` / `VerifyAllResult`. */
function decodeVerify(document: Record<string, unknown>): ZeropsCardPayload | undefined {
  const status = readString(document.status);
  if (status === undefined) {
    return undefined;
  }
  const hostname = readString(document.hostname);
  if (hostname !== undefined) {
    return { kind: "verify", hostname, status, checks: checkLines(document.checks) };
  }
  // The all-services shape has no hostname of its own; fold each service's
  // verdict into one check line so the card stays a single reading.
  const services = readRecordArray(document.services);
  if (services.length === 0) {
    return undefined;
  }
  return {
    kind: "verify",
    hostname: readString(document.summary) ?? "all services",
    status,
    checks: services.flatMap((entry) => {
      const name = readString(entry.hostname);
      const entryStatus = readString(entry.status);
      return name === undefined || entryStatus === undefined ? [] : [{ name, status: entryStatus }];
    }),
  };
}

/** `internal/ops/import.go` `ImportResult`, wrapped by `importResponse`. */
function decodeImport(document: Record<string, unknown>): ZeropsCardPayload | undefined {
  const processes = readRecordArray(document.processes);
  const errors = readRecordArray(document.serviceErrors);
  if (processes.length === 0 && errors.length === 0) {
    return undefined;
  }
  return {
    kind: "import",
    ...optional("projectName", readString(document.projectName)),
    services: processes.flatMap((entry) => {
      const hostname = readString(entry.service);
      const status = readString(entry.status);
      return hostname === undefined || status === undefined
        ? []
        : [
            {
              hostname,
              status,
              ...optional("action", readString(entry.actionName)),
              ...optional("failReason", readString(entry.failReason)),
              ...optional("processId", readString(entry.processId)),
              ...optional("serviceId", readString(entry.serviceId)),
            },
          ];
    }),
    errors: errors.flatMap((entry) => {
      const hostname = readString(entry.service);
      const message = readString(entry.message);
      return hostname === undefined || message === undefined ? [] : [{ hostname, message }];
    }),
    ...optional("summary", readString(document.summary)),
    ...optional("nextActions", readString(document.nextActions)),
  };
}

/** `internal/ops/mount.go` `MountResult` (mount/unmount) and `MountStatusResult` (status). */
function decodeMount(document: Record<string, unknown>): ZeropsCardPayload | undefined {
  const single = readString(document.hostname);
  if (single !== undefined) {
    return {
      kind: "mount",
      mounts: [
        {
          hostname: single,
          mounted: readString(document.status) !== "UNMOUNTED",
          ...optional("mountPath", readString(document.mountPath)),
          ...optional("message", readString(document.message)),
        },
      ],
    };
  }
  const listed = readRecordArray(document.mounts);
  if (listed.length === 0) {
    return undefined;
  }
  return {
    kind: "mount",
    mounts: listed.flatMap((entry) => {
      const hostname = readString(entry.hostname);
      return hostname === undefined
        ? []
        : [
            {
              hostname,
              mounted: entry.mounted === true,
              ...optional("mountPath", readString(entry.mountPath)),
              ...optional("message", readString(entry.message)),
            },
          ];
    }),
  };
}

/** `internal/ops/subdomain.go` `SubdomainResult`. */
function decodeSubdomain(document: Record<string, unknown>): ZeropsCardPayload | undefined {
  const hostname = readString(document.serviceHostname);
  const action = readString(document.action);
  if (hostname === undefined || action === undefined) {
    return undefined;
  }
  return { kind: "subdomain", hostname, action, urls: readStringArray(document.subdomainUrls) };
}

/** `internal/workflow/bootstrap.go` `BootstrapResponse` — the plan the user confirms. */
function decodePlan(document: Record<string, unknown>): ZeropsCardPayload | undefined {
  const progress = readRecord(document.progress);
  if (progress === undefined) {
    return undefined;
  }
  const total = readNumber(progress.total);
  const completed = readNumber(progress.completed);
  if (total === undefined || completed === undefined) {
    return undefined;
  }
  return {
    kind: "plan",
    ...optional("sessionId", readString(document.sessionId)),
    ...optional("intent", readString(document.intent)),
    ...optional("message", readString(document.message)),
    completed,
    total,
    steps: readRecordArray(progress.steps).flatMap((entry) => {
      const name = readString(entry.name);
      const status = readString(entry.status);
      return name === undefined || status === undefined ? [] : [{ name, status }];
    }),
  };
}

/** `internal/ops/dev_server.go` `DevServerResult`. Same shape for every action (start/stop/status/logs/restart). */
function decodeDevServer(document: Record<string, unknown>): ZeropsCardPayload | undefined {
  const action = readString(document.action);
  const hostname = readString(document.hostname);
  const running = readBoolean(document.running);
  if (action === undefined || hostname === undefined || running === undefined) {
    return undefined;
  }
  return {
    kind: "devServer",
    action,
    hostname,
    running,
    ...optional("port", readNumber(document.port)),
    ...optional("url", readString(document.url)),
    ...optional("healthStatus", readNumber(document.healthStatus)),
    ...optional("message", readString(document.message)),
    ...optional("reason", readString(document.reason)),
    ...optional("logTail", readString(document.logTail)),
  };
}

/** One `BrowserStepResult` — `internal/ops/browser.go`. */
function browserSteps(value: unknown): ReadonlyArray<{
  readonly label: string;
  readonly success: boolean;
  readonly errorKind?: string;
}> {
  return readRecordArray(value).flatMap((entry) => {
    const command = readStringArray(entry.command);
    if (command.length === 0) {
      return [];
    }
    return [
      {
        label: command.join(" "),
        success: entry.success === true,
        ...optional("errorKind", readString(entry.errorKind)),
      },
    ];
  });
}

/**
 * `errorsOutput` / `consoleOutput` stay `json.RawMessage` on the Go side — the
 * exact agent-browser wrapper shape was never confirmed live (S7 brief). Both
 * are read tolerantly as a bare array; a shape this build does not recognise
 * counts as zero rather than failing the whole card.
 */
function countArrayLike(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

/** A console entry counts as an error when its `type` or `level` field says so. */
function countConsoleErrors(value: unknown): number {
  if (!Array.isArray(value)) {
    return 0;
  }
  return value.filter((entry) => {
    const record = readRecord(entry);
    return record !== undefined && (record.type === "error" || record.level === "error");
  }).length;
}

/** `internal/ops/browser.go` `BrowserBatchResult`. */
function decodeBrowser(document: Record<string, unknown>): ZeropsCardPayload | undefined {
  const url = readString(document.url);
  if (url === undefined) {
    return undefined;
  }
  return {
    kind: "browser",
    url,
    consoleErrorCount: countConsoleErrors(document.consoleOutput),
    pageErrorCount: countArrayLike(document.errorsOutput),
    failedRequestCount: readRecordArray(document.networkOutput).length,
    hasScreenshot: readRecord(document.screenshot) !== undefined,
    forkRecoveryAttempted: document.forkRecoveryAttempted === true,
    ...optional("message", readString(document.message)),
    steps: browserSteps(document.steps),
  };
}

/** What a delete / scale / manage / env result says about the platform process zcp waited on. */
export interface ZeropsProcessOutcome {
  readonly process?: {
    readonly id: string;
    readonly actionName: string;
    readonly status: string;
    readonly failReason?: string;
  };
  /** zcp stopped waiting for the process; it may still be running on the platform. */
  readonly timedOut?: true;
  readonly nextActions?: string;
}

/**
 * `internal/ops/manage.go` `ScaleResult`, `internal/ops/env.go` `EnvSetResult` /
 * `EnvDeleteResult`, `internal/tools/delete.go` — each an optional
 * `platform.Process` beside `timedOut` and `nextActions`; `internal/tools/manage.go`
 * embeds that process at the top level instead. Not a card of its own: these
 * kinds draw from the message document, and this is what it adds.
 */
export function decodeProcessOutcome(document: Record<string, unknown>): ZeropsProcessOutcome {
  const raw = readRecord(document.process) ?? document;
  const id = readString(raw?.id);
  const actionName = readString(raw?.actionName);
  const status = readString(raw?.status);
  return {
    ...(id === undefined || actionName === undefined || status === undefined
      ? {}
      : {
          process: {
            id,
            actionName,
            status,
            ...optional("failReason", readString(raw?.failReason)),
          },
        }),
    ...(document.timedOut === true ? { timedOut: true as const } : {}),
    ...optional("nextActions", readString(document.nextActions)),
  };
}

/**
 * Which decoder a tool's result goes to.
 *
 * `zerops_workflow` reaches a card only through its bootstrap actions, which
 * are JSON; its status / develop-start / close results are prose whose state
 * already reaches the client through the lifecycle feed.
 */
const DECODERS: Record<
  string,
  (document: Record<string, unknown>) => ZeropsCardPayload | undefined
> = {
  zerops_deploy: decodeDeployResult,
  zerops_deploy_batch: decodeDeployBatch,
  zerops_import: decodeImport,
  zerops_mount: decodeMount,
  zerops_subdomain: decodeSubdomain,
  zerops_verify: decodeVerify,
  zerops_workflow: decodePlan,
  zerops_dev_server: decodeDevServer,
  zerops_browser: decodeBrowser,
};

/**
 * The card for this tool result, or undefined when there is none to draw.
 *
 * A failed call is always the error card, whichever tool it came from: zcp
 * returns one `ErrorWire` shape for every failure, and a half-decoded success
 * payload would be a worse reading of it than the error itself.
 */
export function decodeZeropsCard(
  source: ZeropsCardSource | undefined,
): ZeropsCardPayload | undefined {
  if (source === undefined) {
    return undefined;
  }
  const asError = decodeError(source.document);
  if (asError !== undefined) {
    return asError;
  }
  return source.failed ? undefined : DECODERS[source.toolName]?.(source.document);
}
