import type { DataConsoleFilter } from "@t3tools/client-runtime/zerops/dataConsole";
import type { ZeropsDataConsoleColumn } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { visitElements } from "../../test/reactElementTree";

import { ZeropsDataFilters } from "./ZeropsDataFilters";

function findByAttribute(tree: unknown, attribute: string) {
  return visitElements(tree, (element) => attribute in element.props);
}

const column = (name: string): ZeropsDataConsoleColumn => ({
  name,
  dataType: "text",
  pk: false,
  editable: false,
  reason: "",
  sortable: true,
  sortReason: "",
});

const COLUMNS = [column("status"), column("total")];

function render(overrides: Partial<Parameters<typeof ZeropsDataFilters>[0]> = {}) {
  return ZeropsDataFilters({
    slot: "toolbar",
    columns: COLUMNS,
    filters: [],
    rawWhere: "",
    rawOpen: false,
    dirty: false,
    canClear: false,
    onChangeFilters: vi.fn(),
    onChangeRawWhere: vi.fn(),
    onToggleRaw: vi.fn(),
    onApply: vi.fn(),
    onClear: vi.fn(),
    ...overrides,
  });
}

function rows(overrides: Partial<Parameters<typeof ZeropsDataFilters>[0]> = {}) {
  return render({ slot: "rows", ...overrides });
}

describe("ZeropsDataFilters toolbar slot", () => {
  it("Add filter appends a chip on the first column", () => {
    const onChangeFilters = vi.fn();
    const tree = render({ onChangeFilters });
    (findByAttribute(tree, "data-zerops-data-filter-add")!.props.onClick as () => void)();
    expect(onChangeFilters).toHaveBeenCalledWith([{ column: "status", op: "eq", value: "" }]);
  });

  it("disables Add filter when the model has no columns yet", () => {
    const tree = render({ columns: [] });
    expect(findByAttribute(tree, "data-zerops-data-filter-add")!.props.disabled).toBe(true);
  });

  it("offers Apply only while the draft differs from what is applied", () => {
    const onApply = vi.fn();
    expect(findByAttribute(render(), "data-zerops-data-filter-apply")).toBeNull();
    const tree = render({ dirty: true, onApply });
    (findByAttribute(tree, "data-zerops-data-filter-apply")!.props.onClick as () => void)();
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it("offers Clear only when something is applied", () => {
    const onClear = vi.fn();
    expect(findByAttribute(render(), "data-zerops-data-filter-clear")).toBeNull();
    const tree = render({ canClear: true, onClear });
    (findByAttribute(tree, "data-zerops-data-filter-clear")!.props.onClick as () => void)();
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("the WHERE toggle asks the caller to open the raw clause", () => {
    const onToggleRaw = vi.fn();
    const tree = render({ onToggleRaw });
    (findByAttribute(tree, "data-zerops-data-filter-raw-toggle")!.props.onClick as () => void)();
    expect(onToggleRaw).toHaveBeenCalledTimes(1);
  });

  it("renders no chips and no raw input itself", () => {
    const tree = render({
      filters: [{ column: "status", op: "eq", value: "paid" }],
      rawOpen: true,
    });
    expect(findByAttribute(tree, "data-zerops-data-filter-column")).toBeNull();
    expect(findByAttribute(tree, "data-zerops-data-filter-raw")).toBeNull();
  });
});

describe("ZeropsDataFilters rows slot", () => {
  it("editing a chip replaces only that chip", () => {
    const filters: ReadonlyArray<DataConsoleFilter> = [
      { column: "status", op: "eq", value: "paid" },
      { column: "total", op: "gt", value: "10" },
    ];
    const onChangeFilters = vi.fn();
    const tree = rows({ filters, onChangeFilters });
    const value = visitElements(
      tree,
      (element) => element.props["data-zerops-data-filter-value"] === "1",
    )!;
    (value.props.onChange as (event: unknown) => void)({ target: { value: "20" } });
    expect(onChangeFilters).toHaveBeenCalledWith([
      filters[0],
      { column: "total", op: "gt", value: "20" },
    ]);
  });

  it("an operand-free operator hides its value input", () => {
    const tree = rows({ filters: [{ column: "status", op: "isNull" }] });
    expect(findByAttribute(tree, "data-zerops-data-filter-value")).toBeNull();
  });

  it("removing a chip drops it", () => {
    const onChangeFilters = vi.fn();
    const tree = rows({
      filters: [
        { column: "status", op: "eq", value: "paid" },
        { column: "total", op: "gt", value: "10" },
      ],
      onChangeFilters,
    });
    const remove = visitElements(
      tree,
      (element) => element.props["data-zerops-data-filter-remove"] === "0",
    )!;
    (remove.props.onClick as () => void)();
    expect(onChangeFilters).toHaveBeenCalledWith([{ column: "total", op: "gt", value: "10" }]);
  });

  it("autofocuses the value input of the chip the caller just added", () => {
    const filters: ReadonlyArray<DataConsoleFilter> = [
      { column: "status", op: "eq", value: "" },
      { column: "total", op: "eq", value: "" },
    ];
    const tree = rows({ filters, autoFocusIndex: 1 });
    expect(
      visitElements(tree, (element) => element.props["data-zerops-data-filter-value"] === "0")!
        .props.autoFocus,
    ).toBe(false);
    expect(
      visitElements(tree, (element) => element.props["data-zerops-data-filter-value"] === "1")!
        .props.autoFocus,
    ).toBe(true);
  });

  it("Enter in a chip's value input applies the draft", () => {
    const onApply = vi.fn();
    const tree = rows({ filters: [{ column: "status", op: "eq", value: "paid" }], onApply });
    const value = findByAttribute(tree, "data-zerops-data-filter-value")!;
    (value.props.onKeyDown as (event: unknown) => void)({ key: "Enter" });
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it("keeps the raw WHERE input hidden until the toggle opens it", () => {
    expect(findByAttribute(rows(), "data-zerops-data-filter-raw")).toBeNull();
    const onChangeRawWhere = vi.fn();
    const onApply = vi.fn();
    const raw = findByAttribute(
      rows({ rawOpen: true, onChangeRawWhere, onApply }),
      "data-zerops-data-filter-raw",
    )!;
    expect(raw.props.placeholder).toBe("status = 'paid' AND total > 100");
    (raw.props.onChange as (event: unknown) => void)({ target: { value: "id > 1" } });
    expect(onChangeRawWhere).toHaveBeenCalledWith("id > 1");
    (raw.props.onKeyDown as (event: unknown) => void)({ key: "Enter" });
    expect(onApply).toHaveBeenCalledTimes(1);
  });
});
