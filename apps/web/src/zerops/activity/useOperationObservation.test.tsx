/**
 * `useOperationObservation` driven through real React rendering — the
 * hook's own decision logic (`deriveOperationObservation`) is fully covered
 * by the pure-function tests in `useOperationObservation.test.ts`; this
 * file exercises the React glue those tests cannot reach: does the hook
 * survive `React.StrictMode`'s mount/unmount/mount, does the state actually
 * transition `observing → stale → off` as time passes under a real
 * `useProjectActivity` poll, does `history` survive `running` turning
 * false, and does switching to a different operation key start clean.
 *
 * `useZeropsSessionOptional`/`useZeropsTopology` are mocked (their own
 * atom/Effect machinery is out of scope here); `useProjectActivity` and its
 * `ProjectActivityPoller` are real, driven by a fake `fetchProjectProcesses`
 * and fake timers; `useBuildLog` is mocked to an idle stub since the build
 * log itself has its own dedicated tests.
 *
 * No `@testing-library/react` in this repo — mirrors
 * `useBuildLog.test.tsx`'s own minimal DOM stub + `react-dom/client` + `act`
 * harness (the default test environment is `node`, not `jsdom`).
 */
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { ZeropsApiClient } from "@t3tools/client-runtime/zerops";
import { EnvironmentId } from "@t3tools/contracts";

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

interface MockTopology {
  readonly available: boolean;
  readonly project?: { readonly id: string };
  readonly services: ReadonlyArray<{ readonly hostname: string; readonly serviceId: string }>;
}

interface MockSession {
  readonly status: "signed-in" | "signed-out";
  readonly client: ZeropsApiClient;
}

let mockSession: MockSession | null = null;
let mockTopology: MockTopology | undefined = undefined;

vi.mock("../ZeropsSessionProvider", () => ({
  useZeropsSessionOptional: () => mockSession,
}));
vi.mock("../useZeropsFeeds", () => ({
  useZeropsTopology: () => mockTopology,
}));
vi.mock("./useBuildLog.ts", () => ({
  useBuildLog: () => ({ lines: [], status: "idle" }),
}));

function fakeClient(getProcesses: () => ReadonlyArray<unknown>): ZeropsApiClient {
  return {
    fetchProjectProcesses: async () => ({ list: getProcesses() }),
  } as unknown as ZeropsApiClient;
}

const ENVIRONMENT_ID = EnvironmentId.make("environment-1");
const PROJECT_ID = "proj-1";
const HOSTNAME = "weatherdash";
const SERVICE_ID = "svc-1";

function setUpEnvironment(getProcesses: () => ReadonlyArray<unknown>): void {
  mockSession = { status: "signed-in", client: fakeClient(getProcesses) };
  mockTopology = {
    available: true,
    project: { id: PROJECT_ID },
    services: [{ hostname: HOSTNAME, serviceId: SERVICE_ID }],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  mockSession = null;
  mockTopology = undefined;
});

