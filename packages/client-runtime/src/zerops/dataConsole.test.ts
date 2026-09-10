import { describe, expect, it } from "vite-plus/test";
import type {
  ZeropsDataConsoleColumn,
  ZeropsDataConsoleNode,
  ZeropsDataConsolePath,
  ZeropsDataConsoleService,
  ZeropsDataConsoleTablePage,
} from "@t3tools/contracts";

import type { DataConsoleFilterDraft, DataConsoleTree } from "./dataConsole.ts";
import type { ZeropsTopologyService } from "./topology.ts";
import {
  applyTablePage,
  applyTreePage,
  breadcrumbsFor,
  buildDataMentionEntries,
  buildFilteredTableStatement,
  buildSortPage,
  collapsedPrefix,
  collapseTreePath,
  describeCell,
  describeDataConsoleError,
  describeDocumentListingStatus,
  describeRowContext,
  describeServiceContext,
  describeTableContext,
  emptyTable,
  emptyTree,
  expandTreePath,
  foldDataConsoleSessionEvent,
  formatCell,
  filtersDirty,
  hasActiveFilters,
  INITIAL_DATA_CONSOLE_STATE,
  documentListingModel,
  isNodeUnloaded,
  joinServicesWithTopology,
  kvListingModel,
  listingFor,
  objectListingModel,
  resolveDataLayout,
  resolveServiceAffordances,
  resolveSqlDialect,
  rowAsJson,
  rowRecord,
  searchDataMentions,
  toggleHiddenColumn,
  treePathKey,
  visibleColumns,
} from "./dataConsole.ts";

// ---------------------------------------------------------------------------
// Session fold
// ---------------------------------------------------------------------------

describe("foldDataConsoleSessionEvent", () => {
  it("starts idle", () => {
    expect(INITIAL_DATA_CONSOLE_STATE).toEqual({ status: "idle" });
  });

  it("adopts the event's status/reason (the server's first emission re-seeds state); allowWrites is not folded (unread in this read-only slice)", () => {
    const next = foldDataConsoleSessionEvent(INITIAL_DATA_CONSOLE_STATE, {
      status: "ready",
      allowWrites: true,
    });
    expect(next).toEqual({ status: "ready", reason: undefined });
  });

  it("carries the unsupported reason through", () => {
    const next = foldDataConsoleSessionEvent(INITIAL_DATA_CONSOLE_STATE, {
      status: "unsupported",
      reason: "zcp too old",
    });
    expect(next).toEqual({ status: "unsupported", reason: "zcp too old" });
  });
});

// ---------------------------------------------------------------------------
// Tree model
// ---------------------------------------------------------------------------

const node = (overrides: Partial<ZeropsDataConsoleNode> = {}): ZeropsDataConsoleNode => ({
  name: "orders",
  kind: "tabular",
  path: { service: "db", segments: ["public", "orders"] },
  hasChildren: false,
  meta: {},
  ...overrides,
});

describe("treePathKey", () => {
  it("joins service and segments into a stable JSON-encoded string", () => {
    expect(treePathKey({ service: "db", segments: ["public", "orders"] })).toBe(
      JSON.stringify(["db", "public", "orders"]),
    );
  });

  it("differs for different segment sets under the same service", () => {
    expect(treePathKey({ service: "db", segments: ["public"] })).not.toBe(
      treePathKey({ service: "db", segments: ["public", "orders"] }),
    );
  });

  it("never collides for a service/segment that itself contains the old space delimiter", () => {
    expect(treePathKey({ service: "db", segments: ["a b"] })).not.toBe(
      treePathKey({ service: "db", segments: ["a", "b"] }),
    );
  });
});

describe("applyTreePage", () => {
  it("stores a fresh page's nodes under the path, expanded and loaded", () => {
    const path = { service: "db", segments: [] };
    const tree = applyTreePage(emptyTree, path, { nodes: [node()], nextCursor: "c1" });
    expect(tree.entries[treePathKey(path)]).toEqual({
      path,
      nodes: [node()],
      nextCursor: "c1",
      expanded: true,
      loaded: true,
    });
  });

  it("replaces the node list for a repeat fetch with no request cursor", () => {
    const path = { service: "db", segments: [] };
    const first = applyTreePage(emptyTree, path, { nodes: [node({ name: "a" })], nextCursor: "" });
    const second = applyTreePage(first, path, { nodes: [node({ name: "b" })], nextCursor: "" });
    expect(second.entries[treePathKey(path)]?.nodes).toEqual([node({ name: "b" })]);
  });

  it("concatenates nodes when the request cursor matches the existing entry's own nextCursor (paginating further into the same listing)", () => {
    const path = { service: "db", segments: [] };
    const first = applyTreePage(emptyTree, path, {
      nodes: [node({ name: "a" })],
      nextCursor: "c1",
    });
    const second = applyTreePage(
      first,
      path,
      { nodes: [node({ name: "b" })], nextCursor: "" },
      "c1",
    );
    expect(second.entries[treePathKey(path)]?.nodes).toEqual([
      node({ name: "a" }),
      node({ name: "b" }),
    ]);
    expect(second.entries[treePathKey(path)]?.nextCursor).toBeUndefined();
  });

  it("replaces (never appends) when the request cursor does not match the existing entry's nextCursor — a stale or unrelated page", () => {
    const path = { service: "db", segments: [] };
    const first = applyTreePage(emptyTree, path, {
      nodes: [node({ name: "a" })],
      nextCursor: "c1",
    });
    const second = applyTreePage(
      first,
      path,
      { nodes: [node({ name: "b" })], nextCursor: "" },
      "some-other-cursor",
    );
    expect(second.entries[treePathKey(path)]?.nodes).toEqual([node({ name: "b" })]);
  });

  it("replaces rather than appends when a request cursor is passed but there is no existing entry", () => {
    const path = { service: "db", segments: [] };
    const tree = applyTreePage(emptyTree, path, { nodes: [node()], nextCursor: "" }, "c1");
    expect(tree.entries[treePathKey(path)]?.nodes).toEqual([node()]);
  });

  it("preserves an existing expanded flag across a page refresh", () => {
    const path = { service: "db", segments: [] };
    const first = collapseTreePath(
      applyTreePage(emptyTree, path, { nodes: [], nextCursor: "" }),
      path,
    );
    const second = applyTreePage(first, path, { nodes: [node()], nextCursor: "" });
    expect(second.entries[treePathKey(path)]?.expanded).toBe(false);
  });

  it("orders a level's children by name, numeric-aware, whatever order the console answered in", () => {
    const path = { service: "kv", segments: [] };
    const scanOrder = ["37", "7", "40", "20", "10"].map((name) => node({ name }));
    const tree = applyTreePage(emptyTree, path, { nodes: scanOrder, nextCursor: "" });
    expect(tree.entries[treePathKey(path)]!.nodes.map((entry) => entry.name)).toEqual([
      "7",
      "10",
      "20",
      "37",
      "40",
    ]);
  });

  it("re-sorts the whole list on an append, so a later page interleaves", () => {
    const path = { service: "kv", segments: [] };
    const first = applyTreePage(emptyTree, path, {
      nodes: [node({ name: "10" }), node({ name: "40" })],
      nextCursor: "c1",
    });
    const second = applyTreePage(
      first,
      path,
      { nodes: [node({ name: "7" }), node({ name: "20" })], nextCursor: "" },
      "c1",
    );
    expect(second.entries[treePathKey(path)]!.nodes.map((entry) => entry.name)).toEqual([
      "7",
      "10",
      "20",
      "40",
    ]);
  });
});

