/**
 * The Data panel's service tree: renders a `DataConsoleTree` (client-runtime)
 * read-only, lazily expanding container nodes and paging their children.
 *
 * NOT a protected root (design-system.md R2): expand/collapse and "Load
 * more" issue a read-only `tree` request directly from the user's own
 * click, and nothing here mutates — there is no agent-mutates-only boundary
 * to keep. Purely presentational otherwise: every decision (what is loaded,
 * what is expanded) lives in the `DataConsoleTree` value its caller
 * (`ZeropsDataPanel`) passes down and updates via the client-runtime model
 * (`applyTreePage`/`expandTreePath`/`collapseTreePath`), never here.
 *
 * The recursive levels below (`renderNodeList` etc.) are plain functions,
 * not their own JSX components: calling `ZeropsDataTree` as a bare function
 * (this repo's component-test style, see `ZeropsBrowserPanel.test.tsx`)
 * only evaluates JSX actually constructed inside the function body it calls
 * — a nested `<SomeComponent/>` tag stays an unevaluated descriptor until
 * something renders it. Plain function calls evaluate immediately instead,
 * so the whole expanded tree is present and inspectable from one call.
 */
import { treePathKey, type DataConsoleTree } from "@t3tools/client-runtime/zerops/dataConsole";
import type { ZeropsDataConsoleNode, ZeropsDataConsolePath } from "@t3tools/contracts";
import type { ReactElement } from "react";

import { cn } from "~/lib/utils";
import { FlatCard } from "./primitives";

export interface ZeropsDataTreeProps {
  readonly rootPath: ZeropsDataConsolePath;
  readonly tree: DataConsoleTree;
  readonly onToggleNode: (node: ZeropsDataConsoleNode) => void;
  readonly onLoadMore: (path: ZeropsDataConsolePath, cursor: string) => void;
  readonly onSelectNode: (node: ZeropsDataConsoleNode) => void;
  readonly selectedNodeKey?: string;
  /** Path keys with a `tree` request in flight — disables that path's own "Load more" while its own append request is outstanding. "Still loading" itself reads `entry.loaded` (client-runtime), not this set: that flag is already the true "no page has landed for this path yet" signal, distinct from "loaded and genuinely empty". */
  readonly loadingKeys?: ReadonlySet<string>;
}

const NO_LOADING_KEYS: ReadonlySet<string> = new Set();

interface NodeListArgs {
  readonly path: ZeropsDataConsolePath;
  readonly tree: DataConsoleTree;
  readonly onToggleNode: (node: ZeropsDataConsoleNode) => void;
  readonly onLoadMore: (path: ZeropsDataConsolePath, cursor: string) => void;
  readonly onSelectNode: (node: ZeropsDataConsoleNode) => void;
  readonly selectedNodeKey: string | undefined;
  readonly depth: number;
  readonly loadingKeys: ReadonlySet<string>;
}

function renderNodeList({
  path,
  tree,
  onToggleNode,
  onLoadMore,
  onSelectNode,
  selectedNodeKey,
  depth,
  loadingKeys,
}: NodeListArgs): ReactElement {
  const key = treePathKey(path);
  const entry = tree.entries[key];

  if (entry === undefined || !entry.loaded) {
    return (
      <p
        className="text-muted-foreground text-xs"
        data-zerops-data-tree-loading={key}
        style={{ paddingLeft: depth * 12 }}
      >
        Loading…
      </p>
    );
  }

  return (
    <ul className="space-y-0.5" data-zerops-data-tree-list={key}>
      {entry.nodes.length === 0 ? (
        <li className="text-muted-foreground text-xs" style={{ paddingLeft: depth * 12 }}>
          No items.
        </li>
      ) : null}
      {entry.nodes.map((node) => (
        <li key={treePathKey(node.path)} style={{ paddingLeft: depth * 12 }}>
          {node.kind === "container"
            ? renderContainerNode({
                depth,
                loadingKeys,
                node,
                onLoadMore,
                onSelectNode,
                onToggleNode,
                selectedNodeKey,
                tree,
              })
            : renderLeafNode({ node, onSelectNode, selectedNodeKey })}
        </li>
      ))}
      {entry.nextCursor !== undefined ? (
        <li style={{ paddingLeft: depth * 12 }}>
          <button
            className="text-[11px] text-muted-foreground underline decoration-dotted underline-offset-2 disabled:opacity-50"
            data-zerops-data-tree-load-more={key}
            disabled={loadingKeys.has(key)}
            onClick={() => onLoadMore(path, entry.nextCursor as string)}
            type="button"
          >
            Load more
          </button>
        </li>
      ) : null}
    </ul>
  );
}

interface ContainerNodeArgs {
  readonly node: ZeropsDataConsoleNode;
  readonly tree: DataConsoleTree;
  readonly onToggleNode: (node: ZeropsDataConsoleNode) => void;
  readonly onLoadMore: (path: ZeropsDataConsolePath, cursor: string) => void;
  readonly onSelectNode: (node: ZeropsDataConsoleNode) => void;
  readonly selectedNodeKey: string | undefined;
  readonly depth: number;
  readonly loadingKeys: ReadonlySet<string>;
}

function renderContainerNode({
  node,
  tree,
  onToggleNode,
  onLoadMore,
  onSelectNode,
  selectedNodeKey,
  depth,
  loadingKeys,
}: ContainerNodeArgs): ReactElement {
  const key = treePathKey(node.path);
  const entry = tree.entries[key];
  const expanded = entry?.expanded ?? false;

  return (
    <div>
      <button
        aria-expanded={expanded}
        className="text-xs"
        data-zerops-data-tree-toggle={key}
        onClick={() => onToggleNode(node)}
        type="button"
      >
        {expanded ? "▾" : "▸"} {node.name}
      </button>
      {expanded
        ? renderNodeList({
            depth: depth + 1,
            loadingKeys,
            onLoadMore,
            onSelectNode,
            onToggleNode,
            path: node.path,
            selectedNodeKey,
            tree,
          })
        : null}
    </div>
  );
}

function renderLeafNode({
  node,
  onSelectNode,
  selectedNodeKey,
}: {
  readonly node: ZeropsDataConsoleNode;
  readonly onSelectNode: (node: ZeropsDataConsoleNode) => void;
  readonly selectedNodeKey: string | undefined;
}): ReactElement {
  const key = treePathKey(node.path);
  const selected = key === selectedNodeKey;

  return (
    <button
      aria-selected={selected}
      className={cn("text-xs", selected && "font-semibold text-foreground")}
      data-zerops-data-tree-node={key}
      data-zerops-data-tree-node-kind={node.kind}
      onClick={() => onSelectNode(node)}
      type="button"
    >
      {node.name}
    </button>
  );
}

export function ZeropsDataTree({
  rootPath,
  tree,
  onToggleNode,
  onLoadMore,
  onSelectNode,
  selectedNodeKey,
  loadingKeys = NO_LOADING_KEYS,
}: ZeropsDataTreeProps) {
  return (
    <FlatCard className="space-y-1 p-2" data-zerops-data-tree>
      {renderNodeList({
        depth: 0,
        loadingKeys,
        onLoadMore,
        onSelectNode,
        onToggleNode,
        path: rootPath,
        selectedNodeKey,
        tree,
      })}
    </FlatCard>
  );
}
