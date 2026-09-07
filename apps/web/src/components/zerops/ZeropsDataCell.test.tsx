import { describe, expect, it, vi } from "vite-plus/test";

import { visitElements } from "../../test/reactElementTree";

import { cellNeedsExpander, ZeropsDataCell } from "./ZeropsDataCell";

function findByAttribute(tree: unknown, attribute: string) {
  return visitElements(tree, (element) => attribute in element.props);
}

const LONG_TEXT = "x".repeat(200);

describe("ZeropsDataCell", () => {
  interface Case {
    readonly name: string;
    readonly value: unknown;
    readonly oneLine: string;
    readonly expander: boolean;
  }

  const cases: ReadonlyArray<Case> = [
    { name: "null", value: null, oneLine: "NULL", expander: false },
    { name: "a short string", value: "orders", oneLine: "orders", expander: false },
    { name: "a number", value: 42, oneLine: "42", expander: false },
    {
      name: "a long string",
      value: LONG_TEXT,
      oneLine: `${"x".repeat(120)}…`,
      expander: true,
    },
    {
      name: "a JSON container",
      value: { a: 1 },
      oneLine: '{"a":1}',
      expander: true,
    },
  ];

  for (const testCase of cases) {
    it(`renders ${testCase.name} as one line${testCase.expander ? " with an expander" : ""}`, () => {
      const tree = ZeropsDataCell({ value: testCase.value, onExpand: vi.fn() });
      expect(visitElements(tree, (el) => el.props.children === testCase.oneLine)).not.toBeNull();
      expect(findByAttribute(tree, "data-zerops-data-cell-expand") !== null).toBe(
        testCase.expander,
      );
      expect(cellNeedsExpander(testCase.value)).toBe(testCase.expander);
    });
  }

  it("drops the expander when the caller wired no handler", () => {
    const tree = ZeropsDataCell({ value: LONG_TEXT, onExpand: undefined });
    expect(findByAttribute(tree, "data-zerops-data-cell-expand")).toBeNull();
  });

  it("the expander asks its caller and does not bubble into the row click", () => {
    const onExpand = vi.fn();
    const stopPropagation = vi.fn();
    const tree = ZeropsDataCell({ value: LONG_TEXT, onExpand });
    const button = findByAttribute(tree, "data-zerops-data-cell-expand")!;
    (button.props.onClick as (event: unknown) => void)({ stopPropagation });
    expect(onExpand).toHaveBeenCalledTimes(1);
    expect(stopPropagation).toHaveBeenCalledTimes(1);
  });
});
