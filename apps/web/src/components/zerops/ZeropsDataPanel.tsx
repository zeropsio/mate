/**
 * The Data panel: browse a Zerops project's managed data services
 * (Postgres/Mongo/etc trees, tables, blobs) read-only, brokered by the mate
 * server to a zcp-side console process (S-dataconsole,
 * `../../../../../zcp/docs/spec-mate.md` §5 "Data surface",
 * `../../../../../zcp/docs/spec-dataconsole.md` §4.3).
 *
 * One surface per service. `service === undefined` is the picker tab: the
 * console's service list and nothing else, each browsable row opening (or
 * focusing) that service's own `data:<hostname>` tab via `onOpenService`.
 * With a `service` the panel is that service's browser — tree, grid,
 * filters, row detail — and no services rail, because the tab *is* the
 * service. `ChatView` keys the panel by `environmentId:service`, so both a
 * project switch and a service switch remount it fresh.
 *
 * NOT a protected root (design-system.md R2): unlike `ZeropsServiceMap` /
 * `ZeropsLifecycleStrip` / `ZeropsOperationCard` / `ZeropsQuickActions`, this
 * panel issues its RPC calls (`zeropsDataConsoleCall`) directly from the
 * user's own clicks — opening a service, expanding a tree node, sorting a
 * column, applying a filter, running a query. Unlike `ZeropsBrowserPanel`
 * (also not a protected root, but for the opposite reason — its RPC mutates
 * the agent's shared browser), every request this panel issues is read-only,
 * so there is no agent-mutates-only boundary to keep either way.
 *
 * State lives here, not in the subcomponents (`ZeropsDataTree`,
 * `ZeropsDataTable`, `ZeropsDataFilters`, `ZeropsDataRowDrawer`,
 * `ZeropsDataBlob`, `ZeropsDataQuery`): they are plain presentational views
 * over a value this panel fetched and a callback that asks for the next one,
 * which keeps each of them testable without an RPC mock of its own. Layout
 * only chooses which of those views renders — sort, filters, hidden columns
 * and the selected row are untouched by a resize or by maximizing, which is
 * the whole point of keeping them here.
 *
 * The initial `services` listing fires as soon as the session is `"idle"`
 * or `"ready"` (the server starts the console on that first call, so
 * waiting for `"ready"` would wait forever) — adjusting state during render,
 * guarded by a ref so it only fires once per environment, the same pattern
 * `ZeropsBrowserPanel` uses for its take-over reset. There is no user click
 * to hang the first fetch off of, and this codebase has no `useEffect`-driven
 * data fetch to mirror instead. Opening this tab's own service once that
 * listing lands is guarded by the same kind of ref.
 *
 * Container width is measured with a `ResizeObserver` attached from a ref
 * callback held in a ref (stable identity, so the observer attaches once)
 * rather than from an effect: this component is exercised by calling it as a
 * plain function, and an effect would never run there. `widthForTest`
 * overrides the measurement so a test can pin the layout without a DOM.
 *
 * Two guards keep the RPC traffic honest under rapid clicking and slow
 * responses:
 * - **No duplicate in flight.** `pendingTreeKeys`/`tableLoadMorePending`/
 *   `filteredLoadMorePending`/`queryLoadMorePending` gate their loaders — a
 *   second click while the first request for the same target is outstanding
 *   is a no-op, and the corresponding "Load more" button renders disabled
 *   meanwhile.
 * - **Stale responses are dropped, never applied.** Selecting a different
 *   node/service or changing a sort bumps that target's token
 *   (`selectionTokenRef` for the tree-node/blob/table target,
 *   `filterTokenRef` for the filtered statement, `queryTokenRef` for the
 *   query box); every response checks its own captured token against the
 *   ref's current value before touching state, so a slow response for a
 *   selection the user has since moved on from never clobbers what is now on
 *   screen.
 *
 * Sort state (`tableSort`/`querySort`/`filteredSort`) lives here, not in
 * `ZeropsDataTable` — it has to be merged into every subsequent "Load more"
 * page request for the same target (and, while a filter is applied, into the
 * statement's own `ORDER BY` instead), and it resets whenever that target's
 * model is replaced wholesale, which is exactly when a token bump already
 * happens.
 *
 * "Still loading" vs. "loaded and expanded" for a tree path is entirely the
 * client-runtime tree's own concern (`entry.loaded`/`isNodeUnloaded`) —
 * `ZeropsDataTree` reads `entry.loaded` directly, and `handleToggleNode`
 * below reuses `isNodeUnloaded` to decide whether an expand needs a fetch,
 * including a retry after a failed one. `pendingTreeKeys` is a separate,
 * purely request-plumbing concern: which paths have a `tree` RPC in flight
 * right now, used only to dedupe a repeat click and disable that path's own
 * "Load more" meanwhile.
 */
