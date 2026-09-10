// @effect-diagnostics nodeBuiltinImport:off - the console engine is a real
// child process; this module is the process boundary.
/**
 * The mate-server HOST half of the Data Console (`dataconsole-api.md`) —
 * `../zcp/docs/spec-mate.md` §5 "Data surface". zcp owns the engine
 * (`zcp studio console serve`, a loopback HTTP process); this module spawns
 * it on first use, keeps its ready-line secret (`{url, sessionToken}`) in
 * memory only, and brokers every client request onto ONE allowlisted
 * method+path of the console — the client never talks to the console
 * directly (same trust-boundary shape as {@link ../zerops/ZeropsBrowserStream.ts}).
 *
 * Read-only in this slice (BRIEF "Read-only in this slice"): `--allow-writes`
 * is never passed, and every mutating console route is unreachable from
 * {@link routeRequest}'s closed table.
 *
 * ## Session lifecycle
 *
 * `idle → starting → ready`, or `idle → starting → unavailable|unsupported`.
 * The FIRST `call` while idle spawns the console (CAS on {@link SessionState}
 * via `Ref.modify` — a concurrent second first-call awaits the same
 * `Deferred` instead of spawning twice). A ready session is killed after
 * {@link IDLE_TIMEOUT_MS} with no request (stdin closed, then SIGTERM) or at
 * server shutdown (the layer's finalizer). A child that exits — idle-killed,
 * crashed, or killed externally — is forgotten: the state returns to `idle`
 * so the next `call` respawns a fresh session.
 *
 * ## Degrade, never crash-loop
 *
 * If the child exits before printing its one-line ready JSON (or never
 * prints one within {@link READY_LINE_TIMEOUT_MS}), {@link classifyStartupFailure}
 * reads its stderr: `"unknown studio subcommand: ..."` (an older zcp with
 * `studio` but no `console` verb) classifies as `unsupported` — permanent for
 * this zcp build, `call` fails immediately with `session_unsupported` and no
 * respawn is attempted. Anything else — including an even older zcp that
 * lacks the `studio` verb entirely and so falls through to MCP `serve` mode,
 * which never prints a ready line and is caught by the timeout — classifies
 * as `unavailable` with a sanitized one-line reason (paths redacted, capped
 * at {@link MAX_REASON_LENGTH} characters); `call` fails with
 * `session_unavailable`. Unlike `unsupported`, `unavailable` is NOT
 * permanent — a service the console tried to discover may simply still be
 * booting — so the subscription keeps showing `unavailable` with its reason
 * right up until the NEXT `call`, which attempts a fresh spawn exactly like
 * a first call from `idle` (and may itself fail again the same way, or
 * succeed). A ready line that parses but names a non-loopback host
 * ({@link isLoopbackReadyUrl} — anything other than `127.0.0.1`, `localhost`,
 * or `::1`) is treated the same as an unreadable one: `unavailable` with
 * reason "console did not bind loopback" — this broker only ever dials
 * `127.0.0.1:<port>` by contract, and never trusts the console to have
 * honored that on its own. Neither the raw stderr nor the ready-line's
 * secret fields are ever logged or traced.
 */
import * as NodeChildProcess from "node:child_process";

