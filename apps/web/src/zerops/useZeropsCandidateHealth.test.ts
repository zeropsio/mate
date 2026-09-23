import type { ZeropsContainerHealth } from "@t3tools/client-runtime/zerops/provisioning";
import { afterEach, expect, it, vi } from "vite-plus/test";
import {
  pollCandidateHealth,
  probeCandidateHealth,
  reconcileHealthSnapshot,
  type HealthSnapshot,
  type PollTimers,
} from "./useZeropsCandidateHealth";
import { closeAccountLifetime, openAccountLifetime } from "./accountLifetime";

const probe = vi.hoisted(() => vi.fn());
vi.mock("@t3tools/client-runtime/zerops/containerHealth", () => ({
  probeZeropsContainerHealth: (...args: unknown[]) => probe(...args),
}));
afterEach(() => {
  closeAccountLifetime();
  probe.mockReset();
  vi.unstubAllGlobals();
});
it("shares a probe across sidebar, picker and incremental candidate snapshots", async () => {
  openAccountLifetime("account");
  let finish!: (value: string) => void;
  probe.mockImplementation((_origin, _fetch, onVersion) => {
    onVersion("1.2.3");
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const first = probeCandidateHealth("https://container.example", 0);
  const second = probeCandidateHealth("https://container.example/", 0);
  expect(probe).toHaveBeenCalledTimes(1);
  finish("ready");
  expect(await first).toEqual({ health: "ready", serverVersion: "1.2.3" });
  expect(await second).toEqual(await first);
  expect(await probeCandidateHealth("https://container.example", 0)).toEqual(await first);
  expect(probe).toHaveBeenCalledTimes(1);
});
it("carries the descriptor's update field alongside the server version", async () => {
  openAccountLifetime("account-update");
  const update = {
    installed: "0.8.0",
    latest: "0.8.1",
    available: true,
    checkedAt: "2026-09-09T00:00:00Z",
  };
  probe.mockImplementation((_origin, _fetch, onVersion) => {
    onVersion("0.8.0", update);
    return Promise.resolve("ready");
  });
  expect(await probeCandidateHealth("https://update.example", 0)).toEqual({
    health: "ready",
    serverVersion: "0.8.0",
    update,
  });
});

it("re-probes on explicit refresh and never carries a result into another account", async () => {
  openAccountLifetime("account-a");
  probe.mockResolvedValue("unreachable");
  await probeCandidateHealth("https://container.example", 0);
  probe.mockResolvedValue("ready");
  expect(await probeCandidateHealth("https://container.example", 1)).toEqual({ health: "ready" });
  closeAccountLifetime();
  openAccountLifetime("account-b");
  await probeCandidateHealth("https://container.example", 1);
  expect(probe).toHaveBeenCalledTimes(3);
});

it("does not reuse the previous service's health when its address is reused", async () => {
  openAccountLifetime("account");
  probe.mockResolvedValue("ready");
  await probeCandidateHealth("https://container.example", 0, "project:old-service");
  probe.mockResolvedValue("initializing");
  expect(await probeCandidateHealth("https://container.example", 0, "project:new-service")).toEqual(
    { health: "initializing" },
  );
  expect(probe).toHaveBeenCalledTimes(2);
});

function snapshotOf(entries: ReadonlyArray<[string, ZeropsContainerHealth]>): HealthSnapshot {
  return {
    health: new Map(entries),
    serverVersions: new Map(),
    updates: new Map(),
  };
}

const reconcileCases: ReadonlyArray<{
  readonly name: string;
  readonly previous: HealthSnapshot;
  readonly prevOrigins: ReadonlyMap<string, string>;
  readonly targets: ReadonlyArray<{ readonly key: string; readonly origin: string }>;
  readonly expectedKeys: ReadonlyArray<string>;
}> = [
  {
    name: "refresh keeps existing verdicts until the new probe answers",
    previous: snapshotOf([
      ["a", "ready"],
      ["b", "ready"],
    ]),
    prevOrigins: new Map([
      ["a", "https://a.example"],
      ["b", "https://b.example"],
    ]),
    targets: [
      { key: "a", origin: "https://a.example" },
      { key: "b", origin: "https://b.example" },
    ],
    expectedKeys: ["a", "b"],
  },
  {
    name: "a target that left the set is dropped",
    previous: snapshotOf([
      ["a", "ready"],
      ["b", "ready"],
    ]),
    prevOrigins: new Map([
      ["a", "https://a.example"],
      ["b", "https://b.example"],
    ]),
    targets: [{ key: "a", origin: "https://a.example" }],
    expectedKeys: ["a"],
  },
  {
    name: "a target whose origin changed is re-probed from scratch",
    previous: snapshotOf([
      ["a", "ready"],
      ["b", "ready"],
    ]),
    prevOrigins: new Map([
      ["a", "https://a.example"],
      ["b", "https://b-old.example"],
    ]),
    targets: [
      { key: "a", origin: "https://a.example" },
      { key: "b", origin: "https://b-new.example" },
    ],
    expectedKeys: ["a"],
  },
];

it.each(reconcileCases)("$name", ({ previous, prevOrigins, targets, expectedKeys }) => {
  const result = reconcileHealthSnapshot(previous, prevOrigins, targets);
  expect(Array.from(result.health.keys()).sort()).toEqual([...expectedKeys].sort());
});

function fakeTimers(): {
  readonly timers: PollTimers;
  now(): number;
  advance(ms: number): Promise<void>;
} {
  let now = 0;
  let nextId = 1;
  const scheduled: Array<{ id: number; at: number; cb: () => void }> = [];
  const timers: PollTimers = {
    setTimeout: (cb, ms) => {
      const id = nextId++;
      scheduled.push({ id, at: now + ms, cb });
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout: (handle) => {
      const index = scheduled.findIndex((entry) => entry.id === (handle as unknown as number));
      if (index >= 0) scheduled.splice(index, 1);
    },
  };
  return {
    timers,
    now: () => now,
    async advance(ms: number) {
      const target = now + ms;
      for (;;) {
        const nextAt = scheduled.reduce((min, entry) => Math.min(min, entry.at), Infinity);
        if (nextAt === Infinity || nextAt > target) break;
        now = nextAt;
        const due = scheduled.filter((entry) => entry.at <= now);
        for (const entry of due) {
          const index = scheduled.indexOf(entry);
          if (index >= 0) scheduled.splice(index, 1);
          entry.cb();
        }
        // Let the promise chain the callback resumed settle before checking
        // for more timers it may have scheduled.
        await Promise.resolve();
        await Promise.resolve();
      }
      now = target;
    },
  };
}

function scriptedHealth(
  ...verdicts: ReadonlyArray<ZeropsContainerHealth>
): () => Promise<{ health: ZeropsContainerHealth }> {
  let index = 0;
  return () => {
    const health = verdicts[Math.min(index, verdicts.length - 1)]!;
    index += 1;
    return Promise.resolve({ health });
  };
}

it("re-probes a pending verdict every 5s instead of accepting it as final", async () => {
  const clock = fakeTimers();
  const reprobe = scriptedHealth("initializing");
  const verdicts: ZeropsContainerHealth[] = [];
  const done = pollCandidateHealth({
    firstProbe: () => Promise.resolve({ health: "initializing" }),
    reprobe,
    isProcessRunning: () => false,
    now: clock.now,
    timers: clock.timers,
    isCancelled: () => false,
    onVerdict: (health) => {
      verdicts.push(health);
    },
  });
  await Promise.resolve();
  expect(verdicts).toEqual(["initializing"]);

  await clock.advance(5_000);
  expect(verdicts).toEqual(["initializing", "initializing"]);
  await clock.advance(5_000);
  expect(verdicts).toEqual(["initializing", "initializing", "initializing"]);

  void done;
});

it("stops re-probing once the verdict settles ready", async () => {
  const clock = fakeTimers();
  let reprobeCalls = 0;
  const verdicts: ZeropsContainerHealth[] = [];
  const done = pollCandidateHealth({
    firstProbe: () => Promise.resolve({ health: "initializing" }),
    reprobe: () => {
      reprobeCalls += 1;
      return Promise.resolve({ health: "ready" });
    },
    isProcessRunning: () => false,
    now: clock.now,
    timers: clock.timers,
    isCancelled: () => false,
    onVerdict: (health) => {
      verdicts.push(health);
    },
  });
  await Promise.resolve();
  await clock.advance(5_000);
  await done;
  await clock.advance(5_000);
  expect(verdicts.at(-1)).toBe("ready");
  expect(reprobeCalls).toBe(1);
});

it("reports stalled once the wait outlasts 90s with no process running", async () => {
  const clock = fakeTimers();
  const verdicts: ZeropsContainerHealth[] = [];
  void pollCandidateHealth({
    firstProbe: () => Promise.resolve({ health: "initializing" }),
    reprobe: () => Promise.resolve({ health: "initializing" }),
    isProcessRunning: () => false,
    now: clock.now,
    timers: clock.timers,
    isCancelled: () => false,
    onVerdict: (health) => {
      verdicts.push(health);
    },
  });
  await Promise.resolve();

  await clock.advance(85_000);
  expect(verdicts).not.toContain("stalled");

  await clock.advance(10_000);
  expect(verdicts.at(-1)).toBe("stalled");
});

it("never stalls while a process is known to be running against the candidate", async () => {
  const clock = fakeTimers();
  const verdicts: ZeropsContainerHealth[] = [];
  void pollCandidateHealth({
    firstProbe: () => Promise.resolve({ health: "initializing" }),
    reprobe: () => Promise.resolve({ health: "initializing" }),
    isProcessRunning: () => true,
    now: clock.now,
    timers: clock.timers,
    isCancelled: () => false,
    onVerdict: (health) => {
      verdicts.push(health);
    },
  });
  await Promise.resolve();

  await clock.advance(200_000);
  expect(verdicts).not.toContain("stalled");
});

it("starts the 90s window from when the process finishes, not from the first verdict", async () => {
  const clock = fakeTimers();
  const verdicts: ZeropsContainerHealth[] = [];
  let processRunning = true;
  void pollCandidateHealth({
    firstProbe: () => Promise.resolve({ health: "initializing" }),
    reprobe: () => Promise.resolve({ health: "initializing" }),
    isProcessRunning: () => processRunning,
    now: clock.now,
    timers: clock.timers,
    isCancelled: () => false,
    onVerdict: (health) => {
      verdicts.push(health);
    },
  });
  await Promise.resolve();

  // 60s with the process still running: no window has started yet.
  await clock.advance(60_000);
  processRunning = false;
  // 85s after the process finished: still within the 90s window.
  await clock.advance(85_000);
  expect(verdicts).not.toContain("stalled");

  // Past 90s from when it finished.
  await clock.advance(15_000);
  expect(verdicts.at(-1)).toBe("stalled");
});

it("stops re-probing once cancelled", async () => {
  const clock = fakeTimers();
  let reprobeCalls = 0;
  let cancelled = false;
  void pollCandidateHealth({
    firstProbe: () => Promise.resolve({ health: "initializing" }),
    reprobe: () => {
      reprobeCalls += 1;
      return Promise.resolve({ health: "initializing" });
    },
    isProcessRunning: () => false,
    now: clock.now,
    timers: clock.timers,
    isCancelled: () => cancelled,
    onVerdict: () => {},
  });
  await Promise.resolve();
  cancelled = true;
  await clock.advance(5_000);
  expect(reprobeCalls).toBe(0);
});

async function flushMicrotasks(): Promise<void> {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
}

/**
 * Installs a global `setTimeout`/`clearTimeout` that enforce their receiver
 * the way browsers do (`TypeError: Illegal invocation` for any `this` other
 * than the global object or `undefined`), then evaluates a fresh copy of the
 * module so its default timers are taken from these globals.
 */
async function withBrowserTimerGlobals() {
  const scheduled: Array<{ readonly callback: () => void; readonly ms: number }> = [];
  const cleared: Array<unknown> = [];
  const enforceReceiver = (receiver: unknown) => {
    if (receiver !== undefined && receiver !== globalThis) {
      throw new TypeError("Illegal invocation");
    }
  };
  vi.stubGlobal("setTimeout", function (this: unknown, callback: () => void, ms: number) {
    enforceReceiver(this);
    scheduled.push({ callback, ms });
    return scheduled.length;
  });
  vi.stubGlobal("clearTimeout", function (this: unknown, handle: unknown) {
    enforceReceiver(this);
    cleared.push(handle);
  });
  vi.resetModules();
  const module = await import("./useZeropsCandidateHealth");
  return { pollCandidateHealth: module.pollCandidateHealth, scheduled, cleared };
}

it("waits between re-probes on the default timers where setTimeout enforces its receiver", async () => {
  const browser = await withBrowserTimerGlobals();
  const verdicts: ZeropsContainerHealth[] = [];
  const done = browser.pollCandidateHealth({
    firstProbe: () => Promise.resolve({ health: "initializing" }),
    reprobe: () => Promise.resolve({ health: "ready" }),
    isProcessRunning: () => false,
    now: () => 0,
    isCancelled: () => false,
    onVerdict: (health) => {
      verdicts.push(health);
    },
  });
  let failure: unknown;
  done.catch((error: unknown) => {
    failure = error;
  });
  await flushMicrotasks();
  expect(failure).toBeUndefined();
  expect(browser.scheduled.map((entry) => entry.ms)).toEqual([5_000]);

  browser.scheduled[0]!.callback();
  await done;
  expect(verdicts).toEqual(["initializing", "ready"]);
});

it("cancels a pending wait on the default timers where clearTimeout enforces its receiver", async () => {
  const browser = await withBrowserTimerGlobals();
  let cancelChecks = 0;
  // Cancelled between scheduling the wait and awaiting it: the poll clears
  // the timer it just set.
  await browser.pollCandidateHealth({
    firstProbe: () => Promise.resolve({ health: "initializing" }),
    reprobe: () => Promise.resolve({ health: "ready" }),
    isProcessRunning: () => false,
    now: () => 0,
    isCancelled: () => {
      cancelChecks += 1;
      return cancelChecks > 1;
    },
    onVerdict: () => {},
  });
  expect(browser.cleared).toEqual([1]);
});
