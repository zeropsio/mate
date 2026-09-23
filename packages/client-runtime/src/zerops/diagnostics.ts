/**
 * What the client did and when, kept in memory for someone measuring it.
 *
 * A bounded ring of typed events — an exchange at a Mate's door, a round of
 * the access grant, a throwaway minted or taken back, the connection catalog
 * built or disposed, the route gate's verdict, a thread's first content, a
 * pass of the project flow. Each carries `t`, the recorder's clock
 * (`performance.now()` unless injected), so a reload's latency is `t` itself
 * and a span's length is on its end.
 *
 * ## Nothing secret
 *
 * An event names ids, origins, failure codes and HTTP statuses — never a
 * token, a bearer, a cookie, an e-mail or a person's name. The types allow
 * nothing else, and the recorder checks anyway: a field that is not a
 * primitive is dropped, and a string that looks like a credential or an
 * e-mail is stored as {@link REDACTED}.
 *
 * ## Off until asked for
 *
 * {@link mateDiagnostics} records nothing until a client enables it (the web
 * app does when `localStorage["mate:diagnostics"] === "1"` at boot), so every
 * emit point costs one branch otherwise.
 *
 * @module zerops/diagnostics
 */

import { ZeropsApiError } from "./api.ts";

/** What a string field becomes when it looks like a secret. */
export const REDACTED = "[redacted]";

const DEFAULT_CAPACITY = 1000;

/** Why something failed, as a code and a status — never the message. */
export interface DiagnosticFailure {
  readonly code: string;
  readonly status?: number;
}

export type ThrowawayPurpose = "door" | "gitea";

/**
 * Why an exchange at a Mate's door was attempted: the reload's restore, the
 * auto-connect of ready Mates, the repair of a session the door stopped
 * accepting, or the projects page's connect (a person's click or retry, a
 * creation's birth, the served environment's one automatic connect).
 */
export type IdentityExchangeReason = "restore" | "auto-connect" | "repair" | "user";

/**
 * The things measured from start to end. A span that never ends — its read
 * superseded by a newer key, its component gone — ends as `dropped`.
 */
interface MateDiagnosticSpans {
  /** One exchange at a Mate's door (`identityExchange.ts`). */
  readonly "identity-exchange": {
    readonly start: { readonly origin: string; readonly reason: IdentityExchangeReason };
    readonly end:
      | { readonly outcome: "success" }
      | ({ readonly outcome: "failure"; readonly retryable: boolean } & DiagnosticFailure);
  };
  /**
   * One round of the access grant's REST evidence. `requests` counts the
   * platform calls the round made: the user read, each organization's
   * project listing and each project read.
   */
  readonly "access-round": {
    readonly start: { readonly round: number };
    readonly end:
      | { readonly outcome: "verified"; readonly requests: number }
      | ({ readonly outcome: "failed"; readonly requests: number } & DiagnosticFailure);
  };
  /** One pass over every group of the project flow; `answered` is how many groups it read. */
  readonly "flow-pass": {
    readonly start: { readonly pass: "forge" | "deploys"; readonly groups: number };
    readonly end: { readonly answered: number };
  };
}

export type MateDiagnosticSpanKind = keyof MateDiagnosticSpans;
export type MateDiagnosticSpanStart<K extends MateDiagnosticSpanKind> =
  MateDiagnosticSpans[K]["start"];
export type MateDiagnosticSpanEnd<K extends MateDiagnosticSpanKind> = MateDiagnosticSpans[K]["end"];

type SpanEvent<K extends MateDiagnosticSpanKind> =
  | ({ readonly kind: K; readonly phase: "start" } & MateDiagnosticSpanStart<K>)
  | ({
      readonly kind: K;
      readonly phase: "end";
      readonly durationMs: number;
    } & MateDiagnosticSpanStart<K> &
      MateDiagnosticSpanEnd<K>)
  | ({
      readonly kind: K;
      readonly phase: "dropped";
      readonly durationMs: number;
    } & MateDiagnosticSpanStart<K>);

