import { describe, expect, it } from "vite-plus/test";
import type {
  ZeropsDataConsoleBlob,
  ZeropsDataConsoleColumn,
  ZeropsDataConsoleNode,
  ZeropsDataConsoleService,
  ZeropsDataConsoleTablePage,
} from "@t3tools/contracts";

import {
  applyTablePage,
  applyTreePage,
  buildSortPage,
  collapseTreePath,
  describeDataConsoleError,
  emptyTable,
  emptyTree,
  expandTreePath,
  foldDataConsoleSessionEvent,
  formatCell,
  INITIAL_DATA_CONSOLE_STATE,
  isNodeUnloaded,
  resolveBlobPreview,
  resolveServiceAffordances,
  treePathKey,
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

// ---------------------------------------------------------------------------
// Blob preview
// ---------------------------------------------------------------------------

const blob = (overrides: Partial<ZeropsDataConsoleBlob> = {}): ZeropsDataConsoleBlob => ({
  data: "aGVsbG8=", // "hello"
  contentType: "text/plain",
  truncated: false,
  size: 5,
  vector: false,
  streamMetadata: false,
  ...overrides,
});

describe("resolveBlobPreview", () => {
  it("decodes a text/* blob to text", () => {
    expect(resolveBlobPreview(blob())).toEqual({
      kind: "text",
      text: "hello",
      truncated: false,
      size: 5,
    });
  });

  it("decodes application/json as text", () => {
    const b = blob({ contentType: "application/json", data: btoa('{"a":1}') });
    expect(resolveBlobPreview(b)).toEqual({
      kind: "text",
      text: '{"a":1}',
      truncated: false,
      size: 5,
    });
  });

  it("treats vector as its own kind regardless of content type", () => {
    expect(resolveBlobPreview(blob({ vector: true })).kind).toBe("vector");
  });

  it("treats streamMetadata as its own kind regardless of content type", () => {
    expect(resolveBlobPreview(blob({ streamMetadata: true })).kind).toBe("streamMetadata");
  });

  it("falls back to binary for a non-text content type", () => {
    expect(resolveBlobPreview(blob({ contentType: "image/png" }))).toEqual({
      kind: "binary",
      contentType: "image/png",
      truncated: false,
      size: 5,
    });
  });

  it("refuses to decode a text-typed blob whose body exceeds the 256 KiB cap", () => {
    const big = "A".repeat(260 * 1024);
    const encoded = btoa(big);
    const b = blob({ contentType: "text/plain", data: encoded, size: big.length });
    expect(resolveBlobPreview(b)).toEqual({
      kind: "tooLargeForPreview",
      contentType: "text/plain",
      size: big.length,
    });
  });

  it("falls back to binary for a text-typed blob whose base64 is malformed, rather than throwing", () => {
    const b = blob({ contentType: "text/plain", data: "not valid base64!!", size: 5 });
    expect(resolveBlobPreview(b)).toEqual({
      kind: "binary",
      contentType: "text/plain",
      truncated: false,
      size: 5,
    });
  });

  it("falls back to binary for a text-typed blob whose bytes aren't valid UTF-8, rather than throwing", () => {
    // A lone continuation byte (0x80) is never valid as the start of a UTF-8 sequence.
    const invalidUtf8 = btoa(String.fromCharCode(0x80, 0x80));
    const b = blob({ contentType: "text/plain", data: invalidUtf8, size: 2 });
    expect(resolveBlobPreview(b)).toEqual({
      kind: "binary",
      contentType: "text/plain",
      truncated: false,
      size: 2,
    });
  });
});

// ---------------------------------------------------------------------------
// Service affordances
// ---------------------------------------------------------------------------

const service = (
  actions: ZeropsDataConsoleService["actions"] = [],
): Pick<ZeropsDataConsoleService, "actions"> => ({ actions });

describe("resolveServiceAffordances", () => {
  it("derives canQuery/canReadTable/canBrowse from enabled actions, never from family/support", () => {
    const affordances = resolveServiceAffordances(
      service([
        { id: "querySQL", enabled: true, readOnly: true, reason: "" },
        { id: "readTable", enabled: true, readOnly: true, reason: "" },
      ]),
    );
    expect(affordances).toEqual({ canBrowse: true, canQuery: true, canReadTable: true });
  });

  it("is all-false for a service with no matching actions", () => {
    expect(resolveServiceAffordances(service([]))).toEqual({
      canBrowse: false,
      canQuery: false,
      canReadTable: false,
    });
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
