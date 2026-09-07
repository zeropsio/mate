import { EnvironmentId, ThreadId, ZeropsDataConsoleError } from "@t3tools/contracts";
import type {
  ScopedThreadRef,
  ZeropsDataConsoleColumn,
  ZeropsDataConsoleNode,
  ZeropsDataConsoleRequest,
  ZeropsDataConsoleResponse,
  ZeropsDataConsoleService,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

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
import { ZeropsDataQuery } from "./ZeropsDataQuery";
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

function render(threadRef: ScopedThreadRef | null = THREAD_REF) {
  hooks.beginRender();
  return ZeropsDataPanel({ threadRef });
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

function servicesResponse(
  services: readonly ZeropsDataConsoleService[] = [],
): ZeropsDataConsoleResponse {
  return { kind: "services", project: { id: "p1", name: "acme" }, services, allowWrites: false };
}

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

const EMPTY_TREE_RESPONSE: ZeropsDataConsoleResponse = { kind: "tree", nodes: [], nextCursor: "" };

describe("ZeropsDataPanel", () => {
  beforeEach(() => {
    hooks.reset();
    commandSpy.mockReset();
    feedState.session = undefined;
  });

  it("renders nothing for a null thread", () => {
    expect(render(null)).toBeNull();
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

  it("fetches services once ready and renders the browse UI", async () => {
    feedState.session = { status: "ready", allowWrites: false };
    commandSpy.mockImplementation(() =>
      Promise.resolve(AsyncResult.success(servicesResponse([SERVICE_SUPPORTED]))),
    );

    render();
    await flush();
    const tree = render();

    expect(findByAttribute(tree, "data-zerops-data-browse")).not.toBeNull();
    const row = findByAttribute(tree, "data-zerops-data-service")!;
    expect(row.props["data-zerops-data-service"]).toBe("db1");
    expect(commandSpy).toHaveBeenCalledWith({
      environmentId: THREAD_REF.environmentId,
      input: { kind: "services" },
    });
  });

  it("does not re-issue the services request on a later render", async () => {
    feedState.session = { status: "ready", allowWrites: false };
    commandSpy.mockImplementation(() => Promise.resolve(AsyncResult.success(servicesResponse())));

    render();
    await flush();
    render();
    await flush();
    render();

    const serviceCalls = commandSpy.mock.calls.filter(
      ([args]) => (args.input as ZeropsDataConsoleRequest).kind === "services",
    );
    expect(serviceCalls).toHaveLength(1);
  });

  it("marks a non-supported service view-only and shows its VPN gate hint", async () => {
    feedState.session = { status: "ready", allowWrites: false };
    commandSpy.mockImplementation(() =>
      Promise.resolve(AsyncResult.success(servicesResponse([SERVICE_VIEW_ONLY]))),
    );

    render();
    await flush();
    const tree = render();

    const badge = findByAttribute(tree, "data-zerops-data-service-view-only");
    expect(badge?.props.label).toBe("View only");
    const hint = findByAttribute(tree, "data-zerops-data-service-vpn-hint");
    expect(hint?.props.children).toBe("Connect over VPN to browse this service.");
  });

  it("a supported service gets no view-only badge", async () => {
    feedState.session = { status: "ready", allowWrites: false };
    commandSpy.mockImplementation(() =>
      Promise.resolve(AsyncResult.success(servicesResponse([SERVICE_SUPPORTED]))),
    );

    render();
    await flush();
    const tree = render();

    expect(findByAttribute(tree, "data-zerops-data-service-view-only")).toBeNull();
  });

  it("a service with no browse affordance is listed but not selectable", async () => {
    feedState.session = { status: "ready", allowWrites: false };
    commandSpy.mockImplementation(() =>
      Promise.resolve(AsyncResult.success(servicesResponse([SERVICE_NOT_BROWSABLE]))),
    );

    render();
    await flush();
    const tree = render();

    const row = findByAttribute(tree, "data-zerops-data-service")!;
    expect(row.props.disabled).toBe(true);
    commandSpy.mockClear();
    (row.props.onClick as () => void)();
    expect(commandSpy).not.toHaveBeenCalled();
    const hint = findByAttribute(tree, "data-zerops-data-service-vpn-hint");
    expect(hint?.props.children).toBe("Connect over VPN to browse this service.");
  });

  async function readyWithServices(services: readonly ZeropsDataConsoleService[]) {
    feedState.session = { status: "ready", allowWrites: false };
    commandSpy.mockImplementation((args: { input: ZeropsDataConsoleRequest }) => {
      if (args.input.kind === "services") {
        return Promise.resolve(AsyncResult.success(servicesResponse(services)));
      }
      return Promise.resolve(AsyncResult.success(EMPTY_TREE_RESPONSE));
    });
    render();
    await flush();
    return render();
  }

  it("selecting a service issues a tree request for its root", async () => {
    const tree = await readyWithServices([SERVICE_SUPPORTED]);
    const row = findByAttribute(tree, "data-zerops-data-service")!;
    commandSpy.mockClear();
    (row.props.onClick as () => void)();

    expect(commandSpy).toHaveBeenCalledWith({
      environmentId: THREAD_REF.environmentId,
      input: { kind: "tree", path: { service: "db1", segments: [] } },
    });
  });

  it("expanding an unloaded container issues a tree request for its own path", async () => {
    const CONTAINER: ZeropsDataConsoleNode = {
      name: "public",
      kind: "container",
      path: { service: "db1", segments: ["public"] },
      hasChildren: true,
      meta: {},
    };
    let tree = await readyWithServices([SERVICE_SUPPORTED]);
    (findByAttribute(tree, "data-zerops-data-service")!.props.onClick as () => void)();
    await flush();
    tree = render();

    const treeComponent = findComponent<{
      readonly onToggleNode: (node: ZeropsDataConsoleNode) => void;
    }>(tree, ZeropsDataTree)!;
    commandSpy.mockClear();
    treeComponent.props.onToggleNode(CONTAINER);

    expect(commandSpy).toHaveBeenCalledWith({
      environmentId: THREAD_REF.environmentId,
      input: { kind: "tree", path: CONTAINER.path },
    });
  });

  it("Load more on a table appends via a cursor-carrying request", async () => {
    const NODE: ZeropsDataConsoleNode = {
      name: "orders",
      kind: "tabular",
      path: { service: "db1", segments: ["orders"] },
      hasChildren: false,
      meta: {},
    };
    let tableCalls = 0;
    feedState.session = { status: "ready", allowWrites: false };
    commandSpy.mockImplementation((args: { input: ZeropsDataConsoleRequest }) => {
      if (args.input.kind === "services") {
        return Promise.resolve(AsyncResult.success(servicesResponse([SERVICE_SUPPORTED])));
      }
      if (args.input.kind === "table") {
        tableCalls += 1;
        const page =
          tableCalls === 1
            ? {
                columns: [],
                rows: [[1]],
                nextCursor: "cursor-1",
                rowKeyCols: [],
                bestEffort: false,
                numbered: false,
              }
            : {
                columns: [],
                rows: [[2]],
                nextCursor: "",
                rowKeyCols: [],
                bestEffort: false,
                numbered: false,
              };
        return Promise.resolve(
          AsyncResult.success({ kind: "table", page } as ZeropsDataConsoleResponse),
        );
      }
      return Promise.resolve(AsyncResult.success(EMPTY_TREE_RESPONSE));
    });

    render();
    await flush();
    let tree = render();
    (findByAttribute(tree, "data-zerops-data-service")!.props.onClick as () => void)();
    await flush();
    tree = render();

    let tableComponent = findComponent<{
      readonly onLoadMore: () => void;
      readonly model: { readonly rows: ReadonlyArray<ReadonlyArray<unknown>> };
    }>(tree, ZeropsDataTable);
    expect(tableComponent).toBeNull();

    const treeComponent = findComponent<{
      readonly onSelectNode: (node: ZeropsDataConsoleNode) => void;
    }>(tree, ZeropsDataTree)!;
    treeComponent.props.onSelectNode(NODE);
    await flush();
    tree = render();

    tableComponent = findComponent(tree, ZeropsDataTable);
    expect(tableComponent?.props.model.rows).toEqual([[1]]);

    commandSpy.mockClear();
    tableComponent!.props.onLoadMore();
    await flush();
    tree = render();

    expect(commandSpy).toHaveBeenCalledWith({
      environmentId: THREAD_REF.environmentId,
      input: { kind: "table", path: NODE.path, page: { cursor: "cursor-1" } },
    });
    tableComponent = findComponent(tree, ZeropsDataTable);
    expect(tableComponent?.props.model.rows).toEqual([[1], [2]]);
  });

  it("row count is fetched only on the explicit count action", async () => {
    const NODE: ZeropsDataConsoleNode = {
      name: "orders",
      kind: "tabular",
      path: { service: "db1", segments: ["orders"] },
      hasChildren: false,
      meta: {},
    };
    feedState.session = { status: "ready", allowWrites: false };
    commandSpy.mockImplementation((args: { input: ZeropsDataConsoleRequest }) => {
      if (args.input.kind === "services") {
        return Promise.resolve(AsyncResult.success(servicesResponse([SERVICE_SUPPORTED])));
      }
      if (args.input.kind === "table") {
        return Promise.resolve(
          AsyncResult.success({
            kind: "table",
            page: {
              columns: [],
              rows: [],
              nextCursor: "",
              rowKeyCols: [],
              bestEffort: false,
              numbered: false,
            },
          } as ZeropsDataConsoleResponse),
        );
      }
      if (args.input.kind === "tableCount") {
        return Promise.resolve(
          AsyncResult.success({ kind: "count", count: 42 } as ZeropsDataConsoleResponse),
        );
      }
      return Promise.resolve(AsyncResult.success(EMPTY_TREE_RESPONSE));
    });

    render();
    await flush();
    let tree = render();
    (findByAttribute(tree, "data-zerops-data-service")!.props.onClick as () => void)();
    await flush();
    tree = render();
    const treeComponent = findComponent<{
      readonly onSelectNode: (node: ZeropsDataConsoleNode) => void;
    }>(tree, ZeropsDataTree)!;
    treeComponent.props.onSelectNode(NODE);
    await flush();
    tree = render();

    expect(
      commandSpy.mock.calls.some(
        ([args]) => (args.input as ZeropsDataConsoleRequest).kind === "tableCount",
      ),
    ).toBe(false);

    let tableComponent = findComponent<{
      readonly onRequestCount: () => void;
      readonly count: number | undefined;
    }>(tree, ZeropsDataTable)!;
    tableComponent.props.onRequestCount();
    await flush();
    tree = render();

    tableComponent = findComponent(tree, ZeropsDataTable)!;
    expect(tableComponent.props.count).toBe(42);
  });

  it("only renders the query box when the selected service can query", async () => {
    const tree = await readyWithServices([SERVICE_VIEW_ONLY]);
    (findByAttribute(tree, "data-zerops-data-service")!.props.onClick as () => void)();
    await flush();
    const rerendered = render();

    expect(findComponent(rerendered, ZeropsDataQuery)).toBeNull();
  });

  it("renders the query box for a service that can query", async () => {
    let tree = await readyWithServices([SERVICE_SUPPORTED]);
    (findByAttribute(tree, "data-zerops-data-service")!.props.onClick as () => void)();
    await flush();
    tree = render();

    expect(findComponent(tree, ZeropsDataQuery)).not.toBeNull();
  });

  it("submits a query request for the selected service", async () => {
    feedState.session = { status: "ready", allowWrites: false };
    commandSpy.mockImplementation((args: { input: ZeropsDataConsoleRequest }) => {
      if (args.input.kind === "services") {
        return Promise.resolve(AsyncResult.success(servicesResponse([SERVICE_SUPPORTED])));
      }
      return Promise.resolve(
        AsyncResult.success({
          kind: "table",
          page: {
            columns: [],
            rows: [],
            nextCursor: "",
            rowKeyCols: [],
            bestEffort: false,
            numbered: false,
          },
        } as ZeropsDataConsoleResponse),
      );
    });

    render();
    await flush();
    let tree = render();
    (findByAttribute(tree, "data-zerops-data-service")!.props.onClick as () => void)();
    await flush();
    tree = render();

    const queryComponent = findComponent<{ readonly onSubmit: (stmt: string) => void }>(
      tree,
      ZeropsDataQuery,
    )!;
    commandSpy.mockClear();
    queryComponent.props.onSubmit("select 1");

    expect(commandSpy).toHaveBeenCalledWith({
      environmentId: THREAD_REF.environmentId,
      input: { kind: "query", service: "db1", stmt: "select 1" },
    });
  });

  it("does not duplicate an in-flight table Load more request, and disables the button meanwhile", async () => {
    const NODE: ZeropsDataConsoleNode = {
      name: "orders",
      kind: "tabular",
      path: { service: "db1", segments: ["orders"] },
      hasChildren: false,
      meta: {},
    };
    let loadMoreCalls = 0;
    let resolveLoadMore: (() => void) | undefined;
    feedState.session = { status: "ready", allowWrites: false };
    commandSpy.mockImplementation((args: { input: ZeropsDataConsoleRequest }) => {
      if (args.input.kind === "services") {
        return Promise.resolve(AsyncResult.success(servicesResponse([SERVICE_SUPPORTED])));
      }
      if (args.input.kind === "table") {
        const page = args.input.page;
        if (page?.cursor === undefined) {
          return Promise.resolve(
            AsyncResult.success({
              kind: "table",
              page: {
                columns: [],
                rows: [[1]],
                nextCursor: "cursor-1",
                rowKeyCols: [],
                bestEffort: false,
                numbered: false,
              },
            } as ZeropsDataConsoleResponse),
          );
        }
        loadMoreCalls += 1;
        return new Promise((resolve) => {
          resolveLoadMore = () =>
            resolve(
              AsyncResult.success({
                kind: "table",
                page: {
                  columns: [],
                  rows: [[2]],
                  nextCursor: "",
                  rowKeyCols: [],
                  bestEffort: false,
                  numbered: false,
                },
              } as ZeropsDataConsoleResponse),
            );
        });
      }
      return Promise.resolve(AsyncResult.success(EMPTY_TREE_RESPONSE));
    });

    render();
    await flush();
    let tree = render();
    (findByAttribute(tree, "data-zerops-data-service")!.props.onClick as () => void)();
    await flush();
    tree = render();
    const treeComponent = findComponent<{
      readonly onSelectNode: (node: ZeropsDataConsoleNode) => void;
    }>(tree, ZeropsDataTree)!;
    treeComponent.props.onSelectNode(NODE);
    await flush();
    tree = render();

    let tableComponent = findComponent<{
      readonly onLoadMore: () => void;
      readonly loadMorePending: boolean;
    }>(tree, ZeropsDataTable)!;
    tableComponent.props.onLoadMore();
    await flush();
    tree = render();
    tableComponent = findComponent(tree, ZeropsDataTable)!;
    expect(tableComponent.props.loadMorePending).toBe(true);

    tableComponent.props.onLoadMore(); // second click while the first is still in flight
    await flush();
    expect(loadMoreCalls).toBe(1);

    resolveLoadMore?.();
    await flush();
    tree = render();
    tableComponent = findComponent(tree, ZeropsDataTable)!;
    expect(tableComponent.props.loadMorePending).toBe(false);
  });

  it("drops a stale table response for a selection the user has since moved on from", async () => {
    const NODE_A: ZeropsDataConsoleNode = {
      name: "orders",
      kind: "tabular",
      path: { service: "db1", segments: ["orders"] },
      hasChildren: false,
      meta: {},
    };
    const NODE_B: ZeropsDataConsoleNode = {
      name: "customers",
      kind: "tabular",
      path: { service: "db1", segments: ["customers"] },
      hasChildren: false,
      meta: {},
    };
    let resolveA: (() => void) | undefined;
    feedState.session = { status: "ready", allowWrites: false };
    commandSpy.mockImplementation((args: { input: ZeropsDataConsoleRequest }) => {
      if (args.input.kind === "services") {
        return Promise.resolve(AsyncResult.success(servicesResponse([SERVICE_SUPPORTED])));
      }
      if (args.input.kind === "table" && args.input.path.segments[0] === "orders") {
        return new Promise((resolve) => {
          resolveA = () =>
            resolve(
              AsyncResult.success({
                kind: "table",
                page: {
                  columns: [],
                  rows: [["stale"]],
                  nextCursor: "",
                  rowKeyCols: [],
                  bestEffort: false,
                  numbered: false,
                },
              } as ZeropsDataConsoleResponse),
            );
        });
      }
      if (args.input.kind === "table") {
        return Promise.resolve(
          AsyncResult.success({
            kind: "table",
            page: {
              columns: [],
              rows: [["fresh"]],
              nextCursor: "",
              rowKeyCols: [],
              bestEffort: false,
              numbered: false,
            },
          } as ZeropsDataConsoleResponse),
        );
      }
      return Promise.resolve(AsyncResult.success(EMPTY_TREE_RESPONSE));
    });

    render();
    await flush();
    let tree = render();
    (findByAttribute(tree, "data-zerops-data-service")!.props.onClick as () => void)();
    await flush();
    tree = render();
    const treeComponent = findComponent<{
      readonly onSelectNode: (node: ZeropsDataConsoleNode) => void;
    }>(tree, ZeropsDataTree)!;

    treeComponent.props.onSelectNode(NODE_A); // slow, still pending
    treeComponent.props.onSelectNode(NODE_B); // moves on before A resolves
    await flush();
    tree = render();
    let tableComponent = findComponent<{
      readonly model: { readonly rows: ReadonlyArray<ReadonlyArray<unknown>> };
    }>(tree, ZeropsDataTable)!;
    expect(tableComponent.props.model.rows).toEqual([["fresh"]]);

    resolveA?.(); // A's stale response arrives after B already rendered
    await flush();
    tree = render();
    tableComponent = findComponent(tree, ZeropsDataTable)!;
    expect(tableComponent.props.model.rows).toEqual([["fresh"]]);
  });

  it("merges the current sort into a table Load more page request", async () => {
    const NODE: ZeropsDataConsoleNode = {
      name: "orders",
      kind: "tabular",
      path: { service: "db1", segments: ["orders"] },
      hasChildren: false,
      meta: {},
    };
    feedState.session = { status: "ready", allowWrites: false };
    commandSpy.mockImplementation((args: { input: ZeropsDataConsoleRequest }) => {
      if (args.input.kind === "services") {
        return Promise.resolve(AsyncResult.success(servicesResponse([SERVICE_SUPPORTED])));
      }
      return Promise.resolve(
        AsyncResult.success({
          kind: "table",
          page: {
            columns: [
              {
                name: "id",
                dataType: "integer",
                pk: true,
                editable: false,
                reason: "",
                sortable: true,
                sortReason: "",
              },
            ],
            rows: [],
            nextCursor: "cursor-1",
            rowKeyCols: [],
            bestEffort: false,
            numbered: false,
          },
        } as ZeropsDataConsoleResponse),
      );
    });

    render();
    await flush();
    let tree = render();
    (findByAttribute(tree, "data-zerops-data-service")!.props.onClick as () => void)();
    await flush();
    tree = render();
    const treeComponent = findComponent<{
      readonly onSelectNode: (node: ZeropsDataConsoleNode) => void;
    }>(tree, ZeropsDataTree)!;
    treeComponent.props.onSelectNode(NODE);
    await flush();
    tree = render();

    let tableComponent = findComponent<{
      readonly onSort: (column: ZeropsDataConsoleColumn, direction: "asc" | "desc") => void;
    }>(tree, ZeropsDataTable)!;
    const SORTABLE_ID_COLUMN: ZeropsDataConsoleColumn = {
      name: "id",
      dataType: "integer",
      pk: true,
      editable: false,
      reason: "",
      sortable: true,
      sortReason: "",
    };
    tableComponent.props.onSort(SORTABLE_ID_COLUMN, "asc");
    await flush();
    tree = render();

    tableComponent = findComponent(tree, ZeropsDataTable)!;
    commandSpy.mockClear();
    (tableComponent.props as unknown as { readonly onLoadMore: () => void }).onLoadMore();

    expect(commandSpy).toHaveBeenCalledWith({
      environmentId: THREAD_REF.environmentId,
      input: {
        kind: "table",
        path: NODE.path,
        page: { cursor: "cursor-1", sort: "id", direction: "asc" },
      },
    });
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

    render();
    await flush();
    const tree = render();

    const error = findByAttribute(tree, "data-zerops-data-error");
    expect(error?.props.children).toBe("Couldn't reach the service. Check that it's running.");
  });

  it("shows a generic fallback line for a non-ZeropsDataConsoleError rejection", async () => {
    feedState.session = { status: "ready", allowWrites: false };
    commandSpy.mockImplementation(() =>
      Promise.resolve(AsyncResult.failure(Cause.fail(new Error("boom")))),
    );

    render();
    await flush();
    const tree = render();

    const error = findByAttribute(tree, "data-zerops-data-error");
    expect(error?.props.children).toBe("Something went wrong.");
  });
});
