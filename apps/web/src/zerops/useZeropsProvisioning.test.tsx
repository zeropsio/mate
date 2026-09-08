import { act, useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import * as provisioning from "@t3tools/client-runtime/zerops/provisioning";
import type { ZeropsProject, ZeropsService } from "@t3tools/client-runtime/zerops";
import {
  AccountEpoch,
  makeZeropsApiOrigin,
  ZeropsAccountId,
  type ManagedZeropsDataRuntime,
} from "@t3tools/client-runtime/zerops/data";

import { InventoryContext, type Inventory } from "./inventoryContext";
import { ZeropsDataContext, type ZeropsDataContextValue } from "./zeropsDataContext";

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

function runtime(): ManagedZeropsDataRuntime {
  return { scope: { account, epoch: AccountEpoch.make(1) } } as unknown as ManagedZeropsDataRuntime;
}

function context(value: ManagedZeropsDataRuntime): ZeropsDataContextValue {
  return {
    runtime: value,
    organizationRef: () => {
      throw new Error("not used");
    },
    projectRef: () => {
      throw new Error("not used");
    },
  };
}

function inventory(
  projects: ReadonlyArray<ZeropsProject>,
  services: Inventory["services"],
): Inventory {
  return { projects, services, isLoading: false, error: null, projectRefs: new Map() };
}

const PROJECT: ZeropsProject = { id: "project-1", name: "p", status: "ACTIVE" };
const SERVICES: ReadonlyArray<ZeropsService> = [];

async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useZeropsProvisioning inventory polling", () => {
  it("reads the latest inventory only on the interval tick, not on every inventory publish", async () => {
    installTestDom();
    vi.useFakeTimers();
    const readSpy = vi.spyOn(provisioning, "readProvisioning");
    const { createRoot } = await import("react-dom/client");
    const { useZeropsProvisioning } = await import("./useZeropsProvisioning");
    const managed = runtime();
    const onResult = vi.fn();

    function Probe() {
      const result = useZeropsProvisioning("client-1");
      useEffect(() => onResult(result), [result]);
      useEffect(() => {
        result.startForProject({ projectId: PROJECT.id });
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    const render = (services: Inventory["services"]) => (
      <ZeropsDataContext value={context(managed)}>
        <InventoryContext value={inventory([PROJECT], services)}>
          <Probe />
        </InventoryContext>
      </ZeropsDataContext>
    );
    try {
      const noServices: Inventory["services"] = new Map();
      await act(() => root.render(render(noServices)));
      await flushEffects();
      const initialCalls = readSpy.mock.calls.length;
      expect(initialCalls).toBeGreaterThan(0);

      // A native inventory publish (new services map identity) must not, by
      // itself, trigger another provisioning read: only the interval tick may.
      const withServices: Inventory["services"] = new Map([
        [PROJECT.id, { status: "resolved" as const, services: SERVICES }],
      ]);
      await act(() => root.render(render(withServices)));
      await flushEffects();
      expect(readSpy.mock.calls.length).toBe(initialCalls);

      // The interval tick reads whatever inventory is current at that point.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(readSpy.mock.calls.length).toBeGreaterThan(initialCalls);
      const latestCall = readSpy.mock.calls.at(-1)?.[0];
      expect(latestCall?.services).toBe(SERVICES);
    } finally {
      await act(() => root.unmount());
      vi.useRealTimers();
    }
  });
});
