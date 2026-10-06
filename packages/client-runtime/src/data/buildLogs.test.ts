import { describe, expect, it } from "vite-plus/test";

import { AtomRegistry } from "effect/unstable/reactivity";

import { buildLogLineBytes, type BuildLogLine } from "../zerops/activity/buildLog.ts";
import { liveZerops } from "./__fixtures__/account.ts";
import type {
  BuildLogFollowHandle,
  BuildLogFollowRequest,
  BuildLogPageRequest,
  BuildLogTransport,
  BuildLogTransportPage,
} from "./adapters/buildLog.ts";
import { BuildLogTransportError } from "./adapters/buildLog.ts";
import {
  BUILD_LOG_POLICY,
  BuildLogRegistryError,
  buildLogSessionKeyOf,
  makeAccountBuildLogs,
  makeBuildLogRegistry,
  type BuildLogPolicy,
} from "./buildLogs.ts";
import { makeAccountStore } from "./store.ts";

const PROJECT = "p1";
const OTHER_PROJECT = "p2";

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

interface FakeFollower {
  readonly request: BuildLogFollowRequest;
  closed: boolean;
  closeCalls: number;
  handle: BuildLogFollowHandle;
}

class FakeTransport implements BuildLogTransport {
  readonly pageRequests: BuildLogPageRequest[] = [];
  readonly followRequests: BuildLogFollowRequest[] = [];
  readonly followers: FakeFollower[] = [];
  readonly pages: Array<
    | BuildLogTransportPage
    | Promise<BuildLogTransportPage>
    | (() => BuildLogTransportPage | Promise<BuildLogTransportPage>)
  > = [];
  nextPageError: unknown;
  shutdownCalls = 0;
  closed = false;

  async loadPage(request: BuildLogPageRequest): Promise<BuildLogTransportPage> {
    this.pageRequests.push(request);
    if (this.nextPageError !== undefined) {
      const error = this.nextPageError;
      this.nextPageError = undefined;
      throw error;
    }
    const page = this.pages.shift() ?? { lines: [], rejectedItems: 0 };
    return typeof page === "function" ? page() : page;
  }

  async openFollow(request: BuildLogFollowRequest): Promise<BuildLogFollowHandle> {
    this.followRequests.push(request);
    const follower: FakeFollower = {
      request,
      closed: false,
      closeCalls: 0,
      handle: undefined as never,
    };
    follower.handle = {
      close: () => {
        if (follower.closed) return;
        follower.closed = true;
        follower.closeCalls += 1;
      },
    };
    this.followers.push(follower);
    return follower.handle;
  }

  shutdown(): void {
    if (this.closed) return;
    this.closed = true;
    this.shutdownCalls += 1;
    for (const follower of this.followers) follower.handle.close();
  }

  diagnostics() {
    return {
      activeFollowers: this.followers.filter(({ closed }) => !closed).length,
      closed: this.closed,
    };
  }

  emit(index: number, lines: ReadonlyArray<BuildLogLine>, rejectedItems = 0): void {
    this.followers[index]?.request.callbacks.onLines(lines, rejectedItems);
  }

  closeFromServer(index: number): void {
    this.followers[index]?.request.callbacks.onClose();
  }
}

function harness(transport = new FakeTransport(), overrides: Partial<BuildLogPolicy> = {}) {
  const timers = new ManualTimers();
  /** The projects the account's store withholds or deleted. */
  const access = { denied: new Set<string>() };
  const registry = makeBuildLogRegistry({
    readable: (projectId) => !access.denied.has(projectId),
    transport,
    policy: { ...BUILD_LOG_POLICY, ...overrides },
    setTimer: timers.set,
    clearTimer: timers.clear,
  });
  return { registry, transport, timers, access };
}