export type MateDiagnosticEvent =
  | { readonly [K in MateDiagnosticSpanKind]: SpanEvent<K> }[MateDiagnosticSpanKind]
  /** The grant of `round` reached the data runtime and the gate opened. */
  | { readonly kind: "access-grant"; readonly round: number }
  | { readonly kind: "access-timer"; readonly timer: "expiry" | "renewal" }
  | ({
      readonly kind: "throwaway";
      readonly action: "mint";
      readonly purpose: ThrowawayPurpose;
      readonly clientId: string;
    } & (
      | { readonly outcome: "ok"; readonly tokenId: string }
      | ({ readonly outcome: "failed" } & DiagnosticFailure)
    ))
  | ({
      readonly kind: "throwaway";
      readonly action: "delete";
      readonly clientId: string;
      /** Pairs the delete with its mint, which names the purpose. */
      readonly tokenId: string;
    } & ({ readonly outcome: "ok" } | ({ readonly outcome: "failed" } & DiagnosticFailure)))
  /** The connection runtime that holds the environment catalog. */
  | { readonly kind: "catalog"; readonly change: "built" | "disposed" }
  | {
      readonly kind: "catalog";
      readonly change: "added" | "removed";
      readonly environmentId: string;
    }
  | {
      readonly kind: "route-gate";
      readonly verdict: "restoring" | "unavailable" | "outlet";
      readonly environmentId: string | null;
    }
  /** A thread route rendered its conversation. */
  | { readonly kind: "thread-content"; readonly environmentId: string; readonly threadId: string }
  /** The first open pull request a group's flow showed. */
  | { readonly kind: "flow-pr-row"; readonly groupId: string };

export type MateDiagnosticEntry = MateDiagnosticEvent & { readonly t: number };

/** One measurement in flight: the first of `end` and `drop` is recorded, the rest ignored. */
export interface MateDiagnosticSpan<K extends MateDiagnosticSpanKind> {
  readonly end: (fields: MateDiagnosticSpanEnd<K>) => void;
  readonly drop: () => void;
}

const INERT_SPAN = { end: () => {}, drop: () => {} };

export interface MateDiagnostics {
  /** Starts recording; until then every call is a no-op. */
  readonly enable: () => void;
  readonly record: (event: MateDiagnosticEvent) => void;
  /** Records a first-time mark: an event equal to one already marked since the last clear is ignored. */
  readonly recordOnce: (event: MateDiagnosticEvent) => void;
  /** Records the start now; a span begun while recording is off stays silent. */
  readonly span: <K extends MateDiagnosticSpanKind>(
    kind: K,
    start: MateDiagnosticSpanStart<K>,
  ) => MateDiagnosticSpan<K>;
  /** Oldest first; a copy, so nothing a reader does reaches the ring. */
  readonly snapshot: () => ReadonlyArray<MateDiagnosticEntry>;
  readonly clear: () => void;
}

const EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/iu;
const BEARER = /\bbearer\s+\S/iu;
const JWT = /\beyJ[\w-]+\.[\w-]+/u;
/** A run of a token alphabet; `.` and `:` end one, so origins and tagged codes stay whole. */
const TOKEN_RUN = /[\w+/=~-]{32,}/gu;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/**
 * Whether a run is shaped like a credential: long, and either mixing letters
 * with digits or longer than any word. A UUID is an id, never a secret here.
 * A Zerops id (22 characters) and a failure code (letters only) are shorter
 * than either bound.
 */
function isTokenRun(run: string): boolean {
  if (UUID.test(run)) return false;
  return run.length >= 48 || (/\d/u.test(run) && /[a-z]/iu.test(run));
}

function looksSecret(value: string): boolean {
  return (
    EMAIL.test(value) ||
    BEARER.test(value) ||
    JWT.test(value) ||
    (value.match(TOKEN_RUN) ?? []).some(isTokenRun)
  );
}