describe("expandTreePath / collapseTreePath", () => {
  it("records collapsed for a path with no loaded page yet, still unloaded", () => {
    const path = { service: "db", segments: [] };
    const tree = collapseTreePath(emptyTree, path);
    expect(tree.entries[treePathKey(path)]).toEqual({
      path,
      nodes: [],
      expanded: false,
      loaded: false,
    });
  });

  it("expanding a never-fetched path records intent but does not mark it loaded", () => {
    const path = { service: "db", segments: [] };
    const tree = expandTreePath(emptyTree, path);
    expect(tree.entries[treePathKey(path)]?.loaded).toBe(false);
  });

  it("toggles an already-loaded entry's expanded flag without clearing loaded", () => {
    const path = { service: "db", segments: [] };
    const loaded = applyTreePage(emptyTree, path, { nodes: [node()], nextCursor: "" });
    const collapsed = collapseTreePath(loaded, path);
    expect(collapsed.entries[treePathKey(path)]?.expanded).toBe(false);
    expect(collapsed.entries[treePathKey(path)]?.loaded).toBe(true);
    const expanded = expandTreePath(collapsed, path);
    expect(expanded.entries[treePathKey(path)]?.expanded).toBe(true);
    expect(expanded.entries[treePathKey(path)]?.loaded).toBe(true);
  });
});

