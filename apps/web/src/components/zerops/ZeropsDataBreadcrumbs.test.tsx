import type { ZeropsDataConsolePath } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { visitElements } from "../../test/reactElementTree";

import { ZeropsDataBreadcrumbs } from "./ZeropsDataBreadcrumbs";

function collect(tree: unknown, attribute: string): unknown[] {
  const values: unknown[] = [];
  visitElements(tree, (element) => {
    if (attribute in element.props) values.push(element.props[attribute]);
    return false;
  });
  return values;
}

function findByAttribute(tree: unknown, attribute: string) {
  return visitElements(tree, (element) => attribute in element.props);
}

const PATH: ZeropsDataConsolePath = { service: "db1", segments: ["public", "orders"] };

describe("ZeropsDataBreadcrumbs", () => {
  it("renders one crumb per path prefix, the last one inert", () => {
    const tree = ZeropsDataBreadcrumbs({ path: PATH, onNavigate: vi.fn() });
    expect(collect(tree, "data-zerops-data-breadcrumb")).toEqual(["db1", "public"]);
    expect(findByAttribute(tree, "data-zerops-data-breadcrumb-current")!.props.children).toBe(
      "orders",
    );
  });

  it("a crumb click navigates to that prefix", () => {
    const onNavigate = vi.fn();
    const tree = ZeropsDataBreadcrumbs({ path: PATH, onNavigate });
    const crumb = visitElements(
      tree,
      (element) => element.props["data-zerops-data-breadcrumb"] === "public",
    )!;
    (crumb.props.onClick as () => void)();
    expect(onNavigate).toHaveBeenCalledWith({ service: "db1", segments: ["public"] });
  });

  it("the service root alone is a single inert crumb", () => {
    const tree = ZeropsDataBreadcrumbs({
      path: { service: "db1", segments: [] },
      onNavigate: vi.fn(),
    });
    expect(collect(tree, "data-zerops-data-breadcrumb")).toEqual([]);
    expect(findByAttribute(tree, "data-zerops-data-breadcrumb-current")!.props.children).toBe(
      "db1",
    );
  });
});
