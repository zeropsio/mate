import { EnvironmentId } from "@t3tools/contracts";
import type { ZeropsProject, ZeropsService } from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import {
  environmentLinkable,
  initialEnvironment,
  isTerminalReachability,
  makeExchangeDriver,
  routeGatePhrase,
  selectReachability,
  selectRouteGate,
  type ContainerVerdict,
  type EnvironmentMachine,
  type ExchangeDriver,
  type Presence,
  type Reachability,
  type RouteGate,
  type RouteTarget,
} from "@t3tools/client-runtime/zerops/environments";
import { act, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { TestNode } from "../zerops/__fixtures__/testDom";
import { useEnvironmentLinks, useRouteGateInputs } from "./-environmentTargets";
import { RouteGateView } from "./-routeGate";
import { InventoryContext, type Inventory } from "../zerops/inventoryContext";
import type { ZeropsOrganizationStatus } from "../zerops/ZeropsSessionProvider";

/** Where the fixture's zcp service is served: `zcp`, subdomain host `abc`, port 8080, region `prg1`. */
const ORIGIN = "https://zcp-abc-8080.prg1.zerops.app";
const ENV_A = EnvironmentId.make("env-a");

const shell = vi.hoisted(() => ({
  environments: [] as Array<{
    environmentId: string;
    displayUrl: string | null;
    label: string;
    connection: { phase: string };
  }>,
  records: [] as Array<{ key: string; environmentId: string }>,
  organization: "selected" as ZeropsOrganizationStatus,
  driver: null as unknown,
}));

vi.mock("../state/environments", () => ({
  useEnvironments: () => ({ environments: shell.environments }),
}));
vi.mock("../state/shell", async () => {
  const { Atom } = await import("effect/unstable/reactivity");
  const Option = await import("effect/Option");
  const cached = Atom.make({ snapshot: Option.none(), status: "cached", error: Option.none() });
  return { environmentShell: { stateValueAtom: () => cached } };
});
vi.mock("../zerops/rememberedEnvironments", () => ({
  readRememberedEnvironments: () => shell.records,
  useEnvironmentIdentityVersion: () => 0,
}));
vi.mock("../zerops/useZeropsIdentityExchange", () => ({
  useExchangeDriver: () => shell.driver,
}));
vi.mock("../zerops/ZeropsSessionProvider", () => ({
  useZeropsSession: () => ({ organizationStatus: shell.organization }),
}));

const project = {
  id: "project-1",
  name: "shop",
  status: "ACTIVE",
  publicZone: "abc.prg1-zerops.zone",
  zeropsSubdomainHost: "abc",
} as unknown as ZeropsProject;

const zcp = (status: string) =>
  ({
    id: "service-1",
    name: "zcp",
    status,
    serviceStackTypeInfo: { serviceStackTypeVersionName: "zcp@1" },
    subdomainAccess: true,
    ports: [{ port: 8080 }],
  }) as unknown as ZeropsService;

const inventory = (status: string | null): Inventory => ({
  projects: status === null ? [] : [project],
  services: new Map(
    status === null ? [] : [["project-1", { status: "resolved", services: [zcp(status)] }]],
  ),
  isLoading: false,
  error: null,
  projectRefs: new Map(),
  authority: new Map(),
});

let container: TestNode;
let root: Root;

beforeEach(() => {
  const document = new TestNode("#document", null, 9);
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", {
    document,
    HTMLIFrameElement: TestNode,
    addEventListener() {},
    removeEventListener() {},
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  root = createRoot(container as unknown as Element);
  shell.environments = [];
  shell.records = [];
  shell.organization = "selected";
  shell.driver = publishing(new Map());
});

afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

/** The gate `__root` selects on a route to `env-a`, over the mocked shell and `inventory`. */
async function gateOnRoute(value: Inventory): Promise<RouteGate> {
  const { useRouteGateInputs } = await import("./-environmentTargets");
  function Probe() {
    return JSON.stringify(selectRouteGate(useRouteGateInputs(ENV_A).target));
  }
  act(() =>
    root.render(
      <InventoryContext value={value}>
        <Probe />
      </InventoryContext>,
    ),
  );
  return JSON.parse(container.textContent) as RouteGate;
}

const KEY = "project-1:service-1";

/** The tab's clock as the driver reads it; its timers never fire on their own. */
let nowMs = 1_000_000;

/** A real exchange driver whose door admits `env-a` and whose registry takes every credential. */
function exchangeDriver(): ExchangeDriver {
  return makeExchangeDriver<unknown>({
    clock: {
      now: () => ({ wall: nowMs, mono: nowMs }),
      random: () => 0.5,
      setTimer: () => () => undefined,
    },
    exchange: async () => ({
      ok: true,
      environmentId: ENV_A,
      descriptor: {
        environmentId: ENV_A,
        serverVersion: "0.12.0",
        update: null,
        identity: "ok",
        identityCheckedAt: null,
      },
      credential: {},
    }),
    install: async () => ({ ok: true }),
    readDescriptor: () => new Promise(() => undefined),
    retryLink: () => undefined,
    refreshPresence: () => undefined,
    retire: () => undefined,
  });
}

/** Lets the driver's queue and every port's answer run. */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

/** The route's target as the inventory publishes it. */
const target = (presence: Presence, container: ContainerVerdict) => ({
  key: KEY,
  presence,
  container,
  record: ENV_A,
});

/** What `__root` renders on a route to `env-a`: the route gate over the route's outlet. */
function RoutedOutlet({
  children,
  gates,
}: {
  readonly children: ReactNode;
  readonly gates: Array<RouteGate["kind"]>;
}) {
  const inputs = useRouteGateInputs(ENV_A);
  const gate = selectRouteGate(inputs.target);
  gates.push(gate.kind);
  return (
    <RouteGateView
      gate={gate}
      phrase={routeGatePhrase(gate, { nowMs, mateName: inputs.mateName })}
      projectId={inputs.projectId}
    >
      {children}
    </RouteGateView>
  );
}

describe("the route gate over the exchange driver's machines", () => {
  it("a zcp restart while connected keeps the same ChatView instance and never shows 'not reachable'", async () => {
    const driver = exchangeDriver();
    shell.driver = driver;
    shell.environments = [
      {
        environmentId: ENV_A,
        displayUrl: ORIGIN,
        label: "shop",
        connection: { phase: "connected" },
      },
    ];
    shell.records = [{ key: KEY, environmentId: ENV_A }];
    const mounts: Array<number> = [];
    function ChatView() {
      useEffect(() => {
        mounts.push(mounts.length + 1);
      }, []);
      return "conversation";
    }
    const gates: Array<RouteGate["kind"]> = [];
    const texts: Array<string> = [];
    const look = () => {
      act(() =>
        root.render(
          <InventoryContext value={inventory("ACTIVE")}>
            <RoutedOutlet gates={gates}>
              <ChatView />
            </RoutedOutlet>
          </InventoryContext>,
        ),
      );
      texts.push(container.textContent);
    };
    const active = target({ kind: "present", origin: ORIGIN }, { level: "ready" });
    const restarting = target(
      { kind: "transitioning", status: "RESTARTING" },
      { level: "restarting", by: "platform", overdue: false },
    );

    driver.setAccount({
      postGrant: true,
      identityMint: { allowed: true },
      zeropsFailing: false,
      grantVerifiedAtMs: nowMs,
    });
    driver.setVisible(true);
    driver.setTargets([active]);
    driver.setDemand("record", [KEY]);
    driver.setDemand("route", [KEY]);
    await settle();
    driver.link(ENV_A, { phase: "connected" });
    await settle();
    look();

    // zcp goes RESTARTING under a live socket, which then drops and keeps retrying for ~25 s.
    driver.setTargets([restarting]);
    await settle();
    look();
    driver.link(ENV_A, { phase: "backoff", retryAtMs: nowMs + 2_000 });
    await settle();
    look();
    for (let second = 0; second < 30; second += 5) {
      nowMs += 5_000;
      driver.link(ENV_A, { phase: "connecting" });
      await settle();
      look();
      driver.link(ENV_A, { phase: "backoff", retryAtMs: nowMs + 4_000 });
      await settle();
      look();
    }

    driver.setTargets([active]);
    driver.link(ENV_A, { phase: "connected" });
    await settle();
    look();

    expect(mounts).toEqual([1]);
    expect(new Set(gates)).toEqual(new Set(["outlet"]));
    expect(texts).toEqual([
      "conversation",
      ...texts.slice(1, -1).map(() => "conversationZerops is restarting this Mate."),
      "conversation",
    ]);
    expect(texts.join(" ")).not.toContain("not reachable");
    driver.dispose();
  });
});

const ENV_B = EnvironmentId.make("env-b");
const HELD = {
  kind: "held",
  environmentId: ENV_A,
  installed: true,
  staleBlock: false,
  rereading: null,
} as const;
const PRESENT = { kind: "present", origin: ORIGIN } as const;

/** A target machine remembered for `env-a`, present and with its container ready. */
const machine = (overrides: Partial<EnvironmentMachine>): EnvironmentMachine => ({
  ...initialEnvironment({ record: ENV_A }),
  presence: PRESENT,
  container: { level: "ready" },
  ...overrides,
});

const below = (latest: string): Partial<EnvironmentMachine> => ({
  credential: { kind: "refused", reason: { kind: "version" } },
  descriptor: {
    environmentId: ENV_A,
    serverVersion: "0.10.4",
    update: {
      installed: "0.10.4",
      latest,
      available: true,
      checkedAt: "2026-09-23T10:00:00.000Z",
    },
    identity: "ok",
    identityCheckedAt: null,
  },
});

/** One machine for every verdict `selectReachability` can give. */
const VERDICTS: ReadonlyArray<readonly [Reachability["kind"], EnvironmentMachine]> = [
  ["gone", machine({ presence: { kind: "gone", evidence: "direct-not-found" } })],
  [
    "replaced",
    machine({
      credential: { ...HELD, environmentId: ENV_B },
      link: { phase: "connected", since: { wall: 0, mono: 0 } },
      superseded: new Map([[ENV_A, ENV_B]]),
    }),
  ],
  ["refused-role", machine({ credential: { kind: "refused", reason: { kind: "role" } } })],
  [
    "refused-configuration",
    machine({ credential: { kind: "refused", reason: { kind: "configuration" } } }),
  ],
  ["update-required", machine(below("0.12.0"))],
  ["update-unavailable", machine(below("0.10.4"))],
  [
    "connecting",
    machine({
      credential: {
        kind: "exchanging",
        attempt: 1,
        deadline: { wall: 1, mono: 1 },
        reconnect: false,
      },
    }),
  ],
  [
    "ready",
    machine({ credential: HELD, link: { phase: "connected", since: { wall: 0, mono: 0 } } }),
  ],
  ["no-address", machine({ presence: { kind: "no-origin", reason: "no-subdomain" } })],
  [
    "container",
    machine({
      container: { level: "booting", overdue: false },
      credential: { kind: "waiting", on: "container", reconnect: false },
    }),
  ],
  [
    "waiting-for-zerops",
    machine({ credential: { kind: "waiting", on: "zerops", reconnect: false } }),
  ],
  [
    "retrying",
    machine({
      credential: {
        kind: "backoff",
        retryAt: { wall: 5_000, mono: 5_000 },
        last: { kind: "network" },
        reconnect: false,
      },
    }),
  ],
  ["reconnecting", machine({ credential: HELD, link: { phase: "backoff", retryAtMs: null } })],
  ["resolving", machine({ presence: { kind: "unknown" } })],
];

/** A driver that publishes exactly these machines. */
const publishing = (machines: ReadonlyMap<string, EnvironmentMachine>) =>
  ({ subscribe: () => () => undefined, machines: () => machines }) as unknown as ExchangeDriver;

const candidate: ZeropsCandidate = {
  key: KEY,
  project: { id: "project-1", name: "shop", status: "ACTIVE" } as ZeropsProject,
  group: "ready",
  service: { id: "service-1", name: "zcp", status: "ACTIVE" },
  containerOrigin: ORIGIN,
};

describe("the route gate and every link into an environment", () => {
  it("has one machine for each verdict", () => {
    expect(VERDICTS.map(([, entry]) => selectReachability(entry, ENV_A).kind)).toEqual(
      VERDICTS.map(([kind]) => kind),
    );
    expect(new Set(VERDICTS.map(([kind]) => kind)).size).toBe(14);
  });

  it.each(VERDICTS)("the gate and the sidebar agree for a %s verdict", (_kind, entry) => {
    shell.driver = publishing(new Map([[KEY, entry]]));
    shell.environments = [
      {
        environmentId: ENV_A,
        displayUrl: ORIGIN,
        label: "shop",
        connection: { phase: "connected" },
      },
    ];
    function Probe() {
      const links = useEnvironmentLinks();
      return JSON.stringify({
        target: useRouteGateInputs(ENV_A).target,
        linkable: links.linkable(ENV_A),
        linkTarget: links.linkTarget(candidate) ?? null,
      });
    }
    act(() =>
      root.render(
        <InventoryContext value={inventory("ACTIVE")}>
          <Probe />
        </InventoryContext>,
      ),
    );
    const seen = JSON.parse(container.textContent) as {
      readonly target: RouteTarget;
      readonly linkable: boolean;
      readonly linkTarget: string | null;
    };

    const reachability = selectReachability(entry, ENV_A);
    expect(seen.target).toEqual({ kind: "resolved", reachability, content: "cached" });
    expect(seen.linkable).toBe(environmentLinkable(reachability));
    expect(seen.linkTarget).toBe(environmentLinkable(reachability) ? ENV_A : null);
    expect(selectRouteGate(seen.target).kind === "unavailable").toBe(
      isTerminalReachability(reachability),
    );
  });
});

describe("useRouteGateInputs", () => {
  it("asks for an organization on a thread deep link before one is chosen", async () => {
    shell.organization = "needs-selection";

    expect(await gateOnRoute(inventory(null))).toEqual({ kind: "choose-organization" });
  });

  const OTHER = "project-1:service-2";
  const other = (credential: EnvironmentMachine["credential"]) =>
    new Map([[OTHER, machine({ record: null, credential })]]);
  const DISCOVERY: ReadonlyArray<{
    readonly name: string;
    readonly machines: ReadonlyMap<string, EnvironmentMachine>;
    readonly records?: ReadonlyArray<{ key: string; environmentId: string }>;
    readonly inventory?: Inventory;
    readonly gate: RouteGate;
  }> = [
    {
      name: "an exchange is running for another Mate",
      machines: other({
        kind: "exchanging",
        attempt: 1,
        deadline: { wall: 1, mono: 1 },
        reconnect: false,
      }),
      gate: { kind: "wait", reachability: null },
    },
    {
      name: "another Mate's credential is answered and its install is on its way",
      machines: other({ ...HELD, environmentId: ENV_B, installed: false }),
      gate: { kind: "wait", reachability: null },
    },
    {
      name: "a remembered target the driver has not taken in yet",
      machines: new Map(),
      records: [{ key: OTHER, environmentId: ENV_B }],
      gate: { kind: "wait", reachability: null },
    },
    {
      name: "the inventory is still loading",
      machines: new Map(),
      inventory: { ...inventory(null), isLoading: true },
      gate: { kind: "wait", reachability: null },
    },
    {
      name: "every exchange has settled and none named it",
      machines: other({
        kind: "backoff",
        retryAt: { wall: 5_000, mono: 5_000 },
        last: { kind: "network" },
        reconnect: false,
      }),
      records: [{ key: OTHER, environmentId: ENV_B }],
      gate: { kind: "unavailable", reachability: null },
    },
  ];

  it.each(DISCOVERY.map((row) => [row.name, row] as const))(
    "an environment no target names: %s",
    async (_name, row) => {
      shell.driver = publishing(row.machines);
      shell.records = [...(row.records ?? [])];

      expect(await gateOnRoute(row.inventory ?? inventory("ACTIVE"))).toEqual(row.gate);
    },
  );
});
