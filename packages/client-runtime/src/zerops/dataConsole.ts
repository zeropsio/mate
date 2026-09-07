/**
 * Pure client-side model for the Data console panel (S-dataconsole slice 1,
 * read-only): the session fold, the lazy tree model, the table page model,
 * cell formatting, blob-preview classification and service-affordance
 * resolution. UI-free and platform-free (client-runtime R1): no DOM, no RPC
 * client, no React.
 *
 * See `dataconsole-api.md` §3 (route/response shapes this mirrors) and
 * `../../../../zcp/docs/spec-mate.md` §5 "Data surface".
 */
import type {
  ZeropsDataConsoleBlob,
  ZeropsDataConsoleColumn,
  ZeropsDataConsoleError,
  ZeropsDataConsoleNode,
  ZeropsDataConsolePage,
  ZeropsDataConsolePath,
  ZeropsDataConsoleService,
  ZeropsDataConsoleSessionEvent,
  ZeropsDataConsoleStatus,
  ZeropsDataConsoleTablePage,
} from "@t3tools/contracts";

// ---------------------------------------------------------------------------
// Session fold
// ---------------------------------------------------------------------------

/** `allowWrites` rides on the wire event (`ZeropsDataConsoleSessionEvent`) but isn't folded here — nothing in this read-only slice reads it; slice 2 (writes) adds it back to the state when something needs it. */
export interface ZeropsDataConsoleSessionState {
  readonly status: ZeropsDataConsoleStatus;
  readonly reason?: string;
}

export const INITIAL_DATA_CONSOLE_STATE: ZeropsDataConsoleSessionState = {
  status: "idle",
};

/** Pure fold: `(state, next session event) → state`. The server's own first emission on subscribe re-seeds `status`, so a reconnect never has to be special-cased here. */
export function foldDataConsoleSessionEvent(
  state: ZeropsDataConsoleSessionState,
  event: ZeropsDataConsoleSessionEvent,
): ZeropsDataConsoleSessionState {
  return {
    status: event.status,
    ...(event.reason !== undefined ? { reason: event.reason } : {}),
  };
}

// ---------------------------------------------------------------------------
// Tree model
// ---------------------------------------------------------------------------

/** Stable key for a tree path. `JSON.stringify` (not a delimiter-joined string) so a service or segment that itself contains the delimiter can never collide with a different path. */
export function treePathKey(path: ZeropsDataConsolePath): string {
  return JSON.stringify([path.service, ...path.segments]);
}

export interface DataConsoleTreeEntry {
  readonly path: ZeropsDataConsolePath;
  readonly nodes: ReadonlyArray<ZeropsDataConsoleNode>;
  readonly nextCursor?: string;
  readonly expanded: boolean;
  /** False for an entry that only records expand/collapse intent (or a failed fetch) — no page has landed for this path yet. See {@link isNodeUnloaded}. */
  readonly loaded: boolean;
}

/** Keyed by `treePathKey`. A path with no entry, or an entry with `loaded: false`, is unloaded (see {@link isNodeUnloaded}). */
export interface DataConsoleTree {
  readonly entries: Readonly<Record<string, DataConsoleTreeEntry>>;
}

export const emptyTree: DataConsoleTree = { entries: {} };

/**
 * Merges a fetched page of nodes into the tree under `path`, marking the
 * entry loaded. Appends onto the existing node list only when `requestCursor`
 * is given and equals the existing entry's own `nextCursor` (the page that
 * was actually asked for); any other case — a fresh load, a mismatched or
 * stale cursor, a first page — replaces the node list instead, so a request
 * racing an unrelated fetch never silently concatenates onto the wrong list.
 */
export function applyTreePage(
  tree: DataConsoleTree,
  path: ZeropsDataConsolePath,
  page: { readonly nodes: ReadonlyArray<ZeropsDataConsoleNode>; readonly nextCursor: string },
  requestCursor?: string,
): DataConsoleTree {
  const key = treePathKey(path);
  const existing = tree.entries[key];
  const isAppend =
    requestCursor !== undefined && existing !== undefined && requestCursor === existing.nextCursor;
  const nodes = isAppend ? [...existing.nodes, ...page.nodes] : page.nodes;
  return {
    entries: {
      ...tree.entries,
      [key]: {
        path,
        nodes,
        ...(page.nextCursor !== "" ? { nextCursor: page.nextCursor } : {}),
        expanded: existing?.expanded ?? true,
        loaded: true,
      },
    },
  };
}

