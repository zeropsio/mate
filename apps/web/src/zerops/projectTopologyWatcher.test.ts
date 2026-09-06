// @effect-diagnostics globalTimers:off -- the fake `setTimeout`/`clearTimeout` pair below is the plain
// timer implementation the real (browser) caller injects; `vi.useFakeTimers()` fakes it.
import {
  ZeropsApiError,
  type ZeropsApiClient,
  type ZeropsProject,
  type ZeropsService,
  type ZeropsCurrentStat,
  type ZeropsStatHistoryItem,
  type ZeropsStatHistoryWindow,
} from "@t3tools/client-runtime/zerops";
import type { PlatformWatchSocket } from "@t3tools/client-runtime/zerops/platformWatch";
import type { ZeropsStorageAdapter } from "@t3tools/client-runtime/zerops/session";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  lookupEnvironmentProjectRef,
  rememberEnvironmentProjectRef,
} from "@t3tools/client-runtime/zerops/environmentProjectRef";
import { afterEach, beforeEach, describe, expect, it, vi } from "@effect/vitest";

import { ProjectTopologyWatcher } from "./projectTopologyWatcher.ts";

class FakeSocket implements PlatformWatchSocket {
  readonly sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { readonly data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    // Mirrors the SUT nulling handlers before calling close, same as platformWatch.test.ts's fake.
  }
  open(): void {
    this.onopen?.();
  }
  receive(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

function fakeStorage(): ZeropsStorageAdapter {
  const raw = new Map<string, string>();
  return {
    get: (key) => Promise.resolve(raw.get(key) ?? null),
    set: (key, value) => {
      raw.set(key, value);
      return Promise.resolve();
    },
    remove: (key) => {
      raw.delete(key);
      return Promise.resolve();
    },
  };
}

interface FakeClientOptions {
  readonly project?: ZeropsProject;
  readonly services?: ReadonlyArray<ZeropsService>;
  readonly organizations?: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly membershipId: string;
  }>;
  /** organizationId -> projects, for the origin-match fallback. */
  readonly projectsByOrg?: Readonly<Record<string, ReadonlyArray<ZeropsProject>>>;
  /** projectId -> services, for the origin-match fallback's candidate derivation. */
  readonly servicesByProject?: Readonly<Record<string, ReadonlyArray<ZeropsService>>>;
  /** The current-stats answer, or a thrower to simulate a failed read. */
  readonly usage?: ReadonlyArray<ZeropsCurrentStat> | (() => never);
  /** The stats-history answer, or a thrower. */
  readonly history?: ReadonlyArray<ZeropsStatHistoryItem> | (() => never);
}

function fakeClient(options: FakeClientOptions = {}): {
  readonly client: ZeropsApiClient;
  readonly listProjectServicesCalls: number;
  readonly searchCurrentStatsCalls: ReadonlyArray<{ clientId: string; projectId: string }>;
  readonly searchStatsHistoryCalls: ReadonlyArray<ZeropsStatHistoryWindow>;
  readonly fetchOrganizationsCalls: number;
  readonly loadCandidatesOrgCalls: string[];
} {
  const state = {
    listProjectServicesCalls: 0,
    searchCurrentStatsCalls: [] as Array<{ clientId: string; projectId: string }>,
    searchStatsHistoryCalls: [] as Array<ZeropsStatHistoryWindow>,
    fetchOrganizationsCalls: 0,
    loadCandidatesOrgCalls: [] as string[],
  };
  const client = {
    fetchProject: async (projectId: string) =>
      options.project ?? { id: projectId, name: projectId, status: "ACTIVE" },
    listProjectServices: async (projectId: string) => {
      state.listProjectServicesCalls += 1;
      return options.servicesByProject?.[projectId] ?? options.services ?? [];
    },
    searchCurrentStats: async (clientId: string, projectId: string) => {
      state.searchCurrentStatsCalls.push({ clientId, projectId });
      if (typeof options.usage === "function") options.usage();
      return options.usage ?? [];
    },
    searchStatsHistory: async (
      _clientId: string,
      _projectId: string,
      window: ZeropsStatHistoryWindow,
    ) => {
      state.searchStatsHistoryCalls.push(window);
      if (typeof options.history === "function") options.history();
      return options.history ?? [];
    },
    fetchProjectProcesses: async () => ({ list: [] }),
    exchangeWebSocketToken: async () => ({ webSocketToken: "ws-token" }),
    subscribeProjectSearch: async () => ({ items: [] }),
    fetchOrganizations: async () => {
      state.fetchOrganizationsCalls += 1;
      return options.organizations ?? [];
    },
    listAccessibleClientProjects: async (organizationId: string) => {
      state.loadCandidatesOrgCalls.push(organizationId);
      return options.projectsByOrg?.[organizationId] ?? [];
    },
  } as unknown as ZeropsApiClient;
  return {
    client,
    get listProjectServicesCalls() {
      return state.listProjectServicesCalls;
    },
    get searchCurrentStatsCalls() {
      return state.searchCurrentStatsCalls;
    },
    get searchStatsHistoryCalls() {
      return state.searchStatsHistoryCalls;
    },
    get fetchOrganizationsCalls() {
      return state.fetchOrganizationsCalls;
    },
    get loadCandidatesOrgCalls() {
      return state.loadCandidatesOrgCalls;
    },
  };
}

const service = (
  overrides: Partial<ZeropsService> & { id: string; name: string },
): ZeropsService => ({
  status: "ACTIVE",
  isSystem: false,
  ...overrides,
});

const ENV = "env-1" as EnvironmentId;

function watcherOptions(
  overrides: Partial<ConstructorParameters<typeof ProjectTopologyWatcher>[0]> = {},
) {
  const sockets: FakeSocket[] = [];
  const base = {
    environmentId: ENV,
    client: fakeClient().client,
    storage: fakeStorage(),
    displayUrl: null,
    makeSocket: (url: string) => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    setTimer: (callback: () => void, delayMs: number) => setTimeout(callback, delayMs),
    clearTimer: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    isHidden: () => false,
    makeReceiverId: (() => {
      let n = 0;
      return () => `receiver-${(n += 1)}`;
    })(),
    // A no-op unless a test overrides it — never depend on a real `document`.
    onVisibilityChange: (_callback: () => void) => () => undefined,
    ...overrides,
  };
  return { options: base, sockets };
}

/** Drives one fake socket through open → greeting, flushing the microtask between them. */
async function connectSocket(socket: FakeSocket): Promise<void> {
  socket.open();
  await vi.advanceTimersByTimeAsync(0);
  socket.receive({ type: "SocketSuccess" });
  await vi.advanceTimersByTimeAsync(0);
}

describe("ProjectTopologyWatcher", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("re-reads on changed (debounced) and reports live while the socket is open", async () => {
    const project: ZeropsProject = { id: "proj-1", name: "z3-eval", status: "ACTIVE" };
    // Index 0: read at subscribe (before the socket connects). Index 1: the
    // debounced read "connected" schedules — connecting alone must not cause
    // an immediate second read (no double-read at mount). Index 2: the
    // `changed`-driven re-read under test, once the connect read has settled.
    let servicesCall = 0;
    const services: ReadonlyArray<ZeropsService>[] = [
      [service({ id: "s1", name: "api" })],
      [service({ id: "s1", name: "api" })],
      [service({ id: "s1", name: "api" }), service({ id: "s2", name: "db" })],
    ];
    const fake = fakeClient({ project });
    (
      fake.client as unknown as { listProjectServices: (id: string) => Promise<ZeropsService[]> }
    ).listProjectServices = async () => {
      const result = services[servicesCall] ?? services.at(-1)!;
      servicesCall += 1;
      return [...result];
    };

    const storage = fakeStorage();
    await rememberEnvironmentProjectRef(storage, ENV, {
      projectId: "proj-1",
      orgId: "org-1",
      source: "connect",
    });

    const { options, sockets } = watcherOptions({ client: fake.client, storage });
    const watcher = new ProjectTopologyWatcher(options);
    const snapshots: unknown[] = [];
    const unsubscribe = watcher.subscribe(() => snapshots.push(watcher.getSnapshot()));

    await vi.advanceTimersByTimeAsync(0);
    expect(sockets).toHaveLength(1);
    await connectSocket(sockets[0]!);

    expect(watcher.getSnapshot().liveness).toBe("live");
    // Still index 0's data — "connected" only scheduled a debounced read.
    expect(watcher.getSnapshot().view?.services.map((s) => s.hostname)).toEqual(["api"]);
    expect(servicesCall).toBe(1);

    await vi.advanceTimersByTimeAsync(300);
    expect(servicesCall).toBe(2);
    expect(watcher.getSnapshot().view?.services.map((s) => s.hostname)).toEqual(["api"]);

    sockets[0]!.receive({ type: "search", subscriptionName: "ServiceStack__list-subscription" });
    // Debounced: not yet re-read immediately.
    await vi.advanceTimersByTimeAsync(100);
    expect(watcher.getSnapshot().view?.services.map((s) => s.hostname)).toEqual(["api"]);

    await vi.advanceTimersByTimeAsync(300);
    expect(watcher.getSnapshot().view?.services.map((s) => s.hostname)).toEqual(["api", "db"]);

    unsubscribe();
  });

  it("polls at 5s while transient and 30s when idle, only while disconnected", async () => {
    const project: ZeropsProject = { id: "proj-1", name: "z3-eval", status: "ACTIVE" };
    const fake = fakeClient({
      project,
      services: [service({ id: "s1", name: "api", status: "CREATING" })],
    });
    const storage = fakeStorage();
    await rememberEnvironmentProjectRef(storage, ENV, {
      projectId: "proj-1",
      orgId: "org-1",
      source: "connect",
    });

    const { options, sockets } = watcherOptions({ client: fake.client, storage });
    const watcher = new ProjectTopologyWatcher(options);
    const unsubscribe = watcher.subscribe(() => undefined);

    await vi.advanceTimersByTimeAsync(0);
    // Never connect the socket — stays "polling" throughout.
    expect(watcher.getSnapshot().liveness).toBe("polling");
    expect(fake.listProjectServicesCalls).toBe(1);
    expect(watcher.getSnapshot().view?.services[0]?.transient).toBe(true);

    // Transient: polls every 5s.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fake.listProjectServicesCalls).toBe(2);

    void sockets;
    unsubscribe();
  });

  it("polls every 30s once the view settles (no transient service) while disconnected", async () => {
    const project: ZeropsProject = { id: "proj-1", name: "z3-eval", status: "ACTIVE" };
    const fake = fakeClient({
      project,
      services: [service({ id: "s1", name: "api", status: "ACTIVE" })],
    });
    const storage = fakeStorage();
    await rememberEnvironmentProjectRef(storage, ENV, {
      projectId: "proj-1",
      orgId: "org-1",
      source: "connect",
    });

    const { options } = watcherOptions({ client: fake.client, storage });
    const watcher = new ProjectTopologyWatcher(options);
    const unsubscribe = watcher.subscribe(() => undefined);

    await vi.advanceTimersByTimeAsync(0);
    expect(fake.listProjectServicesCalls).toBe(1);

    // Idle: 5s alone is not enough.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fake.listProjectServicesCalls).toBe(1);

    await vi.advanceTimersByTimeAsync(25_000);
    expect(fake.listProjectServicesCalls).toBe(2);

    unsubscribe();
  });

  it("stops the disconnected poll once the socket connects", async () => {
    const project: ZeropsProject = { id: "proj-1", name: "z3-eval", status: "ACTIVE" };
    const fake = fakeClient({ project, services: [service({ id: "s1", name: "api" })] });
    const storage = fakeStorage();
    await rememberEnvironmentProjectRef(storage, ENV, {
      projectId: "proj-1",
      orgId: "org-1",
      source: "connect",
    });

    const { options, sockets } = watcherOptions({ client: fake.client, storage });
    const watcher = new ProjectTopologyWatcher(options);
    const unsubscribe = watcher.subscribe(() => undefined);

    await vi.advanceTimersByTimeAsync(0);
    await connectSocket(sockets[0]!);
    expect(watcher.getSnapshot().liveness).toBe("live");
    // Let the debounced read "connected" itself schedules settle first — it
    // is not part of what this test checks (only the disconnected-poll loop is).
    await vi.advanceTimersByTimeAsync(300);
    const callsAtConnect = fake.listProjectServicesCalls;

    // No further reads from the disconnected-poll loop once live — answer every
    // ping so the socket itself does not die of its own 8s pong timeout across
    // this stretch (a live-connection detail unrelated to what this test checks).
    for (let cycle = 0; cycle < 4; cycle += 1) {
      sockets[0]!.receive({ type: "pong" });
      await vi.advanceTimersByTimeAsync(15_000);
    }
    expect(watcher.getSnapshot().liveness).toBe("live");
    expect(fake.listProjectServicesCalls).toBe(callsAtConnect);

    unsubscribe();
  });

  it("runs the origin match once and never again for the same environment", async () => {
    // A project whose zcp container's computed origin is exactly the environment's
    // displayUrl below: buildZeropsContainerUrl("zcp", "showcase", 8080, "prg1").
    const project: ZeropsProject = {
      id: "matched-proj",
      name: "matched",
      status: "ACTIVE",
      publicZone: "fte.prg1-zerops.zone",
      zeropsSubdomainHost: "showcase",
    };
    const zcpService = service({
      id: "zcp-svc",
      name: "zcp",
      status: "ACTIVE",
      subdomainAccess: true,
      ports: [{ port: 8080, scheme: "http" }],
      serviceStackTypeInfo: { serviceStackTypeVersionName: "zcp@1" },
    });
    const displayUrl = "https://zcp-showcase-8080.prg1.zerops.app";

    const fake = fakeClient({
      organizations: [{ id: "org-1", name: "Org", membershipId: "cu-1" }],
      projectsByOrg: { "org-1": [project] },
      servicesByProject: { "matched-proj": [zcpService] },
    });
    const storage = fakeStorage();

    const { options: optionsA, sockets: socketsA } = watcherOptions({
      client: fake.client,
      storage,
      displayUrl,
    });
    const watcherA = new ProjectTopologyWatcher(optionsA);
    const { options: optionsB } = watcherOptions({ client: fake.client, storage, displayUrl });
    const watcherB = new ProjectTopologyWatcher(optionsB);

    // Two subscribers resolve the same environment concurrently.
    const unsubA = watcherA.subscribe(() => undefined);
    const unsubB = watcherB.subscribe(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);

    expect(fake.fetchOrganizationsCalls).toBe(1);
    expect(fake.loadCandidatesOrgCalls).toEqual(["org-1"]);
    expect(watcherA.getSnapshot().view?.project.id).toBe("matched-proj");
    expect(socketsA).toHaveLength(1);

    unsubA();
    unsubB();

    // A third, later watcher for the same environment finds the remembered ref
    // and never re-runs the match at all.
    const { options: optionsC } = watcherOptions({ client: fake.client, storage, displayUrl });
    const watcherC = new ProjectTopologyWatcher(optionsC);
    const unsubC = watcherC.subscribe(() => undefined);
    await vi.advanceTimersByTimeAsync(0);

    expect(fake.fetchOrganizationsCalls).toBe(1);
    expect(fake.loadCandidatesOrgCalls).toEqual(["org-1"]);
    expect(watcherC.getSnapshot().view?.project.id).toBe("matched-proj");

    unsubC();
  });

  it("does not retry a missed origin match on the same instance, but a fresh instance does", async () => {
    // A displayUrl that matches no candidate origin in the fixture below —
    // the match runs, finds nothing, and must not run again for this instance.
    const project: ZeropsProject = {
      id: "matched-proj",
      name: "matched",
      status: "ACTIVE",
      publicZone: "fte.prg1-zerops.zone",
      zeropsSubdomainHost: "showcase",
    };
    const zcpService = service({
      id: "zcp-svc",
      name: "zcp",
      status: "ACTIVE",
      subdomainAccess: true,
      ports: [{ port: 8080, scheme: "http" }],
      serviceStackTypeInfo: { serviceStackTypeVersionName: "zcp@1" },
    });
    const displayUrl = "https://never-matches.example.com";
    const missEnv = "env-miss" as EnvironmentId;

    const fake = fakeClient({
      organizations: [{ id: "org-1", name: "Org", membershipId: "cu-1" }],
      projectsByOrg: { "org-1": [project] },
      servicesByProject: { "matched-proj": [zcpService] },
    });
    const storage = fakeStorage();

    const { options: optionsA } = watcherOptions({
      client: fake.client,
      storage,
      displayUrl,
      environmentId: missEnv,
    });
    const watcherA = new ProjectTopologyWatcher(optionsA);
    const unsubA = watcherA.subscribe(() => undefined);
    await vi.advanceTimersByTimeAsync(0);

    expect(fake.fetchOrganizationsCalls).toBe(1);
    expect(watcherA.getSnapshot().view).toBeUndefined();
    unsubA();

    // Resubscribing the SAME instance must not re-run the match.
    const unsubA2 = watcherA.subscribe(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.fetchOrganizationsCalls).toBe(1);
    unsubA2();

    // A fresh instance for the same environment (the retry point: the
    // watcher is rebuilt on client change) runs the match again.
    const { options: optionsB } = watcherOptions({
      client: fake.client,
      storage,
      displayUrl,
      environmentId: missEnv,
    });
    const watcherB = new ProjectTopologyWatcher(optionsB);
    const unsubB = watcherB.subscribe(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.fetchOrganizationsCalls).toBe(2);

    unsubB();
  });

  it("a resubscribed watcher starts as polling and reads even when the socket never connects", async () => {
    const project: ZeropsProject = { id: "proj-1", name: "z3-eval", status: "ACTIVE" };
    const fake = fakeClient({ project, services: [service({ id: "s1", name: "api" })] });
    const storage = fakeStorage();
    await rememberEnvironmentProjectRef(storage, ENV, {
      projectId: "proj-1",
      orgId: "org-1",
      source: "connect",
    });

    const { options, sockets } = watcherOptions({ client: fake.client, storage });
    const watcher = new ProjectTopologyWatcher(options);

    // First span: connect and go live.
    const unsubscribe1 = watcher.subscribe(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    await connectSocket(sockets[0]!);
    expect(watcher.getSnapshot().liveness).toBe("live");
    unsubscribe1();

    // Second span: a fresh socket for this span is never driven to "open" —
    // it never connects.
    const unsubscribe2 = watcher.subscribe(() => undefined);
    await vi.advanceTimersByTimeAsync(0);

    // Liveness must not still read the stale "live" left over from the first span.
    expect(watcher.getSnapshot().liveness).toBe("polling");
    expect(sockets).toHaveLength(2);

    // The disconnected poll loop must actually be running — gated on liveness
    // !== "live" — so it must not have gotten stuck thinking it is still live.
    const callsAfterMountRead = fake.listProjectServicesCalls;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fake.listProjectServicesCalls).toBeGreaterThan(callsAfterMountRead);

    unsubscribe2();
  });

  it("a failed project read is retried on the next read", async () => {
    const project: ZeropsProject = { id: "proj-1", name: "z3-eval", status: "ACTIVE" };
    let fetchProjectCalls = 0;
    const fake = fakeClient({ project, services: [service({ id: "s1", name: "api" })] });
    (
      fake.client as unknown as { fetchProject: (id: string) => Promise<ZeropsProject> }
    ).fetchProject = async () => {
      fetchProjectCalls += 1;
      if (fetchProjectCalls === 1) throw new Error("network blip");
      return project;
    };

    const storage = fakeStorage();
    await rememberEnvironmentProjectRef(storage, ENV, {
      projectId: "proj-1",
      orgId: "org-1",
      source: "connect",
    });

    const { options } = watcherOptions({ client: fake.client, storage });
    const watcher = new ProjectTopologyWatcher(options);
    const unsubscribe = watcher.subscribe(() => undefined);

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchProjectCalls).toBe(1);
    // The failed fetch is never cached as a placeholder project — no view yet,
    // and no `listProjectServices` call was ever made for it.
    expect(watcher.getSnapshot().view).toBeUndefined();
    expect(watcher.getSnapshot().error).toBeDefined();
    expect(fake.listProjectServicesCalls).toBe(0);

    // The idle disconnected-poll loop drives the next `#readNow`, which
    // retries `fetchProject` because `#project` is still undefined.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchProjectCalls).toBe(2);
    expect(watcher.getSnapshot().view?.project.id).toBe("proj-1");
    expect(watcher.getSnapshot().error).toBeUndefined();

    unsubscribe();
  });