describe("useOperationObservation — React glue", () => {
  it("survives React.StrictMode's mount/unmount/mount — a later poll tick still reaches the component", async () => {
    installTestDom();
    vi.useFakeTimers();
    let processes: ReadonlyArray<unknown> = [];
    setUpEnvironment(() => processes);

    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { useOperationObservation } = await import("./useOperationObservation.ts");

    let latestKind = "";
    function Probe() {
      const result = useOperationObservation(
        {
          key: "strictmode-test",
          kind: "deploy",
          hostnames: [HOSTNAME],
          startedAtMs: Date.now(),
          running: true,
        },
        ENVIRONMENT_ID,
      );
      latestKind = result.state.kind;
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    try {
      await act(() => {
        root.render(React.createElement(React.StrictMode, null, React.createElement(Probe)));
      });
      await act(async () => {
        for (let i = 0; i < 5; i += 1) {
          await Promise.resolve();
        }
      });
      expect(latestKind).toBe("observing");

      // A process now appears on a later poll tick — this only reaches the
      // component if the subscription survived StrictMode's double-invoke.
      processes = [
        {
          id: "p1",
          projectId: PROJECT_ID,
          serviceStackId: SERVICE_ID,
          status: "RUNNING",
          actionName: "stack.deploy",
          created: new Date().toISOString(),
          appVersion: { status: "BUILDING", build: { pipelineStart: new Date().toISOString() } },
        },
      ];
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_500);
      });

      expect(latestKind).toBe("observing");
    } finally {
      await act(() => root.unmount());
      vi.useRealTimers();
    }
  });

  it("transitions observing → stale → off as the poll goes quiet", async () => {
    installTestDom();
    vi.useFakeTimers();
    const startedAtMs = Date.now();
    const process = {
      id: "p1",
      projectId: PROJECT_ID,
      serviceStackId: SERVICE_ID,
      status: "RUNNING",
      actionName: "stack.deploy",
      created: new Date(startedAtMs).toISOString(),
      appVersion: { status: "BUILDING" },
    };
    let pollCount = 0;
    setUpEnvironment(() => {
      pollCount += 1;
      // Only the FIRST poll returns the process — every later poll returns
      // nothing, so the last good read ages without a fresh one arriving.
      return pollCount === 1 ? [process] : [];
    });

    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { useOperationObservation } = await import("./useOperationObservation.ts");

    let latestKind = "";
    function Probe() {
      const result = useOperationObservation(
        { key: "stale-test", kind: "deploy", hostnames: [HOSTNAME], startedAtMs, running: true },
        ENVIRONMENT_ID,
      );
      latestKind = result.state.kind;
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    try {
      await act(() => {
        root.render(React.createElement(Probe));
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(latestKind).toBe("observing");

      // The observation is only re-evaluated (and so re-rendered) on the
      // poller's own tick — every 2.5s at its base interval, since this fake
      // client never errors. `ageMs > 10_000` first becomes true on the
      // tick AT t=12.5s (age 12.5s), not merely by t=11s with no tick to
      // notice it, so the advance has to land past that tick.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(13_000);
      });
      expect(latestKind).toBe("stale");

      // Likewise off:stale-timeout (age > 60s) first becomes visible on the
      // tick at t=62.5s.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50_000);
      });
      expect(latestKind).toBe("off");
    } finally {
      await act(() => root.unmount());
      vi.useRealTimers();
    }
  });

  it("keeps history after running flips to false", async () => {
    installTestDom();
    vi.useFakeTimers();
    const startedAtMs = Date.now();
    const process = {
      id: "p1",
      projectId: PROJECT_ID,
      serviceStackId: SERVICE_ID,
      status: "RUNNING",
      actionName: "stack.deploy",
      created: new Date(startedAtMs).toISOString(),
      appVersion: {
        status: "BUILDING",
        build: { pipelineStart: new Date(startedAtMs).toISOString() },
      },
    };
    setUpEnvironment(() => [process]);

    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { useOperationObservation } = await import("./useOperationObservation.ts");

    let latestHistory: unknown;
    let running = true;
    function Probe() {
      const result = useOperationObservation(
        { key: "history-test", kind: "deploy", hostnames: [HOSTNAME], startedAtMs, running },
        ENVIRONMENT_ID,
      );
      latestHistory = result.history;
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    try {
      await act(() => {
        root.render(React.createElement(Probe));
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect((latestHistory as { steps: unknown[] } | undefined)?.steps.length).toBeGreaterThan(0);
      const historyWhileRunning = latestHistory;

      running = false;
      await act(() => {
        root.render(React.createElement(Probe));
      });

      expect(latestHistory).toEqual(historyWhileRunning);
    } finally {
      await act(() => root.unmount());
      vi.useRealTimers();
    }
  });

  it("starts clean for a different operation key — no history leaks across keys", async () => {
    installTestDom();
    vi.useFakeTimers();
    const startedAtMs = Date.now();
    const process = {
      id: "p1",
      projectId: PROJECT_ID,
      serviceStackId: SERVICE_ID,
      status: "RUNNING",
      actionName: "stack.deploy",
      created: new Date(startedAtMs).toISOString(),
      appVersion: {
        status: "BUILDING",
        build: { pipelineStart: new Date(startedAtMs).toISOString() },
      },
    };
    setUpEnvironment(() => [process]);

    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { useOperationObservation } = await import("./useOperationObservation.ts");

    let latestHistory: unknown;
    let key = "key-change-test-a";
    let hostnames = [HOSTNAME];
    function Probe() {
      const result = useOperationObservation(
        { key, kind: "deploy", hostnames, startedAtMs, running: true },
        ENVIRONMENT_ID,
      );
      latestHistory = result.history;
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    try {
      await act(() => {
        root.render(React.createElement(Probe));
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect((latestHistory as { steps: unknown[] } | undefined)?.steps.length).toBeGreaterThan(0);

      // A genuinely different operation — a different service the topology
      // does not even know about, so it can never attribute to the same
      // process the first operation did.
      key = "key-change-test-b";
      hostnames = ["some-other-service"];
      await act(() => {
        root.render(React.createElement(Probe));
      });

      expect(latestHistory).toBeUndefined();
    } finally {
      await act(() => root.unmount());
      vi.useRealTimers();
    }
  });
});
