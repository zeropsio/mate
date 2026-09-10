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
  topology: { view: undefined } as { view: unknown },
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

vi.mock("../../zerops/useProjectTopology", () => ({
  useProjectTopology: () => feedState.topology,
}));

vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: () => commandSpy,
}));

vi.mock("../../state/zeropsCommands", () => ({
  zeropsCommands: { dataConsoleCall: Symbol("dataConsoleCall") },
}));

import { collapsedPrefix, treePathKey } from "@t3tools/client-runtime/zerops/dataConsole";
import type { DataConsoleTree } from "@t3tools/client-runtime/zerops/dataConsole";

import { ZeropsDataPanel } from "./ZeropsDataPanel";
import { ZeropsDataBlob } from "./ZeropsDataBlob";
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

/** Every mounted element of one component type — the grid is meant to be a single region. */
function allComponents(tree: unknown, type: unknown): ReadonlyArray<{ readonly props: unknown }> {
  const found: { readonly props: unknown }[] = [];
  visitElements(tree, (element) => {
    if (element.type === type) found.push(element);
    return false;
  });
  return found;
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
    feedState.topology = { view: undefined };
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

  it("issues the listing as a refresh while idle — that first call is what starts the console, and refresh sees services created since it started", async () => {
    feedState.session = { status: "idle" };
    commandSpy.mockImplementation(() => Promise.resolve(AsyncResult.success(servicesResponse())));

    render();
    await flush();

    expect(commandSpy).toHaveBeenCalledWith({
      environmentId: THREAD_REF.environmentId,
      input: { kind: "refresh" },
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
      ([args]) => (args.input as ZeropsDataConsoleRequest).kind === "refresh",
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
      ([args]) => (args.input as ZeropsDataConsoleRequest).kind === "refresh",
    );
    expect(serviceCalls).toHaveLength(2);
  });

  it("Try again on an unavailable session re-issues the listing", async () => {
    feedState.session = { status: "unavailable", reason: "boom" };
    commandSpy.mockImplementation(() => Promise.resolve(AsyncResult.success(servicesResponse())));

    const tree = render();
    commandSpy.mockClear();
    (findByAttribute(tree, "data-zerops-data-retry")!.props.onClick as () => void)();

    expect(commandSpy).toHaveBeenCalledWith({
      environmentId: THREAD_REF.environmentId,
      input: { kind: "refresh" },
    });
  });

  it("Refresh on the picker re-issues the listing", async () => {
    feedState.session = { status: "ready", allowWrites: false };
    commandSpy.mockImplementation(() => Promise.resolve(AsyncResult.success(servicesResponse())));

    const tree = render();
    await flush();
    commandSpy.mockClear();
    (findByAttribute(tree, "data-zerops-data-refresh")!.props.onClick as () => void)();

    expect(commandSpy).toHaveBeenCalledWith({
      environmentId: THREAD_REF.environmentId,
      input: { kind: "refresh" },
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

    it("orders rows by the platform topology and shows the topology status dot for a matched row", async () => {
      const secondService: ZeropsDataConsoleService = { ...SERVICE_SUPPORTED, hostname: "db2" };
      feedState.topology = {
        view: {
          services: [
            { hostname: "db2", status: "ACTIVE", transient: false },
            { hostname: "db1", status: "ACTIVE", transient: false },
          ],
        },
      };
      const tree = await picker([SERVICE_SUPPORTED, secondService]);
      const serviceRows: string[] = [];
      visitElements(tree, (element) => {
        const hostname = element.props["data-zerops-data-service"] as string | undefined;
        if (hostname !== undefined) serviceRows.push(hostname);
        return false;
      });
      expect(serviceRows).toEqual(["db2", "db1"]);
      const statusDots = allComponents(tree, StatusDot);
      expect(statusDots).toHaveLength(2);
      expect((statusDots[0]!.props as { label: string }).label).toBe("Active");
    });

    it("puts a console service with no topology match last, without a status dot", async () => {
      feedState.topology = {
        view: { services: [{ hostname: "db1", status: "ACTIVE", transient: false }] },
      };
      const orphan: ZeropsDataConsoleService = { ...SERVICE_SUPPORTED, hostname: "orphan" };
      const tree = await picker([orphan, SERVICE_SUPPORTED]);
      const serviceRows: string[] = [];
      visitElements(tree, (element) => {
        const hostname = element.props["data-zerops-data-service"] as string | undefined;
        if (hostname !== undefined) serviceRows.push(hostname);
        return false;
      });
      expect(serviceRows).toEqual(["db1", "orphan"]);
      expect(allComponents(tree, StatusDot)).toHaveLength(1);
    });

    it("renders console order and no status dots while the topology view has not loaded", async () => {
      const tree = await picker([SERVICE_VIEW_ONLY, SERVICE_SUPPORTED]);
      const serviceRows: string[] = [];
      visitElements(tree, (element) => {
        const hostname = element.props["data-zerops-data-service"] as string | undefined;
        if (hostname !== undefined) serviceRows.push(hostname);
        return false;
      });
      expect(serviceRows).toEqual(["kv1", "db1"]);
      expect(allComponents(tree, StatusDot)).toHaveLength(0);
    });
  });

  describe("service tab", () => {
    function respond(
      services: readonly ZeropsDataConsoleService[],
      handler: (request: ZeropsDataConsoleRequest) => ZeropsDataConsoleResponse | undefined = () =>
        undefined,
    ) {
      commandSpy.mockImplementation((args: { input: ZeropsDataConsoleRequest }) => {
        if (args.input.kind === "services" || args.input.kind === "refresh") {
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

    it("gives the tree rail its own overflow-y-auto scroll container (wide layout) — the grid's own overflow-auto region is ZeropsDataTable's own responsibility, proven in its own test", async () => {
      respond([SERVICE_SUPPORTED]);
      const tree = await serviceTab();

      const treeRail = findByAttribute(tree, "data-zerops-data-tree-rail")!;
      expect(treeRail.props.className).toContain("overflow-y-auto");
    });

    it("shows a View only chip next to the breadcrumb for a non-supported service (ClickHouse/Qdrant/streams)", async () => {
      const SERVICE_VIEW_ONLY_TABULAR: ZeropsDataConsoleService = {
        hostname: "db1",
        type: "clickhouse",
        family: "tabular",
        support: "view-only",
        actions: [{ id: "readTable", enabled: true, readOnly: true, reason: "" }],
        status: "running",
      };
      respond([SERVICE_VIEW_ONLY_TABULAR]);
      const tree = await serviceTab();
      expect(findByAttribute(tree, "data-zerops-data-view-only")).not.toBeNull();
    });

    it("shows no View only chip for a fully supported service", async () => {
      respond([SERVICE_SUPPORTED]);
      const tree = await serviceTab();
      expect(findByAttribute(tree, "data-zerops-data-view-only")).toBeNull();
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

    it("re-lists once for a service the listing does not name, and browses it when the refresh finds it", async () => {
      let listed: readonly ZeropsDataConsoleService[] = [];
      commandSpy.mockImplementation((args: { input: ZeropsDataConsoleRequest }) => {
        if (args.input.kind === "services") {
          return Promise.resolve(AsyncResult.success(servicesResponse(listed)));
        }
        if (args.input.kind === "refresh") {
          listed = [SERVICE_SUPPORTED];
          return Promise.resolve(AsyncResult.success(servicesResponse(listed)));
        }
        return Promise.resolve(AsyncResult.success(EMPTY_TREE_RESPONSE));
      });
      feedState.session = { status: "ready", allowWrites: false };

      render({ service: "db1", widthForTest: 1200 });
      await flush();
      await flush();
      const tree = render({ service: "db1", widthForTest: 1200 });

      expect(findByAttribute(tree, "data-zerops-data-not-browsable")).toBeNull();
      expect(findComponent(tree, ZeropsDataTree)).not.toBeNull();
    });

    it("re-lists only once for a service the console never names", async () => {
      commandSpy.mockImplementation((args: { input: ZeropsDataConsoleRequest }) => {
        if (args.input.kind === "services" || args.input.kind === "refresh") {
          return Promise.resolve(AsyncResult.success(servicesResponse([])));
        }
        return Promise.resolve(AsyncResult.success(EMPTY_TREE_RESPONSE));
      });
      feedState.session = { status: "ready", allowWrites: false };

      render({ service: "db1", widthForTest: 1200 });
      await flush();
      await flush();
      render({ service: "db1", widthForTest: 1200 });
      await flush();
      const tree = render({ service: "db1", widthForTest: 1200 });

      expect(
        commandSpy.mock.calls.filter(
          ([args]) => (args.input as ZeropsDataConsoleRequest).kind === "refresh",
        ),
      ).toHaveLength(2);
      expect(findByAttribute(tree, "data-zerops-data-not-browsable")!.props.children).toBe(
        "This service can't be browsed yet.",
      );
    });

    it("loads a lone schema itself and shows its tables with no schema row", async () => {
      const SCHEMA: ZeropsDataConsoleNode = {
        name: "public",
        kind: "container",
        path: { service: "db1", segments: ["public"] },
        hasChildren: true,
        meta: {},
      };
      const TABLE: ZeropsDataConsoleNode = {
        name: "orders",
        kind: "tabular",
        path: { service: "db1", segments: ["public", "orders"] },
        hasChildren: false,
        meta: {},
      };
      respond([SERVICE_SUPPORTED], (request) =>
        request.kind === "tree"
          ? {
              kind: "tree",
              nodes: request.path.segments.length === 0 ? [SCHEMA] : [TABLE],
              nextCursor: "",
            }
          : undefined,
      );

      await serviceTab();
      await flush();
      render({ service: "db1", widthForTest: 1200 });
      await flush();
      const settled = render({ service: "db1", widthForTest: 1200 });

      // Nothing in the UI names the lone schema, so the panel asks for its
      // page itself; the tree it hands down then reports it as collapsed and
      // carries the table underneath.
      expect(commandSpy).toHaveBeenCalledWith({
        environmentId: THREAD_REF.environmentId,
        input: { kind: "tree", path: SCHEMA.path },
      });
      const treeProps = findComponent<{ readonly tree: DataConsoleTree }>(
        settled,
        ZeropsDataTree,
      )!.props;
      expect(collapsedPrefix(treeProps.tree, "db1")).toEqual(["public"]);
      expect(
        treeProps.tree.entries[treePathKey(SCHEMA.path)]?.nodes.map((node) => node.name),
      ).toEqual(["orders"]);
      expect(TABLE.name).toBe("orders");
    });

    it("breadcrumbs skip a collapsed schema", async () => {
      const SCHEMA: ZeropsDataConsoleNode = {
        name: "public",
        kind: "container",
        path: { service: "db1", segments: ["public"] },
        hasChildren: true,
        meta: {},
      };
      respond([SERVICE_SUPPORTED], (request) =>
        request.kind === "tree"
          ? {
              kind: "tree",
              nodes: request.path.segments.length === 0 ? [SCHEMA] : [],
              nextCursor: "",
            }
          : undefined,
      );

      await serviceTab();
      await flush();
      const settled = render({ service: "db1", widthForTest: 1200 });

      expect(
        findComponent<{ readonly collapsedPrefix: ReadonlyArray<string> }>(
          settled,
          ZeropsDataBreadcrumbs,
        )!.props.collapsedPrefix,
      ).toEqual(["public"]);
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

    it("lets the content column shrink, so the grid region is the one thing that scrolls", async () => {
      const tree = await selectOrders(() => undefined);
      expect(findByAttribute(tree, "data-zerops-data-content")!.props.className).toContain(
        "min-h-0",
      );
    });

    it("passes the browsed node's name to the blob preview, for the image alt", async () => {
      const AVATAR: ZeropsDataConsoleNode = {
        name: "avatar.png",
        kind: "blob",
        path: { service: "db1", segments: ["avatar.png"] },
        hasChildren: false,
        meta: {},
      };
      respond([SERVICE_SUPPORTED], (request) =>
        request.kind === "blob"
          ? {
              kind: "blob",
              data: "aGk=",
              contentType: "text/plain",
              truncated: false,
              size: 2,
              vector: false,
              streamMetadata: false,
            }
          : undefined,
      );
      await serviceTab();
      findComponent<{ readonly onSelectNode: (node: ZeropsDataConsoleNode) => void }>(
        render({ service: "db1", widthForTest: 1200 }),
        ZeropsDataTree,
      )!.props.onSelectNode(AVATAR);
      await flush();

      expect(
        findComponent<{ readonly name?: string }>(
          render({ service: "db1", widthForTest: 1200 }),
          ZeropsDataBlob,
        )!.props.name,
      ).toBe("avatar.png");
    });

    /** Fails every request of one kind, answering everything else the way `respond` does. */
    function failKind(kind: ZeropsDataConsoleRequest["kind"], code: "internal" | "unsupported") {
      commandSpy.mockImplementation((args: { input: ZeropsDataConsoleRequest }) => {
        if (args.input.kind === "services" || args.input.kind === "refresh") {
          return Promise.resolve(AsyncResult.success(servicesResponse([SERVICE_SUPPORTED])));
        }
        if (args.input.kind === kind) {
          return Promise.resolve(
            AsyncResult.failure(Cause.fail(new ZeropsDataConsoleError({ code, message: "raw" }))),
          );
        }
        return Promise.resolve(AsyncResult.success(EMPTY_TREE_RESPONSE));
      });
    }

    async function selectOrdersFailing(code: "internal" | "unsupported") {
      respond([SERVICE_SUPPORTED]);
      await serviceTab();
      failKind("table", code);
      findComponent<{ readonly onSelectNode: (node: ZeropsDataConsoleNode) => void }>(
        render({ service: "db1", widthForTest: 1200 }),
        ZeropsDataTree,
      )!.props.onSelectNode(ORDERS);
      await flush();
      return render({ service: "db1", widthForTest: 1200 });
    }

    it("a failed table read fills the grid region, instead of leaving No rows standing", async () => {
      const tree = await selectOrdersFailing("internal");
      const notice = visitElements(
        tree,
        (element) => "data-zerops-data-grid-error" in element.props,
      )!;
      expect(notice.props.children).toEqual([
        expect.objectContaining({
          props: expect.objectContaining({ children: "Couldn't load rows" }),
        }),
        expect.objectContaining({
          props: expect.objectContaining({ children: "Something went wrong." }),
        }),
      ]);
      expect(findByAttribute(tree, "data-zerops-data-error")).toBeNull();
      expect(
        findComponent<{ readonly notice?: unknown }>(tree, ZeropsDataTable)!.props.notice,
      ).not.toBeUndefined();
    });

    it("a tabular node the console can't read says so quietly, with no rows claim", async () => {
      const tree = await selectOrdersFailing("unsupported");
      expect(
        visitElements(tree, (element) => "data-zerops-data-grid-unsupported" in element.props)!
          .props.children,
      ).toBe("This value can't be browsed yet.");
      expect(findByAttribute(tree, "data-zerops-data-error")).toBeNull();
    });

    it("offers a tree reload only while the root came back empty, and it refetches the root", async () => {
      respond([SERVICE_SUPPORTED]);
      await serviceTab();
      const empty = render({ service: "db1", widthForTest: 1200 });
      const reload = findByAttribute(empty, "data-zerops-data-tree-reload")!;
      commandSpy.mockClear();
      (reload.props.onClick as () => void)();
      await flush();
      expect(commandSpy).toHaveBeenCalledWith({
        environmentId: THREAD_REF.environmentId,
        input: { kind: "tree", path: { service: "db1", segments: [] } },
      });

      hooks.reset();
      commandSpy.mockReset();
      respond([SERVICE_SUPPORTED], (request) =>
        request.kind === "tree"
          ? { kind: "tree", nodes: [ORDERS, { ...ORDERS, name: "customers" }], nextCursor: "" }
          : undefined,
      );
      await serviceTab();
      const populated = render({ service: "db1", widthForTest: 1200 });
      expect(findByAttribute(populated, "data-zerops-data-tree-reload")).toBeNull();
    });

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

    it("drops a stale row count for a node the user has since left", async () => {
      const OTHER: ZeropsDataConsoleNode = {
        ...ORDERS,
        name: "customers",
        path: { service: "db1", segments: ["public", "customers"] },
      };
      let resolveCount: (() => void) | undefined;
      respond([SERVICE_SUPPORTED]);
      commandSpy.mockImplementation((args: { input: ZeropsDataConsoleRequest }) => {
        if (args.input.kind === "services") {
          return Promise.resolve(AsyncResult.success(servicesResponse([SERVICE_SUPPORTED])));
        }
        if (args.input.kind === "tableCount") {
          return new Promise((resolve) => {
            resolveCount = () =>
              resolve(
                AsyncResult.success({ kind: "count", count: 250 } as ZeropsDataConsoleResponse),
              );
          });
        }
        if (args.input.kind === "table") {
          return Promise.resolve(
            AsyncResult.success({ kind: "table", page: tablePage() } as ZeropsDataConsoleResponse),
          );
        }
        return Promise.resolve(AsyncResult.success(EMPTY_TREE_RESPONSE));
      });

      await serviceTab();
      let tree = render({ service: "db1", widthForTest: 1200 });
      findComponent<{ readonly onSelectNode: (node: ZeropsDataConsoleNode) => void }>(
        tree,
        ZeropsDataTree,
      )!.props.onSelectNode(ORDERS);
      await flush();
      tree = render({ service: "db1", widthForTest: 1200 });
      findComponent<{ readonly onRequestCount: () => void }>(
        tree,
        ZeropsDataTable,
      )!.props.onRequestCount();
      findComponent<{ readonly onSelectNode: (node: ZeropsDataConsoleNode) => void }>(
        tree,
        ZeropsDataTree,
      )!.props.onSelectNode(OTHER);
      await flush();
      resolveCount?.();
      await flush();
      expect(
        findComponent<{ readonly count?: number }>(
          render({ service: "db1", widthForTest: 1200 }),
          ZeropsDataTable,
        )!.props.count,
      ).toBeUndefined();
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
      expect(selection.kind).toBe("data");
      expect(selection.token).toBe("db1.public.orders");
      expect(selection.terminalId).toBe("data:db1 · public.orders · id=7");
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
      expect(selection.kind).toBe("data");
      expect(selection.token).toBe("db1.public.orders");
      expect(selection.terminalId).toBe("data:db1 · public.orders");
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

    it("the SQL toggle reveals the query box, which submits its statement", async () => {
      const tree = await selectOrders((request) =>
        request.kind === "table" ? { kind: "table", page: tablePage() } : undefined,
      );
      expect(findComponent(tree, ZeropsDataQuery)).toBeNull();

      (findByAttribute(tree, "data-zerops-data-query-toggle")!.props.onClick as () => void)();
      const opened = render({ service: "db1", widthForTest: 1200 });
      const query = findComponent<{ readonly onSubmit: (stmt: string) => void }>(
        opened,
        ZeropsDataQuery,
      )!;
      commandSpy.mockClear();
      query.props.onSubmit("select 1");
      expect(commandSpy).toHaveBeenCalledWith({
        environmentId: THREAD_REF.environmentId,
        input: { kind: "query", service: "db1", stmt: "select 1" },
      });
    });

    it("only offers the SQL toggle when the service can query", async () => {
      respond([SERVICE_VIEW_ONLY]);
      feedState.session = { status: "ready", allowWrites: false };
      render({ service: "kv1", widthForTest: 1200 });
      await flush();
      const tree = render({ service: "kv1", widthForTest: 1200 });
      expect(findByAttribute(tree, "data-zerops-data-query-toggle")).toBeNull();
      expect(findComponent(tree, ZeropsDataQuery)).toBeNull();
    });

    it("a query result takes over the one grid, and Back to table gives it back", async () => {
      const tree = await selectOrders((request) =>
        request.kind === "table"
          ? { kind: "table", page: tablePage({ rows: [["plain"]] }) }
          : { kind: "table", page: tablePage({ rows: [["queried"], ["queried-2"]] }) },
      );
      (findByAttribute(tree, "data-zerops-data-query-toggle")!.props.onClick as () => void)();
      findComponent<{ readonly onSubmit: (stmt: string) => void }>(
        render({ service: "db1", widthForTest: 1200 }),
        ZeropsDataQuery,
      )!.props.onSubmit("select 1");
      await flush();

      const withResult = render({ service: "db1", widthForTest: 1200 });
      const grids = allComponents(withResult, ZeropsDataTable);
      expect(grids).toHaveLength(1);
      expect(
        (grids[0]!.props as { readonly model: { readonly rows: ReadonlyArray<unknown> } }).model
          .rows,
      ).toEqual([["queried"], ["queried-2"]]);
      expect(findByAttribute(withResult, "data-zerops-data-query-result")).not.toBeNull();
      expect(
        visitElements(
          withResult,
          (element) => element.props.children === "Query result · 2 rows loaded",
        ),
      ).not.toBeNull();

      (findByAttribute(withResult, "data-zerops-data-query-back")!.props.onClick as () => void)();
      const back = render({ service: "db1", widthForTest: 1200 });
      expect(findByAttribute(back, "data-zerops-data-query-result")).toBeNull();
      expect(
        findComponent<{ readonly model: { readonly rows: ReadonlyArray<unknown> } }>(
          back,
          ZeropsDataTable,
        )!.props.model.rows,
      ).toEqual([["plain"]]);
    });

    it("offers Apply only while the filter draft differs from what is applied", async () => {
      const tree = await selectOrders((request) =>
        request.kind === "table"
          ? { kind: "table", page: tablePage({ columns: [column({ name: "status" })] }) }
          : { kind: "table", page: tablePage({ rows: [["filtered"]] }) },
      );
      const filters = findComponent<{
        readonly dirty: boolean;
        readonly onChangeFilters: (filters: ReadonlyArray<unknown>) => void;
      }>(tree, ZeropsDataFilters)!;
      expect(filters.props.dirty).toBe(false);

      filters.props.onChangeFilters([{ column: "status", op: "eq", value: "paid" }]);
      const dirty = findComponent<{ readonly dirty: boolean; readonly onApply: () => void }>(
        render({ service: "db1", widthForTest: 1200 }),
        ZeropsDataFilters,
      )!;
      expect(dirty.props.dirty).toBe(true);

      dirty.props.onApply();
      await flush();
      expect(
        findComponent<{ readonly dirty: boolean }>(
          render({ service: "db1", widthForTest: 1200 }),
          ZeropsDataFilters,
        )!.props.dirty,
      ).toBe(false);
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

  describe("family-shaped listing", () => {
    const SERVICE_OBJECT: ZeropsDataConsoleService = {
      hostname: "db1",
      type: "object-storage",
      family: "object",
      support: "supported",
      actions: [{ id: "readBlob", enabled: true, readOnly: true, reason: "" }],
      status: "running",
    };

    const SERVICE_KV: ZeropsDataConsoleService = {
      hostname: "db1",
      type: "valkey",
      family: "kv",
      support: "supported",
      actions: [{ id: "readBlob", enabled: true, readOnly: true, reason: "" }],
      status: "running",
    };

    const PREFIX_NODE: ZeropsDataConsoleNode = {
      name: "uploads",
      kind: "container",
      path: { service: "db1", segments: ["uploads"] },
      hasChildren: true,
      meta: {},
    };

    const BLOB_NODE: ZeropsDataConsoleNode = {
      name: "photo.png",
      kind: "blob",
      path: { service: "db1", segments: ["photo.png"] },
      hasChildren: false,
      meta: { size: 2048, contentType: "image/png" },
    };

    const NAMESPACE_NODE: ZeropsDataConsoleNode = {
      name: "cache",
      kind: "container",
      path: { service: "db1", segments: ["cache"] },
      hasChildren: true,
      meta: {},
    };

    function respondTree(
      services: readonly ZeropsDataConsoleService[],
      byPathKey: Record<string, ZeropsDataConsoleResponse>,
    ) {
      commandSpy.mockImplementation((args: { input: ZeropsDataConsoleRequest }) => {
        if (args.input.kind === "services" || args.input.kind === "refresh") {
          return Promise.resolve(AsyncResult.success(servicesResponse(services)));
        }
        if (args.input.kind === "tree") {
          const response = byPathKey[treePathKey(args.input.path)];
          return Promise.resolve(
            AsyncResult.success(response ?? (EMPTY_TREE_RESPONSE as ZeropsDataConsoleResponse)),
          );
        }
        return Promise.resolve(AsyncResult.success(EMPTY_TREE_RESPONSE));
      });
    }

    const ROOT_KEY = treePathKey({ service: "db1", segments: [] });

    it("an object-storage root lists its own blobs and prefixes together as a grid, name/size/modified/contentType", async () => {
      respondTree([SERVICE_OBJECT], {
        [ROOT_KEY]: { kind: "tree", nodes: [PREFIX_NODE, BLOB_NODE], nextCursor: "" },
      });
      await serviceTab();
      const tree = render({ service: "db1", widthForTest: 1200 });

      const table = findComponent<{
        readonly model: {
          readonly columns: ReadonlyArray<{ readonly name: string }>;
          readonly rows: ReadonlyArray<ReadonlyArray<unknown>>;
        };
      }>(tree, ZeropsDataTable)!;
      expect(table.props.model.columns.map((c) => c.name)).toEqual([
        "name",
        "size",
        "modified",
        "contentType",
      ]);
      // Sorted (numeric-aware, by name): "photo.png" before "uploads/".
      expect(table.props.model.rows).toEqual([
        ["photo.png", "2 KB", "", "image/png"],
        ["uploads/", "", "", ""],
      ]);
    });

    it("hides blobs from the object-storage tree — only prefixes show there", async () => {
      respondTree([SERVICE_OBJECT], {
        [ROOT_KEY]: { kind: "tree", nodes: [PREFIX_NODE, BLOB_NODE], nextCursor: "" },
      });
      const tree = await serviceTab();

      const treeComponent = findComponent<{
        readonly nodeFilter?: (node: ZeropsDataConsoleNode) => boolean;
      }>(tree, ZeropsDataTree)!;
      expect(treeComponent.props.nodeFilter).toBeDefined();
      expect(treeComponent.props.nodeFilter!(PREFIX_NODE)).toBe(true);
      expect(treeComponent.props.nodeFilter!(BLOB_NODE)).toBe(false);
    });

    it("clicking a prefix row in the object-storage grid descends — issues a tree request for its own path", async () => {
      respondTree([SERVICE_OBJECT], {
        [ROOT_KEY]: { kind: "tree", nodes: [PREFIX_NODE, BLOB_NODE], nextCursor: "" },
      });
      await serviceTab();
      // `serviceTab`'s own render captures the root tree request while it's
      // still in flight (the response lands during its trailing flush) — one
      // more render picks up the settled root listing this test clicks into.
      const tree = render({ service: "db1", widthForTest: 1200 });
      commandSpy.mockClear();

      const table = findComponent<{ readonly onOpenRow: (rowIndex: number) => void }>(
        tree,
        ZeropsDataTable,
      )!;
      // The tree model sorts a level's nodes by name (numeric-aware): "photo.png" < "uploads".
      table.props.onOpenRow(1); // PREFIX_NODE is row 1

      expect(commandSpy).toHaveBeenCalledWith({
        environmentId: THREAD_REF.environmentId,
        input: { kind: "tree", path: PREFIX_NODE.path },
      });
    });

    it("clicking a blob row in the object-storage grid opens its preview", async () => {
      respondTree([SERVICE_OBJECT], {
        [ROOT_KEY]: { kind: "tree", nodes: [PREFIX_NODE, BLOB_NODE], nextCursor: "" },
      });
      await serviceTab();
      const tree = render({ service: "db1", widthForTest: 1200 });
      commandSpy.mockClear();

      const table = findComponent<{ readonly onOpenRow: (rowIndex: number) => void }>(
        tree,
        ZeropsDataTable,
      )!;
      table.props.onOpenRow(0); // BLOB_NODE ("photo.png") sorts before PREFIX_NODE ("uploads")

      expect(commandSpy).toHaveBeenCalledWith({
        environmentId: THREAD_REF.environmentId,
        input: { kind: "blob", path: BLOB_NODE.path },
      });
    });

    it("a KV namespace root lists its own child keys as a grid, key/type/ttl/count", async () => {
      respondTree([SERVICE_KV], {
        [ROOT_KEY]: { kind: "tree", nodes: [NAMESPACE_NODE], nextCursor: "" },
      });
      await serviceTab();
      const tree = render({ service: "db1", widthForTest: 1200 });

      const table = findComponent<{
        readonly model: {
          readonly columns: ReadonlyArray<{ readonly name: string }>;
          readonly rows: ReadonlyArray<ReadonlyArray<unknown>>;
        };
      }>(tree, ZeropsDataTable)!;
      expect(table.props.model.columns.map((c) => c.name)).toEqual(["key", "type", "ttl", "count"]);
      expect(table.props.model.rows).toEqual([["cache", "", "", ""]]);
    });

    it("a document index root lists its own documents as a grid, id only", async () => {
      const SERVICE_DOCUMENT: ZeropsDataConsoleService = {
        hostname: "db1",
        type: "elasticsearch",
        family: "document",
        support: "supported",
        actions: [{ id: "readBlob", enabled: true, readOnly: true, reason: "" }],
        status: "running",
      };
      const DOCUMENT_NODE: ZeropsDataConsoleNode = {
        name: "order-42",
        kind: "blob",
        path: { service: "db1", segments: ["order-42"] },
        hasChildren: false,
        meta: {},
      };
      respondTree([SERVICE_DOCUMENT], {
        [ROOT_KEY]: { kind: "tree", nodes: [DOCUMENT_NODE], nextCursor: "" },
      });
      await serviceTab();
      const tree = render({ service: "db1", widthForTest: 1200 });

      const table = findComponent<{
        readonly model: {
          readonly columns: ReadonlyArray<{ readonly name: string }>;
          readonly rows: ReadonlyArray<ReadonlyArray<unknown>>;
        };
      }>(tree, ZeropsDataTable)!;
      expect(table.props.model.columns.map((c) => c.name)).toEqual(["id"]);
      expect(table.props.model.rows).toEqual([["order-42"]]);
    });

    it("leaves the tree unfiltered and the tabular/blob path untouched for a plain tabular service", async () => {
      respondTree([SERVICE_SUPPORTED], {
        [ROOT_KEY]: { kind: "tree", nodes: [], nextCursor: "" },
      });
      const tree = await serviceTab();

      expect(findComponent(tree, ZeropsDataTable)).toBeNull();
      const treeComponent = findComponent<{
        readonly nodeFilter?: (node: ZeropsDataConsoleNode) => boolean;
      }>(tree, ZeropsDataTree)!;
      expect(treeComponent.props.nodeFilter).toBeUndefined();
    });
  });
});