  it("forgets the ref and clears it on a 403/404 project read, so a later start re-matches", async () => {
    const project: ZeropsProject = { id: "proj-1", name: "z3-eval", status: "ACTIVE" };
    const fake = fakeClient({ project, services: [service({ id: "s1", name: "api" })] });
    (
      fake.client as unknown as { fetchProject: (id: string) => Promise<ZeropsProject> }
    ).fetchProject = async () => {
      throw new ZeropsApiError("Project not found.", "not-found", 404);
    };

    const storage = fakeStorage();
    await rememberEnvironmentProjectRef(storage, ENV, {
      projectId: "proj-1",
      orgId: "org-1",
      source: "connect",
    });

    const { options } = watcherOptions({ client: fake.client, storage });
    const watcher = new ProjectTopologyWatcher(options);
    const unsubscribe = watcher.subscribe(() => undefined);

    await vi.advanceTimersByTimeAsync(0);
    expect(await lookupEnvironmentProjectRef(storage, ENV)).toBeUndefined();

    unsubscribe();
  });

  it("closes the live socket after 60s hidden and reopens once visible again", async () => {
    const project: ZeropsProject = { id: "proj-1", name: "z3-eval", status: "ACTIVE" };
    const fake = fakeClient({ project, services: [service({ id: "s1", name: "api" })] });
    const storage = fakeStorage();
    await rememberEnvironmentProjectRef(storage, ENV, {
      projectId: "proj-1",
      orgId: "org-1",
      source: "connect",
    });

    let hidden = false;
    let visibilityCallback: (() => void) | undefined;
    const { options, sockets } = watcherOptions({
      client: fake.client,
      storage,
      isHidden: () => hidden,
      onVisibilityChange: (callback) => {
        visibilityCallback = callback;
        return () => {
          visibilityCallback = undefined;
        };
      },
    });
    const watcher = new ProjectTopologyWatcher(options);
    const unsubscribe = watcher.subscribe(() => undefined);

    await vi.advanceTimersByTimeAsync(0);
    await connectSocket(sockets[0]!);
    expect(watcher.getSnapshot().liveness).toBe("live");

    hidden = true;
    visibilityCallback?.();

    // Keep answering pings every 5s so the socket does not die of its own 8s
    // pong timeout while we wait out the 60s hidden-close window — a
    // live-connection detail unrelated to what this test checks.
    for (let step = 0; step < 11; step += 1) {
      sockets[0]!.receive({ type: "pong" });
      await vi.advanceTimersByTimeAsync(5_000);
    }
    // 55s elapsed: still under the 60s hidden-close timeout.
    expect(watcher.getSnapshot().liveness).toBe("live");

    sockets[0]!.receive({ type: "pong" });
    await vi.advanceTimersByTimeAsync(5_000);
    // 60s elapsed: the hidden-close timeout has now fired.
    expect(watcher.getSnapshot().liveness).toBe("polling");
    expect(sockets).toHaveLength(1);

    hidden = false;
    visibilityCallback?.();
    await vi.advanceTimersByTimeAsync(0);
    // A new socket is opened for the reconnect.
    expect(sockets).toHaveLength(2);

    unsubscribe();
  });

