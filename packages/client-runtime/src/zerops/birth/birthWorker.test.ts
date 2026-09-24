import { describe, expect, it } from "vite-plus/test";

import type { ZeropsProject, ZeropsService } from "../api.ts";
import type { ExchangeClock } from "../environments/exchangeDriver.ts";
import type { ZeropsContainerHealth } from "../provisioning.ts";
import { makeHarnessBrowser, type HarnessTab } from "../testing/browserTabs.ts";
import {
  makeBirthStore,
  type BeginBirth,
  type BirthStore,
  type BirthsStorage,
} from "./birthStore.ts";
import {
  makeBirthWorker,
  type BirthLocks,
  type BirthStepOutcome,
  type BirthWorker,
} from "./birthWorker.ts";

/** Answers settle across a few promise hops; this lets every one of them land. */
const flush = async (): Promise<void> => {
  for (let hop = 0; hop < 50; hop += 1) await Promise.resolve();
};

/** Wall and monotonic time moving together; timers fire in order, each followed by a flush. */
function manualClock(): Pick<ExchangeClock, "now" | "setTimer" | "random"> & {
  readonly advance: (ms: number) => Promise<void>;
} {
  let mono = 0;
  const wallOffset = 1_800_000_000_000;
  let nextId = 0;
  const timers = new Map<number, { readonly at: number; readonly fire: () => void }>();
  return {
    now: () => ({ wall: mono + wallOffset, mono }),
    random: () => 0.5,
    setTimer: (delayMs, fire) => {
      const id = nextId;
      nextId += 1;
      timers.set(id, { at: mono + Math.max(0, delayMs), fire });
      return () => {
        timers.delete(id);
      };
    },
    advance: async (ms) => {
      await flush();
      const end = mono + ms;
      for (;;) {
        let due: [number, { readonly at: number; readonly fire: () => void }] | undefined;
        for (const entry of timers) {
          if (entry[1].at <= end && (due === undefined || entry[1].at < due[1].at)) due = entry;
        }
        if (due === undefined) break;
        timers.delete(due[0]);
        mono = Math.max(mono, due[1].at);
        due[1].fire();
        await flush();
      }
      mono = end;
      await flush();
    },
  };
}

function memoryStorage(): BirthsStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

const PROJECT: ZeropsProject = {
  id: "project-1",
  name: "Todo - Vera",
  status: "ACTIVE",
  clientId: "org-1",
  publicZone: "abc.prg1-zerops.zone",
  zeropsSubdomainHost: "24cb",
};

const CONTAINER: ZeropsService = {
  id: "service-1",
  name: "zcp",
  status: "ACTIVE",
  subdomainAccess: true,
  ports: [{ port: 8080, httpSupport: true }],
  serviceStackTypeInfo: { serviceStackTypeVersionName: "zcp@1" },
};

const ORIGIN = "https://zcp-24cb-8080.prg1.zerops.app";

const mate: BeginBirth = {
  projectId: "project-1",
  organizationId: "org-1",
  registration: {
    giteaProjectId: "gitea-1",
    giteaOrigin: null,
    groupId: "group-1",
    kind: "mate",
    displayName: "Todo - Vera",
  },
  container: true,
  placement: null,
};

const DONE: BirthStepOutcome = { kind: "done" };

interface Rig {
  readonly clock: ReturnType<typeof manualClock>;
  readonly store: BirthStore;
  readonly worker: BirthWorker;
  /** Every port call, in order. */
  readonly calls: Array<string>;
  /** Every group write the birth went on without. */
  readonly outstanding: Array<string>;
  services: ReadonlyArray<ZeropsService>;
  /** Whether the activity feed reads a process running on the container; null before it answered. */
  running: boolean | null;
  health: ZeropsContainerHealth;
  tags: BirthStepOutcome;
  registry: BirthStepOutcome;
  /** What closing the project off answers. */
  hardened: BirthStepOutcome;
  /** The platform no longer has the project, or failed to create it. */
  ended: "gone" | "creation-failed" | null;
}

/** One tab's locks, as `navigator.locks` grants them. */
const tabLocks = (tab: HarnessTab): BirthLocks => ({
  request: (name, hold) => tab.locks.request(name, () => hold()),
});

