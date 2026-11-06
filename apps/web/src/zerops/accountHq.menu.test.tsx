import { makeAccountHarness } from "@t3tools/client-runtime/zerops/testing";
import { ZEROPS_SESSION_STORAGE_KEY, type ZeropsUser } from "@t3tools/client-runtime/zerops";
import type { ReactTestInstance, ReactTestRenderer } from "react-test-renderer";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { mountTab, settle, unmountTabs } from "./__fixtures__/harnessTabs";

const rendered = vi.hoisted(() => ({ tree: null as ReactTestRenderer | null }));
vi.mock("react-dom/client", async () => {
  const { create } = await import("react-test-renderer");
  return {
    createRoot: () => ({
      render: (element: Parameters<typeof create>[0]) => {
        rendered.tree = create(element);
      },
      unmount: () => {
        rendered.tree?.unmount();
        rendered.tree = null;
      },
    }),
  };
});

function text(node: ReactTestInstance): string {
  return node.children.map((child) => (typeof child === "string" ? child : text(child))).join("");
}
function menuText(): string {
  return text(
    rendered.tree!.root.find(
      (node) =>
        typeof node.type === "string" &&
        node.props["data-zerops-surface"] === "sidebar-environments",
    ),
  );
}

const person: ZeropsUser = {
  id: "owner",
  email: "owner@example.test",
  clientUserList: [
    {
      id: "membership",
      clientId: "ORG",
      roleCode: "OWNER",
      status: "ACTIVE",
      canCreateProjects: true,
    },
  ],
};

vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  Link: "a",
  useNavigate: () => () => undefined,
  useRouter: () => ({ state: { location: { pathname: "/" } } }),
  useLocation: ({ select }: { select: (value: { pathname: string }) => unknown }) =>
    select({ pathname: "/" }),
  useParams: ({ select }: { select?: (value: object) => unknown }) => select?.({}) ?? {},
  useMatch: () => undefined,
}));

vi.mock("../components/zerops/landing/ZeropsLandingShell", () => ({
  ZeropsFrameWait: () => null,
}));

