import { act, StrictMode, useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { BuildLogLine, BuildLogQuery } from "@t3tools/client-runtime/zerops/activity/buildLog";
import {
  AccountEpoch,
  makeZeropsApiOrigin,
  ZeropsAccountId,
  ZeropsOrganizationId,
  ZeropsProjectId,
  type BuildLogLease,
  type BuildLogRegistry,
  type BuildLogSnapshot,
  type ManagedZeropsDataRuntime,
  type ProjectRef,
  type SharedBuildLogSession,
} from "@t3tools/client-runtime/zerops/data";

import { InventoryContext, type Inventory } from "../inventoryContext";
import { ZeropsDataContext, type ZeropsDataContextValue } from "../zeropsDataContext";

class TestNode {
  parentNode: TestNode | null = null;
  childNodes: TestNode[] = [];
  readonly nodeName: string;
  readonly tagName: string;
  readonly namespaceURI = "http://www.w3.org/1999/xhtml";
  readonly style = {};

  constructor(
    name: string,
    readonly ownerDocument: TestNode | null = null,
    readonly nodeType = 1,
  ) {
    this.nodeName = name.toUpperCase();
    this.tagName = this.nodeName;
  }

  set textContent(_value: string) {
    this.childNodes = [];
  }

  appendChild(child: TestNode) {
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  removeChild(child: TestNode) {
    this.childNodes.splice(this.childNodes.indexOf(child), 1);
    child.parentNode = null;
    return child;
  }

  createElement(name: string) {
    return new TestNode(name, this);
  }

  get activeElement(): null {
    return null;
  }

  addEventListener() {}
  removeEventListener() {}
  setAttribute() {}
}

function installTestDom(): void {
  const document = new TestNode("#document", null, 9);
  const window = {
    document,
    HTMLIFrameElement: TestNode,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    addEventListener() {},
    removeEventListener() {},
  };
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", window);
  vi.stubGlobal("HTMLIFrameElement", window.HTMLIFrameElement);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
}

const account = {
  apiOrigin: makeZeropsApiOrigin("https://api.example.test"),
  accountId: ZeropsAccountId.make("account-1"),
};
const organization = {
  kind: "organization" as const,
  account,
  organizationId: ZeropsOrganizationId.make("org-1"),
};
const PROJECT: ProjectRef = {
  kind: "project",
  organization,
  projectId: ZeropsProjectId.make("project-1"),
};
const QUERY: BuildLogQuery = { buildServiceStackId: "build-1", appVersionId: "version-1" };

const snapshot = (
  status: BuildLogSnapshot["status"],
  lines: ReadonlyArray<BuildLogLine> = [],
): BuildLogSnapshot => ({
  lines,
  bytes: 0,
  status,
  loadingOlder: false,
  cursor: {
    oldestLineId: lines.at(0)?.id ?? null,
    newestLineId: lines.at(-1)?.id ?? null,
  },
  gaps: { older: false, newer: false },
  truncation: { lines: 0, bytes: 0 },
  error: null,
});

class FakeSession implements SharedBuildLogSession {
  #snapshot: BuildLogSnapshot;
  readonly #listeners = new Set<() => void>();

  constructor(follow: boolean) {
    this.#snapshot = snapshot(follow ? "live" : "ended");
  }

  getSnapshot(): BuildLogSnapshot {
    return this.#snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  loadOlder(): Promise<void> {
    return Promise.resolve();
  }

  retry(): Promise<void> {
    return Promise.resolve();
  }

  drain(): Promise<void> {
    return Promise.resolve();
  }

  setFollow(follow: boolean): void {
    this.#publish(snapshot(follow ? "live" : "ended", this.#snapshot.lines));
  }

  emit(lines: ReadonlyArray<BuildLogLine>): void {
    this.#publish(snapshot(this.#snapshot.status, lines));
  }

  #publish(next: BuildLogSnapshot): void {
    this.#snapshot = next;
    for (const listener of this.#listeners) listener();
  }
}

interface FakeLeaseRecord {
  readonly project: ProjectRef;
  readonly query: BuildLogQuery;
  readonly session: FakeSession;
  readonly followChanges: boolean[];
  released: boolean;
}

class FakeLogs implements BuildLogRegistry {
  reconcileAccess() {}
  readonly records: FakeLeaseRecord[] = [];
  failAcquire = false;
  closed = false;

  acquire(
    project: ProjectRef,
    query: BuildLogQuery,
    options: { readonly follow?: boolean } = {},
  ): BuildLogLease {
    if (this.failAcquire) throw new Error("signed=https://secret.invalid");
    const session = new FakeSession(options.follow ?? false);
    const record: FakeLeaseRecord = {
      project,
      query,
      session,
      followChanges: [options.follow ?? false],
      released: false,
    };
    this.records.push(record);
    return {
      session,
      setFollow: (follow) => {
        if (record.released) return;
        record.followChanges.push(follow);
        session.setFollow(follow);
      },
      loadOlder: () => session.loadOlder(),
      retry: () => session.retry(),
      release: () => {
        if (record.released) return;
        record.released = true;
      },
    };
  }

  drain(): Promise<void> {
    return Promise.resolve();
  }

  diagnostics() {
    return {
      activeSessions: this.records.filter(({ released }) => !released).length,
      leases: this.records.filter(({ released }) => !released).length,
      closed: this.closed,
    };
  }

  shutdown(): void {
    this.closed = true;
    for (const record of this.records) record.released = true;
  }

  active(): FakeLeaseRecord {
    return this.records.findLast(({ released }) => !released)!;
  }
}

function inventory(project: ProjectRef | null = PROJECT): Inventory {
  return {
    projects: [],
    services: new Map(),
    isLoading: false,
    error: null,
    projectRefs: project === null ? new Map() : new Map([[project.projectId, project]]),
  };
}

function runtime(logs: FakeLogs, epoch = 1): ManagedZeropsDataRuntime {
  return {
    logs,
    scope: { account, epoch: AccountEpoch.make(epoch) },
  } as unknown as ManagedZeropsDataRuntime;
}

function context(value: ManagedZeropsDataRuntime): ZeropsDataContextValue {
  return {
    runtime: value,
    organizationRef: () => organization,
    projectRef: () => PROJECT,
  };
}

async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useBuildLog runtime lease binding", () => {
  it("releases the StrictMode probe lease and retains one active lease", async () => {
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const { useBuildLog } = await import("./useBuildLog.ts");
    const logs = new FakeLogs();
    const managed = runtime(logs);
    const onResult = vi.fn();

    function Probe() {
      const result = useBuildLog({ projectId: "project-1", query: QUERY, live: false });
      useEffect(() => onResult(result), [result]);
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    try {
      await act(() => {
        root.render(
          <StrictMode>
            <ZeropsDataContext value={context(managed)}>
              <InventoryContext value={inventory()}>
                <Probe />
              </InventoryContext>
            </ZeropsDataContext>
          </StrictMode>,
        );
      });
      await flushEffects();

      expect(logs.records).toHaveLength(2);
      expect(logs.records[0]?.released).toBe(true);
      expect(logs.diagnostics().leases).toBe(1);
      expect(onResult.mock.calls.at(-1)?.[0].status).toBe("ended");
    } finally {
      await act(() => root.unmount());
    }
    expect(logs.diagnostics().leases).toBe(0);
  });

  it("forwards follow changes without reacquiring and receives later shared-session publication", async () => {
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const { useBuildLog } = await import("./useBuildLog.ts");
    const logs = new FakeLogs();
    const managed = runtime(logs);
    const onResult = vi.fn();

    function Probe({ live }: { readonly live: boolean }) {
      const result = useBuildLog({ projectId: "project-1", query: QUERY, live });
      useEffect(() => onResult(result), [result]);
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    const render = (live: boolean) => (
      <ZeropsDataContext value={context(managed)}>
        <InventoryContext value={inventory()}>
          <Probe live={live} />
        </InventoryContext>
      </ZeropsDataContext>
    );
    try {
      await act(() => root.render(render(false)));
      await flushEffects();
      const acquisitions = logs.records.length;

      await act(() => root.render(render(true)));
      await flushEffects();
      expect(logs.records).toHaveLength(acquisitions);
      expect(logs.active().followChanges.at(-1)).toBe(true);
      expect(onResult.mock.calls.at(-1)?.[0].status).toBe("live");

      const observed = [{ id: "l1", at: "2026-09-08T00:00:00.000Z", text: "built", severity: 6 }];
      await act(() => logs.active().session.emit(observed));
      expect(onResult.mock.calls.at(-1)?.[0].lines).toEqual(observed);
    } finally {
      await act(() => root.unmount());
    }
  });

  it("releases on runtime replacement and does not expose the old account session during the change", async () => {
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const { useBuildLog } = await import("./useBuildLog.ts");
    const firstLogs = new FakeLogs();
    const secondLogs = new FakeLogs();
    const firstRuntime = runtime(firstLogs, 1);
    const secondRuntime = runtime(secondLogs, 2);
    const onResult = vi.fn();

    function Probe() {
      const result = useBuildLog({ projectId: "project-1", query: QUERY, live: false });
      useEffect(() => onResult(result), [result]);
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    const render = (managed: ManagedZeropsDataRuntime) => (
      <ZeropsDataContext value={context(managed)}>
        <InventoryContext value={inventory()}>
          <Probe />
        </InventoryContext>
      </ZeropsDataContext>
    );
    try {
      await act(() => root.render(render(firstRuntime)));
      await flushEffects();
      await act(() => root.render(render(secondRuntime)));
      await flushEffects();

      expect(firstLogs.diagnostics().leases).toBe(0);
      expect(secondLogs.diagnostics().leases).toBe(1);
      expect(onResult.mock.calls.some(([result]) => result.status === "idle")).toBe(true);
      expect(onResult.mock.calls.at(-1)?.[0].status).toBe("ended");
    } finally {
      await act(() => root.unmount());
    }
  });

  it("stays idle without a unique inventory ProjectRef and sanitizes lease admission failure", async () => {
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const { useBuildLog } = await import("./useBuildLog.ts");
    const logs = new FakeLogs();
    const managed = runtime(logs);
    const onResult = vi.fn();

    function Probe() {
      const result = useBuildLog({
        projectId: "project-1",
        query: QUERY,
        live: false,
      });
      useEffect(() => onResult(result), [result]);
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    const render = (value: Inventory) => (
      <ZeropsDataContext value={context(managed)}>
        <InventoryContext value={value}>
          <Probe />
        </InventoryContext>
      </ZeropsDataContext>
    );
    try {
      await act(() => root.render(render(inventory(null))));
      await flushEffects();
      expect(logs.records).toHaveLength(0);
      expect(onResult.mock.calls.at(-1)?.[0].status).toBe("idle");

      logs.failAcquire = true;
      await act(() => root.render(render(inventory())));
      await flushEffects();
      expect(onResult.mock.calls.at(-1)?.[0].status).toBe("error");
    } finally {
      await act(() => root.unmount());
    }
  });
});
