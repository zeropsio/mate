import { RegistryContext } from "@effect/atom-react";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { ZeropsProject, ZeropsService } from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import type { AccountEnvironments } from "@t3tools/client-runtime/zerops/account/runtime";
import {
  environmentLinkable,
  indexDescriptors,
  initialContainer,
  initialEnvironment,
  isTerminalReachability,
  makeContainerStore,
  makeExchangeDriver,
  MATE_VOICE_QUIET_MS,
  mateVoice,
  routeGatePhrase,
  selectReachability,
  selectRouteGate,
  type ContainerMachine,
  type ContainerStore,
  type ContainerVerdict,
  type DescriptorIndex,
  type EnvironmentMachine,
  type ExchangeDriver,
  type Presence,
  type ProbeReading,
  type Reachability,
  type RegistrationRecord,
  type RouteGate,
  type RouteTarget,
} from "@t3tools/client-runtime/zerops/environments";
import type { MateLiveView } from "@t3tools/shared/hqMates";
import { AtomRegistry } from "effect/unstable/reactivity";
import { act, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useComposerDraftStore } from "../composerDraftStore";
import { zeropsSessionAtom } from "../state/zerops";
import { mountHqNavigation } from "~/zerops/__fixtures__/hqNavigation";
import { TestNode } from "../zerops/__fixtures__/testDom";
import {
  useEnvironmentLinks,
  useRouteConversation,
  useRouteGateInputs,
} from "./-environmentTargets";
import { RouteGateView } from "./-routeGate";
import { bindAccountEnvironments } from "../zerops/accountEnvironments";
import { InventoryContext, type Inventory } from "../zerops/inventoryContext";
import { useMateVoice } from "../zerops/mateVoiceContext";
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
  records: [] as Array<{ targetKey: string; environmentId: string }>,
  organization: "selected" as ZeropsOrganizationStatus,
  driver: null as unknown,
  containers: null as unknown,
  /** Every route the gate handed the account runtime, in order. */
  routes: [] as Array<string | null>,
  /** When the account runtime's sweep asked for each target it reads again. */
}));

vi.mock("../state/environments", () => ({
  useEnvironments: () => ({ environments: shell.environments }),
  useEnvironmentConnectionState: () => ({ data: null }),
}));
vi.mock("../state/shell", async () => {
  const { Atom } = await import("effect/unstable/reactivity");
  const Option = await import("effect/Option");
  const cached = Atom.make({ snapshot: Option.none(), status: "cached", error: Option.none() });
  return { environmentShell: { stateValueAtom: () => cached } };
});
vi.mock("../zerops/ZeropsSessionProvider", () => ({
  useZeropsSession: () => ({ organizationStatus: shell.organization }),
}));

/**
 * The account runtime's Mate environments as the hooks read them, over whichever driver, container
 * store and records the test put in `shell`.
 */
function shellStage(): AccountEnvironments {
  const driver = () => shell.driver as ExchangeDriver;
  const containers = () => shell.containers as ContainerStore;
  let indexed: {
    readonly machines: ReadonlyMap<string, EnvironmentMachine>;
    readonly containers: ReadonlyMap<string, ContainerMachine>;
    readonly index: DescriptorIndex;
  } | null = null;
  return {
    setDeleting: (projectId, deleting) => driver().setDeleting(projectId, deleting),
    closeOffHolds: () => new Map(),
    detailProjects: () => new Set(),
    detailFailure: () => null,
    retryDetail: () => undefined,
    machines: () => driver().machines(),
    containers: () => containers().machines(),
    records: () => shell.records as unknown as ReadonlyArray<RegistrationRecord>,
    index: () => {
      const [machines, readings] = [driver().machines(), containers().machines()];
      if (indexed?.machines !== machines || indexed.containers !== readings) {
        indexed = {
          machines,
          containers: readings,
          index: indexDescriptors(machines, readings),
        };
      }
      return indexed.index;
    },
    subscribe: (listener) => {
      const stops = [driver().subscribe(listener), containers().subscribe(listener)];
      return () => {
        for (const stop of stops) stop();
      };
    },
    connect: () => new Promise(() => undefined),
    hold: () => () => undefined,
    intend: () => false,
    initAt: async () => null,
    next: () => new Promise(() => undefined),
    setRoute: (environmentId) => {
      shell.routes.push(environmentId);
    },
    setActiveOrganization: () => undefined,
    setOnScreen: () => undefined,
    setDrawn: () => undefined,
  };
}

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
  account: { kind: "authorized" },
  lost: new Set(),
});