/** A tab of its own: nothing else asks for its locks. */
const soleLocks: BirthLocks = { request: (_name, hold) => hold() };

function rig(
  options: {
    readonly clock?: ReturnType<typeof manualClock>;
    readonly storage?: BirthsStorage;
    readonly locks?: BirthLocks;
  } = {},
): Rig {
  const clock = options.clock ?? manualClock();
  const store = makeBirthStore({
    storage: options.storage ?? memoryStorage(),
    now: () => clock.now().wall,
  });
  const calls: Array<string> = [];
  const outstanding: Array<string> = [];
  const result: { -readonly [K in keyof Rig]: Rig[K] } = {
    clock,
    store,
    calls,
    outstanding,
    services: [],
    running: null,
    health: "initializing",
    tags: DONE,
    registry: DONE,
    hardened: DONE,
    ended: null,
    worker: undefined as unknown as BirthWorker,
  };
  result.worker = makeBirthWorker({
    store,
    clock,
    locks: options.locks ?? soleLocks,
    writeTags: async (birth) => {
      calls.push(`tags ${birth.projectId}`);
      return result.tags;
    },
    writeRegistry: async (birth) => {
      calls.push(`registry ${birth.projectId}`);
      return result.registry;
    },
    readProject: async (birth) => {
      calls.push(`read ${birth.projectId}`);
      return result.ended ?? { project: PROJECT, services: result.services };
    },
    processRunning: () => result.running,
    harden: async (birth) => {
      calls.push(`harden ${birth.projectId}`);
      return result.hardened;
    },
    probeHealth: async (origin) => {
      calls.push(`probe ${origin}`);
      return result.health;
    },
    readMateFlag: async () => "unknown",
    outstanding: (birth, reason) => {
      outstanding.push(`${birth.projectId}: ${reason}`);
    },
  });
  return result;
}

