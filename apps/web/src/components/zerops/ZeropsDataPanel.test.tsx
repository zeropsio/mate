import { EnvironmentId, ThreadId, ZeropsDataConsoleError } from "@t3tools/contracts";
import type {
  ScopedThreadRef,
  ZeropsDataConsoleColumn,
  ZeropsDataConsoleNode,
  ZeropsDataConsoleRequest,
  ZeropsDataConsoleResponse,
  ZeropsDataConsoleService,
  ZeropsDataConsoleTablePage,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { TerminalContextSelection } from "../../lib/terminalContext";
import { reactHookHarness as hooks } from "../../test/reactHookHarness";
import { visitElements } from "../../test/reactElementTree";

const feedState = vi.hoisted(() => ({
  session: undefined as unknown,
}));

const commandSpy = vi.hoisted(() => vi.fn());

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { reactHookHarness } = await import("../../test/reactHookHarness");
  return {
    ...actual,
    useRef: reactHookHarness.useRef,
    useState: reactHookHarness.useState,
  };
});

vi.mock("react/compiler-runtime", async () => {
  const { reactHookHarness } = await import("../../test/reactHookHarness");
  return { c: reactHookHarness.useMemoCache };
});

vi.mock("../../zerops/useZeropsFeeds", () => ({
  useZeropsDataConsole: () => feedState.session,
}));

vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: () => commandSpy,
}));

vi.mock("../../state/zeropsCommands", () => ({
  zeropsCommands: { dataConsoleCall: Symbol("dataConsoleCall") },
}));

import { ZeropsDataPanel } from "./ZeropsDataPanel";
import { ZeropsDataBreadcrumbs } from "./ZeropsDataBreadcrumbs";
import { ZeropsDataFilters } from "./ZeropsDataFilters";
import { ZeropsDataQuery } from "./ZeropsDataQuery";
import { ZeropsDataRowDrawer } from "./ZeropsDataRowDrawer";
import { ZeropsDataTable } from "./ZeropsDataTable";
import { ZeropsDataTree } from "./ZeropsDataTree";
import { StatusDot } from "./primitives";

const THREAD_REF: ScopedThreadRef = {
  environmentId: EnvironmentId.make("environment-1"),
  threadId: ThreadId.make("thread-1"),
};

function findByAttribute(tree: unknown, attribute: string) {
  return visitElements(tree, (element) => attribute in element.props);
}

/** Locates a mounted subcomponent (`ZeropsDataTree`/`Table`/`Query`) by identity, not by
 * rendered DOM — the subcomponent function is never invoked when its parent is called as a
 * plain function (this repo's component-test style), so its own internal markup never appears
 * in the parent's returned tree. Its own props (the callbacks/data this test cares about) DO
 * appear on the element itself, which is what this reads. */
function findComponent<P>(tree: unknown, type: unknown): { readonly props: P } | null {
  const found = visitElements(tree, (element) => element.type === type);
  return found as { readonly props: P } | null;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await Promise.resolve();
  }
}

const onOpenService = vi.fn();
const onAddContext = vi.fn();
const onToggleMaximized = vi.fn();

interface RenderOptions {
  readonly threadRef?: ScopedThreadRef | null;
  readonly service?: string;
  readonly maximized?: boolean;
  readonly widthForTest?: number;
  readonly withMaximize?: boolean;
}

function render(options: RenderOptions = {}) {
  hooks.beginRender();
  return ZeropsDataPanel({
    threadRef: options.threadRef === undefined ? THREAD_REF : options.threadRef,
    maximized: options.maximized ?? false,
    onAddContext,
    onOpenService,
    ...(options.service !== undefined ? { service: options.service } : {}),
    ...(options.widthForTest !== undefined ? { widthForTest: options.widthForTest } : {}),
    ...(options.withMaximize === false ? {} : { onToggleMaximized }),
  });
}

const SERVICE_SUPPORTED: ZeropsDataConsoleService = {
  hostname: "db1",
  type: "postgresql",
  family: "postgresql",
  support: "supported",
  actions: [
    { id: "readTable", enabled: true, readOnly: true, reason: "" },
    { id: "querySQL", enabled: true, readOnly: true, reason: "" },
  ],
  status: "running",
};

const SERVICE_VIEW_ONLY: ZeropsDataConsoleService = {
  hostname: "kv1",
  type: "keydb",
  family: "keydb",
  support: "unsupported-version",
  actions: [
    { id: "readBlob", enabled: true, readOnly: true, reason: "" },
    {
      id: "showVPNGate",
      enabled: true,
      readOnly: true,
      reason: "Connect over VPN to browse this service.",
    },
  ],
  status: "running",
};

