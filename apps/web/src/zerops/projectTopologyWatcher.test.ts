// @effect-diagnostics globalTimers:off -- the fake `setTimeout`/`clearTimeout` pair below is the plain
// timer implementation the real (browser) caller injects; `vi.useFakeTimers()` fakes it.
import type { ZeropsApiClient, ZeropsProject, ZeropsService } from "@t3tools/client-runtime/zerops";
import type { PlatformWatchSocket } from "@t3tools/client-runtime/zerops/platformWatch";
import type { ZeropsStorageAdapter } from "@t3tools/client-runtime/zerops/session";
import type { EnvironmentId } from "@t3tools/contracts";
import { rememberEnvironmentProjectRef } from "@t3tools/client-runtime/zerops/environmentProjectRef";
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
}

function fakeClient(options: FakeClientOptions = {}): {
  readonly client: ZeropsApiClient;
  readonly listProjectServicesCalls: number;
  readonly fetchOrganizationsCalls: number;
  readonly loadCandidatesOrgCalls: string[];
} {
  const state = {
    listProjectServicesCalls: 0,
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
    // Index 0: read at subscribe (before the socket connects). Index 1: read again
    // once "connected" fires. Index 2: the `changed`-driven re-read under test.
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
});
