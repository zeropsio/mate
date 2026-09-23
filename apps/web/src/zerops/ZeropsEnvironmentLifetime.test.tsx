import { act, StrictMode, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";
import type { ExchangeAnswer } from "@t3tools/client-runtime/zerops/identityExchange";
import type { ExchangeRequest } from "@t3tools/client-runtime/zerops/environments";

import {
  ZeropsEnvironmentLifetime,
  useEnvironmentRestorePending,
} from "./ZeropsEnvironmentLifetime";
import { InventoryContext, type Inventory } from "./inventoryContext";
import { openAccountLifetime, closeAccountLifetime } from "./accountLifetime";
import { beginEnvironmentIdentityExchange, rememberEnvironment } from "./rememberedEnvironments";

const mock = vi.hoisted(() => ({
  exchange: vi.fn(),
  install: vi.fn(),
  retire: vi.fn(),
  remove: vi.fn(),
  environments: [] as { environmentId: string; displayUrl: string }[],
}));

// The door and the registry stand behind the driver's ports; the driver itself is real.
vi.mock("./useZeropsIdentityExchange", async () => {
  const { createContext } = await import("react");
  const { systemExchangeClock } = await import("@t3tools/client-runtime/zerops/environments");
  const { rememberEnvironment: remember } = await import("./rememberedEnvironments");
  return {
    ExchangeDriverContext: createContext(null),
    webExchangePorts: () => ({
      clock: systemExchangeClock,
      exchange: (request: ExchangeRequest) => mock.exchange(request),
      install: async (input: { key: string; environmentId: EnvironmentId }) => {
        mock.install(input);
        remember({ key: input.key, environmentId: String(input.environmentId) });
        return { ok: true };
      },
      readDescriptor: () => new Promise(() => undefined),
      retryLink: () => undefined,
      refreshPresence: () => undefined,
      retire: (key: string, environmentId: EnvironmentId | null) => mock.retire(key, environmentId),
    }),
  };
});
vi.mock("./useZeropsCandidateHealth", () => {
  const snapshot = { health: new Map() };
  return { useZeropsCandidateHealth: () => snapshot };
});
vi.mock("./ZeropsSessionProvider", () => ({
  useZeropsSession: () => ({ client: {}, activeOrganization: null }),
}));
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
  readonly visibilityState = "visible";

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
  authority: new Map(),
  isLoading: false,
  error: null,
});

const admitted = (id: EnvironmentId = environmentId): ExchangeAnswer<unknown> => ({
  ok: true,
  environmentId: id,
  descriptor: {
    environmentId: id,
    serverVersion: "0.12.0",
    update: null,
    identity: "ok",
    identityCheckedAt: null,
  },
  credential: {},
});
const doorFailed = (status: number): ExchangeAnswer<unknown> => ({
  ok: false,
  failure: { class: "retryable", cause: { kind: "server", status } },
  descriptor: null,
});
const roleRefused: ExchangeAnswer<unknown> = {
  ok: false,
  failure: { class: "refusal", reason: { kind: "role" } },
  descriptor: null,
};

