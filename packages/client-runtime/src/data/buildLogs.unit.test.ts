import { expect, it } from "vite-plus/test";
import type { BuildLogLine } from "../zerops/activity/buildLog.ts";
import {
  BuildLogTransportError,
  type BuildLogTransport,
  type BuildLogTransportPage,
} from "./adapters/buildLog.ts";
import {
  BUILD_LOG_POLICY,
  BuildLogRegistryError,
  type BuildLogLease,
  makeBuildLogRegistry,
} from "./buildLogs.ts";

const PROJECT = "p1";
const QUERY = { buildServiceStackId: "build-1", appVersionId: "version-1" };

const line = (id: string, text = id): BuildLogLine => ({
  id,
  at: `2026-09-08T00:00:${id.replace(/\D/g, "").padStart(2, "0") || "00"}.000Z`,
  text,
  severity: 6,
});

function deferred<A>() {
  let resolve!: (value: A) => void;
  const promise = new Promise<A>((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
}

class ManualTimers {
  #nextId = 0;
  now = 0;
  readonly deadlines = new Map<number, number>();
  readonly pending = new Map<number, () => void>();

  set = (callback: () => void, delayMs: number): number => {
    const id = this.#nextId++;
    this.pending.set(id, callback);
    this.deadlines.set(id, this.now + delayMs);
    return id;
  };

  clear = (handle: unknown): void => {
    this.pending.delete(handle as number);
    this.deadlines.delete(handle as number);
  };

  flushOne(): void {
    const first = [...this.pending].sort(
      ([a], [b]) => this.deadlines.get(a)! - this.deadlines.get(b)!,
    )[0];
    if (first === undefined) return;
    this.now = this.deadlines.get(first[0])!;
    this.deadlines.delete(first[0]);
    this.pending.delete(first[0]);
    first[1]();
  }
}

class FakeTransport implements BuildLogTransport {
  readonly pages: Array<BuildLogTransportPage | Promise<BuildLogTransportPage>> = [];
  nextPageError?: BuildLogTransportError;
  closed = false;
  readonly followers: Array<{ closed: boolean }> = [];

  async loadPage(): Promise<BuildLogTransportPage> {
    if (this.nextPageError) throw this.nextPageError;
    return this.pages.shift() ?? { lines: [], rejectedItems: 0 };
  }

  async openFollow() {
    const follower = { closed: false };
    this.followers.push(follower);
    return {
      close: () => {
        follower.closed = true;
      },
    };
  }

  shutdown() {
    this.closed = true;
    for (const follower of this.followers) follower.closed = true;
  }

  diagnostics() {
    return {
      activeFollowers: this.followers.filter(({ closed }) => !closed).length,
      closed: this.closed,
    };
  }
}

function harness(activeLogSessionsPerAccount = BUILD_LOG_POLICY.activeLogSessionsPerAccount) {
  const timers = new ManualTimers();
  const transport = new FakeTransport();
  const denied = new Set<string>();
  const registry = makeBuildLogRegistry({
    readable: (projectId) => !denied.has(projectId),
    transport,
    policy: { ...BUILD_LOG_POLICY, activeLogSessionsPerAccount },
    setTimer: timers.set,
    clearTimer: timers.clear,
  });
  return { registry, transport, timers, denied };
}

// witness: packages/client-runtime/src/data/buildLogs.ts | if (error.kind === "grant") return "access"; → if (error.kind === "grant") return fallback;
it("ST42: A refused build log grant shows as no access and never shows the grant's text or address", async () => {
  const { registry, transport } = harness();
  transport.nextPageError = new BuildLogTransportError("grant");
  const lease = registry.acquire(PROJECT, QUERY);
  await registry.drain();

  expect(lease.session.getSnapshot().status).toBe("error");
  expect(lease.session.getSnapshot().error).toBe("access");
  expect(JSON.stringify(lease.session.getSnapshot())).not.toContain("http");
});

// witness: packages/client-runtime/src/data/buildLogs.ts | if (sessions.size >= options.policy.activeLogSessionsPerAccount) → if ([...sessions.values()].filter(({ session }) => session.getSnapshot().status !== "loading").length >= options.policy.activeLogSessionsPerAccount)
it("ST43: A build log asked for over capacity is refused with an error that carries no address", async () => {
  const { registry, transport } = harness(1);
  transport.pages.push({ lines: [], rejectedItems: 0 });
  registry.acquire(PROJECT, QUERY);
  let error: unknown;
  try {
    registry.acquire(PROJECT, { ...QUERY, appVersionId: "version-2" });
  } catch (cause) {
    error = cause;
  }
  expect(error).toBeInstanceOf(BuildLogRegistryError);
  expect(String(error)).not.toContain("https://");
  await registry.drain();
});

// witness: packages/client-runtime/src/data/buildLogs.ts | if (held.follows.size === 0) close(heldKey, held); → if (held.follows.size === 0 && held.closing === undefined) close(heldKey, held);
it("ST44: At capacity, a build log only kept for its grace gives way to the one asked for, and one still held does not", async () => {
  const other = { ...QUERY, appVersionId: "version-2" };
  for (const held of [false, true]) {
    const { registry, transport } = harness(1);
    transport.pages.push({ lines: [], rejectedItems: 0 }, { lines: [], rejectedItems: 0 });
    const first = registry.acquire(PROJECT, QUERY);
    await registry.drain();
    if (held) {
      expect(() => registry.acquire(PROJECT, other)).toThrow(BuildLogRegistryError);
    } else {
      first.release();
      let next: BuildLogLease | undefined;
      expect(() => {
        next = registry.acquire(PROJECT, other);
      }).not.toThrow();
      expect(next?.session).not.toBe(first.session);
      await registry.drain();
    }
    registry.shutdown();
  }
});

// witness: packages/client-runtime/src/data/buildLogs.ts | if (closed || sessions.get(key) !== ownedEntry) → if (!closed || sessions.get(key) !== ownedEntry)
it("ST45: A build's released log asked for again within its grace keeps its lines; after the grace it starts empty", async () => {
  for (const expired of [false, true]) {
    const { registry, transport, timers } = harness();
    transport.pages.push({ lines: [line("l1")], rejectedItems: 0 });
    const first = registry.acquire(PROJECT, QUERY, { follow: true });
    await registry.drain();
    first.release();
    if (expired) timers.flushOne();
    const next = registry.acquire(PROJECT, QUERY);
    await registry.drain();
    expect(next.session.getSnapshot().lines.map(({ id }) => id)).toEqual(expired ? [] : ["l1"]);
    expect(next.session === first.session).toBe(!expired);
    registry.shutdown();
  }
});

// witness: packages/client-runtime/src/data/buildLogs.ts | if (options.readable(entry.projectId)) continue; → if (options.readable(entry.projectId) || entry.session.getSnapshot().lines.length === 0) continue;
it("ST46: A build log page that arrives after access was revoked is never shown, also when the log is opened again", async () => {
  const { registry, transport, denied } = harness();
  const page = deferred<BuildLogTransportPage>();
  transport.pages.push(page.promise);
  const old = registry.acquire(PROJECT, QUERY, { follow: true });
  denied.add(PROJECT);
  registry.reconcileAccess();
  denied.delete(PROJECT);
  const fresh = registry.acquire(PROJECT, QUERY);
  old.release();
  page.resolve({ lines: [line("late")], rejectedItems: 0 });
  await old.session.drain();
  await registry.drain();
  expect(old.session.getSnapshot().lines).toEqual([]);
  expect(fresh.session).not.toBe(old.session);
  expect(fresh.session.getSnapshot().lines).toEqual([]);
  registry.shutdown();
});
