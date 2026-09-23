import { RegistryContext } from "@effect/atom-react";
import { act, useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import * as Effect from "effect/Effect";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";

import type { ZeropsLocation } from "@t3tools/client-runtime/zerops";
import {
  AccountEpoch,
  makeZeropsApiOrigin,
  ZeropsAccountId,
  ZeropsOrganizationId,
  type ManagedZeropsDataRuntime,
  type OrganizationLocationsResourceRequest,
} from "@t3tools/client-runtime/zerops/data";
import type { Shown } from "@t3tools/client-runtime/zerops/knowledge";

import { FakeResourceBroker } from "./__fixtures__/resourceBroker";
import {
  makeZeropsAtomSelectionStore,
  runZeropsCommand,
  useKnown,
  useZeropsData,
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

const known = (value: ReadonlyArray<ZeropsLocation>): Shown<ReadonlyArray<ZeropsLocation>> => ({
  state: "known",
  value,
  asOf: { ordinal: 1, atMs: 0 },
  coverage: "complete",
  freshness: { kind: "settled" },
});

const PRAGUE: ZeropsLocation = { id: "prg1", name: "Prague", pingUrl: "https://ping.test" };

type LocationsBroker = FakeResourceBroker<OrganizationLocationsResourceRequest>;

function locationsContext(broker: LocationsBroker) {
  const runtime = {
    scope,
    resources: { known: broker.known },
  } as unknown as ManagedZeropsDataRuntime;
  return {
    runtime,
    organizationRef: () => organization,
    projectRef: () => {
      throw new Error("not used");
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useKnown", () => {
  // The broker withholds and erases at the deadline and reads again under the
  // next grant; the mounted view follows it on the same demand (DESIGN §9 C4).
  it("follows a withheld resource back to its value without a remount", async () => {
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const broker = new FakeResourceBroker<OrganizationLocationsResourceRequest>();
    const request: OrganizationLocationsResourceRequest = {
      kind: "organization-locations",
      account: scope,
      organization,
    };
    const onResult = vi.fn();
    let mounts = 0;

    function Probe() {
      const { runtime } = useZeropsData();
      const result = useKnown(runtime.resources.known(request));
      useEffect(() => {
        mounts += 1;
      }, []);
      useEffect(() => onResult(result), [result]);
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    const last = () => onResult.mock.calls.at(-1)?.[0];
    try {
      await act(() => {
        root.render(
          <RegistryContext value={AtomRegistry.make()}>
            <ZeropsDataContext value={locationsContext(broker)}>
              <Probe />
            </ZeropsDataContext>
          </RegistryContext>,
        );
      });
      expect(last()).toMatchObject({ state: "reading" });
      await act(() => broker.publish(known([PRAGUE])));
      expect(last()).toMatchObject({ state: "known", value: [PRAGUE] });

      await act(() => broker.publish({ state: "withheld", reason: "access-lapsed", cause: null }));
      expect(last()).toEqual({ state: "withheld", reason: "access-lapsed", cause: null });

      await act(() => broker.publish({ state: "reading", sinceMs: 1, attempt: 1 }));
      await act(() => broker.publish(known([PRAGUE])));
      expect(last()).toMatchObject({ state: "known", value: [PRAGUE] });
      expect(mounts).toBe(1);
      expect(broker.acquisitions).toBe(1);
    } finally {
      await act(() => root.unmount());
    }
  });

  it("demands nothing for no atom, and reads unread", async () => {
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const onResult = vi.fn();

    function Probe() {
      const result = useKnown<ReadonlyArray<ZeropsLocation>>(null);
      useEffect(() => onResult(result), [result]);
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    try {
      await act(() => {
        root.render(
          <RegistryContext value={AtomRegistry.make()}>
            <Probe />
          </RegistryContext>,
        );
      });
      expect(onResult.mock.calls.at(-1)?.[0]).toEqual({ state: "unread", waitingFor: null });
    } finally {
      await act(() => root.unmount());
    }
  });
});