  it("does not close the socket if the tab comes back visible before the 60s hidden timeout", async () => {
    const project: ZeropsProject = { id: "proj-1", name: "z3-eval", status: "ACTIVE" };
    const fake = fakeClient({ project, services: [service({ id: "s1", name: "api" })] });
    const storage = fakeStorage();
    await rememberEnvironmentProjectRef(storage, ENV, {
      projectId: "proj-1",
      orgId: "org-1",
      source: "connect",
    });

    let hidden = false;
    let visibilityCallback: (() => void) | undefined;
    const { options, sockets } = watcherOptions({
      client: fake.client,
      storage,
      isHidden: () => hidden,
      onVisibilityChange: (callback) => {
        visibilityCallback = callback;
        return () => {
          visibilityCallback = undefined;
        };
      },
    });
    const watcher = new ProjectTopologyWatcher(options);
    const unsubscribe = watcher.subscribe(() => undefined);

    await vi.advanceTimersByTimeAsync(0);
    await connectSocket(sockets[0]!);

    hidden = true;
    visibilityCallback?.();
    for (let step = 0; step < 6; step += 1) {
      sockets[0]!.receive({ type: "pong" });
      await vi.advanceTimersByTimeAsync(5_000);
    }

    hidden = false;
    visibilityCallback?.();

    // A further 60s, well past where the (now-cancelled) hidden-close
    // timeout would have fired — again keeping the socket alive via pongs.
    for (let step = 0; step < 12; step += 1) {
      sockets[0]!.receive({ type: "pong" });
      await vi.advanceTimersByTimeAsync(5_000);
    }

    // The socket from before never got closed — liveness never dropped, and
    // no second socket was ever opened.
    expect(watcher.getSnapshot().liveness).toBe("live");
    expect(sockets).toHaveLength(1);

    unsubscribe();
  });

