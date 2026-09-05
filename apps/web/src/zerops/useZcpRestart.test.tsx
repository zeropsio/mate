/**
 * `useZcpRestart` driven through real React rendering — mirrors
 * `activity/useOperationObservation.test.tsx`'s minimal DOM stub +
 * `react-dom/client` + `act` harness (no `@testing-library/react` in this
 * repo; the default test environment is `node`, not `jsdom`).
 *
 * `useZeropsSessionOptional`/`useZeropsTopology` and
 * `lookupEnvironmentProjectRef` are mocked — this file exercises the hook's
 * own state machine (`available`, `idle → confirm → restarting/failed`), not
 * the atom/storage machinery those already have their own tests for.
 */
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { ZeropsApiClient } from "@t3tools/client-runtime/zerops";
import type { EnvironmentProjectRef } from "@t3tools/client-runtime/zerops/environmentProjectRef";
import type { ZeropsTopologyView } from "@t3tools/client-runtime/zerops/topology";
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

interface MockSession {
  readonly status: "signed-in" | "signed-out";
  readonly client: ZeropsApiClient;
}

let mockSession: MockSession | null = null;
let mockTopology: ZeropsTopologyView | undefined = undefined;
let mockRef: EnvironmentProjectRef | undefined = undefined;

vi.mock("./ZeropsSessionProvider", () => ({
  useZeropsSessionOptional: () => mockSession,
}));
vi.mock("./useZeropsFeeds", () => ({
  useZeropsTopology: () => mockTopology,
}));
vi.mock("@t3tools/client-runtime/zerops/environmentProjectRef", () => ({
  lookupEnvironmentProjectRef: async () => mockRef,
}));

function fakeClient(restartService: ZeropsApiClient["restartService"]): ZeropsApiClient {
  return { restartService } as unknown as ZeropsApiClient;
}

const ZCP_SERVICE_ID = "svc-zcp";
const PROJECT_REF: EnvironmentProjectRef = {
  projectId: "proj-1",
  orgId: "org-1",
  learnedAt: 0,
  source: "match",
};

function viewWithZcpService(): ZeropsTopologyView {
  return {
    project: { id: "proj-1", name: "kanban" },
    warnings: [],
    services: [
      {
        hostname: "zcp",
        serviceId: ZCP_SERVICE_ID,
        type: "zcp@1",
        status: "ACTIVE",
        group: "infrastructure",
        transient: false,
        routes: [],
        ports: [],
      },
    ],
    usageRead: false,
  };
}

function viewWithoutZcpService(): ZeropsTopologyView {
  return {
    project: { id: "proj-1", name: "kanban" },
    warnings: [],
    services: [],
    usageRead: false,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  mockSession = null;
  mockTopology = undefined;
  mockRef = undefined;
});

describe("useZcpRestart — availability and restart", () => {
  it("is unavailable without a project ref or a zcp service", async () => {
    installTestDom();

    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { useZcpRestart } = await import("./useZcpRestart.ts");

    let latestAvailable = true;
    function Probe({ environmentId }: { environmentId: EnvironmentId }) {
      const result = useZcpRestart(environmentId);
      latestAvailable = result.available;
      return null;
    }

    // No project ref, even though the topology names a zcp service.
    mockRef = undefined;
    mockTopology = viewWithZcpService();
    const rootA = createRoot(document.createElement("div") as unknown as Element);
    try {
      await act(() => {
        rootA.render(
          React.createElement(Probe, { environmentId: EnvironmentId.make("env-no-ref") }),
        );
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(latestAvailable).toBe(false);
    } finally {
      await act(() => rootA.unmount());
    }

    // A project ref, but no zcp service in the topology.
    mockRef = PROJECT_REF;
    mockTopology = viewWithoutZcpService();
    const rootB = createRoot(document.createElement("div") as unknown as Element);
    try {
      await act(() => {
        rootB.render(
          React.createElement(Probe, { environmentId: EnvironmentId.make("env-no-zcp") }),
        );
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(latestAvailable).toBe(false);
    } finally {
      await act(() => rootB.unmount());
    }
  });

  it("restarts the zcp service only after confirm and reports restarting", async () => {
    installTestDom();
    mockRef = PROJECT_REF;
    mockTopology = viewWithZcpService();
    const restartCalls: string[] = [];
    mockSession = {
      status: "signed-in",
      client: fakeClient(async (serviceId: string) => {
        restartCalls.push(serviceId);
      }),
    };

    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { useZcpRestart } = await import("./useZcpRestart.ts");

    let latest: ReturnType<typeof useZcpRestart> | undefined;
    function Probe() {
      latest = useZcpRestart(EnvironmentId.make("env-restart"));
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    try {
      await act(() => {
        root.render(React.createElement(Probe));
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(latest?.available).toBe(true);
      expect(latest?.state).toBe("idle");

      act(() => {
        latest?.request();
      });
      expect(latest?.state).toBe("confirm");
      expect(restartCalls).toEqual([]);

      await act(async () => {
        latest?.confirm();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(restartCalls).toEqual([ZCP_SERVICE_ID]);
      expect(latest?.state).toBe("restarting");
    } finally {
      await act(() => root.unmount());
    }
  });

  it("keeps the notice and names the error when the restart fails", async () => {
    installTestDom();
    mockRef = PROJECT_REF;
    mockTopology = viewWithZcpService();
    mockSession = {
      status: "signed-in",
      client: fakeClient(async () => {
        throw new Error("stack.restart failed");
      }),
    };

    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { useZcpRestart } = await import("./useZcpRestart.ts");

    let latest: ReturnType<typeof useZcpRestart> | undefined;
    function Probe() {
      latest = useZcpRestart(EnvironmentId.make("env-restart-fail"));
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    try {
      await act(() => {
        root.render(React.createElement(Probe));
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      act(() => {
        latest?.request();
      });
      await act(async () => {
        latest?.confirm();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(latest?.state).toBe("failed");
      expect(latest?.error).toBe("stack.restart failed");
      // The notice is kept, not torn down: the action is still available.
      expect(latest?.available).toBe(true);
    } finally {
      await act(() => root.unmount());
    }
  });
});
