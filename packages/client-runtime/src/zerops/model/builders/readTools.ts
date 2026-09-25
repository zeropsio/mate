/**
 * The read tools — `zerops_logs`, `zerops_events`, `zerops_process`,
 * `zerops_discover`. Each card is drawn from the call's own input while it
 * runs (`readResult.pending`, the final shape empty) and filled in place once
 * the result lands. A failed call reads exactly like the error card, its
 * voice kept, since the card was already on the page under that voice.
 */
import type { ZeropsCardPayload } from "../../cards/payloads.ts";
import { zeropsStatusWord, zeropsTypeLabel } from "../../serviceMap.ts";
import {
  operationClosing,
  type OperationStatusWordContext,
  sentenceCase,
  statusWord,
} from "../../operations/phrases.ts";
import type {
  ZeropsCall,
  ZeropsLogLine,
  ZeropsOperationStep,
  ZeropsReadResult,
  ZeropsReadStatus,
} from "../types.ts";
import { buildErrorFields } from "./errorKind.ts";
import {
  type BuiltCardFields,
  KIND_LABEL,
  buildStep,
  decodeCall,
  detailField,
  gatedStatusWord,
  mateVoiceFor,
  phaseFor,
  readInputString,
  undecodedDetail,
} from "./shared.ts";

type ReadKind = "logs" | "events" | "process" | "discover";

/** What a settled, decoded result adds to the card. */
interface ReadOutcome {
  readonly readResult: ZeropsReadResult;
  readonly steps?: ReadonlyArray<ZeropsOperationStep>;
  readonly statusContext?: OperationStatusWordContext;
  /** The closing line once done; absent when the body already says it all. */
  readonly message?: string;
}

interface ReadCardSpec<K extends ReadKind> {
  readonly kind: K;
  readonly subject: string;
  readonly target?: string;
  /** The final shape, empty — drawn while the call runs. */
  readonly pending: ZeropsReadResult;
  readonly settled: (card: Extract<ZeropsCardPayload, { kind: K }>) => ReadOutcome;
  readonly statusContext?: OperationStatusWordContext;
}

function isKind<K extends ReadKind>(
  card: ZeropsCardPayload | undefined,
  kind: K,
): card is Extract<ZeropsCardPayload, { kind: K }> {
  return card?.kind === kind;
}

function buildReadFields<K extends ReadKind>(
  call: ZeropsCall,
  spec: ReadCardSpec<K>,
): BuiltCardFields {
  const { voice, voiceSource } = mateVoiceFor(spec.kind, spec.subject);
  const target = spec.target === undefined ? {} : { target: { hostname: spec.target } };
  if (call.status === "failed") {
    return { ...buildErrorFields(call), subject: spec.subject, voice, voiceSource, ...target };
  }
  const decoded = decodeCall(call);
  const card = isKind(decoded.card, spec.kind) ? decoded.card : undefined;
  const outcome = card === undefined ? undefined : spec.settled(card);
  const phase = phaseFor(call.status);
  const readResult = outcome?.readResult ?? (phase === "running" ? spec.pending : undefined);
  const closing =
    phase === "running"
      ? undefined
      : phase === "done"
        ? card === undefined
          ? "Finished."
          : outcome?.message === undefined
            ? undefined
            : operationClosing(spec.kind, "done", { message: outcome.message })
        : operationClosing(spec.kind, phase, {});
  return {
    subject: spec.subject,
    kicker: `${KIND_LABEL[spec.kind]} · ${spec.subject}`,
    voice,
    voiceSource,
    statusWord: gatedStatusWord(
      spec.kind,
      phase,
      card !== undefined,
      call.resultText !== undefined,
      { ...spec.statusContext, ...outcome?.statusContext },
    ),
    ...(closing === undefined ? {} : { closing }),
    steps: outcome?.steps ?? [],
    links: [],
    ...detailField([decoded.card === undefined ? undecodedDetail(call) : undefined]),
    ...target,
    hasResult: decoded.document !== undefined,
    ...(readResult === undefined ? {} : { readResult }),
  };
}

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** `stack.enableSubdomainAccess` → `Enable subdomain access`, `env-update` → `Env update`. */
function humanizeAction(raw: string): string {
  return sentenceCase(raw.replace(/^stack\./u, "").replace(/([a-z])([A-Z])/gu, "$1 $2"));
}

/** Platform process / app-version states still in flight whose word is not already "Running". */
const IN_FLIGHT_STATUSES: ReadonlySet<string> = new Set([
  "PENDING",
  "ROLLBACKING",
  "CANCELING",
  "UPLOADING",
  "PREPARING_RUNTIME",
]);

