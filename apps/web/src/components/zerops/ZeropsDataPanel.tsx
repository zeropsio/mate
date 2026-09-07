/**
 * The Data panel: browse a Zerops project's managed data services
 * (Postgres/Mongo/etc trees, tables, blobs) read-only, brokered by the mate
 * server to a zcp-side console process (S-dataconsole slice 1,
 * `../../../../../zcp/docs/spec-mate.md` §5 "Data surface",
 * `../../../../../zcp/docs/spec-dataconsole.md` §4.3).
 *
 * NOT a protected root (design-system.md R2): unlike `ZeropsServiceMap` /
 * `ZeropsLifecycleStrip` / `ZeropsOperationCard` / `ZeropsQuickActions`, this
 * panel issues its RPC calls (`zeropsDataConsoleCall`) directly from the
 * user's own clicks — selecting a service, expanding a tree node, sorting a
 * column, running a query. Unlike `ZeropsBrowserPanel` (also not a protected
 * root, but for the opposite reason — its RPC mutates the agent's shared
 * browser), every request this panel issues is read-only in this slice, so
 * there is no agent-mutates-only boundary to keep either way.
 *
 * State lives here, not in the subcomponents (`ZeropsDataTree`,
 * `ZeropsDataTable`, `ZeropsDataBlob`, `ZeropsDataQuery`): they are plain
 * presentational views over a value this panel fetched and a callback that
 * asks for the next one, which keeps each of them testable without an RPC
 * mock of its own.
 *
 * The initial `services` listing fires as soon as the session reaches
 * `"ready"` — adjusting state during render, guarded by a ref so it only
 * fires once per environment, the same pattern `ZeropsBrowserPanel` uses for
 * its take-over reset. There is no user click to hang the first fetch off
 * of, and this codebase has no `useEffect`-driven data fetch to mirror
 * instead (see that file's own comment on the pattern). `ChatView` mounts
 * this panel `key`ed by `environmentId`, so an environment switch remounts
 * it fresh rather than needing its own reset path here.
 *
 * Two guards keep the RPC traffic honest under rapid clicking and slow
 * responses:
 * - **No duplicate in flight.** `pendingTreeKeys`/`tableLoadMorePending`/
 *   `queryLoadMorePending` gate `loadTreePage`/`handleTableLoadMore`/
 *   `handleQueryLoadMore` — a second click while the first request for the
 *   same target is outstanding is a no-op, and the corresponding "Load
 *   more" button renders disabled meanwhile.
 * - **Stale responses are dropped, never applied.** Selecting a different
 *   node/service or changing a sort bumps that target's token
 *   (`selectionTokenRef` for the tree-node/blob/table target,
 *   `queryTokenRef` for the query target); every response checks its own
 *   captured token against the ref's current value before touching state,
 *   so a slow response for a selection the user has since moved on from
 *   never clobbers what is now on screen.
 *
 * Sort state (`tableSort`/`querySort`) lives here, not in `ZeropsDataTable`
 * — it has to be merged into every subsequent "Load more" page request for
 * the same target, and it resets to `undefined` whenever that target's
 * model is replaced wholesale (a new selection, a new query run), which is
 * exactly when a token bump already happens.
 *
 * "Still loading" vs. "loaded and expanded" for a tree path is entirely the
 * client-runtime tree's own concern (`entry.loaded`/`isNodeUnloaded`) —
 * `ZeropsDataTree` reads `entry.loaded` directly, and `handleToggleNode`
 * below reuses `isNodeUnloaded` to decide whether an expand needs a fetch,
 * including a retry after a failed one (a failed `loadTreePage` never calls
 * `applyTreePage`, so the entry it left behind — from `expandTreePath`
 * alone — stays `loaded: false`). `pendingTreeKeys` is a separate, purely
 * request-plumbing concern: which paths have a `tree` RPC in flight right
 * now, used only to dedupe a repeat click and disable that path's own
 * "Load more" meanwhile.
 */