export function expandTreePath(
  tree: DataConsoleTree,
  path: ZeropsDataConsolePath,
): DataConsoleTree {
  return setTreePathExpanded(tree, path, true);
}

export function collapseTreePath(
  tree: DataConsoleTree,
  path: ZeropsDataConsolePath,
): DataConsoleTree {
  return setTreePathExpanded(tree, path, false);
}

function setTreePathExpanded(
  tree: DataConsoleTree,
  path: ZeropsDataConsolePath,
  expanded: boolean,
): DataConsoleTree {
  const key = treePathKey(path);
  const existing = tree.entries[key];
  if (existing === undefined) {
    // Nothing loaded yet under this path: record the intent (still
    // unloaded) so a later `applyTreePage` for it starts already
    // expanded/collapsed, and so an expand of a never-fetched path stays
    // `isNodeUnloaded` (a re-expand after a failed fetch refetches).
    return { entries: { ...tree.entries, [key]: { path, nodes: [], expanded, loaded: false } } };
  }
  if (existing.expanded === expanded) return tree;
  return { entries: { ...tree.entries, [key]: { ...existing, expanded } } };
}

/** A node with declared children whose own path has no loaded page yet — collapsed-and-never-fetched, expanded-but-still-loading, or a failed fetch all count, so a re-expand refetches. */
export function isNodeUnloaded(tree: DataConsoleTree, node: ZeropsDataConsoleNode): boolean {
  if (!node.hasChildren) return false;
  const entry = tree.entries[treePathKey(node.path)];
  return entry === undefined || !entry.loaded;
}

// ---------------------------------------------------------------------------
// Table model
// ---------------------------------------------------------------------------

export interface DataConsoleTableModel {
  readonly columns: ReadonlyArray<ZeropsDataConsoleColumn>;
  readonly rows: ReadonlyArray<ReadonlyArray<unknown>>;
  readonly nextCursor?: string;
  readonly rowKeyCols: ReadonlyArray<string>;
  readonly bestEffort: boolean;
  readonly numbered: boolean;
}

export const emptyTable: DataConsoleTableModel = {
  columns: [],
  rows: [],
  rowKeyCols: [],
  bestEffort: false,
  numbered: false,
};

/**
 * Applies a fetched `ZeropsDataConsoleTablePage`. Rows are appended onto the
 * existing model only when `requestCursor` is given and equals the current
 * model's own `nextCursor` (the page that was actually asked for, scrolling
 * further into the same query/table); any other case — a fresh query, a
 * mismatched or stale cursor — replaces the rows instead, so a request
 * racing an unrelated fetch never concatenates onto the wrong table.
 * columns/rowKeyCols/bestEffort/numbered always take the new page's values
 * (a fresh query can change all of them, even while appending).
 */
export function applyTablePage(
  model: DataConsoleTableModel,
  page: ZeropsDataConsoleTablePage,
  requestCursor?: string,
): DataConsoleTableModel {
  const isAppend = requestCursor !== undefined && requestCursor === model.nextCursor;
  return {
    columns: page.columns,
    rows: isAppend ? [...model.rows, ...page.rows] : page.rows,
    ...(page.nextCursor !== "" ? { nextCursor: page.nextCursor } : {}),
    rowKeyCols: page.rowKeyCols,
    bestEffort: page.bestEffort,
    numbered: page.numbered,
  };
}

export type SortDirection = "asc" | "desc";

/** Builds the `page` request fields for a sort-by-column request, honoring the column's `sortable` flag. Returns `undefined` (no sort applied) when the column isn't sortable — callers should also surface `sortReason` to the user via that case. */
export function buildSortPage(
  column: ZeropsDataConsoleColumn,
  direction: SortDirection,
  base: ZeropsDataConsolePage = {},
): ZeropsDataConsolePage | undefined {
  if (!column.sortable) return undefined;
  return { ...base, sort: column.name, direction };
}

