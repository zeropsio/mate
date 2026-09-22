import type { ZeropsProject, ZeropsService } from "./api.ts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  PROVISIONING_CAPS,
  advanceProvisioning,
  readProvisioning,
  startProvisioning,
  startProvisioningForProject,
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

/** A container that exists and answers, but has not yet been through hardening. */
function reachAwaitingSettled(nowMs = 0): ProvisioningState {
  return advanceProvisioning(
    reachAwaitingContainer(nowMs),
    { kind: "services", project: PROJECT, services: [container()] },
    nowMs,
  );
}

/** The container's own boot process reported itself finished. */
function reachHardening(nowMs = 0): ProvisioningState {
  return advanceProvisioning(
    reachAwaitingSettled(nowMs),
    { kind: "process", running: false, observed: true },
    nowMs,
  );
}

/** The harden step ran and the wait moved on to the ordinary health wait. */
function reachAwaitingHealth(
  nowMs = 0,
  input: { readonly restarted?: boolean } = {},
): ProvisioningState {
  return advanceProvisioning(
    reachHardening(nowMs),
    { kind: "hardened", restarted: input.restarted ?? true, atMs: nowMs },
    nowMs,
  );
}

describe("provisioning state machine", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts at the container wait for a project it was handed", () => {
    // Environment creation knows the project id the moment the platform
    // answers; following "the newest project" would be guessing at it.
    const state = startProvisioningForProject({ projectId: "proj-new", nowMs: 5 });
    expect(state.phase).toBe("awaiting-container");
    expect(state.projectId).toBe("proj-new");
    expect(state.phaseStartedAtMs).toBe(5);
    expect(state.capMs).toBe(PROVISIONING_CAPS["awaiting-container"]);
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

    const awaitingSettled = advanceProvisioning(
      awaitingContainer,
      { kind: "services", project: PROJECT, services: [container()] },
      1000,
    );
    expect(awaitingSettled.phase).toBe("awaiting-settled");
    expect(awaitingSettled.waitingFor).toBeTruthy();
    expect(awaitingSettled.capMs).toBeNull();
    expect(awaitingSettled.containerOrigin).toBe("https://zcp-24cb-8080.prg1.zerops.app");

    const hardening = advanceProvisioning(
      awaitingSettled,
      { kind: "process", running: false, observed: true },
      2000,
    );
    expect(hardening.phase).toBe("hardening");
    expect(hardening.waitingFor).toBeTruthy();
    expect(hardening.capMs).toBeNull();

    const awaitingHealth = advanceProvisioning(
      hardening,
      { kind: "hardened", restarted: true, atMs: 2000 },
      3000,
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
    expect(ready.phase).toBe("awaiting-settled");
  });

  it("keeps waiting while the container reports itself as initializing", () => {
    const awaitingHealth = reachAwaitingHealth();

    const still = advanceProvisioning(
      awaitingHealth,
      { kind: "health", health: "initializing" },
      3000,
    );
    expect(still.phase).toBe("awaiting-health");

    const ready = advanceProvisioning(
      still,
      { kind: "health", health: "ready", initAt: "1970-01-01T00:00:00.001Z" },
      5000,
    );
    expect(ready.phase).toBe("ready");
    expect(ready.capMs).toBeNull();
  });

  it("routes a container that predates Zerops Mate to its own state, not to a timeout", () => {
    const awaitingHealth = reachAwaitingHealth();

    const stale = advanceProvisioning(
      awaitingHealth,
      { kind: "health", health: "predates-mate" },
      2000,
    );
    expect(stale.phase).toBe("needs-enable");
    expect(stale.containerServiceId).toBe("service-1");
  });

  it("turns a cap expiry into overdue words, never a stop (B-2)", () => {
    const state = reachAwaitingContainer(0);

    const beforeCap = advanceProvisioning(
      state,
      { kind: "tick" },
      PROVISIONING_CAPS["awaiting-container"] - 1,
    );
    expect(beforeCap.phase).toBe("awaiting-container");
    expect(beforeCap.overdue).toBe(false);

    const expired = advanceProvisioning(
      state,
      { kind: "tick" },
      PROVISIONING_CAPS["awaiting-container"] + 1,
    );
    // The wait stays in its phase — it never stops, and a missed push still
    // resumes it — only `overdue` says the cap ran out.
    expect(expired.phase).toBe("awaiting-container");
    expect(expired.overdue).toBe(true);
    // It still says what it had been waiting for, so the panel can explain.
    expect(expired.waitingFor).toBe(state.waitingFor);

    const retried = advanceProvisioning(expired, { kind: "retry" }, 999_999);
    expect(retried.phase).toBe("awaiting-container");
    expect(retried.overdue).toBe(false);
    expect(retried.phaseStartedAtMs).toBe(999_999);
    expect(advanceProvisioning(retried, { kind: "tick" }, 1_000_000).phase).toBe(
      "awaiting-container",
    );
  });

  it("an overdue wait still applies every ordinary event — a missed push resumes it on its own", () => {
    const state = reachAwaitingContainer(0);
    const overdue = advanceProvisioning(
      state,
      { kind: "tick" },
      PROVISIONING_CAPS["awaiting-container"] + 1,
    );
    expect(overdue.overdue).toBe(true);

    const settled = advanceProvisioning(
      overdue,
      { kind: "services", project: PROJECT, services: [container()] },
      PROVISIONING_CAPS["awaiting-container"] + 2,
    );
    expect(settled.phase).toBe("awaiting-settled");
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

  it("does not let the awaiting-health cap elapse while a process is running", () => {
    const awaitingHealth = reachAwaitingHealth(0);
    const running = advanceProvisioning(awaitingHealth, { kind: "process", running: true }, 0);
    expect(running.processRunning).toBe(true);

    const stillRunning = advanceProvisioning(
      running,
      { kind: "tick" },
      PROVISIONING_CAPS["awaiting-health"] + 1000,
    );
    expect(stillRunning.phase).toBe("awaiting-health");
  });

  it("resets the awaiting-health cap's clock to when the process finishes", () => {
    const awaitingHealth = reachAwaitingHealth(0);
    const running = advanceProvisioning(awaitingHealth, { kind: "process", running: true }, 0);
    const finished = advanceProvisioning(running, { kind: "process", running: false }, 50_000);
    expect(finished.processRunning).toBe(false);
    expect(finished.phaseStartedAtMs).toBe(50_000);

    const stillOk = advanceProvisioning(
      finished,
      { kind: "tick" },
      50_000 + PROVISIONING_CAPS["awaiting-health"] - 1,
    );
    expect(stillOk.phase).toBe("awaiting-health");

    const expired = advanceProvisioning(
      finished,
      { kind: "tick" },
      50_000 + PROVISIONING_CAPS["awaiting-health"] + 1,
    );
    expect(expired.phase).toBe("awaiting-health");
    expect(expired.overdue).toBe(true);
  });

  it("the process event does not affect awaiting-container", () => {
    const awaitingContainer = reachAwaitingContainer(0);
    const unaffected = advanceProvisioning(
      awaitingContainer,
      { kind: "process", running: true },
      0,
    );
    expect(unaffected).toBe(awaitingContainer);
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

describe("awaiting-settled and hardening (the birth's one restart)", () => {
  it("a wait does not leave awaiting-settled on a timer", () => {
    const settled = reachAwaitingSettled(0);
    expect(settled.capMs).toBeNull();

    const muchLater = advanceProvisioning(settled, { kind: "tick" }, 10_000_000);
    expect(muchLater.phase).toBe("awaiting-settled");

    // Absence of a running process is not enough either — only an observed one.
    const unobserved = advanceProvisioning(settled, { kind: "process", running: false }, 5000);
    expect(unobserved.phase).toBe("awaiting-settled");
  });

  it("a settled project is hardened before its health is asked", () => {
    const settled = reachAwaitingSettled(0);
    const hardening = advanceProvisioning(
      settled,
      { kind: "process", running: false, observed: true },
      1000,
    );
    expect(hardening.phase).toBe("hardening");
    expect(hardening.capMs).toBeNull();
    // The container it is about survives the transition.
    expect(hardening.containerOrigin).toBe(settled.containerOrigin);

    const afterHarden = advanceProvisioning(
      hardening,
      { kind: "hardened", restarted: true, atMs: 1000 },
      2000,
    );
    expect(afterHarden.phase).toBe("awaiting-health");
    expect(afterHarden.hardenedAtMs).toBe(1000);
    expect(afterHarden.restartExpected).toBe(true);
  });

  it("a descriptor from before the restart is not ready", () => {
    const awaitingHealth = reachAwaitingHealth(0, { restarted: true });
    expect(awaitingHealth.hardenedAtMs).toBe(0);

    const stale = advanceProvisioning(
      awaitingHealth,
      { kind: "health", health: "ready", initAt: "1970-01-01T00:00:00.000Z" },
      1000,
    );
    expect(stale.phase).toBe("awaiting-health");

    const noInitAt = advanceProvisioning(awaitingHealth, { kind: "health", health: "ready" }, 1000);
    expect(noInitAt.phase).toBe("awaiting-health");

    const fresh = advanceProvisioning(
      awaitingHealth,
      { kind: "health", health: "ready", initAt: "1970-01-01T00:00:00.001Z" },
      1000,
    );
    expect(fresh.phase).toBe("ready");
  });

  it("a plan that restarted nothing needs no newer initAt", () => {
    const awaitingHealth = reachAwaitingHealth(1000, { restarted: false });
    expect(awaitingHealth.restartExpected).toBe(false);

    const ready = advanceProvisioning(awaitingHealth, { kind: "health", health: "ready" }, 2000);
    expect(ready.phase).toBe("ready");
  });

  it("harden read-incomplete keeps waiting, another failure is retryable", () => {
    const hardening = reachHardening(0);

    // The hook dispatches nothing at all for a retryable "read hasn't caught
    // up yet" — the state simply stays in hardening for the next poll.
    expect(hardening.phase).toBe("hardening");

    const failed = advanceProvisioning(
      hardening,
      { kind: "harden-failed", message: "The container is no longer in this project." },
      1000,
    );
    expect(failed.phase).toBe("hardening");
    expect(failed.detail).toBe("The container is no longer in this project.");

    const retried = advanceProvisioning(failed, { kind: "retry" }, 2000);
    expect(retried.phase).toBe("hardening");
    expect(retried.detail).toBeNull();
    expect(retried.phaseStartedAtMs).toBe(2000);
  });
});

describe("readProvisioning", () => {
  const probeNeverCalled = () => {
    throw new Error("the health probe must not run before a container origin exists");
  };

  it("uses the shared project observation supplied by the account runtime", async () => {
    const event = await readProvisioning({
      state: startProvisioning({ zcpClaimed: true, nowMs: 0 }),
      projects: [PROJECT],
      project: undefined,
      services: undefined,
      probeHealth: probeNeverCalled,
    });

    expect(event).toEqual({ kind: "projects", projects: [PROJECT] });
  });

  it("uses the shared project and service observations while awaiting a container", async () => {
    const event = await readProvisioning({
      state: reachAwaitingContainer(),
      projects: [PROJECT],
      project: PROJECT,
      services: [container()],
      probeHealth: probeNeverCalled,
    });

    expect(event).toEqual({ kind: "services", project: PROJECT, services: [container()] });
  });

  it("keeps reading the shared observations while awaiting-settled", async () => {
    const event = await readProvisioning({
      state: reachAwaitingSettled(),
      projects: [PROJECT],
      project: PROJECT,
      services: [container()],
      probeHealth: probeNeverCalled,
    });

    expect(event).toEqual({ kind: "services", project: PROJECT, services: [container()] });
  });

  it("issues no read at all while hardening — the hook runs the harden command itself", async () => {
    const event = await readProvisioning({
      state: reachHardening(),
      projects: [PROJECT],
      project: PROJECT,
      services: [container()],
      probeHealth: probeNeverCalled,
    });

    expect(event).toEqual({ kind: "tick" });
  });

  it("probes the container origin once one is known, and calls no API for it", async () => {
    const probed: string[] = [];

    const awaitingHealth = reachAwaitingHealth();

    const event = await readProvisioning({
      state: awaitingHealth,
      projects: [PROJECT],
      project: PROJECT,
      services: [container()],
      probeHealth: (origin) => {
        probed.push(origin);
        return Promise.resolve("initializing" as const);
      },
    });

    expect(event).toEqual({ kind: "health", health: "initializing" });
    expect(probed).toEqual(["https://zcp-24cb-8080.prg1.zerops.app"]);
  });

  it("issues no read at all in a settled state", async () => {
    const event = await readProvisioning({
      state: startProvisioning({ zcpClaimed: false, nowMs: 0 }),
      projects: [],
      project: undefined,
      services: undefined,
      probeHealth: probeNeverCalled,
    });

    expect(event).toEqual({ kind: "tick" });
  });
});

describe("predates-mate is a read fact, not a browser inference (H9)", () => {
  // `predates-mate` × the platform's own `ZCP_MATE_ENABLED` read — the only
  // health verdict this flag changes anything for.
  const cases = [
    { mateEnabled: false, want: "needs-enable" },
    { mateEnabled: true, want: "awaiting-health" },
    { mateEnabled: undefined, want: "needs-enable" },
  ] as const;

  it.each(cases)("predates-mate, mateEnabled=$mateEnabled -> $want", ({ mateEnabled, want }) => {
    const awaitingHealth = reachAwaitingHealth(1000);
    const next = advanceProvisioning(
      awaitingHealth,
      mateEnabled === undefined
        ? { kind: "health", health: "predates-mate" }
        : { kind: "health", health: "predates-mate", mateEnabled },
      2000,
    );
    expect(next.phase).toBe(want);
  });

  it("a container mid-init (flag on) never offers Enable, and says so", () => {
    const awaitingHealth = reachAwaitingHealth(1000);
    const stillInit = advanceProvisioning(
      awaitingHealth,
      { kind: "health", health: "predates-mate", mateEnabled: true },
      2000,
    );
    expect(stillInit.phase).toBe("awaiting-health");
    expect(stillInit.detail).toBe("Almost there.");
  });

  it("the flag reading on still lets a later ready verdict settle the wait", () => {
    const awaitingHealth = reachAwaitingHealth(1000);
    const stillInit = advanceProvisioning(
      awaitingHealth,
      { kind: "health", health: "predates-mate", mateEnabled: true },
      2000,
    );
    const ready = advanceProvisioning(
      stillInit,
      { kind: "health", health: "ready", initAt: "1970-01-01T00:00:03.000Z" },
      4000,
    );
    expect(ready.phase).toBe("ready");
  });
});

describe("enabling Zerops Mate on an older container", () => {
  function reachNeedsEnable(): ProvisioningState {
    return advanceProvisioning(
      reachAwaitingHealth(1000),
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

  it("not-yet-available has a real exit: retry re-asks the same health question (H4/H5)", () => {
    const enabled = advanceProvisioning(reachNeedsEnable(), { kind: "enable" }, 50_000);
    const stillOld = advanceProvisioning(
      enabled,
      { kind: "health", health: "predates-mate" },
      60_000,
    );

    const retried = advanceProvisioning(stillOld, { kind: "retry" }, 70_000);
    expect(retried.phase).toBe("awaiting-health");
    expect(retried.phaseStartedAtMs).toBe(70_000);
    expect(retried.capMs).toBe(PROVISIONING_CAPS["awaiting-health"]);
    expect(retried.containerServiceId).toBe("service-1");
    expect(retried.containerOrigin).toBe("https://zcp-24cb-8080.prg1.zerops.app");
    // A restart was already tried this wait; a container still old after
    // this re-ask lands back on not-yet-available, not needs-enable again.
    expect(retried.enabled).toBe(true);
  });

  it("a post-enable health wait that outlasts its cap stays waiting, overdue", () => {
    const enabled = advanceProvisioning(reachNeedsEnable(), { kind: "enable" }, 0);
    const expired = advanceProvisioning(
      enabled,
      { kind: "tick" },
      PROVISIONING_CAPS["awaiting-health"] + 1,
    );

    expect(expired.phase).toBe("awaiting-health");
    expect(expired.overdue).toBe(true);
    expect(expired.enabled).toBe(true);
  });
});
