import { ZeropsApiClient, type ZeropsProject, type ZeropsService } from "./api.ts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  PROVISIONING_CAPS,
  advanceProvisioning,
  readProvisioning,
  startProvisioning,
  type ProvisioningState,
} from "./provisioning.ts";

const CLIENT_ID = "org-1";

const PROJECT: ZeropsProject = {
  id: "project-1",
  name: "my-project",
  status: "ACTIVE",
  clientId: CLIENT_ID,
  publicZone: "abc.prg1-zerops.zone",
  zeropsSubdomainHost: "24cb",
};

function container(overrides: Partial<ZeropsService> = {}): ZeropsService {
  return {
    id: "service-1",
    name: "zcp",
    status: "ACTIVE",
    subdomainAccess: true,
    ports: [{ port: 8080, httpSupport: true }],
    serviceStackTypeInfo: { serviceStackTypeVersionName: "zcp@1" },
    ...overrides,
  };
}

/** Walks the happy path so individual tests can start from any phase. */
function reachAwaitingContainer(nowMs = 0): ProvisioningState {
  return advanceProvisioning(
    startProvisioning({ zcpClaimed: true, nowMs }),
    { kind: "projects", projects: [PROJECT] },
    nowMs,
  );
}

describe("provisioning state machine", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("accepts the clock explicitly", () => {
    vi.spyOn(Date, "now").mockImplementation(() => {
      throw new Error("Date.now must not be used");
    });

    const state = startProvisioning({ zcpClaimed: true, nowMs: 100 });
    const advanced = advanceProvisioning(state, { kind: "projects", projects: [PROJECT] }, 200);

    expect(advanced.phase).toBe("awaiting-container");
    expect(advanced.phaseStartedAtMs).toBe(200);
  });

  it("every waiting state says what it waits for and how long it will wait", () => {
    const awaitingProject = startProvisioning({ zcpClaimed: true, nowMs: 0 });
    expect(awaitingProject.phase).toBe("awaiting-project");
    expect(awaitingProject.waitingFor).toBeTruthy();
    expect(awaitingProject.capMs).toBe(PROVISIONING_CAPS["awaiting-project"]);

    const awaitingContainer = reachAwaitingContainer();
    expect(awaitingContainer.phase).toBe("awaiting-container");
    expect(awaitingContainer.waitingFor).toBeTruthy();
    expect(awaitingContainer.capMs).toBe(PROVISIONING_CAPS["awaiting-container"]);
    expect(awaitingContainer.projectId).toBe("project-1");

    const awaitingHealth = advanceProvisioning(
      awaitingContainer,
      { kind: "services", project: PROJECT, services: [container()] },
      1000,
    );
    expect(awaitingHealth.phase).toBe("awaiting-health");
    expect(awaitingHealth.waitingFor).toBeTruthy();
    expect(awaitingHealth.capMs).toBe(PROVISIONING_CAPS["awaiting-health"]);
    expect(awaitingHealth.containerOrigin).toBe("https://zcp-24cb-8080.prg1.zerops.app");
  });

  it("an exhausted pool is a state of its own, not a failure", () => {
    const state = startProvisioning({ zcpClaimed: false, nowMs: 0 });
    expect(state.phase).toBe("pool-exhausted");
    expect(state.capMs).toBeNull();
  });

  it("treats a missing zcpClaimed the way the platform means it — claimed", () => {
    expect(startProvisioning({ nowMs: 0 }).phase).toBe("awaiting-project");
  });

  it("never concludes 'no container' from one read of a fresh project", () => {
    // The project row appears before its services do; an empty list is a
    // reason to keep waiting, never a verdict.
    const empty = advanceProvisioning(
      reachAwaitingContainer(),
      { kind: "services", project: { ...PROJECT, status: "CREATING" }, services: [] },
      2000,
    );
    expect(empty.phase).toBe("awaiting-container");

    const stillCreating = advanceProvisioning(
      empty,
      { kind: "services", project: PROJECT, services: [container({ status: "CREATING" })] },
      4000,
    );
    expect(stillCreating.phase).toBe("awaiting-container");
    expect(stillCreating.waitingFor).toBeTruthy();

    const ready = advanceProvisioning(
      stillCreating,
      { kind: "services", project: PROJECT, services: [container()] },
      6000,
    );
    expect(ready.phase).toBe("awaiting-health");
  });

  it("keeps waiting while the container reports itself as initializing", () => {
    const awaitingHealth = advanceProvisioning(
      reachAwaitingContainer(),
      { kind: "services", project: PROJECT, services: [container()] },
      1000,
    );

    const still = advanceProvisioning(
      awaitingHealth,
      { kind: "health", health: "initializing" },
      3000,
    );
    expect(still.phase).toBe("awaiting-health");

    const ready = advanceProvisioning(still, { kind: "health", health: "ready" }, 5000);
    expect(ready.phase).toBe("ready");
    expect(ready.capMs).toBeNull();
  });

  it("routes a container that predates Zerops Mate to its own state, not to a timeout", () => {
    const awaitingHealth = advanceProvisioning(
      reachAwaitingContainer(),
      { kind: "services", project: PROJECT, services: [container()] },
      1000,
    );

    const stale = advanceProvisioning(
      awaitingHealth,
      { kind: "health", health: "predates-mate" },
      2000,
    );
    expect(stale.phase).toBe("needs-enable");
    expect(stale.containerServiceId).toBe("service-1");
  });

  it("turns a cap expiry into a retryable state, never an error", () => {
    const state = reachAwaitingContainer(0);

    const beforeCap = advanceProvisioning(
      state,
      { kind: "tick" },
      PROVISIONING_CAPS["awaiting-container"] - 1,
    );
    expect(beforeCap.phase).toBe("awaiting-container");

    const expired = advanceProvisioning(
      state,
      { kind: "tick" },
      PROVISIONING_CAPS["awaiting-container"] + 1,
    );
    expect(expired.phase).toBe("timed-out");
    expect(expired.expiredPhase).toBe("awaiting-container");
    // It still says what it had been waiting for, so the panel can explain.
    expect(expired.waitingFor).toBe(state.waitingFor);

    const retried = advanceProvisioning(expired, { kind: "retry" }, 999_999);
    expect(retried.phase).toBe("awaiting-container");
    expect(retried.phaseStartedAtMs).toBe(999_999);
    expect(advanceProvisioning(retried, { kind: "tick" }, 1_000_000).phase).toBe(
      "awaiting-container",
    );
  });

  it("measures each cap from the moment its phase started, not from the beginning", () => {
    const late = advanceProvisioning(
      startProvisioning({ zcpClaimed: true, nowMs: 0 }),
      { kind: "projects", projects: [PROJECT] },
      PROVISIONING_CAPS["awaiting-project"] - 1000,
    );
    expect(
      advanceProvisioning(late, { kind: "tick" }, PROVISIONING_CAPS["awaiting-project"] + 1000)
        .phase,
    ).toBe("awaiting-container");
  });

  it("follows the newest project, which is the one a claim just handed over", () => {
    const older: ZeropsProject = { ...PROJECT, id: "old", created: "2020-01-01T00:00:00Z" };
    const newer: ZeropsProject = { ...PROJECT, id: "new", created: "2026-08-28T00:00:00Z" };

    const state = advanceProvisioning(
      startProvisioning({ zcpClaimed: true, nowMs: 0 }),
      { kind: "projects", projects: [older, newer] },
      100,
    );

    expect(state.projectId).toBe("new");
  });
});