/** A process or app-version status: `statusWord`'s word, and the tone that goes with it. */
function platformStatus(raw: string): ZeropsReadStatus {
  const word = statusWord(raw);
  if (word === "Failed" || /FAIL/u.test(raw)) {
    return { word, tone: "failed" };
  }
  if (word === "Done") {
    return { word, tone: "ok" };
  }
  const inFlight = word === "Running" || word === "Waiting" || IN_FLIGHT_STATUSES.has(raw);
  return { word, tone: inFlight ? "busy" : "off" };
}

// --- logs ---------------------------------------------------------------------

/** The most lines a logs card draws; the counts still cover every line. */
export const LOG_LINE_CAP = 12;

const ERROR_SEVERITY = /^(emerg|alert|crit|err|fatal)/iu;
const WARNING_SEVERITY = /^warn/iu;

/** syslog labels (`Error`, `Critical`, `Warning`, `Informational`, …) → the line's tone. */
function logSeverity(raw: string | undefined): ZeropsLogLine["severity"] {
  if (raw !== undefined && ERROR_SEVERITY.test(raw)) {
    return "error";
  }
  return raw !== undefined && WARNING_SEVERITY.test(raw) ? "warning" : "info";
}

const SEVERITY_FILTER_WORD: Readonly<Record<string, string>> = {
  ERROR: "errors",
  WARNING: "warnings",
};

