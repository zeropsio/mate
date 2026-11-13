import { ZeropsUserId } from "@t3tools/contracts";
import { makeAccountHarness } from "@t3tools/client-runtime/zerops/testing";
import { STREAM_POLICY } from "@t3tools/client-runtime/data";
import { ZEROPS_SESSION_STORAGE_KEY, type ZeropsUser } from "@t3tools/client-runtime/zerops";
import type { ReactTestInstance, ReactTestRenderer } from "react-test-renderer";
import { Window } from "happy-dom";
import { act, useEffect, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { mountTab, settle, unmountTabs } from "./__fixtures__/harnessTabs";

const rendered = vi.hoisted(() => ({
  tree: null as ReactTestRenderer | null,
  routes: [] as unknown[],
  navigate: (_target: unknown) => {},
}));
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
  id: ZeropsUserId.make("owner"),
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
  useNavigate: () => (target: unknown) => {
    rendered.routes.push(target);
    rendered.navigate(target);
  },
  useRouter: () => ({ state: { location: { pathname: "/" } } }),
  useLocation: ({ select }: { select: (value: { pathname: string }) => unknown }) =>
    select({ pathname: "/" }),
  useParams: ({ select }: { select?: (value: object) => unknown }) => select?.({}) ?? {},
  useMatch: () => undefined,
  useRouteContext: () => ({ status: "hosted-static" }),
  useRouterState: ({ select }: { select: (state: { location: { hash: string } }) => unknown }) =>
    select({ location: { hash: "" } }),
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
  rendered.routes = [];
  rendered.navigate = () => {};
});

