import { act, StrictMode, useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { BuildLogLine, BuildLogQuery } from "@t3tools/client-runtime/zerops/activity/buildLog";
import {
  makeAccountBuildLogs,
  makeAccountStore,
  makeBuildLogTransport,
  type BuildLogLease,
  type BuildLogRegistry,
  type BuildLogSnapshot,
} from "@t3tools/client-runtime/data";
import { AtomRegistry } from "effect/unstable/reactivity";

import type { AccountData } from "../ZeropsAccountData";

/** The account mounted around the hook: only its logs are read. */
const mounted = vi.hoisted(() => ({ logs: null as unknown }));
vi.mock("../ZeropsAccountData", () => ({
  useAccountDataOptional: () =>
    mounted.logs === null ? null : ({ logs: mounted.logs } as unknown as AccountData),
}));

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

const QUERY: BuildLogQuery = { buildServiceStackId: "build-1", appVersionId: "version-1" };

const snapshot = (
  status: BuildLogSnapshot["status"],
  lines: ReadonlyArray<BuildLogLine> = [],
): BuildLogSnapshot => ({
  lines,
  bytes: 0,
  status,
  cursor: {
    oldestLineId: lines.at(0)?.id ?? null,
    newestLineId: lines.at(-1)?.id ?? null,
  },
  gaps: { older: false, newer: false },
  truncation: { lines: 0, bytes: 0 },
  error: null,
});

class FakeSession implements Pick<BuildLogLease["session"], "getSnapshot" | "subscribe"> {
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
  readonly projectId: string;
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
    projectId: string,
    query: BuildLogQuery,
    options: { readonly follow?: boolean } = {},
  ): BuildLogLease {
    if (this.failAcquire) throw new Error("signed=https://secret.invalid");
    const session = new FakeSession(options.follow ?? false);
    const record: FakeLeaseRecord = {
      projectId,
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

async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  mounted.logs = null;
});

describe("useBuildLog runtime lease binding", () => {
  it("releases the StrictMode probe lease and retains one active lease", async () => {
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const { useBuildLog } = await import("./useBuildLog.ts");
    const logs = new FakeLogs();
    mounted.logs = logs;
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
            <Probe />
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
    mounted.logs = logs;
    const onResult = vi.fn();

    function Probe({ live }: { readonly live: boolean }) {
      const result = useBuildLog({ projectId: "project-1", query: QUERY, live });
      useEffect(() => onResult(result), [result]);
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    const render = (live: boolean) => <Probe live={live} />;
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

  it("releases on account replacement and does not expose the old account's log during the change", async () => {
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const { useBuildLog } = await import("./useBuildLog.ts");
    const firstLogs = new FakeLogs();
    const secondLogs = new FakeLogs();
    const onResult = vi.fn();

    function Probe() {
      const result = useBuildLog({ projectId: "project-1", query: QUERY, live: false });
      useEffect(() => onResult(result), [result]);
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    const render = (logs: FakeLogs) => {
      mounted.logs = logs;
      return <Probe />;
    };
    try {
      await act(() => root.render(render(firstLogs)));
      await flushEffects();
      await act(() => root.render(render(secondLogs)));
      await flushEffects();

      expect(firstLogs.diagnostics().leases).toBe(0);
      expect(secondLogs.diagnostics().leases).toBe(1);
      expect(onResult.mock.calls.some(([result]) => result.status === "idle")).toBe(true);
      expect(onResult.mock.calls.at(-1)?.[0].status).toBe("ended");
    } finally {
      await act(() => root.unmount());
    }
  });

  it("stays idle without a project or an account and sanitizes lease admission failure", async () => {
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const { useBuildLog } = await import("./useBuildLog.ts");
    const logs = new FakeLogs();
    const onResult = vi.fn();

    function Probe({ projectId }: { readonly projectId: string | null }) {
      const result = useBuildLog({ projectId, query: QUERY, live: false });
      useEffect(() => onResult(result), [result]);
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    try {
      await act(() => root.render(<Probe projectId="project-1" />));
      await flushEffects();
      expect(onResult.mock.calls.at(-1)?.[0].status).toBe("idle");

      mounted.logs = logs;
      await act(() => root.render(<Probe projectId={null} />));
      await flushEffects();
      expect(logs.records).toHaveLength(0);
      expect(onResult.mock.calls.at(-1)?.[0].status).toBe("idle");

      logs.failAcquire = true;
      await act(() => root.render(<Probe projectId="project-1" />));
      await flushEffects();
      expect(onResult.mock.calls.at(-1)?.[0].status).toBe("error");
    } finally {
      await act(() => root.unmount());
    }
  });
});

/** The log backend's stream, as the browser opens it: its url, and the frames it answers. */
class StreamSocket {
  static opened: StreamSocket[] = [];
  readonly url: string;
  #message: ((event: { readonly data: unknown }) => void) | undefined;
  #open: (() => void) | undefined;

  constructor(url: string) {
    this.url = url;
    StreamSocket.opened.push(this);
  }

  addEventListener(type: "message", listener: (event: { readonly data: unknown }) => void): void;
  addEventListener(type: "open" | "error" | "close", listener: () => void): void;
  addEventListener(
    type: "message" | "open" | "error" | "close",
    listener: ((event: { readonly data: unknown }) => void) | (() => void),
  ): void {
    if (type === "message") this.#message = listener as (event: { readonly data: unknown }) => void;
    if (type === "open") this.#open = listener as () => void;
  }

  /** The backend accepted the stream. */
  handshake() {
    this.#open?.();
  }

  answer(
    items: ReadonlyArray<{
      readonly id: string;
      readonly timestamp: string;
      readonly message: string;
    }>,
  ) {
    this.#message?.({ data: JSON.stringify({ items }) });
  }

  close(): void {}
}

describe("useBuildLog over the account's own log registry", () => {
  // Live run, 2026-10-03: a running deploy's log was read 2 s in, the build
  // had written nothing yet, and its stream — asked from the backfill's time —
  // stood open through the whole build without a line. The slot's room stood
  // empty and "Build log" never appeared until the run settled.
  it("reads a running build's log while it runs, draws its streamed lines, and the line that plops as it settles keeps the one read", async () => {
    installTestDom();
    StreamSocket.opened = [];
    const { createRoot } = await import("react-dom/client");
    const { useBuildLog } = await import("./useBuildLog.ts");
    const pageReads: string[] = [];
    const logs = makeAccountBuildLogs({
      store: makeAccountStore(AtomRegistry.make()),
      transport: makeBuildLogTransport({
        client: {
          fetchProjectLogAccess: async () => ({
            url: "https://logs.example.test/api/rest/log?accessToken=t",
          }),
        },
        fetchImpl: async (url) => {
          pageReads.push(url);
          return { ok: true, json: async () => ({ items: [] }) };
        },
        WebSocketCtor: StreamSocket,
      }),
      setTimer: (callback) => setTimeout(callback, 0),
      clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    });
    mounted.logs = logs;
    const running: BuildLogQuery = { ...QUERY, fromIso: "2026-10-03T10:00:00.000Z" };
    const seen: Record<string, ReadonlyArray<string>> = {};
    const statuses: string[] = [];
    const record = (where: string, lines: ReadonlyArray<BuildLogLine>) => {
      seen[where] = lines.map(({ text }) => text);
    };

    function Line({ where, live }: { readonly where: string; readonly live: boolean }) {
      const { lines, status } = useBuildLog({ projectId: "project-1", query: running, live });
      useEffect(() => record(where, lines), [where, lines]);
      useEffect(() => void statuses.push(status), [status]);
      return null;
    }
    const draw = (where: string, live: boolean) => <Line key={where} live={live} where={where} />;

    const root = createRoot(document.createElement("div") as unknown as Element);
    try {
      await act(() => root.render(draw("slot", true)));
      await act(() => logs.drain());

      expect(pageReads).toHaveLength(1);
      expect(StreamSocket.opened).toHaveLength(1);
      expect(new URL(StreamSocket.opened[0]!.url).searchParams.get("from")).toBeNull();

      // Its socket stands, the backend has not accepted it: not live — a
      // stream that never handshook said "waiting" through a whole build.
      await act(() => new Promise((resolve) => setTimeout(resolve, 5)));
      expect(statuses.at(-1)).toBe("loading");

      await act(async () => {
        StreamSocket.opened[0]!.handshake();
        StreamSocket.opened[0]!.answer([
          { id: "b1", timestamp: "2026-10-03T10:00:14.000Z", message: "Installing dependencies" },
        ]);
        await new Promise((resolve) => setTimeout(resolve, 5));
      });
      expect(seen.slot).toEqual(["Installing dependencies"]);
      expect(statuses.at(-1)).toBe("live");

      // Its call settled: the line plops from the slot into the history.
      await act(() => root.render(draw("history", false)));
      await act(() => logs.drain());
      expect(seen.history).toEqual(["Installing dependencies"]);
      expect(pageReads).toHaveLength(1);
      expect(StreamSocket.opened).toHaveLength(1);
    } finally {
      await act(() => root.unmount());
      logs.shutdown();
    }
  });
});