const SERVICE_NOT_BROWSABLE: ZeropsDataConsoleService = {
  hostname: "cache1",
  type: "keydb",
  family: "keydb",
  support: "supported",
  actions: [
    {
      id: "showVPNGate",
      enabled: true,
      readOnly: true,
      reason: "Connect over VPN to browse this service.",
    },
  ],
  status: "running",
};

function servicesResponse(
  services: readonly ZeropsDataConsoleService[] = [],
): ZeropsDataConsoleResponse {
  return { kind: "services", project: { id: "p1", name: "acme" }, services, allowWrites: false };
}

const EMPTY_TREE_RESPONSE: ZeropsDataConsoleResponse = { kind: "tree", nodes: [], nextCursor: "" };

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

function tablePage(
  overrides: Partial<ZeropsDataConsoleTablePage> = {},
): ZeropsDataConsoleTablePage {
  return {
    columns: [],
    rows: [],
    nextCursor: "",
    rowKeyCols: [],
    bestEffort: false,
    numbered: false,
    ...overrides,
  };
}

const ORDERS: ZeropsDataConsoleNode = {
  name: "orders",
  kind: "tabular",
  path: { service: "db1", segments: ["public", "orders"] },
  hasChildren: false,
  meta: {},
};

/** Renders the per-service tab through its own auto-open: the tab names the service, so the
 * listing landing is what opens it — there is no service row left to click. */
async function serviceTab(options: RenderOptions = {}) {
  feedState.session = { status: "ready", allowWrites: false };
  render({ service: "db1", widthForTest: 1200, ...options });
  await flush();
  const tree = render({ service: "db1", widthForTest: 1200, ...options });
  await flush();
  return tree;
}

