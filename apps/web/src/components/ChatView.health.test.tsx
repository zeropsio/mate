// @vitest-environment happy-dom
import { RegistryContext } from "@effect/atom-react";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import {
  accountReadsAtom,
  engineThread,
  inventoryContents,
  makeMateFeeds,
  mateEngineHostAtom,
  mateFeedReadsAtom,
} from "@t3tools/client-runtime/data";
import {
  DEFAULT_SERVER_SETTINGS,
  ServerProvider,
  type ServerConfig,
  type MateHealth,
  type MateResourceHealth,
} from "@t3tools/contracts";
import { engineRun, personItem, seedHqNavigation } from "@t3tools/client-runtime/data/fixtures";
import { mountRoster } from "@t3tools/client-runtime/zerops/testing";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { act, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vite-plus/test";

import { serverEnvironment } from "../state/server";
import { zeropsSessionAtom } from "../state/zerops";
import { organization, project, scope } from "../zerops/__fixtures__/platformData";
import { AgentAdmissionComposition } from "../zerops/AgentAdmissionComposition";
import { environmentThreadDetails } from "../state/threads";
import { AccountDataContext, AccountStoreContext, type AccountData } from "../zerops/accountData";
import { accountOperations, AccountOperationsContext } from "../zerops/accountOperations";
import { InventoryContext } from "../zerops/inventoryContext";
import { ZeropsSessionContext } from "../zerops/sessionContext";
import { ZeropsDataContext, type ZeropsDataContextValue } from "../zerops/zeropsDataContext";
import type { ZeropsSessionValue } from "../zerops/ZeropsSessionProvider";
import ChatView from "./ChatView";
import Sidebar from "./Sidebar";
import { SidebarProvider } from "./ui/sidebar";
import { SidebarAccountMenuProvider } from "./zerops/SidebarZeropsAccount";
import { ZeropsProjectsContent } from "./zerops/ZeropsProjectsPage";
import { cardAccount, CARD_KEY, CARD_RECORDS, CARD_THREAD } from "./chat/engineCard.test-fixtures";

// Only the virtual list's layout is supplied: its real rows and their renderers still run.
vi.mock("@legendapp/list/react", async () => {
  const React = await import("react");
  type Row = { id: string } | string;
  type Props = {
    data: Row[];
    renderItem: (input: { item: Row; index: number }) => React.ReactNode;
    keyExtractor: (item: Row) => string;
    onLoad?: (event: { elapsedTimeInMs: number }) => void;
    ListHeaderComponent?: React.ReactNode;
    ListFooterComponent?: React.ReactNode;
    ref?: React.Ref<unknown>;
  };
  function LegendList({ ref: listRef, ...props }: Props) {
    const element = React.useRef<HTMLDivElement>(null);
    React.useImperativeHandle(listRef, () => ({
      getScrollableNode: () => element.current,
      getState: () => ({
        data: props.data,
        sizes: new Map(),
        isWithinMaintainScrollAtEndThreshold: true,
        indexByKey: (key: string) => props.data.findIndex((row) => props.keyExtractor(row) === key),
        listen: () => () => {},
        elementAtIndex: (index: number) => element.current?.children.item(index) ?? undefined,
      }),
      scrollToEnd: () => Promise.resolve(),
      scrollToIndex: () => Promise.resolve(),
    }));
    React.useLayoutEffect(() => {
      props.onLoad?.({ elapsedTimeInMs: 0 });
    }, []);
    return (
      <div ref={element}>
        {props.ListHeaderComponent}
        {props.data.map((item, index) => (
          <div key={props.keyExtractor(item)}>{props.renderItem({ item, index })}</div>
        ))}
        {props.ListFooterComponent}
      </div>
    );
  }
  return { LegendList };
});

vi.mock("@tanstack/react-router", async (original) => {
  const { createElement } = await import("react");
  return {
    ...(await original<typeof import("@tanstack/react-router")>()),
    Link: ({
      to,
      params = {},
      ...props
    }: React.ComponentProps<"a"> & {
      to: string;
      params?: Record<string, string>;
    }) =>
      createElement("a", {
        href: to.replace(/\$(\w+)/gu, (_, key: string) => params[key] ?? ""),
        ...props,
      }),
    useNavigate: () => () => {},
    useParams: ({ select }: { select?: (params: Record<string, string>) => unknown }) =>
      select === undefined ? {} : select({}),
    useLocation: ({ select }: { select?: (location: { pathname: string }) => unknown } = {}) =>
      select === undefined ? { pathname: "/" } : select({ pathname: "/" }),
    useMatch: () => undefined,
    useSearch: ({ select }: { select?: (search: Record<string, string>) => unknown } = {}) =>
      select === undefined ? {} : select({}),
    useRouteContext: () => ({ status: "authenticated" }),
    useRouter: () => ({ state: { matches: [], location: { pathname: "/" } } }),
    useRouterState: () => ({ location: { pathname: "/" }, matches: [] }),
  };
});

// The registry's transport is connected; presentation and the config feed remain the real ones.
vi.mock("../connection/catalog", async (original) => {
  const actual = await original<typeof import("../connection/catalog")>();
  const { PrimaryConnectionTarget, AVAILABLE_CONNECTION_STATE } =
    await import("@t3tools/client-runtime/connection");
  const { EnvironmentId } = await import("@t3tools/contracts");
  const { Atom, AsyncResult } = await import("effect/reactivity");
  const Option = await import("effect/Option");
  const environmentId = EnvironmentId.make("env-card");
  const catalogValueAtom = Atom.make({
    isReady: true,
    entries: new Map([
      [
        environmentId,
        {
          target: new PrimaryConnectionTarget({
            environmentId,
            label: "Card",
            httpBaseUrl: "https://example.test",
            wsBaseUrl: "wss://example.test",
          }),
          profile: Option.none(),
        },
      ],
    ]),
  });
  const state = Atom.make(
    AsyncResult.success({
      ...AVAILABLE_CONNECTION_STATE,
      phase: "connected" as const,
      desired: true,
    }),
  );
  return {
    environmentCatalog: { ...actual.environmentCatalog, catalogValueAtom, stateAtom: () => state },
  };
});

const decodeProvider = Schema.decodeUnknownSync(ServerProvider);

describe("Approved Mate health placement", () => {
  it("Decision: notices live in the composer dock only; no Restart Mate or health on faces or overview", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const external = vi.fn(() => Promise.reject(new Error("Unexpected external request")));
    vi.stubGlobal("fetch", external);
    const sockets = vi.fn(() => {
      throw new Error("Unexpected WebSocket");
    });
    vi.stubGlobal("WebSocket", sockets);
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
      media: "",
      onchange: null,
    }));

    try {
      for (const version of ["0.16.0"]) {
        const account = cardAccount(vi.fn());
        const host = account.registry.get(mateEngineHostAtom)!;
        account.registry.set(mateEngineHostAtom, {
          ...host,
          conversations: { ...host.conversations, hold: () => () => {}, holdRows: () => () => {} },
        });
        account.publish({
          ...CARD_RECORDS,
          runs: [
            engineRun(CARD_KEY.conversationId, 1, {
              summary: { items: 1, calls: {}, answerItemId: null, lastItemSeq: 1 },
            }),
          ],
          items: [personItem(`${CARD_KEY.conversationId}/r/1`, 1, "Look after this Mate")],
        });
        mountRoster(
          account.registry,
          organization.organizationId,
          [
            {
              id: "project-1",
              clientId: organization.organizationId,
              name: "Ada",
              status: "ACTIVE",
              publicZone: "example.test",
              zeropsSubdomainHost: "ada",
            },
          ],
          {
            into: account.store,
            services: [
              {
                id: "service-1",
                projectId: "project-1",
                name: "zcp",
                status: "ACTIVE",
                subdomainAccess: true,
                ports: [{ port: 8080, httpSupport: true }],
                serviceStackTypeInfo: { serviceStackTypeVersionName: "zcp@1" },
              },
            ],
          },
        );
        account.registry.set(accountReadsAtom, {
          viewer: {
            id: organization.organizationId,
            name: "Owner",
            membershipId: "member",
            roleCode: "ADMIN",
          },
          data: account.store.data,
          orgId: organization.organizationId,
          demandDetail: () => () => {},
          renewHeld: () => {},
        });
        account.registry.set(zeropsSessionAtom, {
          status: "signed-in",
          organizationStatus: "selected",
          activeOrganization: organization,
        });
        seedHqNavigation(account.store, organization.organizationId, {
          structure: {
            apps: [
              {
                id: "shop",
                name: "Shop",
                projects: [
                  {
                    projectId: "project-1",
                    name: "Shop - Ada",
                    kind: "mate",
                    mate: { face: "sky:seal" },
                  },
                ],
              },
            ],
            ungrouped: [],
          },
          mates: {
            "project-1": {
              presence: { online: true, since: "2026-10-07T00:00:00Z", overview: "live" },
              identity: {
                environmentId: CARD_THREAD.environmentId,
                serverVersion: version,
                update: null,
              },
            },
          },
        });
        const config: ServerConfig = {
          environment: {
            environmentId: CARD_THREAD.environmentId,
            label: "Card",
            platform: { os: "linux", arch: "x64" },
            serverVersion: version,
            capabilities: { repositoryIdentity: true, connectionProbe: true, agentLoginCode: true },
            zerops: { projectId: "project-1", identity: "ok" },
          },
          auth: {
            policy: "remote-reachable",
            bootstrapMethods: ["one-time-token"],
            sessionMethods: ["bearer-access-token"],
            sessionCookieName: "scenario_session",
          },
          cwd: "/workspace",
          keybindingsConfigPath: "/workspace/keybindings.json",
          keybindings: [],
          issues: [],
          availableEditors: [],
          providers: [
            decodeProvider({
              instanceId: "claudeAgent",
              driver: "claudeAgent",
              enabled: true,
              installed: true,
              version: "2.1.0",
              status: "ready",
              auth: { status: "authenticated" },
              checkedAt: "2026-10-07T00:00:00Z",
              requiresNewThreadForModelChange: true,
              setup: { canAuthenticate: true, canInstall: false },
              models: [
                {
                  slug: "claude-sonnet-4-5",
                  name: "Claude Sonnet",
                  isCustom: false,
                  isDefault: true,
                  capabilities: null,
                },
              ],
            }),
          ],
          observability: {
            logsDirectoryPath: "/tmp/logs",
            localTracingEnabled: false,
            otlpTracesEnabled: false,
            otlpMetricsEnabled: false,
            otlpLogsEnabled: false,
          },
          settings: DEFAULT_SERVER_SETTINGS,
        };
        const event = { type: "snapshot" as const, version: 1 as const, config };
        const feeds = makeMateFeeds({
          store: account.store,
          wire: {
            open: (key) =>
              key.family === "mateServerConfig"
                ? Stream.concat(
                    Stream.make(
                      { kind: "session" as const },
                      {
                        kind: "value" as const,
                        value: { config, latestEvent: event, source: "live" as const },
                      },
                    ),
                    Stream.never,
                  )
                : key.family === "mateAgentAuth"
                  ? Stream.concat(
                      Stream.make(
                        { kind: "session" as const },
                        {
                          kind: "value" as const,
                          value: {
                            available: true,
                            agents: [
                              {
                                agentId: "claude-code",
                                credPresent: true,
                                flagOAuth: true,
                                flagToken: false,
                                providerAuth: "authenticated",
                                state: "authorized",
                                authorizedBy: { subject: "owner" },
                              },
                            ],
                          },
                        },
                      ),
                      Stream.never,
                    )
                  : Stream.never,
          },
        });
        account.registry.set(mateFeedReadsAtom, { data: account.store.data, ...feeds });
        let stopConfig = () => {};
        await new Promise<void>((resolve) => {
          stopConfig = account.registry.subscribe(
            serverEnvironment.configValueAtom(CARD_THREAD.environmentId),
            (reading) => {
              if (reading !== null) resolve();
            },
            { immediate: true },
          );
        });
        const stopThread = account.registry.mount(environmentThreadDetails.detailAtom(CARD_THREAD));
        expect(
          account.registry.get(account.store.data.project(engineThread, CARD_KEY)).data._tag,
        ).toBe("Some");
        expect(
          account.registry.get(environmentThreadDetails.detailAtom(CARD_THREAD)),
        ).not.toBeNull();
        expect(
          account.registry.get(serverEnvironment.configValueAtom(CARD_THREAD.environmentId))
            ?.environment.serverVersion,
        ).toBe(version);

        const appScope = `hq:${organization.organizationId}:hq-app-detail:shop` as const;
        account.store.dispatch({
          kind: "stream",
          key: appScope,
          now: 0,
          event: { kind: "demand", demanded: true },
        });
        account.store.dispatch({
          kind: "stream",
          key: appScope,
          now: 0,
          event: { kind: "handshake" },
        });
        account.store.dispatch({ kind: "baseline-begin", scope: appScope, generation: 0 });
        account.store.dispatch({
          kind: "baseline-commit",
          scope: appScope,
          generation: 0,
          via: "hq-stream",
          members: [],
          rows: [],
        });
        const node = document.body.appendChild(document.createElement("div"));
        const root = createRoot(node);
        const router = createRouter({
          history: createMemoryHistory({ initialEntries: ["/"] }),
          routeTree: createRootRoute(),
        });
        await act(() => router.load());
        const operations = accountOperations(
          account.store,
          account.registry,
          {} as never,
          () => () => {},
          () => {},
          async () => false,
        );
        const reads = {
          data: account.store.data,
          orgId: organization.organizationId,
          demandDetail: () => () => {},
          revalidate: () => {},
        } as unknown as AccountData;
        const session = {
          status: "signed-in",
          client: { session: null, accountEpoch: 0 },
          organizations: [],
          lastRegistration: null,
          activeOrganization: {
            id: organization.organizationId,
            name: "Example",
            membershipId: "member",
            roleCode: "ADMIN",
            status: "ACTIVE",
          },
          organizationStatus: "selected",
          user: { id: "owner" },
        } as unknown as ZeropsSessionValue;
        const inventory = account.registry.get(
          account.store.data.project(inventoryContents, {
            organization,
            viewer: session.activeOrganization ?? undefined,
          }),
        );
        const platform = {
          scope: scope(),
          signals: { hidden: () => false, online: () => true, listen: () => () => {} },
          organizationRef: () => organization,
          projectRef: () => project(),
        } as unknown as ZeropsDataContextValue;
        try {
          await act(async () =>
            root.render(
              <RouterContextProvider router={router}>
                <Suspense fallback="suspended">
                  <RegistryContext value={account.registry}>
                    <ZeropsSessionContext value={session}>
                      <ZeropsDataContext value={platform}>
                        <AccountStoreContext value={account.store}>
                          <AccountDataContext value={reads}>
                            <AccountOperationsContext value={operations}>
                              <InventoryContext value={inventory}>
                                <AgentAdmissionComposition>
                                  <SidebarProvider defaultOpen>
                                    <SidebarAccountMenuProvider>
                                      <Sidebar />
                                    </SidebarAccountMenuProvider>
                                  </SidebarProvider>
                                  <ChatView {...CARD_THREAD} routeKind="server" />
                                  <div data-health-overview>
                                    <ZeropsProjectsContent search={{}} painted />
                                  </div>
                                </AgentAdmissionComposition>
                              </InventoryContext>
                            </AccountOperationsContext>
                          </AccountDataContext>
                        </AccountStoreContext>
                      </ZeropsDataContext>
                    </ZeropsSessionContext>
                  </RegistryContext>
                </Suspense>
              </RouterContextProvider>,
            ),
          );
          expect(node.querySelector("[data-chat-header]")).not.toBeNull();
          expect(node.querySelector("[data-conversation-footer]")).not.toBeNull();
          expect(node.querySelector("[data-timeline-thread]")?.textContent).toContain(
            "Look after this Mate",
          );
          const composer = node.querySelector('[role="textbox"]');
          expect(composer).not.toBeNull();
          expect(composer?.closest("[inert]")).toBeNull();
          const healthScope = `hq:${organization.organizationId}:mate-health:project-1` as const;
          for (const event of [
            { kind: "demand" as const, demanded: true },
            { kind: "attempt" as const },
            { kind: "handshake" as const },
            { kind: "baseline-committed" as const },
          ])
            account.store.dispatch({ kind: "stream", key: healthScope, now: 0, event });
          let revision = 0;
          const quiet: MateResourceHealth = {
            status: "ok",
            severity: "warning",
            resources: [],
            memory: null,
            pids: null,
            io: null,
            disk: { free: 1000, total: 5000 },
            unavailable: [],
          };
          const publish = async (evidence: MateResourceHealth, live = true) => {
            const health: MateHealth = {
              source: {
                environmentId: CARD_THREAD.environmentId,
                epoch: 1,
                incarnation: "run",
                revision: live ? ++revision : revision,
              },
              sampledAt: "2026-10-12T14:00:00Z",
              evidence,
            };
            await act(async () =>
              account.store.dispatch({
                kind: "rows",
                scope: healthScope,
                generation: 1,
                method: "push",
                via: "hq-stream",
                rows: [
                  {
                    family: "mateHealth",
                    id: "project-1",
                    value: health,
                    revision: { kind: "mate-attention", ...health.source, live },
                  },
                ],
              }),
            );
          };
          const states = [
            {
              resources: ["memory"],
              title: "Ada ran out of memory and the system stopped a process.",
              action: true,
              oomKilledAt: 1791817200000,
            },
            {
              resources: ["memory"],
              title: "Ada has been swapping to disk for 5 minutes — work is slow.",
              action: true,
            },
            { resources: ["disk"], title: "Ada's state disk is full.", action: true },
            {
              resources: ["io"],
              title: "Ada has been waiting on disk for 5 minutes.",
              action: false,
            },
            {
              resources: ["pids"],
              title: "Ada is near its process limit — likely leftover browsers.",
              action: false,
            },
          ] as const;
          const faceSelector = "[data-mate-face-state], [data-header-face]";
          expect(
            node.querySelector(
              "[data-chat-header] [data-mate-face-state], [data-chat-header] [data-header-face]",
            ),
          ).not.toBeNull();
          expect(
            node.querySelector('[data-zerops-surface="sidebar-mate"] [data-mate-face-state]'),
          ).not.toBeNull();
          for (const state of states) {
            await publish({
              ...quiet,
              status: "strained",
              resources: state.resources,
              ...("oomKilledAt" in state
                ? {
                    memory: {
                      current: 100,
                      high: null,
                      max: null,
                      events: { high: 0, oom: 1, oomKill: 1 },
                      growth: { high: 0, oom: 0, oomKill: 0 },
                      pressure: null,
                      swapCurrent: 0,
                      swapMax: null,
                      oomKilledAt: state.oomKilledAt,
                    },
                  }
                : {}),
            });
            const banner = node.querySelector("[data-composer-banner-anchor]");
            const notices = Array.from(banner?.querySelectorAll('[role="status"]') ?? []);
            expect(
              notices.filter((notice) => notice.textContent?.includes(state.title)),
            ).toHaveLength(1);
            expect(banner?.textContent?.includes("Open in Zerops")).toBe(state.action);
            expect(node.textContent).not.toContain("Restart Mate");
            const faceText = Array.from(
              node.querySelectorAll(faceSelector),
              (face) => face.textContent,
            ).join(" ");
            expect(faceText).not.toContain(state.title);
            await publish(quiet);
            expect(node.textContent).not.toContain(state.title);
          }
          await publish({ ...quiet, status: "strained", resources: ["pids"] });
          expect(node.textContent).toContain(states[4].title);
          const overview = node.querySelector("[data-health-overview]");
          expect(overview).not.toBeNull();
          expect(
            overview!.querySelector(
              '[data-zerops-surface="project-cards"] [aria-label="Open Ada"]',
            ),
          ).not.toBeNull();
          expect(overview!.textContent).not.toContain("Restart Mate");
          for (const state of states) expect(overview!.textContent).not.toContain(state.title);
          await publish({ ...quiet, status: "strained", resources: ["pids"] }, false);
          expect(node.textContent).not.toContain(states[4].title);
          expect(external).not.toHaveBeenCalled();
          expect(sockets).not.toHaveBeenCalled();
        } finally {
          await act(async () => root.unmount());
          node.remove();
          stopThread();
          stopConfig();
          feeds.close();
          account.close();
        }
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