afterEach(async () => {
  vi.useRealTimers();
  await unmountTabs();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function mountMenu(
  holdMembers: boolean,
  fakeClock = false,
  deviceLogin = false,
  fullSidebar = false,
) {
  vi.stubEnv("VITE_HQ_ORIGIN", "https://hq.example.test");
  vi.stubEnv("VITE_ZEROPS_API_URL", "https://zerops.example.test");
  if (deviceLogin) vi.stubEnv("VITE_ZEROPS_SIGN_IN", "device-login");
  const noDom = Object.fromEntries(
    ["Node", "Element", "HTMLElement", "ShadowRoot"].map((key) => [key, function none() {}]),
  );
  for (const [key, type] of Object.entries(noDom)) vi.stubGlobal(key, type);
  const base = makeAccountHarness({
    people: [{ user: person, password: "secret" }],
    projects: [
      {
        id: "Ada",
        clientId: "ORG",
        name: "Ada",
        status: "ACTIVE",
        tagList: ["mate"],
        publicZone: "example.test",
        zeropsSubdomainHost: "ada",
      },
    ],
  });
  const heldMembers = holdMembers ? base.rest.hold("GET /client/ORG/user/list") : undefined;
  const approvedSession = deviceLogin ? base.rest.issueSession("owner") : undefined;
  let name = "Shop";
  let doors = 0;
  let socket: Socket | undefined;
  let revision = 0;
  let currentSession: string | undefined;
  const ticketSessions: string[] = [];
  const ticketWaiters: Array<() => void> = [];
  const unexpected: string[] = [];
  let whenReady: (name: string) => Promise<void> = async () => {};
  let whenRecovering: () => Promise<number> = async () => {
    throw new Error("account not mounted");
  };
  let whenRefused: () => Promise<void> = async () => {
    throw new Error("account not mounted");
  };
  let hqPhase: () => string = () => "unmounted";
  let handover: typeof import("./handover");
  const frames = () => [
    {
      key: "app:shop",
      value: {
        id: "shop",
        name,
        can: {},
        contents: { empty: false, deletingProjectIds: [] },
        projectIds: ["Ada"],
        births: [],
        environments: [],
        changes: [],
        releaseOffer: null,
      },
    },
    {
      key: "project:Ada",
      value: {
        projectId: "Ada",
        appId: "shop",
        name: "Ada",
        kind: "mate",
        mate: { face: "", madeBy: null, standupRequestedBy: null },
        person: { mine: false, ownerUserId: null, waitsOnViewer: false, unseen: null },
        signedInNow: {},
        everSignedIn: {},
      },
    },
  ];
  class Socket {
    static readonly OPEN = 1;
    readonly readyState = 1;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onopen: (() => void) | null = null;
    private readonly listeners = new Map<
      string,
      Array<(event: { data: string; code: number }) => void>
    >();
    private readonly hq: boolean;
    constructor(url: string) {
      const target = new URL(url);
      this.hq =
        target.origin === "wss://hq.example.test" && target.pathname === "/api/structure/ws";
      if (
        !this.hq &&
        !(
          target.origin === "wss://zerops.example.test" &&
          target.pathname.startsWith("/api/rest/public/web-socket/")
        )
      )
        unexpected.push(
          `socket ${target.origin}${target.pathname.split("/").slice(0, 5).join("/")}`,
        );
      if (this.hq) socket = this;
      queueMicrotask(() => {
        if (this.hq) this.emit("open", "");
        else this.onmessage?.({ data: JSON.stringify({ type: "SocketSuccess" }) });
      });
    }
    addEventListener(type: string, listener: (event: { data: string; code: number }) => void) {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    }
    emit(type: string, data: string, code = 1000) {
      for (const listener of this.listeners.get(type) ?? []) listener({ data, code });
    }
    publish() {
      const scope = { kind: "navigation" };
      this.emit(
        "message",
        JSON.stringify({
          type: "scope-reset",
          scope,
          incarnation: "hq",
          revision: ++revision,
          values: frames(),
          removals: [],
        }),
      );
      this.emit(
        "message",
        JSON.stringify({
          type: "scope-ready",
          scope,
          incarnation: "hq",
          revision,
          core: { protocol: 1, build: "current" },
        }),
      );
    }
    send(raw: string) {
      if (!this.hq) return;
      const request = JSON.parse(raw) as {
        type: string;
        scopes?: Array<{ kind?: string; scope?: { kind: string } }>;
      };
      if (
        request.type === "subscribe" &&
        request.scopes?.some((item) => (item.scope ?? item).kind === "navigation")
      )
        queueMicrotask(() => this.publish());
      for (const item of request.scopes ?? []) {
        const scope = item.scope ?? item;
        if (request.type !== "subscribe" || scope.kind !== "attention") continue;
        queueMicrotask(() => {
          this.emit(
            "message",
            JSON.stringify({
              type: "scope-reset",
              scope,
              incarnation: "hq",
              revision: 1,
              values: [],
              removals: [],
            }),
          );
          this.emit(
            "message",
            JSON.stringify({ type: "scope-ready", scope, incarnation: "hq", revision: 1 }),
          );
        });
      }
    }
    close() {}
  }
  vi.stubGlobal("WebSocket", Socket);
  const harness = {
    ...base,
    rest: {
      ...base.rest,
      fetchFor: (tab: Parameters<typeof base.rest.fetchFor>[0]) => {
        const zerops = base.rest.fetchFor(tab);
        return async (input: string, init?: RequestInit) => {
          const url = new URL(input);
          if (url.origin !== "https://hq.example.test") {
            if (
              url.origin !== "https://zerops.example.test" ||
              !url.pathname.startsWith("/api/rest/public/")
            ) {
              unexpected.push(`HTTP ${url.origin}${url.pathname}`);
              return new Response(null, { status: 404 });
            }
            const response = await zerops(input, init);
            if (deviceLogin && url.pathname.endsWith("/auth/device-login"))
              return Response.json({
                requestId: "req-1",
                pollSecret: "poll-1",
                userCode: "MATE-0001",
                verificationUrl: "https://zerops.example.test/consent?request=req-1",
                expiresIn: 300,
                interval: 1,
              });
            if (deviceLogin && url.pathname.endsWith("/auth/device-login/check"))
              return Response.json({
                status: "APPROVED",
                auth: { auth: approvedSession, user: person },
              });
            if (
              url.pathname.endsWith("/public-port-routing/search") ||
              url.pathname.endsWith("/client-user/search")
            )
              return Response.json({ items: [], totalHits: 0 });
            if (url.pathname.endsWith("/service-stack/search"))
              return Response.json({
                items: [
                  {
                    id: "service-Ada",
                    projectId: "Ada",
                    name: "zcp",
                    status: "ACTIVE",
                    subdomainAccess: true,
                    ports: [{ port: 8080, httpSupport: true }],
                    serviceStackTypeInfo: { serviceStackTypeVersionName: "zcp@1" },
                    _version: 1,
                  },
                ],
                totalHits: 1,
              });
            if (response.status === 404) unexpected.push(`unmapped platform ${url.pathname}`);
            return response;
          }
          if (url.pathname === "/api/door") {
            doors += 1;
            currentSession = `hq-session-${doors}`;
            return Response.json({
              session: currentSession,
              expiresAt: "2099-01-01T00:00:00Z",
              orgId: "ORG",
              userId: "owner",
            });
          }
          if (url.pathname === "/api/stream-ticket") {
            const bearer =
              new Headers(init?.headers).get("authorization")?.replace(/^Bearer /, "") ?? "";
            ticketSessions.push(bearer);
            for (const notify of ticketWaiters.splice(0)) notify();
            if (bearer !== currentSession)
              return Response.json({ code: "session_required" }, { status: 401 });
            return Response.json({ ticket: "ticket", expiresIn: 60 });
          }
          unexpected.push(`unmapped HQ ${url.pathname}`);
          return new Response(null, { status: 404 });
        };
      },
    },
  };
  const tab = await mountTab(harness, harness.browser.openTab(), {
    page: async () => {
      const [
        registry,
        data,
        hq,
        sidebar,
        candidates,
        atoms,
        projections,
        session,
        environments,
        inventory,
        state,
        runtimeData,
        handoverModule,
        accountRow,
        sidebarUi,
      ] = await Promise.all([
        import("../rpc/atomRegistry"),
        import("./ZeropsAccountData"),
        import("./hqNavigation"),
        import("../components/zerops/SidebarZeropsTree"),
        import("./useZeropsCandidates"),
        import("@effect/atom-react"),
        import("@t3tools/client-runtime/zerops/projections"),
        import("./ZeropsSessionProvider"),
        import("./ZeropsAccountEnvironmentProvider"),
        import("./ZeropsInventoryProvider"),
        import("../state/zerops"),
        import("@t3tools/client-runtime/data"),
        import("./handover"),
        import("../components/zerops/SidebarZeropsAccount"),
        import("../components/ui/sidebar"),
      ]);
      const FullSidebar = fullSidebar ? (await import("../components/Sidebar")).default : null;
      Object.assign(window, {
        matchMedia: () => ({
          matches: false,
          addEventListener: () => {},
          removeEventListener: () => {},
        }),
      });
      Object.assign(document, { querySelector: () => null });
      handover = handoverModule;
      hqPhase = () => {
        const reads = registry.appAtomRegistry.get(runtimeData.accountReadsAtom);
        if (reads === null) throw new Error("account not mounted");
        return registry.appAtomRegistry.get(reads.data.stream("hq:ORG")).phase;
      };
      whenRefused = () =>
        new Promise<void>((resolve) => {
          const held = registry.appAtomRegistry;
          const reads = held.get(runtimeData.accountReadsAtom);
          if (reads === null) throw new Error("account not mounted");
          const stream = reads.data.stream("hq:ORG");
          let stop = () => {};
          const check = () => {
            if (held.get(stream).phase !== "refused") return;
            stop();
            resolve();
          };
          stop = held.subscribe(stream, check);
          check();
        });
      whenRecovering = () =>
        new Promise<number>((resolve) => {
          const held = registry.appAtomRegistry;
          const reads = held.get(runtimeData.accountReadsAtom);
          if (reads === null) throw new Error("account not mounted");
          const stream = reads.data.stream("hq:ORG");
          let stop = () => {};
          const check = () => {
            const state = held.get(stream);
            if (state.phase !== "recovering" || state.next.kind !== "retry") return;
            stop();
            resolve(state.next.at);
          };
          stop = held.subscribe(stream, check);
          check();
        });
      whenReady = (expected) =>
        new Promise<void>((resolve) => {
          const held = registry.appAtomRegistry;
          let stopListing = () => {};
          let stopNavigation = () => {};
          let stopMates = () => {};
          const check = () => {
            const listing = held.get(candidates.allCandidateListingAtom);
            const navigation = held.get(state.hqNavigationAtom);
            if (
              listing.state !== "known" ||
              !listing.value.some((row) => row.project.id === "Ada") ||
              !navigation.structure?.apps.some((app) => app.name === expected) ||
              (fullSidebar && !held.get(runtimeData.shownHqMatesAnsweredAtom))
            )
              return;
            stopListing();
            stopNavigation();
            stopMates();
            resolve();
          };
          stopListing = held.subscribe(candidates.allCandidateListingAtom, check);
          stopNavigation = held.subscribe(state.hqNavigationAtom, check);
          if (fullSidebar) stopMates = held.subscribe(runtimeData.shownHqMatesAnsweredAtom, check);
          check();
        });
      function Menu() {
        const { status } = session.useZeropsSession();
        const listing = atoms.useAtomValue(candidates.allCandidateListingAtom);
        const rows = projections.heldCandidates(listing);
        if (status !== "signed-in") return null;
        return (
          <sidebar.SidebarZeropsTree
            candidates={rows.rows}
            complete={rows.complete}
            onSelect={() => {}}
            onBrowseProjects={() => {}}
          />
        );
      }
      function Page() {
        const { status } = session.useZeropsSession();
        return status === "signed-in" ? (
          <registry.AppAtomRegistryProvider>
            <data.ZeropsAccountData>
              <environments.ZeropsAccountEnvironmentProvider>
                <hq.ZeropsHqNavigation />
                <inventory.ZeropsInventoryProvider>
                  <sidebarUi.SidebarProvider>
                    {FullSidebar === null ? <Menu /> : <FullSidebar />}
                    {deviceLogin && (
                      <accountRow.SidebarZeropsAccountRow
                        destinationIcon={() => null}
                        chiefIcon={null}
                      />
                    )}
                  </sidebarUi.SidebarProvider>
                </inventory.ZeropsInventoryProvider>
              </environments.ZeropsAccountEnvironmentProvider>
            </data.ZeropsAccountData>
          </registry.AppAtomRegistryProvider>
        ) : null;
      }
      return <Page />;
    },
  });
  Object.assign(window, noDom);
  if (fakeClock) {
    vi.useFakeTimers({
      now: Date.now(),
      toFake: ["Date", "performance", "setTimeout", "clearTimeout"],
    });
    vi.spyOn(process.hrtime, "bigint").mockImplementation(() =>
      BigInt(Math.round(performance.now() * 1_000_000)),
    );
  }
  await tab.run(async () => {
    if (deviceLogin) {
      const { runZeropsDeviceLogin } = await import("./deviceLogin");
      const run = runZeropsDeviceLogin({
        kind: "login",
        apiBase: "https://zerops.example.test",
        onStage: () => {},
        ports: {
          open: () => null,
          fetch: (input, init) => fetch(input, init),
          wait: async () => {},
          nowMs: () => Date.now(),
          appCode: "mate",
          consentOrigin: undefined,
        },
      });
      const outcome = await run.outcome;
      if (outcome.kind !== "approved" || outcome.session === null)
        throw new Error(`The device login was ${outcome.kind}.`);
      await tab.session().adoptDeviceLogin(outcome.session);
      return;
    }
    const url = handover.startZeropsHandover();
    window.location.assign(url);
    const state = new URL(url).searchParams.get("state");
    const token = base.rest.issueSession("owner").accessToken;
    const outcome = handover.completeZeropsHandover({ fragment: `#token=${token}&state=${state}` });
    if (outcome.kind !== "session") throw new Error(`The hand-over was ${outcome.kind}.`);
    await tab.session().adoptHandover(outcome);
  });
  await settle();
  expect({
    status: tab.session().status,
    org: tab.session().activeOrganization?.id,
    doors,
  }).toMatchObject({ status: "signed-in", org: "ORG", doors: 1 });
  await whenReady("Shop");
  await tab.run(() => {});
  expect(menuText()).toContain("Shop");
  return {
    base,
    approvedSession,
    tab,
    unexpected,
    ticketSessions,
    doors: () => doors,
    handovers: () =>
      tab.navigations().filter(({ url }) => new URL(url).pathname === "/authorize-app").length,
    whenReady: (value: string) => whenReady(value),
    whenRecovering: () => whenRecovering(),
    whenRefused: () => whenRefused(),
    hqPhase: () => hqPhase(),
    whenTickets: (count: number) =>
      new Promise<void>((resolve) => {
        const check = () => {
          if (ticketSessions.length >= count) resolve();
          else ticketWaiters.push(check);
        };
        check();
      }),
    rename: (value: string) => {
      name = value;
    },
    publish: () => socket!.publish(),
    expire: () => {
      currentSession = undefined;
      socket!.emit("close", "", 4401);
    },
    refuse: () => socket!.emit("close", "", 4403),
    release: () => heldMembers?.release(),
  };
}

describe("A: sign-in, session and organizations", () => {
  it("a reload with a kept HQ session mints no door token, its member list read late, as the organization's", async () => {
    const fixture = await mountMenu(true);
    const { base, tab, unexpected } = fixture;
    try {
      for (let load = 0; load < 2; load++) {
        await tab.run(() => window.location.reload());
        await fixture.whenReady(load === 0 ? "Shop" : "Shop 0");
        await tab.run(() => {});
        expect(menuText()).toContain(load === 0 ? "Shop" : "Shop 0");
        const name = `Shop ${load}`;
        fixture.rename(name);
        const ready = fixture.whenReady(name);
        await tab.run(() => fixture.publish());
        await ready;
        await tab.run(() => {});
        expect(menuText()).toContain(name);
        expect(
          base.rest.requests().filter(({ route }) => route === "GET /client/ORG/user/list"),
        ).toHaveLength(0);
      }
      expect(fixture.doors()).toBe(1);
      expect(unexpected).toEqual([]);
    } finally {
      fixture.release();
    }
  });

  it("HQ session expires and renews itself", async () => {
    const fixture = await mountMenu(false, true);
    expect(fixture.handovers()).toBe(1);
    const recovery = fixture.whenRecovering();
    fixture.rename("Automatically renewed");
    await fixture.tab.run(() => fixture.expire());
    const retryAt = await recovery;
    const ready = fixture.whenReady("Automatically renewed");
    const ticket = fixture.whenTickets(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(Math.max(0, retryAt - Date.now()));
    });
    await ticket;
    expect(fixture.ticketSessions).toEqual(["hq-session-1", "hq-session-2"]);
    await ready;
    await fixture.tab.run(() => {});
    expect(menuText()).toContain("Automatically renewed");
    expect(fixture.handovers()).toBe(1);
    expect(fixture.tab.tab.reloads).toBe(0);
    expect(fixture.unexpected).toEqual([]);
  });

  it("refresh keeps a reloaded tab signed in", async () => {
    const fixture = await mountMenu(false, false, true);
    const { base, tab, approvedSession } = fixture;
    if (approvedSession === undefined) throw new Error("Device login did not issue a session.");
    base.rest.expireAccessToken(approvedSession.accessToken);
    await tab.run(() => window.location.reload());
    expect(tab.session().status).toBe("signed-in");
    await fixture.whenReady("Shop");
    await tab.run(() => {});
    const account = rendered.tree!.root.find(
      (node) =>
        typeof node.type === "string" && node.props["data-zerops-surface"] === "sidebar-account",
    );
    expect(text(account)).toContain("owner");
    expect(menuText()).toContain("Shop");
    expect(base.rest.refreshes()).toBe(1);
    const stored = JSON.parse(
      base.browser.openTab().localStorage.getItem(ZEROPS_SESSION_STORAGE_KEY)!,
    );
    expect(stored.accessToken).not.toBe(approvedSession.accessToken);
    expect(
      base.rest.requests().filter(({ route }) => route === "POST /auth/device-login"),
    ).toHaveLength(1);
    expect(fixture.unexpected).toEqual([]);
  });

  it("Try again retries a refused HQ connection without account sign-in", async () => {
    const fixture = await mountMenu(false, false, false, true);
    expect(fixture.handovers()).toBe(1);
    const refused = fixture.whenRefused();
    await fixture.tab.run(() => fixture.refuse());
    await refused;
    await fixture.tab.run(() => {});
    const menu = rendered.tree!.root.find(
      (node) =>
        typeof node.type === "string" && node.props["data-zerops-surface"] === "sidebar-menu",
    );
    const again = menu.find(
      (node) => node.type === "button" && node.props["data-zerops-surface"] === "sidebar-hq-outage",
    );
    expect(text(again)).toContain("Try again");
    fixture.rename("Renewed");
    const ready = fixture.whenReady("Renewed");
    await fixture.tab.run(() => again.props.onClick({ nativeEvent: new Event("click") }));
    expect(fixture.hqPhase()).not.toBe("refused");
    await ready;
    await fixture.tab.run(() => {});
    expect(menuText()).toContain("Renewed");
    const account = menu.find(
      (node) =>
        typeof node.type === "string" && node.props["data-zerops-surface"] === "sidebar-account",
    );
    expect(text(account)).toContain("owner");
    expect(fixture.handovers()).toBe(1);
    expect(fixture.tab.tab.reloads).toBe(0);
    expect(fixture.unexpected).toEqual([]);
  });
});