// ---------------------------------------------------------------------------
// Cell formatting
// ---------------------------------------------------------------------------

const BYTES_DATA_TYPES = new Set(["bytea", "blob", "bytes", "binary"]);

/** Formats one table cell value for display. `column` disambiguates a base64 string (bytes-like `dataType`) from an ordinary string; a JSON big-integer that already arrived as a string (the server sends exact decimals, see `dataconsole-api.md` §3) is passed through verbatim rather than re-parsed, so precision is never lost round-tripping through `Number`. */
export function formatCell(
  value: unknown,
  column: Pick<ZeropsDataConsoleColumn, "dataType">,
): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") {
    if (BYTES_DATA_TYPES.has(column.dataType)) {
      const byteLength = base64ByteLength(value);
      return `<${byteLength} bytes>`;
    }
    return value;
  }
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function base64ByteLength(base64: string): number {
  const clean = base64.replace(/[\r\n]/g, "");
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  return Math.floor((clean.length * 3) / 4) - padding;
}

// ---------------------------------------------------------------------------
// Blob preview
// ---------------------------------------------------------------------------

const MAX_TEXT_PREVIEW_BYTES = 256 * 1024;
const TEXT_PREVIEW_CONTENT_TYPES = [/^text\//, /^application\/json$/, /^application\/xml$/];

export type DataConsoleBlobPreview =
  | {
      readonly kind: "text";
      readonly text: string;
      readonly truncated: boolean;
      readonly size: number;
    }
  | { readonly kind: "vector"; readonly truncated: boolean; readonly size: number }
  | { readonly kind: "streamMetadata"; readonly truncated: boolean; readonly size: number }
  | {
      readonly kind: "binary";
      readonly contentType: string;
      readonly truncated: boolean;
      readonly size: number;
    }
  | { readonly kind: "tooLargeForPreview"; readonly contentType: string; readonly size: number };

/** Classifies a fetched blob for the panel to render. Precedence: vector/streamMetadata flags first (they describe *what the bytes mean*, independent of MIME), then content-type-based text decoding (capped, never for an already-truncated body larger than the cap), else binary. */
export function resolveBlobPreview(blob: ZeropsDataConsoleBlob): DataConsoleBlobPreview {
  if (blob.vector) return { kind: "vector", truncated: blob.truncated, size: blob.size };
  if (blob.streamMetadata) {
    return { kind: "streamMetadata", truncated: blob.truncated, size: blob.size };
  }
  const isTextType = TEXT_PREVIEW_CONTENT_TYPES.some((re) => re.test(blob.contentType));
  if (isTextType) {
    const byteLength = base64ByteLength(blob.data);
    if (byteLength > MAX_TEXT_PREVIEW_BYTES) {
      return { kind: "tooLargeForPreview", contentType: blob.contentType, size: blob.size };
    }
    const text = decodeBase64Text(blob.data);
    if (text !== undefined) {
      return { kind: "text", text, truncated: blob.truncated, size: blob.size };
    }
    // Malformed base64 or invalid UTF-8 under a text-ish content type: never
    // throw out of a pure model function — fall back to the binary preview.
  }
  return {
    kind: "binary",
    contentType: blob.contentType,
    truncated: blob.truncated,
    size: blob.size,
  };
}

/** `undefined` on malformed input (invalid base64, or bytes that aren't valid UTF-8 under `fatal: true`) rather than throwing or silently substituting U+FFFD. */
function decodeBase64Text(base64: string): string | undefined {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Service affordances
// ---------------------------------------------------------------------------

export interface DataConsoleServiceAffordances {
  readonly canBrowse: boolean;
  readonly canQuery: boolean;
  readonly canReadTable: boolean;
  readonly vpnGateReason?: string;
}

/** Read-only affordances derived strictly from `service.actions` (never `family`/`support` — those are informational per `dataconsole-api.md` §3). `showVPNGate` is always informational when present, never an affordance gate itself. */
export function resolveServiceAffordances(
  service: Pick<ZeropsDataConsoleService, "actions">,
): DataConsoleServiceAffordances {
  const byId = new Map(service.actions.map((action) => [action.id, action]));
  const canBrowse =
    byId.get("readTable")?.enabled === true || byId.get("readBlob")?.enabled === true;
  const canQuery = byId.get("querySQL")?.enabled === true;
  const canReadTable = byId.get("readTable")?.enabled === true;
  const vpnGateReason = byId.get("showVPNGate")?.reason;
  return {
    canBrowse,
    canQuery,
    canReadTable,
    ...(vpnGateReason ? { vpnGateReason } : {}),
  };
}

// ---------------------------------------------------------------------------
// Error copy
// ---------------------------------------------------------------------------

/** One short, user-facing sentence per `ZeropsDataConsoleError.code` (`dataconsole-api.md` §3 sentinel table). Never echoes `message`/`requestId` — those are for logs, not the panel. */
export function describeDataConsoleError(err: Pick<ZeropsDataConsoleError, "code">): string {
  switch (err.code) {
    case "not_found":
      return "That item isn't there anymore.";
    case "read_only":
      return "This is read-only right now.";
    case "needs_confirm":
      return "Confirm the action to continue.";
    case "conflict":
      return "Someone else changed this first. Reload and try again.";
    case "wrong_type":
      return "That action doesn't apply to this kind of item.";
    case "too_large":
      return "That's too large to load here.";
    case "unsupported":
      return "This service doesn't support that action.";
    case "unreachable":
      return "Couldn't reach the service. Check that it's running.";
    case "upstream":
      return "The service returned an error.";
    case "invalid":
      return "That request wasn't valid.";
    case "timeout":
      return "The request timed out.";
    case "session_unavailable":
      return "Data isn't available right now.";
    case "session_unsupported":
      return "This project doesn't support Data yet.";
    case "internal":
    default:
      return "Something went wrong.";
  }
}

// ---------------------------------------------------------------------------
// Filters → read-only SQL
// ---------------------------------------------------------------------------

export type DataConsoleFilterOp =
  | "eq"
  | "neq"
  | "lt"
  | "lte"
  | "gt"
  | "gte"
  | "contains"
  | "startsWith"
  | "isNull"
  | "notNull";

/** `value` is absent for `isNull`/`notNull` — those ops carry no operand. */
export interface DataConsoleFilter {
  readonly column: string;
  readonly op: DataConsoleFilterOp;
  readonly value?: string;
}

export type DataConsoleSqlDialect = "postgresql" | "mysql";

/** Maps a service `type` to the SQL dialect its console query builder should speak. `undefined` for anything not a Postgres/MySQL-family engine — no filtered-table query builder applies there (e.g. object storage, KV, Mongo). */
export function resolveSqlDialect(serviceType: string): DataConsoleSqlDialect | undefined {
  if (serviceType.startsWith("postgresql")) return "postgresql";
  if (serviceType.startsWith("mariadb") || serviceType.startsWith("mysql")) return "mysql";
  return undefined;
}

function quoteIdentifier(name: string, dialect: DataConsoleSqlDialect): string {
  const quote = dialect === "mysql" ? "`" : '"';
  return quote + name.split(quote).join(quote + quote) + quote;
}

function qualifiedTableName(path: ZeropsDataConsolePath, dialect: DataConsoleSqlDialect): string {
  return path.segments.map((segment) => quoteIdentifier(segment, dialect)).join(".");
}

/** A quoted literal: `'` doubled everywhere; `\` doubled for MySQL, whose literals treat a backslash as an escape by default (PostgreSQL's standard-conforming strings do not). */
function sqlStringLiteral(value: string, dialect: DataConsoleSqlDialect): string {
  const body = dialect === "mysql" ? value.split("\\").join("\\\\") : value;
  return `'${body.split("'").join("''")}'`;
}

/** Escapes `%`, `_` and `!` in a LIKE operand and pairs it with `ESCAPE '!'` — a non-backslash escape character reads the same in both dialects, so a literal wildcard in a `contains`/`startsWith` filter value never behaves as a wildcard and no backslash rule gets in the way. */
function likeLiteral(
  value: string,
  dialect: DataConsoleSqlDialect,
  pattern: (escaped: string) => string,
): string {
  const escaped = value.replace(/[!%_]/g, (ch) => `!${ch}`);
  return `${sqlStringLiteral(pattern(escaped), dialect)} ESCAPE '!'`;
}

const COMPARISON_OPERATORS: Partial<Record<DataConsoleFilterOp, string>> = {
  eq: "=",
  neq: "<>",
  lt: "<",
  lte: "<=",
  gt: ">",
  gte: ">=",
};

function filterClause(filter: DataConsoleFilter, dialect: DataConsoleSqlDialect): string {
  const column = quoteIdentifier(filter.column, dialect);
  switch (filter.op) {
    case "isNull":
      return `${column} IS NULL`;
    case "notNull":
      return `${column} IS NOT NULL`;
    case "contains":
      return `${column} LIKE ${likeLiteral(filter.value ?? "", dialect, (v) => `%${v}%`)}`;
    case "startsWith":
      return `${column} LIKE ${likeLiteral(filter.value ?? "", dialect, (v) => `${v}%`)}`;
    default: {
      const operator = COMPARISON_OPERATORS[filter.op];
      return `${column} ${operator} ${sqlStringLiteral(filter.value ?? "", dialect)}`;
    }
  }
}

/** `true` when the query would carry a `WHERE` clause — either a structured filter or non-empty raw SQL — used to gate "clear filters" UI. */
export function hasActiveFilters(
  filters: ReadonlyArray<DataConsoleFilter>,
  rawWhere?: string,
): boolean {
  return filters.length > 0 || (rawWhere?.trim().length ?? 0) > 0;
}

/**
 * Builds a read-only `SELECT * FROM … WHERE … ORDER BY … LIMIT n` statement
 * for the table filter panel. Structured filters are ANDed together;
 * `rawWhere` — the user's own SQL escape hatch — is appended as a further
 * `AND (rawWhere)` clause verbatim (trimmed only to test for emptiness),
 * never parsed or rewritten. No trailing semicolon: the console appends its
 * own statement terminator.
 */
export function buildFilteredTableStatement(input: {
  readonly dialect: DataConsoleSqlDialect;
  readonly path: ZeropsDataConsolePath;
  readonly filters: ReadonlyArray<DataConsoleFilter>;
  readonly rawWhere?: string;
  readonly sort?: { readonly column: string; readonly direction: "asc" | "desc" };
  readonly limit: number;
}): string {
  const { dialect, path, filters, rawWhere, sort, limit } = input;
  const clauses = filters.map((filter) => filterClause(filter, dialect));
  const trimmedRaw = rawWhere?.trim();
  if (trimmedRaw) clauses.push(`(${trimmedRaw})`);

  const parts = [`SELECT * FROM ${qualifiedTableName(path, dialect)}`];
  if (clauses.length > 0) parts.push(`WHERE ${clauses.join(" AND ")}`);
  if (sort) {
    parts.push(`ORDER BY ${quoteIdentifier(sort.column, dialect)} ${sort.direction.toUpperCase()}`);
  }
  parts.push(`LIMIT ${limit}`);
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Column visibility
// ---------------------------------------------------------------------------

/** Filters `columns` down to the visible set, in original order. A primary-key column is never hidden — a `hidden` set naming one is silently ignored for it — so the row's identity is always on screen. */
export function visibleColumns(
  columns: ReadonlyArray<ZeropsDataConsoleColumn>,
  hidden: ReadonlySet<string>,
): ZeropsDataConsoleColumn[] {
  return columns.filter((column) => column.pk || !hidden.has(column.name));
}

/** Toggles one column name in/out of the hidden set, returning a new set. */
export function toggleHiddenColumn(hidden: ReadonlySet<string>, name: string): ReadonlySet<string> {
  const next = new Set(hidden);
  if (next.has(name)) next.delete(name);
  else next.add(name);
  return next;
}

// ---------------------------------------------------------------------------
// Cell detail
// ---------------------------------------------------------------------------

export interface DataConsoleCellDetail {
  readonly kind: "null" | "boolean" | "number" | "text" | "json" | "binary";
  readonly detail: string;
  readonly oneLine: string;
  readonly hasMore: boolean;
}

const TEXT_PREVIEW_LIMIT = 120;

function truncateOneLine(text: string): { readonly oneLine: string; readonly hasMore: boolean } {
  if (text.length <= TEXT_PREVIEW_LIMIT) return { oneLine: text, hasMore: false };
  return { oneLine: `${text.slice(0, TEXT_PREVIEW_LIMIT)}…`, hasMore: true };
}

function tryParseJsonContainer(text: string): unknown {
  const trimmed = text.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return undefined;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return typeof parsed === "object" && parsed !== null ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Classifies one cell value for the row-detail expander. Distinct from
 * {@link formatCell} (which renders a table cell inline): this always looks
 * at the raw JSON value, never the column's `dataType`, so it also handles
 * an already-decoded object/array or a big-int string arriving from a
 * `describeCell` call site that never had column context. A `Uint8Array`/
 * `ArrayBuffer` is the only `binary` case — the console's own wire format
 * always base64-encodes bytes, so a raw byte buffer only ever reaches this
 * function from client-side reconstruction, not directly off the wire.
 */
export function describeCell(value: unknown): DataConsoleCellDetail {
  if (value === null || value === undefined) {
    return { kind: "null", detail: "NULL", oneLine: "NULL", hasMore: false };
  }
  if (typeof value === "boolean") {
    const text = value ? "true" : "false";
    return { kind: "boolean", detail: text, oneLine: text, hasMore: false };
  }
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
    const text = `<${value.byteLength} bytes>`;
    return { kind: "binary", detail: text, oneLine: text, hasMore: false };
  }
  if (typeof value === "object") {
    const detail = JSON.stringify(value, null, 2);
    const oneLine = JSON.stringify(value);
    return { kind: "json", detail, oneLine: truncateOneLine(oneLine).oneLine, hasMore: false };
  }
  if (typeof value === "number") {
    const text = String(value);
    return { kind: "number", detail: text, oneLine: text, hasMore: false };
  }
  if (typeof value === "string") {
    if (/^-?\d+$/.test(value)) {
      return { kind: "number", detail: value, oneLine: value, hasMore: false };
    }
    const parsedJson = tryParseJsonContainer(value);
    if (parsedJson !== undefined) {
      const detail = JSON.stringify(parsedJson, null, 2);
      const oneLine = JSON.stringify(parsedJson);
      return { kind: "json", detail, oneLine: truncateOneLine(oneLine).oneLine, hasMore: false };
    }
    if (value.length > TEXT_PREVIEW_LIMIT || value.includes("\n")) {
      const { oneLine } = truncateOneLine(value);
      return { kind: "text", detail: value, oneLine, hasMore: true };
    }
    return { kind: "text", detail: value, oneLine: value, hasMore: false };
  }
  const text = String(value);
  return { kind: "text", detail: text, oneLine: text, hasMore: false };
}

// ---------------------------------------------------------------------------
// Row helpers
// ---------------------------------------------------------------------------

/** Zips `columns`/`row` into a plain record, primary-key columns first (so the identity fields lead a JSON dump or a key/value listing). */
export function rowRecord(
  columns: ReadonlyArray<ZeropsDataConsoleColumn>,
  row: ReadonlyArray<unknown>,
): Record<string, unknown> {
  const indexed = columns.map((column, index) => ({ column, value: row[index] }));
  const ordered = [...indexed].sort((a, b) => Number(b.column.pk) - Number(a.column.pk));
  const record: Record<string, unknown> = {};
  for (const { column, value } of ordered) record[column.name] = value;
  return record;
}

/** Pretty-printed (2-space) JSON of {@link rowRecord} — the payload behind "copy row as JSON" and the context hand-off. */
export function rowAsJson(
  columns: ReadonlyArray<ZeropsDataConsoleColumn>,
  row: ReadonlyArray<unknown>,
): string {
  return JSON.stringify(rowRecord(columns, row), null, 2);
}

// ---------------------------------------------------------------------------
// Context hand-off text
// ---------------------------------------------------------------------------

function tablePathLabel(path: ZeropsDataConsolePath): string {
  return path.segments.join(".");
}

/** Finds the first primary-key column and its value in `row`, for a row label/heading. `undefined` when the table has no declared primary key. */
function firstPrimaryKey(
  columns: ReadonlyArray<ZeropsDataConsoleColumn>,
  row: ReadonlyArray<unknown>,
): { readonly name: string; readonly value: unknown } | undefined {
  const index = columns.findIndex((column) => column.pk);
  if (index === -1) return undefined;
  return { name: columns[index]!.name, value: row[index] };
}

/**
 * Builds the markdown hand-off block a "send to composer" action attaches
 * for an entire table: a heading naming the service/type/path, one line per
 * column (data type, `(pk)` where applicable), and — when the caller has it
 * — an approximate row count. Vocabulary follows the design-system glossary
 * (`project`, never `environment`).
 */
export function describeTableContext(input: {
  readonly service: ZeropsDataConsoleService;
  readonly path: ZeropsDataConsolePath;
  readonly columns: ReadonlyArray<ZeropsDataConsoleColumn>;
  readonly approxRowCount?: number;
}): { readonly label: string; readonly text: string } {
  const { service, path, columns, approxRowCount } = input;
  const tableLabel = tablePathLabel(path);
  const label = `${path.service} · ${tableLabel}`;
  const lines = [
    `## ${service.hostname} (${service.type}) · ${tableLabel}`,
    ...columns.map((column) => `- ${column.name}: ${column.dataType}${column.pk ? " (pk)" : ""}`),
  ];
  if (approxRowCount !== undefined) lines.push(`~${approxRowCount} rows`);
  return { label, text: lines.join("\n") };
}

/**
 * Builds the markdown hand-off block for a single row: a heading naming the
 * service/type/path/primary-key, then the row as a fenced JSON block (via
 * {@link rowAsJson}).
 */
export function describeRowContext(input: {
  readonly service: ZeropsDataConsoleService;
  readonly path: ZeropsDataConsolePath;
  readonly columns: ReadonlyArray<ZeropsDataConsoleColumn>;
  readonly row: ReadonlyArray<unknown>;
}): { readonly label: string; readonly text: string } {
  const { service, path, columns, row } = input;
  const tableLabel = tablePathLabel(path);
  const pk = firstPrimaryKey(columns, row);
  const rowLabel = pk ? `${pk.name}=${String(pk.value)}` : "row";
  const label = `${path.service} · ${tableLabel} · ${rowLabel}`;
  const lines = [
    `## ${service.hostname} (${service.type}) · ${tableLabel} · ${rowLabel}`,
    "```json",
    rowAsJson(columns, row),
    "```",
  ];
  return { label, text: lines.join("\n") };
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

const WIDE_LAYOUT_MIN_WIDTH = 720;

/**
 * `wide` once the container can hold the tree rail, the grid and the detail
 * drawer side by side (≥ 720px); below that, the panel shows one zone at a
 * time (`narrow`) rather than cramming three columns into too little space.
 */
export function resolveDataLayout(containerWidth: number): "narrow" | "wide" {
  return containerWidth >= WIDE_LAYOUT_MIN_WIDTH ? "wide" : "narrow";
}

// ---------------------------------------------------------------------------
// Breadcrumbs
// ---------------------------------------------------------------------------

/** One breadcrumb per path prefix, starting at the service root (no segments) through the full path. */
export function breadcrumbsFor(
  path: ZeropsDataConsolePath,
): ReadonlyArray<{ readonly label: string; readonly path: ZeropsDataConsolePath }> {
  const crumbs: Array<{ readonly label: string; readonly path: ZeropsDataConsolePath }> = [
    { label: path.service, path: { service: path.service, segments: [] } },
  ];
  for (let i = 0; i < path.segments.length; i++) {
    crumbs.push({
      label: path.segments[i]!,
      path: { service: path.service, segments: path.segments.slice(0, i + 1) },
    });
  }
  return crumbs;
}
