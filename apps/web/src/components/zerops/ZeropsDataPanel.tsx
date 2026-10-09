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
 * row detail — and no services rail, because the tab *is* the
 * service. `ChatView` keys the panel by `environmentId:service`, so both a
 * project switch and a service switch remount it fresh.
 *
 * Database facts and sampled read attempts live in the account data layer. This panel
 * reads its projection and expresses detail intents; drafts, selection, sort and layout
 * remain local. The adapter fences superseded calls and appends pages in their own target.
 */
import {
  buildSortPage,
  collapsedPrefix,
  describeRowContext,
  describeKeyExpiry,
  describeDocumentListingStatus,
  describeTableContext,
  isNodeUnloaded,
  kvListingModel,
  listingFor,
  objectListingModel,
  resolveDataLayout,
  resolveServiceAffordances,
  rowAsJson,
  toggleHiddenColumn,
  treePathKey,
  visibleSegments,
  documentListingModel,
  type DataConsoleNodeListing,
  type SortDirection,
} from "@t3tools/client-runtime/zerops/dataConsole";
import {
  serviceStatusTone,
  zeropsStatusWord,
  zeropsTypeShort,
} from "@t3tools/client-runtime/zerops/serviceMap";
import {
  type EnvironmentId,
  type ScopedThreadRef,
  type ZeropsDataConsoleColumn,
  type ZeropsDataConsoleNode,
  type ZeropsDataConsolePath,
} from "@t3tools/contracts";
import { Maximize2Icon, Minimize2Icon } from "lucide-react";
import { useRef, useState } from "react";

import type { TerminalContextSelection } from "../../lib/terminalContext";
import { useEnvironment } from "../../state/environments";
import { useDatabasePanel, useDatabaseServices } from "../../zerops/useDatabase";
import { databaseTreeTarget } from "@t3tools/client-runtime/data";
import { useZeropsDataConsole } from "../../zerops/useZeropsFeeds";
import { Button } from "../ui/button";
import { Chip, FlatCard, MicroLabel, StatusDot } from "./primitives";
import { ZeropsDataBlob } from "./ZeropsDataBlob";
import { ZeropsDataBreadcrumbs } from "./ZeropsDataBreadcrumbs";
import { ZeropsDataRowDrawer } from "./ZeropsDataRowDrawer";
import { ZeropsDataTable, type ZeropsDataTableSort } from "./ZeropsDataTable";
import { ZeropsDataTree } from "./ZeropsDataTree";
import { ZeropsMateUpdateControl } from "./ZeropsMateUpdateControl";

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

