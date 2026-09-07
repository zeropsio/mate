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
    columns: COLUMNS,
    filters: [],
    rawWhere: "",
    canClear: false,
    onChangeFilters: vi.fn(),
    onChangeRawWhere: vi.fn(),
    onApply: vi.fn(),
    onClear: vi.fn(),
    ...overrides,
  });
}

describe("ZeropsDataFilters", () => {
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

  it("editing a chip replaces only that chip", () => {
    const filters: ReadonlyArray<DataConsoleFilter> = [
      { column: "status", op: "eq", value: "paid" },
      { column: "total", op: "gt", value: "10" },
    ];
    const onChangeFilters = vi.fn();
    const tree = render({ filters, onChangeFilters });
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
    const tree = render({ filters: [{ column: "status", op: "isNull" }] });
    expect(findByAttribute(tree, "data-zerops-data-filter-value")).toBeNull();
  });

  it("removing a chip drops it", () => {
    const onChangeFilters = vi.fn();
    const tree = render({
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

  it("carries the raw WHERE escape hatch and its placeholder", () => {
    const onChangeRawWhere = vi.fn();
    const tree = render({ onChangeRawWhere });
    const raw = findByAttribute(tree, "data-zerops-data-filter-raw")!;
    expect(raw.props.placeholder).toBe("raw WHERE, e.g. status = 'paid'");
    (raw.props.onChange as (event: unknown) => void)({ target: { value: "id > 1" } });
    expect(onChangeRawWhere).toHaveBeenCalledWith("id > 1");
  });

  it("Apply and Clear reach the caller, and Clear hides until there is something to clear", () => {
    const onApply = vi.fn();
    const onClear = vi.fn();
    expect(findByAttribute(render(), "data-zerops-data-filter-clear")).toBeNull();
    const tree = render({ canClear: true, onApply, onClear });
    (findByAttribute(tree, "data-zerops-data-filter-apply")!.props.onClick as () => void)();
    (findByAttribute(tree, "data-zerops-data-filter-clear")!.props.onClick as () => void)();
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