  it("only the latest overlapping read publishes (an earlier one resolving late is discarded)", async () => {
    const project: ZeropsProject = { id: "proj-1", name: "z3-eval", status: "ACTIVE" };
    const fake = fakeClient({ project });
    let resolveFirst: ((services: ZeropsService[]) => void) | undefined;
    let call = 0;
    (
      fake.client as unknown as { listProjectServices: (id: string) => Promise<ZeropsService[]> }
    ).listProjectServices = async () => {
      call += 1;
      if (call === 1) {
        return new Promise((resolve) => {
          resolveFirst = resolve;
        });
      }
      return [service({ id: "s2", name: "db" })];
    };

    const storage = fakeStorage();
    await rememberEnvironmentProjectRef(storage, ENV, {
      projectId: "proj-1",
      orgId: "org-1",
      source: "connect",
    });

    const { options, sockets } = watcherOptions({ client: fake.client, storage });
    const watcher = new ProjectTopologyWatcher(options);
    const unsubscribe = watcher.subscribe(() => undefined);

    // Mount read (call 1) is now in flight and will not resolve until we say so.
    await vi.advanceTimersByTimeAsync(0);
    expect(call).toBe(1);

    // Connecting the socket (independent of the still-pending mount read)
    // schedules a second, debounced read.
    await connectSocket(sockets[0]!);
    await vi.advanceTimersByTimeAsync(300);
    expect(call).toBe(2);
    expect(watcher.getSnapshot().view?.services.map((s) => s.hostname)).toEqual(["db"]);

    // The stale first read finally resolves — it must be discarded, not
    // allowed to overwrite the second (later, already-published) read.
    resolveFirst?.([service({ id: "s1", name: "api" })]);
    await vi.advanceTimersByTimeAsync(0);
    expect(watcher.getSnapshot().view?.services.map((s) => s.hostname)).toEqual(["db"]);

    unsubscribe();
  });
  it("reads a service's live allocation with the topology and again every 30s while visible", async () => {
    const project: ZeropsProject = {
      id: "proj-1",
      name: "z3-eval",
      status: "ACTIVE",
      clientId: "client-1",
    };
    const fake = fakeClient({
      project,
      services: [service({ id: "s1", name: "api" })],
      usage: [
        {
          serviceStackId: "s1",
          containerId: "c1",
          vCpu: { used: 0.1, limit: 1 },
          ramGBytes: { used: 0.2, limit: 0.5 },
          diskGBytes: { used: 0.3, limit: 1 },
        },
      ],
      history: [
        {
          from: "2026-09-06T00:00:00+02:00",
          till: "2026-09-06T00:59:59+02:00",
          serviceStackId: "s1",
          containerCount: 1,
          vCpuLimit: 1,
          vCpuUsed: 0.1,
          ramLimit: 0.5,
          ramUsed: 0.2,
          diskLimit: 1,
          diskUsed: 0.3,
        },
      ],
    });
    const storage = fakeStorage();
    await rememberEnvironmentProjectRef(storage, ENV, {
      projectId: "proj-1",
      orgId: "org-1",
      source: "connect",
    });
    let hidden = false;
    const { options, sockets } = watcherOptions({
      client: fake.client,
      storage,
      isHidden: () => hidden,
      timeZone: () => "Europe/Prague",
    });
    const watcher = new ProjectTopologyWatcher(options);
    const unsubscribe = watcher.subscribe(() => undefined);

    await vi.advanceTimersByTimeAsync(0);
    expect(fake.searchCurrentStatsCalls).toEqual([{ clientId: "client-1", projectId: "proj-1" }]);
    // The history rides along: the dashboard's own last-24-hours window, in the given zone.
    expect(fake.searchStatsHistoryCalls).toEqual([
      { timeGroupBy: "1h", limit: 24, timeZone: "Europe/Prague" },
    ]);
    expect(watcher.getSnapshot().view?.services[0]?.history).toEqual([
      {
        at: "2026-09-06T00:00:00+02:00",
        containers: 1,
        cores: { used: 0.1, limit: 1 },
        memoryGb: { used: 0.2, limit: 0.5 },
        diskGb: { used: 0.3, limit: 1 },
      },
    ]);
    expect(watcher.getSnapshot().view?.usageRead).toBe(true);
    expect(watcher.getSnapshot().view?.services[0]?.usage).toEqual({
      containers: 1,
      cores: { used: 0.1, limit: 1 },
      memoryGb: { used: 0.2, limit: 0.5 },
      diskGb: { used: 0.3, limit: 1 },
    });

    // Live socket: the topology is not re-read, the usage still is.
    await connectSocket(sockets[0]!);
    await vi.advanceTimersByTimeAsync(300);
    const topologyReads = fake.listProjectServicesCalls;
    const usageReads = fake.searchCurrentStatsCalls.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fake.listProjectServicesCalls).toBe(topologyReads);
    expect(fake.searchCurrentStatsCalls.length).toBe(usageReads + 1);

    // Hidden: the clock keeps ticking but nothing is read.
    hidden = true;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fake.searchCurrentStatsCalls.length).toBe(usageReads + 1);