import {
  applyTablePage,
  applyTreePage,
  buildSortPage,
  collapseTreePath,
  describeDataConsoleError,
  emptyTable,
  emptyTree,
  expandTreePath,
  isNodeUnloaded,
  resolveServiceAffordances,
  treePathKey,
  type DataConsoleTableModel,
  type DataConsoleTree,
  type SortDirection,
} from "@t3tools/client-runtime/zerops/dataConsole";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  ZeropsDataConsoleError,
  type EnvironmentId,
  type ScopedThreadRef,
  type ZeropsDataConsoleBlob,
  type ZeropsDataConsoleColumn,
  type ZeropsDataConsoleNode,
  type ZeropsDataConsolePath,
  type ZeropsDataConsoleRequest,
  type ZeropsDataConsoleResponse,
  type ZeropsDataConsoleService,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { useRef, useState } from "react";

import { cn } from "~/lib/utils";
import { useAtomCommand } from "../../state/use-atom-command";
import { zeropsCommands } from "../../state/zeropsCommands";
import { useZeropsDataConsole } from "../../zerops/useZeropsFeeds";
import { Chip, FlatCard, MicroLabel, StatusDot } from "./primitives";
import { ZeropsDataBlob } from "./ZeropsDataBlob";
import { ZeropsDataQuery } from "./ZeropsDataQuery";
import { ZeropsDataTable, type ZeropsDataTableSort } from "./ZeropsDataTable";
import { ZeropsDataTree } from "./ZeropsDataTree";

export interface ZeropsDataPanelProps {
  readonly threadRef: ScopedThreadRef | null;
}

interface QueryState {
  readonly stmt: string;
  readonly model: DataConsoleTableModel;
}

const isZeropsDataConsoleError = Schema.is(ZeropsDataConsoleError);

