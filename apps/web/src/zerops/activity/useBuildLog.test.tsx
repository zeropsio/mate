/**
 * `useBuildLog` under `React.StrictMode` — `main.tsx` wraps the whole app in
 * it. Session creation used to happen inline in the render body (a side
 * effect during render, which StrictMode's dev-mode double-render then runs
 * twice) with only a cleanup-only mount effect (no setup logic to recreate
 * what StrictMode's simulated unmount tears down). The observable failure
 * mode is not always "stuck forever" — `useSyncExternalStore`'s own
 * snapshot-mismatch recovery can paper over a dropped subscription by
 * forcing a fresh render — but it does reliably show up as duplicate,
 * uncoordinated work: two backfill fetches and, in some interleavings, two
 * sockets for what is a single mount from the caller's perspective.
 *
 * No `@testing-library/react` in this repo — mirrors
 * `components/preview/PreviewView.test.tsx`'s own minimal DOM stub +
 * `react-dom/client` + `act` harness (the default test environment is
 * `node`, not `jsdom`).
 */
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { ZeropsApiClient } from "@t3tools/client-runtime/zerops";
import type { BuildLogQuery } from "@t3tools/client-runtime/zerops/activity/buildLog";

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

function installTestDom(): TestNode {
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
  return document;
}

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readonly url: string;
  #onMessage: ((event: { readonly data: unknown }) => void) | undefined;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: "message", listener: (event: { readonly data: unknown }) => void): void;
  addEventListener(type: "error" | "close", listener: () => void): void;
  addEventListener(
    type: "message" | "error" | "close",
    listener: ((event: { readonly data: unknown }) => void) | (() => void),
  ): void {
    if (type === "message") {
      this.#onMessage = listener as (event: { readonly data: unknown }) => void;
    }
  }

  emit(items: ReadonlyArray<unknown>): void {
    this.#onMessage?.({ data: JSON.stringify({ items }) });
  }

  close() {}
}

function fakeClient(): { readonly client: ZeropsApiClient; readonly logAccessCalls: number[] } {
  const logAccessCalls: number[] = [];
  const client = {
    fetchProjectLogAccess: async () => {
      logAccessCalls.push(logAccessCalls.length);
      return { url: "https://log.example.com/api/rest/log?sig=1" };
    },
  } as unknown as ZeropsApiClient;
  return { client, logAccessCalls };
}

const QUERY: BuildLogQuery = { buildServiceStackId: "build-svc-1", appVersionId: "av-1" };

async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) {
      await Promise.resolve();
    }
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeWebSocket.instances = [];
});

describe("useBuildLog — session lifecycle under React.StrictMode", () => {
  /**
   * `BuildLogSession.#backfill` already guards on `#disposed` after every
   * await, so a stray extra session from StrictMode's inherent double-invoke
   * of any resource-creating effect (expected, dev-only — React itself does
   * this to every well-written effect) does not raise the *raw* log fetch
   * count as a reliable signal. What is a real, avoidable defect is calling
   * `fetchProjectLogAccess` more than once per mount: `resolveLogAccess`'s
   * module-scope cache exists precisely so a second session for the same
   * (project, client) reuses the first's in-flight/resolved access rather
   * than issuing its own request.
   */
  it("resolves log access exactly once per mount, even across StrictMode's double-invoke", async () => {
    installTestDom();
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => ({
        items: [{ id: "l1", timestamp: "2026-09-02T10:00:00.000Z", content: "hi", severity: 6 }],
      }),
    }));
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { useBuildLog } = await import("./useBuildLog.ts");

    const { client, logAccessCalls } = fakeClient();
    const statuses: string[] = [];

    function Probe() {
      const result = useBuildLog({ client, projectId: "proj-1", query: QUERY, live: false });
      statuses.push(result.status);
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    try {
      await act(() => {
        root.render(React.createElement(React.StrictMode, null, React.createElement(Probe)));
      });
      await flushMicrotasks();

      expect(logAccessCalls).toHaveLength(1);
      // A session that got stuck disposed (never recreated) after
      // StrictMode's double-invoke would sit at "idle" forever — this must
      // reach the backfill's terminal status.
      expect(statuses.at(-1)).toBe("ended");
    } finally {
      await act(() => root.unmount());
    }
  });

  it("opens exactly one WebSocket for a live mount under StrictMode", async () => {
    installTestDom();
    vi.stubGlobal("fetch", async () => ({ ok: true, json: async () => ({ items: [] }) }));
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { useBuildLog } = await import("./useBuildLog.ts");

    const { client } = fakeClient();
    const statuses: string[] = [];

    function Probe() {
      const result = useBuildLog({ client, projectId: "proj-1", query: QUERY, live: true });
      statuses.push(result.status);
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    try {
      await act(() => {
        root.render(React.createElement(React.StrictMode, null, React.createElement(Probe)));
      });
      await flushMicrotasks();

      expect(statuses.at(-1)).toBe("live");
      expect(FakeWebSocket.instances).toHaveLength(1);
    } finally {
      await act(() => root.unmount());
    }
  });

  it("keeps the subscription alive across the double-invoke — a later message still reaches the component", async () => {
    installTestDom();
    vi.useFakeTimers();
    vi.stubGlobal("fetch", async () => ({ ok: true, json: async () => ({ items: [] }) }));
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { useBuildLog } = await import("./useBuildLog.ts");

    const { client } = fakeClient();
    let latest: { lines: unknown; status: string } | undefined;

    function Probe() {
      latest = useBuildLog({ client, projectId: "proj-1", query: QUERY, live: true });
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    try {
      await act(() => {
        root.render(React.createElement(React.StrictMode, null, React.createElement(Probe)));
      });
      await act(async () => {
        for (let i = 0; i < 10; i += 1) {
          await Promise.resolve();
        }
      });
      expect(latest?.status).toBe("live");

      FakeWebSocket.instances[0]?.emit([
        { id: "l1", timestamp: "2026-09-02T10:00:00.000Z", content: "hi", severity: 6 },
      ]);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });

      expect(latest?.lines).toEqual([
        { id: "l1", at: "2026-09-02T10:00:00.000Z", text: "hi", severity: 6 },
      ]);
    } finally {
      await act(() => root.unmount());
      vi.useRealTimers();
    }
  });
});