describe("isNodeUnloaded", () => {
  it("is false for a leaf node (hasChildren false)", () => {
    expect(isNodeUnloaded(emptyTree, node({ hasChildren: false }))).toBe(false);
  });

  it("is true for a container node whose path has no loaded page yet", () => {
    expect(isNodeUnloaded(emptyTree, node({ hasChildren: true, kind: "container" }))).toBe(true);
  });

  it("is true for a container node that was expanded but never got a page (e.g. still loading, or a failed fetch)", () => {
    const n = node({
      hasChildren: true,
      kind: "container",
      path: { service: "db", segments: ["public"] },
    });
    const tree = expandTreePath(emptyTree, n.path);
    expect(isNodeUnloaded(tree, n)).toBe(true);
  });

  it("is false once the node's own path has a loaded page", () => {
    const n = node({
      hasChildren: true,
      kind: "container",
      path: { service: "db", segments: ["public"] },
    });
    const tree = applyTreePage(emptyTree, n.path, { nodes: [], nextCursor: "" });
    expect(isNodeUnloaded(tree, n)).toBe(false);
  });

  it("is true again after a collapse/re-expand of a path whose fetch never landed (a re-expand refetches)", () => {
    const n = node({
      hasChildren: true,
      kind: "container",
      path: { service: "db", segments: ["public"] },
    });
    const collapsed = collapseTreePath(emptyTree, n.path);
    const reExpanded = expandTreePath(collapsed, n.path);
    expect(isNodeUnloaded(reExpanded, n)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Table model
// ---------------------------------------------------------------------------

const column = (overrides: Partial<ZeropsDataConsoleColumn> = {}): ZeropsDataConsoleColumn => ({
  name: "id",
  dataType: "integer",
  pk: true,
  editable: false,
  reason: "primary key",
  sortable: true,
  sortReason: "",
  ...overrides,
});

const tablePage = (
  overrides: Partial<ZeropsDataConsoleTablePage> = {},
): ZeropsDataConsoleTablePage => ({
  columns: [column()],
  rows: [[1]],
  nextCursor: "",
  rowKeyCols: ["id"],
  bestEffort: false,
  numbered: false,
  ...overrides,
});

describe("applyTablePage", () => {
  it("replaces rows and metadata by default (a fresh query/table load)", () => {
    const model = applyTablePage(emptyTable, tablePage({ rows: [[1], [2]] }));
    expect(model.rows).toEqual([[1], [2]]);
    expect(model.columns).toEqual([column()]);
    expect(model.rowKeyCols).toEqual(["id"]);
  });

  it("normalizes an empty-string nextCursor to undefined (end of the page set)", () => {
    const model = applyTablePage(emptyTable, tablePage({ nextCursor: "" }));
    expect(model.nextCursor).toBeUndefined();
  });

  it("concatenates rows when the request cursor matches the model's own nextCursor (scrolling further into the same query)", () => {
    const first = applyTablePage(emptyTable, tablePage({ rows: [[1]], nextCursor: "c1" }));
    const second = applyTablePage(first, tablePage({ rows: [[2]], nextCursor: "" }), "c1");
    expect(second.rows).toEqual([[1], [2]]);
    expect(second.nextCursor).toBeUndefined();
  });

  it("replaces (never appends) when the request cursor does not match the model's nextCursor — a stale or unrelated page", () => {
    const first = applyTablePage(emptyTable, tablePage({ rows: [[1]], nextCursor: "c1" }));
    const second = applyTablePage(
      first,
      tablePage({ rows: [[2]], nextCursor: "" }),
      "some-other-cursor",
    );
    expect(second.rows).toEqual([[2]]);
  });

  it("takes the new page's columns/bestEffort/numbered even when appending", () => {
    const first = applyTablePage(emptyTable, tablePage({ nextCursor: "c1" }));
    const second = applyTablePage(
      first,
      tablePage({ columns: [column({ name: "email" })], bestEffort: true, numbered: true }),
      "c1",
    );
    expect(second.columns).toEqual([column({ name: "email" })]);
    expect(second.bestEffort).toBe(true);
    expect(second.numbered).toBe(true);
  });
});

describe("buildSortPage", () => {
  it("builds a sort request for a sortable column", () => {
    expect(buildSortPage(column({ name: "email" }), "desc")).toEqual({
      sort: "email",
      direction: "desc",
    });
  });

  it("preserves base page fields (cursor/limit) alongside the new sort", () => {
    expect(buildSortPage(column({ name: "email" }), "asc", { limit: 50 })).toEqual({
      limit: 50,
      sort: "email",
      direction: "asc",
    });
  });

  it("returns undefined for a non-sortable column", () => {
    expect(buildSortPage(column({ sortable: false }), "asc")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Cell formatting
// ---------------------------------------------------------------------------

describe("formatCell", () => {
  it("formats null and undefined as NULL", () => {
    expect(formatCell(null, column())).toBe("NULL");
    expect(formatCell(undefined, column())).toBe("NULL");
  });

  it("formats booleans as true/false", () => {
    expect(formatCell(true, column())).toBe("true");
    expect(formatCell(false, column())).toBe("false");
  });

  it("passes an ordinary string column through verbatim, big-int-safe (a decimal that lost float precision arrives pre-stringified)", () => {
    expect(formatCell("9223372036854775807", column({ dataType: "bigint" }))).toBe(
      "9223372036854775807",
    );
  });

  it("formats a plain number", () => {
    expect(formatCell(42, column({ dataType: "integer" }))).toBe("42");
  });

  it("renders an object as compact JSON", () => {
    expect(formatCell({ a: 1 }, column({ dataType: "jsonb" }))).toBe('{"a":1}');
  });

  it("renders a bytes-like column's base64 string as a byte count", () => {
    // "foob" -> 3 bytes
    expect(formatCell("Zm9vYg==", column({ dataType: "bytea" }))).toBe("<4 bytes>");
  });
});

const service = (
  actions: ZeropsDataConsoleService["actions"] = [],
): Pick<ZeropsDataConsoleService, "actions"> => ({ actions });

const consoleService = (hostname: string): ZeropsDataConsoleService => ({
  hostname,
  type: "postgresql@17",
  family: "tabular",
  support: "supported",
  actions: [],
  status: "ACTIVE",
});

const topologyService = (
  overrides: Partial<ZeropsTopologyService> & { hostname: string },
): ZeropsTopologyService => ({
  serviceId: `svc-${overrides.hostname}`,
  type: "postgresql@17",
  status: "ACTIVE",
  group: "data",
  transient: false,
  routes: [],
  ports: [],
  ...overrides,
});

const listingNode = (
  overrides: Partial<ZeropsDataConsoleNode> & { kind: ZeropsDataConsoleNode["kind"] },
) =>
  ({
    name: "n",
    path: { service: "svc", segments: ["n"] },
    hasChildren: false,
    ...overrides,
  }) as ZeropsDataConsoleNode;

describe("listingFor", () => {
  it("is objects for an object-storage service's root or a prefix, but not for a blob (opens the preview)", () => {
    expect(listingFor({ family: "object" }, null)).toBe("objects");
    expect(listingFor({ family: "object" }, listingNode({ kind: "container" }))).toBe("objects");
    expect(listingFor({ family: "object" }, listingNode({ kind: "blob" }))).toBe("tree");
  });

  it("is documents for a document service's root or an index, but not for a document blob (opens the preview)", () => {
    expect(listingFor({ family: "document" }, null)).toBe("documents");
    expect(listingFor({ family: "document" }, listingNode({ kind: "container" }))).toBe(
      "documents",
    );
    expect(listingFor({ family: "document" }, listingNode({ kind: "blob" }))).toBe("tree");
  });

  it("is streams for a stream service", () => {
    expect(listingFor({ family: "stream" }, null)).toBe("streams");
  });

  it("is keys for a kv service's namespace root or a nested namespace", () => {
    expect(listingFor({ family: "kv" }, null)).toBe("keys");
    expect(listingFor({ family: "kv" }, listingNode({ kind: "container" }))).toBe("keys");
  });

  it("falls back to tree for any selected leaf key — a hash/list/set/zset's own entries, a string (blob preview) and a stream (unbrowsable) all already reach the panel's existing generic table/blob handling", () => {
    expect(
      listingFor({ family: "kv" }, listingNode({ kind: "blob", meta: { entryType: "string" } })),
    ).toBe("tree");
    expect(
      listingFor({ family: "kv" }, listingNode({ kind: "tabular", meta: { entryType: "hash" } })),
    ).toBe("tree");
    expect(
      listingFor({ family: "kv" }, listingNode({ kind: "tabular", meta: { entryType: "stream" } })),
    ).toBe("tree");
  });

  it("is tree for a tabular service, unchanged", () => {
    expect(listingFor({ family: "tabular" }, null)).toBe("tree");
    expect(listingFor({ family: "tabular" }, listingNode({ kind: "tabular" }))).toBe("tree");
  });

  it("is tree for file/unknown families, which have no affordances either way", () => {
    expect(listingFor({ family: "file" }, null)).toBe("tree");
    expect(listingFor({ family: "unknown" }, null)).toBe("tree");
  });
});

describe("objectListingModel", () => {
  const blob = listingNode({
    name: "photo.png",
    kind: "blob",
    meta: { size: 2_621_440, modified: "2026-01-01T00:00:00Z", contentType: "image/png" },
  });
  const prefix = listingNode({ name: "uploads", kind: "container", hasChildren: true, meta: {} });

  it("builds one row per node, blobs and prefixes together, in the given order", () => {
    const listing = objectListingModel([prefix, blob], undefined);
    expect(listing.nodes).toEqual([prefix, blob]);
    expect(listing.model.rows).toEqual([
      ["uploads/", "", "", ""],
      ["photo.png", "2.5 MB", "2026-01-01T00:00:00Z", "image/png"],
    ]);
    expect(listing.model.columns.map((c) => c.name)).toEqual([
      "name",
      "size",
      "modified",
      "contentType",
    ]);
    expect(listing.model.rowKeyCols).toEqual(["name"]);
    expect(listing.model.nextCursor).toBeUndefined();
  });

  it("keeps a container's name distinguishable from a blob's by a trailing slash", () => {
    const listing = objectListingModel([prefix], undefined);
    expect(listing.model.rows[0]![0]).toBe("uploads/");
  });

  it("carries the tree level's own nextCursor through, unmodified", () => {
    expect(objectListingModel([], "c1").model.nextCursor).toBe("c1");
  });
});

describe("kvListingModel", () => {
  it("builds one row per key with its type glyph, humanized TTL and count", () => {
    const key = listingNode({
      name: "session:42",
      kind: "tabular",
      meta: { entryType: "hash", ttlSeconds: 120, count: 6 },
    });
    const listing = kvListingModel([key], undefined);
    expect(listing.model.rows).toEqual([["session:42", "hash", "2 min", "6"]]);
    expect(listing.model.rowKeyCols).toEqual(["key"]);
  });

  it("leaves type/ttl/count blank for a key (or namespace) the console reports none of", () => {
    const namespace = listingNode({
      name: "cache",
      kind: "container",
      hasChildren: true,
      meta: {},
    });
    expect(kvListingModel([namespace], undefined).model.rows).toEqual([["cache", "", "", ""]]);
  });
});

describe("documentListingModel", () => {
  it("lists a document per row, id only — no per-row JSON preview", () => {
    const doc = listingNode({ name: "order-42", kind: "blob", meta: {} });
    const listing = documentListingModel([doc], "c1");
    expect(listing.nodes).toEqual([doc]);
    expect(listing.model.columns.map((c) => c.name)).toEqual(["id"]);
    expect(listing.model.rows).toEqual([["order-42"]]);
    expect(listing.model.rowKeyCols).toEqual(["id"]);
    expect(listing.model.nextCursor).toBe("c1");
  });
});

describe("describeDocumentListingStatus", () => {
  it("reads as a plain row count with no more pages", () => {
    expect(describeDocumentListingStatus(12, false, false)).toBe("12 loaded");
  });

  it("adds the more-available phrase when another page is behind the cursor", () => {
    expect(describeDocumentListingStatus(12, true, false)).toBe("12 loaded · more available");
  });

  it("prefixes 'Search result ·' while a search's results are showing", () => {
    expect(describeDocumentListingStatus(3, false, true)).toBe("Search result · 3 loaded");
    expect(describeDocumentListingStatus(3, true, true)).toBe(
      "Search result · 3 loaded · more available",
    );
  });
});

describe("joinServicesWithTopology", () => {
  it("orders console services by the topology's order when a topology view is present", () => {
    const rows = joinServicesWithTopology(
      [consoleService("b"), consoleService("a")],
      [topologyService({ hostname: "a" }), topologyService({ hostname: "b" })],
    );
    expect(rows.map((row) => row.service.hostname)).toEqual(["a", "b"]);
    expect(rows[0]?.topologyService?.hostname).toBe("a");
    expect(rows[1]?.topologyService?.hostname).toBe("b");
  });

  it("puts console services with no topology match last, without a topologyService", () => {
    const rows = joinServicesWithTopology(
      [consoleService("orphan"), consoleService("a")],
      [topologyService({ hostname: "a" })],
    );
    expect(rows.map((row) => row.service.hostname)).toEqual(["a", "orphan"]);
    expect(rows[1]?.topologyService).toBeUndefined();
  });

  it("renders console order untouched while the topology view is undefined", () => {
    const rows = joinServicesWithTopology([consoleService("b"), consoleService("a")], undefined);
    expect(rows.map((row) => row.service.hostname)).toEqual(["b", "a"]);
    expect(rows.every((row) => row.topologyService === undefined)).toBe(true);
  });
});

describe("resolveServiceAffordances", () => {
  it("derives canQuery/canReadTable/canBrowse from enabled actions, never from family/support", () => {
    const affordances = resolveServiceAffordances(
      service([
        { id: "querySQL", enabled: true, readOnly: true, reason: "" },
        { id: "readTable", enabled: true, readOnly: true, reason: "" },
      ]),
    );
    expect(affordances).toEqual({
      canBrowse: true,
      canQuery: true,
      canReadTable: true,
      canSearchDocs: false,
    });
  });

  it("is all-false for a service with no matching actions", () => {
    expect(resolveServiceAffordances(service([]))).toEqual({
      canBrowse: false,
      canQuery: false,
      canReadTable: false,
      canSearchDocs: false,
    });
  });

  it("derives canSearchDocs from the enabled searchDocs action", () => {
    expect(
      resolveServiceAffordances(
        service([{ id: "searchDocs", enabled: true, readOnly: true, reason: "" }]),
      ).canSearchDocs,
    ).toBe(true);
    expect(
      resolveServiceAffordances(
        service([{ id: "searchDocs", enabled: false, readOnly: true, reason: "not supported" }]),
      ).canSearchDocs,
    ).toBe(false);
  });

  it("derives canBrowse from readBlob alone (object storage has no readTable)", () => {
    const affordances = resolveServiceAffordances(
      service([{ id: "readBlob", enabled: true, readOnly: true, reason: "" }]),
    );
    expect(affordances.canBrowse).toBe(true);
    expect(affordances.canReadTable).toBe(false);
  });

  it("surfaces the showVPNGate reason as informational, never as an affordance gate", () => {
    const affordances = resolveServiceAffordances(
      service([
        { id: "querySQL", enabled: true, readOnly: true, reason: "" },
        {
          id: "showVPNGate",
          enabled: true,
          readOnly: true,
          reason: "bring up the VPN if unreachable",
        },
      ]),
    );
    expect(affordances.vpnGateReason).toBe("bring up the VPN if unreachable");
    expect(affordances.canQuery).toBe(true);
  });

  it("treats a present-but-disabled action as not affording", () => {
    const affordances = resolveServiceAffordances(
      service([{ id: "querySQL", enabled: false, readOnly: true, reason: "not supported" }]),
    );
    expect(affordances.canQuery).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Error copy
// ---------------------------------------------------------------------------

describe("describeDataConsoleError", () => {
  it("gives a distinct sentence per known code", () => {
    const codes = [
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
      "session_unavailable",
      "session_unsupported",
    ] as const;
    const sentences = codes.map((code) => describeDataConsoleError({ code }));
    expect(new Set(sentences).size).toBe(codes.length);
    for (const sentence of sentences) {
      expect(sentence.length).toBeGreaterThan(0);
    }
  });

  it("calls the surface Data, never 'the Data console' (design-system glossary)", () => {
    expect(describeDataConsoleError({ code: "session_unsupported" })).toBe(
      "This project doesn't support Data yet.",
    );
    expect(describeDataConsoleError({ code: "session_unavailable" })).toBe(
      "Data isn't available right now.",
    );
  });
});

// ---------------------------------------------------------------------------
// Filters → read-only SQL
// ---------------------------------------------------------------------------

describe("resolveSqlDialect", () => {
  it.each([
    ["postgresql", "postgresql"],
    ["postgresql@14", "postgresql"],
    ["mariadb", "mysql"],
    ["mariadb@10.6", "mysql"],
    ["mysql", "mysql"],
    ["mysql@8", "mysql"],
    ["mongodb", undefined],
    ["objectstorage", undefined],
    ["keydb", undefined],
  ])("maps %s -> %s", (serviceType, expected) => {
    expect(resolveSqlDialect(serviceType)).toBe(expected);
  });
});

const tablePath: ZeropsDataConsolePath = { service: "db", segments: ["public", "orders"] };

describe("buildFilteredTableStatement", () => {
  it("builds a bare SELECT with just a LIMIT when there are no filters", () => {
    expect(
      buildFilteredTableStatement({
        dialect: "postgresql",
        path: tablePath,
        filters: [],
        limit: 50,
      }),
    ).toBe('SELECT * FROM "public"."orders" LIMIT 50');
  });

  it("quotes mysql identifiers with backticks instead of double quotes", () => {
    expect(
      buildFilteredTableStatement({ dialect: "mysql", path: tablePath, filters: [], limit: 50 }),
    ).toBe("SELECT * FROM `public`.`orders` LIMIT 50");
  });

  it("escapes a double quote inside a postgresql identifier by doubling it", () => {
    const path: ZeropsDataConsolePath = { service: "db", segments: ['weird"table'] };
    expect(
      buildFilteredTableStatement({ dialect: "postgresql", path, filters: [], limit: 10 }),
    ).toBe('SELECT * FROM "weird""table" LIMIT 10');
  });

  it("ANDs multiple comparison filters and single-quotes string values, doubling an embedded quote", () => {
    expect(
      buildFilteredTableStatement({
        dialect: "postgresql",
        path: tablePath,
        filters: [
          { column: "status", op: "eq", value: "O'Brien" },
          { column: "total", op: "gte", value: "100" },
        ],
        limit: 50,
      }),
    ).toBe(
      `SELECT * FROM "public"."orders" WHERE "status" = 'O''Brien' AND "total" >= '100' LIMIT 50`,
    );
  });

  it("renders isNull/notNull without a value operand", () => {
    expect(
      buildFilteredTableStatement({
        dialect: "postgresql",
        path: tablePath,
        filters: [
          { column: "deleted_at", op: "isNull" },
          { column: "email", op: "notNull" },
        ],
        limit: 50,
      }),
    ).toBe(
      'SELECT * FROM "public"."orders" WHERE "deleted_at" IS NULL AND "email" IS NOT NULL LIMIT 50',
    );
  });

  it("renders contains as a wrapped LIKE with wildcard characters in the value escaped", () => {
    expect(
      buildFilteredTableStatement({
        dialect: "postgresql",
        path: tablePath,
        filters: [{ column: "name", op: "contains", value: "50%_off!deal\\x" }],
        limit: 50,
      }),
    ).toBe(
      `SELECT * FROM "public"."orders" WHERE "name" LIKE '%50!%!_off!!deal\\x%' ESCAPE '!' LIMIT 50`,
    );
  });

  it("doubles backslashes in MySQL literals, where a backslash escapes, and leaves PostgreSQL's alone", () => {
    expect(
      buildFilteredTableStatement({
        dialect: "mysql",
        path: tablePath,
        filters: [
          { column: "name", op: "eq", value: "a\\b'c" },
          { column: "name", op: "contains", value: "x\\%" },
        ],
        limit: 5,
      }),
    ).toBe(
      "SELECT * FROM `public`.`orders` WHERE `name` = 'a\\\\b''c' AND `name` LIKE '%x\\\\!%%' ESCAPE '!' LIMIT 5",
    );
    expect(
      buildFilteredTableStatement({
        dialect: "postgresql",
        path: tablePath,
        filters: [{ column: "name", op: "eq", value: "a\\b" }],
        limit: 5,
      }),
    ).toBe(`SELECT * FROM "public"."orders" WHERE "name" = 'a\\b' LIMIT 5`);
  });

  it("renders startsWith as a right-open LIKE", () => {
    expect(
      buildFilteredTableStatement({
        dialect: "postgresql",
        path: tablePath,
        filters: [{ column: "name", op: "startsWith", value: "Acme" }],
        limit: 50,
      }),
    ).toBe(`SELECT * FROM "public"."orders" WHERE "name" LIKE 'Acme%' ESCAPE '!' LIMIT 50`);
  });

  it("appends a trimmed non-empty rawWhere as a further AND (...) clause, untouched", () => {
    expect(
      buildFilteredTableStatement({
        dialect: "postgresql",
        path: tablePath,
        filters: [{ column: "status", op: "eq", value: "open" }],
        rawWhere: "  total > 10 OR total IS NULL  ",
        limit: 50,
      }),
    ).toBe(
      `SELECT * FROM "public"."orders" WHERE "status" = 'open' AND (total > 10 OR total IS NULL) LIMIT 50`,
    );
  });

  it("ignores a blank rawWhere", () => {
    expect(
      buildFilteredTableStatement({
        dialect: "postgresql",
        path: tablePath,
        filters: [],
        rawWhere: "   ",
        limit: 50,
      }),
    ).toBe('SELECT * FROM "public"."orders" LIMIT 50');
  });

  it("adds ORDER BY only when a sort is given", () => {
    expect(
      buildFilteredTableStatement({
        dialect: "postgresql",
        path: tablePath,
        filters: [],
        sort: { column: "created_at", direction: "desc" },
        limit: 50,
      }),
    ).toBe('SELECT * FROM "public"."orders" ORDER BY "created_at" DESC LIMIT 50');
  });

  it("never appends a trailing semicolon", () => {
    const sql = buildFilteredTableStatement({
      dialect: "postgresql",
      path: tablePath,
      filters: [],
      limit: 50,
    });
    expect(sql.endsWith(";")).toBe(false);
  });
});

describe("hasActiveFilters", () => {
  it("is false with no filters and no rawWhere", () => {
    expect(hasActiveFilters([])).toBe(false);
    expect(hasActiveFilters([], "   ")).toBe(false);
  });

  it("is true with at least one structured filter", () => {
    expect(hasActiveFilters([{ column: "a", op: "isNull" }])).toBe(true);
  });

  it("is true with a non-blank rawWhere even with no structured filters", () => {
    expect(hasActiveFilters([], "total > 10")).toBe(true);
  });
});

describe("filtersDirty", () => {
  interface Case {
    readonly name: string;
    readonly draft: DataConsoleFilterDraft;
    readonly applied: DataConsoleFilterDraft;
    readonly dirty: boolean;
  }

  const cases: ReadonlyArray<Case> = [
    {
      name: "two empty drafts are clean",
      draft: { filters: [], rawWhere: "" },
      applied: { filters: [], rawWhere: "" },
      dirty: false,
    },
    {
      name: "an added chip is dirty",
      draft: { filters: [{ column: "a", op: "eq", value: "1" }], rawWhere: "" },
      applied: { filters: [], rawWhere: "" },
      dirty: true,
    },
    {
      name: "a removed chip is dirty",
      draft: { filters: [], rawWhere: "" },
      applied: { filters: [{ column: "a", op: "eq", value: "1" }], rawWhere: "" },
      dirty: true,
    },
    {
      name: "identical chips are clean",
      draft: { filters: [{ column: "a", op: "eq", value: "1" }], rawWhere: "" },
      applied: { filters: [{ column: "a", op: "eq", value: "1" }], rawWhere: "" },
      dirty: false,
    },
    {
      name: "a changed column is dirty",
      draft: { filters: [{ column: "b", op: "eq", value: "1" }], rawWhere: "" },
      applied: { filters: [{ column: "a", op: "eq", value: "1" }], rawWhere: "" },
      dirty: true,
    },
    {
      name: "a changed operator is dirty",
      draft: { filters: [{ column: "a", op: "neq", value: "1" }], rawWhere: "" },
      applied: { filters: [{ column: "a", op: "eq", value: "1" }], rawWhere: "" },
      dirty: true,
    },
    {
      name: "a changed value is dirty",
      draft: { filters: [{ column: "a", op: "eq", value: "2" }], rawWhere: "" },
      applied: { filters: [{ column: "a", op: "eq", value: "1" }], rawWhere: "" },
      dirty: true,
    },
    {
      name: "an absent value and an empty one are the same operand",
      draft: { filters: [{ column: "a", op: "isNull" }], rawWhere: "" },
      applied: { filters: [{ column: "a", op: "isNull", value: "" }], rawWhere: "" },
      dirty: false,
    },
    {
      name: "chip order matters",
      draft: {
        filters: [
          { column: "b", op: "eq", value: "2" },
          { column: "a", op: "eq", value: "1" },
        ],
        rawWhere: "",
      },
      applied: {
        filters: [
          { column: "a", op: "eq", value: "1" },
          { column: "b", op: "eq", value: "2" },
        ],
        rawWhere: "",
      },
      dirty: true,
    },
    {
      name: "rawWhere compares trimmed",
      draft: { filters: [], rawWhere: "  total > 10  " },
      applied: { filters: [], rawWhere: "total > 10" },
      dirty: false,
    },
    {
      name: "a typed rawWhere over an applied blank one is dirty",
      draft: { filters: [], rawWhere: "total > 10" },
      applied: { filters: [], rawWhere: "" },
      dirty: true,
    },
  ];

  for (const testCase of cases) {
    it(testCase.name, () => {
      expect(filtersDirty(testCase.draft, testCase.applied)).toBe(testCase.dirty);
    });
  }
});

// ---------------------------------------------------------------------------
// Column visibility
// ---------------------------------------------------------------------------

describe("visibleColumns", () => {
  it("filters out hidden non-pk columns, preserving order", () => {
    const columns = [
      column({ name: "id" }),
      column({ name: "email", pk: false }),
      column({ name: "notes", pk: false }),
    ];
    expect(visibleColumns(columns, new Set(["notes"]))).toEqual([
      column({ name: "id" }),
      column({ name: "email", pk: false }),
    ]);
  });

  it("never hides a pk column even if named in the hidden set", () => {
    const columns = [column({ name: "id", pk: true }), column({ name: "email", pk: false })];
    expect(visibleColumns(columns, new Set(["id", "email"]))).toEqual([
      column({ name: "id", pk: true }),
    ]);
  });
});

describe("toggleHiddenColumn", () => {
  it("adds an absent column name", () => {
    expect([...toggleHiddenColumn(new Set(), "email")]).toEqual(["email"]);
  });

  it("removes a present column name", () => {
    expect([...toggleHiddenColumn(new Set(["email"]), "email")]).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Cell detail
// ---------------------------------------------------------------------------

describe("describeCell", () => {
  it("classifies null", () => {
    expect(describeCell(null)).toEqual({
      kind: "null",
      detail: "NULL",
      oneLine: "NULL",
      hasMore: false,
    });
  });

  it("classifies a boolean", () => {
    expect(describeCell(true)).toEqual({
      kind: "boolean",
      detail: "true",
      oneLine: "true",
      hasMore: false,
    });
  });

  it("classifies a plain number", () => {
    expect(describeCell(42)).toEqual({
      kind: "number",
      detail: "42",
      oneLine: "42",
      hasMore: false,
    });
  });

  it("classifies a big-int wire string as number", () => {
    expect(describeCell("9223372036854775807")).toEqual({
      kind: "number",
      detail: "9223372036854775807",
      oneLine: "9223372036854775807",
      hasMore: false,
    });
  });

  it("classifies a negative big-int wire string as number", () => {
    expect(describeCell("-42").kind).toBe("number");
  });

  it("classifies an object as json with pretty detail and compact oneLine", () => {
    const result = describeCell({ a: 1 });
    expect(result.kind).toBe("json");
    expect(result.detail).toBe('{\n  "a": 1\n}');
    expect(result.oneLine).toBe('{"a":1}');
  });

  it("classifies an array as json", () => {
    expect(describeCell([1, 2, 3]).kind).toBe("json");
  });

  it("classifies a string that parses as a JSON object as json", () => {
    const result = describeCell('{"a":1}');
    expect(result.kind).toBe("json");
    expect(result.detail).toBe('{\n  "a": 1\n}');
  });

  it("classifies a string that parses as a JSON array as json", () => {
    expect(describeCell("[1,2,3]").kind).toBe("json");
  });

  it("does not treat an ordinary short string as json", () => {
    expect(describeCell("hello").kind).toBe("text");
  });

  it("classifies a long plain string as text with hasMore and a truncated oneLine", () => {
    const long = "x".repeat(200);
    const result = describeCell(long);
    expect(result.kind).toBe("text");
    expect(result.hasMore).toBe(true);
    expect(result.oneLine).toBe(`${"x".repeat(120)}…`);
    expect(result.detail).toBe(long);
  });

  it("classifies a string containing a newline as text with hasMore even if short", () => {
    const result = describeCell("line one\nline two");
    expect(result.kind).toBe("text");
    expect(result.hasMore).toBe(true);
  });

  it("classifies a short single-line string as text without hasMore", () => {
    expect(describeCell("hello")).toEqual({
      kind: "text",
      detail: "hello",
      oneLine: "hello",
      hasMore: false,
    });
  });

  it("classifies a Uint8Array as binary with a byte count", () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    expect(describeCell(bytes)).toEqual({
      kind: "binary",
      detail: "<4 bytes>",
      oneLine: "<4 bytes>",
      hasMore: false,
    });
  });
});

// ---------------------------------------------------------------------------
// Row helpers
// ---------------------------------------------------------------------------

describe("rowRecord", () => {
  it("zips columns and row values into a record, primary key columns first", () => {
    const columns = [column({ name: "email", pk: false }), column({ name: "id", pk: true })];
    expect(rowRecord(columns, ["a@b.com", 1])).toEqual({ id: 1, email: "a@b.com" });
    expect(Object.keys(rowRecord(columns, ["a@b.com", 1]))).toEqual(["id", "email"]);
  });
});

describe("rowAsJson", () => {
  it("pretty-prints the row record", () => {
    const columns = [column({ name: "id", pk: true })];
    expect(rowAsJson(columns, [1])).toBe('{\n  "id": 1\n}');
  });
});

// ---------------------------------------------------------------------------
// Context hand-off text
// ---------------------------------------------------------------------------

const contextService: ZeropsDataConsoleService = {
  hostname: "db",
  type: "postgresql@16",
  family: "sql",
  support: "full",
  actions: [],
  status: "running",
};

describe("describeTableContext", () => {
  it("builds a label and heading naming the service, type and path, one line per column, and the row count when given", () => {
    const columns = [
      column({ name: "id", pk: true, dataType: "integer" }),
      column({ name: "email", pk: false, dataType: "text" }),
    ];
    const result = describeTableContext({
      service: contextService,
      path: tablePath,
      columns,
      approxRowCount: 42,
    });
    expect(result.label).toBe("db · public.orders");
    expect(result.text).toBe(
      [
        "## db (postgresql@16) · public.orders",
        "- id: integer (pk)",
        "- email: text",
        "~42 rows",
      ].join("\n"),
    );
  });

  it("omits the row count line when not given", () => {
    const columns = [column({ name: "id", pk: true, dataType: "integer" })];
    const result = describeTableContext({ service: contextService, path: tablePath, columns });
    expect(result.text).toBe(
      ["## db (postgresql@16) · public.orders", "- id: integer (pk)"].join("\n"),
    );
  });
});

describe("describeRowContext", () => {
  it("builds a label naming the first pk column and its value, and a fenced JSON body", () => {
    const columns = [column({ name: "id", pk: true }), column({ name: "email", pk: false })];
    const row = [1, "a@b.com"];
    const result = describeRowContext({ service: contextService, path: tablePath, columns, row });
    expect(result.label).toBe("db · public.orders · id=1");
    expect(result.text).toBe(
      [
        "## db (postgresql@16) · public.orders · id=1",
        "```json",
        rowAsJson(columns, row),
        "```",
      ].join("\n"),
    );
  });

  it("falls back to a generic 'row' label when the table has no primary key", () => {
    const columns = [column({ name: "email", pk: false })];
    const result = describeRowContext({
      service: contextService,
      path: tablePath,
      columns,
      row: ["a@b.com"],
    });
    expect(result.label).toBe("db · public.orders · row");
  });
});

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

describe("resolveDataLayout", () => {
  it("is wide at exactly the 720px threshold and above", () => {
    expect(resolveDataLayout(720)).toBe("wide");
    expect(resolveDataLayout(1200)).toBe("wide");
  });

  it("is narrow below the threshold", () => {
    expect(resolveDataLayout(719)).toBe("narrow");
    expect(resolveDataLayout(320)).toBe("narrow");
  });
});

// ---------------------------------------------------------------------------
// Breadcrumbs
// ---------------------------------------------------------------------------

describe("breadcrumbsFor", () => {
  it("gives just the service root for a path with no segments", () => {
    expect(breadcrumbsFor({ service: "db", segments: [] })).toEqual([
      { label: "db", path: { service: "db", segments: [] } },
    ]);
  });

  it("gives the service root plus one entry per segment prefix", () => {
    expect(breadcrumbsFor(tablePath)).toEqual([
      { label: "db", path: { service: "db", segments: [] } },
      { label: "public", path: { service: "db", segments: ["public"] } },
      { label: "orders", path: { service: "db", segments: ["public", "orders"] } },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Mention catalog
// ---------------------------------------------------------------------------

const browsableService = (hostname: string): ZeropsDataConsoleService => ({
  hostname,
  type: "postgresql@16",
  family: "sql",
  support: "full",
  actions: [{ id: "readTable", enabled: true, readOnly: true, reason: "" }],
  status: "running",
});

const tabularNode = (
  serviceName: string,
  segments: ReadonlyArray<string>,
): ZeropsDataConsoleNode => ({
  name: segments[segments.length - 1] ?? serviceName,
  kind: "tabular",
  path: { service: serviceName, segments },
  hasChildren: false,
});

describe("buildDataMentionEntries", () => {
  it("emits one entry per browsable service plus one per tabular node, with a short alias", () => {
    expect(
      buildDataMentionEntries([browsableService("db")], [tabularNode("db", ["public", "orders"])]),
    ).toEqual([
      {
        kind: "service",
        service: "db",
        serviceType: "postgresql@16",
        segments: [],
        token: "db",
        aliases: [],
        label: "db",
      },
      {
        kind: "table",
        service: "db",
        serviceType: "postgresql@16",
        segments: ["public", "orders"],
        token: "db.public.orders",
        aliases: ["db.orders"],
        label: "db · public.orders",
      },
    ]);
  });

  it("drops services without a browse affordance and nodes belonging to them", () => {
    const gated: ZeropsDataConsoleService = { ...browsableService("cache"), actions: [] };
    expect(buildDataMentionEntries([gated], [tabularNode("cache", ["keys"])])).toEqual([]);
  });

  it("gives a single-segment table no alias", () => {
    const entries = buildDataMentionEntries(
      [browsableService("db")],
      [tabularNode("db", ["orders"])],
    );
    expect(entries[1]).toMatchObject({ token: "db.orders", aliases: [], label: "db · orders" });
  });
});

describe("searchDataMentions", () => {
  const entries = buildDataMentionEntries(
    [browsableService("db"), browsableService("analytics")],
    [
      tabularNode("db", ["public", "orders"]),
      tabularNode("db", ["public", "orders_archive"]),
      tabularNode("analytics", ["public", "events"]),
    ],
  );

  it("ranks an exact alias above a prefix match", () => {
    expect(searchDataMentions(entries, "db.orders").map((entry) => entry.token)).toEqual([
      "db.public.orders",
      "db.public.orders_archive",
    ]);
  });

  it("ranks an exact service token above its tables' prefix matches", () => {
    expect(searchDataMentions(entries, "db").map((entry) => entry.token)).toEqual([
      "db",
      "db.public.orders",
      "db.public.orders_archive",
    ]);
  });

  it("matches a schema-qualified fragment inside the token", () => {
    expect(searchDataMentions(entries, "public.orders").map((entry) => entry.token)).toEqual([
      "db.public.orders",
      "db.public.orders_archive",
    ]);
  });

  it("falls back to a substring match on the token", () => {
    expect(searchDataMentions(entries, "events").map((entry) => entry.token)).toEqual([
      "analytics.public.events",
    ]);
  });

  it("lists services first for an empty query and caps the result count", () => {
    expect(searchDataMentions(entries, "", 2).map((entry) => entry.token)).toEqual([
      "db",
      "analytics",
    ]);
  });

  it("returns nothing when no token, alias or label matches", () => {
    expect(searchDataMentions(entries, "zzz")).toEqual([]);
  });
});

describe("describeServiceContext", () => {
  it("lists the service's tables under a heading naming the service and its type", () => {
    const entries = buildDataMentionEntries(
      [browsableService("db")],
      [tabularNode("db", ["public", "orders"]), tabularNode("db", ["public", "users"])],
    );
    expect(describeServiceContext(entries[0]!, entries.slice(1))).toEqual({
      label: "db",
      text: ["## db (postgresql@16)", "- public.orders", "- public.users"].join("\n"),
    });
  });

  it("says so when the service exposes no tables", () => {
    const entries = buildDataMentionEntries([browsableService("db")], []);
    expect(describeServiceContext(entries[0]!, []).text).toBe(
      ["## db (postgresql@16)", "No tables."].join("\n"),
    );
  });
});

// ---------------------------------------------------------------------------
// Collapsed single-container levels
// ---------------------------------------------------------------------------

const containerNode = (
  serviceName: string,
  segments: ReadonlyArray<string>,
): ZeropsDataConsoleNode => ({
  name: segments[segments.length - 1] ?? serviceName,
  kind: "container",
  path: { service: serviceName, segments },
  hasChildren: true,
});

function treeOf(
  pages: ReadonlyArray<{
    readonly segments: ReadonlyArray<string>;
    readonly nodes: ReadonlyArray<ZeropsDataConsoleNode>;
    readonly nextCursor?: string;
  }>,
): DataConsoleTree {
  let tree = emptyTree;
  for (const page of pages) {
    tree = applyTreePage(
      tree,
      { service: "db", segments: page.segments },
      { nodes: page.nodes, nextCursor: page.nextCursor ?? "" },
    );
  }
  return tree;
}

describe("collapsedPrefix", () => {
  it("collapses a chain of single containers, level after level", () => {
    const tree = treeOf([
      { segments: [], nodes: [containerNode("db", ["main"])] },
      { segments: ["main"], nodes: [containerNode("db", ["main", "public"])] },
      {
        segments: ["main", "public"],
        nodes: [tabularNode("db", ["main", "public", "orders"])],
      },
    ]);
    expect(collapsedPrefix(tree, "db")).toEqual(["main", "public"]);
  });

  it("collapses nothing when a level holds two nodes", () => {
    const tree = treeOf([
      {
        segments: [],
        nodes: [containerNode("db", ["public"]), containerNode("db", ["billing"])],
      },
    ]);
    expect(collapsedPrefix(tree, "db")).toEqual([]);
  });

  it("collapses nothing when a cursor says more nodes exist at that level", () => {
    const tree = treeOf([
      { segments: [], nodes: [containerNode("db", ["public"])], nextCursor: "next" },
    ]);
    expect(collapsedPrefix(tree, "db")).toEqual([]);
  });

  it("collapses nothing when the single node is a table rather than a container", () => {
    const tree = treeOf([{ segments: [], nodes: [tabularNode("db", ["orders"])] }]);
    expect(collapsedPrefix(tree, "db")).toEqual([]);
  });

  it("stops at a level that has not loaded yet", () => {
    const tree = treeOf([{ segments: [], nodes: [containerNode("db", ["public"])] }]);
    expect(collapsedPrefix(tree, "db")).toEqual(["public"]);
  });
});

describe("breadcrumbsFor with a collapsed prefix", () => {
  it("skips the collapsed segments while keeping each crumb's full path", () => {
    expect(breadcrumbsFor(tablePath, ["public"])).toEqual([
      { label: "db", path: { service: "db", segments: [] } },
      { label: "orders", path: { service: "db", segments: ["public", "orders"] } },
    ]);
  });

  it("keeps a segment the prefix does not name", () => {
    expect(
      breadcrumbsFor({ service: "db", segments: ["billing", "orders"] }, ["public"]).map(
        (crumb) => crumb.label,
      ),
    ).toEqual(["db", "billing", "orders"]);
  });
});

describe("mention tokens over a collapsed level", () => {
  it("makes the short form primary and keeps the full path as an alias", () => {
    const entries = buildDataMentionEntries(
      [browsableService("db")],
      [tabularNode("db", ["public", "orders"])],
      { db: ["public"] },
    );
    expect(entries[1]).toMatchObject({
      token: "db.orders",
      aliases: ["db.public.orders"],
      label: "db · orders",
    });
  });

  it("still matches the full path a user types", () => {
    const entries = buildDataMentionEntries(
      [browsableService("db")],
      [tabularNode("db", ["public", "orders"])],
      { db: ["public"] },
    );
    expect(searchDataMentions(entries, "db.public.orders").map((entry) => entry.token)).toEqual([
      "db.orders",
    ]);
  });
});

describe("context labels over a collapsed level", () => {
  it("labels the table by its short path but keeps the full path in the heading", () => {
    const result = describeTableContext({
      service: contextService,
      path: tablePath,
      columns: [column({ name: "id", pk: true })],
      collapsedPrefix: ["public"],
    });
    expect(result.label).toBe("db · orders");
    expect(result.text.split("\n")[0]).toBe("## db (postgresql@16) · public.orders");
  });

  it("labels a row by its short path too", () => {
    const result = describeRowContext({
      service: contextService,
      path: tablePath,
      columns: [column({ name: "id", pk: true })],
      row: [7],
      collapsedPrefix: ["public"],
    });
    expect(result.label).toBe("db · orders · id=7");
    expect(result.text.split("\n")[0]).toBe("## db (postgresql@16) · public.orders · id=7");
  });
});
