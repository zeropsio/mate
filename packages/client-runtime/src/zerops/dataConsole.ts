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

import type { ZeropsTopologyService } from "./topology.ts";

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
 * The merged list is ordered by {@link sortNodes}, not left in the order the
 * console answered in.
 */
/**
 * Orders a level's children by name, numeric-aware. Key/document families
 * answer in SCAN order (measured: `37, 7, 40, 20, 10`) and the console
 * ignores `sort` for them, so the order has to be imposed here; a tabular
 * family already answers sorted, where this is a no-op. Applied to the whole
 * merged list on every append, so a later page interleaves rather than
 * trailing behind.
 */
function sortNodes(
  nodes: ReadonlyArray<ZeropsDataConsoleNode>,
): ReadonlyArray<ZeropsDataConsoleNode> {
  return [...nodes].sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" }),
  );
}

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
  const nodes = sortNodes(isAppend ? [...existing.nodes, ...page.nodes] : page.nodes);
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

/**
 * The chain of container segments a service's tree collapses away, read from
 * the root down.
 *
 * A level collapses when its loaded page holds exactly one node, that node is
 * a container with children, and no cursor promises more: the container then
 * carries no information the level above did not already give, so the panel
 * shows its children in its place. `public` on a single-schema database is
 * the case that motivated it, but the rule is family-blind. Two nodes at a
 * level, or a cursor, and nothing below that level collapses either.
 */