/** `errors · since 5m · “timeout”` — the filter `LogsInput` asked for, absent when none. */
function logFilter(input: Record<string, unknown>): string | undefined {
  const severity = readInputString(input, "severity");
  const since = readInputString(input, "since");
  const search = readInputString(input, "search");
  const parts = [
    severity === undefined
      ? undefined
      : (SEVERITY_FILTER_WORD[severity.toUpperCase()] ?? severity.toLowerCase()),
    since === undefined ? undefined : `since ${since}`,
    search === undefined ? undefined : `“${search}”`,
  ].filter((part): part is string => part !== undefined);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

function logNote(
  card: Extract<ZeropsCardPayload, { kind: "logs" }>,
  drawn: number,
): string | undefined {
  if (card.entries.length === 0) {
    return card.emptyReason ?? "No log lines.";
  }
  const capped =
    drawn < card.entries.length
      ? `Showing the last ${drawn} of ${card.entries.length} lines.`
      : undefined;
  const older = card.hasMore ? "Older lines were not fetched." : undefined;
  const parts = [capped, older].filter((part): part is string => part !== undefined);
  return parts.length > 0 ? parts.join(" ") : undefined;
}

export function buildLogsFields(call: ZeropsCall): BuiltCardFields {
  const hostname = readInputString(call.input, "serviceHostname");
  const service = hostname ?? "the service";
  const filter = logFilter(call.input);
  const frame = { kind: "logs", service, ...(filter === undefined ? {} : { filter }) } as const;
  return buildReadFields(call, {
    kind: "logs",
    subject: service,
    ...(hostname === undefined ? {} : { target: hostname }),
    pending: { ...frame, pending: true, lines: [] },
    settled: (card) => {
      const first = Math.max(0, card.entries.length - LOG_LINE_CAP);
      const lines = card.entries.slice(first).map((entry, index) => ({
        id: `${first + index}`,
        ...(entry.timestamp === undefined ? {} : { at: entry.timestamp }),
        severity: logSeverity(entry.severity),
        text: entry.message,
      }));
      const severities = card.entries.map((entry) => logSeverity(entry.severity));
      const errors = severities.filter((severity) => severity === "error").length;
      const warnings = severities.filter((severity) => severity === "warning").length;
      const note = logNote(card, lines.length);
      return {
        readResult: {
          ...frame,
          pending: false,
          lines,
          ...(card.entries.length === 0
            ? {}
            : { counts: `${plural(errors, "error")} · ${plural(warnings, "warning")}` }),
          ...(note === undefined ? {} : { note }),
        },
      };
    },
  });
}

// --- events -------------------------------------------------------------------

/** The most events an events card draws; the rest are counted. */
export const EVENT_ROW_CAP = 8;

export function buildEventsFields(call: ZeropsCall): BuiltCardFields {
  const hostname = readInputString(call.input, "serviceHostname");
  return buildReadFields(call, {
    kind: "events",
    subject: hostname ?? "the project",
    ...(hostname === undefined ? {} : { target: hostname }),
    pending: { kind: "events", pending: true, rows: [] },
    settled: (card) => {
      const rest = card.events.length - EVENT_ROW_CAP;
      return {
        readResult: {
          kind: "events",
          pending: false,
          rows: card.events.slice(0, EVENT_ROW_CAP).map((event, index) => ({
            id: `${index}`,
            ...(event.timestamp === undefined ? {} : { at: event.timestamp }),
            ...(event.service === undefined ? {} : { service: event.service }),
            action: humanizeAction(event.action),
            status: platformStatus(event.status),
          })),
          ...(rest > 0 ? { more: `${rest} more` } : {}),
        },
      };
    },
  });
}

// --- process ------------------------------------------------------------------

/** What `ProcessInput` asked to follow: a service's work, several processes, or one. */
function processSubject(input: Record<string, unknown>): string {
  const service = readInputString(input, "service");
  if (service !== undefined) {
    return `the work on ${service}`;
  }
  const ids = Array.isArray(input.processIds) ? input.processIds.length : 0;
  return ids > 1 ? `${ids} processes` : "a process";
}

function processOutcome(
  card: Extract<ZeropsCardPayload, { kind: "process" }>,
  steps: ReadonlyArray<ZeropsOperationStep>,
): OperationStatusWordContext["processOutcome"] {
  if (steps.some((step) => step.state === "failed")) {
    return "failed";
  }
  if (card.timedOut) {
    return "timedOut";
  }
  return card.processes.length > 0 && card.processes.every((p) => p.status === "CANCELED")
    ? "canceled"
    : undefined;
}

export function buildProcessFields(call: ZeropsCall): BuiltCardFields {
  const service = readInputString(call.input, "service");
  return buildReadFields(call, {
    kind: "process",
    subject: processSubject(call.input),
    ...(service === undefined ? {} : { target: service }),
    pending: { kind: "process", pending: true },
    statusContext: { action: readInputString(call.input, "action") ?? "status" },
    settled: (card) => {
      const steps = card.processes.map((process, index) =>
        buildStep(
          process.processId ?? `${index}`,
          process.action === undefined ? "Process" : humanizeAction(process.action),
          process.status,
          process.failReason,
        ),
      );
      return {
        readResult: { kind: "process", pending: false },
        steps,
        statusContext: { processOutcome: processOutcome(card, steps) },
        ...(card.message === undefined ? {} : { message: card.message }),
      };
    },
  });
}

// --- discover -----------------------------------------------------------------

const RESTING_SERVICE_STATUSES: ReadonlySet<string> = new Set([
  "STOPPED",
  "READY_TO_DEPLOY",
  "DELETED",
]);
const RUNNING_SERVICE_STATUSES: ReadonlySet<string> = new Set(["ACTIVE", "RUNNING"]);

/**
 * A service status: the service map's own word, and its tone — failed on any
 * failure word, ok while it runs, off at rest (stopped, nothing deployed),
 * busy for everything in between.
 */
function serviceStatus(raw: string): ZeropsReadStatus {
  const word = zeropsStatusWord(raw);
  if (/FAIL/u.test(raw)) {
    return { word, tone: "failed" };
  }
  if (RUNNING_SERVICE_STATUSES.has(raw)) {
    return { word, tone: "ok" };
  }
  return { word, tone: RESTING_SERVICE_STATUSES.has(raw) ? "off" : "busy" };
}

/** `ops.AdoptionState` → a note for people; `adopted` needs none. */
const ADOPTION_NOTE: Readonly<Record<string, string>> = {
  adoptable: "Can be adopted",
  resumable: "Setup unfinished",
  bootstrapping: "Being set up",
  "managed-dep": "Managed",
  "zcp-self": "Zerops Control Plane",
};

export function buildDiscoverFields(call: ZeropsCall): BuiltCardFields {
  const hostname = readInputString(call.input, "service");
  return buildReadFields(call, {
    kind: "discover",
    subject: hostname ?? "the project's services",
    ...(hostname === undefined ? {} : { target: hostname }),
    pending: { kind: "discover", pending: true, rows: [] },
    settled: (card) => ({
      readResult: {
        kind: "discover",
        pending: false,
        rows: card.services.map((service) => {
          const note =
            (service.adoptionState === undefined
              ? undefined
              : ADOPTION_NOTE[service.adoptionState]) ??
            (service.isInfrastructure ? "Managed" : undefined);
          return {
            hostname: service.hostname,
            ...(service.type === undefined ? {} : { type: zeropsTypeLabel(service.type) }),
            status: serviceStatus(service.status),
            ...(note === undefined ? {} : { note }),
          };
        }),
      },
    }),
  });
}
