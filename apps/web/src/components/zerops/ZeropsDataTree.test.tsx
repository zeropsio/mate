import {
  applyTreePage,
  emptyTree,
  expandTreePath,
  treePathKey,
} from "@t3tools/client-runtime/zerops/dataConsole";
import type { ZeropsDataConsoleNode, ZeropsDataConsolePath } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { visitElements } from "../../test/reactElementTree";
import { ZeropsDataTree } from "./ZeropsDataTree";

const ROOT_PATH: ZeropsDataConsolePath = { service: "db", segments: [] };

const CONTAINER_NODE: ZeropsDataConsoleNode = {
  name: "public",
  kind: "container",
  path: { service: "db", segments: ["public"] },
  hasChildren: true,
  meta: {},
};

const OTHER_CONTAINER_NODE: ZeropsDataConsoleNode = {
  name: "billing",
  kind: "container",
  path: { service: "db", segments: ["billing"] },
  hasChildren: true,
  meta: {},
};

const LEAF_NODE: ZeropsDataConsoleNode = {
  name: "orders",
  kind: "tabular",
  path: { service: "db", segments: ["orders"] },
  hasChildren: false,
  meta: {},
};

function findByAttribute(tree: unknown, attribute: string) {
  return visitElements(tree, (element) => attribute in element.props);
}

