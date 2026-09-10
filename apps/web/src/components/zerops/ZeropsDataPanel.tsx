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
  collapsedPrefix,
  describeRowContext,
  describeDocumentListingStatus,
  describeTableContext,
  documentListingModel,
  emptyTable,
  emptyTree,
  expandTreePath,
  filtersDirty,
  hasActiveFilters,
  isNodeUnloaded,
  joinServicesWithTopology,
  kvListingModel,
  listingFor,
  objectListingModel,
  resolveDataLayout,
  resolveServiceAffordances,
  resolveSqlDialect,
  rowAsJson,
  toggleHiddenColumn,
  treePathKey,
  visibleSegments,
  type DataConsoleFilter,
  type DataConsoleNodeListing,
  type DataConsoleTableModel,
  type DataConsoleTree,
  type SortDirection,
} from "@t3tools/client-runtime/zerops/dataConsole";
import { serviceStatusTone, zeropsStatusWord } from "@t3tools/client-runtime/zerops/serviceMap";
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

import type { TerminalContextSelection } from "../../lib/terminalContext";
import { useAtomCommand } from "../../state/use-atom-command";
import { zeropsCommands } from "../../state/zeropsCommands";
import { useProjectTopology } from "../../zerops/useProjectTopology";
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

/** Why the grid region is showing something other than rows. */
type GridNotice =
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "unsupported" };

interface OpenRow {
  readonly index: number;
  readonly column?: string;
}

/** Row cap of a filtered statement — the console pages a plain `table` read itself, but a `query` gets whatever the statement asks for. */
const FILTERED_LIMIT = 200;

/** `ZeropsServiceTone` (the topology's tone) → `StatusDot`'s own tone id, same mapping `ZeropsServiceMap` uses. */
const STATUS_DOT_TONE: Record<
  ReturnType<typeof serviceStatusTone>,
  "busy" | "failed" | "ok" | "off"
> = {
  error: "failed",
  warning: "busy",
  outline: "ok",
  muted: "off",
};

/** Layout guess before the first measurement lands, so the panel does not flash the wrong shape. */
const ASSUMED_WIDTH_MAXIMIZED = 1200;
const ASSUMED_WIDTH_INLINE = 420;

