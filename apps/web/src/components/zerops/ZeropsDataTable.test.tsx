import type { DataConsoleTableModel } from "@t3tools/client-runtime/zerops/dataConsole";
import type { ZeropsDataConsoleColumn } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { reactHookHarness as hooks } from "../../test/reactHookHarness";
import { visitElements } from "../../test/reactElementTree";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { reactHookHarness } = await import("../../test/reactHookHarness");
  return {
    ...actual,
    useRef: reactHookHarness.useRef,
  };
});

vi.mock("react/compiler-runtime", async () => {
  const { reactHookHarness } = await import("../../test/reactHookHarness");
  return { c: reactHookHarness.useMemoCache };
});

import { ZeropsDataCell } from "./ZeropsDataCell";
import { ZeropsDataTable, type ZeropsDataTableProps } from "./ZeropsDataTable";

function findByAttribute(tree: unknown, attribute: string) {
  return visitElements(tree, (element) => attribute in element.props);
}

function findByAttributeValue(tree: unknown, attribute: string, value: string) {
  return visitElements(tree, (element) => element.props[attribute] === value);
}

/** Cells are `ZeropsDataCell` elements, never invoked when the table is called as a plain
 * function — the value under test is the prop on the element itself. */
function cellValues(tree: unknown): unknown[] {
  const values: unknown[] = [];
  visitElements(tree, (element) => {
    if (element.type === ZeropsDataCell) values.push(element.props.value);
    return false;
  });
  return values;
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
    column({ name: "name", pk: false, sortable: false, sortReason: "no index" }),
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
  beforeEach(() => {
    hooks.reset();
  });

  it("renders one cell per visible column, in row order", () => {
    const tree = ZeropsDataTable({
      model: MODEL,
      onLoadMore: vi.fn(),
      onSort: vi.fn(),
    });
    expect(cellValues(tree)).toEqual([1, "orders", 2, "customers"]);
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

  it("a non-sortable column is not clickable and explains itself with sortReason", () => {
    const tree = ZeropsDataTable({
      model: MODEL,
      onLoadMore: vi.fn(),
      onSort: vi.fn(),
    });
    const header = findByAttribute(tree, "data-zerops-data-table-column")!;
    expect(header.props.onClick).toBeUndefined();
    expect(header.props.title).toBe("no index");
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

  it("hides a hidden column but never a primary key", () => {
    const tree = ZeropsDataTable({
      hiddenColumns: new Set(["id", "name"]),
      model: MODEL,
      onLoadMore: vi.fn(),
      onSort: vi.fn(),
    });
    expect(cellValues(tree)).toEqual([1, 2]);
  });

  it("the column picker checks a pk column and disables its checkbox", () => {
    const onToggleColumn = vi.fn();
    const tree = ZeropsDataTable({
      columnsOpen: true,
      hiddenColumns: new Set(["name"]),
      model: MODEL,
      onLoadMore: vi.fn(),
      onSort: vi.fn(),
      onToggleColumn,
      onToggleColumnsOpen: vi.fn(),
    });
    const pk = findByAttributeValue(tree, "data-zerops-data-table-column-toggle", "id")!;
    expect(pk.props.checked).toBe(true);
    expect(pk.props.disabled).toBe(true);

    const name = findByAttributeValue(tree, "data-zerops-data-table-column-toggle", "name")!;
    expect(name.props.checked).toBe(false);
    (name.props.onChange as () => void)();
    expect(onToggleColumn).toHaveBeenCalledWith("name");
  });

  it("keeps the column picker closed until its own toggle asks for it", () => {
    const onToggleColumnsOpen = vi.fn();
    const tree = ZeropsDataTable({
      model: MODEL,
      onLoadMore: vi.fn(),
      onSort: vi.fn(),
      onToggleColumn: vi.fn(),
      onToggleColumnsOpen,
    });
    expect(findByAttribute(tree, "data-zerops-data-table-column-picker")).toBeNull();
    (findByAttribute(tree, "data-zerops-data-table-columns")!.props.onClick as () => void)();
    expect(onToggleColumnsOpen).toHaveBeenCalledTimes(1);
  });

  it("a row click opens that row", () => {
    const onOpenRow = vi.fn();
    const tree = ZeropsDataTable({
      model: MODEL,
      onLoadMore: vi.fn(),
      onOpenRow,
      onSort: vi.fn(),
    });
    const row = findByAttributeValue(tree, "data-zerops-data-table-row", "1")!;
    (row.props.onClick as () => void)();
    expect(onOpenRow).toHaveBeenCalledWith(1);
  });

  it("a cell expander asks for that row and column", () => {
    const onExpandCell = vi.fn();
    const tree = ZeropsDataTable({
      model: MODEL,
      onExpandCell,
      onLoadMore: vi.fn(),
      onSort: vi.fn(),
    });
    const cells = visitElements(tree, (element) => element.type === ZeropsDataCell)!;
    (cells.props.onExpand as () => void)();
    expect(onExpandCell).toHaveBeenCalledWith(0, "id");
  });

  it("marks the focused row selected", () => {
    const tree = ZeropsDataTable({
      focusedRowIndex: 1,
      model: MODEL,
      onLoadMore: vi.fn(),
      onSort: vi.fn(),
    });
    const row = findByAttributeValue(tree, "data-zerops-data-table-row", "1")!;
    expect(row.props["aria-selected"]).toBe(true);
  });

  it("shows a header row and a No rows line for an empty model", () => {
    const tree = ZeropsDataTable({
      model: { ...MODEL, rows: [] },
      onLoadMore: vi.fn(),
      onSort: vi.fn(),
    });
    expect(findByAttribute(tree, "data-zerops-data-table-sort")).not.toBeNull();
    expect(findByAttribute(tree, "data-zerops-data-table-empty")!.props.children).toBe("No rows");
  });

  it("labels the grid filtered only while a filter is applied", () => {
    expect(
      findByAttribute(
        ZeropsDataTable({ model: MODEL, onLoadMore: vi.fn(), onSort: vi.fn() }),
        "data-zerops-data-table-filtered",
      ),
    ).toBeNull();
    expect(
      findByAttribute(
        ZeropsDataTable({ filtered: true, model: MODEL, onLoadMore: vi.fn(), onSort: vi.fn() }),
        "data-zerops-data-table-filtered",
      ),
    ).not.toBeNull();
  });

  it("offers the table hand-offs only when the caller wired them", () => {
    const onAskAboutTable = vi.fn();
    const onCopyPageJson = vi.fn();
    const bare = ZeropsDataTable({ model: MODEL, onLoadMore: vi.fn(), onSort: vi.fn() });
    expect(findByAttribute(bare, "data-zerops-data-table-ask")).toBeNull();
    expect(findByAttribute(bare, "data-zerops-data-table-copy")).toBeNull();

    const wired = ZeropsDataTable({
      model: MODEL,
      onAskAboutTable,
      onCopyPageJson,
      onLoadMore: vi.fn(),
      onSort: vi.fn(),
    });
    (findByAttribute(wired, "data-zerops-data-table-ask")!.props.onClick as () => void)();
    (findByAttribute(wired, "data-zerops-data-table-copy")!.props.onClick as () => void)();
    expect(onAskAboutTable).toHaveBeenCalledTimes(1);
    expect(onCopyPageJson).toHaveBeenCalledTimes(1);
  });

  describe("notice", () => {
    it("replaces the rows and drops the status bar entirely", () => {
      hooks.beginRender();
      const tree = ZeropsDataTable({
        count: 12,
        model: { ...MODEL, rows: [], nextCursor: "cursor-1" },
        notice: "Couldn't load rows",
        onLoadMore: vi.fn(),
        onRequestCount: vi.fn(),
        onSort: vi.fn(),
      });
      expect(findByAttribute(tree, "data-zerops-data-table-empty")).toBeNull();
      expect(findByAttribute(tree, "data-zerops-data-table-status")).toBeNull();
      expect(findByAttribute(tree, "data-zerops-data-table-request-count")).toBeNull();
      expect(findByAttribute(tree, "data-zerops-data-table-sentinel")).toBeNull();
      expect(findByAttribute(tree, "data-zerops-data-table-notice")!.props.children).toBe(
        "Couldn't load rows",
      );
    });
  });

  describe("paging by scroll", () => {
    interface ObserverStub {
      readonly callback: (entries: ReadonlyArray<{ readonly isIntersecting: boolean }>) => void;
      readonly options: { readonly root: unknown; readonly rootMargin: string };
      readonly observed: unknown[];
      readonly disconnected: () => number;
    }

    let stubs: ObserverStub[] = [];
    const original = Reflect.get(globalThis, "IntersectionObserver") as unknown;

    beforeEach(() => {
      stubs = [];
      Reflect.set(
        globalThis,
        "IntersectionObserver",
        class {
          constructor(callback: ObserverStub["callback"], options: ObserverStub["options"]) {
            const observed: unknown[] = [];
            let disconnects = 0;
            stubs.push({ callback, options, observed, disconnected: () => disconnects });
            Object.assign(this, {
              observe: (node: unknown) => observed.push(node),
              disconnect: () => {
                disconnects += 1;
              },
              unobserve: () => {},
            });
          }
        },
      );
    });

    afterEach(() => {
      Reflect.set(globalThis, "IntersectionObserver", original);
    });

    function renderTable(overrides: Partial<ZeropsDataTableProps> = {}) {
      hooks.beginRender();
      return ZeropsDataTable({
        model: { ...MODEL, nextCursor: "cursor-1" },
        onLoadMore: vi.fn(),
        onSort: vi.fn(),
        ...overrides,
      });
    }

    /** Runs the ref callbacks React would run on mount: the scroll region, then the sentinel. */
    function mount(tree: unknown): void {
      const grid = findByAttribute(tree, "data-zerops-data-table-grid")!;
      (grid.props.ref as (node: unknown) => void)({ id: "scroll-region" });
      const sentinel = findByAttribute(tree, "data-zerops-data-table-sentinel")!;
      (sentinel.props.ref as (node: unknown) => void)({ id: "sentinel" });
    }

    it("renders the sentinel only while another page exists", () => {
      expect(
        findByAttribute(renderTable({ model: MODEL }), "data-zerops-data-table-sentinel"),
      ).toBeNull();
      expect(findByAttribute(renderTable(), "data-zerops-data-table-sentinel")).not.toBeNull();
    });

    it("roots the observer on the scroll region and watches the sentinel", () => {
      mount(renderTable());
      expect(stubs).toHaveLength(1);
      expect(stubs[0]!.options.root).toEqual({ id: "scroll-region" });
      expect(stubs[0]!.options.rootMargin).toBe("200px");
      expect(stubs[0]!.observed).toEqual([{ id: "sentinel" }]);
    });

    it("pages once when the sentinel comes into view", () => {
      const onLoadMore = vi.fn();
      mount(renderTable({ onLoadMore }));
      stubs[0]!.callback([{ isIntersecting: false }]);
      expect(onLoadMore).not.toHaveBeenCalled();
      stubs[0]!.callback([{ isIntersecting: true }]);
      expect(onLoadMore).toHaveBeenCalledTimes(1);
    });

    it("does not page while a page is already in flight", () => {
      const onLoadMore = vi.fn();
      mount(renderTable({ onLoadMore }));
      renderTable({ onLoadMore, loadMorePending: true });
      stubs[0]!.callback([{ isIntersecting: true }]);
      expect(onLoadMore).not.toHaveBeenCalled();
    });

    it("leaves paging to the button where IntersectionObserver is missing", () => {
      Reflect.set(globalThis, "IntersectionObserver", undefined);
      const onLoadMore = vi.fn();
      const tree = renderTable({ onLoadMore });
      mount(tree);
      expect(stubs).toHaveLength(0);
      (findByAttribute(tree, "data-zerops-data-table-load-more")!.props.onClick as () => void)();
      expect(onLoadMore).toHaveBeenCalledTimes(1);
    });
  });

  describe("status bar", () => {
    it("counts the rows it has and says whether more are available", () => {
      hooks.beginRender();
      expect(
        findByAttribute(
          ZeropsDataTable({ model: MODEL, onLoadMore: vi.fn(), onSort: vi.fn() }),
          "data-zerops-data-table-loaded",
        )!.props.children,
      ).toBe("2 rows loaded");

      hooks.beginRender();
      expect(
        findByAttribute(
          ZeropsDataTable({
            model: { ...MODEL, nextCursor: "cursor-1" },
            onLoadMore: vi.fn(),
            onSort: vi.fn(),
          }),
          "data-zerops-data-table-loaded",
        )!.props.children,
      ).toBe("2 rows loaded · more available");
    });

    it("says a page is in flight while one is", () => {
      hooks.beginRender();
      expect(
        findByAttribute(
          ZeropsDataTable({ model: MODEL, onLoadMore: vi.fn(), onSort: vi.fn() }),
          "data-zerops-data-table-loading",
        ),
      ).toBeNull();

      hooks.beginRender();
      expect(
        findByAttribute(
          ZeropsDataTable({
            loadMorePending: true,
            model: { ...MODEL, nextCursor: "cursor-1" },
            onLoadMore: vi.fn(),
            onSort: vi.fn(),
          }),
          "data-zerops-data-table-loading",
        )!.props.children,
      ).toBe("Loading…");
    });
  });

  describe("grid keyboard", () => {
    interface KeyCase {
      readonly name: string;
      readonly key: string;
      readonly focusedRowIndex?: number;
      readonly expect: (handlers: {
        readonly onFocusRow: ReturnType<typeof vi.fn>;
        readonly onOpenRow: ReturnType<typeof vi.fn>;
        readonly onEscape: ReturnType<typeof vi.fn>;
        readonly onFocusFilter: ReturnType<typeof vi.fn>;
      }) => void;
    }

    const cases: ReadonlyArray<KeyCase> = [
      {
        name: "ArrowDown from nothing focuses the first row",
        key: "ArrowDown",
        expect: ({ onFocusRow }) => expect(onFocusRow).toHaveBeenCalledWith(0),
      },
      {
        name: "ArrowDown moves down and stops at the last row",
        key: "ArrowDown",
        focusedRowIndex: 1,
        expect: ({ onFocusRow }) => expect(onFocusRow).toHaveBeenCalledWith(1),
      },
      {
        name: "ArrowUp moves up and stops at the first row",
        key: "ArrowUp",
        focusedRowIndex: 0,
        expect: ({ onFocusRow }) => expect(onFocusRow).toHaveBeenCalledWith(0),
      },
      {
        name: "Enter opens the focused row",
        key: "Enter",
        focusedRowIndex: 1,
        expect: ({ onOpenRow }) => expect(onOpenRow).toHaveBeenCalledWith(1),
      },
      {
        name: "Enter with nothing focused opens nothing",
        key: "Enter",
        expect: ({ onOpenRow }) => expect(onOpenRow).not.toHaveBeenCalled(),
      },
      {
        name: "Escape closes",
        key: "Escape",
        expect: ({ onEscape }) => expect(onEscape).toHaveBeenCalledTimes(1),
      },
      {
        name: "slash focuses the filter value",
        key: "/",
        expect: ({ onFocusFilter }) => expect(onFocusFilter).toHaveBeenCalledTimes(1),
      },
    ];

    for (const testCase of cases) {
      it(testCase.name, () => {
        const handlers = {
          onFocusRow: vi.fn(),
          onOpenRow: vi.fn(),
          onEscape: vi.fn(),
          onFocusFilter: vi.fn(),
        };
        const tree = ZeropsDataTable({
          model: MODEL,
          onLoadMore: vi.fn(),
          onSort: vi.fn(),
          ...handlers,
          ...(testCase.focusedRowIndex !== undefined
            ? { focusedRowIndex: testCase.focusedRowIndex }
            : {}),
        });
        const grid = findByAttribute(tree, "data-zerops-data-table-grid")!;
        (grid.props.onKeyDown as (event: unknown) => void)({
          key: testCase.key,
          preventDefault: () => {},
        });
        testCase.expect(handlers);
      });
    }
  });
});