interface OpenRow {
  readonly index: number;
  readonly column?: string;
}

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
  // Absent on a Mate too old to have the data console at all (the
  // version-skew rule: missing means unsupported) — read before the
  // session/topology subscriptions so those never fire when this Mate can't
  // answer `zerops.dataConsole.call` in the first place.
  const environment = useEnvironment(environmentId)?.serverConfig?.environment;
  const dataConsoleSupported =
    environment === undefined || environment.capabilities.dataConsole === true;
  const session = useZeropsDataConsole(dataConsoleSupported ? environmentId : null);
  const serviceRows = useDatabaseServices(
    dataConsoleSupported ? environmentId : null,
    service ?? null,
  );
  const database = useDatabasePanel(dataConsoleSupported ? environmentId : null, service ?? null);
  const {
    services,
    tree,
    pendingTreeKeys,
    tableModel,
    tableLoadMorePending,
    tableCount,
    blob,
    errorText,
    gridNotice,
    documentSearchResult,
    documentSearchLoadMorePending,
  } = database;

  const [loadedSearch, setLoadedSearch] = useState("");
  const [rowPage, setRowPage] = useState(0);
  const [showList, setShowList] = useState(true);
  const [treeCollapsed, setTreeCollapsed] = useState(false);
  const [selectedNode, setSelectedNode] = useState<ZeropsDataConsoleNode | null>(null);
  const [tableSort, setTableSort] = useState<ZeropsDataTableSort | undefined>(undefined);
  const [hiddenColumns, setHiddenColumns] = useState<ReadonlySet<string>>(new Set());
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [openRow, setOpenRow] = useState<OpenRow | undefined>(undefined);
  const [focusedRowIndex, setFocusedRowIndex] = useState<number | undefined>(undefined);
  const [measuredWidth, setMeasuredWidth] = useState<number | undefined>(undefined);
  const [missingServiceRefreshed, setMissingServiceRefreshed] = useState<string | null>(null);
  // A document index's search box: the text box's own draft, and the last
  // *submitted* search's own query alongside its result (`undefined` =
  // showing the plain index listing instead) — separate from the draft so a
  // query mid-edit never disturbs what's on screen until Enter is pressed,
  // and so "Load more" always pages with the query that produced the result
  // on screen, never whatever the box holds by the time that click lands.
  const [documentSearchQuery, setDocumentSearchQuery] = useState("");
  const servicesRequestedForRef = useRef<EnvironmentId | null>(null);
  const openedServiceRef = useRef<string | null>(null);
  const missingServiceRefreshRef = useRef<string | null>(null);
  const collapsedLoadedKeysRef = useRef<Set<string>>(new Set());
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

  if (!dataConsoleSupported) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto w-full max-w-3xl">
          <FlatCard
            className="space-y-2 p-3"
            data-zerops-data-panel="picker"
            data-zerops-surface="data-console-unsupported"
          >
            <MicroLabel>Data</MicroLabel>
            <p className="text-muted-foreground text-xs">
              This Mate doesn't include the data console yet.
            </p>
            <ZeropsMateUpdateControl environmentId={environmentId}>
              {({ line }) => line}
            </ZeropsMateUpdateControl>
          </FlatCard>
        </div>
      </div>
    );
  }
  const env = environmentId;

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
  const requestServices = (manual = true) => {
    void database.read({ request: { kind: "refresh" }, target: "services", manual });
  };

  // Fires on `idle` as well as `ready`: the server starts the console on the
  // FIRST call, so a panel that waited for `ready` before calling would wait
  // forever on a fresh or idle-killed console (`ZeropsDataConsole.ts` header).
  // After an `unavailable` verdict the ref is cleared so the next `idle`
  // (a reconnect, a retried session) asks again instead of staying dark.
  const status = session?.status ?? "idle";
  const servicesRequestedFor = servicesRequestedForRef.current;
  if ((!database.available || status === "unavailable") && servicesRequestedFor === env) {
    servicesRequestedForRef.current = null;
  }
  if (
    database.available &&
    (status === "idle" || status === "ready") &&
    servicesRequestedFor !== env
  ) {
    servicesRequestedForRef.current = env;
    requestServices(false);
  }

  const loadTreePage = (path: ZeropsDataConsolePath, cursor?: string) => {
    const key = treePathKey(path);
    if (pendingTreeKeys.has(key)) return;
    void database.read({
      request: { kind: "tree", path, ...(cursor !== undefined ? { page: { cursor } } : {}) },
      target: databaseTreeTarget(path),
      ...(cursor === undefined ? {} : { cursor }),
    });
  };

  const resetSelection = () => {
    setSelectedNode(null);
    setRowPage(0);
    setShowList(true);
    database.update({ kind: "clear-selection" });
    setTableSort(undefined);
    setHiddenColumns(new Set());
    setColumnsOpen(false);
    setOpenRow(undefined);
    setFocusedRowIndex(undefined);
    database.update({ kind: "clear-filter" });
    database.update({ kind: "clear-grid" });
    setDocumentSearchQuery("");
    database.update({ kind: "clear-search" });
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
    void database
      .read({ request: { kind: "refresh" }, target: `services-missing/${service}`, manual: false })
      .then(() => {
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
      database.update({ kind: "expand", path: collapsedPath });
      loadTreePage(collapsedPath);
    }
  }

  const openServiceRoot = (hostname: string) => {
    resetSelection();
    database.update({ kind: "clear-query" });
    const rootPath: ZeropsDataConsolePath = { service: hostname, segments: [] };
    database.update({ kind: "expand", path: rootPath });
    loadTreePage(rootPath);
    void database.read({ request: { kind: "summary", service: hostname }, target: "summary" });
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
      database.update({ kind: "collapse", path: node.path });
      return;
    }
    const wasUnloaded = isNodeUnloaded(tree, node);
    database.update({ kind: "expand", path: node.path });
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
    setShowList(false);
    void database.read({ request: { kind: "stat", path: node.path }, target: "stat" });
    if (node.kind === "tabular") {
      void database.read({
        request: { kind: "table", path: node.path },
        target: "table",
        grid: true,
      });
    } else if (node.kind === "blob") {
      void database.read({ request: { kind: "blob", path: node.path }, target: "blob" });
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
    setShowList(false);
    database.update({ kind: "expand", path: node.path });
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
      database.update({ kind: "clear-search" });
      return;
    }
    void database.read({ request: { kind: "search", path: currentPath, q }, target: "search" });
  };

  const handleDocumentSearchClear = () => {
    setDocumentSearchQuery("");
    database.update({ kind: "clear-search" });
  };

  const handleDocumentSearchLoadMore = (cursor: string) => {
    if (
      selectedService === null ||
      documentSearchResult === undefined ||
      documentSearchLoadMorePending
    )
      return;
    const q = documentSearchResult.query;
    void database.read({
      request: { kind: "search", path: currentPath, q, page: { cursor } },
      target: "search",
      cursor,
    });
  };

  // A breadcrumb other than the last one is a step back up the path: it drops
  // the current node (in the narrow layout that is the way back to the tree)
  // and makes sure the container it names is expanded and loaded.
  const handleNavigatePath = (path: ZeropsDataConsolePath) => {
    resetSelection();
    database.update({ kind: "expand", path: path });
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
    void database.read({
      request: {
        kind: "table",
        path: selectedNode.path,
        page: {
          cursor,
          ...(tableSort ? { sort: tableSort.column, direction: tableSort.direction } : {}),
        },
      },
      target: "table",
      cursor,
      grid: true,
    });
  };

  const handleTableSort = (column: ZeropsDataConsoleColumn, direction: SortDirection) => {
    if (selectedNode === null) return;
    if (!column.sortable) return;
    const page = buildSortPage(column, direction);
    if (page === undefined) return;
    setRowPage(0);
    setTableSort({ column: column.name, direction });
    resetGridScroll();
    setOpenRow(undefined);
    setFocusedRowIndex(undefined);
    database.update({ kind: "clear-grid" });
    void database.read({
      request: { kind: "table", path: selectedNode.path, page },
      target: "table",
      grid: true,
    });
  };

  const handleTableCount = () => {
    if (selectedNode === null) return;
    void database.read({
      request: { kind: "tableCount", path: selectedNode.path },
      target: "count",
    });
  };

  const selectedService = services?.find((entry) => entry.hostname === service) ?? null;
  const platformService = serviceRows.find(
    (row) => row.service.hostname === service,
  )?.topologyService;
  const platformStatus = platformService?.status ?? selectedService?.status;
  const affordances = selectedService ? resolveServiceAffordances(selectedService) : null;
  const layout = resolveDataLayout(
    widthForTest ?? measuredWidth ?? (maximized ? ASSUMED_WIDTH_MAXIMIZED : ASSUMED_WIDTH_INLINE),
  );
  const { nextCursor: _nextCursor, ...loadedTable } = tableModel;
  const shownPage = Math.min(rowPage, Math.max(0, Math.ceil(tableModel.rows.length / 100) - 1));
  const gridModel = {
    ...loadedTable,
    rows: tableModel.rows.slice(shownPage * 100, (shownPage + 1) * 100),
  };
  const gridSort = tableSort;

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
        className="rounded-xl bg-muted/35 px-2 py-1 text-foreground text-xs"
        data-zerops-data-error
        role="alert"
      >
        {errorText}
      </p>
    ) : null;

  const sessionLine =
    status === "idle" || status === "starting" ? (
      <StatusDot label="Starting" tone="busy" />
    ) : status === "unavailable" ? (
      <div className="space-y-2">
        <p className="text-muted-foreground text-xs" data-zerops-data-unavailable>
          {session?.reason !== undefined
            ? `Data isn't available right now. ${session.reason}`
            : "Data isn't available right now."}
        </p>
        <Button
          data-zerops-data-retry
          onClick={() => requestServices()}
          size="xs"
          variant="outline"
        >
          Try again
        </Button>
      </div>
    ) : null;

  if (service === undefined) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto w-full max-w-3xl">
          <FlatCard className="space-y-3 p-3" data-zerops-data-panel="picker">
            <div className="flex items-center justify-between gap-2">
              <MicroLabel>Data</MicroLabel>
              <Button
                data-zerops-data-refresh
                onClick={() => requestServices()}
                size="micro"
                variant="ghost"
              >
                Refresh
              </Button>
            </div>
            {sessionLine ??
              (services !== undefined && services.length === 0 ? (
                /* A project with no managed data service rendered a label, a
                 Refresh and eight hundred pixels of nothing. Saying so is not
                 an error — most projects have no database — so it is a line,
                 not a warning. */
                <p className="text-muted-foreground text-xs" data-zerops-data-empty>
                  This project has no database or storage service. Add one and it will be browsable
                  here.
                </p>
              ) : (
                <div className="space-y-1" data-zerops-data-services>
                  {serviceRows.map((row) => {
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
              ))}
            {errorLine}
          </FlatCard>
        </div>
      </div>
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
  // "streams" never lists — a stream's only view is its metadata blob
  // preview, unconditionally (`gridView` below reads `listingKind` again to
  // make that explicit rather than let it fall out of this returning
  // `null` the same way "tree" does).
  const knownListing = listingEntry?.loaded === true ? listingEntry : undefined;
  const nodeListing: DataConsoleNodeListing | null =
    listingKind === "documents" && documentSearchResult !== undefined
      ? documentSearchResult.listing
      : knownListing === undefined
        ? null
        : listingKind === "objects"
          ? objectListingModel(knownListing.nodes, knownListing.nextCursor)
          : listingKind === "keys"
            ? kvListingModel(knownListing.nodes, knownListing.nextCursor)
            : listingKind === "documents"
              ? documentListingModel(knownListing.nodes, knownListing.nextCursor)
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
    database.update({ kind: "reset-tree", path: rootPath });
    loadTreePage(rootPath);
  };

  const shownRootEntry = tree.entries[treePathKey({ service, segments: [...treeCollapsedPrefix] })];
  const treeRootEmpty =
    shownRootEntry !== undefined && shownRootEntry.loaded && shownRootEntry.nodes.length === 0;

  const noun =
    selectedService?.family === "kv"
      ? "keys"
      : selectedService?.family === "object"
        ? "objects"
        : "tables";
  const inventoryNodes = database.inventory;
  const loadedCount = inventoryNodes.length;
  const selectedMetadata = database.node?.meta ?? selectedNode?.meta;
  const selectedState = database.readStates[selectedNode?.kind === "blob" ? "blob" : "table"];
  const missingItem =
    database.readStates.stat?.code === "not_found" || selectedState?.code === "not_found";
  const detailTime = database.lastRead[selectedNode?.kind === "blob" ? "blob" : "table"];
  const refreshDetail = () => {
    if (selectedNode === null) return;
    void database.read({ request: { kind: "stat", path: selectedNode.path }, target: "stat" });
    if (selectedNode.kind !== "container")
      void database.read({
        request: { kind: selectedNode.kind === "blob" ? "blob" : "table", path: selectedNode.path },
        target: selectedNode.kind === "blob" ? "blob" : "table",
        grid: true,
      });
    setRowPage(0);
  };

  const treeView = (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">
        {database.summary?.bucket ? `Bucket: ${database.summary.bucket}` : noun} · {loadedCount}{" "}
        loaded · Total unknown
      </p>
      <input
        aria-label="Filter loaded items"
        data-zerops-data-loaded-search
        className="w-full rounded border border-border bg-transparent px-2 py-1 text-xs"
        placeholder="Filter loaded names…"
        value={loadedSearch}
        onChange={(event) => setLoadedSearch(event.target.value)}
      />
      {loadedSearch !== "" ? (
        <p className="text-xs text-muted-foreground">
          Searching loaded items only.{" "}
          {inventoryNodes.some((node) =>
            node.name.toLowerCase().includes(loadedSearch.toLowerCase()),
          )
            ? ""
            : "No matches in loaded items."}
        </p>
      ) : null}
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
      {Object.entries(database.readStates)
        .filter(([target, state]) => target.startsWith("tree/") && state.error)
        .map(([target, state]) => {
          const entry = tree.entries[target.slice(5)];
          return (
            <div key={target} className="text-xs" role="alert">
              <span>{state.error}</span>
              <Button
                size="micro"
                variant="ghost"
                onClick={() => loadTreePage(entry?.path ?? { service, segments: [] })}
              >
                Retry list
              </Button>
            </div>
          );
        })}
      {database.lastRead[`tree/${treePathKey({ service, segments: [] })}`] !== undefined ? (
        <p className="text-xs text-muted-foreground">
          Last read{" "}
          {new Date(
            database.lastRead[`tree/${treePathKey({ service, segments: [] })}`]!,
          ).toLocaleTimeString()}
        </p>
      ) : null}
      {selectedService?.family === "kv" ? (
        <p className="text-xs text-muted-foreground">
          Prefix totals unknown · Scan is not a snapshot
        </p>
      ) : null}
      <ZeropsDataTree
        emptyLabel={loadedSearch ? "No matches in loaded items." : `No ${noun}.`}
        loadingKeys={pendingTreeKeys}
        onLoadMore={handleLoadMoreTree}
        onSelectNode={handleSelectNode}
        onToggleNode={handleToggleNode}
        rootPath={{ service, segments: [] }}
        tree={tree}
        {...(selectedNode ? { selectedNodeKey: treePathKey(selectedNode.path) } : {})}
        {...(loadedSearch !== ""
          ? {
              nodeFilter: (node: ZeropsDataConsoleNode) =>
                node.kind === "container" ||
                node.name.toLowerCase().includes(loadedSearch.toLowerCase()),
            }
          : {})}
        {...(containerSelectable
          ? {
              onSelectContainer: handleSelectContainer,
              ...(selectedNode?.kind === "container"
                ? { selectedContainerKey: treePathKey(selectedNode.path) }
                : {}),
            }
          : {})}
      />
    </div>
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
    listingKind === "streams" ? null : nodeListing !== null ? (
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
        columnsOpen={columnsOpen}
        hiddenColumns={hiddenColumns}
        loadMorePending={tableLoadMorePending}
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
        onLoadMore={handleTableLoadMore}
        onOpenRow={(rowIndex) => {
          setFocusedRowIndex(rowIndex);
          setOpenRow({ index: rowIndex });
        }}
        onSort={handleTableSort}
        onToggleColumn={(name) => setHiddenColumns((current) => toggleHiddenColumn(current, name))}
        onToggleColumnsOpen={() => setColumnsOpen((current) => !current)}
        scrollRegionRef={gridScrollRef}
        {...(tableModel.rows.length === 0 &&
        (gridNoticeView !== undefined || detailTime === undefined)
          ? { notice: gridNoticeView ?? <p>Loading detail…</p> }
          : {})}
        onRequestCount={handleTableCount}
        {...(gridSort ? { sort: gridSort } : {})}
        {...(tableCount !== undefined ? { count: tableCount } : {})}
        {...(focusedRowIndex !== undefined ? { focusedRowIndex } : {})}
      />
    ) : null;

  const drawerRow = openRow === undefined ? undefined : gridModel.rows[openRow.index];
  const drawerView =
    !missingItem && drawerRow !== undefined && openRow !== undefined && selectedService !== null ? (
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
      {selectedNode !== null ? (
        <div className="flex flex-wrap items-center gap-2 py-2 text-xs">
          <Button
            size="micro"
            variant="ghost"
            data-zerops-data-back
            onClick={() => setShowList(true)}
          >
            Back to {noun}
          </Button>
          <span>{selectedNode.name}</span>
          <Button size="micro" variant="ghost" onClick={refreshDetail}>
            Refresh detail
          </Button>
          {selectedMetadata?.entryType ? (
            <span>
              Type: {selectedMetadata.entryType} · {describeKeyExpiry(selectedMetadata)}
            </span>
          ) : null}
          {selectedService?.family === "object" ? (
            <span>
              {selectedMetadata?.size === undefined ? "Size unknown" : `${selectedMetadata.size} B`}{" "}
              · {selectedMetadata?.modified ?? "Date unknown"}
            </span>
          ) : null}
        </div>
      ) : null}
      {missingItem ? <p role="status">This item is missing or has expired.</p> : null}
      {selectedState?.error ? (
        <div role="alert">
          <span>{selectedState.error}</span>
          <Button size="micro" variant="ghost" onClick={refreshDetail}>
            Retry
          </Button>
        </div>
      ) : null}
      {selectedState?.pending ? (
        <p className="text-xs text-muted-foreground">Loading detail…</p>
      ) : null}
      {detailTime !== undefined ? (
        <p className="text-xs text-muted-foreground">
          Last read {new Date(detailTime).toLocaleTimeString()}
        </p>
      ) : null}
      {missingItem
        ? null
        : (gridView ?? (
            <>
              {selectedNode === null ? (
                <p className="p-3 text-sm text-muted-foreground" data-zerops-data-choose>
                  Choose a{" "}
                  {noun === "tables"
                    ? "table to preview its rows"
                    : noun === "keys"
                      ? "key to preview its value"
                      : "item to inspect"}
                  .
                </p>
              ) : null}
              {selectedNode?.kind === "blob" && blob !== undefined ? (
                <div className="min-h-0 flex-1 overflow-auto">
                  <ZeropsDataBlob blob={blob} name={selectedNode.name} />
                </div>
              ) : null}
            </>
          ))}
      {selectedNode?.kind === "tabular" && detailTime !== undefined && !missingItem ? (
        <div className="flex items-center gap-2 py-2 text-xs">
          <span>
            Rows {gridModel.rows.length === 0 ? 0 : shownPage * 100 + 1}–
            {shownPage * 100 + gridModel.rows.length}
            {tableModel.bestEffort ? " · Paging without a primary key is best effort" : ""}
          </span>
          <Button
            size="micro"
            variant="ghost"
            disabled={shownPage === 0}
            onClick={() => {
              setRowPage(shownPage - 1);
              setOpenRow(undefined);
            }}
          >
            Back
          </Button>
          <Button
            size="micro"
            variant="ghost"
            data-zerops-data-next-page
            disabled={
              tableLoadMorePending ||
              ((shownPage + 1) * 100 >= tableModel.rows.length &&
                tableModel.nextCursor === undefined)
            }
            onClick={() => {
              if ((shownPage + 1) * 100 >= tableModel.rows.length) handleTableLoadMore();
              setRowPage(shownPage + 1);
              setOpenRow(undefined);
            }}
          >
            Next 100
          </Button>
        </div>
      ) : null}
    </div>
  );

  const notBrowsableLine =
    services !== undefined && !browsable && !awaitingMissingServiceRefresh ? (
      <p className="text-muted-foreground text-xs" data-zerops-data-not-browsable>
        This service can't be browsed yet.
      </p>
    ) : null;
  const serviceStopped = ["STOPPED", "STOPPING", "stopped"].includes(platformStatus ?? "");
  const showBrowse =
    sessionLine === null && notBrowsableLine === null && !database.withheld && !serviceStopped;

  return (
    // The panel's gutter round the card: a full-bleed card put its rounded
    // corners on the panel's own edges.
    <div className="flex h-full min-h-0 flex-col p-4">
      <FlatCard
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
        data-zerops-data-panel="service"
        data-zerops-data-layout={layout}
        ref={measureRef.current}
      >
        <div className="space-y-1 px-3 pt-3 text-xs" data-zerops-data-identity>
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0" style={{ color: "var(--zerops-mate-mark-side)" }}>
              {service} ·{" "}
              {platformService
                ? zeropsTypeShort(platformService)
                : (selectedService?.type ?? "Type unknown")}{" "}
              · {platformStatus ? zeropsStatusWord(platformStatus) : "Status unknown"} ·{" "}
              {database.summary?.size === undefined ? "Size unknown" : `${database.summary.size} B`}
            </span>
            <span>Read only</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="truncate">
              {database.summary?.maskedConnection ??
                (database.readStates.summary?.pending
                  ? "Loading connection summary…"
                  : "Connection summary unavailable")}
            </span>
            {database.summary ? (
              <Button
                size="micro"
                variant="ghost"
                data-zerops-data-copy-connection
                onClick={() => copyToClipboard(database.summary!.maskedConnection)}
              >
                {selectedService?.family === "object"
                  ? "Copy endpoint/path"
                  : "Copy masked connection"}
              </Button>
            ) : (
              <Button
                size="micro"
                variant="ghost"
                onClick={() =>
                  void database.read({ request: { kind: "summary", service }, target: "summary" })
                }
              >
                Retry summary
              </Button>
            )}
          </div>
          {database.readStates.summary?.error ? (
            <p>Connection summary unavailable; the console may need an update.</p>
          ) : null}
          <Button
            size="micro"
            variant="ghost"
            data-zerops-data-refresh
            onClick={() => {
              requestServices();
              for (const entry of Object.values(tree.entries)) {
                if (entry.loaded) loadTreePage(entry.path);
              }
              refreshDetail();
            }}
          >
            Refresh
          </Button>
        </div>
        <div className="flex shrink-0 items-center justify-between gap-2 px-3 pt-3 pb-2">
          <div className="flex min-w-0 items-center gap-2">
            {database.withheld ? null : (
              <ZeropsDataBreadcrumbs
                collapsedPrefix={treeCollapsedPrefix}
                onNavigate={handleNavigatePath}
                path={currentPath}
              />
            )}
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
          <div className="shrink-0 px-3 pb-3">
            {database.withheld
              ? "Access denied. Protected data is withheld."
              : serviceStopped
                ? "Service stopped. Start it before browsing data."
                : (sessionLine ?? notBrowsableLine)}
          </div>
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
            <div
              className="min-h-0 flex-1 overflow-y-auto"
              data-zerops-data-list-scroll
              hidden={!showList}
              ref={treeScrollRef}
            >
              {treeView}
            </div>
            {!showList ? contentPane : null}
            {drawerView}
          </div>
        )}

        {errorLine === null ? null : <div className="shrink-0 px-3 py-2">{errorLine}</div>}
      </FlatCard>
    </div>
  );
}