async function mountMenu(
  holdMembers: boolean,
  fakeClock = false,
  deviceLogin = false,
  fullSidebar = false,
  flowPage = false,
  wire?: "legacy" | "modern",
  addressCase = false,
) {
  vi.stubEnv("VITE_HQ_ORIGIN", "https://hq.example.test");
  vi.stubEnv("VITE_ZEROPS_API_URL", "https://zerops.example.test");
  const noDom = Object.fromEntries(
    ["Node", "Element", "HTMLElement", "ShadowRoot"].map((key) => [key, function none() {}]),
  );
  for (const [key, type] of Object.entries(noDom)) vi.stubGlobal(key, type);
  if (addressCase) vi.stubGlobal("CSS", { escape: (value: string) => value });
  if (flowPage) vi.stubGlobal("customElements", { get: () => undefined, define: () => {} });
  const mateId = addressCase ? "Bea" : "Ada";
  const base = makeAccountHarness({
    people: [{ user: person, password: "secret" }],
    projects: [
      {
        id: mateId,
        clientId: "ORG",
        name: mateId,
        status: "ACTIVE",
        tagList: ["mate"],
        publicZone: addressCase ? "fte2334ab.prg1-zerops.zone" : "example.test",
        zeropsSubdomainHost: addressCase ? "24cb" : "ada",
      },
      ...(wire === undefined
        ? []
        : ["Shop-production", "Shop-stage"].map((id) => ({
            id,
            clientId: "ORG",
            name: id,
            status: "ACTIVE",
          }))),
    ],
  });
  const heldMembers = holdMembers ? base.rest.hold("GET /client/ORG/user/list") : undefined;
  const approvedSession = deviceLogin ? base.rest.issueSession("owner") : undefined;
  let name = "Shop";
  let doors = 0;
  let socket: Socket | undefined;
  let zeropsSocket: Socket | undefined;
  let stage = wire !== undefined;
  let partialStage = false;
  let jobFinished = false;
  let addressEnabled = false;
  let selected: unknown;
  let selectedEnvironment: string | null = null;
  let hqOffline = false;
  let hqSockets = 0;
  const socketWaiters: Array<() => void> = [];
  const sha = "a".repeat(40);
  const version =
    wire === undefined
      ? { id: "version-preview", serviceId: "app-preview", name: "stage-existing" }
      : { id: "version-1", serviceId: "web-stage", name: `main ${sha.slice(0, 7)}` };
  const versions = new Map([[version.id, version]]);
  const stageService = {
    id: version.serviceId,
    projectId: wire === undefined ? "preview" : "Shop-stage",
    clientId: "ORG",
    name: wire === undefined ? "app" : "web",
    activeAppVersion: { id: version.id, name: version.name },
    userData: [
      { key: "appVersionId", content: version.id },
      { key: "appVersionName", content: version.name },
    ],
    status: "ACTIVE",
    isSystem: false,
    ports: [{ port: 3000, scheme: "http" }],
    serviceStackTypeInfo: {
      serviceStackTypeName: "nodejs",
      serviceStackTypeVersionName: "nodejs@22",
      serviceStackTypeCategory: "USER",
    },
  };
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
  let whenStage: () => Promise<void> = async () => {
    throw new Error("account not mounted");
  };
  let whenJob: () => Promise<void> = async () => {
    throw new Error("account not mounted");
  };
  let readJob: () => unknown = () => {
    throw new Error("account not mounted");
  };
  let whenAddress: () => Promise<void> = async () => {
    throw new Error("account not mounted");
  };
  let whenRunning: () => Promise<void> = async () => {
    throw new Error("account not mounted");
  };
  let whenProcess: () => Promise<void> = async () => {
    throw new Error("account not mounted");
  };
  let handover: typeof import("./handover");
  const job = {
    id: "job-1",
    kind: "deploy",
    service: "web",
    sha,
    state: "live",
    cause: "merge",
    ref: "main",
    reason: null,
    appVersionId: version.id,
    processId: null,
    requestedBy: null,
    at: "2026-10-06T12:00:00Z",
    endedAt: "2026-10-06T12:01:00Z",
    supersededBy: null,
  };
  const identity = (id: string) =>
    wire === "legacy" ? { projectId: id } : { id, target: { kind: "zerops", projectId: id } };
  const environment = (id: string, tier: "stage" | "production") => ({
    ...identity(id),
    tier,
    name: id,
    sources: ["main"],
    order: tier === "production" ? 0 : 1,
    keyHeld: false,
    keyInvalid: false,
    jobs: tier === "stage" && jobFinished ? [job] : [],
    release: null,
    birth: null,
  });
  const frames = () => [
    {
      key: "app:shop",
      value: {
        id: "shop",
        name,
        can: {},
        contents: { empty: false, deletingProjectIds: [] },
        projectIds:
          wire !== undefined
            ? [mateId, "Shop-production", "Shop-stage"]
            : stage
              ? [mateId, "preview"]
              : [mateId],
        births: [],
        environments:
          wire !== undefined
            ? [environment("Shop-production", "production"), environment("Shop-stage", "stage")]
            : stage
              ? [
                  {
                    id: "preview",
                    ...(partialStage
                      ? { projectId: "preview" }
                      : { target: { kind: "zerops", projectId: "preview" } }),
                    tier: "stage",
                    name: "stage",
                    sources: ["main"],
                    order: 1,
                    keyHeld: false,
                    keyInvalid: false,
                    jobs: [],
                    release: null,
                    birth: null,
                  },
                ]
              : [],
        changes: [],
        releaseOffer: null,
      },
    },
    {
      key: `project:${mateId}`,
      value: {
        projectId: mateId,
        appId: "shop",
        name: mateId,
        kind: "mate",
        mate: { face: "", madeBy: null, standupRequestedBy: null },
        person: { mine: false, ownerUserId: null, waitsOnViewer: false, unseen: null },
        signedInNow: {},
        everSignedIn: {},
      },
    },
    ...(wire !== undefined
      ? ["Shop-production", "Shop-stage"].map((projectId) => ({
          key: `project:${projectId}`,
          value: {
            projectId,
            appId: "shop",
            name: projectId,
            kind: projectId === "Shop-production" ? "production" : "stage",
            mate: null,
            person: { mine: false, ownerUserId: null, waitsOnViewer: false, unseen: null },
            signedInNow: {},
            everSignedIn: {},
          },
        }))
      : stage
        ? [
            {
              key: "project:preview",
              value: {
                projectId: "preview",
                appId: "shop",
                name: "preview",
                kind: "stage",
                mate: null,
                person: { mine: false, ownerUserId: null, waitsOnViewer: false, unseen: null },
                signedInNow: {},
                everSignedIn: {},
              },
            },
          ]
        : []),
  ];
  const registerSocket = (instance: Socket, isHq: boolean) => {
    if (isHq) {
      socket = instance;
      hqSockets += 1;
      for (const notify of socketWaiters.splice(0)) notify();
    } else zeropsSocket = instance;
  };
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
      registerSocket(this, this.hq);
      queueMicrotask(() => {
        if (this.hq) {
          if (!hqOffline) this.emit("open", "");
        } else this.onmessage?.({ data: JSON.stringify({ type: "SocketSuccess" }) });
      });
    }
    addEventListener(type: string, listener: (event: { data: string; code: number }) => void) {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    }
    emit(type: string, data: string, code = 1000) {
      for (const listener of this.listeners.get(type) ?? []) listener({ data, code });
    }
    publish(type: "scope-reset" | "scope-values" = "scope-reset") {
      const scope = { kind: "navigation" };
      this.emit(
        "message",
        JSON.stringify({
          type,
          scope,
          incarnation: "hq",
          revision: ++revision,
          values: frames(),
          removals: [],
        }),
      );
      if (type === "scope-reset")
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
        if (
          request.type !== "subscribe" ||
          scope.kind === undefined ||
          !["attention", "app-detail"].includes(scope.kind)
        )
          continue;
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
            JSON.stringify({
              type: "scope-ready",
              scope,
              incarnation: "hq",
              revision: 1,
              core: { protocol: 1, build: "test" },
            }),
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
            if (
              url.pathname.endsWith("/public-port-routing/search") ||
              url.pathname.endsWith("/client-user/search") ||
              (addressCase && url.pathname.endsWith("/process/search"))
            )
              return Response.json({ items: [], totalHits: 0 });
            const mateService = {
              id: `service-${mateId}`,
              clientId: "ORG",
              projectId: mateId,
              name: "zcp",
              status: "ACTIVE",
              subdomainAccess: !addressCase,
              ...(addressCase ? { lastUpdate: "2026-10-06T12:00:00.000Z" } : {}),
              ports: [{ port: 8080, httpSupport: true }],
              serviceStackTypeInfo: { serviceStackTypeVersionName: "zcp@1" },
              _version: 1,
            };
            if (addressCase && url.pathname.endsWith(`/project/${mateId}/process`))
              return Response.json({ list: [] });
            if (addressCase && url.pathname.endsWith(`/service-stack/service-${mateId}`))
              return Response.json({
                ...mateService,
                subdomainAccess: addressEnabled,
                lastUpdate: "2026-10-06T12:01:50.000Z",
                _version: undefined,
              });
            if (url.pathname.endsWith("/service-stack/search"))
              return Response.json({
                items: [
                  ...(stage
                    ? [
                        wire !== undefined && !jobFinished
                          ? { ...stageService, activeAppVersion: null, userData: [] }
                          : stageService,
                      ]
                    : []),
                  mateService,
                ],
                totalHits: stage ? 2 : 1,
              });
            if (stage && url.pathname.endsWith(`/project/${stageService.projectId}/service-stack`))
              return Response.json({ list: [stageService] });
            if (stage && url.pathname.endsWith(`/app-version/${version.id}`))
              return Response.json(versions.get(version.id));
            if (stage && url.pathname.endsWith("/app-version/search"))
              return Response.json({
                items: [
                  {
                    ...version,
                    serviceStackId: version.serviceId,
                    projectId: stageService.projectId,
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
      const browserDom = flowPage ? new Window() : null;
      Object.assign(document, {
        querySelector: () => null,
        querySelectorAll: () => [],
        ...(browserDom === null
          ? {}
          : {
              documentElement: browserDom.document.documentElement,
              head: browserDom.document.head,
            }),
      });
      const PlacePages = flowPage ? await import("../components/zerops/PlacePage") : null;
      const ProjectPages = flowPage ? await import("../components/zerops/ProjectPage") : null;
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
      whenAddress = () =>
        new Promise<void>((resolve) => {
          const held = registry.appAtomRegistry;
          let stop = () => {};
          const check = () => {
            const listing = held.get(candidates.allCandidateListingAtom);
            if (
              listing.state !== "known" ||
              !listing.value.some(
                (row) =>
                  row.project.id === mateId &&
                  row.containerOrigin === "https://zcp-24cb-8080.prg1.zerops.app",
              )
            )
              return;
            stop();
            resolve();
          };
          stop = held.subscribe(candidates.allCandidateListingAtom, check);
          check();
        });
      whenRunning = () =>
        new Promise<void>((resolve) => {
          const held = registry.appAtomRegistry;
          const reads = held.get(runtimeData.accountReadsAtom);
          if (reads === null) throw new Error("account not mounted");
          const stream = reads.data.stream("zerops:ORG:running");
          let stop = () => {};
          const check = () => {
            if (held.get(stream).phase !== "live") return;
            stop();
            resolve();
          };
          stop = held.subscribe(stream, check);
          check();
        });
      whenProcess = () =>
        new Promise<void>((resolve) => {
          const held = registry.appAtomRegistry;
          const atom = runtimeData.projectProcessesAtom(mateId);
          let stop = () => {};
          const check = () => {
            if (!held.get(atom).processes?.some((row) => row.id === "enable-bea")) return;
            stop();
            resolve();
          };
          stop = held.subscribe(atom, check);
          check();
        });
      whenStage = () =>
        new Promise<void>((resolve) => {
          const held = registry.appAtomRegistry;
          const reads = held.get(runtimeData.accountReadsAtom);
          if (reads === null) throw new Error("account not mounted");
          const environments = state.hqNavigationAtom;
          const service = reads.data.project(runtimeData.serviceRuns, {
            orgId: "ORG",
            serviceId: "app-preview",
          });
          let stopEnvironments = () => {};
          let stopService = () => {};
          const check = () => {
            const run = held.get(service);
            if (
              !held
                .get(environments)
                .structure?.apps.find((app) => app.id === "shop")
                ?.environments?.some((row) => row.id === "preview") ||
              typeof run === "string" ||
              run.activeId !== "version-preview"
            )
              return;
            stopEnvironments();
            stopService();
            resolve();
          };
          stopEnvironments = held.subscribe(environments, check);
          stopService = held.subscribe(service, check);
          check();
        });
      whenJob = () =>
        new Promise<void>((resolve) => {
          const held = registry.appAtomRegistry;
          const atom = state.hqNavigationAtom;
          const reads = held.get(runtimeData.accountReadsAtom);
          if (reads === null) throw new Error("account not mounted");
          const service = reads.data.project(runtimeData.serviceRuns, {
            orgId: "ORG",
            serviceId: "web-stage",
          });
          let stopJob = () => {};
          let stopService = () => {};
          const check = () => {
            const jobs = held
              .get(atom)
              .structure?.apps.find((app) => app.id === "shop")
              ?.environments?.find((row) => row.id === "Shop-stage")?.jobs;
            const run = held.get(service);
            if (
              !jobs?.some((row) => row.sha === sha && row.state === "live") ||
              typeof run === "string" ||
              run.activeId !== "version-1"
            )
              return;
            stopJob();
            stopService();
            resolve();
          };
          stopJob = held.subscribe(atom, check);
          stopService = held.subscribe(service, check);
          check();
        });
      readJob = () =>
        registry.appAtomRegistry
          .get(state.hqNavigationAtom)
          .structure?.apps.find((app) => app.id === "shop")
          ?.environments?.find((row) => row.id === "Shop-stage")?.jobs[0];
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
              !listing.value.some((row) => row.project.id === mateId) ||
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
            onSelect={(candidate) => {
              selected = candidate;
            }}
            onBrowseProjects={() => {}}
          />
        );
      }
      function Page() {
        const { status } = session.useZeropsSession();
        const [environmentId, setEnvironmentId] = useState<string | null>(selectedEnvironment);
        useEffect(() => {
          rendered.navigate = (target) => {
            if (typeof target !== "object" || target === null || !("params" in target)) return;
            const params = target.params;
            if (
              typeof params === "object" &&
              params !== null &&
              "projectId" in params &&
              (typeof params.projectId === "string" || params.projectId === null)
            ) {
              selectedEnvironment = params.projectId;
              setEnvironmentId(params.projectId);
            }
          };
          return () => {
            rendered.navigate = () => {};
          };
        }, []);
        return status === "signed-in" ? (
          <registry.AppAtomRegistryProvider>
            <data.ZeropsAccountData>
              <environments.ZeropsAccountEnvironmentProvider>
                <hq.ZeropsHqNavigation />
                <inventory.ZeropsInventoryProvider>
                  <sidebarUi.SidebarProvider>
                    {FullSidebar === null ? <Menu /> : <FullSidebar />}
                    {PlacePages !== null &&
                      ProjectPages !== null &&
                      (environmentId === null ? (
                        <ProjectPages.ZeropsGroupDetailPage groupId="shop" />
                      ) : (
                        <PlacePages.ZeropsStopDetailPage
                          groupId="shop"
                          environmentId={environmentId}
                        />
                      ))}
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
    // A session with a refresh token, as a desktop window's device login collects it.
    if (approvedSession !== undefined) {
      await tab.session().adoptDeviceLogin(approvedSession);
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
    whenStage: () => whenStage(),
    whenJob: () => whenJob(),
    readJob: () => readJob(),
    whenAddress: () => whenAddress(),
    whenRunning: () => whenRunning(),
    whenProcess: () => whenProcess(),
    selected: () => selected,
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
    partial: (value: boolean, nextName: string) => {
      partialStage = value;
      name = nextName;
      socket!.publish("scope-values");
    },
    disconnect: () => {
      hqOffline = true;
      socket!.emit("close", "", 1006);
    },
    reconnect: () => {
      hqOffline = false;
      socket!.emit("open", "");
    },
    whenSockets: (count: number) =>
      new Promise<void>((resolve) => {
        const check = () => {
          if (hqSockets >= count) resolve();
          else socketWaiters.push(check);
        };
        check();
      }),
    versions,
    stageService,
    finishJob: () => {
      jobFinished = true;
      const search = base.rest
        .requests()
        .toReversed()
        .find((request) => {
          const body = request.body;
          return (
            request.route === "POST /service-stack/search" &&
            typeof body === "object" &&
            body !== null &&
            "wsOutputType" in body &&
            body.wsOutputType === "updateStream"
          );
        });
      const body = search?.body;
      if (typeof body !== "object" || body === null || !("subscriptionName" in body))
        throw new Error("service update subscription not ready");
      zeropsSocket!.onmessage?.({
        data: JSON.stringify({
          type: "search",
          subscriptionName: body.subscriptionName,
          data: { update: [stageService] },
        }),
      });
      socket!.publish("scope-values");
    },
    finishEnable: () => {
      addressEnabled = true;
      const search = base.rest
        .requests()
        .toReversed()
        .find((request) => {
          const body = request.body;
          return (
            request.route === "POST /process/search" &&
            typeof body === "object" &&
            body !== null &&
            "wsOutputType" in body &&
            body.wsOutputType === "updateStream"
          );
        });
      const body = search?.body;
      if (typeof body !== "object" || body === null || !("subscriptionName" in body))
        throw new Error("process update subscription not ready");
      zeropsSocket!.onmessage?.({
        data: JSON.stringify({
          type: "search",
          subscriptionName: body.subscriptionName,
          data: {
            update: [
              {
                id: "enable-bea",
                clientId: "ORG",
                projectId: "Bea",
                actionName: "stack.enableSubdomainAccess",
                status: "FINISHED",
                created: "2026-10-06T12:01:40.000Z",
                started: "2026-10-06T12:01:40.000Z",
                finished: "2026-10-06T12:01:45.000Z",
                lastUpdate: "2026-10-06T12:01:45.000Z",
                executorTag: "USER",
                serviceStackId: "service-Bea",
                serviceStacks: [{ id: "service-Bea" }],
                error: null,
                appVersion: null,
                _version: 2,
              },
            ],
          },
        }),
      });
    },
    addStage: () => {
      base.rest.addProject({ id: "preview", name: "preview", clientId: "ORG", status: "ACTIVE" });
      stage = true;
      const projectSearch = base.rest
        .requests()
        .toReversed()
        .find((request) => {
          const body = request.body;
          return (
            request.route === "POST /project/search" &&
            typeof body === "object" &&
            body !== null &&
            "wsOutputType" in body &&
            body.wsOutputType === "listStream"
          );
        });
      const body = projectSearch?.body;
      if (typeof body !== "object" || body === null || !("subscriptionName" in body))
        throw new Error("project listing subscription not ready");
      zeropsSocket!.onmessage?.({
        data: JSON.stringify({
          type: "search",
          subscriptionName: body.subscriptionName,
          data: { add: ["preview"], delete: [] },
        }),
      });
      socket!.publish();
    },
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
        // Each page asks for the member list once and shows its menu while that read is held.
        expect(
          base.rest.requests().filter(({ route }) => route === "GET /client/ORG/user/list"),
        ).toHaveLength(load + 2);
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
    // The reload renews the session it kept: it starts no sign-in of its own.
    expect(
      base.rest.requests().filter(({ route }) => route === "POST /auth/device-login"),
    ).toHaveLength(0);
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

describe("B: environment identity compatibility", () => {
  async function compatibility(wire: "legacy" | "modern") {
    const fixture = await mountMenu(false, false, false, false, true, wire);
    const rows = () =>
      rendered.tree!.root.findAll(
        (node) => node.type === "button" && node.props["data-zerops-environment-id"] !== undefined,
      );
    const names = () => rows().map((row) => text(row.findAllByType("span")[0]!));
    expect(names()).toEqual(["Production", "Shop-stage"]);
    await fixture.tab.run(() => rows()[0]!.props.onClick());
    expect(rendered.routes.at(-1)).toEqual({
      to: "/group/$groupId/$projectId",
      params: { groupId: "shop", projectId: "Shop-production" },
    });
    await fixture.tab.run(() => rendered.navigate({ params: { projectId: null } }));
    expect(names()).toEqual(["Production", "Shop-stage"]);
    const job = fixture.whenJob();
    await fixture.tab.run(() => fixture.finishJob());
    await job;
    await fixture.tab.run(() => {});
    expect(names()).toEqual(["Production", "Shop-stage"]);
    await fixture.tab.run(() => rows()[1]!.props.onClick());
    expect(rendered.routes.at(-1)).toEqual({
      to: "/group/$groupId/$projectId",
      params: { groupId: "shop", projectId: "Shop-stage" },
    });
    const main = () => text(rendered.tree!.root.findAllByType("main")[0]!);
    expect(main()).toContain("aaaaaaa");
    expect(main()).toContain("web");
    await fixture.tab.run(() => window.location.reload());
    await fixture.whenReady("Shop");
    await fixture.tab.run(() => {});
    expect(main()).toContain("aaaaaaa");
    expect(rendered.routes.at(-1)).toEqual({
      to: "/group/$groupId/$projectId",
      params: { groupId: "shop", projectId: "Shop-stage" },
    });
    expect(
      fixture.base.rest.requests().filter(({ route }) => route === "GET /project/Shop-stage")
        .length,
    ).toBeGreaterThan(0);
    expect(fixture.versions.get(fixture.stageService.activeAppVersion.id)).toMatchObject({
      serviceId: "web-stage",
      name: "main aaaaaaa",
    });
    expect(fixture.readJob()).toMatchObject({ sha: "a".repeat(40), service: "web", state: "live" });
    expect(fixture.unexpected.filter((entry) => !entry.startsWith("unmapped "))).toEqual([]);
  }

  it("Old HQ and new hosted web keep sign-in and environment navigation working.", () =>
    compatibility("legacy"));
  it("Old clients keep their Zerops environments after HQ gains environment identities.", () =>
    compatibility("modern"));

  it("A partial modern environment is refused without erasing known environments.", async () => {
    const fixture = await mountMenu(false, true, false, true, true);
    const rows = () =>
      rendered.tree!.root.findAll(
        (node) => node.type === "button" && node.props["data-zerops-environment-id"] !== undefined,
      );
    const names = () => rows().map((row) => text(row.findAllByType("span")[0]!));
    const heading = () => rendered.tree!.root.findAllByType("h1").map(text);
    const ready = fixture.whenStage();
    await fixture.tab.run(() => fixture.addStage());
    await ready;
    await fixture.tab.run(() => {});
    expect(names()).toEqual(["Preview"]);
    const partial = fixture.whenReady("Shop partial");
    await fixture.tab.run(() => fixture.partial(true, "Shop partial"));
    await partial;
    await fixture.tab.run(() => {});
    expect(heading()[0]).toBe("Shop partial");
    expect(names()).toEqual(["Preview"]);
    const restored = fixture.whenReady("Shop");
    await fixture.tab.run(() => fixture.partial(false, "Shop"));
    await restored;
    await fixture.tab.run(() => {});
    expect(heading()[0]).toBe("Shop");
    const retry = fixture.whenRecovering();
    const socket = fixture.whenSockets(2);
    await fixture.tab.run(() => fixture.disconnect());
    const retryAt = await retry;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(Math.max(0, retryAt - Date.now()));
    });
    await socket;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(STREAM_POLICY.reconnectGraceMs);
    });
    await fixture.tab.run(() => {});
    const outage = () =>
      rendered.tree!.root.findAll(
        (node) =>
          typeof node.type === "string" &&
          node.props["data-zerops-surface"] === "sidebar-hq-outage",
      );
    expect(outage()).toHaveLength(1);
    const again = fixture.whenReady("Shop");
    await fixture.tab.run(() => fixture.reconnect());
    await again;
    await fixture.tab.run(() => {});
    expect(outage()).toHaveLength(0);
    expect(names()).toEqual(["Preview"]);
    await fixture.tab.run(() => rows()[0]!.props.onClick());
    expect(rendered.routes.at(-1)).toEqual({
      to: "/group/$groupId/$projectId",
      params: { groupId: "shop", projectId: "preview" },
    });
    expect(
      rendered
        .tree!.root.findAllByType("main")
        .some((node) => text(node).includes("stage-existing")),
    ).toBe(true);
    expect(fixture.unexpected.filter((entry) => !entry.startsWith("unmapped "))).toEqual([]);
  });

  it("An environment arriving after first paint appears once with its target's service version.", async () => {
    const fixture = await mountMenu(false, false, false, false, true);
    const rows = () =>
      rendered.tree!.root.findAll(
        (node) => node.type === "button" && node.props["data-zerops-environment-id"] !== undefined,
      );
    expect(rows()).toHaveLength(0);
    const ready = fixture.whenStage();
    await fixture.tab.run(() => fixture.addStage());
    await ready;
    await fixture.tab.run(() => {});
    expect(rows().map((row) => text(row.findAllByType("span")[0]!))).toEqual(["Preview"]);
    await fixture.tab.run(() => rows()[0]!.props.onClick());
    expect(rendered.routes.at(-1)).toEqual({
      to: "/group/$groupId/$projectId",
      params: { groupId: "shop", projectId: "preview" },
    });
    expect(
      rendered
        .tree!.root.findAllByType("main")
        .some((node) => text(node).includes("stage-existing")),
    ).toBe(true);
    expect(fixture.versions.get(fixture.stageService.activeAppVersion.id)).toMatchObject({
      serviceId: "app-preview",
      name: "stage-existing",
    });
    // The browser scenario bars external traffic; unrelated same-origin endpoints may answer 404.
    expect(fixture.unexpected.filter((entry) => !entry.startsWith("unmapped "))).toEqual([]);
  });
});

describe("B: menu liveness", () => {
  it("a Mate opens once its address is turned on, its record never pushed", async () => {
    const fixture = await mountMenu(false, false, false, false, false, undefined, true);
    expect(menuText()).toContain("Bea");
    await fixture.whenRunning();
    const process = fixture.whenProcess();
    const address = fixture.whenAddress();
    await fixture.tab.run(() => fixture.finishEnable());
    await process;
    await fixture.tab.run(() => {});
    expect(
      fixture.base.rest.requests().filter(({ route }) => route === "GET /service-stack/service-Bea")
        .length,
    ).toBeGreaterThan(0);
    await address;
    await fixture.tab.run(() => {});
    const row = rendered.tree!.root.find(
      (node) =>
        node.type === "button" &&
        node.props["data-zerops-surface"] === "sidebar-mate" &&
        text(node).includes("Bea"),
    );
    await fixture.tab.run(() => row.props.onClick());
    expect(fixture.selected()).toMatchObject({
      project: { id: "Bea" },
      containerOrigin: "https://zcp-24cb-8080.prg1.zerops.app",
    });
    expect(fixture.tab.tab.reloads).toBe(0);
    expect(fixture.unexpected.filter((entry) => !entry.startsWith("unmapped "))).toEqual([]);
  });
});