    unsubscribe();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fake.searchCurrentStatsCalls.length).toBe(usageReads + 1);
  });

  it("leaves usage unknown without a client id, and a failed read never fails the topology", async () => {
    const storage = fakeStorage();
    await rememberEnvironmentProjectRef(storage, ENV, {
      projectId: "proj-1",
      orgId: "org-1",
      source: "connect",
    });

    const withoutClient = fakeClient({
      project: { id: "proj-1", name: "z3-eval", status: "ACTIVE" },
      services: [service({ id: "s1", name: "api" })],
    });
    const first = new ProjectTopologyWatcher(
      watcherOptions({ client: withoutClient.client, storage }).options,
    );
    const stopFirst = first.subscribe(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(withoutClient.searchCurrentStatsCalls).toEqual([]);
    expect(first.getSnapshot().view?.usageRead).toBe(false);
    stopFirst();

    const failing = fakeClient({
      project: { id: "proj-1", name: "z3-eval", status: "ACTIVE", clientId: "client-1" },
      services: [service({ id: "s1", name: "api" })],
      usage: () => {
        throw new Error("stats down");
      },
      history: () => {
        throw new Error("history down");
      },
    });
    const second = new ProjectTopologyWatcher(
      watcherOptions({ client: failing.client, storage }).options,
    );
    const stopSecond = second.subscribe(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(failing.searchCurrentStatsCalls).toHaveLength(1);
    expect(second.getSnapshot().view?.services).toHaveLength(1);
    expect(second.getSnapshot().error).toBeUndefined();
    expect(second.getSnapshot().view?.usageRead).toBe(false);
    stopSecond();
  });
});
