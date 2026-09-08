import { act, useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import * as Effect from "effect/Effect";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";

import {
  AccountEpoch,
  makeZeropsApiOrigin,
  ZeropsAccountId,
  ZeropsOrganizationId,
  type ManagedZeropsDataRuntime,
  type OrganizationLocationsResourceRequest,
} from "@t3tools/client-runtime/zerops/data";

import { FakeLocationsBroker } from "./__fixtures__/resourceBroker";
import {
  makeZeropsAtomSelectionStore,
  runZeropsCommand,
  useZeropsResource,
  ZeropsDataContext,
} from "./zeropsDataContext";

describe("makeZeropsAtomSelectionStore", () => {
  it("reconciles a newer atom value when the first subscriber attaches", () => {
    const scheduled: Array<() => void> = [];
    const registry = AtomRegistry.make({
      scheduleTask: (task) => {
        let active = true;
        scheduled.push(() => {
          if (active) task();
        });
        return () => {
          active = false;
        };
      },
    });
    const source = Atom.make(0);
    const unmountSource = registry.mount(source);
    const projection = Atom.make((get) => get(source));
    const store = makeZeropsAtomSelectionStore(registry, [["value", projection]]);

    registry.set(source, 1);
    for (const task of scheduled.splice(0)) task();
    let notifications = 0;
    const unsubscribe = store.subscribe(() => {
      notifications += 1;
    });

    expect(store.getSnapshot().get("value")).toBe(1);
    expect(notifications).toBe(1);

    unsubscribe();
    unmountSource();
    registry.dispose();
  });
});

describe("runZeropsCommand", () => {
  it("returns the typed value", async () => {
    await expect(
      runZeropsCommand(Effect.succeed({ attempt: {} as never, value: "created" })),
    ).resolves.toBe("created");
  });

  it("preserves the typed failure for uncertainty and error copy", async () => {
    const failure = {
      _tag: "ZeropsDataAdapterError" as const,
      kind: "uncertain" as const,
      message: "The platform response was lost.",
    };

    await expect(runZeropsCommand(Effect.fail(failure))).rejects.toBe(failure);
  });
});

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
const scope = { account, epoch: AccountEpoch.make(1) };
const organization = {
  kind: "organization" as const,
  account,
  organizationId: ZeropsOrganizationId.make("org-1"),
};

function locationsRuntime(broker: FakeLocationsBroker): ManagedZeropsDataRuntime {
  return {
    scope,
    resources: { acquire: broker.acquire },
  } as unknown as ManagedZeropsDataRuntime;
}

function locationsContext(runtime: ManagedZeropsDataRuntime) {
  return {
    runtime,
    organizationRef: () => organization,
    projectRef: () => {
      throw new Error("not used");
    },
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

describe("useZeropsResource", () => {
  it("does not re-acquire the lease when an un-memoized request keeps the same key", async () => {
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const broker = new FakeLocationsBroker();
    const runtime = locationsRuntime(broker);
    const onResult = vi.fn();

    function Probe() {
      // Deliberately un-memoized: a fresh object identity every render.
      const request: OrganizationLocationsResourceRequest = {
        kind: "organization-locations",
        account: scope,
        organization,
      };
      const result = useZeropsResource(request);
      useEffect(() => onResult(result), [result]);
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    try {
      await act(() => {
        root.render(
          <ZeropsDataContext value={locationsContext(runtime)}>
            <Probe />
          </ZeropsDataContext>,
        );
      });
      await flushEffects();
      expect(broker.acquisitions).toBe(1);

      // A second render with a new request identity but the same key must not re-lease.
      await act(() => {
        root.render(
          <ZeropsDataContext value={locationsContext(runtime)}>
            <Probe />
          </ZeropsDataContext>,
        );
      });
      await flushEffects();
      expect(broker.acquisitions).toBe(1);

      await act(async () => {
        await broker.publish({ status: "success", attempt: 1, value: [] });
      });
      expect(onResult.mock.calls.at(-1)?.[0]).toEqual({ status: "success", attempt: 1, value: [] });
    } finally {
      await act(() => root.unmount());
    }
  });
});