describe("ZeropsDataPanel", () => {
  beforeEach(() => {
    hooks.reset();
    commandSpy.mockReset();
    onOpenService.mockReset();
    onAddContext.mockReset();
    onToggleMaximized.mockReset();
    feedState.session = undefined;
  });

  it("renders nothing for a null thread", () => {
    expect(render({ threadRef: null })).toBeNull();
  });

  it("shows a starting line while idle", () => {
    feedState.session = undefined;
    commandSpy.mockImplementation(() => new Promise(() => {}));
    const tree = render();
    const starting = findComponent<{ label: string }>(tree, StatusDot);
    expect(starting?.props.label).toBe("Starting");
  });

  it("issues the services request while idle — that first call is what starts the console", async () => {
    feedState.session = { status: "idle" };
    commandSpy.mockImplementation(() => Promise.resolve(AsyncResult.success(servicesResponse())));

    render();
    await flush();

    expect(commandSpy).toHaveBeenCalledWith({
      environmentId: THREAD_REF.environmentId,
      input: { kind: "services" },
    });
  });

  it("does not re-issue the services request when idle turns into ready", async () => {
    feedState.session = { status: "idle" };
    commandSpy.mockImplementation(() => Promise.resolve(AsyncResult.success(servicesResponse())));

    render();
    await flush();
    feedState.session = { status: "ready", allowWrites: false };
    render();
    await flush();

    const serviceCalls = commandSpy.mock.calls.filter(
      ([args]) => (args.input as ZeropsDataConsoleRequest).kind === "services",
    );
    expect(serviceCalls).toHaveLength(1);
  });

  it("re-issues the services request after an unavailable session recovers to idle", async () => {
    feedState.session = { status: "idle" };
    commandSpy.mockImplementation(() =>
      Promise.resolve(
        AsyncResult.failure(
          Cause.fail(
            new ZeropsDataConsoleError({
              code: "session_unavailable",
              message: "the data console is unavailable",
            }),
          ),
        ),
      ),
    );
    render();
    await flush();
    feedState.session = { status: "unavailable", reason: "boom" };
    render();
    await flush();

    commandSpy.mockImplementation(() => Promise.resolve(AsyncResult.success(servicesResponse())));
    feedState.session = { status: "idle" };
    render();
    await flush();

    const serviceCalls = commandSpy.mock.calls.filter(
      ([args]) => (args.input as ZeropsDataConsoleRequest).kind === "services",
    );
    expect(serviceCalls).toHaveLength(2);
  });

  it("Try again on an unavailable session re-issues the services request", async () => {
    feedState.session = { status: "unavailable", reason: "boom" };
    commandSpy.mockImplementation(() => Promise.resolve(AsyncResult.success(servicesResponse())));

    const tree = render();
    commandSpy.mockClear();
    (findByAttribute(tree, "data-zerops-data-retry")!.props.onClick as () => void)();

    expect(commandSpy).toHaveBeenCalledWith({
      environmentId: THREAD_REF.environmentId,
      input: { kind: "services" },
    });
  });

  it("shows a starting line while starting", () => {
    feedState.session = { status: "starting", allowWrites: false };
    const tree = render();
    const starting = findComponent<{ label: string }>(tree, StatusDot);
    expect(starting?.props.label).toBe("Starting");
  });

  it("shows the unsupported message", () => {
    feedState.session = { status: "unsupported", allowWrites: false };
    const tree = render();
    const unsupported = findByAttribute(tree, "data-zerops-data-unsupported");
    expect(unsupported?.props.children).toBe("This project doesn't support Data yet.");
  });

  it("shows the fixed unavailable line plus the reason carried by the event", () => {
    feedState.session = {
      status: "unavailable",
      reason: "console exited: EACCES",
      allowWrites: false,
    };
    const tree = render();
    const unavailable = findByAttribute(tree, "data-zerops-data-unavailable");
    expect(unavailable?.props.children).toBe(
      "Data isn't available right now. console exited: EACCES",
    );
  });

  it("falls back to a generic line when unavailable carries no reason", () => {
    feedState.session = { status: "unavailable", allowWrites: false };
    const tree = render();
    const unavailable = findByAttribute(tree, "data-zerops-data-unavailable");
    expect(unavailable?.props.children).toBe("Data isn't available right now.");
  });

  describe("picker tab", () => {
    async function picker(services: readonly ZeropsDataConsoleService[]) {
      feedState.session = { status: "ready", allowWrites: false };
      commandSpy.mockImplementation(() =>
        Promise.resolve(AsyncResult.success(servicesResponse(services))),
      );
      render();
      await flush();
      return render();
    }

    it("lists services and nothing else — no tree, no grid", async () => {
      const tree = await picker([SERVICE_SUPPORTED]);
      expect(findByAttribute(tree, "data-zerops-data-panel")!.props["data-zerops-data-panel"]).toBe(
        "picker",
      );
      expect(findComponent(tree, ZeropsDataTree)).toBeNull();
      expect(findComponent(tree, ZeropsDataTable)).toBeNull();
      expect(
        findByAttribute(tree, "data-zerops-data-service")!.props["data-zerops-data-service"],
      ).toBe("db1");
    });

    it("a browsable row opens that service's own tab instead of browsing in place", async () => {
      const tree = await picker([SERVICE_SUPPORTED]);
      commandSpy.mockClear();
      (findByAttribute(tree, "data-zerops-data-service")!.props.onClick as () => void)();
      expect(onOpenService).toHaveBeenCalledWith("db1");
      expect(commandSpy).not.toHaveBeenCalled();
    });

    it("marks a non-supported service view-only and shows its VPN gate hint", async () => {
      const tree = await picker([SERVICE_VIEW_ONLY]);
      expect(findByAttribute(tree, "data-zerops-data-service-view-only")!.props.label).toBe(
        "View only",
      );
      expect(findByAttribute(tree, "data-zerops-data-service-vpn-hint")!.props.children).toBe(
        "Connect over VPN to browse this service.",
      );
    });

    it("a supported service gets no view-only badge", async () => {
      const tree = await picker([SERVICE_SUPPORTED]);
      expect(findByAttribute(tree, "data-zerops-data-service-view-only")).toBeNull();
    });

    it("a service with no browse affordance is listed but not openable", async () => {
      const tree = await picker([SERVICE_NOT_BROWSABLE]);
      const row = findByAttribute(tree, "data-zerops-data-service")!;
      expect(row.props.disabled).toBe(true);
      (row.props.onClick as () => void)();
      expect(onOpenService).not.toHaveBeenCalled();
    });
  });

  describe("service tab", () => {
    function respond(
      services: readonly ZeropsDataConsoleService[],
      handler: (request: ZeropsDataConsoleRequest) => ZeropsDataConsoleResponse | undefined = () =>
        undefined,
    ) {
      commandSpy.mockImplementation((args: { input: ZeropsDataConsoleRequest }) => {
        if (args.input.kind === "services") {
          return Promise.resolve(AsyncResult.success(servicesResponse(services)));
        }
        const response = handler(args.input);
        return Promise.resolve(
          AsyncResult.success(response ?? (EMPTY_TREE_RESPONSE as ZeropsDataConsoleResponse)),
        );
      });
    }

    it("opens its own service's root as soon as the listing lands, with no services rail", async () => {
      respond([SERVICE_SUPPORTED]);
      const tree = await serviceTab();

      expect(findByAttribute(tree, "data-zerops-data-service")).toBeNull();
      expect(commandSpy).toHaveBeenCalledWith({
        environmentId: THREAD_REF.environmentId,
        input: { kind: "tree", path: { service: "db1", segments: [] } },
      });
      expect(findComponent(tree, ZeropsDataTree)).not.toBeNull();
    });

    it("expanding an unloaded container issues a tree request for its own path", async () => {
      const CONTAINER: ZeropsDataConsoleNode = {
        name: "public",
        kind: "container",
        path: { service: "db1", segments: ["public"] },
        hasChildren: true,
        meta: {},
      };
      respond([SERVICE_SUPPORTED]);
      const tree = await serviceTab();
      commandSpy.mockClear();
      findComponent<{ readonly onToggleNode: (node: ZeropsDataConsoleNode) => void }>(
        tree,
        ZeropsDataTree,
      )!.props.onToggleNode(CONTAINER);

      expect(commandSpy).toHaveBeenCalledWith({
        environmentId: THREAD_REF.environmentId,
        input: { kind: "tree", path: CONTAINER.path },
      });
    });

    it("says so quietly when the console does not classify this service", async () => {
      respond([SERVICE_NOT_BROWSABLE]);
      feedState.session = { status: "ready", allowWrites: false };
      render({ service: "cache1", widthForTest: 1200 });
      await flush();
      const tree = render({ service: "cache1", widthForTest: 1200 });

      expect(findByAttribute(tree, "data-zerops-data-not-browsable")!.props.children).toBe(
        "This service can't be browsed yet.",
      );
      expect(findComponent(tree, ZeropsDataTree)).toBeNull();
    });

    it("shows the maximize toggle only when the panel can be maximized", async () => {
      respond([SERVICE_SUPPORTED]);
      let tree = await serviceTab();
      const toggle = findByAttribute(tree, "data-zerops-data-maximize")!;
      expect(toggle.props["aria-label"]).toBe("Maximize panel");
      (toggle.props.onClick as () => void)();
      expect(onToggleMaximized).toHaveBeenCalledTimes(1);

      tree = render({ service: "db1", widthForTest: 1200, maximized: true });
      expect(findByAttribute(tree, "data-zerops-data-maximize")!.props["aria-label"]).toBe(
        "Restore panel",
      );

      hooks.reset();
      commandSpy.mockClear();
      respond([SERVICE_SUPPORTED]);
      const sheet = await serviceTab({ withMaximize: false });
      expect(findByAttribute(sheet, "data-zerops-data-maximize")).toBeNull();
    });

    async function selectOrders(
      handler?: (request: ZeropsDataConsoleRequest) => ZeropsDataConsoleResponse | undefined,
      options: RenderOptions = {},
    ) {
      respond([SERVICE_SUPPORTED], handler);
      await serviceTab(options);
      let tree = render({ service: "db1", widthForTest: 1200, ...options });
      findComponent<{ readonly onSelectNode: (node: ZeropsDataConsoleNode) => void }>(
        tree,
        ZeropsDataTree,
      )!.props.onSelectNode(ORDERS);
      await flush();
      tree = render({ service: "db1", widthForTest: 1200, ...options });
      return tree;
    }

    it("breadcrumbs name the selected path, and a crumb click walks back up it", async () => {
      const tree = await selectOrders(() => undefined);
      const crumbs = findComponent<{
        readonly path: { readonly segments: ReadonlyArray<string> };
        readonly onNavigate: (path: unknown) => void;
      }>(tree, ZeropsDataBreadcrumbs)!;
      expect(crumbs.props.path).toEqual(ORDERS.path);

      commandSpy.mockClear();
      crumbs.props.onNavigate({ service: "db1", segments: ["public"] });
      await flush();
      const back = render({ service: "db1", widthForTest: 1200 });
      expect(
        findComponent<{ readonly path: unknown }>(back, ZeropsDataBreadcrumbs)!.props.path,
      ).toEqual({ service: "db1", segments: [] });
      expect(commandSpy).toHaveBeenCalledWith({
        environmentId: THREAD_REF.environmentId,
        input: { kind: "tree", path: { service: "db1", segments: ["public"] } },
      });
    });

    it("shows the tree beside the content when wide and one zone at a time when narrow", async () => {
      const wide = await selectOrders(() => undefined);
      expect(
        findByAttribute(wide, "data-zerops-data-panel")!.props["data-zerops-data-layout"],
      ).toBe("wide");
      expect(findComponent(wide, ZeropsDataTree)).not.toBeNull();
      expect(findComponent(wide, ZeropsDataTable)).not.toBeNull();

      const narrow = render({ service: "db1", widthForTest: 400 });
      expect(
        findByAttribute(narrow, "data-zerops-data-panel")!.props["data-zerops-data-layout"],
      ).toBe("narrow");
      expect(findComponent(narrow, ZeropsDataTree)).toBeNull();
      expect(findComponent(narrow, ZeropsDataTable)).not.toBeNull();
    });

    it("a narrow tab with no node selected shows the tree instead of the grid", async () => {
      respond([SERVICE_SUPPORTED]);
      const tree = await serviceTab({ widthForTest: 400 });
      expect(findComponent(tree, ZeropsDataTree)).not.toBeNull();
      expect(findComponent(tree, ZeropsDataTable)).toBeNull();
    });

    it("keeps sort and hidden columns across a layout change", async () => {
      const COLUMNS = [column({ name: "id", pk: true }), column({ name: "total" })];
      const wide = await selectOrders((request) =>
        request.kind === "table"
          ? { kind: "table", page: tablePage({ columns: COLUMNS, rows: [[1, 5]] }) }
          : undefined,
      );
      const table = findComponent<{
        readonly onSort: (column: ZeropsDataConsoleColumn, direction: "asc" | "desc") => void;
        readonly onToggleColumn: (name: string) => void;
      }>(wide, ZeropsDataTable)!;
      table.props.onSort(COLUMNS[0]!, "asc");
      table.props.onToggleColumn("total");
      await flush();

      const narrow = render({ service: "db1", widthForTest: 400 });
      const narrowTable = findComponent<{
        readonly sort: { readonly column: string };
        readonly hiddenColumns: ReadonlySet<string>;
      }>(narrow, ZeropsDataTable)!;
      expect(narrowTable.props.sort).toEqual({ column: "id", direction: "asc" });
      expect([...narrowTable.props.hiddenColumns]).toEqual(["total"]);
    });

    it("Load more on a table appends via a cursor-carrying request", async () => {
      let tableCalls = 0;
      const tree = await selectOrders((request) => {
        if (request.kind !== "table") return undefined;
        tableCalls += 1;
        return {
          kind: "table",
          page:
            tableCalls === 1
              ? tablePage({ rows: [[1]], nextCursor: "cursor-1" })
              : tablePage({ rows: [[2]] }),
        };
      });

      let table = findComponent<{
        readonly onLoadMore: () => void;
        readonly model: { readonly rows: ReadonlyArray<ReadonlyArray<unknown>> };
      }>(tree, ZeropsDataTable)!;
      expect(table.props.model.rows).toEqual([[1]]);

      commandSpy.mockClear();
      table.props.onLoadMore();
      await flush();
      expect(commandSpy).toHaveBeenCalledWith({
        environmentId: THREAD_REF.environmentId,
        input: { kind: "table", path: ORDERS.path, page: { cursor: "cursor-1" } },
      });
      table = findComponent(render({ service: "db1", widthForTest: 1200 }), ZeropsDataTable)!;
      expect(table.props.model.rows).toEqual([[1], [2]]);
    });

    it("merges the current sort into a table Load more page request", async () => {
      const SORTABLE = column({ name: "id", pk: true });
      const tree = await selectOrders((request) =>
        request.kind === "table"
          ? { kind: "table", page: tablePage({ columns: [SORTABLE], nextCursor: "cursor-1" }) }
          : undefined,
      );
      findComponent<{
        readonly onSort: (column: ZeropsDataConsoleColumn, direction: "asc" | "desc") => void;
      }>(tree, ZeropsDataTable)!.props.onSort(SORTABLE, "asc");
      await flush();

      const table = findComponent<{ readonly onLoadMore: () => void }>(
        render({ service: "db1", widthForTest: 1200 }),
        ZeropsDataTable,
      )!;
      commandSpy.mockClear();
      table.props.onLoadMore();
      expect(commandSpy).toHaveBeenCalledWith({
        environmentId: THREAD_REF.environmentId,
        input: {
          kind: "table",
          path: ORDERS.path,
          page: { cursor: "cursor-1", sort: "id", direction: "asc" },
        },
      });
    });

    it("row count is fetched only on the explicit count action", async () => {
      const tree = await selectOrders((request) => {
        if (request.kind === "table") return { kind: "table", page: tablePage() };
        if (request.kind === "tableCount") return { kind: "count", count: 42 };
        return undefined;
      });
      expect(
        commandSpy.mock.calls.some(
          ([args]) => (args.input as ZeropsDataConsoleRequest).kind === "tableCount",
        ),
      ).toBe(false);

      findComponent<{ readonly onRequestCount: () => void }>(
        tree,
        ZeropsDataTable,
      )!.props.onRequestCount();
      await flush();
      expect(
        findComponent<{ readonly count: number }>(
          render({ service: "db1", widthForTest: 1200 }),
          ZeropsDataTable,
        )!.props.count,
      ).toBe(42);
    });

    it("drops a stale table response for a selection the user has since moved on from", async () => {
      const OTHER: ZeropsDataConsoleNode = {
        ...ORDERS,
        name: "customers",
        path: { service: "db1", segments: ["public", "customers"] },
      };
      let resolveStale: (() => void) | undefined;
      respond([SERVICE_SUPPORTED]);
      commandSpy.mockImplementation((args: { input: ZeropsDataConsoleRequest }) => {
        if (args.input.kind === "services") {
          return Promise.resolve(AsyncResult.success(servicesResponse([SERVICE_SUPPORTED])));
        }
        if (args.input.kind === "table" && args.input.path.segments[1] === "orders") {
          return new Promise((resolve) => {
            resolveStale = () =>
              resolve(
                AsyncResult.success({
                  kind: "table",
                  page: tablePage({ rows: [["stale"]] }),
                } as ZeropsDataConsoleResponse),
              );
          });
        }
        if (args.input.kind === "table") {
          return Promise.resolve(
            AsyncResult.success({
              kind: "table",
              page: tablePage({ rows: [["fresh"]] }),
            } as ZeropsDataConsoleResponse),
          );
        }
        return Promise.resolve(AsyncResult.success(EMPTY_TREE_RESPONSE));
      });

      await serviceTab();
      const tree = render({ service: "db1", widthForTest: 1200 });
      const treeComponent = findComponent<{
        readonly onSelectNode: (node: ZeropsDataConsoleNode) => void;
      }>(tree, ZeropsDataTree)!;
      treeComponent.props.onSelectNode(ORDERS);
      treeComponent.props.onSelectNode(OTHER);
      await flush();
      let table = findComponent<{
        readonly model: { readonly rows: ReadonlyArray<ReadonlyArray<unknown>> };
      }>(render({ service: "db1", widthForTest: 1200 }), ZeropsDataTable)!;
      expect(table.props.model.rows).toEqual([["fresh"]]);

      resolveStale?.();
      await flush();
      table = findComponent(render({ service: "db1", widthForTest: 1200 }), ZeropsDataTable)!;
      expect(table.props.model.rows).toEqual([["fresh"]]);
    });

    it("applying filters runs a read-only statement and marks the grid filtered", async () => {
      const tree = await selectOrders((request) =>
        request.kind === "table"
          ? { kind: "table", page: tablePage({ columns: [column({ name: "status" })] }) }
          : { kind: "table", page: tablePage({ rows: [["filtered"]] }) },
      );
      const filters = findComponent<{
        readonly onChangeFilters: (filters: ReadonlyArray<unknown>) => void;
        readonly onChangeRawWhere: (raw: string) => void;
        readonly onApply: () => void;
      }>(tree, ZeropsDataFilters)!;
      filters.props.onChangeFilters([{ column: "status", op: "eq", value: "paid" }]);
      filters.props.onChangeRawWhere("total > 10");
      await flush();

      commandSpy.mockClear();
      findComponent<{ readonly onApply: () => void }>(
        render({ service: "db1", widthForTest: 1200 }),
        ZeropsDataFilters,
      )!.props.onApply();
      await flush();

      expect(commandSpy).toHaveBeenCalledWith({
        environmentId: THREAD_REF.environmentId,
        input: {
          kind: "query",
          service: "db1",
          stmt: 'SELECT * FROM "public"."orders" WHERE "status" = \'paid\' AND (total > 10) LIMIT 200',
        },
      });
      const grid = findComponent<{
        readonly filtered: boolean;
        readonly model: { readonly rows: ReadonlyArray<ReadonlyArray<unknown>> };
      }>(render({ service: "db1", widthForTest: 1200 }), ZeropsDataTable)!;
      expect(grid.props.filtered).toBe(true);
      expect(grid.props.model.rows).toEqual([["filtered"]]);
    });

    it("sorting a filtered grid rebuilds the statement's ORDER BY instead of paging", async () => {
      const STATUS = column({ name: "status" });
      const tree = await selectOrders((request) =>
        request.kind === "table"
          ? { kind: "table", page: tablePage({ columns: [STATUS] }) }
          : { kind: "table", page: tablePage({ columns: [STATUS], rows: [["paid"]] }) },
      );
      findComponent<{ readonly onApply: () => void }>(tree, ZeropsDataFilters)!.props.onApply();
      await flush();

      const grid = findComponent<{
        readonly onSort: (column: ZeropsDataConsoleColumn, direction: "asc" | "desc") => void;
      }>(render({ service: "db1", widthForTest: 1200 }), ZeropsDataTable)!;
      commandSpy.mockClear();
      grid.props.onSort(STATUS, "desc");

      expect(commandSpy).toHaveBeenCalledWith({
        environmentId: THREAD_REF.environmentId,
        input: {
          kind: "query",
          service: "db1",
          stmt: 'SELECT * FROM "public"."orders" ORDER BY "status" DESC LIMIT 200',
        },
      });
    });

    it("clearing filters returns the plain table to the grid", async () => {
      const tree = await selectOrders((request) =>
        request.kind === "table"
          ? { kind: "table", page: tablePage({ rows: [["plain"]] }) }
          : { kind: "table", page: tablePage({ rows: [["filtered"]] }) },
      );
      findComponent<{ readonly onApply: () => void }>(tree, ZeropsDataFilters)!.props.onApply();
      await flush();
      findComponent<{ readonly onClear: () => void }>(
        render({ service: "db1", widthForTest: 1200 }),
        ZeropsDataFilters,
      )!.props.onClear();
      await flush();

      const grid = findComponent<{
        readonly filtered: boolean;
        readonly model: { readonly rows: ReadonlyArray<ReadonlyArray<unknown>> };
      }>(render({ service: "db1", widthForTest: 1200 }), ZeropsDataTable)!;
      expect(grid.props.filtered).toBe(false);
      expect(grid.props.model.rows).toEqual([["plain"]]);
    });

    it("a service with no SQL dialect gets no filter bar", async () => {
      respond([SERVICE_VIEW_ONLY]);
      feedState.session = { status: "ready", allowWrites: false };
      render({ service: "kv1", widthForTest: 1200 });
      await flush();
      let tree = render({ service: "kv1", widthForTest: 1200 });
      findComponent<{ readonly onSelectNode: (node: ZeropsDataConsoleNode) => void }>(
        tree,
        ZeropsDataTree,
      )!.props.onSelectNode({ ...ORDERS, path: { service: "kv1", segments: ["k"] } });
      await flush();
      tree = render({ service: "kv1", widthForTest: 1200 });

      expect(findComponent(tree, ZeropsDataFilters)).toBeNull();
    });

    it("opens the row drawer on a row, and hands the row to the composer", async () => {
      const COLUMNS = [column({ name: "id", pk: true }), column({ name: "total" })];
      const tree = await selectOrders((request) =>
        request.kind === "table"
          ? { kind: "table", page: tablePage({ columns: COLUMNS, rows: [[7, 12]] }) }
          : undefined,
      );
      expect(findComponent(tree, ZeropsDataRowDrawer)).toBeNull();

      findComponent<{ readonly onOpenRow: (index: number) => void }>(
        tree,
        ZeropsDataTable,
      )!.props.onOpenRow(0);
      await flush();
      const opened = render({ service: "db1", widthForTest: 1200 });
      const drawer = findComponent<{
        readonly row: ReadonlyArray<unknown>;
        readonly onExplain: () => void;
        readonly onClose: () => void;
      }>(opened, ZeropsDataRowDrawer)!;
      expect(drawer.props.row).toEqual([7, 12]);

      drawer.props.onExplain();
      const selection = onAddContext.mock.calls[0]![0] as TerminalContextSelection;
      expect(selection.terminalId).toBe("data:db1");
      expect(selection.terminalLabel).toBe("db1 · public.orders · id=7");
      expect(selection.lineStart).toBe(1);
      expect(selection.lineEnd).toBe(selection.text.split("\n").length);
      expect(selection.text).toContain('"id": 7');

      drawer.props.onClose();
      await flush();
      expect(
        findComponent(render({ service: "db1", widthForTest: 1200 }), ZeropsDataRowDrawer),
      ).toBeNull();
    });

    it("a cell expander opens the drawer on that column", async () => {
      const COLUMNS = [column({ name: "id", pk: true }), column({ name: "payload" })];
      const tree = await selectOrders((request) =>
        request.kind === "table"
          ? { kind: "table", page: tablePage({ columns: COLUMNS, rows: [[7, { a: 1 }]] }) }
          : undefined,
      );
      findComponent<{ readonly onExpandCell: (row: number, column: string) => void }>(
        tree,
        ZeropsDataTable,
      )!.props.onExpandCell(0, "payload");
      await flush();

      expect(
        findComponent<{ readonly expandedColumn: string }>(
          render({ service: "db1", widthForTest: 1200 }),
          ZeropsDataRowDrawer,
        )!.props.expandedColumn,
      ).toBe("payload");
    });

    it("Ask about this table hands the table's shape to the composer", async () => {
      const COLUMNS = [column({ name: "id", pk: true })];
      const tree = await selectOrders((request) => {
        if (request.kind === "table") {
          return { kind: "table", page: tablePage({ columns: COLUMNS }) };
        }
        if (request.kind === "tableCount") return { kind: "count", count: 9 };
        return undefined;
      });
      findComponent<{ readonly onRequestCount: () => void }>(
        tree,
        ZeropsDataTable,
      )!.props.onRequestCount();
      await flush();

      findComponent<{ readonly onAskAboutTable: () => void }>(
        render({ service: "db1", widthForTest: 1200 }),
        ZeropsDataTable,
      )!.props.onAskAboutTable();
      const selection = onAddContext.mock.calls[0]![0] as TerminalContextSelection;
      expect(selection.terminalLabel).toBe("db1 · public.orders");
      expect(selection.text).toContain("- id: integer (pk)");
      expect(selection.text).toContain("~9 rows");
    });

    it("copying does nothing when the browser exposes no clipboard", async () => {
      const tree = await selectOrders((request) =>
        request.kind === "table"
          ? { kind: "table", page: tablePage({ columns: [column()], rows: [[1]] }) }
          : undefined,
      );
      expect(() =>
        findComponent<{ readonly onCopyPageJson: () => void }>(
          tree,
          ZeropsDataTable,
        )!.props.onCopyPageJson(),
      ).not.toThrow();
    });

    it("keeps the query box for a service that can query, and submits its statement", async () => {
      const tree = await selectOrders((request) =>
        request.kind === "table" ? { kind: "table", page: tablePage() } : undefined,
      );
      const query = findComponent<{ readonly onSubmit: (stmt: string) => void }>(
        tree,
        ZeropsDataQuery,
      )!;
      commandSpy.mockClear();
      query.props.onSubmit("select 1");
      expect(commandSpy).toHaveBeenCalledWith({
        environmentId: THREAD_REF.environmentId,
        input: { kind: "query", service: "db1", stmt: "select 1" },
      });
    });

    it("only renders the query box when the service can query", async () => {
      respond([SERVICE_VIEW_ONLY]);
      feedState.session = { status: "ready", allowWrites: false };
      render({ service: "kv1", widthForTest: 1200 });
      await flush();
      expect(
        findComponent(render({ service: "kv1", widthForTest: 1200 }), ZeropsDataQuery),
      ).toBeNull();
    });

    it("shows describeDataConsoleError's text for a rejected ZeropsDataConsoleError", async () => {
      feedState.session = { status: "ready", allowWrites: false };
      commandSpy.mockImplementation(() =>
        Promise.resolve(
          AsyncResult.failure(
            Cause.fail(
              new ZeropsDataConsoleError({ code: "unreachable", message: "dial tcp: refused" }),
            ),
          ),
        ),
      );
      render({ service: "db1", widthForTest: 1200 });
      await flush();
      const tree = render({ service: "db1", widthForTest: 1200 });

      expect(findByAttribute(tree, "data-zerops-data-error")!.props.children).toBe(
        "Couldn't reach the service. Check that it's running.",
      );
    });

    it("shows a generic fallback line for a non-ZeropsDataConsoleError rejection", async () => {
      feedState.session = { status: "ready", allowWrites: false };
      commandSpy.mockImplementation(() =>
        Promise.resolve(AsyncResult.failure(Cause.fail(new Error("boom")))),
      );
      render({ service: "db1", widthForTest: 1200 });
      await flush();
      const tree = render({ service: "db1", widthForTest: 1200 });

      expect(findByAttribute(tree, "data-zerops-data-error")!.props.children).toBe(
        "Something went wrong.",
      );
    });
  });
});