import {
  applyTablePage,
  applyTreePage,
  buildFilteredTableStatement,
  buildSortPage,
  collapseTreePath,
  describeDataConsoleError,
  describeRowContext,
  describeTableContext,
  emptyTable,
  emptyTree,
  expandTreePath,
  hasActiveFilters,
  isNodeUnloaded,
  resolveDataLayout,
  resolveServiceAffordances,
  resolveSqlDialect,
  rowAsJson,
  toggleHiddenColumn,
  treePathKey,
  type DataConsoleFilter,
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
import { Maximize2Icon, Minimize2Icon } from "lucide-react";
import { useRef, useState } from "react";

import { cn } from "~/lib/utils";
import type { TerminalContextSelection } from "../../lib/terminalContext";
import { useAtomCommand } from "../../state/use-atom-command";
import { zeropsCommands } from "../../state/zeropsCommands";
import { useZeropsDataConsole } from "../../zerops/useZeropsFeeds";
import { Button } from "../ui/button";
import { Chip, FlatCard, MicroLabel, StatusDot } from "./primitives";
import { ZeropsDataBlob } from "./ZeropsDataBlob";
import { ZeropsDataBreadcrumbs } from "./ZeropsDataBreadcrumbs";
import { ZeropsDataFilters } from "./ZeropsDataFilters";
import { ZeropsDataQuery } from "./ZeropsDataQuery";
import { ZeropsDataRowDrawer } from "./ZeropsDataRowDrawer";
import { ZeropsDataTable, type ZeropsDataTableSort } from "./ZeropsDataTable";
import { ZeropsDataTree } from "./ZeropsDataTree";

export interface ZeropsDataPanelProps {
  readonly threadRef: ScopedThreadRef | null;
  /** Hostname of the service this tab is for; undefined = the picker tab (service list only). */
  readonly service?: string | undefined;
  /** Opens (or focuses) the per-service Data tab `data:<hostname>`. */
  readonly onOpenService: (hostname: string) => void;
  /** Attaches a context chip to the composer draft. */
  readonly onAddContext: (selection: TerminalContextSelection) => void;
  readonly maximized: boolean;
  /** Present when the panel can be maximized (inline mode); absent in sheet mode. */
  readonly onToggleMaximized?: (() => void) | undefined;
  /** Pins the measured container width, for tests that render without a DOM. */
  readonly widthForTest?: number | undefined;
}

interface QueryState {
  readonly stmt: string;
  readonly model: DataConsoleTableModel;
}

interface OpenRow {
  readonly index: number;
  readonly column?: string;
}

/** Row cap of a filtered statement — the console pages a plain `table` read itself, but a `query` gets whatever the statement asks for. */
const FILTERED_LIMIT = 200;

/** Layout guess before the first measurement lands, so the panel does not flash the wrong shape. */
const ASSUMED_WIDTH_MAXIMIZED = 1200;
const ASSUMED_WIDTH_INLINE = 420;

const isZeropsDataConsoleError = Schema.is(ZeropsDataConsoleError);

function copyToClipboard(text: string): void {
  const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
  if (clipboard?.writeText === undefined) return;
  void clipboard.writeText(text);
}

export function ZeropsDataPanel({
  threadRef,
  service,
  onOpenService,
  onAddContext,
  maximized,
  onToggleMaximized,
  widthForTest,
}: ZeropsDataPanelProps) {
  const environmentId = threadRef?.environmentId ?? null;
  const session = useZeropsDataConsole(environmentId);
  const callDataConsole = useAtomCommand(
    zeropsCommands.dataConsoleCall,
    "zerops data console call",
  );

  const [services, setServices] = useState<ReadonlyArray<ZeropsDataConsoleService> | undefined>(
    undefined,
  );
  const [tree, setTree] = useState<DataConsoleTree>(emptyTree);
  const [treeCollapsed, setTreeCollapsed] = useState(false);
  const [pendingTreeKeys, setPendingTreeKeys] = useState<ReadonlySet<string>>(new Set());
  const [selectedNode, setSelectedNode] = useState<ZeropsDataConsoleNode | null>(null);
  const [tableModel, setTableModel] = useState<DataConsoleTableModel>(emptyTable);
  const [tableSort, setTableSort] = useState<ZeropsDataTableSort | undefined>(undefined);
  const [tableLoadMorePending, setTableLoadMorePending] = useState(false);
  const [tableCount, setTableCount] = useState<number | undefined>(undefined);
  const [hiddenColumns, setHiddenColumns] = useState<ReadonlySet<string>>(new Set());
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [openRow, setOpenRow] = useState<OpenRow | undefined>(undefined);
  const [focusedRowIndex, setFocusedRowIndex] = useState<number | undefined>(undefined);
  const [filters, setFilters] = useState<ReadonlyArray<DataConsoleFilter>>([]);
  const [rawWhere, setRawWhere] = useState("");
  const [filtered, setFiltered] = useState<QueryState | undefined>(undefined);
  const [filteredSort, setFilteredSort] = useState<ZeropsDataTableSort | undefined>(undefined);
  const [filteredLoadMorePending, setFilteredLoadMorePending] = useState(false);
  const [blob, setBlob] = useState<ZeropsDataConsoleBlob | undefined>(undefined);
  const [queryState, setQueryState] = useState<QueryState | undefined>(undefined);
  const [querySort, setQuerySort] = useState<ZeropsDataTableSort | undefined>(undefined);
  const [queryLoadMorePending, setQueryLoadMorePending] = useState(false);
  const [errorText, setErrorText] = useState<string | undefined>(undefined);
  const [measuredWidth, setMeasuredWidth] = useState<number | undefined>(undefined);
  const servicesRequestedForRef = useRef<EnvironmentId | null>(null);
  const openedServiceRef = useRef<string | null>(null);
  const treeTokenRef = useRef<Map<string, number>>(new Map());
  const selectionTokenRef = useRef(0);
  const filterTokenRef = useRef(0);
  const queryTokenRef = useRef(0);
  const filterValueInputRef = useRef<HTMLInputElement | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const measureRef = useRef<((node: HTMLDivElement | null) => void) | null>(null);
  if (measureRef.current === null) {
    measureRef.current = (node) => {
      if (node === null) {
        observerRef.current?.disconnect();
        observerRef.current = null;
        return;
      }
      if (observerRef.current !== null) return;
      setMeasuredWidth(node.clientWidth);
      if (typeof ResizeObserver === "undefined") return;
      const observer = new ResizeObserver((entries) => {
        const width = entries[0]?.contentRect.width;
        if (width !== undefined) setMeasuredWidth(Math.round(width));
      });
      observer.observe(node);
      observerRef.current = observer;
    };
  }

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

  const requestServices = () => {
    void runRequest({ kind: "services" }).then((response) => {
      if (response?.kind === "services") {
        setServices(response.services);
      }
    });
  };

  // Fires on `idle` as well as `ready`: the server starts the console on the
  // FIRST call, so a panel that waited for `ready` before calling would wait
  // forever on a fresh or idle-killed console (`ZeropsDataConsole.ts` header).
  // After an `unavailable` verdict the ref is cleared so the next `idle`
  // (a reconnect, a retried session) asks again instead of staying dark.
  const status = session?.status ?? "idle";
  const servicesRequestedFor = servicesRequestedForRef.current;
  if (status === "unavailable" && servicesRequestedFor === env) {
    servicesRequestedForRef.current = null;
  }
  if ((status === "idle" || status === "ready") && servicesRequestedFor !== env) {
    servicesRequestedForRef.current = env;
    requestServices();
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

  const resetSelection = () => {
    setSelectedNode(null);
    setTableModel(emptyTable);
    setTableSort(undefined);
    setTableLoadMorePending(false);
    setTableCount(undefined);
    setHiddenColumns(new Set());
    setColumnsOpen(false);
    setOpenRow(undefined);
    setFocusedRowIndex(undefined);
    setFilters([]);
    setRawWhere("");
    setFiltered(undefined);
    setFilteredSort(undefined);
    setFilteredLoadMorePending(false);
    setBlob(undefined);
    selectionTokenRef.current += 1;
    filterTokenRef.current += 1;
  };

  const openServiceRoot = (hostname: string) => {
    resetSelection();
    setQueryState(undefined);
    setQuerySort(undefined);
    setQueryLoadMorePending(false);
    queryTokenRef.current += 1;
    const rootPath: ZeropsDataConsolePath = { service: hostname, segments: [] };
    setTree((current) => expandTreePath(current, rootPath));
    loadTreePage(rootPath);
  };

  // This tab's own service opens itself the moment the listing that carries
  // its affordances lands — the tab already names the service, so a click to
  // "select" it would be a click on the only thing there is.
  if (
    service !== undefined &&
    services !== undefined &&
    openedServiceRef.current !== service &&
    resolveServiceAffordances(
      services.find((entry) => entry.hostname === service) ?? { actions: [] },
    ).canBrowse
  ) {
    openedServiceRef.current = service;
    openServiceRoot(service);
  }

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
    resetSelection();
    setSelectedNode(node);
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

  // A breadcrumb other than the last one is a step back up the path: it drops
  // the current node (in the narrow layout that is the way back to the tree)
  // and makes sure the container it names is expanded and loaded.
  const handleNavigatePath = (path: ZeropsDataConsolePath) => {
    resetSelection();
    setTree((current) => expandTreePath(current, path));
    const entry = tree.entries[treePathKey(path)];
    if (entry === undefined || !entry.loaded) {
      loadTreePage(path);
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

  const runFilteredStatement = (
    node: ZeropsDataConsoleNode,
    dialect: "postgresql" | "mysql",
    nextFilters: ReadonlyArray<DataConsoleFilter>,
    nextRawWhere: string,
    sort: ZeropsDataTableSort | undefined,
  ) => {
    const stmt = buildFilteredTableStatement({
      dialect,
      path: node.path,
      filters: nextFilters,
      rawWhere: nextRawWhere,
      limit: FILTERED_LIMIT,
      ...(sort ? { sort } : {}),
    });
    setFilteredLoadMorePending(false);
    setOpenRow(undefined);
    setFocusedRowIndex(undefined);
    filterTokenRef.current += 1;
    const myToken = filterTokenRef.current;
    void runRequest({ kind: "query", service: node.path.service, stmt }).then((response) => {
      if (filterTokenRef.current !== myToken) return;
      if (response?.kind === "table") {
        setFiltered({ stmt, model: applyTablePage(emptyTable, response.page) });
      }
    });
  };

  const handleFilteredLoadMore = () => {
    if (
      service === undefined ||
      filtered === undefined ||
      filtered.model.nextCursor === undefined ||
      filteredLoadMorePending
    ) {
      return;
    }
    const cursor = filtered.model.nextCursor;
    setFilteredLoadMorePending(true);
    const myToken = filterTokenRef.current;
    void runRequest({
      kind: "query",
      service,
      stmt: filtered.stmt,
      page: { cursor },
    }).then((response) => {
      setFilteredLoadMorePending(false);
      if (filterTokenRef.current !== myToken) return;
      if (response?.kind === "table") {
        setFiltered((current) =>
          current === undefined
            ? current
            : { stmt: current.stmt, model: applyTablePage(current.model, response.page, cursor) },
        );
      }
    });
  };

  const handleTableSort = (column: ZeropsDataConsoleColumn, direction: SortDirection) => {
    if (selectedNode === null) return;
    if (!column.sortable) return;
    // With a filter applied the grid shows a statement's result, so the sort
    // belongs in that statement's ORDER BY, not in a page request.
    if (filtered !== undefined) {
      const dialect = selectedServiceDialect;
      if (dialect === undefined) return;
      setFilteredSort({ column: column.name, direction });
      runFilteredStatement(selectedNode, dialect, filters, rawWhere, {
        column: column.name,
        direction,
      });
      return;
    }
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
    if (service === undefined) return;
    setQuerySort(undefined);
    setQueryLoadMorePending(false);
    queryTokenRef.current += 1;
    const myToken = queryTokenRef.current;
    void runRequest({ kind: "query", service, stmt }).then((response) => {
      if (queryTokenRef.current !== myToken) return;
      if (response?.kind === "table") {
        setQueryState({ stmt, model: applyTablePage(emptyTable, response.page) });
      }
    });
  };

  const handleQueryLoadMore = () => {
    if (
      service === undefined ||
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
      service,
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
    if (service === undefined || queryState === undefined) return;
    const page = buildSortPage(column, direction);
    if (page === undefined) return;
    setQuerySort({ column: column.name, direction });
    setQueryLoadMorePending(false);
    queryTokenRef.current += 1;
    const myToken = queryTokenRef.current;
    void runRequest({
      kind: "query",
      service,
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

  const selectedService = services?.find((entry) => entry.hostname === service) ?? null;
  const affordances = selectedService ? resolveServiceAffordances(selectedService) : null;
  const selectedServiceDialect =
    selectedService === null ? undefined : resolveSqlDialect(selectedService.type);
  const layout = resolveDataLayout(
    widthForTest ?? measuredWidth ?? (maximized ? ASSUMED_WIDTH_MAXIMIZED : ASSUMED_WIDTH_INLINE),
  );
  const gridModel = filtered?.model ?? tableModel;
  const gridSort = filtered !== undefined ? filteredSort : tableSort;

  const addContext = (context: { readonly label: string; readonly text: string }) => {
    if (service === undefined) return;
    onAddContext({
      terminalId: `data:${service}`,
      terminalLabel: context.label,
      lineStart: 1,
      lineEnd: context.text.split("\n").length,
      text: context.text,
    });
  };

  const errorLine =
    errorText !== undefined ? (
      <p
        className="rounded-[var(--zerops-card-radius)] bg-destructive/8 px-2 py-1 text-destructive-foreground text-xs"
        data-zerops-data-error
      >
        {errorText}
      </p>
    ) : null;

  const sessionLine =
    status === "idle" || status === "starting" ? (
      <StatusDot label="Starting" pulse tone="busy" />
    ) : status === "unsupported" ? (
      <p className="text-muted-foreground text-xs" data-zerops-data-unsupported>
        This project doesn't support Data yet.
      </p>
    ) : status === "unavailable" ? (
      <div className="space-y-2">
        <p className="text-muted-foreground text-xs" data-zerops-data-unavailable>
          {session?.reason !== undefined
            ? `Data isn't available right now. ${session.reason}`
            : "Data isn't available right now."}
        </p>
        <Button data-zerops-data-retry onClick={requestServices} size="xs" variant="outline">
          Try again
        </Button>
      </div>
    ) : null;

  if (service === undefined) {
    return (
      <FlatCard className="space-y-3 p-3" data-zerops-data-panel="picker">
        <MicroLabel>Data</MicroLabel>
        {sessionLine ?? (
          <div className="space-y-1" data-zerops-data-services>
            {(services ?? []).map((entry) => {
              const rowAffordances = resolveServiceAffordances(entry);
              return (
                <button
                  className="flex w-full flex-col items-start gap-0.5 rounded-[var(--zerops-card-radius)] px-2 py-1 text-left text-xs hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
                  data-zerops-data-service={entry.hostname}
                  disabled={!rowAffordances.canBrowse}
                  key={entry.hostname}
                  onClick={() =>
                    rowAffordances.canBrowse ? onOpenService(entry.hostname) : undefined
                  }
                  type="button"
                >
                  <span className="flex w-full items-center justify-between gap-1">
                    <span className="truncate">{entry.hostname}</span>
                    {entry.support !== "supported" ? (
                      <Chip data-zerops-data-service-view-only label="View only" tone="off" />
                    ) : null}
                  </span>
                  <span className="text-muted-foreground">{entry.family}</span>
                  {rowAffordances.vpnGateReason !== undefined ? (
                    <span className="text-muted-foreground" data-zerops-data-service-vpn-hint>
                      {rowAffordances.vpnGateReason}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
        {errorLine}
      </FlatCard>
    );
  }

  const currentPath: ZeropsDataConsolePath = selectedNode?.path ?? { service, segments: [] };
  const browsable = affordances?.canBrowse === true;

  const treeView = (
    <ZeropsDataTree
      loadingKeys={pendingTreeKeys}
      onLoadMore={handleLoadMoreTree}
      onSelectNode={handleSelectNode}
      onToggleNode={handleToggleNode}
      rootPath={{ service, segments: [] }}
      tree={tree}
      {...(selectedNode ? { selectedNodeKey: treePathKey(selectedNode.path) } : {})}
    />
  );

  const filterBar =
    selectedNode?.kind === "tabular" && selectedServiceDialect !== undefined ? (
      <ZeropsDataFilters
        canClear={filtered !== undefined || hasActiveFilters(filters, rawWhere)}
        columns={gridModel.columns}
        filters={filters}
        onApply={() => {
          if (selectedNode === null) return;
          runFilteredStatement(
            selectedNode,
            selectedServiceDialect,
            filters,
            rawWhere,
            filteredSort,
          );
        }}
        onChangeFilters={setFilters}
        onChangeRawWhere={setRawWhere}
        onClear={() => {
          setFilters([]);
          setRawWhere("");
          setFiltered(undefined);
          setFilteredSort(undefined);
          setOpenRow(undefined);
          filterTokenRef.current += 1;
        }}
        rawWhere={rawWhere}
        valueInputRef={filterValueInputRef}
      />
    ) : null;

  const gridView =
    selectedNode?.kind === "tabular" ? (
      <ZeropsDataTable
        columnsOpen={columnsOpen}
        filtered={filtered !== undefined}
        hiddenColumns={hiddenColumns}
        loadMorePending={filtered !== undefined ? filteredLoadMorePending : tableLoadMorePending}
        model={gridModel}
        onAskAboutTable={
          selectedService === null
            ? undefined
            : () =>
                addContext(
                  describeTableContext({
                    service: selectedService,
                    path: selectedNode.path,
                    columns: gridModel.columns,
                    ...(tableCount !== undefined ? { approxRowCount: tableCount } : {}),
                  }),
                )
        }
        onCopyPageJson={() =>
          copyToClipboard(
            JSON.stringify(
              gridModel.rows.map((row) =>
                Object.fromEntries(gridModel.columns.map((column, i) => [column.name, row[i]])),
              ),
              null,
              2,
            ),
          )
        }
        onEscape={() => setOpenRow(undefined)}
        onExpandCell={(rowIndex, columnName) => setOpenRow({ index: rowIndex, column: columnName })}
        onFocusRow={setFocusedRowIndex}
        onLoadMore={filtered !== undefined ? handleFilteredLoadMore : handleTableLoadMore}
        onOpenRow={(rowIndex) => {
          setFocusedRowIndex(rowIndex);
          setOpenRow({ index: rowIndex });
        }}
        onSort={handleTableSort}
        onToggleColumn={(name) => setHiddenColumns((current) => toggleHiddenColumn(current, name))}
        onToggleColumnsOpen={() => setColumnsOpen((current) => !current)}
        {...(filterBar !== null
          ? { onFocusFilter: () => filterValueInputRef.current?.focus() }
          : {})}
        {...(filtered === undefined ? { onRequestCount: handleTableCount } : {})}
        {...(gridSort ? { sort: gridSort } : {})}
        {...(tableCount !== undefined ? { count: tableCount } : {})}
        {...(focusedRowIndex !== undefined ? { focusedRowIndex } : {})}
      />
    ) : null;

  const drawerRow = openRow === undefined ? undefined : gridModel.rows[openRow.index];
  const drawerView =
    drawerRow !== undefined && openRow !== undefined && selectedService !== null ? (
      <ZeropsDataRowDrawer
        columns={gridModel.columns}
        layout={layout}
        onClose={() => setOpenRow(undefined)}
        onCopyJson={() => copyToClipboard(rowAsJson(gridModel.columns, drawerRow))}
        onExplain={() =>
          addContext(
            describeRowContext({
              service: selectedService,
              path: currentPath,
              columns: gridModel.columns,
              row: drawerRow,
            }),
          )
        }
        row={drawerRow}
        {...(openRow.column !== undefined ? { expandedColumn: openRow.column } : {})}
      />
    ) : null;

  const contentPane = (
    <div className="min-w-0 flex-1 space-y-3" data-zerops-data-content>
      {filterBar}
      {gridView}
      {selectedNode?.kind === "blob" && blob !== undefined ? <ZeropsDataBlob blob={blob} /> : null}
      {affordances?.canQuery === true ? <ZeropsDataQuery onSubmit={handleQuerySubmit} /> : null}
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
  );

  return (
    <FlatCard
      className="relative space-y-3 p-3"
      data-zerops-data-panel="service"
      data-zerops-data-layout={layout}
      ref={measureRef.current}
    >
      <div className="flex items-center justify-between gap-2">
        <ZeropsDataBreadcrumbs onNavigate={handleNavigatePath} path={currentPath} />
        {onToggleMaximized !== undefined ? (
          <Button
            aria-label={maximized ? "Restore panel" : "Maximize panel"}
            data-zerops-data-maximize
            onClick={onToggleMaximized}
            size="icon-xs"
            variant="ghost"
          >
            {maximized ? <Minimize2Icon /> : <Maximize2Icon />}
          </Button>
        ) : null}
      </div>

      {sessionLine ??
        (services !== undefined && !browsable ? (
          <p className="text-muted-foreground text-xs" data-zerops-data-not-browsable>
            This service can't be browsed yet.
          </p>
        ) : layout === "wide" ? (
          <div className="flex gap-3" data-zerops-data-browse>
            {treeCollapsed ? null : (
              <div className="w-60 shrink-0" data-zerops-data-tree-rail>
                {treeView}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <Button
                data-zerops-data-tree-toggle-rail
                onClick={() => setTreeCollapsed((current) => !current)}
                size="micro"
                variant="ghost"
              >
                {treeCollapsed ? "Show tree" : "Hide tree"}
              </Button>
              <div className="flex gap-3">
                {contentPane}
                {drawerView}
              </div>
            </div>
          </div>
        ) : (
          <div className={cn("relative", "space-y-3")} data-zerops-data-browse>
            {selectedNode === null ? treeView : contentPane}
            {drawerView}
          </div>
        ))}

      {errorLine}
    </FlatCard>
  );
}
