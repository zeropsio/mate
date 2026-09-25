/**
 * Decoders for the read tools — `zerops_logs`, `zerops_events`,
 * `zerops_process`, `zerops_discover`. Same contract as `payloads.ts`: each
 * reads ONLY the fields its card renders, and returns undefined for a
 * document it does not recognise so the card degrades to its raw detail.
 */
import { readBoolean, readRecord, readRecordArray, readString, readStringArray } from "./decode.ts";

export interface ZeropsLogEntry {
  readonly timestamp?: string;
  readonly severity?: string;
  readonly message: string;
}

export interface ZeropsEventEntry {
  readonly timestamp?: string;
  readonly action: string;
  readonly status: string;
  readonly service?: string;
  readonly processId?: string;
}

export interface ZeropsProcessEntry {
  readonly processId?: string;
  readonly action?: string;
  readonly status: string;
  readonly failReason?: string;
}

export interface ZeropsDiscoveredService {
  readonly hostname: string;
  readonly type?: string;
  readonly status: string;
  readonly adoptionState?: string;
  readonly isInfrastructure: boolean;
}

export type ZeropsReadCardPayload =
  | {
      readonly kind: "logs";
      /** Oldest first, as zcp sends them (`platform/logfetcher.go` `filterEntries`). */
      readonly entries: ReadonlyArray<ZeropsLogEntry>;
      readonly hasMore: boolean;
      readonly emptyReason?: string;
    }
  | {
      readonly kind: "events";
      /** Newest first, as zcp sends them (`ops/events.go`). */
      readonly events: ReadonlyArray<ZeropsEventEntry>;
    }
  | {
      readonly kind: "process";
      readonly processes: ReadonlyArray<ZeropsProcessEntry>;
      /** `wait` only: every process reached a terminal state. */
      readonly settled?: boolean;
      /** `wait` only: the wait gave up with work still in flight. */
      readonly timedOut: boolean;
      readonly message?: string;
    }
  | {
      readonly kind: "discover";
      readonly projectName?: string;
      readonly services: ReadonlyArray<ZeropsDiscoveredService>;
      readonly warnings: ReadonlyArray<string>;
    };

const optional = <K extends string, V>(key: K, value: V | undefined) =>
  value === undefined ? {} : ({ [key]: value } as Record<K, V>);

/** `internal/ops/logs.go` `LogsResult`. */
function decodeLogs(document: Record<string, unknown>): ZeropsReadCardPayload | undefined {
  if (!Array.isArray(document.entries)) {
    return undefined;
  }
  return {
    kind: "logs",
    entries: readRecordArray(document.entries).flatMap((entry) => {
      const message = readString(entry.message);
      return message === undefined
        ? []
        : [
            {
              ...optional("timestamp", readString(entry.timestamp)),
              ...optional("severity", readString(entry.severity)),
              message,
            },
          ];
    }),
    hasMore: readBoolean(document.hasMore) ?? false,
    ...optional("emptyReason", readString(document.emptyReason)),
  };
}

/** `internal/ops/events.go` `EventsResult`. */
function decodeEvents(document: Record<string, unknown>): ZeropsReadCardPayload | undefined {
  if (!Array.isArray(document.events)) {
    return undefined;
  }
  return {
    kind: "events",
    events: readRecordArray(document.events).flatMap((entry) => {
      const action = readString(entry.action);
      const status = readString(entry.status);
      return action === undefined || status === undefined
        ? []
        : [
            {
              ...optional("timestamp", readString(entry.timestamp)),
              action,
              status,
              ...optional("service", readString(entry.service)),
              ...optional("processId", readString(entry.processId)),
            },
          ];
    }),
  };
}

/** One `ProcessStatusResult` (or the id + status a `ProcessCancelResult` carries). */
function processEntry(entry: Record<string, unknown>): ZeropsProcessEntry | undefined {
  const status = readString(entry.status);
  return status === undefined
    ? undefined
    : {
        ...optional("processId", readString(entry.processId)),
        ...optional("action", readString(entry.actionName)),
        status,
        ...optional("failReason", readString(entry.failReason)),
      };
}

/**
 * `internal/ops/process.go`: `WaitResult` (action=wait), else one
 * `ProcessStatusResult` (status) or `ProcessCancelResult` (cancel).
 */
function decodeProcess(document: Record<string, unknown>): ZeropsReadCardPayload | undefined {
  const message = readString(document.message);
  if (Array.isArray(document.processes)) {
    return {
      kind: "process",
      processes: readRecordArray(document.processes).flatMap((entry) => {
        const decoded = processEntry(entry);
        return decoded === undefined ? [] : [decoded];
      }),
      ...optional("settled", readBoolean(document.settled)),
      timedOut: readBoolean(document.timedOut) ?? false,
      ...optional("message", message),
    };
  }
  const single = readString(document.processId) === undefined ? undefined : processEntry(document);
  return single === undefined
    ? undefined
    : { kind: "process", processes: [single], timedOut: false, ...optional("message", message) };
}

/** `internal/ops/discover.go` `DiscoverResult`. */
function decodeDiscover(document: Record<string, unknown>): ZeropsReadCardPayload | undefined {
  if (!Array.isArray(document.services)) {
    return undefined;
  }
  return {
    kind: "discover",
    ...optional("projectName", readString(readRecord(document.project)?.name)),
    services: readRecordArray(document.services).flatMap((entry) => {
      const hostname = readString(entry.hostname);
      const status = readString(entry.status);
      return hostname === undefined || status === undefined
        ? []
        : [
            {
              hostname,
              ...optional("type", readString(entry.type)),
              status,
              ...optional("adoptionState", readString(entry.adoptionState)),
              isInfrastructure: entry.isInfrastructure === true,
            },
          ];
    }),
    warnings: readStringArray(document.warnings),
  };
}

export const READ_DECODERS: Readonly<
  Record<string, (document: Record<string, unknown>) => ZeropsReadCardPayload | undefined>
> = {
  zerops_logs: decodeLogs,
  zerops_events: decodeEvents,
  zerops_process: decodeProcess,
  zerops_discover: decodeDiscover,
};