/** Mutated by a test that needs `render()` to pick up a new inventory snapshot. */
let liveInventory: Inventory = inventory();
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
  liveInventory = inventory();
  mock.environments = [];
  mock.exchange.mockReset().mockResolvedValue(doorFailed(503));
  mock.install.mockReset();
  mock.retire.mockReset();
  mock.remove.mockReset();
});
afterEach(async () => {
  await unmount?.();
  unmount = undefined;
  closeAccountLifetime();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function mount() {
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.createElement("div"));
  const render = () =>
    act(async () => {
      root.render(
        <StrictMode>
          <InventoryContext value={liveInventory}>
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
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

describe("restore is the records' demand on the exchange driver", () => {
  const rows: ReadonlyArray<{
    readonly name: string;
    readonly answers: ReadonlyArray<ExchangeAnswer<unknown>>;
    readonly exchanges: number;
    readonly installed: boolean;
  }> = [
    {
      name: "a door 500 on reload retries on its own and connects",
      answers: [doorFailed(500), doorFailed(500), admitted()],
      exchanges: 3,
      installed: true,
    },
    {
      name: "a refusal is not retried by time, renders or wakes",
      answers: [roleRefused],
      exchanges: 1,
      installed: false,
    },
  ];

  it.each(rows.map((row) => [row.name, row] as const))("%s", async (_name, row) => {
    vi.useFakeTimers();
    for (const answer of row.answers) mock.exchange.mockResolvedValueOnce(answer);
    mock.exchange.mockResolvedValue(roleRefused);
    rememberEnvironment({ key: "project:service", environmentId });
    const render = await mount();
    await render();
    await render();
    await advance(2_000);
    await advance(4_000);
    await advance(10 * 60_000);
    await render();

    expect(mock.exchange).toHaveBeenCalledTimes(row.exchanges);
    expect(mock.install).toHaveBeenCalledTimes(row.installed ? 1 : 0);
    expect(restorePending).toBe(false);
    expect(mock.exchange.mock.calls.every(([request]) => request.reason === "restore")).toBe(true);
  });
});

it("does not repeat an in-flight restore when another inventory snapshot arrives", async () => {
  rememberEnvironment({ key: "project:service", environmentId });
  let complete!: (answer: ExchangeAnswer<unknown>) => void;
  mock.exchange.mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const render = await mount();
  await render();
  await render();
  expect(mock.exchange).toHaveBeenCalledTimes(1);
  expect(restorePending).toBe(true);
  await act(async () => complete(admitted()));
  expect(mock.exchange).toHaveBeenCalledTimes(1);
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
  expect(mock.remove).not.toHaveBeenCalled();
});

it("retires an old service identity replaced at the same origin", async () => {
  rememberEnvironment({ key: "project:old-service", environmentId });
  mock.environments = [{ environmentId, displayUrl: origin + "/mate" }];
  await mount();
  expect(mock.retire).toHaveBeenCalledWith("project:old-service", environmentId);
});

it("releases an obsolete server history once a replacement is remembered at its address", async () => {
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

it("a Mate restarting keeps its environment", async () => {
  rememberEnvironment({ key: "project:service", environmentId });
  mock.environments = [{ environmentId, displayUrl: origin + "/mate" }];
  const render = await mount();

  // A fresh inventory push landing the service as RESTARTING: the target is still there under
  // the same `project:service` key (candidates.ts), transitioning.
  liveInventory = {
    ...inventory(),
    services: new Map([
      [
        project.id,
        { status: "resolved" as const, services: [{ ...service, status: "RESTARTING" }] },
      ],
    ]),
  };
  await render();

  expect(mock.retire).not.toHaveBeenCalled();
  expect(mock.remove).not.toHaveBeenCalled();
});

it("services not yet read keep the environment", async () => {
  rememberEnvironment({ key: "project:service", environmentId });
  mock.environments = [{ environmentId, displayUrl: origin + "/mate" }];
  const render = await mount();

  // Inventory carries the project forward but its services outcome is absent — the
  // momentarily-unread window H10 describes: presence is unknown, never gone.
  liveInventory = { ...inventory(), services: new Map() };
  await render();

  expect(mock.retire).not.toHaveBeenCalled();
  expect(mock.remove).not.toHaveBeenCalled();
});

it("an inventory read in flight or failed keeps the environment", async () => {
  rememberEnvironment({ key: "project:service", environmentId });
  mock.environments = [{ environmentId, displayUrl: origin + "/mate" }];
  const render = await mount();

  liveInventory = { ...inventory(), projects: [], services: new Map(), isLoading: true };
  await render();
  liveInventory = { ...inventory(), projects: [], services: new Map(), error: "unavailable" };
  await render();

  expect(mock.retire).not.toHaveBeenCalled();
});

it("a deleted project loses it", async () => {
  rememberEnvironment({ key: "project:service", environmentId });
  mock.environments = [{ environmentId, displayUrl: origin + "/mate" }];
  const render = await mount();
  expect(mock.retire).not.toHaveBeenCalled();

  // A settled read (not loading, no error) whose project list no longer has the project at
  // all — the platform actually deleted it.
  liveInventory = { ...inventory(), projects: [], services: new Map() };
  await render();

  expect(mock.retire).toHaveBeenCalledWith("project:service", environmentId);
});

it("releases an unremembered registration when its identity exchange ends unsuccessfully", async () => {
  const finish = beginEnvironmentIdentityExchange(origin);
  mock.environments = [{ environmentId, displayUrl: origin + "/mate" }];
  await mount();
  expect(mock.remove).not.toHaveBeenCalled();
  await act(async () => finish());
  expect(mock.remove.mock.calls.map((call) => call[2])).toContain(environmentId);
});
