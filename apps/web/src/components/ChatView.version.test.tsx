// @vitest-environment happy-dom
import { RegistryContext } from "@effect/atom-react";
import {
  accountReadsAtom,
  engineThread,
  makeMateFeeds,
  mateEngineHostAtom,
  mateFeedReadsAtom,
  NOT_READ_INVENTORY,
} from "@t3tools/client-runtime/data";
import {
  DEFAULT_SERVER_SETTINGS,
  type ServerConfig,
  ServerProvider,
  ZeropsUserId,
} from "@t3tools/contracts";
import { seedHqNavigation } from "@t3tools/client-runtime/data/fixtures";
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
import { cardAccount, CARD_KEY, CARD_RECORDS, CARD_THREAD } from "./chat/engineCard.test-fixtures";

vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => () => {},
  useRouter: () => ({ state: { matches: [], location: { pathname: "/" } } }),
  useRouterState: () => ({ location: { pathname: "/" }, matches: [] }),
}));

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

describe("C: opening a Mate and chat", () => {
  it("older and newer Mate versions show no version-skew warning or restart action", async () => {
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
      for (const version of ["0.16.0", "999.0.0"]) {
        const account = cardAccount(vi.fn());
        const host = account.registry.get(mateEngineHostAtom)!;
        account.registry.set(mateEngineHostAtom, {
          ...host,
          conversations: { ...host.conversations, hold: () => () => {}, holdRows: () => () => {} },
        });
        account.publish(CARD_RECORDS);
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
          viewer: { id: "owner", name: "Owner", membershipId: "member", roleCode: "ADMIN" },
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
            apps: [],
            ungrouped: [{ projectId: "project-1", name: "Ada", mate: { face: "sky:seal" } }],
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
                                authorizedBy: { subject: ZeropsUserId.make("owner") },
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

        const node = document.body.appendChild(document.createElement("div"));
        const root = createRoot(node);
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
          activeOrganization: {
            id: organization.organizationId,
            roleCode: "ADMIN",
            status: "ACTIVE",
          },
          organizationStatus: "selected",
          user: { id: "owner" },
        } as unknown as ZeropsSessionValue;
        const platform = {
          scope: scope(),
          signals: { hidden: () => false, online: () => true, listen: () => () => {} },
          organizationRef: () => organization,
          projectRef: () => project(),
        } as unknown as ZeropsDataContextValue;
        try {
          await act(async () =>
            root.render(
              <Suspense fallback="suspended">
                <RegistryContext value={account.registry}>
                  <ZeropsSessionContext value={session}>
                    <ZeropsDataContext value={platform}>
                      <AccountStoreContext value={account.store}>
                        <AccountDataContext value={reads}>
                          <AccountOperationsContext value={operations}>
                            <InventoryContext value={NOT_READ_INVENTORY}>
                              <AgentAdmissionComposition>
                                <ChatView {...CARD_THREAD} routeKind="server" />
                              </AgentAdmissionComposition>
                            </InventoryContext>
                          </AccountOperationsContext>
                        </AccountDataContext>
                      </AccountStoreContext>
                    </ZeropsDataContext>
                  </ZeropsSessionContext>
                </RegistryContext>
              </Suspense>,
            ),
          );
          expect(node.querySelector("[data-chat-header]")).not.toBeNull();
          expect(node.querySelector("[data-conversation-footer]")).not.toBeNull();
          const composer = node.querySelector('[role="textbox"]');
          expect(composer).not.toBeNull();
          expect(composer?.closest("[inert]")).toBeNull();
          expect(document.body.textContent).not.toContain("Server versions differ");
          const actions = Array.from(
            document.querySelectorAll("button"),
            (button) => button.getAttribute("aria-label") ?? button.textContent?.trim(),
          );
          expect(actions).not.toContain("Restart Mate");
          expect(actions).not.toContain("Restart server");
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