describe("the birth worker", () => {
  it("reads its own project until the container's boot is over, then hardens it once", async () => {
    const r = rig();
    r.store.begin(mate);
    await r.clock.advance(2_000);
    expect(r.store.birth("project-1")?.step).toBe("harden");

    // The container comes up and its own boot finishes.
    r.services = [CONTAINER];
    await r.clock.advance(2_000);
    r.running = false;
    await r.clock.advance(4_000);
    expect(r.calls.filter((call) => call.startsWith("harden"))).toEqual(["harden project-1"]);
    expect(r.store.birth("project-1")).toMatchObject({
      step: "health",
      serviceId: "service-1",
      origin: ORIGIN,
    });
  });

  it("two tabs, one driver", async () => {
    const browser = makeHarnessBrowser();
    const [first, second] = [browser.openTab(), browser.openTab()];
    const clock = manualClock();
    const a = rig({ clock, storage: first.localStorage, locks: tabLocks(first) });
    const b = rig({ clock, storage: second.localStorage, locks: tabLocks(second) });
    for (const r of [a, b]) r.services = [CONTAINER];

    a.store.begin(mate);
    // The other tab hears the storage event.
    b.store.reload();
    await clock.advance(2_000);
    a.running = false;
    b.running = false;
    await clock.advance(4_000);
    expect(a.calls).toEqual(["tags project-1", "registry project-1", ...a.calls.slice(2)]);
    expect(a.calls.filter((call) => call.startsWith("harden"))).toEqual(["harden project-1"]);
    expect(b.calls).toEqual([]);

    // The driving tab goes away: its lock is released, and the other tab takes the birth over
    // from where the record says it is.
    first.reload();
    a.worker.dispose();
    b.store.reload();
    b.health = "ready";
    await clock.advance(2_000);
    expect(b.calls).toEqual([`probe ${ORIGIN}`]);
    expect(b.worker.waits().get("project-1")?.phase).toBe("ready");
  });

  it("a Mate that answered stays its tab's until the connect promotes it", async () => {
    const browser = makeHarnessBrowser();
    const [first, second] = [browser.openTab(), browser.openTab()];
    const clock = manualClock();
    const a = rig({ clock, storage: first.localStorage, locks: tabLocks(first) });
    a.services = [CONTAINER];
    a.running = false;
    a.health = "ready";
    a.store.begin({ ...mate, registration: null });
    await clock.advance(2_000);
    expect(a.worker.waits().get("project-1")?.phase).toBe("ready");

    // Another tab opens while the connect is on its way: it drives nothing of this birth.
    const b = rig({ clock, storage: second.localStorage, locks: tabLocks(second) });
    b.health = "ready";
    await clock.advance(10_000);
    expect(b.calls).toEqual([]);

    a.store.forget("project-1");
    b.store.reload();
    await clock.advance(2_000);
    expect(b.calls).toEqual([]);
    expect(browser.locksHeld()).toEqual([]);
  });

  it("a group write that fails is said, and the birth still hardens", async () => {
    const r = rig();
    r.services = [CONTAINER];
    r.running = false;
    r.tags = { kind: "failed", reason: "That project is not in the registry." };
    r.store.begin(mate);
    await r.clock.advance(4_000);
    expect(r.calls.slice(0, 2)).toEqual(["tags project-1", "registry project-1"]);
    expect(r.calls).toContain("harden project-1");
    expect(r.outstanding).toEqual(["project-1: That project is not in the registry."]);
  });

  it("a group write that is not through yet is tried on the retry ladder, then left", async () => {
    const r = rig();
    r.tags = { kind: "not-yet", reason: "The account is being verified." };
    r.store.begin(mate);
    await r.clock.advance(2_000 + 4_000 + 8_000 + 15_000 + 30_000 + 60_000);
    expect(r.calls.filter((call) => call.startsWith("tags"))).toHaveLength(7);
    expect(r.store.birth("project-1")?.step).toBe("harden");
    expect(r.outstanding).toEqual(["project-1: The account is being verified."]);
  });

  it("a harden that is not through yet is tried on the retry ladder, never in a loop", async () => {
    const r = rig();
    r.services = [CONTAINER];
    r.running = false;
    r.hardened = { kind: "not-yet", reason: "The account is being verified." };
    r.store.begin({ ...mate, registration: null });
    // Settled on the second read; the harden then waits 2 s, 4 s, 8 s between its attempts.
    await r.clock.advance(2_000 + 2_000 + 4_000 + 8_000);
    expect(r.calls.filter((call) => call.startsWith("harden"))).toHaveLength(4);

    r.hardened = DONE;
    await r.clock.advance(15_000);
    expect(r.store.birth("project-1")?.step).toBe("health");
  });

  it("a harden that failed waits for Try again", async () => {
    const r = rig();
    r.services = [CONTAINER];
    r.running = false;
    r.hardened = { kind: "failed", reason: "You may not change this project." };
    r.store.begin({ ...mate, registration: null });
    await r.clock.advance(600_000);
    expect(r.calls.filter((call) => call.startsWith("harden"))).toHaveLength(1);
    expect(r.worker.waits().get("project-1")).toMatchObject({
      phase: "hardening",
      detail: "You may not change this project.",
    });

    r.hardened = DONE;
    r.worker.retry("project-1");
    await r.clock.advance(0);
    expect(r.calls.filter((call) => call.startsWith("harden"))).toHaveLength(2);
    expect(r.store.birth("project-1")?.step).toBe("health");
  });

  it.each(["gone", "creation-failed"] as const)(
    "a birth whose project is %s ends, waiting on its container or on its Mate",
    async (ended) => {
      const waiting = rig();
      waiting.ended = ended;
      waiting.store.begin(mate);
      await waiting.clock.advance(2_000);
      expect(waiting.store.birth("project-1")).toBeUndefined();
      expect(waiting.worker.waits().size).toBe(0);

      // The project is read again while its Mate is waited on, at a slower cadence than the probe.
      const answering = rig();
      answering.store.begin({ ...mate, registration: null });
      answering.store.update("project-1", {
        step: "health",
        serviceId: "service-1",
        origin: ORIGIN,
      });
      await answering.clock.advance(2_000);
      const count = (kind: string) =>
        answering.calls.filter((call) => call.startsWith(kind)).length;
      const [reads, probes] = [count("read"), count("probe")];
      answering.ended = ended;
      await answering.clock.advance(30_000);
      expect(count("read") - reads).toBe(1);
      expect(count("probe") - probes).toBe(14);
      expect(answering.store.birth("project-1")).toBeUndefined();
    },
  );

  it("a stage without an agent is born with its group writes", async () => {
    const r = rig();
    r.store.begin({
      ...mate,
      registration: { ...mate.registration!, kind: "stage", giteaOrigin: "https://gitea.test" },
      container: false,
    });
    await r.clock.advance(2_000);
    expect(r.calls).toEqual(["tags project-1", "registry project-1"]);
    expect(r.store.birth("project-1")).toBeUndefined();
  });

  it("a birth whose container import failed ends with its group writes", async () => {
    const r = rig();
    r.store.begin(mate);
    await r.clock.advance(0);
    expect(r.store.birth("project-1")?.step).toBe("harden");

    // The creation's container import failed after the project was accepted.
    r.store.update("project-1", { container: false });
    r.services = [CONTAINER];
    r.running = false;
    await r.clock.advance(4_000);
    expect(r.calls.some((call) => call.startsWith("harden"))).toBe(false);
    expect(r.store.birth("project-1")).toBeUndefined();
  });

  it("a set-up Mate owes no group writes and starts at harden", async () => {
    const r = rig();
    r.store.begin({ ...mate, registration: null });
    await r.clock.advance(2_000);
    expect(r.calls[0]).toBe("read project-1");
    expect(r.calls.some((call) => call.startsWith("tags"))).toBe(false);
  });

  it("a cap past its budget is overdue on the same step, and Keep waiting clears it (MC-13)", async () => {
    const r = rig();
    r.store.begin(mate);
    // No container ever appears.
    await r.clock.advance(300_000 + 4_000);
    expect(r.store.birth("project-1")).toMatchObject({ step: "harden", overdue: true });
    expect(r.worker.waits().get("project-1")).toMatchObject({
      phase: "awaiting-container",
      overdue: true,
    });

    r.worker.retry("project-1");
    await r.clock.advance(2_000);
    expect(r.store.birth("project-1")).toMatchObject({ step: "harden", overdue: false });
  });

  it("an overdue wait reads every 10 s rising to 60 s, and Keep waiting reads at once", async () => {
    const r = rig();
    r.store.begin({ ...mate, registration: null });
    const reads = () => r.calls.filter((call) => call.startsWith("read")).length;
    // Overdue on the read at 302 s.
    await r.clock.advance(304_000);
    expect(r.store.birth("project-1")?.overdue).toBe(true);
    const before = reads();
    // Then at 312 s, 332 s, 372 s.
    await r.clock.advance(70_000);
    expect(reads() - before).toBe(3);

    r.worker.retry("project-1");
    await r.clock.advance(0);
    expect(reads() - before).toBe(4);
    await r.clock.advance(2_000);
    expect(reads() - before).toBe(5);
  });

  it("a reload resumes the health wait on the container hardening found, never hardening again", async () => {
    const storage = memoryStorage();
    const clock = manualClock();
    const before = rig({ clock, storage });
    before.services = [CONTAINER];
    before.running = false;
    before.store.begin(mate);
    await clock.advance(4_000);
    expect(before.store.birth("project-1")?.step).toBe("health");
    before.worker.dispose();

    const after = rig({ clock, storage });
    after.health = "ready";
    await clock.advance(2_000);
    expect(after.calls.length).toBeGreaterThan(0);
    expect(after.calls.filter((call) => call !== `probe ${ORIGIN}`)).toEqual([]);
    expect(after.worker.waits().get("project-1")?.phase).toBe("ready");
  });

  it("a container mid-install is waited on, one that predates Mate asks for Enable", async () => {
    const r = rig();
    r.store.begin({ ...mate, registration: null });
    r.store.update("project-1", { step: "health", serviceId: "service-1", origin: ORIGIN });
    r.health = "predates-mate";
    await r.clock.advance(2_000);
    expect(r.worker.waits().get("project-1")?.phase).toBe("needs-enable");

    r.worker.enabled("project-1");
    r.health = "ready";
    await r.clock.advance(2_000);
    expect(r.worker.waits().get("project-1")?.phase).toBe("ready");
  });
});
