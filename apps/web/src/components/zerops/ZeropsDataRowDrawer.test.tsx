import type { ZeropsDataConsoleColumn } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { visitElements } from "../../test/reactElementTree";

import { ZeropsDataRowDrawer } from "./ZeropsDataRowDrawer";

function findByAttribute(tree: unknown, attribute: string) {
  return visitElements(tree, (element) => attribute in element.props);
}

function collect(tree: unknown, attribute: string): unknown[] {
  const values: unknown[] = [];
  visitElements(tree, (element) => {
    if (attribute in element.props) values.push(element.props[attribute]);
    return false;
  });
  return values;
}

const column = (overrides: Partial<ZeropsDataConsoleColumn> = {}): ZeropsDataConsoleColumn => ({
  name: "id",
  dataType: "integer",
  pk: false,
  editable: false,
  reason: "",
  sortable: true,
  sortReason: "",
  ...overrides,
});

const COLUMNS = [
  column({ name: "name" }),
  column({ name: "id", pk: true }),
  column({ name: "payload" }),
];
const ROW = ["orders", 7, { a: 1 }];

function render(overrides: Partial<Parameters<typeof ZeropsDataRowDrawer>[0]> = {}) {
  return ZeropsDataRowDrawer({
    columns: COLUMNS,
    row: ROW,
    layout: "wide",
    onClose: vi.fn(),
    onCopyJson: vi.fn(),
    onExplain: vi.fn(),
    ...overrides,
  });
}

describe("ZeropsDataRowDrawer", () => {
  it("lists every column, primary key first", () => {
    expect(collect(render(), "data-zerops-data-row-field")).toEqual(["id", "name", "payload"]);
  });

  it("puts the expanded column first when the drawer came from a cell expander", () => {
    expect(collect(render({ expandedColumn: "payload" }), "data-zerops-data-row-field")).toEqual([
      "payload",
      "id",
      "name",
    ]);
  });

  it("renders a JSON value pretty in a pre block", () => {
    const value = visitElements(
      render(),
      (element) => element.props["data-zerops-data-row-value"] === "payload",
    )!;
    expect(value.type).toBe("pre");
    expect(value.props.children).toBe('{\n  "a": 1\n}');
  });

  it("copies the row and hands it to the composer", () => {
    const onCopyJson = vi.fn();
    const onExplain = vi.fn();
    const tree = render({ onCopyJson, onExplain });
    (findByAttribute(tree, "data-zerops-data-row-copy")!.props.onClick as () => void)();
    (findByAttribute(tree, "data-zerops-data-row-explain")!.props.onClick as () => void)();
    expect(onCopyJson).toHaveBeenCalledTimes(1);
    expect(onExplain).toHaveBeenCalledTimes(1);
  });

  it("closes on the Back button and on Escape, ignoring other keys", () => {
    const onClose = vi.fn();
    const tree = render({ onClose });
    (findByAttribute(tree, "data-zerops-data-row-close")!.props.onClick as () => void)();
    expect(onClose).toHaveBeenCalledTimes(1);

    const drawer = findByAttribute(tree, "data-zerops-data-row-drawer")!;
    const onKeyDown = drawer.props.onKeyDown as (event: unknown) => void;
    onKeyDown({ key: "a", stopPropagation: () => {} });
    expect(onClose).toHaveBeenCalledTimes(1);
    onKeyDown({ key: "Escape", stopPropagation: () => {} });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("overlays the panel in the narrow layout and sits beside the grid in the wide one", () => {
    expect(
      findByAttribute(render({ layout: "narrow" }), "data-zerops-data-row-drawer")!.props[
        "data-zerops-data-row-drawer"
      ],
    ).toBe("narrow");
    expect(
      findByAttribute(render(), "data-zerops-data-row-drawer")!.props[
        "data-zerops-data-row-drawer"
      ],
    ).toBe("wide");
  });
});
