import { describe, expect, it } from "vite-plus/test";

import { buildLogLineBytes, type BuildLogLine } from "../activity/buildLog.ts";
import { project, scope, verifiedAccess, grant } from "./__fixtures__/index.ts";
import type {
  BuildLogFollowHandle,
  BuildLogFollowRequest,
  BuildLogPageRequest,
  BuildLogTransport,
  BuildLogTransportPage,
} from "./logTransport.ts";
import { BuildLogTransportError } from "./logTransport.ts";
import { BuildLogRegistryError, buildLogSessionKeyOf, makeBuildLogRegistry } from "./logs.ts";
import { makeZeropsDataPolicy } from "./policy.ts";
import { ZeropsAccountId, ZeropsOrganizationId, type AccessState } from "./types.ts";

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

function harness(
  transport = new FakeTransport(),
  overrides: Parameters<typeof makeZeropsDataPolicy>[0] = {},
) {
  const timers = new ManualTimers();
  const otherProject = {
    ...project(),
    organization: { ...project().organization, organizationId: ZeropsOrganizationId.make("org-2") },
  };
  const access: { current: AccessState } = {
    current: {
      ...verifiedAccess(),
      status: "verified",
      ...grant(),
      organizations: [
        ...grant().organizations,
        { organization: otherProject.organization, mutationsAllowed: true },
      ],
      projects: [
        ...grant().projects,
        { project: otherProject, role: "OWNER", mutationsAllowed: true },
      ],
    },
  };
  const registry = makeBuildLogRegistry({
    scope: scope(),
    access: () => access.current,
    now: () => timers.now,
    transport,
    policy: makeZeropsDataPolicy(overrides),
    setTimer: timers.set,
    clearTimer: timers.clear,
  });
  return { registry, transport, timers, access };
}