/** Stable empty prefix, so a service without a collapsed level keeps one identity across renders. */
const EMPTY_PREFIX: ReadonlyArray<string> = [];

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
  const topology = useProjectTopology(environmentId);
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
  const [appliedFilters, setAppliedFilters] = useState<ReadonlyArray<DataConsoleFilter>>([]);
  const [appliedRawWhere, setAppliedRawWhere] = useState("");
  const [rawWhereOpen, setRawWhereOpen] = useState(false);
  const [autoFocusFilterIndex, setAutoFocusFilterIndex] = useState<number | undefined>(undefined);
  const [sqlOpen, setSqlOpen] = useState(false);
  const [filtered, setFiltered] = useState<QueryState | undefined>(undefined);
  const [filteredSort, setFilteredSort] = useState<ZeropsDataTableSort | undefined>(undefined);
  const [filteredLoadMorePending, setFilteredLoadMorePending] = useState(false);
  const [blob, setBlob] = useState<ZeropsDataConsoleBlob | undefined>(undefined);
  const [queryState, setQueryState] = useState<QueryState | undefined>(undefined);
  const [querySort, setQuerySort] = useState<ZeropsDataTableSort | undefined>(undefined);
  const [queryLoadMorePending, setQueryLoadMorePending] = useState(false);
  const [errorText, setErrorText] = useState<string | undefined>(undefined);
  const [gridNotice, setGridNotice] = useState<GridNotice | undefined>(undefined);
  const [measuredWidth, setMeasuredWidth] = useState<number | undefined>(undefined);
  const [missingServiceRefreshed, setMissingServiceRefreshed] = useState<string | null>(null);
  // A document index's search box: the text box's own draft, and the last
  // submitted search's result (`undefined` = showing the plain index
  // listing instead) — separate state so a query mid-edit never disturbs
  // what's on screen until Enter is pressed.
  const [documentSearchQuery, setDocumentSearchQuery] = useState("");
  const [documentSearchResult, setDocumentSearchResult] = useState<
    DataConsoleNodeListing | undefined
  >(undefined);
  const [documentSearchLoadMorePending, setDocumentSearchLoadMorePending] = useState(false);
  const servicesRequestedForRef = useRef<EnvironmentId | null>(null);
  const openedServiceRef = useRef<string | null>(null);
  const missingServiceRefreshRef = useRef<string | null>(null);
  const collapsedLoadedKeysRef = useRef<Set<string>>(new Set());
  const treeTokenRef = useRef<Map<string, number>>(new Map());
  const selectionTokenRef = useRef(0);
  const filterTokenRef = useRef(0);
  const queryTokenRef = useRef(0);
  const filterValueInputRef = useRef<HTMLInputElement | null>(null);
  const gridScrollRef = useRef<HTMLDivElement | null>(null);
  const treeScrollRef = useRef<HTMLDivElement | null>(null);
  // A tree can page several levels at once (a container's own children, and
  // one of its own expanded children, both mid-cursor) — one
  // IntersectionObserver per level's sentinel, keyed by its path, rather
  // than the grid's single observer. `treeSentinelStateRef` holds each key's
  // latest `{path, cursor}` so a stable-identity callback (never rebuilt
  // while the same level keeps paging) always fires `handleLoadMoreTree`
  // with the current page's own cursor, the same "latest ref" trick
  // `ZeropsDataTable`'s own sentinel uses.
  const treeSentinelStateRef = useRef<Map<string, { path: ZeropsDataConsolePath; cursor: string }>>(
    new Map(),
  );
  const treeSentinelCallbacksRef = useRef<Map<string, (node: HTMLDivElement | null) => void>>(
    new Map(),
  );
  const treeSentinelObserversRef = useRef<Map<string, IntersectionObserver>>(new Map());
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

  // `onFailure` takes the failure instead of the panel-wide error line, for
  // the requests whose failure belongs where their result would have gone —
  // a table read that fails has to say so in the grid region, not underneath
  // a grid still showing "No rows".
  const runRequest = async (
    request: ZeropsDataConsoleRequest,
    onFailure?: (failure: { readonly message: string; readonly code?: string }) => void,
  ): Promise<ZeropsDataConsoleResponse | undefined> => {
    const result = await callDataConsole({ environmentId: env, input: request });
    if (result._tag === "Success") {
      setErrorText(undefined);
      return result.value;
    }
    if (!isAtomCommandInterrupted(result)) {
      const cause = squashAtomCommandFailure(result);
      const isConsoleError = isZeropsDataConsoleError(cause);
      const message = isConsoleError ? describeDataConsoleError(cause) : "Something went wrong.";
      if (onFailure === undefined) {
        setErrorText(message);
      } else {
        setErrorText(undefined);
        onFailure(isConsoleError ? { message, code: cause.code } : { message });
      }
    }
    return undefined;
  };

  // What the grid region shows in place of rows: a read that failed, or a
  // value this console can read the shape of but not browse.
  const noteGridFailure =
    (token: number) => (failure: { readonly message: string; readonly code?: string }) => {
      if (selectionTokenRef.current !== token) return;
      setGridNotice(
        failure.code === "unsupported"
          ? { kind: "unsupported" }
          : { kind: "error", message: failure.message },
      );
    };

  // Replacing the rows outright — a sort, a filter apply, a new query — has
  // to send the reader back to the top; appending a page deliberately does
  // not (`ZeropsDataTable` keeps the scroll position across an append).
  const resetGridScroll = () => {
    gridScrollRef.current?.scrollTo({ top: 0 });
  };

  // Always `refresh`, never `services`: discovery runs when the console
  // starts, so a plain listing answers with whatever existed then and a
  // service created since would never appear. `refresh` re-runs discovery and
  // answers in the same shape.
  const requestServices = () => {
    void runRequest({ kind: "refresh" }).then((response) => {
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
    setAppliedFilters([]);
    setAppliedRawWhere("");
    setRawWhereOpen(false);
    setAutoFocusFilterIndex(undefined);
    setFiltered(undefined);
    setFilteredSort(undefined);
    setFilteredLoadMorePending(false);
    setBlob(undefined);
    setGridNotice(undefined);
    setDocumentSearchQuery("");
    setDocumentSearchResult(undefined);
    setDocumentSearchLoadMorePending(false);
    selectionTokenRef.current += 1;
    filterTokenRef.current += 1;
  };

  // A tab named after a service the listing does not carry is the one case a
  // re-discovery can still fix — the service may have been created after the
  // console started. Exactly one refresh per service, then the tab settles on
  // whatever that answer says.
  const missingServiceKey = service === undefined ? null : `${env}:${service}`;
  const serviceIsMissing =
    service !== undefined &&
    services !== undefined &&
    !services.some((entry) => entry.hostname === service);
  if (
    serviceIsMissing &&
    missingServiceKey !== null &&
    missingServiceRefreshRef.current !== missingServiceKey
  ) {
    missingServiceRefreshRef.current = missingServiceKey;
    void runRequest({ kind: "refresh" }).then((response) => {
      if (response?.kind === "services") {
        setServices(response.services);
      }
      setMissingServiceRefreshed(missingServiceKey);
    });
  }

  // The collapsed chain has no row to click, so nothing else would ever ask
  // for its page: the panel expands and loads it itself, once per path.
  const treeCollapsedPrefix = service === undefined ? EMPTY_PREFIX : collapsedPrefix(tree, service);
  if (service !== undefined && treeCollapsedPrefix.length > 0) {
    const collapsedPath: ZeropsDataConsolePath = {
      service,
      segments: [...treeCollapsedPrefix],
    };
    const collapsedKey = treePathKey(collapsedPath);
    if (!collapsedLoadedKeysRef.current.has(collapsedKey)) {
      collapsedLoadedKeysRef.current.add(collapsedKey);
      setTree((current) => expandTreePath(current, collapsedPath));
      loadTreePage(collapsedPath);
    }
  }

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

  // Handed to `ZeropsDataTree` (which stays hookless by design) as
  // `sentinelRefFor`: a stable-identity ref callback per paged level, so
  // React doesn't tear the observer down and rebuild it on every render —
  // only the state map updates each call, the callback keeps reading it
  // live. `undefined` in a test (jsdom has no `IntersectionObserver`) or
  // before the scroll rail has mounted leaves the tree's own "Load more"
  // button as the only way to page, same fallback the grid's sentinel uses.
  const attachTreeSentinel = (
    key: string,
    path: ZeropsDataConsolePath,
    cursor: string,
  ): ((node: HTMLDivElement | null) => void) | undefined => {
    if (typeof IntersectionObserver === "undefined") return undefined;
    treeSentinelStateRef.current.set(key, { path, cursor });
    const existing = treeSentinelCallbacksRef.current.get(key);
    if (existing !== undefined) return existing;
    const callback = (node: HTMLDivElement | null) => {
      treeSentinelObserversRef.current.get(key)?.disconnect();
      treeSentinelObserversRef.current.delete(key);
      if (node === null) return;
      const observer = new IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) return;
          const state = treeSentinelStateRef.current.get(key);
          if (state !== undefined) handleLoadMoreTree(state.path, state.cursor);
        },
        { root: treeScrollRef.current, rootMargin: "200px" },
      );
      observer.observe(node);
      treeSentinelObserversRef.current.set(key, observer);
    };
    treeSentinelCallbacksRef.current.set(key, callback);
    return callback;
  };

  const handleSelectNode = (node: ZeropsDataConsoleNode) => {
    resetSelection();
    setSelectedNode(node);
    const myToken = selectionTokenRef.current;
    if (node.kind === "tabular") {
      void runRequest({ kind: "table", path: node.path }, noteGridFailure(myToken)).then(
        (response) => {
          if (selectionTokenRef.current !== myToken) return;
          if (response?.kind === "table") {
            setTableModel(applyTablePage(emptyTable, response.page));
          }
        },
      );
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

  // Selecting a container for its own family-shaped listing (an object
  // storage prefix, a KV namespace) issues no request of its own — it's the
  // same `tree` page the tree pane would ask for at this level, read back
  // via `listingEntry` below. Expanding it too keeps the tree in sync with
  // what the grid is now showing, so a step back down into it (the tree
  // toggle) never re-fetches something already on screen.
  const handleSelectContainer = (node: ZeropsDataConsoleNode) => {
    resetSelection();
    setSelectedNode(node);
    setTree((current) => expandTreePath(current, node.path));
    if (isNodeUnloaded(tree, node)) {
      loadTreePage(node.path);
    }
  };

  // A listing grid's row is a plain node, not a fetched table row: a
  // container descends the same way a tree click would, a leaf reuses the
  // existing selection handler (a blob opens its preview, a kv collection
  // key opens its own entries through the generic tabular path).
  const handleOpenListingRow = (node: ZeropsDataConsoleNode) => {
    if (node.kind === "container") {
      handleSelectContainer(node);
    } else {
      handleSelectNode(node);
    }
  };

  // An empty query (Enter on a blank box, or the query cleared some other
  // way) restores the plain index listing rather than issuing a search for
  // nothing — the console's `searchDocs` route is bounded, not built to
  // answer "everything".
  const handleDocumentSearchSubmit = () => {
    if (selectedService === null) return;
    const q = documentSearchQuery.trim();
    if (q === "") {
      setDocumentSearchResult(undefined);
      return;
    }
    void runRequest({ kind: "search", path: currentPath, q }).then((response) => {
      if (response?.kind === "search") {
        setDocumentSearchResult(
          documentListingModel(
            response.nodes,
            response.nextCursor === "" ? undefined : response.nextCursor,
          ),
        );
      }
    });
  };

  const handleDocumentSearchClear = () => {
    setDocumentSearchQuery("");
    setDocumentSearchResult(undefined);
  };

  const handleDocumentSearchLoadMore = (cursor: string) => {
    if (selectedService === null || documentSearchLoadMorePending) return;
    const q = documentSearchQuery.trim();
    if (q === "") return;
    setDocumentSearchLoadMorePending(true);
    void runRequest({ kind: "search", path: currentPath, q, page: { cursor } }).then((response) => {
      setDocumentSearchLoadMorePending(false);
      if (response?.kind !== "search") return;
      const page = documentListingModel(
        response.nodes,
        response.nextCursor === "" ? undefined : response.nextCursor,
      );
      setDocumentSearchResult((current) =>
        current === undefined
          ? page
          : {
              nodes: [...current.nodes, ...page.nodes],
              model: { ...page.model, rows: [...current.model.rows, ...page.model.rows] },
            },
      );
    });
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
    void runRequest(
      {
        kind: "table",
        path: selectedNode.path,
        page: {
          cursor,
          ...(tableSort ? { sort: tableSort.column, direction: tableSort.direction } : {}),
        },
      },
      noteGridFailure(myToken),
    ).then((response) => {
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
    resetGridScroll();
    setGridNotice(undefined);
    filterTokenRef.current += 1;
    const myToken = filterTokenRef.current;
    const selectionToken = selectionTokenRef.current;
    void runRequest(
      { kind: "query", service: node.path.service, stmt },
      noteGridFailure(selectionToken),
    ).then((response) => {
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
    resetGridScroll();
    setOpenRow(undefined);
    setFocusedRowIndex(undefined);
    selectionTokenRef.current += 1;
    const myToken = selectionTokenRef.current;
    setGridNotice(undefined);
    void runRequest(
      { kind: "table", path: selectedNode.path, page },
      noteGridFailure(myToken),
    ).then((response) => {
      if (selectionTokenRef.current !== myToken) return;
      if (response?.kind === "table") {
        setTableModel(applyTablePage(emptyTable, response.page));
      }
    });
  };

  const handleTableCount = () => {
    if (selectedNode === null) return;
    const myToken = selectionTokenRef.current;
    void runRequest({ kind: "tableCount", path: selectedNode.path }).then((response) => {
      if (selectionTokenRef.current !== myToken) return; // the user has moved on; that count is another node's
      if (response?.kind === "count") setTableCount(response.count);
    });
  };

  const handleQuerySubmit = (stmt: string) => {
    if (service === undefined) return;
    setQuerySort(undefined);
    setQueryLoadMorePending(false);
    setGridNotice(undefined);
    resetGridScroll();
    queryTokenRef.current += 1;
    const myToken = queryTokenRef.current;
    const selectionToken = selectionTokenRef.current;
    void runRequest({ kind: "query", service, stmt }, noteGridFailure(selectionToken)).then(
      (response) => {
        if (queryTokenRef.current !== myToken) return;
        if (response?.kind === "table") {
          setQueryState({ stmt, model: applyTablePage(emptyTable, response.page) });
        }
      },
    );
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
    resetGridScroll();
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

  const addContext = (
    context: { readonly label: string; readonly text: string },
    path: ZeropsDataConsolePath,
  ) => {
    if (service === undefined) return;
    onAddContext({
      kind: "data",
      token: `${path.service}.${visibleSegments(path.segments, treeCollapsedPrefix).join(".")}`,
      terminalId: `data:${context.label}`,
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
        <div className="flex items-center justify-between gap-2">
          <MicroLabel>Data</MicroLabel>
          <Button data-zerops-data-refresh onClick={requestServices} size="micro" variant="ghost">
            Refresh
          </Button>
        </div>
        {sessionLine ?? (
          <div className="space-y-1" data-zerops-data-services>
            {joinServicesWithTopology(services ?? [], topology.view?.services).map((row) => {
              const entry = row.service;
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
                    <span className="flex min-w-0 items-center gap-1.5">
                      {row.topologyService !== undefined ? (
                        <StatusDot
                          data-zerops-data-service-status
                          label={zeropsStatusWord(row.topologyService.status)}
                          tone={STATUS_DOT_TONE[serviceStatusTone(row.topologyService)]}
                        />
                      ) : null}
                      <span className="truncate">{entry.hostname}</span>
                    </span>
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

  // The family-shaped listing (`listingFor`, client-runtime): a container
  // (or the root, `selectedNode === null`) of an object-storage/KV service
  // gets its own children rendered as a grid instead of the generic
  // tabular/blob handling above. `listingEntry` is the same tree page the
  // tree pane itself reads for this path — this issues no request of its
  // own, "Load more" pages the tree the same way expanding it would.
  const listingKind = selectedService === null ? "tree" : listingFor(selectedService, selectedNode);
  const listingEntry = tree.entries[treePathKey(currentPath)];
  const nodeListing: DataConsoleNodeListing | null =
    listingKind === "objects"
      ? objectListingModel(listingEntry?.nodes ?? [], listingEntry?.nextCursor)
      : listingKind === "keys"
        ? kvListingModel(listingEntry?.nodes ?? [], listingEntry?.nextCursor)
        : listingKind === "documents"
          ? (documentSearchResult ??
            documentListingModel(listingEntry?.nodes ?? [], listingEntry?.nextCursor))
          : null;
  const searching = listingKind === "documents" && documentSearchResult !== undefined;
  const listingLoadMorePending = searching
    ? documentSearchLoadMorePending
    : pendingTreeKeys.has(treePathKey(currentPath));
  const canSearchDocs =
    listingKind === "documents" &&
    selectedService !== null &&
    resolveServiceAffordances(selectedService).canSearchDocs;
  const containerSelectable =
    selectedService !== null &&
    (selectedService.family === "object" ||
      selectedService.family === "kv" ||
      selectedService.family === "document");

  const browsable = affordances?.canBrowse === true;
  const awaitingMissingServiceRefresh =
    serviceIsMissing && missingServiceRefreshed !== missingServiceKey;

  // A tree loaded before the service had anything in it (a NATS bus whose
  // streams were created afterwards) has no other way back to the console:
  // nothing re-fetches a level that answered empty. The reload drops every
  // cached level, not just the root, so children fetched under the old answer
  // cannot outlive it.
  const handleReloadTree = () => {
    const rootPath: ZeropsDataConsolePath = { service, segments: [] };
    collapsedLoadedKeysRef.current.clear();
    resetSelection();
    setTree(expandTreePath(emptyTree, rootPath));
    loadTreePage(rootPath);
  };

  const shownRootEntry = tree.entries[treePathKey({ service, segments: [...treeCollapsedPrefix] })];
  const treeRootEmpty =
    shownRootEntry !== undefined && shownRootEntry.loaded && shownRootEntry.nodes.length === 0;

  const treeView = (
    <div className="space-y-1">
      {treeRootEmpty ? (
        <Button
          data-zerops-data-tree-reload
          onClick={handleReloadTree}
          size="micro"
          variant="ghost"
        >
          Reload
        </Button>
      ) : null}
      <ZeropsDataTree
        loadingKeys={pendingTreeKeys}
        onLoadMore={handleLoadMoreTree}
        onSelectNode={handleSelectNode}
        onToggleNode={handleToggleNode}
        rootPath={{ service, segments: [] }}
        tree={tree}
        {...(selectedNode ? { selectedNodeKey: treePathKey(selectedNode.path) } : {})}
        {...(selectedService?.family === "object"
          ? { nodeFilter: (node: ZeropsDataConsoleNode) => node.kind !== "blob" }
          : {})}
        {...(containerSelectable
          ? {
              onSelectContainer: handleSelectContainer,
              ...(selectedNode?.kind === "container"
                ? { selectedContainerKey: treePathKey(selectedNode.path) }
                : {}),
            }
          : {})}
        sentinelRefFor={attachTreeSentinel}
      />
    </div>
  );

  const filtersProps =
    selectedNode?.kind === "tabular" && selectedServiceDialect !== undefined
      ? {
          canClear: filtered !== undefined || hasActiveFilters(filters, rawWhere),
          columns: gridModel.columns,
          dirty: filtersDirty(
            { filters, rawWhere },
            { filters: appliedFilters, rawWhere: appliedRawWhere },
          ),
          filters,
          onApply: () => {
            if (selectedNode === null || selectedServiceDialect === undefined) return;
            setAppliedFilters(filters);
            setAppliedRawWhere(rawWhere);
            setAutoFocusFilterIndex(undefined);
            runFilteredStatement(
              selectedNode,
              selectedServiceDialect,
              filters,
              rawWhere,
              filteredSort,
            );
          },
          onChangeFilters: (next: ReadonlyArray<DataConsoleFilter>) => {
            setFilters(next);
            setAutoFocusFilterIndex(next.length > filters.length ? next.length - 1 : undefined);
          },
          onChangeRawWhere: setRawWhere,
          onClear: () => {
            setFilters([]);
            setRawWhere("");
            setAppliedFilters([]);
            setAppliedRawWhere("");
            setAutoFocusFilterIndex(undefined);
            setFiltered(undefined);
            setFilteredSort(undefined);
            setOpenRow(undefined);
            setGridNotice(undefined);
            resetGridScroll();
            filterTokenRef.current += 1;
          },
          onToggleRaw: () => setRawWhereOpen((current) => !current),
          rawOpen: rawWhereOpen,
          rawWhere,
          valueInputRef: filterValueInputRef,
          ...(autoFocusFilterIndex !== undefined ? { autoFocusIndex: autoFocusFilterIndex } : {}),
        }
      : null;

  const sqlToggle =
    affordances?.canQuery === true ? (
      <Button
        data-zerops-data-query-toggle
        onClick={() => setSqlOpen((current) => !current)}
        size="xs"
        variant={sqlOpen ? "secondary" : "ghost"}
      >
        SQL
      </Button>
    ) : null;

  const backToTable = () => {
    setQueryState(undefined);
    setQuerySort(undefined);
    setQueryLoadMorePending(false);
    setGridNotice(undefined);
    resetGridScroll();
    queryTokenRef.current += 1;
  };

  const belowToolbar = (
    <>
      {filtersProps === null ? null : <ZeropsDataFilters slot="rows" {...filtersProps} />}
      {affordances?.canQuery === true && sqlOpen ? (
        <ZeropsDataQuery onSubmit={handleQuerySubmit} />
      ) : null}
      {queryState === undefined ? null : (
        <div
          className="flex shrink-0 items-center justify-between gap-2 py-1 text-muted-foreground text-xs"
          data-zerops-data-query-result
        >
          <span>{`Query result · ${queryState.model.rows.length.toLocaleString()} rows loaded`}</span>
          <Button data-zerops-data-query-back onClick={backToTable} size="xs" variant="ghost">
            Back to table
          </Button>
        </div>
      )}
    </>
  );

  const gridNoticeView =
    gridNotice === undefined ? undefined : gridNotice.kind === "unsupported" ? (
      <p className="text-muted-foreground text-xs" data-zerops-data-grid-unsupported>
        This value can't be browsed yet.
      </p>
    ) : (
      <div className="space-y-1 text-xs" data-zerops-data-grid-error>
        <p className="text-destructive-foreground">Couldn't load rows</p>
        <p className="text-muted-foreground">{gridNotice.message}</p>
      </div>
    );

  // One grid region, so a query result replaces the table model rather than
  // stacking a second scrolling grid under it; "Back to table" drops the
  // query state and the untouched table model is on screen again.
  const gridView =
    queryState !== undefined ? (
      <ZeropsDataTable
        belowToolbar={belowToolbar}
        loadMorePending={queryLoadMorePending}
        model={queryState.model}
        onLoadMore={handleQueryLoadMore}
        onSort={handleQuerySort}
        scrollRegionRef={gridScrollRef}
        toolbarTrailing={sqlToggle}
        {...(gridNoticeView !== undefined ? { notice: gridNoticeView } : {})}
        {...(querySort ? { sort: querySort } : {})}
      />
    ) : nodeListing !== null ? (
      <ZeropsDataTable
        loadMorePending={listingLoadMorePending}
        model={nodeListing.model}
        onLoadMore={() => {
          if (nodeListing.model.nextCursor === undefined) return;
          if (searching) {
            handleDocumentSearchLoadMore(nodeListing.model.nextCursor);
          } else {
            handleLoadMoreTree(currentPath, nodeListing.model.nextCursor);
          }
        }}
        onOpenRow={(rowIndex) => {
          const node = nodeListing.nodes[rowIndex];
          if (node !== undefined) handleOpenListingRow(node);
        }}
        onSort={() => {}}
        scrollRegionRef={gridScrollRef}
        {...(canSearchDocs
          ? {
              toolbarLeading: (
                <input
                  className="h-7 rounded-[var(--zerops-card-radius)] border border-border bg-transparent px-2 text-xs"
                  data-zerops-data-document-search
                  onChange={(event) => setDocumentSearchQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") handleDocumentSearchSubmit();
                  }}
                  placeholder="Search documents…"
                  type="text"
                  value={documentSearchQuery}
                />
              ),
            }
          : {})}
        {...(searching
          ? {
              belowToolbar: (
                <div
                  className="flex shrink-0 items-center justify-between gap-2 py-1 text-muted-foreground text-xs"
                  data-zerops-data-document-search-status
                >
                  <span>
                    {describeDocumentListingStatus(
                      nodeListing.model.rows.length,
                      nodeListing.model.nextCursor !== undefined,
                      true,
                    )}
                  </span>
                  <Button
                    data-zerops-data-document-search-back
                    onClick={handleDocumentSearchClear}
                    size="xs"
                    variant="ghost"
                  >
                    Back to index
                  </Button>
                </div>
              ),
            }
          : {})}
      />
    ) : selectedNode?.kind === "tabular" ? (
      <ZeropsDataTable
        belowToolbar={belowToolbar}
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
                    collapsedPrefix: treeCollapsedPrefix,
                  }),
                  selectedNode.path,
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
        scrollRegionRef={gridScrollRef}
        toolbarTrailing={sqlToggle}
        {...(gridNoticeView !== undefined ? { notice: gridNoticeView } : {})}
        {...(filtersProps === null
          ? {}
          : {
              onFocusFilter: () => filterValueInputRef.current?.focus(),
              toolbarLeading: <ZeropsDataFilters slot="toolbar" {...filtersProps} />,
            })}
        {...(filtered === undefined ? { onRequestCount: handleTableCount } : {})}
        {...(gridSort ? { sort: gridSort } : {})}
        {...(tableCount !== undefined ? { count: tableCount } : {})}
        {...(focusedRowIndex !== undefined ? { focusedRowIndex } : {})}
      />
    ) : null;

  const drawerRow = openRow === undefined ? undefined : gridModel.rows[openRow.index];
  const drawerView =
    queryState === undefined &&
    drawerRow !== undefined &&
    openRow !== undefined &&
    selectedService !== null ? (
      <ZeropsDataRowDrawer
        addressable={gridModel.rowKeyCols.length > 0}
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
              collapsedPrefix: treeCollapsedPrefix,
            }),
            currentPath,
          )
        }
        row={drawerRow}
        {...(openRow.column !== undefined ? { expandedColumn: openRow.column } : {})}
      />
    ) : null;

  const contentPane = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-zerops-data-content>
      {gridView ?? (
        <>
          {sqlToggle === null ? null : (
            <div className="flex shrink-0 flex-wrap items-center gap-1 pb-1">{sqlToggle}</div>
          )}
          {belowToolbar}
          {selectedNode?.kind === "blob" && blob !== undefined ? (
            <div className="min-h-0 flex-1 overflow-auto">
              <ZeropsDataBlob blob={blob} name={selectedNode.name} />
            </div>
          ) : null}
        </>
      )}
    </div>
  );

  const notBrowsableLine =
    services !== undefined && !browsable && !awaitingMissingServiceRefresh ? (
      <p className="text-muted-foreground text-xs" data-zerops-data-not-browsable>
        This service can't be browsed yet.
      </p>
    ) : null;
  const showBrowse = sessionLine === null && notBrowsableLine === null;

  return (
    <FlatCard
      className="flex h-full min-h-0 flex-col overflow-hidden"
      data-zerops-data-panel="service"
      data-zerops-data-layout={layout}
      ref={measureRef.current}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 px-3 pt-3 pb-2">
        <div className="flex min-w-0 items-center gap-2">
          <ZeropsDataBreadcrumbs
            collapsedPrefix={treeCollapsedPrefix}
            onNavigate={handleNavigatePath}
            path={currentPath}
          />
          {selectedService !== null && selectedService.support !== "supported" ? (
            <Chip data-zerops-data-view-only label="View only" tone="off" />
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          {showBrowse && layout === "wide" ? (
            <Button
              data-zerops-data-tree-toggle-rail
              onClick={() => setTreeCollapsed((current) => !current)}
              size="micro"
              variant="ghost"
            >
              {treeCollapsed ? "Show tree" : "Hide tree"}
            </Button>
          ) : null}
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
      </div>

      {!showBrowse ? (
        <div className="shrink-0 px-3 pb-3">{sessionLine ?? notBrowsableLine}</div>
      ) : layout === "wide" ? (
        <div className="flex min-h-0 flex-1 gap-3 px-3" data-zerops-data-browse>
          {treeCollapsed ? null : (
            <div
              className="w-60 shrink-0 overflow-y-auto"
              data-zerops-data-tree-rail
              ref={treeScrollRef}
            >
              {treeView}
            </div>
          )}
          {contentPane}
          {drawerView === null ? null : (
            <div className="min-h-0 shrink-0 overflow-y-auto">{drawerView}</div>
          )}
        </div>
      ) : (
        <div className="relative flex min-h-0 flex-1 flex-col px-3" data-zerops-data-browse>
          {selectedNode === null && queryState === undefined && nodeListing === null ? (
            <div className="min-h-0 flex-1 overflow-y-auto" ref={treeScrollRef}>
              {treeView}
            </div>
          ) : (
            contentPane
          )}
          {drawerView}
        </div>
      )}

      {errorLine === null ? null : <div className="shrink-0 px-3 py-2">{errorLine}</div>}
    </FlatCard>
  );
}
