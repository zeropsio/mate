import { act, StrictMode, useEffect } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";
import {
  ZeropsEnvironmentLifetime,
  useEnvironmentRestorePending,
} from "./ZeropsEnvironmentLifetime";
import { InventoryContext, type Inventory } from "./inventoryContext";
import { openAccountLifetime, closeAccountLifetime } from "./accountLifetime";
import { beginEnvironmentIdentityExchange, rememberEnvironment } from "./rememberedEnvironments";
import { refreshZeropsCandidates } from "./candidatesRefresh";

const mock = vi.hoisted(() => ({
  exchange: vi.fn(),
  remove: vi.fn(),
  environments: [] as { environmentId: string; displayUrl: string }[],
}));
vi.mock("./useZeropsIdentityExchange", () => ({ useZeropsIdentityExchange: () => mock.exchange }));
vi.mock("../state/environments", () => ({
  useEnvironments: () => ({ environments: mock.environments }),
}));
vi.mock("../connection/catalog", () => ({ environmentCatalog: { remove: {} } }));
vi.mock("@t3tools/client-runtime/state/runtime", () => ({
  runAtomCommand: (...args: unknown[]) => mock.remove(...args),
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
  removeAttribute() {}
  createTextNode(_text: string) {
    return new TestNode("#text", this, 3);
  }
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

const project = {
  id: "project",
  name: "one",
  status: "ACTIVE",
  publicZone: "x.prg1-zerops.zone",
  zeropsSubdomainHost: "24cb",
};
const service = {
  id: "service",
  name: "zcp",
  status: "ACTIVE",
  subdomainAccess: true,
  ports: [{ port: 8080, httpSupport: true }],
  serviceStackTypeInfo: { serviceStackTypeVersionName: "zcp@1" },
};
const origin = "https://zcp-24cb-8080.prg1.zerops.app";
const environmentId = EnvironmentId.make("environment");
const inventory = (): Inventory => ({
  projects: [{ ...project }],
  services: new Map([[project.id, { status: "resolved", services: [{ ...service }] }]]),
  projectRefs: new Map(),
  isLoading: false,
  error: null,
});
let unmount: (() => Promise<void>) | undefined;
let restorePending = false;
function ObserveRestore() {
  const pending = useEnvironmentRestorePending();
  useEffect(() => {
    restorePending = pending;
  }, [pending]);
  return null;
}
beforeEach(() => {
  installTestDom();
  const values = new Map<string, string>();
  Object.assign(window, {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    },
  });
  openAccountLifetime("account");
  mock.environments = [];
  mock.exchange.mockReset().mockResolvedValue({ _tag: "Failure", error: "Unavailable" });
  mock.remove.mockReset();
});
afterEach(async () => {
  await unmount?.();
  unmount = undefined;
  closeAccountLifetime();
  vi.unstubAllGlobals();
});
async function mount() {
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.createElement("div"));
  const render = () =>
    act(async () => {
      root.render(
        <StrictMode>
          <InventoryContext value={inventory()}>
            <ZeropsEnvironmentLifetime>
              <ObserveRestore />
            </ZeropsEnvironmentLifetime>
          </InventoryContext>
        </StrictMode>,
      );
    });
  unmount = () => act(async () => root.unmount());
  await render();
  return render;
}
it("does not retry a failed restore on inventory changes, and permits an explicit refresh", async () => {
  rememberEnvironment({ key: "project:service", environmentId });
  const render = await mount();
  await render();
  await render();
  await render();
  expect(mock.exchange).toHaveBeenCalledTimes(1);
  await act(async () => refreshZeropsCandidates());
  expect(mock.exchange).toHaveBeenCalledTimes(2);
});
it("does not repeat an in-flight restore when another inventory snapshot arrives", async () => {
  rememberEnvironment({ key: "project:service", environmentId });
  let complete!: (result: { _tag: "Success"; environmentId: typeof environmentId }) => void;
  mock.exchange.mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const render = await mount();
  await render();
  await render();
  const attempts = mock.exchange.mock.calls.length;
  expect(restorePending).toBe(true);
  await act(async () => complete({ _tag: "Success", environmentId }));
  expect(attempts).toBe(1);
  expect(restorePending).toBe(false);
});
it("retains a registration published before its remembered identity is written", async () => {
  const finish = beginEnvironmentIdentityExchange(origin);
  mock.environments = [{ environmentId, displayUrl: origin + "/mate" }];
  const render = await mount();
  expect(mock.remove).not.toHaveBeenCalled();
  await act(async () => {
    rememberEnvironment({ key: "project:service", environmentId });
    finish();
  });
  await render();
  expect(mock.exchange).not.toHaveBeenCalled();
  expect(mock.remove).not.toHaveBeenCalled();
});
it("still disposes an old service identity replaced at the same origin", async () => {
  rememberEnvironment({ key: "project:old-service", environmentId });
  mock.environments = [{ environmentId, displayUrl: origin + "/mate" }];
  await mount();
  expect(mock.remove).toHaveBeenCalled();
});

it("disposes an obsolete server history once a replacement is remembered at its address", async () => {
  const replacement = EnvironmentId.make("replacement");
  rememberEnvironment({ key: "project:service", environmentId });
  const finish = beginEnvironmentIdentityExchange(origin);
  mock.environments = [
    { environmentId, displayUrl: origin + "/mate" },
    { environmentId: replacement, displayUrl: origin + "/mate" },
  ];
  await mount();
  expect(mock.remove).not.toHaveBeenCalled();
  await act(async () => {
    rememberEnvironment({ key: "project:service", environmentId: replacement });
    finish();
  });
  expect(mock.remove.mock.calls.map((call) => call[2])).toContain(environmentId);
  expect(mock.remove.mock.calls.map((call) => call[2])).not.toContain(replacement);
});

it("releases an unremembered registration when its identity exchange ends unsuccessfully", async () => {
  const finish = beginEnvironmentIdentityExchange(origin);
  mock.environments = [{ environmentId, displayUrl: origin + "/mate" }];
  await mount();
  expect(mock.remove).not.toHaveBeenCalled();
  await act(async () => finish());
  expect(mock.remove.mock.calls.map((call) => call[2])).toContain(environmentId);
});
