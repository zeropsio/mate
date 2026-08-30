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
  | {
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
      }>;
      readonly errors: ReadonlyArray<{ readonly hostname: string; readonly message: string }>;
      readonly summary?: string;
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
      readonly intent?: string;
      readonly message?: string;
      readonly completed: number;
      readonly total: number;
      readonly steps: ReadonlyArray<{ readonly name: string; readonly status: string }>;
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

/** `internal/ops/deploy_common.go` `DeployResult`, wrapped by `deployLocalResponse`. */
function decodeDeploy(document: Record<string, unknown>): ZeropsCardPayload | undefined {
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
  };
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
            },
          ];
    }),
    errors: errors.flatMap((entry) => {
      const hostname = readString(entry.service);
      const message = readString(entry.message);
      return hostname === undefined || message === undefined ? [] : [{ hostname, message }];
    }),
    ...optional("summary", readString(document.summary)),
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
  zerops_deploy: decodeDeploy,
  zerops_import: decodeImport,
  zerops_mount: decodeMount,
  zerops_subdomain: decodeSubdomain,
  zerops_verify: decodeVerify,
  zerops_workflow: decodePlan,
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