describe("readProvisioning", () => {
  function spyClient(handler: (url: string) => unknown) {
    const urls: string[] = [];
    const client = new ZeropsApiClient({
      fetch: (input) => {
        urls.push(input);
        return Promise.resolve(
          new Response(JSON.stringify(handler(input)), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      },
    });
    client.restoreSession({ accessToken: "access-1" });
    return { client, urls };
  }

  const probeNeverCalled = () => {
    throw new Error("the health probe must not run before a container origin exists");
  };

  it("reads projects through the direct read, never the search index", async () => {
    const { client, urls } = spyClient(() => ({ list: [PROJECT], totalCount: 1 }));

    const event = await readProvisioning({
      client,
      clientId: CLIENT_ID,
      state: startProvisioning({ zcpClaimed: true, nowMs: 0 }),
      probeHealth: probeNeverCalled,
    });

    expect(event).toEqual({ kind: "projects", projects: [PROJECT] });
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain(`/client/${CLIENT_ID}/project`);
    expect(urls.every((url) => !url.includes("/search"))).toBe(true);
  });

  it("re-reads the project itself alongside its services, so a CREATING project is seen turning ACTIVE", async () => {
    const { client, urls } = spyClient((url) =>
      url.includes("/service-stack") ? { list: [container()], totalCount: 1 } : PROJECT,
    );

    const event = await readProvisioning({
      client,
      clientId: CLIENT_ID,
      state: reachAwaitingContainer(),
      probeHealth: probeNeverCalled,
    });

    expect(event.kind).toBe("services");
    expect(urls.some((url) => url.endsWith("/project/project-1"))).toBe(true);
    expect(urls.some((url) => url.endsWith("/project/project-1/service-stack"))).toBe(true);
    expect(urls.every((url) => !url.includes("/search"))).toBe(true);
  });

  it("probes the container origin once one is known, and calls no API for it", async () => {
    const { client, urls } = spyClient(() => ({}));
    const probed: string[] = [];

    const awaitingHealth = advanceProvisioning(
      reachAwaitingContainer(),
      { kind: "services", project: PROJECT, services: [container()] },
      1000,
    );

    const event = await readProvisioning({
      client,
      clientId: CLIENT_ID,
      state: awaitingHealth,
      probeHealth: (origin) => {
        probed.push(origin);
        return Promise.resolve("initializing" as const);
      },
    });

    expect(event).toEqual({ kind: "health", health: "initializing" });
    expect(probed).toEqual(["https://zcp-24cb-8080.prg1.zerops.app"]);
    expect(urls).toHaveLength(0);
  });

  it("issues no read at all in a settled state", async () => {
    const { client, urls } = spyClient(() => ({}));

    const event = await readProvisioning({
      client,
      clientId: CLIENT_ID,
      state: startProvisioning({ zcpClaimed: false, nowMs: 0 }),
      probeHealth: probeNeverCalled,
    });

    expect(event).toEqual({ kind: "tick" });
    expect(urls).toHaveLength(0);
  });
});

describe("enabling Zerops Mate on an older container", () => {
  function reachNeedsEnable(): ProvisioningState {
    return advanceProvisioning(
      advanceProvisioning(
        reachAwaitingContainer(),
        { kind: "services", project: PROJECT, services: [container()] },
        1000,
      ),
      { kind: "health", health: "predates-mate" },
      2000,
    );
  }

  it("goes back to waiting for health, with the clock restarted", () => {
    const restarted = advanceProvisioning(reachNeedsEnable(), { kind: "enable" }, 50_000);

    expect(restarted.phase).toBe("awaiting-health");
    expect(restarted.phaseStartedAtMs).toBe(50_000);
    expect(restarted.capMs).toBe(PROVISIONING_CAPS["awaiting-health"]);
    // The container it is enabling must survive the transition.
    expect(restarted.containerServiceId).toBe("service-1");
    expect(restarted.containerOrigin).toBe("https://zcp-24cb-8080.prg1.zerops.app");
  });

  it("reads the balancer's 502 window as restarting rather than as failure", () => {
    const restarting = advanceProvisioning(
      advanceProvisioning(reachNeedsEnable(), { kind: "enable" }, 0),
      { kind: "health", health: "unreachable" },
      6000,
    );

    expect(restarting.phase).toBe("awaiting-health");
    expect(restarting.detail).toMatch(/restarting/i);
  });

  it("ignores an enable from anywhere else", () => {
    const waiting = reachAwaitingContainer();
    expect(advanceProvisioning(waiting, { kind: "enable" }, 10_000)).toBe(waiting);
  });

  it("marks the state enabled once the user has asked for the restart", () => {
    expect(reachNeedsEnable().enabled).toBe(false);
    expect(advanceProvisioning(reachNeedsEnable(), { kind: "enable" }, 50_000).enabled).toBe(true);
  });

  it("stops offering Enable when the restarted container still predates Zerops Mate", () => {
    const enabled = advanceProvisioning(reachNeedsEnable(), { kind: "enable" }, 50_000);
    const stillOld = advanceProvisioning(
      enabled,
      { kind: "health", health: "predates-mate" },
      60_000,
    );

    expect(stillOld.phase).toBe("not-yet-available");
    expect(stillOld.capMs).toBeNull();
    // The container it was about is still known, for the copy and any links.
    expect(stillOld.containerServiceId).toBe("service-1");
  });

  it("also lands on not-yet-available when the post-enable health wait times out", () => {
    const enabled = advanceProvisioning(reachNeedsEnable(), { kind: "enable" }, 0);
    const expired = advanceProvisioning(
      enabled,
      { kind: "tick" },
      PROVISIONING_CAPS["awaiting-health"] + 1,
    );

    expect(expired.phase).toBe("timed-out");
    expect(expired.expiredPhase).toBe("awaiting-health");
    expect(expired.enabled).toBe(true);
  });
});