describe("shared build log registry", () => {
  it("keys by the project and filter, shares ref-counted sessions, and disposes a grace after the last release", async () => {
    const { registry, transport, timers } = harness();
    transport.pages.push({ lines: [line("l1")], rejectedItems: 0 });
    const first = registry.acquire(PROJECT, QUERY, { follow: true });
    const second = registry.acquire(PROJECT, { ...QUERY }, { follow: true });
    await registry.drain();

    expect(first.session).toBe(second.session);
    expect(transport.pageRequests).toHaveLength(1);
    expect(transport.followRequests).toHaveLength(1);
    expect(registry.diagnostics()).toEqual({ activeSessions: 1, leases: 2, closed: false });

    transport.pages.push({ lines: [], rejectedItems: 0 }, { lines: [], rejectedItems: 0 });
    const otherProjectLease = registry.acquire(OTHER_PROJECT, QUERY);
    const otherFilterLease = registry.acquire(PROJECT, {
      ...QUERY,
      fromIso: "2026-09-08T00:00:00.000Z",
    });
    await registry.drain();
    expect(otherProjectLease.session).not.toBe(first.session);
    expect(otherFilterLease.session).not.toBe(first.session);
    expect(registry.diagnostics()).toEqual({ activeSessions: 3, leases: 4, closed: false });

    first.release();
    expect(transport.followers[0]?.closed).toBe(false);
    second.release();
    expect(transport.followers[0]?.closed).toBe(true);
    expect(registry.diagnostics().activeSessions).toBe(3);
    timers.flushOne();
    expect(registry.diagnostics().activeSessions).toBe(2);
    otherProjectLease.release();
    otherFilterLease.release();
    timers.flushOne();
    timers.flushOne();
    expect(registry.diagnostics().activeSessions).toBe(0);

    expect(buildLogSessionKeyOf(PROJECT, QUERY)).not.toBe(
      buildLogSessionKeyOf(OTHER_PROJECT, QUERY),
    );
    expect(buildLogSessionKeyOf(PROJECT, QUERY)).not.toBe(
      buildLogSessionKeyOf(PROJECT, { ...QUERY, fromIso: "2026-09-08T00:00:00.000Z" }),
    );
  });

  it("ORs follow demand across leases and reopens once with the latest retained cursor", async () => {
    const { registry, transport, timers } = harness();
    transport.pages.push({ lines: [line("l1")], rejectedItems: 0 });
    const passive = registry.acquire(PROJECT, QUERY);
    const follower = registry.acquire(PROJECT, QUERY, { follow: true });
    await registry.drain();

    expect(transport.followRequests[0]?.fromLineId).toBe("l1");
    transport.emit(0, [line("l2")]);
    timers.flushOne();
    transport.closeFromServer(0);
    await registry.drain();

    expect(transport.followRequests).toHaveLength(2);
    expect(transport.followRequests[1]?.fromLineId).toBe("l2");
    expect(passive.session.getSnapshot().gaps.newer).toBe(false);

    follower.setFollow(false);
    expect(transport.followers[1]?.closed).toBe(true);
    expect(passive.session.getSnapshot().status).toBe("ended");
    passive.release();
    follower.release();
  });

  it.each([
    {
      name: "no source frame, even after timer work",
      frame: null,
      status: "loading",
      ids: [],
      gap: false,
    },
    { name: "an explicit empty source frame", frame: [], status: "live", ids: [], gap: false },
    { name: "the source's lines", frame: [line("l2")], status: "live", ids: ["l2"], gap: false },
    {
      name: "partial source rows",
      frame: [line("l2")],
      rejected: 1,
      status: "live",
      ids: ["l2"],
      gap: true,
    },
  ] as const)("a followed build waits for evidence: $name", async (row) => {
    const { registry, transport, timers } = harness();
    const lease = registry.acquire(PROJECT, QUERY, { follow: true });
    const published: Array<{ status: string; lines: number }> = [];
    lease.session.subscribe(() => {
      const snapshot = lease.session.getSnapshot();
      published.push({ status: snapshot.status, lines: snapshot.lines.length });
    });
    await registry.drain();
    if (row.frame !== null) transport.emit(0, row.frame, "rejected" in row ? row.rejected : 0);
    timers.flushOne();
    expect(lease.session.getSnapshot().status).toBe(row.status);
    expect(lease.session.getSnapshot().lines.map(({ id }) => id)).toEqual(row.ids);
    expect(lease.session.getSnapshot().gaps.older).toBe(row.gap);
    if (row.ids.length > 0) expect(published).not.toContainEqual({ status: "live", lines: 0 });
    lease.release();
  });

  it("a stream let go before its first frame ends", async () => {
    const { registry, transport } = harness();
    const lease = registry.acquire(PROJECT, QUERY, { follow: true });
    await registry.drain();
    lease.setFollow(false);
    expect(transport.followers[0]?.closed).toBe(true);
    expect(lease.session.getSnapshot().status).toBe("ended");
    lease.release();
  });

  // A card that draws a build's log hands it to the next one drawn for it (a
  // row that plops from the live slot into the history): the build is not
  // read twice, and nothing is followed while nobody holds it.
  it.each([
    { name: "acquired again within the grace", wait: false, pages: 1, same: true },
    { name: "acquired again after the grace", wait: true, pages: 2, same: false },
  ])("a build's released log, $name", async ({ wait, pages, same }) => {
    const { registry, transport, timers } = harness();
    transport.pages.push({ lines: [line("l1")], rejectedItems: 0 });
    const first = registry.acquire(PROJECT, QUERY, { follow: true });
    await registry.drain();
    first.release();
    expect(transport.followers[0]?.closed).toBe(true);
    if (wait) timers.flushOne();
    const next = registry.acquire(PROJECT, QUERY);
    await registry.drain();
    expect(transport.pageRequests).toHaveLength(pages);
    expect(next.session === first.session).toBe(same);
    expect(next.session.getSnapshot().lines.map(({ id }) => id)).toEqual(same ? ["l1"] : []);
    next.release();
    timers.flushOne();
    expect(registry.diagnostics().activeSessions).toBe(0);
  });

  it("shows a refused grant as no access, without its text", async () => {
    const { registry, transport } = harness();
    transport.nextPageError = new BuildLogTransportError("grant");
    const lease = registry.acquire(PROJECT, QUERY);
    await registry.drain();

    expect(lease.session.getSnapshot().status).toBe("error");
    expect(lease.session.getSnapshot().error).toBe("access");
    expect(JSON.stringify(lease.session.getSnapshot())).not.toContain("http");
  });

  it("bounds lines and bytes while publishing explicit cursor, gaps and truncation", async () => {
    const maxBytes = buildLogLineBytes(line("l2")) + buildLogLineBytes(line("l3"));
    const { registry, transport } = harness(undefined, {
      retainedLogLinesPerSession: 2,
      retainedLogBytesPerSession: maxBytes,
    });
    transport.pages.push({ lines: [line("l1"), line("l2"), line("l3")], rejectedItems: 0 });
    const lease = registry.acquire(PROJECT, QUERY);
    await registry.drain();

    const snapshot = lease.session.getSnapshot();
    expect(snapshot.lines.map(({ id }) => id)).toEqual(["l2", "l3"]);
    expect(snapshot.bytes).toBeLessThanOrEqual(maxBytes);
    expect(snapshot.cursor).toEqual({ oldestLineId: "l2", newestLineId: "l3" });
    expect(snapshot.gaps).toEqual({ older: true, newer: false });
    expect(snapshot.truncation.lines).toBe(1);
  });

  it("coalesces follow publication at 100ms and keeps its pending queue bounded", async () => {
    const { registry, transport, timers } = harness(undefined, {
      logPublicationCoalescingMs: 100,
      logPublishBatchLines: 2,
      retainedLogLinesPerSession: 3,
    });
    transport.pages.push({ lines: [], rejectedItems: 0 });
    const lease = registry.acquire(PROJECT, QUERY, { follow: true });
    await registry.drain();
    let publications = 0;
    lease.session.subscribe(() => {
      publications += 1;
    });

    transport.emit(0, [line("l1"), line("l2"), line("l3"), line("l4")]);
    expect(lease.session.getSnapshot().lines).toEqual([]);
    expect(timers.pending.size).toBe(1);
    expect(publications).toBe(0);

    timers.flushOne();
    expect(lease.session.getSnapshot().lines.map(({ id }) => id)).toEqual(["l2", "l3"]);
    expect(timers.pending.size).toBe(1);
    timers.flushOne();
    expect(lease.session.getSnapshot().lines.map(({ id }) => id)).toEqual(["l2", "l3", "l4"]);
    expect(lease.session.getSnapshot().gaps.older).toBe(true);

    transport.followRequests[0]?.callbacks.onMalformedFrame();
    timers.flushOne();
    expect(lease.session.getSnapshot().gaps).toEqual({ older: true, newer: true });
  });

  it("fences late page and socket callbacks, then erases public state on idempotent account shutdown", async () => {
    const { registry, transport, timers } = harness();
    const latePage = deferred<BuildLogTransportPage>();
    transport.pages.push(latePage.promise);
    const lease = registry.acquire(PROJECT, QUERY, { follow: true });
    const beforeShutdown = lease.session.getSnapshot();

    registry.shutdown();
    registry.shutdown();
    latePage.resolve({ lines: [line("late", "signed=https://secret")], rejectedItems: 0 });
    await lease.session.drain();
    timers.flushOne();

    expect(beforeShutdown.status).toBe("loading");
    expect(lease.session.getSnapshot()).toEqual({
      lines: [],
      bytes: 0,
      status: "idle",
      cursor: { oldestLineId: null, newestLineId: null },
      gaps: { older: false, newer: false },
      truncation: { lines: 0, bytes: 0 },
      error: null,
    });
    expect(transport.shutdownCalls).toBe(1);
    expect(registry.diagnostics()).toEqual({ activeSessions: 0, leases: 0, closed: true });
    expect(JSON.stringify(lease.session.getSnapshot())).not.toContain("secret");
    expect(() => registry.acquire(PROJECT, QUERY)).toThrow(BuildLogRegistryError);
  });

  it("aborts pending transport work a grace after the final lease releases", async () => {
    const { registry, transport, timers } = harness();
    const latePage = deferred<BuildLogTransportPage>();
    transport.pages.push(latePage.promise);
    const first = registry.acquire(PROJECT, QUERY, { follow: true });
    const second = registry.acquire(PROJECT, QUERY, { follow: true });
    const signal = transport.pageRequests[0]?.signal;

    first.release();
    expect(signal?.aborted).toBe(false);
    second.release();
    expect(signal?.aborted).toBe(false);
    timers.flushOne();
    expect(signal?.aborted).toBe(true);
    expect(registry.diagnostics()).toEqual({ activeSessions: 0, leases: 0, closed: false });

    latePage.resolve({ lines: [line("late")], rejectedItems: 0 });
    await first.session.drain();
    expect(first.session.getSnapshot().lines).toEqual([]);
    registry.shutdown();
  });

  it("ignores late callbacks from a previously opened socket after account shutdown", async () => {
    const { registry, transport, timers } = harness();
    transport.pages.push({ lines: [], rejectedItems: 0 });
    const lease = registry.acquire(PROJECT, QUERY, { follow: true });
    await registry.drain();
    const callbacks = transport.followRequests[0]!.callbacks;

    registry.shutdown();
    callbacks.onLines([line("late", "https://logs.example.test/?signature=secret")], 0);
    callbacks.onMalformedFrame();
    callbacks.onError();
    callbacks.onClose();
    timers.flushOne();

    expect(lease.session.getSnapshot().lines).toEqual([]);
    expect(JSON.stringify(lease.session.getSnapshot())).not.toContain("signature");
    expect(transport.followers[0]?.closeCalls).toBe(1);
  });

  // A log kept only for its grace never holds a seat another build asks for:
  // at capacity it closes at once, and the one asked for opens (pass 36).
  it.each([
    { name: "one only kept for its grace gives way", held: false, opens: true },
    { name: "one still held does not", held: true, opens: false },
  ])("at capacity, a build's log asked for: $name", async ({ held, opens }) => {
    const { registry, transport } = harness(undefined, { activeLogSessionsPerAccount: 1 });
    transport.pages.push({ lines: [], rejectedItems: 0 }, { lines: [], rejectedItems: 0 });
    const first = registry.acquire(PROJECT, QUERY);
    await registry.drain();
    if (!held) first.release();
    const other = { ...QUERY, appVersionId: "version-2" };
    if (!opens) {
      expect(() => registry.acquire(PROJECT, other)).toThrow(BuildLogRegistryError);
      return;
    }
    const next = registry.acquire(PROJECT, other);
    await registry.drain();
    expect(next.session === first.session).toBe(false);
    expect(registry.diagnostics()).toMatchObject({ activeSessions: 1, leases: 1 });
    expect(transport.pageRequests).toHaveLength(2);
  });

  it("rejects a log over capacity with a sanitized error", async () => {
    const { registry, transport } = harness(undefined, { activeLogSessionsPerAccount: 1 });
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
});

describe("build log access lifetime", () => {
  it("rejects a project the store withholds before loading", () => {
    const { registry, transport, access } = harness();
    access.denied.add(PROJECT);
    expect(() => registry.acquire(PROJECT, QUERY)).toThrow(BuildLogRegistryError);
    expect(transport.pageRequests).toHaveLength(0);
  });

  it.each(["reconciled", "noticed by a late frame"] as const)(
    "erases and cancels open logs once their project is withheld, %s",
    async (how) => {
      const { registry, transport, access, timers } = harness();
      transport.pages.push({ lines: [line("l1")], rejectedItems: 0 });
      const lease = registry.acquire(PROJECT, QUERY, { follow: true });
      await registry.drain();
      let notices = 0;
      lease.session.subscribe(() => notices++);
      access.denied.add(PROJECT);
      if (how === "reconciled") registry.reconcileAccess();
      else {
        transport.emit(0, [line("late")]);
        timers.flushOne();
        registry.reconcileAccess();
      }
      expect(lease.session.getSnapshot()).toMatchObject({
        lines: [],
        bytes: 0,
        status: "error",
        error: "access",
      });
      expect(notices).toBe(1);
      expect(transport.followers[0]?.closed).toBe(true);
      expect(transport.pageRequests[0]?.signal?.aborted).toBe(true);
      expect(registry.diagnostics().activeSessions).toBe(0);
      lease.setFollow(true);
      transport.emit(0, [line("late")]);
      expect(transport.pageRequests).toHaveLength(1);
      expect(transport.followRequests).toHaveLength(1);
      expect(lease.session.getSnapshot().lines).toEqual([]);
      expect(() => registry.acquire(PROJECT, QUERY)).toThrow(BuildLogRegistryError);
      registry.shutdown();
    },
  );

  it("does not reconcile access or notify listeners from getSnapshot alone", async () => {
    const { registry, transport, access } = harness();
    transport.pages.push({ lines: [line("l1")], rejectedItems: 0 });
    const lease = registry.acquire(PROJECT, QUERY, { follow: true });
    await registry.drain();
    let notices = 0;
    lease.session.subscribe(() => notices++);
    access.denied.add(PROJECT);
    lease.session.getSnapshot();
    lease.session.getSnapshot();
    expect(notices).toBe(0);
    expect(registry.diagnostics().activeSessions).toBe(1);
    registry.reconcileAccess();
    expect(notices).toBe(1);
    expect(registry.diagnostics().activeSessions).toBe(0);
  });

  it("ignores a pending page after revocation and keeps renewed sessions independent of old leases", async () => {
    const { registry, transport, access } = harness();
    const page = deferred<BuildLogTransportPage>();
    transport.pages.push(page.promise);
    const old = registry.acquire(PROJECT, QUERY, { follow: true });
    access.denied.add(PROJECT);
    registry.reconcileAccess();
    access.denied.delete(PROJECT);
    const fresh = registry.acquire(PROJECT, QUERY);
    old.release();
    expect(registry.diagnostics().activeSessions).toBe(1);
    page.resolve({ lines: [line("late")], rejectedItems: 0 });
    await old.session.drain();
    await registry.drain();
    expect(old.session.getSnapshot().lines).toEqual([]);
    expect(fresh.session).not.toBe(old.session);
    expect(transport.followRequests).toHaveLength(0);
    registry.shutdown();
  });
});

describe("the account's build logs", () => {
  it("erase a project's log the moment the account's store withholds the project", async () => {
    const store = makeAccountStore(AtomRegistry.make());
    liveZerops({ running: [], projects: [{ id: PROJECT }] }).forEach(store.dispatch);
    const transport = new FakeTransport();
    transport.pages.push({ lines: [line("l1")], rejectedItems: 0 });
    const timers = new ManualTimers();
    const logs = makeAccountBuildLogs({
      store,
      transport,
      setTimer: timers.set,
      clearTimer: timers.clear,
    });
    const lease = logs.acquire(PROJECT, QUERY);
    await logs.drain();
    expect(lease.session.getSnapshot().lines.map(({ id }) => id)).toEqual(["l1"]);

    store.dispatch({ kind: "access", family: "project", id: PROJECT, access: "denied" });
    expect(lease.session.getSnapshot()).toMatchObject({ lines: [], error: "access" });
    expect(() => logs.acquire(PROJECT, QUERY)).toThrow(BuildLogRegistryError);

    logs.shutdown();
    expect(transport.shutdownCalls).toBe(1);
  });
});