export function collapsedPrefix(tree: DataConsoleTree, service: string): ReadonlyArray<string> {
  const prefix: string[] = [];
  for (;;) {
    const entry = tree.entries[treePathKey({ service, segments: prefix })];
    if (entry === undefined || !entry.loaded) return prefix;
    if (entry.nodes.length !== 1 || entry.nextCursor !== undefined) return prefix;
    const only = entry.nodes[0]!;
    if (only.kind !== "container" || !only.hasChildren) return prefix;
    const segment = only.path.segments[only.path.segments.length - 1];
    if (segment === undefined || only.path.segments.length !== prefix.length + 1) return prefix;
    prefix.push(segment);
  }
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

/** One picker row: a console service, joined to the platform topology's matching service by hostname when there is one. */
export interface DataConsoleServiceRow {
  readonly service: ZeropsDataConsoleService;
  readonly topologyService: ZeropsTopologyService | undefined;
}

/**
 * Orders the console's service list the way the platform topology orders
 * its own services, so the Data picker reads the same as the service map.
 * A console service with no topology match (the topology view has not
 * loaded yet, or the service isn't one the topology knows about) sorts
 * after every matched row, in its original console order, and carries no
 * `topologyService` — the picker renders it without a status chip.
 * `topologyServices === undefined` (the topology view hasn't loaded) leaves
 * the console's own order untouched.
 */
export function joinServicesWithTopology(
  services: ReadonlyArray<ZeropsDataConsoleService>,
  topologyServices: ReadonlyArray<ZeropsTopologyService> | undefined,
): ReadonlyArray<DataConsoleServiceRow> {
  if (topologyServices === undefined) {
    return services.map((service) => ({ service, topologyService: undefined }));
  }
  const byHostname = new Map(services.map((service) => [service.hostname, service]));
  const matchedHostnames = new Set<string>();
  const rows: DataConsoleServiceRow[] = [];
  for (const topologyService of topologyServices) {
    const service = byHostname.get(topologyService.hostname);
    if (service === undefined) continue;
    matchedHostnames.add(topologyService.hostname);
    rows.push({ service, topologyService });
  }
  for (const service of services) {
    if (matchedHostnames.has(service.hostname)) continue;
    rows.push({ service, topologyService: undefined });
  }
  return rows;
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

/** A filter draft: the chips plus the raw `WHERE` escape hatch, as the filter bar holds them. */
export interface DataConsoleFilterDraft {
  readonly filters: ReadonlyArray<DataConsoleFilter>;
  readonly rawWhere: string;
}

/**
 * Whether a filter draft still differs from what was last applied — the one
 * condition under which the filter bar offers `Apply` at all. Chips compare in
 * order by column, operator and operand, where an absent operand
 * (`isNull`/`notNull`) and an empty one are the same thing; `rawWhere`
 * compares trimmed, because the statement builder trims it too.
 */
export function filtersDirty(
  draft: DataConsoleFilterDraft,
  applied: DataConsoleFilterDraft,
): boolean {
  if (draft.rawWhere.trim() !== applied.rawWhere.trim()) return true;
  if (draft.filters.length !== applied.filters.length) return true;
  return draft.filters.some((filter, index) => {
    const other = applied.filters[index]!;
    return (
      filter.column !== other.column ||
      filter.op !== other.op ||
      (filter.value ?? "") !== (other.value ?? "")
    );
  });
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
  readonly service: Pick<ZeropsDataConsoleService, "hostname" | "type">;
  readonly path: ZeropsDataConsolePath;
  readonly columns: ReadonlyArray<ZeropsDataConsoleColumn>;
  readonly approxRowCount?: number;
  readonly collapsedPrefix?: ReadonlyArray<string>;
}): { readonly label: string; readonly text: string } {
  const { service, path, columns, approxRowCount, collapsedPrefix: collapsed } = input;
  const tableLabel = tablePathLabel(path);
  // The chip reads the way the tree does; the heading keeps the full path so
  // the agent knows which schema the table lives in.
  const label = `${path.service} · ${visibleSegments(path.segments, collapsed).join(".")}`;
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
  readonly collapsedPrefix?: ReadonlyArray<string>;
}): { readonly label: string; readonly text: string } {
  const { service, path, columns, row, collapsedPrefix: collapsed } = input;
  const tableLabel = tablePathLabel(path);
  const pk = firstPrimaryKey(columns, row);
  const rowLabel = pk ? `${pk.name}=${String(pk.value)}` : "row";
  const label = `${path.service} · ${visibleSegments(path.segments, collapsed).join(".")} · ${rowLabel}`;
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

/**
 * One breadcrumb per path prefix, starting at the service root (no segments)
 * through the full path. Segments named by `collapsed` get no crumb of their
 * own — the trail reads `db / orders`, not `db / public / orders` — while
 * every remaining crumb still carries its full path, so navigating to one
 * addresses the console exactly as before.
 */
export function breadcrumbsFor(
  path: ZeropsDataConsolePath,
  collapsed: ReadonlyArray<string> = [],
): ReadonlyArray<{ readonly label: string; readonly path: ZeropsDataConsolePath }> {
  const crumbs: Array<{ readonly label: string; readonly path: ZeropsDataConsolePath }> = [
    { label: path.service, path: { service: path.service, segments: [] } },
  ];
  for (let i = 0; i < path.segments.length; i++) {
    if (i < collapsed.length && path.segments[i] === collapsed[i]) continue;
    crumbs.push({
      label: path.segments[i]!,
      path: { service: path.service, segments: path.segments.slice(0, i + 1) },
    });
  }
  return crumbs;
}

/** `segments` with a leading `collapsed` run removed — the short form a person reads and types. */
export function visibleSegments(
  segments: ReadonlyArray<string>,
  collapsed: ReadonlyArray<string> = [],
): ReadonlyArray<string> {
  let skipped = 0;
  while (skipped < collapsed.length && segments[skipped] === collapsed[skipped]) skipped += 1;
  return segments.slice(skipped);
}

// ---------------------------------------------------------------------------
// Mention catalog
// ---------------------------------------------------------------------------

/**
 * One `@` mention offered by the composer for a project's data: either a
 * whole service (`db`) or one table inside it (`db.public.orders`). `aliases`
 * carries the short form a user is likelier to type (`db.orders`) so a
 * schema-qualified table is reachable without spelling the schema out.
 */
export interface DataMentionEntry {
  readonly kind: "service" | "table";
  readonly service: string;
  readonly serviceType: string;
  readonly segments: ReadonlyArray<string>;
  readonly token: string;
  readonly aliases: ReadonlyArray<string>;
  readonly label: string;
}

/** The mention token addressing a path: the service name and its segments joined by dots. */
export function dataMentionToken(path: ZeropsDataConsolePath): string {
  return [path.service, ...path.segments].join(".");
}

/**
 * Builds the composer's mention catalog from a discovery response plus the
 * tabular nodes already walked out of each service's tree. Services without a
 * browse affordance (`resolveServiceAffordances`) contribute nothing, and
 * neither do nodes addressed to them.
 */
export function buildDataMentionEntries(
  services: ReadonlyArray<ZeropsDataConsoleService>,
  tabularNodes: ReadonlyArray<ZeropsDataConsoleNode>,
  collapsedByService: Readonly<Record<string, ReadonlyArray<string>>> = {},
): ReadonlyArray<DataMentionEntry> {
  const browsable = new Map<string, ZeropsDataConsoleService>();
  for (const service of services) {
    if (resolveServiceAffordances(service).canBrowse) {
      browsable.set(service.hostname, service);
    }
  }
  const entries: DataMentionEntry[] = [];
  for (const service of browsable.values()) {
    entries.push({
      kind: "service",
      service: service.hostname,
      serviceType: service.type,
      segments: [],
      token: service.hostname,
      aliases: [],
      label: service.hostname,
    });
  }
  for (const node of tabularNodes) {
    const service = browsable.get(node.path.service);
    if (service === undefined || node.kind !== "tabular") continue;
    const segments = [...node.path.segments];
    const fullToken = dataMentionToken(node.path);
    // The collapsed levels are not in the name a person reads, so they are not
    // in the name they type either: the short form is what the menu inserts,
    // and the full path stays an alias so typing it still finds the table.
    const visible = visibleSegments(segments, collapsedByService[service.hostname] ?? []);
    const token = `${service.hostname}.${visible.join(".")}`;
    const lastToken = `${service.hostname}.${visible[visible.length - 1] ?? ""}`;
    const aliases = [fullToken, lastToken].filter(
      (alias, index, all) => alias !== token && all.indexOf(alias) === index,
    );
    entries.push({
      kind: "table",
      service: service.hostname,
      serviceType: service.type,
      segments,
      token,
      aliases,
      label: `${service.hostname} · ${visible.join(".")}`,
    });
  }
  return entries;
}

const MENTION_RANK_EXACT = 0;
const MENTION_RANK_PREFIX = 1;
const MENTION_RANK_SUBSTRING = 2;

function rankDataMention(entry: DataMentionEntry, query: string): number | undefined {
  let best: number | undefined;
  for (const candidate of [entry.token, ...entry.aliases]) {
    const lowered = candidate.toLowerCase();
    const rank =
      lowered === query
        ? MENTION_RANK_EXACT
        : lowered.startsWith(query)
          ? MENTION_RANK_PREFIX
          : lowered.includes(query)
            ? MENTION_RANK_SUBSTRING
            : undefined;
    if (rank !== undefined && (best === undefined || rank < best)) best = rank;
  }
  return best;
}

/**
 * Matches a typed `@` query against the catalog: exact token or alias first,
 * then prefix, then substring, services ahead of tables at equal rank. An
 * empty query lists the services. Never returns more than `limit` entries.
 */
export function searchDataMentions(
  entries: ReadonlyArray<DataMentionEntry>,
  query: string,
  limit = 8,
): ReadonlyArray<DataMentionEntry> {
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0) {
    return [...entries]
      .sort((left, right) => (left.kind === right.kind ? 0 : left.kind === "service" ? -1 : 1))
      .slice(0, limit);
  }
  const ranked: Array<{ entry: DataMentionEntry; rank: number; index: number }> = [];
  entries.forEach((entry, index) => {
    const rank = rankDataMention(entry, normalized);
    if (rank !== undefined) ranked.push({ entry, rank, index });
  });
  ranked.sort((left, right) => {
    if (left.rank !== right.rank) return left.rank - right.rank;
    if (left.entry.kind !== right.entry.kind) return left.entry.kind === "service" ? -1 : 1;
    return left.index - right.index;
  });
  return ranked.slice(0, limit).map(({ entry }) => entry);
}

/**
 * Builds the hand-off block for a whole service mention: a heading naming the
 * service and its type, then one line per table the catalog knows about.
 */
export function describeServiceContext(
  service: DataMentionEntry,
  tables: ReadonlyArray<DataMentionEntry>,
): { readonly label: string; readonly text: string } {
  const own = tables.filter((entry) => entry.kind === "table" && entry.service === service.service);
  const lines = [
    `## ${service.service} (${service.serviceType})`,
    ...(own.length > 0 ? own.map((entry) => `- ${entry.segments.join(".")}`) : ["No tables."]),
  ];
  return { label: service.label, text: lines.join("\n") };
}