import {
  ZeropsDataConsoleError,
  ZeropsDataConsoleNode as ZeropsDataConsoleNodeSchema,
  ZeropsDataConsoleNodeMeta as ZeropsDataConsoleNodeMetaSchema,
  ZeropsDataConsolePath as ZeropsDataConsolePathSchema,
  ZeropsDataConsoleService as ZeropsDataConsoleServiceSchema,
  ZeropsDataConsoleTablePage as ZeropsDataConsoleTablePageSchema,
  type ZeropsDataConsoleErrorCode,
  type ZeropsDataConsolePage,
  type ZeropsDataConsoleRequest,
  type ZeropsDataConsoleResponse,
  type ZeropsDataConsoleSessionEvent,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as Headers from "effect/unstable/http/Headers";

import { ServerConfig } from "../config.ts";

const IDLE_TIMEOUT = Duration.minutes(10);
const READY_LINE_TIMEOUT = Duration.seconds(5);
const REQUEST_TIMEOUT = Duration.seconds(10);
const BLOB_CAP_BYTES = 256 * 1024;
const MAX_REASON_LENGTH = 120;

const ZCP_COMMAND = "zcp";

/**
 * The subset of a spawned console child process this module needs,
 * injectable so a test never spawns a real `zcp`. The real implementation
 * ({@link makeRealSpawn}) wraps `node:child_process.spawn`.
 */
export interface DataConsoleProcess {
  readonly onStdout: (listener: (chunk: string) => void) => void;
  readonly onStderr: (listener: (chunk: string) => void) => void;
  /**
   * Fires once the process has actually ended (real implementation: Node's
   * `"close"` event, not `"exit"` — `close` fires only after every stdio
   * stream has finished emitting its buffered data, so stderr is fully
   * drained by the time {@link classifyStartupFailure} reads it; `exit` can
   * fire first and race the final stderr chunk, silently losing the
   * `"unknown studio subcommand"` line and misclassifying a permanent
   * `unsupported` build as a merely-transient `unavailable` one).
   */
  readonly onExit: (listener: (code: number | null) => void) => void;
  /** The spawn itself failed — the binary is missing, not executable, etc (Node's `"error"` event). May fire instead of, or in addition to, `onExit`. */
  readonly onError: (listener: (error: unknown) => void) => void;
  /** Closes stdin — with a pipe stdin (never a TTY), this is the console's own graceful-shutdown trigger (`dataconsole-api.md` §1). */
  readonly endStdin: () => void;
  readonly kill: () => void;
}

export type SpawnDataConsole = () => DataConsoleProcess;

/** Exported for a real-process regression test only (`ZeropsDataConsole.test.ts`) — everything else injects {@link SpawnDataConsole}. Always appends `["studio", "console", "serve"]` to `baseArgs`. */
export const makeRealSpawn = (
  command: string,
  baseArgs: ReadonlyArray<string>,
  cwd: string,
): SpawnDataConsole => {
  return () => {
    const child = NodeChildProcess.spawn(command, [...baseArgs, "studio", "console", "serve"], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return {
      onStdout: (listener) => {
        child.stdout?.on("data", (chunk: Buffer) => listener(chunk.toString("utf8")));
      },
      onStderr: (listener) => {
        child.stderr?.on("data", (chunk: Buffer) => listener(chunk.toString("utf8")));
      },
      onExit: (listener) => {
        child.once("close", (code) => listener(code));
      },
      onError: (listener) => {
        child.once("error", (error) => listener(error));
      },
      endStdin: () => {
        child.stdin?.end();
      },
      kill: () => {
        child.kill("SIGTERM");
      },
    };
  };
};

interface ReadyInfo {
  readonly url: string;
  readonly sessionToken: string;
  readonly allowWrites: boolean;
}

const ReadyLineSchema = Schema.Struct({
  url: Schema.String,
  sessionToken: Schema.String,
  allowWrites: Schema.Boolean,
});
const decodeReadyLine = Schema.decodeUnknownResult(Schema.fromJsonString(ReadyLineSchema));

/** Parses the console's one-line ready JSON (`dataconsole-api.md` §1); `undefined` on anything unreadable. Never logs its input — the caller must not either. */
export const parseReadyLine = (line: string): ReadyInfo | undefined => {
  const decoded = decodeReadyLine(line.trim());
  return Result.isFailure(decoded)
    ? undefined
    : {
        url: decoded.success.url,
        sessionToken: decoded.success.sessionToken,
        allowWrites: decoded.success.allowWrites,
      };
};

const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set(["127.0.0.1", "localhost", "::1"]);

/** Whether a ready-line URL's hostname is loopback — the console must bind `127.0.0.1`/`localhost`/`::1` only (`dataconsole-api.md` §1); anything else is treated as a startup failure, never dialed. `undefined`/unparsable `url` counts as not loopback. */
export const isLoopbackReadyUrl = (url: string): boolean => {
  try {
    // WHATWG URL keeps the brackets around an IPv6 literal hostname
    // (`[::1]`) — strip them so `::1` matches like the other two forms.
    const hostname = new URL(url).hostname.replace(/^\[|\]$/g, "");
    return LOOPBACK_HOSTNAMES.has(hostname);
  } catch {
    return false;
  }
};

const firstNonEmptyLine = (text: string): string | undefined => {
  const line = text.split("\n").find((entry) => entry.trim().length > 0);
  return line === undefined ? undefined : line.trim();
};

/** Redacts anything path-shaped and caps length — a startup failure reason may carry a filesystem path, never surfaced to a client. */
const sanitizeReason = (line: string): string => {
  const redacted = line.replace(/(?:[A-Za-z]:)?[/\\][^\s:]*/g, "<path>");
  return redacted.length > MAX_REASON_LENGTH
    ? `${redacted.slice(0, MAX_REASON_LENGTH - 3)}...`
    : redacted;
};

interface StartupFailure {
  readonly status: "unavailable" | "unsupported";
  readonly reason?: string;
}

/** See the module doc comment's "Degrade, never crash-loop" section. */
export const classifyStartupFailure = (stderr: string): StartupFailure => {
  const line = firstNonEmptyLine(stderr);
  if (line !== undefined && /unknown (studio )?subcommand/i.test(line)) {
    return { status: "unsupported" };
  }
  return line === undefined
    ? { status: "unavailable" }
    : { status: "unavailable", reason: sanitizeReason(line) };
};

type SessionState =
  | { readonly _tag: "idle" }
  | {
      readonly _tag: "starting";
      readonly deferred: Deferred.Deferred<ReadyInfo, ZeropsDataConsoleError>;
    }
  | { readonly _tag: "ready"; readonly info: ReadyInfo }
  | { readonly _tag: "unavailable"; readonly reason: string | undefined }
  | { readonly _tag: "unsupported" };

type ProcEvent =
  | { readonly _tag: "stdoutLine"; readonly line: string }
  | { readonly _tag: "exit"; readonly code: number | null }
  /** The spawn itself failed (ENOENT/EACCES/etc, `child_process`'s `"error"` event) — no process to read stderr from at all. */
  | { readonly _tag: "error" };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const KNOWN_ENVELOPE_CODES: ReadonlySet<string> = new Set([
  "not_found",
  "read_only",
  "needs_confirm",
  "conflict",
  "wrong_type",
  "too_large",
  "unsupported",
  "unreachable",
  "upstream",
  "invalid",
  "timeout",
  "internal",
]);

/**
 * A reviver's third argument (`{source}`, the exact source text of the
 * value just parsed) is a Node ≥21 JSON.parse extension (the mate server
 * container runs Node 24) — TypeScript's `lib.es5` `JSON.parse` overload
 * predates it and only declares `(key: string, value: any) => any`. Rather
 * than a global augmentation, {@link preserveBigIntegers} simply declares
 * its third parameter OPTIONAL: a function with an extra optional parameter
 * still structurally satisfies the narrower 2-parameter reviver type, so
 * `JSON.parse(text, preserveBigIntegers)` typechecks without touching
 * `lib.d.ts` — while the value actually passed at runtime (on Node 24) is
 * used to recover a bigint cell exactly.
 */
interface JsonReviverContext {
  readonly source?: string;
}

/**
 * `JSON.parse` reviver: an out-of-`Number.isSafeInteger`-range integer
 * (e.g. a bigint primary key) is replaced by its EXACT decimal source text
 * instead of the already-rounded `number` `JSON.parse` produced — every
 * console cell value is `Schema.Unknown` in the contract (`zerops.ts`), so a
 * string here passes straight through to the client unchanged. A float
 * (`context.source` doesn't match `/^-?\d+$/`) or anything already exactly
 * representable is left as the `number` `JSON.parse` produced.
 */
const preserveBigIntegers = (
  _key: string,
  value: unknown,
  context?: JsonReviverContext,
): unknown =>
  typeof value === "number" &&
  !Number.isSafeInteger(value) &&
  context?.source !== undefined &&
  /^-?\d+$/.test(context.source)
    ? context.source
    : value;

/** Parses one console JSON body, preserving exact big-integer cell values (see {@link preserveBigIntegers}) — used for every `/api/*` JSON body, success or error envelope. Never used for the ready-line (no numeric cell values there). Exported only for a direct table-driven test. */
export const parseConsoleJson = (text: string): unknown => JSON.parse(text, preserveBigIntegers);

/** Reads and parses one console JSON response body — `response.json` is never used directly in this module, since Effect's own accessor doesn't run a reviver and would silently round a bigint cell. */
const readConsoleJson = <E>(response: {
  readonly text: Effect.Effect<string, E>;
}): Effect.Effect<unknown, ZeropsDataConsoleError> =>
  response.text.pipe(
    Effect.mapError(
      () =>
        new ZeropsDataConsoleError({
          code: "internal",
          message: "console returned an unreadable response",
        }),
    ),
    Effect.flatMap((text) =>
      Effect.try({
        try: () => parseConsoleJson(text),
        catch: () =>
          new ZeropsDataConsoleError({
            code: "internal",
            message: "console returned an unreadable response",
          }),
      }),
    ),
  );

const toEnvelopeError = (envelope: unknown, status: number): ZeropsDataConsoleError => {
  const record = isRecord(envelope) ? envelope : {};
  const rawCode = typeof record.code === "string" ? record.code : undefined;
  const code = (
    rawCode !== undefined && KNOWN_ENVELOPE_CODES.has(rawCode) ? rawCode : "internal"
  ) as ZeropsDataConsoleErrorCode;
  const message =
    typeof record.message === "string"
      ? record.message
      : `console request failed with status ${status}`;
  return new ZeropsDataConsoleError({
    code,
    message,
    ...(typeof record.service === "string" ? { service: record.service } : {}),
    ...(typeof record.family === "string" ? { family: record.family } : {}),
    ...(typeof record.action === "string" ? { action: record.action } : {}),
    ...(typeof record.requestId === "string" ? { requestId: record.requestId } : {}),
  });
};

const toUnreachableError = (): ZeropsDataConsoleError =>
  new ZeropsDataConsoleError({ code: "unreachable", message: "could not reach the data console" });

const TIMEOUT_ERROR = new ZeropsDataConsoleError({
  code: "timeout",
  message: "console request timed out",
});

/** A request-level `Effect.timeout` failure maps to `timeout`; every other transport failure (connection refused, DNS, etc.) maps to `unreachable`. */
const toRequestError = (cause: { readonly _tag: string }): ZeropsDataConsoleError =>
  cause._tag === "TimeoutError" ? TIMEOUT_ERROR : toUnreachableError();

const UNAUTHORIZED_ERROR = new ZeropsDataConsoleError({
  code: "internal",
  message: "console rejected the session",
});

/** One allowlisted console route this broker knows how to reach. */
export interface RoutedRequest {
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly query?: Record<string, string>;
  readonly body?: unknown;
}

const encodeSegments = (segments: ReadonlyArray<string>): string => JSON.stringify(segments);

const pageQuery = (page: ZeropsDataConsolePage | undefined): Record<string, string> => {
  const query: Record<string, string> = {};
  if (page?.cursor !== undefined) query.cursor = page.cursor;
  if (page?.limit !== undefined) query.limit = String(page.limit);
  if (page?.sort !== undefined) query.sort = page.sort;
  if (page?.direction !== undefined) query.direction = page.direction;
  return query;
};

/**
 * The closed table over `ZeropsDataConsoleRequest["kind"]` → one console
 * route (`dataconsole-api.md` §3, read-only slice). `refresh` is handled
 * separately by {@link performRequest} — the console API itself answers a
 * refresh with two hops (`POST /api/refresh` then a fresh
 * `GET /api/services`), so it has no single route to name here.
 */
export const routeRequest = (
  request: Exclude<ZeropsDataConsoleRequest, { readonly kind: "refresh" }>,
): RoutedRequest => {
  switch (request.kind) {
    case "services":
      return { method: "GET", path: "/api/services" };
    case "tree":
      return {
        method: "GET",
        path: "/api/tree",
        query: {
          service: request.path.service,
          segs: encodeSegments(request.path.segments),
          ...pageQuery(request.page),
        },
      };
    case "stat":
      return {
        method: "GET",
        path: "/api/stat",
        query: { service: request.path.service, segs: encodeSegments(request.path.segments) },
      };
    case "blob":
      return {
        method: "GET",
        path: "/api/blob",
        query: { service: request.path.service, segs: encodeSegments(request.path.segments) },
      };
    case "table":
      return {
        method: "GET",
        path: "/api/table",
        query: {
          service: request.path.service,
          segs: encodeSegments(request.path.segments),
          ...pageQuery(request.page),
        },
      };
    case "tableCount":
      return {
        method: "GET",
        path: "/api/table/count",
        query: { service: request.path.service, segs: encodeSegments(request.path.segments) },
      };
    case "query":
      return {
        method: "POST",
        path: "/api/query",
        body: { service: request.service, stmt: request.stmt, page: request.page ?? {} },
      };
    case "search":
      return {
        method: "GET",
        path: "/api/search",
        query: {
          service: request.path.service,
          segs: encodeSegments(request.path.segments),
          q: request.q,
          ...pageQuery(request.page),
        },
      };
  }
};

/**
 * Every non-blob console response body is decoded, but NOT against the
 * strict contract schemas directly — the console's Go structs mark almost
 * every field `omitempty`, so a false bool, an empty string, or a nil slice
 * routinely drops off the wire entirely (or, for a slice, arrives as literal
 * `null` rather than being omitted at all — confirmed live: `POST
 * /api/query`'s `rowKeyCols` came back `null`, not absent). Each "lenient"
 * schema below accepts the field missing/`undefined`/`null` and this module
 * normalizes it to the strict contract's default (a schema mismatch on
 * anything else still fails with `ZeropsDataConsoleError{code:"internal"}` —
 * only omission is tolerated, not a genuinely wrong shape).
 */
const LenientServiceActionSchema = Schema.Struct({
  id: Schema.String,
  enabled: Schema.Boolean,
  readOnly: Schema.Boolean,
  reason: Schema.optional(Schema.String),
});
const LenientServiceSchema = Schema.Struct({
  hostname: Schema.String,
  type: Schema.String,
  family: Schema.String,
  support: Schema.String,
  actions: Schema.Array(LenientServiceActionSchema),
  status: Schema.optional(Schema.String),
});
const normalizeService = (
  service: typeof LenientServiceSchema.Type,
): typeof ZeropsDataConsoleServiceSchema.Type => ({
  ...service,
  status: service.status ?? "",
  actions: service.actions.map((action) => ({ ...action, reason: action.reason ?? "" })),
});

const ServicesEnvelopeSchema = Schema.Struct({
  project: Schema.Struct({ id: Schema.String, name: Schema.String }),
  services: Schema.Array(LenientServiceSchema),
  allowWrites: Schema.Boolean,
});
const decodeServicesEnvelope = Schema.decodeUnknownResult(ServicesEnvelopeSchema);
const normalizeServicesEnvelope = (envelope: typeof ServicesEnvelopeSchema.Type) => ({
  project: envelope.project,
  services: envelope.services.map(normalizeService),
  allowWrites: envelope.allowWrites,
});

const LenientNodeSchema = Schema.Struct({
  name: Schema.String,
  kind: Schema.Literals(["container", "tabular", "blob"]),
  path: ZeropsDataConsolePathSchema,
  hasChildren: Schema.optional(Schema.Boolean),
  meta: Schema.optional(ZeropsDataConsoleNodeMetaSchema),
});
const normalizeNode = (
  node: typeof LenientNodeSchema.Type,
): typeof ZeropsDataConsoleNodeSchema.Type => ({
  ...node,
  hasChildren: node.hasChildren ?? false,
});

const TreeEnvelopeSchema = Schema.Struct({
  nodes: Schema.Array(LenientNodeSchema),
  nextCursor: Schema.optional(Schema.String),
});
const decodeTreeEnvelope = Schema.decodeUnknownResult(TreeEnvelopeSchema);

const decodeNode = Schema.decodeUnknownResult(LenientNodeSchema);

const LenientColumnSchema = Schema.Struct({
  name: Schema.String,
  dataType: Schema.optional(Schema.String),
  pk: Schema.optional(Schema.Boolean),
  editable: Schema.optional(Schema.Boolean),
  reason: Schema.optional(Schema.String),
  sortable: Schema.optional(Schema.Boolean),
  sortReason: Schema.optional(Schema.String),
});
const LenientTablePageSchema = Schema.Struct({
  columns: Schema.NullOr(Schema.Array(LenientColumnSchema)),
  // A Go nil slice encodes as literal null: an empty table answers `rows: null`.
  rows: Schema.NullOr(Schema.Array(Schema.Array(Schema.Unknown))),
  nextCursor: Schema.optional(Schema.String),
  rowKeyCols: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
  bestEffort: Schema.optional(Schema.Boolean),
  numbered: Schema.optional(Schema.Boolean),
});
const decodeTablePage = Schema.decodeUnknownResult(LenientTablePageSchema);
const normalizeTablePage = (
  page: typeof LenientTablePageSchema.Type,
): typeof ZeropsDataConsoleTablePageSchema.Type => ({
  columns: (page.columns ?? []).map((column) => ({
    name: column.name,
    dataType: column.dataType ?? "",
    pk: column.pk ?? false,
    editable: column.editable ?? false,
    reason: column.reason ?? "",
    sortable: column.sortable ?? false,
    sortReason: column.sortReason ?? "",
  })),
  rows: page.rows ?? [],
  nextCursor: page.nextCursor ?? "",
  rowKeyCols: page.rowKeyCols ?? [],
  bestEffort: page.bestEffort ?? false,
  numbered: page.numbered ?? false,
});

const CountEnvelopeSchema = Schema.Struct({ count: Schema.Number });
const decodeCountEnvelope = Schema.decodeUnknownResult(CountEnvelopeSchema);

const RESPONSE_DECODE_ERROR = new ZeropsDataConsoleError({
  code: "internal",
  message: "console returned a response that doesn't match the expected shape",
});

/** Decodes one non-blob console response body per request `kind` — leniently (see the block comment above), against the console's actual `omitempty`-shaped wire body, then normalizes into the strict contract shape. A body that genuinely doesn't match fails with `ZeropsDataConsoleError{code:"internal"}` rather than passing the raw body through. */
const decodeResponseBody = (
  kind: Exclude<ZeropsDataConsoleRequest["kind"], "blob">,
  body: unknown,
): Effect.Effect<ZeropsDataConsoleResponse, ZeropsDataConsoleError> => {
  switch (kind) {
    case "services":
    case "refresh": {
      const decoded = decodeServicesEnvelope(body);
      return Result.isFailure(decoded)
        ? Effect.fail(RESPONSE_DECODE_ERROR)
        : Effect.succeed({ kind: "services", ...normalizeServicesEnvelope(decoded.success) });
    }
    case "tree": {
      const decoded = decodeTreeEnvelope(body);
      return Result.isFailure(decoded)
        ? Effect.fail(RESPONSE_DECODE_ERROR)
        : Effect.succeed({
            kind: "tree",
            nodes: decoded.success.nodes.map(normalizeNode),
            nextCursor: decoded.success.nextCursor ?? "",
          });
    }
    case "stat": {
      // GET /api/stat returns the Node unwrapped.
      const decoded = decodeNode(body);
      return Result.isFailure(decoded)
        ? Effect.fail(RESPONSE_DECODE_ERROR)
        : Effect.succeed({ kind: "node", node: normalizeNode(decoded.success) });
    }
    case "table":
    case "query": {
      const decoded = decodeTablePage(body);
      return Result.isFailure(decoded)
        ? Effect.fail(RESPONSE_DECODE_ERROR)
        : Effect.succeed({ kind: "table", page: normalizeTablePage(decoded.success) });
    }
    case "tableCount": {
      const decoded = decodeCountEnvelope(body);
      return Result.isFailure(decoded)
        ? Effect.fail(RESPONSE_DECODE_ERROR)
        : Effect.succeed({ kind: "count", count: decoded.success.count });
    }
    case "search": {
      // GET /api/search answers the same envelope shape as GET /api/tree.
      const decoded = decodeTreeEnvelope(body);
      return Result.isFailure(decoded)
        ? Effect.fail(RESPONSE_DECODE_ERROR)
        : Effect.succeed({
            kind: "search",
            nodes: decoded.success.nodes.map(normalizeNode),
            nextCursor: decoded.success.nextCursor ?? "",
          });
    }
  }
};

const buildUrl = (
  base: string,
  path: string,
  query: Record<string, string> | undefined,
): string => {
  const url = new URL(path, base);
  if (query !== undefined) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
};

export class ZeropsDataConsole extends Context.Service<
  ZeropsDataConsole,
  {
    readonly subscribe: Effect.Effect<
      Stream.Stream<ZeropsDataConsoleSessionEvent>,
      never,
      Scope.Scope
    >;
    readonly call: (
      request: ZeropsDataConsoleRequest,
    ) => Effect.Effect<ZeropsDataConsoleResponse, ZeropsDataConsoleError>;
  }
>()("t3/zerops/ZeropsDataConsole") {}

export const make = (options: { readonly spawnDataConsole: SpawnDataConsole }) =>
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
    const events = yield* PubSub.unbounded<ZeropsDataConsoleSessionEvent>();
    const lastEvent = yield* Ref.make<ZeropsDataConsoleSessionEvent>({ status: "idle" });
    const stateRef = yield* Ref.make<SessionState>({ _tag: "idle" });
    const currentProcessRef = yield* Ref.make<DataConsoleProcess | undefined>(undefined);
    const idleTimerFiberRef = yield* Ref.make<Fiber.Fiber<void, never> | undefined>(undefined);

    const publishStatus = (event: ZeropsDataConsoleSessionEvent) =>
      Effect.gen(function* () {
        yield* Ref.set(lastEvent, event);
        yield* PubSub.publish(events, event);
      });

    const cancelIdleTimer = () =>
      Effect.gen(function* () {
        const fiber = yield* Ref.get(idleTimerFiberRef);
        yield* Ref.set(idleTimerFiberRef, undefined);
        if (fiber !== undefined) {
          yield* Fiber.interrupt(fiber);
        }
      });

    const idleKill = Effect.gen(function* () {
      yield* Effect.sleep(IDLE_TIMEOUT);
      const proc = yield* Ref.get(currentProcessRef);
      if (proc !== undefined) {
        proc.endStdin();
        proc.kill();
      }
    });

    const scheduleIdleTimer = () =>
      Effect.gen(function* () {
        yield* cancelIdleTimer();
        const fiber = yield* Effect.forkDetach(idleKill);
        yield* Ref.set(idleTimerFiberRef, fiber);
      });

    const forgetSession = () =>
      Effect.gen(function* () {
        yield* cancelIdleTimer();
        yield* Ref.set(currentProcessRef, undefined);
        yield* Ref.set(stateRef, { _tag: "idle" });
        yield* publishStatus({ status: "idle" });
      });

    const settleFailed = (
      proc: DataConsoleProcess,
      deferred: Deferred.Deferred<ReadyInfo, ZeropsDataConsoleError>,
      failure: StartupFailure,
    ) =>
      Effect.gen(function* () {
        const error = new ZeropsDataConsoleError({
          code: failure.status === "unsupported" ? "session_unsupported" : "session_unavailable",
          message:
            failure.reason ??
            (failure.status === "unsupported"
              ? "this zcp build does not support the data console"
              : "the data console is unavailable"),
        });
        // `currentProcessRef` was set right after spawn (so the shutdown
        // finalizer can kill a still-starting process) — a startup failure
        // must clear it again, guarded by identity so a respawn that has
        // already raced ahead is never clobbered.
        yield* Ref.modify(currentProcessRef, (current) =>
          current === proc ? [undefined, undefined] : [undefined, current],
        );
        yield* Ref.set(
          stateRef,
          failure.status === "unsupported"
            ? { _tag: "unsupported" }
            : { _tag: "unavailable", reason: failure.reason },
        );
        yield* publishStatus({
          status: failure.status,
          ...(failure.reason !== undefined ? { reason: failure.reason } : {}),
        });
        yield* Deferred.fail(deferred, error);
      });

    const spawnAndSettle = (deferred: Deferred.Deferred<ReadyInfo, ZeropsDataConsoleError>) =>
      Effect.gen(function* () {
        const proc = options.spawnDataConsole();
        // Recorded immediately — even a still-starting process must be
        // reachable by the shutdown finalizer, not only a `ready` one.
        // `settleFailed` clears this again on any startup failure.
        yield* Ref.set(currentProcessRef, proc);
        const queue = yield* Queue.unbounded<ProcEvent>();
        let stdoutBuffer = "";
        let stderrBuffer = "";
        let readyLineOffered = false;

        proc.onStdout((chunk) => {
          if (readyLineOffered) {
            return;
          }
          stdoutBuffer += chunk;
          const newlineIndex = stdoutBuffer.indexOf("\n");
          if (newlineIndex === -1) {
            return;
          }
          readyLineOffered = true;
          Queue.offerUnsafe(queue, {
            _tag: "stdoutLine",
            line: stdoutBuffer.slice(0, newlineIndex),
          });
        });
        proc.onStderr((chunk) => {
          stderrBuffer += chunk;
        });
        proc.onExit((code) => {
          Queue.offerUnsafe(queue, { _tag: "exit", code });
        });
        proc.onError(() => {
          Queue.offerUnsafe(queue, { _tag: "error" });
        });

        const startupEvent = yield* Queue.take(queue).pipe(
          Effect.timeoutOption(READY_LINE_TIMEOUT),
        );

        if (Option.isNone(startupEvent)) {
          proc.kill();
          yield* settleFailed(proc, deferred, {
            status: "unavailable",
            reason: "the data console did not respond in time",
          });
          return;
        }

        const event = startupEvent.value;
        if (event._tag === "error") {
          yield* settleFailed(proc, deferred, {
            status: "unavailable",
            reason: "zcp is not available",
          });
          return;
        }
        if (event._tag === "exit") {
          yield* settleFailed(proc, deferred, classifyStartupFailure(stderrBuffer));
          return;
        }

        const parsed = parseReadyLine(event.line);
        if (parsed === undefined) {
          proc.kill();
          yield* settleFailed(proc, deferred, {
            status: "unavailable",
            reason: "the data console printed an unreadable ready line",
          });
          return;
        }
        if (!isLoopbackReadyUrl(parsed.url)) {
          proc.kill();
          yield* settleFailed(proc, deferred, {
            status: "unavailable",
            reason: "console did not bind loopback",
          });
          return;
        }

        yield* Ref.set(stateRef, { _tag: "ready", info: parsed });
        yield* Ref.set(currentProcessRef, proc);
        yield* publishStatus({ status: "ready", allowWrites: parsed.allowWrites });
        yield* scheduleIdleTimer();
        yield* Deferred.succeed(deferred, parsed);

        // The process may still exit later — idle-killed, crashed, or
        // killed externally. Forget the session so the next call respawns.
        yield* Effect.forkDetach(
          Queue.take(queue).pipe(
            Effect.flatMap(() =>
              Effect.gen(function* () {
                const current = yield* Ref.get(currentProcessRef);
                if (current === proc) {
                  yield* forgetSession();
                }
              }),
            ),
          ),
        );
      });

    const ensureSession: Effect.Effect<ReadyInfo, ZeropsDataConsoleError> = Effect.gen(
      function* () {
        const current = yield* Ref.get(stateRef);
        switch (current._tag) {
          case "ready":
            yield* scheduleIdleTimer();
            return current.info;
          case "starting":
            return yield* Deferred.await(current.deferred);
          case "unsupported":
            return yield* new ZeropsDataConsoleError({
              code: "session_unsupported",
              message: "this zcp build does not support the data console",
            });
          // Unlike `unsupported`, `unavailable` is not permanent — the
          // console may have failed because a managed service was still
          // booting. The subscription keeps showing the last-published
          // `unavailable` status (with its reason) right up until THIS call
          // — the next one after the failure — attempts a fresh spawn, same
          // as a first call from `idle`.
          case "unavailable":
          case "idle": {
            const deferred = yield* Deferred.make<ReadyInfo, ZeropsDataConsoleError>();
            const won = yield* Ref.modify(stateRef, (state) =>
              state._tag === "idle" || state._tag === "unavailable"
                ? [true, { _tag: "starting" as const, deferred }]
                : [false, state],
            );
            if (!won) {
              return yield* ensureSession;
            }
            yield* publishStatus({ status: "starting" });
            yield* Effect.forkDetach(spawnAndSettle(deferred));
            return yield* Deferred.await(deferred);
          }
        }
      },
    );

    const executeJson = (
      info: ReadyInfo,
      routed: RoutedRequest,
    ): Effect.Effect<unknown, ZeropsDataConsoleError> =>
      Effect.gen(function* () {
        const url = buildUrl(info.url, routed.path, routed.query);
        const baseRequest = (
          routed.method === "GET" ? HttpClientRequest.get(url) : HttpClientRequest.post(url)
        ).pipe(HttpClientRequest.bearerToken(info.sessionToken));
        const request =
          routed.body !== undefined
            ? HttpClientRequest.bodyJsonUnsafe(routed.body)(baseRequest)
            : baseRequest;
        const response = yield* httpClient.execute(request).pipe(
          Effect.timeout(REQUEST_TIMEOUT),
          Effect.mapError((cause) => toRequestError(cause)),
        );
        if (response.status === 401) {
          return yield* UNAUTHORIZED_ERROR;
        }
        if (response.status < 200 || response.status >= 300) {
          const envelope = yield* readConsoleJson(response).pipe(
            Effect.orElseSucceed(() => undefined),
          );
          return yield* toEnvelopeError(envelope, response.status);
        }
        return yield* readConsoleJson(response);
      });

    const readHeaderBool = (headers: Headers.Headers, name: string): boolean =>
      Headers.get(name)(headers).pipe(
        Option.map((value) => value === "true"),
        Option.getOrElse(() => false),
      );

    const readHeaderNumber = (headers: Headers.Headers, name: string): Option.Option<number> =>
      Headers.get(name)(headers).pipe(
        Option.flatMap((value) => {
          const parsed = Number(value);
          return Number.isFinite(parsed) ? Option.some(parsed) : Option.none();
        }),
      );

    const fetchBlob = (
      info: ReadyInfo,
      request: Extract<ZeropsDataConsoleRequest, { readonly kind: "blob" }>,
    ): Effect.Effect<ZeropsDataConsoleResponse, ZeropsDataConsoleError> =>
      Effect.gen(function* () {
        const url = buildUrl(info.url, "/api/blob", {
          service: request.path.service,
          segs: encodeSegments(request.path.segments),
        });
        const httpRequest = HttpClientRequest.get(url).pipe(
          HttpClientRequest.bearerToken(info.sessionToken),
        );
        const response = yield* httpClient.execute(httpRequest).pipe(
          Effect.timeout(REQUEST_TIMEOUT),
          Effect.mapError((cause) => toRequestError(cause)),
        );
        if (response.status === 401) {
          return yield* UNAUTHORIZED_ERROR;
        }
        if (response.status < 200 || response.status >= 300) {
          const envelope = yield* readConsoleJson(response).pipe(
            Effect.orElseSucceed(() => undefined),
          );
          return yield* toEnvelopeError(envelope, response.status);
        }
        const bytes = yield* response.arrayBuffer.pipe(
          Effect.mapError(
            () =>
              new ZeropsDataConsoleError({
                code: "internal",
                message: "console returned an unreadable blob",
              }),
          ),
        );
        const uint8 = new Uint8Array(bytes);
        const capped = uint8.byteLength > BLOB_CAP_BYTES;
        const cappedBytes = capped ? uint8.subarray(0, BLOB_CAP_BYTES) : uint8;
        const declaredTruncated = readHeaderBool(response.headers, "x-dataconsole-truncated");
        const size = readHeaderNumber(response.headers, "x-dataconsole-size").pipe(
          Option.getOrElse(() => uint8.byteLength),
        );
        const contentType = Headers.get("x-dataconsole-contenttype")(response.headers).pipe(
          Option.getOrElse(() => "application/octet-stream"),
        );
        const ttlSeconds = readHeaderNumber(response.headers, "x-dataconsole-ttl-seconds");
        return {
          kind: "blob",
          data: Encoding.encodeBase64(cappedBytes),
          contentType,
          truncated: declaredTruncated || capped,
          size,
          vector: readHeaderBool(response.headers, "x-dataconsole-vector"),
          streamMetadata: readHeaderBool(response.headers, "x-dataconsole-streammetadata"),
          ...(Option.isSome(ttlSeconds) ? { ttlSeconds: ttlSeconds.value } : {}),
        };
      });

    const performRequest = (
      info: ReadyInfo,
      request: ZeropsDataConsoleRequest,
    ): Effect.Effect<ZeropsDataConsoleResponse, ZeropsDataConsoleError> => {
      if (request.kind === "blob") {
        return fetchBlob(info, request);
      }
      if (request.kind === "refresh") {
        return Effect.gen(function* () {
          yield* executeJson(info, { method: "POST", path: "/api/refresh" });
          const body = yield* executeJson(info, { method: "GET", path: "/api/services" });
          return yield* decodeResponseBody("services", body);
        });
      }
      const routed = routeRequest(request);
      return executeJson(info, routed).pipe(
        Effect.flatMap((body) => decodeResponseBody(request.kind, body)),
      );
    };

    const call = (
      request: ZeropsDataConsoleRequest,
    ): Effect.Effect<ZeropsDataConsoleResponse, ZeropsDataConsoleError> =>
      Effect.gen(function* () {
        const info = yield* ensureSession;
        return yield* performRequest(info, request);
      });

    const subscribe: Effect.Effect<
      Stream.Stream<ZeropsDataConsoleSessionEvent>,
      never,
      Scope.Scope
    > = Effect.gen(function* () {
      const subscription = yield* PubSub.subscribe(events);
      const initial = yield* Ref.get(lastEvent);
      return Stream.concat(Stream.make(initial), Stream.fromSubscription(subscription));
    });

    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        yield* cancelIdleTimer();
        const proc = yield* Ref.get(currentProcessRef);
        if (proc !== undefined) {
          proc.endStdin();
          proc.kill();
        }
      }),
    );

    return { subscribe, call } satisfies ZeropsDataConsole["Service"];
  });

export const layer = Layer.effect(
  ZeropsDataConsole,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    return yield* make({ spawnDataConsole: makeRealSpawn(ZCP_COMMAND, [], config.cwd) });
  }),
).pipe(Layer.provide(FetchHttpClient.layer));
