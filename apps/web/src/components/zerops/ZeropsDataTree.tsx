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
  /** Hides a node from the tree's own display without touching the fetched entry — object storage's tree shows only prefixes, the blobs inside them show up in the grid listing instead. Never affects loading/paging, only which of the already-loaded nodes render. */
  readonly nodeFilter?: (node: ZeropsDataConsoleNode) => boolean;
  /** Present for a family whose container level has its own grid listing (object storage's prefixes, a KV namespace's keys) — a container's name becomes a second click target, selecting it (for the listing) without expanding/collapsing the tree the way the toggle arrow does. */
  readonly onSelectContainer?: (node: ZeropsDataConsoleNode) => void;
  readonly selectedContainerKey?: string;
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
  readonly nodeFilter: ((node: ZeropsDataConsoleNode) => boolean) | undefined;
  readonly onSelectContainer: ((node: ZeropsDataConsoleNode) => void) | undefined;
  readonly selectedContainerKey: string | undefined;
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
  nodeFilter,
  onSelectContainer,
  selectedContainerKey,
}: NodeListArgs): ReactElement {
  const key = treePathKey(path);
  const entry = tree.entries[key];

  // A level holding exactly one container, with no cursor promising more,
  // says nothing the level above did not: render its children in its place,
  // at this indent, with no row of its own (`collapsedPrefix`, client-runtime).
  const onlyNode = entry?.loaded === true && entry.nodes.length === 1 ? entry.nodes[0] : undefined;
  if (
    onlyNode !== undefined &&
    onlyNode.kind === "container" &&
    onlyNode.hasChildren &&
    entry?.nextCursor === undefined
  ) {
    return renderNodeList({
      depth,
      loadingKeys,
      nodeFilter,
      onLoadMore,
      onSelectContainer,
      onSelectNode,
      onToggleNode,
      path: onlyNode.path,
      selectedContainerKey,
      selectedNodeKey,
      tree,
    });
  }

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

  const visibleNodes = nodeFilter === undefined ? entry.nodes : entry.nodes.filter(nodeFilter);

  return (
    <ul className="space-y-0.5" data-zerops-data-tree-list={key}>
      {visibleNodes.length === 0 ? (
        <li className="text-muted-foreground text-xs" style={{ paddingLeft: depth * 12 }}>
          No items.
        </li>
      ) : null}
      {visibleNodes.map((node) => (
        <li key={treePathKey(node.path)} style={{ paddingLeft: depth * 12 }}>
          {node.kind === "container"
            ? renderContainerNode({
                depth,
                loadingKeys,
                node,
                nodeFilter,
                onLoadMore,
                onSelectContainer,
                onSelectNode,
                onToggleNode,
                selectedContainerKey,
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
  readonly nodeFilter: ((node: ZeropsDataConsoleNode) => boolean) | undefined;
  readonly onSelectContainer: ((node: ZeropsDataConsoleNode) => void) | undefined;
  readonly selectedContainerKey: string | undefined;
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
  nodeFilter,
  onSelectContainer,
  selectedContainerKey,
}: ContainerNodeArgs): ReactElement {
  const key = treePathKey(node.path);
  const entry = tree.entries[key];
  const expanded = entry?.expanded ?? false;
  const selected = key === selectedContainerKey;

  return (
    <div>
      <span className="inline-flex items-center gap-1">
        <button
          aria-expanded={expanded}
          className="text-xs"
          data-zerops-data-tree-toggle={key}
          onClick={() => onToggleNode(node)}
          type="button"
        >
          {expanded ? "▾" : "▸"}
        </button>
        {onSelectContainer === undefined ? (
          <span className="text-xs">{node.name}</span>
        ) : (
          <button
            aria-selected={selected}
            className={cn("text-xs", selected && "font-semibold text-foreground")}
            data-zerops-data-tree-container={key}
            onClick={() => onSelectContainer(node)}
            type="button"
          >
            {node.name}
          </button>
        )}
      </span>
      {expanded
        ? renderNodeList({
            depth: depth + 1,
            loadingKeys,
            nodeFilter,
            onLoadMore,
            onSelectContainer,
            onSelectNode,
            onToggleNode,
            path: node.path,
            selectedContainerKey,
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
  nodeFilter,
  onSelectContainer,
  selectedContainerKey,
}: ZeropsDataTreeProps) {
  return (
    <FlatCard className="space-y-1 p-2" data-zerops-data-tree>
      {renderNodeList({
        depth: 0,
        loadingKeys,
        nodeFilter,
        onLoadMore,
        onSelectContainer,
        onSelectNode,
        onToggleNode,
        path: rootPath,
        selectedContainerKey,
        selectedNodeKey,
        tree,
      })}
    </FlatCard>
  );
}