describe("shared build log registry", () => {
  it("keys by the full ProjectRef and filter, shares ref-counted sessions, and disposes on last release", async () => {
    const { registry, transport } = harness();
    transport.pages.push({ lines: [line("l1")], rejectedItems: 0 });
    const first = registry.acquire(project(), QUERY, { follow: true });
    const second = registry.acquire(project(), { ...QUERY }, { follow: true });
    await registry.drain();

    expect(first.session).toBe(second.session);
    expect(transport.pageRequests).toHaveLength(1);
    expect(transport.followRequests).toHaveLength(1);
    expect(registry.diagnostics()).toEqual({ activeSessions: 1, leases: 2, closed: false });

    const otherOrganization = {
      ...project(),
      organization: {
        ...project().organization,
        organizationId: ZeropsOrganizationId.make("org-2"),
      },
    };
    transport.pages.push({ lines: [], rejectedItems: 0 }, { lines: [], rejectedItems: 0 });
    const otherProjectLease = registry.acquire(otherOrganization, QUERY);
    const otherFilterLease = registry.acquire(project(), {
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
    expect(registry.diagnostics().activeSessions).toBe(2);
    otherProjectLease.release();
    otherFilterLease.release();
    expect(registry.diagnostics().activeSessions).toBe(0);

    expect(buildLogSessionKeyOf(project(), QUERY)).not.toBe(
      buildLogSessionKeyOf(otherOrganization, QUERY),
    );
    expect(buildLogSessionKeyOf(project(), QUERY)).not.toBe(
      buildLogSessionKeyOf(project(), { ...QUERY, fromIso: "2026-09-08T00:00:00.000Z" }),
    );
  });

  it("ORs follow demand across leases and reopens once with the latest retained cursor", async () => {
    const { registry, transport, timers } = harness();
    transport.pages.push({ lines: [line("l1")], rejectedItems: 0 });
    const passive = registry.acquire(project(), QUERY);
    const follower = registry.acquire(project(), QUERY, { follow: true });
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

  it("retries a rejected grant without retaining its error and reacquires successfully", async () => {
    const { registry, transport } = harness();
    transport.nextPageError = new BuildLogTransportError("grant");
    const lease = registry.acquire(project(), QUERY);
    await registry.drain();

    expect(lease.session.getSnapshot().status).toBe("error");
    expect(lease.session.getSnapshot().error).toBe("access");
    expect(JSON.stringify(lease.session.getSnapshot())).not.toContain("http");

    transport.pages.push({ lines: [line("l1")], rejectedItems: 0 });
    await lease.retry();
    expect(lease.session.getSnapshot().status).toBe("ended");
    expect(lease.session.getSnapshot().error).toBeNull();
    expect(transport.pageRequests).toHaveLength(2);
  });

  it("bounds lines and bytes while publishing explicit cursor, gaps and truncation", async () => {
    const maxBytes = buildLogLineBytes(line("l2")) + buildLogLineBytes(line("l3"));
    const { registry, transport } = harness(undefined, {
      retainedLogLinesPerSession: 2,
      retainedLogBytesPerSession: maxBytes,
    });
    transport.pages.push({ lines: [line("l1"), line("l2"), line("l3")], rejectedItems: 0 });
    const lease = registry.acquire(project(), QUERY);
    await registry.drain();

    const snapshot = lease.session.getSnapshot();
    expect(snapshot.lines.map(({ id }) => id)).toEqual(["l2", "l3"]);
    expect(snapshot.bytes).toBeLessThanOrEqual(maxBytes);
    expect(snapshot.cursor).toEqual({ oldestLineId: "l2", newestLineId: "l3" });
    expect(snapshot.gaps).toEqual({ older: true, newer: false });
    expect(snapshot.truncation.lines).toBe(1);
  });

  it("deduplicates overlapping older pages and moves the bounded cursor toward history", async () => {
    const { registry, transport } = harness(undefined, { retainedLogLinesPerSession: 3 });
    transport.pages.push(
      { lines: [line("l3"), line("l4")], rejectedItems: 0 },
      { lines: [line("l1"), line("l2"), line("l3")], rejectedItems: 0 },
    );
    const lease = registry.acquire(project(), QUERY);
    await registry.drain();
    await lease.loadOlder();

    expect(transport.pageRequests[1]?.beforeLineId).toBe("l3");
    expect(lease.session.getSnapshot().lines.map(({ id }) => id)).toEqual(["l1", "l2", "l3"]);
    expect(lease.session.getSnapshot().cursor).toEqual({
      oldestLineId: "l1",
      newestLineId: "l3",
    });
    expect(lease.session.getSnapshot().gaps.newer).toBe(true);
    expect(lease.session.getSnapshot().truncation.lines).toBe(1);
  });

  it("coalesces follow publication at 100ms and keeps its pending queue bounded", async () => {
    const { registry, transport, timers } = harness(undefined, {
      logPublicationCoalescingMs: 100,
      logPublishBatchLines: 2,
      retainedLogLinesPerSession: 3,
    });
    transport.pages.push({ lines: [], rejectedItems: 0 });
    const lease = registry.acquire(project(), QUERY, { follow: true });
    await registry.drain();
    let publications = 0;
    lease.session.subscribe(() => {
      publications += 1;
    });

    transport.emit(0, [line("l1"), line("l2"), line("l3"), line("l4")]);
    expect(lease.session.getSnapshot().lines).toEqual([]);
    expect(timers.pending.size).toBe(2);
    expect(publications).toBe(0);

    timers.flushOne();
    expect(lease.session.getSnapshot().lines.map(({ id }) => id)).toEqual(["l2", "l3"]);
    expect(timers.pending.size).toBe(2);
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
    const lease = registry.acquire(project(), QUERY, { follow: true });
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
      loadingOlder: false,
      cursor: { oldestLineId: null, newestLineId: null },
      gaps: { older: false, newer: false },
      truncation: { lines: 0, bytes: 0 },
      error: null,
    });
    expect(transport.shutdownCalls).toBe(1);
    expect(registry.diagnostics()).toEqual({ activeSessions: 0, leases: 0, closed: true });
    expect(JSON.stringify(lease.session.getSnapshot())).not.toContain("secret");
    expect(() => registry.acquire(project(), QUERY)).toThrow(BuildLogRegistryError);
  });

  it("aborts pending transport work when the final lease releases", async () => {
    const { registry, transport } = harness();
    const latePage = deferred<BuildLogTransportPage>();
    transport.pages.push(latePage.promise);
    const first = registry.acquire(project(), QUERY, { follow: true });
    const second = registry.acquire(project(), QUERY, { follow: true });
    const signal = transport.pageRequests[0]?.signal;

    first.release();
    expect(signal?.aborted).toBe(false);
    second.release();
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
    const lease = registry.acquire(project(), QUERY, { follow: true });
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

  it("rejects foreign accounts and session over-capacity with sanitized errors", async () => {
    const { registry, transport } = harness(undefined, { activeLogSessionsPerAccount: 1 });
    transport.pages.push({ lines: [], rejectedItems: 0 });
    registry.acquire(project(), QUERY);
    expect(() => registry.acquire(project(), { ...QUERY, appVersionId: "version-2" })).toThrow(
      BuildLogRegistryError,
    );

    const foreign = project();
    const foreignProject = {
      ...foreign,
      organization: {
        ...foreign.organization,
        account: {
          ...foreign.organization.account,
          accountId: ZeropsAccountId.make("other"),
        },
      },
    };
    let error: unknown;
    try {
      registry.acquire(foreignProject, QUERY);
    } catch (cause) {
      error = cause;
    }
    expect(error).toBeInstanceOf(BuildLogRegistryError);
    expect(String(error)).not.toContain("https://");
    await registry.drain();
  });
});

describe("build log access lifetime", () => {
  it.each(["unverified", "revoked", "deadline"] as const)(
    "rejects %s access before loading",
    (reason) => {
      const { registry, transport, access, timers } = harness();
      if (reason === "unverified") access.current = { status: "unverified" };
      else if (reason === "revoked")
        access.current = { status: "verified", ...grant(), projects: [] };
      else timers.now = grant().deadlineMs;
      expect(() => registry.acquire(project(), QUERY)).toThrow(BuildLogRegistryError);
      expect(transport.pageRequests).toHaveLength(0);
    },
  );

  it.each(["revoked", "expiry timer", "throttled timer"] as const)(
    "erases and cancels open logs after %s",
    async (reason) => {
      const { registry, transport, access, timers } = harness();
      transport.pages.push({ lines: [line("l1")], rejectedItems: 0 });
      const lease = registry.acquire(project(), QUERY, { follow: true });
      await registry.drain();
      let notices = 0;
      lease.session.subscribe(() => notices++);
      if (reason === "revoked") {
        access.current = { status: "verified", ...grant(), projects: [] };
        registry.reconcileAccess();
      } else if (reason === "expiry timer") timers.flushOne();
      else {
        timers.now = grant().deadlineMs;
        transport.emit(0, [line("late")]);
        timers.flushOne();
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
      await lease.retry();
      await lease.loadOlder();
      lease.setFollow(true);
      transport.emit(0, [line("late")]);
      expect(transport.pageRequests).toHaveLength(1);
      expect(transport.followRequests).toHaveLength(1);
      expect(lease.session.getSnapshot().lines).toEqual([]);
      expect(() => registry.acquire(project(), QUERY)).toThrow(BuildLogRegistryError);
      registry.shutdown();
    },
  );

  it("does not reconcile access or notify listeners from getSnapshot alone", async () => {
    const { registry, transport, access } = harness();
    transport.pages.push({ lines: [line("l1")], rejectedItems: 0 });
    const lease = registry.acquire(project(), QUERY, { follow: true });
    await registry.drain();
    let notices = 0;
    lease.session.subscribe(() => notices++);
    access.current = { status: "verified", ...grant(), projects: [] };
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
    const old = registry.acquire(project(), QUERY, { follow: true });
    access.current = { status: "verified", ...grant(), projects: [] };
    registry.reconcileAccess();
    access.current = verifiedAccess();
    const fresh = registry.acquire(project(), QUERY);
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