/** Primitives only, and no string that looks like a secret. */
function sanitize(event: MateDiagnosticEvent): Record<string, string | number | boolean | null> {
  const fields: Record<string, string | number | boolean | null> = {};
  for (const [name, value] of Object.entries(event)) {
    if (typeof value === "string") fields[name] = looksSecret(value) ? REDACTED : value;
    else if (typeof value === "number" || typeof value === "boolean" || value === null)
      fields[name] = value;
  }
  return fields;
}

/** A word from a closed set — a tag's reason, a platform code — and never a sentence. */
const CODE_WORD = /^[A-Za-z][\w.-]{0,63}$/u;

function readStatus(cause: object): { readonly status?: number } {
  const status = "status" in cause ? cause.status : undefined;
  return typeof status === "number" && Number.isInteger(status) ? { status } : {};
}

/**
 * A failure as a code and a status: the platform's kind and code, a tagged
 * error's tag and reason, or an error's name. A message is never read — it is
 * where a server or a person's own words end up.
 */
export function diagnosticFailure(cause: unknown): DiagnosticFailure {
  if (cause instanceof ZeropsApiError) {
    const code =
      cause.code !== null && CODE_WORD.test(cause.code)
        ? `ZeropsApiError:${cause.kind}:${cause.code}`
        : `ZeropsApiError:${cause.kind}`;
    return { code, ...(cause.status === null ? {} : { status: cause.status }) };
  }
  if (typeof cause !== "object" || cause === null) return { code: "unknown" };
  if ("_tag" in cause && typeof cause._tag === "string") {
    const reason = "reason" in cause ? cause.reason : undefined;
    const code =
      typeof reason === "string" && CODE_WORD.test(reason) ? `${cause._tag}:${reason}` : cause._tag;
    return { code, ...readStatus(cause) };
  }
  return cause instanceof Error ? { code: cause.name } : { code: "unknown" };
}

export function createMateDiagnostics(
  options: {
    readonly capacity?: number;
    readonly now?: () => number;
    readonly enabled?: boolean;
  } = {},
): MateDiagnostics {
  const capacity = options.capacity ?? DEFAULT_CAPACITY;
  const now = options.now ?? (() => performance.now());
  let enabled = options.enabled ?? false;
  let ring: Array<MateDiagnosticEntry> = [];
  let next = 0;
  let marked = new Set<string>();

  const record = (event: MateDiagnosticEvent) => {
    if (!enabled) return;
    const entry = { ...sanitize(event), t: now() } as MateDiagnosticEntry;
    if (ring.length < capacity) ring.push(entry);
    else ring[next] = entry;
    next = (next + 1) % capacity;
  };

  const recordOnce = (event: MateDiagnosticEvent) => {
    if (!enabled) return;
    const mark = JSON.stringify(sanitize(event));
    if (marked.has(mark)) return;
    marked.add(mark);
    record(event);
  };

  const span = <K extends MateDiagnosticSpanKind>(
    kind: K,
    start: MateDiagnosticSpanStart<K>,
  ): MateDiagnosticSpan<K> => {
    if (!enabled) return INERT_SPAN;
    const startedAt = now();
    record({ ...start, kind, phase: "start" } as MateDiagnosticEvent);
    let settled = false;
    const settle = (event: MateDiagnosticEvent) => {
      if (settled) return;
      settled = true;
      record(event);
    };
    return {
      end: (fields) =>
        settle({
          ...start,
          ...fields,
          kind,
          phase: "end",
          durationMs: now() - startedAt,
        } as MateDiagnosticEvent),
      drop: () =>
        settle({
          ...start,
          kind,
          phase: "dropped",
          durationMs: now() - startedAt,
        } as MateDiagnosticEvent),
    };
  };

  return {
    enable: () => {
      enabled = true;
    },
    record,
    recordOnce,
    span,
    snapshot: () => [...ring.slice(next), ...ring.slice(0, next)].map((entry) => ({ ...entry })),
    clear: () => {
      ring = [];
      next = 0;
      marked = new Set();
    },
  };
}

/** The one recorder every emit point in this process writes to; off until a client enables it. */
export const mateDiagnostics: MateDiagnostics = createMateDiagnostics();
