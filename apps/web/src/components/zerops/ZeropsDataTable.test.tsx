import type { DataConsoleTableModel } from "@t3tools/client-runtime/zerops/dataConsole";
import type { ZeropsDataConsoleColumn } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { visitElements } from "../../test/reactElementTree";

import { ZeropsDataTable } from "./ZeropsDataTable";

function findByAttribute(tree: unknown, attribute: string) {
  return visitElements(tree, (element) => attribute in element.props);
}

const column = (overrides: Partial<ZeropsDataConsoleColumn> = {}): ZeropsDataConsoleColumn => ({
  name: "id",
  dataType: "integer",
  pk: true,
  editable: false,
  reason: "",
  sortable: true,
  sortReason: "",
  ...overrides,
});

const MODEL: DataConsoleTableModel = {
  columns: [
    column({ name: "id" }),
    column({ name: "name", sortable: false, sortReason: "no index" }),
  ],
  rows: [
    [1, "orders"],
    [2, "customers"],
  ],
  rowKeyCols: ["id"],
  bestEffort: false,
  numbered: false,
};

describe("ZeropsDataTable", () => {
  it("renders rows with formatted cells", () => {
    const tree = ZeropsDataTable({
      model: MODEL,
      onLoadMore: vi.fn(),
      onSort: vi.fn(),
    });
    expect(visitElements(tree, (el) => el.props.children === "orders")).not.toBeNull();
    expect(visitElements(tree, (el) => el.props.children === "customers")).not.toBeNull();
  });

  it("shows Load more only when nextCursor is set, and calls onLoadMore", () => {
    let tree = ZeropsDataTable({
      model: MODEL,
      onLoadMore: vi.fn(),
      onSort: vi.fn(),
    });
    expect(findByAttribute(tree, "data-zerops-data-table-load-more")).toBeNull();

    const onLoadMore = vi.fn();
    tree = ZeropsDataTable({
      model: { ...MODEL, nextCursor: "cursor-1" },
      onLoadMore,
      onSort: vi.fn(),
    });
    const loadMore = findByAttribute(tree, "data-zerops-data-table-load-more")!;
    (loadMore.props.onClick as () => void)();
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("disables Load more while loadMorePending", () => {
    const tree = ZeropsDataTable({
      loadMorePending: true,
      model: { ...MODEL, nextCursor: "cursor-1" },
      onLoadMore: vi.fn(),
      onSort: vi.fn(),
    });
    const loadMore = findByAttribute(tree, "data-zerops-data-table-load-more")!;
    expect(loadMore.props.disabled).toBe(true);
  });

  it("a sortable column header click issues ascending when no sort is in play", () => {
    const onSort = vi.fn();
    const tree = ZeropsDataTable({
      model: MODEL,
      onLoadMore: vi.fn(),
      onSort,
    });
    const header = findByAttribute(tree, "data-zerops-data-table-sort")!;
    (header.props.onClick as () => void)();
    expect(onSort).toHaveBeenCalledWith(MODEL.columns[0], "asc");
  });

  it("clicking the currently-ascending sorted column issues descending", () => {
    const onSort = vi.fn();
    const tree = ZeropsDataTable({
      model: MODEL,
      onLoadMore: vi.fn(),
      onSort,
      sort: { column: "id", direction: "asc" },
    });
    const header = findByAttribute(tree, "data-zerops-data-table-sort")!;
    (header.props.onClick as () => void)();
    expect(onSort).toHaveBeenCalledWith(MODEL.columns[0], "desc");
  });

  it("renders the sort prop's own arrow, not internal state", () => {
    const tree = ZeropsDataTable({
      model: MODEL,
      onLoadMore: vi.fn(),
      onSort: vi.fn(),
      sort: { column: "id", direction: "desc" },
    });
    const header = findByAttribute(tree, "data-zerops-data-table-sort")!;
    expect(header.props.children).toEqual(["id", " ↓"]);
  });

  it("a non-sortable column is not clickable and carries no native tooltip", () => {
    const tree = ZeropsDataTable({
      model: MODEL,
      onLoadMore: vi.fn(),
      onSort: vi.fn(),
    });
    const header = findByAttribute(tree, "data-zerops-data-table-column")!;
    expect(header.props.onClick).toBeUndefined();
    expect(header.props.title).toBeUndefined();
  });

  it("row count is on-demand: the count button calls onRequestCount, never automatically", () => {
    const onRequestCount = vi.fn();
    const tree = ZeropsDataTable({
      model: MODEL,
      onLoadMore: vi.fn(),
      onRequestCount,
      onSort: vi.fn(),
    });
    expect(onRequestCount).not.toHaveBeenCalled();
    const button = findByAttribute(tree, "data-zerops-data-table-request-count")!;
    (button.props.onClick as () => void)();
    expect(onRequestCount).toHaveBeenCalledTimes(1);
  });

  it("hides the count button entirely when onRequestCount is absent (a query result)", () => {
    const tree = ZeropsDataTable({
      model: MODEL,
      onLoadMore: vi.fn(),
      onSort: vi.fn(),
    });
    expect(findByAttribute(tree, "data-zerops-data-table-request-count")).toBeNull();
  });

  it("shows the count once provided, replacing the count button", () => {
    const tree = ZeropsDataTable({
      count: 12345,
      model: MODEL,
      onLoadMore: vi.fn(),
      onRequestCount: vi.fn(),
      onSort: vi.fn(),
    });
    expect(findByAttribute(tree, "data-zerops-data-table-request-count")).toBeNull();
    const countLabel = findByAttribute(tree, "data-zerops-data-table-count")!;
    expect(countLabel.props.children).toBe("12,345 rows");
  });
});