let container: TestNode;
let root: Root;
/** The atoms the hooks read: HQ's word of the organization's Mates. */
let atoms: AtomRegistry.AtomRegistry;

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
  atoms = AtomRegistry.make();
  shell.environments = [];
  shell.records = [];
  shell.routes = [];
  shell.organization = "selected";
  shell.driver = publishing(new Map());
  shell.containers = descriptorRig([]).containers;
  unbindStage = bindAccountEnvironments(shellStage());
});

let unbindStage: () => void = () => undefined;

afterEach(() => {
  act(() => root.unmount());
  unbindStage();
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
      conversation={useRouteConversation(ENV_A)}
      stage={null}
      voice={mateVoice({
        reachability:
          gate.kind === "outlet" ? gate.banner : gate.kind === "wait" ? gate.reachability : null,
        conversationShown: gate.kind === "outlet",
        heldMs: MATE_VOICE_QUIET_MS,
        nowMs,
        mateName: "Shop",
      })}
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
    shell.records = [{ targetKey: KEY, environmentId: ENV_A }];
    const mounts: Array<number> = [];
    function ChatView() {
      useEffect(() => {
        mounts.push(mounts.length + 1);
      }, []);
      // The link's one voice comes down to the conversation, for its banner.
      const voice = useMateVoice();
      return `conversation${voice.surface === "banner" ? ` · ${voice.text ?? ""}` : ""}`;
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
      ...texts.slice(1, -1).map(() => "conversation · Shop is restarting."),
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
const LAPSED = { kind: "withheld", reason: "access-lapsed", cause: null } as const;

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
  [
    "reconnecting",
    machine({
      credential: HELD,
      link: { phase: "backoff", retryAtMs: null },
      linkLostAt: { wall: 0, mono: 0 },
    }),
  ],
  ["resolving", machine({ presence: { kind: "unknown" } })],
];

/** A driver that publishes exactly these machines. */
const publishing = (machines: ReadonlyMap<string, EnvironmentMachine>) =>
  ({ subscribe: () => () => undefined, machines: () => machines }) as unknown as ExchangeDriver;

/** A container store whose probes last read these, target by target; it reads nothing more. */
const reading = (readings: ReadonlyMap<string, ProbeReading>) => {
  const machines = new Map<string, ContainerMachine>(
    [...readings].map(([key, value]) => [
      key,
      { ...initialContainer(), reading: { reading: value, sentAt: { wall: 0, mono: 0 } } },
    ]),
  );
  return {
    subscribe: () => () => undefined,
    machines: () => machines,
    request: () => undefined,
  } as unknown as ContainerStore;
};

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

// The owner, 2026-09-30: "all of the sudden when I now try to open Quinn or Wren it just throws me
// at /zerops page". A Mate's row is the listing's; what links to it is its machine. While its
// project's services are not read — before their first read, or once the project's inventory lease
// was released and its services query with it — the listing's row stands for the whole project
// (`projectCandidates`: the project's id for its key, no service), and the target that key names is
// nobody's Mate.
describe("a Mate's link, whatever its row says of it at the moment", () => {
  /** The row `projectCandidates` gives a project whose services are not read. */
  const placeholder: ZeropsCandidate = {
    key: "project-1",
    project: candidate.project,
    group: "unavailable",
  };
  /** What the driver keeps for the placeholder's own target: nothing known there. */
  const nobody: EnvironmentMachine = {
    ...initialEnvironment({ record: null }),
    presence: { kind: "unknown" },
  };
  const CONNECTED = machine({
    credential: HELD,
    link: { phase: "connected", since: { wall: 0, mono: 0 } },
  });
  const REGISTERED = {
    environmentId: ENV_A,
    displayUrl: ORIGIN,
    label: "shop",
    connection: { phase: "connected" },
  };
  it.each<{
    readonly case: string;
    readonly row: ZeropsCandidate;
    readonly machines: ReadonlyArray<readonly [string, EnvironmentMachine]>;
    readonly registered: boolean;
    readonly opens: string | null;
  }>([
    {
      case: "its services not read: the environment its Mate's machine holds",
      row: placeholder,
      machines: [
        [KEY, CONNECTED],
        ["project-1", nobody],
      ],
      registered: true,
      opens: ENV_A,
    },
    {
      case: "its services not read, its machine reconnecting on its record",
      row: placeholder,
      machines: [
        [KEY, machine({ credential: { kind: "none", reconnect: true } })],
        ["project-1", nobody],
      ],
      registered: true,
      opens: ENV_A,
    },
    {
      case: "its services read without its container for a moment (MC-14)",
      row: { ...placeholder, missingContainer: true },
      machines: [
        [KEY, CONNECTED],
        ["project-1", nobody],
      ],
      registered: true,
      opens: ENV_A,
    },
    {
      case: "its row naming its target, as ever",
      row: candidate,
      machines: [[KEY, CONNECTED]],
      registered: true,
      opens: ENV_A,
    },
    {
      case: "its environment not registered in this tab: nothing to open yet",
      row: placeholder,
      machines: [
        [KEY, CONNECTED],
        ["project-1", nobody],
      ],
      registered: false,
      opens: null,
    },
    {
      case: "nothing of its project known",
      row: placeholder,
      machines: [["project-1", nobody]],
      registered: true,
      opens: null,
    },
  ])("$case", ({ row, machines, registered, opens }) => {
    shell.driver = publishing(new Map(machines));
    shell.environments = registered ? [REGISTERED] : [];
    function Probe() {
      return JSON.stringify(useEnvironmentLinks().linkTarget(row) ?? null);
    }
    act(() =>
      root.render(
        <InventoryContext value={inventory("ACTIVE")}>
          <Probe />
        </InventoryContext>,
      ),
    );
    expect(JSON.parse(container.textContent)).toBe(opens);
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
    readonly records?: ReadonlyArray<{ targetKey: string; environmentId: string }>;
    readonly inventory?: Inventory;
    /** What the probes last read at each target's origin, sent at 0. */
    readonly readings?: ReadonlyMap<string, ProbeReading>;
    /** The targets the sweep asked to read again, at 0. */
    readonly gate: RouteGate;
  }> = [
    {
      name: "an unopened project's exchange does not delay an unknown route",
      machines: other({
        kind: "exchanging",
        attempt: 1,
        deadline: { wall: 1, mono: 1 },
        reconnect: false,
      }),
      gate: { kind: "unavailable", reachability: null },
    },
    {
      name: "an unopened project's unread descriptor does not delay an unknown route",
      machines: other({ kind: "none", reconnect: false }),
      gate: { kind: "unavailable", reachability: null },
    },
    {
      name: "an exchange is running for another Mate",
      machines: other({
        kind: "exchanging",
        attempt: 1,
        deadline: { wall: 1, mono: 1 },
        reconnect: false,
      }),
      gate: { kind: "unavailable", reachability: null },
    },
    {
      name: "another Mate's credential is answered and its install is on its way",
      machines: other({ ...HELD, environmentId: ENV_B, installed: false }),
      gate: { kind: "unavailable", reachability: null },
    },
    {
      name: "a remembered target the driver has not taken in yet",
      machines: new Map(),
      records: [{ targetKey: OTHER, environmentId: ENV_B }],
      gate: { kind: "unavailable", reachability: null },
    },
    {
      name: "the inventory is still loading",
      machines: new Map(),
      inventory: { ...inventory(null), isLoading: true },
      gate: { kind: "wait", reachability: null },
    },
    {
      name: "a present Mate's descriptor has not been read",
      machines: other({
        kind: "backoff",
        retryAt: { wall: 5_000, mono: 5_000 },
        last: { kind: "network" },
        reconnect: false,
      }),
      records: [{ targetKey: OTHER, environmentId: ENV_B }],
      gate: { kind: "unavailable", reachability: null },
    },
    {
      name: "a present Mate's descriptor read failed once (a network or CORS failure)",
      machines: other({
        kind: "backoff",
        retryAt: { wall: 5_000, mono: 5_000 },
        last: { kind: "network" },
        reconnect: false,
      }),
      records: [{ targetKey: OTHER, environmentId: ENV_B }],
      readings: new Map([[OTHER, { kind: "unreachable" }]]),
      gate: { kind: "unavailable", reachability: null },
    },
    {
      name: "the only present Mate's descriptor failed the sweep's read too",
      machines: other({
        kind: "backoff",
        retryAt: { wall: 5_000, mono: 5_000 },
        last: { kind: "network" },
        reconnect: false,
      }),
      records: [{ targetKey: OTHER, environmentId: ENV_B }],
      readings: new Map([[OTHER, { kind: "unreachable" }]]),
      gate: { kind: "unavailable", reachability: null },
    },
    {
      name: "a present Mate is still coming up when the sweep reads it",
      machines: other({ kind: "none", reconnect: false }),
      readings: new Map([[OTHER, { kind: "initializing", initAt: null }]]),
      gate: { kind: "unavailable", reachability: null },
    },
    {
      name: "every exchange has settled and every present descriptor named another",
      machines: other({
        kind: "backoff",
        retryAt: { wall: 5_000, mono: 5_000 },
        last: { kind: "network" },
        reconnect: false,
      }),
      records: [{ targetKey: OTHER, environmentId: ENV_B }],
      readings: new Map([[OTHER, answering(ENV_B, "project-1")]]),
      gate: { kind: "unavailable", reachability: null },
    },
    {
      name: "the only present Mate's descriptor names it for another project",
      machines: other({ kind: "none", reconnect: false }),
      readings: new Map([[OTHER, answering(ENV_A, "project-2")]]),
      gate: { kind: "unavailable", reachability: null },
    },
    {
      // A16: its services are not read yet, so the listing may still name another origin.
      name: "a remembered Mate's descriptor named another environment, and it waits for its presence",
      machines: new Map([
        [
          OTHER,
          machine({
            record: null,
            presence: { kind: "remembered", origin: "https://other.example" },
            credential: { kind: "waiting", on: "presence", reconnect: false },
          }),
        ],
      ]),
      records: [{ targetKey: OTHER, environmentId: ENV_B }],
      gate: { kind: "unavailable", reachability: null },
    },
    {
      name: "the only present Mate serves no Mate at all",
      machines: other({ kind: "none", reconnect: false }),
      readings: new Map([[OTHER, { kind: "predates-mate" }]]),
      gate: { kind: "unavailable", reachability: null },
    },
    {
      // Absence is earned under verified access only (M5): a lapse keeps looking.
      name: "every descriptor named another, while the account's access lapses",
      machines: other({ kind: "none", reconnect: false }),
      readings: new Map([[OTHER, { kind: "predates-mate" }]]),
      inventory: { ...inventory("ACTIVE"), account: LAPSED },
      gate: { kind: "wait", reachability: null },
    },
  ];

  it.each(DISCOVERY.map((row) => [row.name, row] as const))(
    "an environment no target names: %s",
    async (_name, row) => {
      shell.driver = publishing(row.machines);
      shell.containers = reading(row.readings ?? new Map());
      shell.records = [...(row.records ?? [])];

      expect(await gateOnRoute(row.inventory ?? inventory("ACTIVE"))).toEqual(row.gate);
    },
  );

  // DESIGN §9 C1b over the route's own target machine and its project's published access.
  const DROPPED = { phase: "backoff", retryAtMs: null } as const;
  it.each([
    [
      "verified access",
      inventory("ACTIVE"),
      machine({ credential: HELD, link: DROPPED }),
      { kind: "shown", until: null },
    ],
    [
      "a lapse over a connected link",
      { ...inventory("ACTIVE"), account: LAPSED },
      machine({ credential: HELD, link: { phase: "connected", since: { wall: 0, mono: 0 } } }),
      { kind: "shown", until: null },
    ],
    [
      "a lapse over a link that dropped more than 10 min ago",
      { ...inventory("ACTIVE"), account: LAPSED },
      machine({ credential: HELD, link: DROPPED, linkLostAt: { wall: 0, mono: 0 } }),
      { kind: "suppressed", reason: "access-lapsed" },
    ],
    [
      "a confirmed loss of its project",
      { ...inventory("ACTIVE"), lost: new Set(["project-1"]) },
      machine({ credential: HELD, link: { phase: "connected", since: { wall: 0, mono: 0 } } }),
      { kind: "suppressed", reason: "access-denied" },
    ],
  ] as const)("the route's conversation under %s", (_name, value, target, conversation) => {
    shell.driver = publishing(new Map([[KEY, target]]));
    function Probe() {
      return JSON.stringify(useRouteConversation(ENV_A));
    }
    act(() =>
      root.render(
        <InventoryContext value={value}>
          <Probe />
        </InventoryContext>,
      ),
    );

    expect(JSON.parse(container.textContent)).toEqual(conversation);
  });
});

// ── Cached descriptor identity joins (§4.8 resolveTarget) ──────────────────────────────────

/** A Mate a present candidate serves: its target, its origin and its project. */
const mate = (index: number) => ({
  key: `project-${index}:service-${index}`,
  origin: `https://zcp-${index}-8080.prg1.zerops.app`,
  projectId: `project-${index}`,
});

/** A descriptor that answered as Mate for this environment, stating this project. */
const answering = (environmentId: EnvironmentId, projectId: string): ProbeReading => ({
  kind: "ready",
  descriptor: {
    environmentId,
    serverVersion: "0.12.0",
    update: null,
    identity: "ok",
    identityCheckedAt: null,
  },
  projectId,
  initAt: null,
});

/**
 * A real container store and exchange driver for present candidates, remembered by `records` or
 * not at all: every probe waits for the test to answer it, and no exchange ever answers.
 */
function descriptorRig(
  mates: ReadonlyArray<ReturnType<typeof mate>>,
  records: ReadonlyMap<string, EnvironmentId> = new Map(),
) {
  const pending = new Map<
    string,
    { readonly resolve: (reading: ProbeReading) => void; readonly reject: (cause: Error) => void }
  >();
  const probed: Array<string> = [];
  const retired: Array<string> = [];
  const timers = new Set<{ readonly atMs: number; readonly fire: () => void }>();
  const clock = {
    now: () => ({ wall: nowMs, mono: nowMs }),
    random: () => 0.5,
    setTimer: (delayMs: number, fire: () => void) => {
      const timer = { atMs: nowMs + delayMs, fire };
      timers.add(timer);
      return () => void timers.delete(timer);
    },
  };
  let intents: string | null = null;
  const containers: ContainerStore = makeContainerStore({
    clock,
    probe: (origin) => {
      const sentAt = clock.now();
      return new Promise((resolve, reject) => {
        probed.push(origin);
        pending.set(origin, { resolve: (reading) => resolve({ reading, sentAt }), reject });
      });
    },
    readInitAt: async () => null,
    readMateFlag: async () => "unknown",
    intents: {
      read: () => intents,
      write: (value) => {
        intents = value;
      },
    },
  });
  const driver = makeExchangeDriver<unknown>({
    clock,
    exchange: () => new Promise(() => undefined),
    install: async () => ({ ok: true }),
    readDescriptor: () => new Promise(() => undefined),
    retryLink: () => undefined,
    refreshPresence: () => undefined,
    retire: (key) => {
      retired.push(key);
    },
  });
  containers.setTargets(
    mates.map(({ key, origin }) => ({
      key,
      origin,
      platform: { project: "ACTIVE", service: "ACTIVE" },
    })),
  );
  driver.setAccount({
    postGrant: true,
    identityMint: { allowed: true },
    zeropsFailing: false,
    grantVerifiedAtMs: nowMs,
  });
  driver.setVisible(true);
  driver.setTargets(
    mates.map(({ key, origin }) => ({
      key,
      presence: { kind: "present", origin } as const,
      container: { level: "unknown" } as const,
      record: records.get(key) ?? null,
    })),
  );
  return {
    containers,
    driver,
    probed,
    retired,
    /** Answers the probe in flight for this origin. */
    answer: async (origin: string, reading: ProbeReading) => {
      const probe = pending.get(origin);
      if (probe === undefined) throw new Error(`No probe of ${origin} is in flight.`);
      pending.delete(origin);
      probe.resolve(reading);
      await settle();
    },

    /** Time passes: every timer that comes due fires, in order. */
    advance: async (ms: number) => {
      nowMs += ms;
      for (const timer of [...timers].toSorted((left, right) => left.atMs - right.atMs)) {
        if (timer.atMs > nowMs || !timers.has(timer)) continue;
        timers.delete(timer);
        timer.fire();
      }
      await settle();
    },
    /** Fails the probe in flight for this origin the way a dead origin's CORS refusal does. */
    fail: async (origin: string) => {
      const probe = pending.get(origin);
      if (probe === undefined) throw new Error(`No probe of ${origin} is in flight.`);
      pending.delete(origin);
      probe.reject(new TypeError("Failed to fetch"));
      await settle();
    },
  };
}

interface Routed {
  readonly target: RouteTarget | null;
  readonly projectId: string | null;
}

/** Mounts what `__root` reads for a route to the environment; `read` looks again. */
function routeTo(environmentId: EnvironmentId, value: Inventory = inventory("ACTIVE")) {
  function Probe() {
    const inputs = useRouteGateInputs(environmentId);
    return JSON.stringify({ target: inputs.target, projectId: inputs.projectId });
  }
  act(() =>
    root.render(
      <RegistryContext value={atoms}>
        <InventoryContext value={value}>
          <Probe />
        </InventoryContext>
      </RegistryContext>,
    ),
  );
  return { read: () => JSON.parse(container.textContent) as Routed };
}

describe("the descriptor index", () => {
  it("resolves a route's environment through HQ's index without a descriptor sweep", async () => {
    const one = mate(1);
    const rig = descriptorRig([one]);
    shell.driver = rig.driver;
    shell.containers = rig.containers;
    atoms.set(zeropsSessionAtom, {
      status: "signed-in",
      organizationStatus: "selected",
      activeOrganization: { organizationId: "org-acme" },
    } as never);
    mountHqNavigation(atoms, "org-acme", {
      structure: {
        apps: [],
        ungrouped: [{ projectId: one.projectId, name: "Mate", mate: { face: "" } }],
      },
      mates: {
        [one.projectId]: {
          presence: { online: true, since: "2026-10-06T00:00:00Z", overview: "live" },
          identity: { environmentId: ENV_A },
        } as unknown as MateLiveView,
      },
    });
    await settle();

    // Its descriptor never answers: HQ's word alone names the route's Mate.
    const seen = routeTo(ENV_A).read();
    expect(seen.target?.kind).toBe("resolved");
    expect(seen.projectId).toBe(one.projectId);
    rig.driver.dispose();
    rig.containers.dispose();
  });

  it("a cached descriptor resolves a deep link with no HQ or registration record", async () => {
    const one = mate(1);
    const rig = descriptorRig([one]);
    shell.driver = rig.driver;
    shell.containers = rig.containers;
    await settle();
    const routed = routeTo(ENV_A);
    expect(selectRouteGate(routed.read().target)).toEqual({
      kind: "unavailable",
      reachability: null,
    });
    // The route is the account runtime's demand: it exchanges the route's target first.
    expect(shell.routes).toEqual([ENV_A]);

    await rig.answer(one.origin, answering(ENV_A, one.projectId));

    const seen = routed.read();
    expect(seen.target?.kind).toBe("resolved");
    expect(seen.projectId).toBe(one.projectId);
    rig.driver.dispose();
    rig.containers.dispose();
  });

  it("an unknown deep link offers the organization picker without waiting for other projects", async () => {
    const one = mate(1);
    const rig = descriptorRig([one]);
    shell.driver = rig.driver;
    shell.containers = rig.containers;
    shell.organization = "needs-selection";
    await settle();
    const made = EnvironmentId.make("env-made-up");
    const before = {
      real: selectRouteGate(routeTo(ENV_A).read().target),
      made: selectRouteGate(routeTo(made).read().target),
    };

    // A descriptor already read for an explicit demand may subsequently name the route.
    await rig.answer(one.origin, answering(ENV_A, one.projectId));

    expect(before).toEqual({
      real: { kind: "choose-organization" },
      made: { kind: "choose-organization" },
    });
    expect(routeTo(ENV_A).read().target?.kind).toBe("resolved");
    // Settled without naming it: choosing an organization is what is left to offer (A5).
    expect(selectRouteGate(routeTo(made).read().target)).toEqual({ kind: "choose-organization" });
    rig.driver.dispose();
    rig.containers.dispose();
  });

  it("a changed envId marks the old route replaced, drafts kept", async () => {
    const one = mate(1);
    const rig = descriptorRig([one], new Map([[one.key, ENV_A]]));
    shell.driver = rig.driver;
    shell.containers = rig.containers;
    shell.records = [{ targetKey: one.key, environmentId: ENV_A }];
    rig.driver.setDemand("recent", [one.key]);
    const draft = scopeThreadRef(ENV_A, ThreadId.make("thread-1"));
    useComposerDraftStore.getState().setPrompt(draft, "keep me");
    await settle();
    function Probe({ environmentId }: { readonly environmentId: EnvironmentId }) {
      const inputs = useRouteGateInputs(environmentId);
      return JSON.stringify({
        gate: selectRouteGate(inputs.target),
        linkable: useEnvironmentLinks().linkable(environmentId),
      });
    }
    const look = (environmentId: EnvironmentId) => {
      act(() =>
        root.render(
          <InventoryContext value={inventory("ACTIVE")}>
            <Probe environmentId={environmentId} />
          </InventoryContext>,
        ),
      );
      return JSON.parse(container.textContent) as { gate: RouteGate; linkable: boolean };
    };

    // The Mate was redeployed with its data history: its descriptor now reports another environment.
    await rig.answer(one.origin, answering(ENV_B, one.projectId));

    expect(look(ENV_A)).toEqual({
      gate: { kind: "unavailable", reachability: { kind: "replaced", by: ENV_B } },
      linkable: false,
    });
    // Nothing retired the target: its record, and every draft keyed by the old environment, stay.
    expect(rig.retired).toEqual([]);
    expect(rig.driver.machine(one.key)?.record).toBe(ENV_A);
    expect(useComposerDraftStore.getState().draftsByThreadKey[scopedThreadKey(draft)]?.prompt).toBe(
      "keep me",
    );
    rig.driver.dispose();
    rig.containers.dispose();
  });
});