export function ZeropsDataPanel({ threadRef }: ZeropsDataPanelProps) {
  const environmentId = threadRef?.environmentId ?? null;
  const session = useZeropsDataConsole(environmentId);
  const callDataConsole = useAtomCommand(
    zeropsCommands.dataConsoleCall,
    "zerops data console call",
  );

  const [services, setServices] = useState<ReadonlyArray<ZeropsDataConsoleService> | undefined>(
    undefined,
  );
  const [selectedServiceHostname, setSelectedServiceHostname] = useState<string | null>(null);
  const [tree, setTree] = useState<DataConsoleTree>(emptyTree);
  const [pendingTreeKeys, setPendingTreeKeys] = useState<ReadonlySet<string>>(new Set());
  const [selectedNode, setSelectedNode] = useState<ZeropsDataConsoleNode | null>(null);
  const [tableModel, setTableModel] = useState<DataConsoleTableModel>(emptyTable);
  const [tableSort, setTableSort] = useState<ZeropsDataTableSort | undefined>(undefined);
  const [tableLoadMorePending, setTableLoadMorePending] = useState(false);
  const [tableCount, setTableCount] = useState<number | undefined>(undefined);
  const [blob, setBlob] = useState<ZeropsDataConsoleBlob | undefined>(undefined);
  const [queryState, setQueryState] = useState<QueryState | undefined>(undefined);
  const [querySort, setQuerySort] = useState<ZeropsDataTableSort | undefined>(undefined);
  const [queryLoadMorePending, setQueryLoadMorePending] = useState(false);
  const [errorText, setErrorText] = useState<string | undefined>(undefined);
  const servicesRequestedForRef = useRef<EnvironmentId | null>(null);
  const treeTokenRef = useRef<Map<string, number>>(new Map());
  const selectionTokenRef = useRef(0);
  const queryTokenRef = useRef(0);

  if (environmentId === null) {
    return null;
  }
  const env = environmentId;

  const runRequest = async (
    request: ZeropsDataConsoleRequest,
  ): Promise<ZeropsDataConsoleResponse | undefined> => {
    const result = await callDataConsole({ environmentId: env, input: request });
    if (result._tag === "Success") {
      setErrorText(undefined);
      return result.value;
    }
    if (!isAtomCommandInterrupted(result)) {
      const cause = squashAtomCommandFailure(result);
      setErrorText(
        isZeropsDataConsoleError(cause) ? describeDataConsoleError(cause) : "Something went wrong.",
      );
    }
    return undefined;
  };

  if (session?.status === "ready" && servicesRequestedForRef.current !== env) {
    servicesRequestedForRef.current = env;
    void runRequest({ kind: "services" }).then((response) => {
      if (response?.kind === "services") {
        setServices(response.services);
      }
    });
  }

  const loadTreePage = (path: ZeropsDataConsolePath, cursor?: string) => {
    const key = treePathKey(path);
    if (pendingTreeKeys.has(key)) return;
    setPendingTreeKeys((current) => new Set(current).add(key));
    const myToken = (treeTokenRef.current.get(key) ?? 0) + 1;
    treeTokenRef.current.set(key, myToken);
    void runRequest({
      kind: "tree",
      path,
      ...(cursor !== undefined ? { page: { cursor } } : {}),
    }).then((response) => {
      setPendingTreeKeys((current) => {
        if (!current.has(key)) return current;
        const next = new Set(current);
        next.delete(key);
        return next;
      });
      if (treeTokenRef.current.get(key) !== myToken) return; // a later request for this path already superseded this one
      if (response?.kind === "tree") {
        setTree((current) => applyTreePage(current, path, response, cursor));
      }
    });
  };

  const handleSelectService = (hostname: string) => {
    setSelectedServiceHostname(hostname);
    setSelectedNode(null);
    setTableModel(emptyTable);
    setTableSort(undefined);
    setTableLoadMorePending(false);
    setTableCount(undefined);
    setBlob(undefined);
    setQueryState(undefined);
    setQuerySort(undefined);
    setQueryLoadMorePending(false);
    selectionTokenRef.current += 1;
    queryTokenRef.current += 1;
    const rootPath: ZeropsDataConsolePath = { service: hostname, segments: [] };
    setTree((current) => expandTreePath(current, rootPath));
    loadTreePage(rootPath);
  };

  const handleToggleNode = (node: ZeropsDataConsoleNode) => {
    const key = treePathKey(node.path);
    const entry = tree.entries[key];
    if (entry?.expanded) {
      setTree((current) => collapseTreePath(current, node.path));
      return;
    }
    const wasUnloaded = isNodeUnloaded(tree, node);
    setTree((current) => expandTreePath(current, node.path));
    if (wasUnloaded) {
      loadTreePage(node.path);
    }
  };

  const handleLoadMoreTree = (path: ZeropsDataConsolePath, cursor: string) => {
    loadTreePage(path, cursor);
  };

  const handleSelectNode = (node: ZeropsDataConsoleNode) => {
    setSelectedNode(node);
    setBlob(undefined);
    setTableModel(emptyTable);
    setTableSort(undefined);
    setTableLoadMorePending(false);
    setTableCount(undefined);
    selectionTokenRef.current += 1;
    const myToken = selectionTokenRef.current;
    if (node.kind === "tabular") {
      void runRequest({ kind: "table", path: node.path }).then((response) => {
        if (selectionTokenRef.current !== myToken) return;
        if (response?.kind === "table") {
          setTableModel(applyTablePage(emptyTable, response.page));
        }
      });
    } else if (node.kind === "blob") {
      void runRequest({ kind: "blob", path: node.path }).then((response) => {
        if (selectionTokenRef.current !== myToken) return;
        if (response?.kind === "blob") {
          const { kind: _kind, ...blobFields } = response;
          setBlob(blobFields);
        }
      });
    }
  };

  const handleTableLoadMore = () => {
    if (selectedNode === null || tableModel.nextCursor === undefined || tableLoadMorePending) {
      return;
    }
    const cursor = tableModel.nextCursor;
    setTableLoadMorePending(true);
    const myToken = selectionTokenRef.current;
    void runRequest({
      kind: "table",
      path: selectedNode.path,
      page: {
        cursor,
        ...(tableSort ? { sort: tableSort.column, direction: tableSort.direction } : {}),
      },
    }).then((response) => {
      setTableLoadMorePending(false);
      if (selectionTokenRef.current !== myToken) return;
      if (response?.kind === "table") {
        setTableModel((current) => applyTablePage(current, response.page, cursor));
      }
    });
  };

  const handleTableSort = (column: ZeropsDataConsoleColumn, direction: SortDirection) => {
    if (selectedNode === null) return;
    const page = buildSortPage(column, direction);
    if (page === undefined) return;
    setTableSort({ column: column.name, direction });
    setTableLoadMorePending(false);
    selectionTokenRef.current += 1;
    const myToken = selectionTokenRef.current;
    void runRequest({ kind: "table", path: selectedNode.path, page }).then((response) => {
      if (selectionTokenRef.current !== myToken) return;
      if (response?.kind === "table") {
        setTableModel(applyTablePage(emptyTable, response.page));
      }
    });
  };

  const handleTableCount = () => {
    if (selectedNode === null) return;
    void runRequest({ kind: "tableCount", path: selectedNode.path }).then((response) => {
      if (response?.kind === "count") setTableCount(response.count);
    });
  };

  const handleQuerySubmit = (stmt: string) => {
    if (selectedServiceHostname === null) return;
    setQuerySort(undefined);
    setQueryLoadMorePending(false);
    queryTokenRef.current += 1;
    const myToken = queryTokenRef.current;
    void runRequest({ kind: "query", service: selectedServiceHostname, stmt }).then((response) => {
      if (queryTokenRef.current !== myToken) return;
      if (response?.kind === "table") {
        setQueryState({ stmt, model: applyTablePage(emptyTable, response.page) });
      }
    });
  };

  const handleQueryLoadMore = () => {
    if (
      selectedServiceHostname === null ||
      queryState === undefined ||
      queryState.model.nextCursor === undefined ||
      queryLoadMorePending
    ) {
      return;
    }
    const cursor = queryState.model.nextCursor;
    setQueryLoadMorePending(true);
    const myToken = queryTokenRef.current;
    void runRequest({
      kind: "query",
      service: selectedServiceHostname,
      stmt: queryState.stmt,
      page: {
        cursor,
        ...(querySort ? { sort: querySort.column, direction: querySort.direction } : {}),
      },
    }).then((response) => {
      setQueryLoadMorePending(false);
      if (queryTokenRef.current !== myToken) return;
      if (response?.kind === "table") {
        setQueryState((current) =>
          current === undefined
            ? current
            : { stmt: current.stmt, model: applyTablePage(current.model, response.page, cursor) },
        );
      }
    });
  };

  const handleQuerySort = (column: ZeropsDataConsoleColumn, direction: SortDirection) => {
    if (selectedServiceHostname === null || queryState === undefined) return;
    const page = buildSortPage(column, direction);
    if (page === undefined) return;
    setQuerySort({ column: column.name, direction });
    setQueryLoadMorePending(false);
    queryTokenRef.current += 1;
    const myToken = queryTokenRef.current;
    void runRequest({
      kind: "query",
      service: selectedServiceHostname,
      stmt: queryState.stmt,
      page,
    }).then((response) => {
      if (queryTokenRef.current !== myToken) return;
      if (response?.kind === "table") {
        setQueryState((current) =>
          current === undefined
            ? current
            : { stmt: current.stmt, model: applyTablePage(emptyTable, response.page) },
        );
      }
    });
  };

  const status = session?.status ?? "idle";
  const selectedService =
    services?.find((service) => service.hostname === selectedServiceHostname) ?? null;
  const affordances = selectedService ? resolveServiceAffordances(selectedService) : null;

  return (
    <FlatCard className="space-y-3 p-3" data-zerops-data-panel>
      <MicroLabel>Data</MicroLabel>

      {status === "idle" || status === "starting" ? (
        <StatusDot label="Starting" pulse tone="busy" />
      ) : status === "unsupported" ? (
        <p className="text-muted-foreground text-xs" data-zerops-data-unsupported>
          This project doesn't support Data yet.
        </p>
      ) : status === "unavailable" ? (
        <p className="text-muted-foreground text-xs" data-zerops-data-unavailable>
          {session?.reason !== undefined
            ? `Data isn't available right now. ${session.reason}`
            : "Data isn't available right now."}
        </p>
      ) : (
        <div className="flex gap-3" data-zerops-data-browse>
          <div className="w-40 shrink-0 space-y-1" data-zerops-data-services>
            {(services ?? []).map((service) => {
              const rowAffordances = resolveServiceAffordances(service);
              return (
                <button
                  className={cn(
                    "flex w-full flex-col items-start gap-0.5 rounded-[var(--zerops-card-radius)] px-2 py-1 text-left text-xs hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent",
                    selectedServiceHostname === service.hostname && "bg-accent",
                  )}
                  data-zerops-data-service={service.hostname}
                  disabled={!rowAffordances.canBrowse}
                  key={service.hostname}
                  onClick={() =>
                    rowAffordances.canBrowse ? handleSelectService(service.hostname) : undefined
                  }
                  type="button"
                >
                  <span className="flex w-full items-center justify-between gap-1">
                    <span className="truncate">{service.hostname}</span>
                    {service.support !== "supported" ? (
                      <Chip data-zerops-data-service-view-only label="View only" tone="off" />
                    ) : null}
                  </span>
                  <span className="text-muted-foreground">{service.family}</span>
                  {rowAffordances.vpnGateReason !== undefined ? (
                    <span className="text-muted-foreground" data-zerops-data-service-vpn-hint>
                      {rowAffordances.vpnGateReason}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          <div className="flex-1 space-y-3" data-zerops-data-detail>
            {selectedServiceHostname !== null ? (
              <ZeropsDataTree
                loadingKeys={pendingTreeKeys}
                onLoadMore={handleLoadMoreTree}
                onSelectNode={handleSelectNode}
                onToggleNode={handleToggleNode}
                rootPath={{ service: selectedServiceHostname, segments: [] }}
                tree={tree}
                {...(selectedNode ? { selectedNodeKey: treePathKey(selectedNode.path) } : {})}
              />
            ) : null}

            {selectedNode?.kind === "tabular" ? (
              <ZeropsDataTable
                loadMorePending={tableLoadMorePending}
                model={tableModel}
                onLoadMore={handleTableLoadMore}
                onRequestCount={handleTableCount}
                onSort={handleTableSort}
                {...(tableSort ? { sort: tableSort } : {})}
                {...(tableCount !== undefined ? { count: tableCount } : {})}
              />
            ) : null}

            {selectedNode?.kind === "blob" && blob !== undefined ? (
              <ZeropsDataBlob blob={blob} />
            ) : null}

            {affordances?.canQuery === true ? (
              <ZeropsDataQuery onSubmit={handleQuerySubmit} />
            ) : null}

            {queryState !== undefined ? (
              <ZeropsDataTable
                loadMorePending={queryLoadMorePending}
                model={queryState.model}
                onLoadMore={handleQueryLoadMore}
                onSort={handleQuerySort}
                {...(querySort ? { sort: querySort } : {})}
              />
            ) : null}
          </div>
        </div>
      )}

      {errorText !== undefined ? (
        <p
          className="rounded-[var(--zerops-card-radius)] bg-destructive/8 px-2 py-1 text-destructive-foreground text-xs"
          data-zerops-data-error
        >
          {errorText}
        </p>
      ) : null}
    </FlatCard>
  );
}