describe("ZeropsDataTree", () => {
  it("shows Loading for a root path with no entry yet", () => {
    const tree = ZeropsDataTree({
      onLoadMore: vi.fn(),
      onSelectNode: vi.fn(),
      onToggleNode: vi.fn(),
      rootPath: ROOT_PATH,
      tree: emptyTree,
    });
    const loading = findByAttribute(tree, "data-zerops-data-tree-loading");
    expect(loading?.props.children).toBe("Loading…");
  });

  it("renders the root's nodes once loaded, including a container and a leaf", () => {
    const loaded = applyTreePage(emptyTree, ROOT_PATH, {
      nodes: [CONTAINER_NODE, LEAF_NODE],
      nextCursor: "",
    });
    const tree = ZeropsDataTree({
      onLoadMore: vi.fn(),
      onSelectNode: vi.fn(),
      onToggleNode: vi.fn(),
      rootPath: ROOT_PATH,
      tree: loaded,
    });
    const containerToggle = findByAttribute(tree, "data-zerops-data-tree-toggle");
    expect(containerToggle?.props.children).toContain("public");
    const leaf = findByAttribute(tree, "data-zerops-data-tree-node");
    expect(leaf?.props.children).toBe("orders");
  });

  // Two containers: one alone at a level is collapsed away and has no toggle
  // of its own, so a toggle only exists where a level holds more than one node.
  it("clicking a collapsed container's toggle calls onToggleNode with that node", () => {
    const loaded = applyTreePage(emptyTree, ROOT_PATH, {
      nodes: [CONTAINER_NODE, OTHER_CONTAINER_NODE],
      nextCursor: "",
    });
    const onToggleNode = vi.fn();
    const tree = ZeropsDataTree({
      onLoadMore: vi.fn(),
      onSelectNode: vi.fn(),
      onToggleNode,
      rootPath: ROOT_PATH,
      tree: loaded,
    });
    // `applyTreePage` orders a level by name, so `billing` is the first toggle.
    const toggle = findByAttribute(tree, "data-zerops-data-tree-toggle")!;
    expect(toggle.props["aria-expanded"]).toBe(false);
    (toggle.props.onClick as () => void)();
    expect(onToggleNode).toHaveBeenCalledWith(OTHER_CONTAINER_NODE);
  });

  it("disables Load more while its own path is pending", () => {
    const loaded = applyTreePage(emptyTree, ROOT_PATH, {
      nodes: [LEAF_NODE],
      nextCursor: "cursor-1",
    });
    const tree = ZeropsDataTree({
      loadingKeys: new Set([treePathKey(ROOT_PATH)]),
      onLoadMore: vi.fn(),
      onSelectNode: vi.fn(),
      onToggleNode: vi.fn(),
      rootPath: ROOT_PATH,
      tree: loaded,
    });
    const loadMore = findByAttribute(tree, "data-zerops-data-tree-load-more")!;
    expect(loadMore.props.disabled).toBe(true);
  });

  it("shows Loading for an expanded container whose page has not arrived yet", () => {
    let withRoot = applyTreePage(emptyTree, ROOT_PATH, {
      nodes: [CONTAINER_NODE],
      nextCursor: "",
    });
    withRoot = expandTreePath(withRoot, CONTAINER_NODE.path);

    const tree = ZeropsDataTree({
      onLoadMore: vi.fn(),
      onSelectNode: vi.fn(),
      onToggleNode: vi.fn(),
      rootPath: ROOT_PATH,
      tree: withRoot,
    });
    const loading = findByAttribute(tree, "data-zerops-data-tree-loading")!;
    expect(loading.props["data-zerops-data-tree-loading"]).toBe(treePathKey(CONTAINER_NODE.path));
  });

  it("shows 'No items.' for an expanded container whose page arrived and is genuinely empty", () => {
    let withRoot = applyTreePage(emptyTree, ROOT_PATH, {
      nodes: [CONTAINER_NODE],
      nextCursor: "",
    });
    withRoot = expandTreePath(withRoot, CONTAINER_NODE.path);
    withRoot = applyTreePage(withRoot, CONTAINER_NODE.path, { nodes: [], nextCursor: "" });

    const tree = ZeropsDataTree({
      onLoadMore: vi.fn(),
      onSelectNode: vi.fn(),
      onToggleNode: vi.fn(),
      rootPath: ROOT_PATH,
      tree: withRoot,
    });
    const nested = findByAttribute(tree, "data-zerops-data-tree-list");
    expect(visitElements(nested, (el) => el.props.children === "No items.")).not.toBeNull();
  });

  it("renders an expanded container's loaded children", () => {
    let withRoot = applyTreePage(emptyTree, ROOT_PATH, {
      nodes: [CONTAINER_NODE],
      nextCursor: "",
    });
    withRoot = expandTreePath(withRoot, CONTAINER_NODE.path);
    withRoot = applyTreePage(withRoot, CONTAINER_NODE.path, {
      nodes: [LEAF_NODE],
      nextCursor: "",
    });

    const tree = ZeropsDataTree({
      onLoadMore: vi.fn(),
      onSelectNode: vi.fn(),
      onToggleNode: vi.fn(),
      rootPath: ROOT_PATH,
      tree: withRoot,
    });
    const leaf = findByAttribute(tree, "data-zerops-data-tree-node");
    expect(leaf?.props["data-zerops-data-tree-node"]).toBe(treePathKey(LEAF_NODE.path));
  });

  it("Load more calls onLoadMore with the entry's path and cursor", () => {
    const loaded = applyTreePage(emptyTree, ROOT_PATH, {
      nodes: [LEAF_NODE],
      nextCursor: "cursor-1",
    });
    const onLoadMore = vi.fn();
    const tree = ZeropsDataTree({
      onLoadMore,
      onSelectNode: vi.fn(),
      onToggleNode: vi.fn(),
      rootPath: ROOT_PATH,
      tree: loaded,
    });
    const loadMore = findByAttribute(tree, "data-zerops-data-tree-load-more")!;
    (loadMore.props.onClick as () => void)();
    expect(onLoadMore).toHaveBeenCalledWith(ROOT_PATH, "cursor-1");
  });

  it("selecting a leaf node calls onSelectNode with that node", () => {
    const loaded = applyTreePage(emptyTree, ROOT_PATH, {
      nodes: [LEAF_NODE],
      nextCursor: "",
    });
    const onSelectNode = vi.fn();
    const tree = ZeropsDataTree({
      onLoadMore: vi.fn(),
      onSelectNode,
      onToggleNode: vi.fn(),
      rootPath: ROOT_PATH,
      tree: loaded,
    });
    const leaf = findByAttribute(tree, "data-zerops-data-tree-node")!;
    (leaf.props.onClick as () => void)();
    expect(onSelectNode).toHaveBeenCalledWith(LEAF_NODE);
  });

  it("marks the selected leaf node as selected", () => {
    const loaded = applyTreePage(emptyTree, ROOT_PATH, {
      nodes: [LEAF_NODE],
      nextCursor: "",
    });
    const tree = ZeropsDataTree({
      onLoadMore: vi.fn(),
      onSelectNode: vi.fn(),
      onToggleNode: vi.fn(),
      rootPath: ROOT_PATH,
      selectedNodeKey: treePathKey(LEAF_NODE.path),
      tree: loaded,
    });
    const leaf = findByAttribute(tree, "data-zerops-data-tree-node")!;
    expect(leaf.props["aria-selected"]).toBe(true);
  });

  it("renders a lone container's children in its place, at the parent's indent", () => {
    let withRoot = applyTreePage(emptyTree, ROOT_PATH, {
      nodes: [CONTAINER_NODE],
      nextCursor: "",
    });
    withRoot = applyTreePage(withRoot, CONTAINER_NODE.path, {
      nodes: [LEAF_NODE],
      nextCursor: "",
    });

    const tree = ZeropsDataTree({
      onLoadMore: vi.fn(),
      onSelectNode: vi.fn(),
      onToggleNode: vi.fn(),
      rootPath: ROOT_PATH,
      tree: withRoot,
    });

    expect(findByAttribute(tree, "data-zerops-data-tree-toggle")).toBeNull();
    const leaf = findByAttribute(tree, "data-zerops-data-tree-node")!;
    expect(leaf.props["data-zerops-data-tree-node"]).toBe(treePathKey(LEAF_NODE.path));
    const list = findByAttribute(tree, "data-zerops-data-tree-list")!;
    expect(list.props["data-zerops-data-tree-list"]).toBe(treePathKey(CONTAINER_NODE.path));
  });

  it("keeps a lone container's row when a cursor promises more nodes at that level", () => {
    const loaded = applyTreePage(emptyTree, ROOT_PATH, {
      nodes: [CONTAINER_NODE],
      nextCursor: "more",
    });

    const tree = ZeropsDataTree({
      onLoadMore: vi.fn(),
      onSelectNode: vi.fn(),
      onToggleNode: vi.fn(),
      rootPath: ROOT_PATH,
      tree: loaded,
    });

    expect(findByAttribute(tree, "data-zerops-data-tree-toggle")).not.toBeNull();
  });
});
