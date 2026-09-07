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
