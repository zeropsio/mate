import { RegistryContext } from "@effect/atom-react";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { ZeropsProject, ZeropsService } from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import type { AccountEnvironments } from "@t3tools/client-runtime/zerops/account/runtime";
import {
  makeMateAdapter,
  shownCanonicalHqListNavigationAtom,
  type AccountStore,
  type MateAdapter,
  type MateLinkValue,
} from "@t3tools/client-runtime/data";
import {
  environmentLinkable,
  initialContainer,
  initialEnvironment,
  isTerminalReachability,
  MATE_VOICE_QUIET_MS,
  mateVoice,
  routeGatePhrase,
  selectReachability,
  selectRouteGate,
  type EnvironmentMachine,
  type Presence,
  type ProbeReading,
  type Reachability,
  type RouteGate,
  type RouteTarget,
} from "@t3tools/client-runtime/zerops/environments";
import { Atom, AtomRegistry } from "effect/reactivity";
import * as Option from "effect/Option";
import { act, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useComposerDraftStore } from "../composerDraftStore";
import { zeropsSessionAtom } from "../state/zerops";
import { mountHqNavigation } from "~/zerops/__fixtures__/hqNavigation";
import { organization } from "../zerops/__fixtures__/platformData";
import { TestNode } from "../zerops/__fixtures__/testDom";
import {
  namedProject,
  routeTarget,
  useEnvironmentLinks,
  useRouteConversation,
  useRouteGateInputs,
} from "./-environmentTargets";
import { RouteGateView } from "./-routeGate";
import { bindAccountEnvironments } from "../zerops/accountEnvironments";
import { InventoryContext, type Inventory } from "../zerops/inventoryContext";
import { AccountDataContext } from "../zerops/accountData";
import { hqOutage } from "../zerops/hqNavigation";
import { mountRoster } from "@t3tools/client-runtime/zerops/testing";
import { useMateVoice } from "../zerops/mateVoiceContext";
import { ZeropsSessionContext } from "../zerops/sessionContext";
import type { ZeropsOrganizationStatus, ZeropsSessionValue } from "../zerops/ZeropsSessionProvider";

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
  organization: "selected" as ZeropsOrganizationStatus,
  /** Every route the gate handed the account runtime, in order. */
  routes: [] as Array<string | null>,
  /** When the account runtime's sweep asked for each target it reads again. */
}));

/**
 * The account runtime's Mate environments as the hooks ask them: every Mate itself is read from
 * the account's store (`showMates`, or a real Mate adapter writing there).
 */
function shellStage(): AccountEnvironments {
  return {
    setDeleting: () => undefined,
    detailProjects: () => new Set(),
    subscribe: () => () => undefined,
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
  isLoading: false,
  error: null,
  projectRefs: new Map(),
  authority: new Map(),
  lost: new Set(),
  deleted: [],
});

let container: TestNode;
let root: Root;
/** The atoms the hooks read: HQ's word of the organization's Mates. */
let atoms: AtomRegistry.AtomRegistry;
/** The account's store the hooks read each Mate from. */
let store: AccountStore;
/** The Mates `showMates` last wrote as shown. */
let shown: ReadonlySet<string> = new Set();
let sequence = 0;

/**
 * The account's store holds these Mates, as the Mate adapter would have written them: each one's
 * environment machine, and the reading its last probe made, if any. Any shown before and left out
 * here is no longer shown.
 */
function showMates(
  machines: ReadonlyMap<string, EnvironmentMachine>,
  readings: ReadonlyMap<string, ProbeReading> = new Map(),
) {
  const keys = new Set([...machines.keys(), ...readings.keys()]);
  const value = (key: string, isShown: boolean): MateLinkValue => {
    const read = readings.get(key);
    return {
      key,
      projectId: key.split(":")[0] ?? key,
      orgId: "org-1",
      origin: null,
      shown: isShown,
      watched: false,
      environment: machines.get(key) ?? initialEnvironment({ record: null }),
      container:
        read === undefined
          ? initialContainer()
          : { ...initialContainer(), reading: { reading: read, sentAt: { wall: 0, mono: 0 } } },
    };
  };
  const values = [
    ...[...keys].map((key) => value(key, true)),
    ...[...shown].filter((key) => !keys.has(key)).map((key) => value(key, false)),
  ];
  act(() => {
    for (const next of values)
      store.dispatch({
        kind: "rows",
        scope: `mate:${next.projectId}:link`,
        generation: 0,
        method: "read",
        via: "mate-direct",
        rows: [
          {
            family: "mateLink",
            id: next.key,
            value: next,
            revision: { kind: "mate-link", sequence: (sequence += 1) },
          },
        ],
      });
  });
  shown = keys;
}

beforeEach(async () => {
  const environments = await import("../state/environments");
  const { environmentShell } = await import("../state/shell");
  const stage = await import("../components/zerops/ZeropsMateEmptyState");
  const cached = Atom.make({
    snapshot: Option.none(),
    status: "cached" as const,
    error: Option.none(),
  });
  vi.spyOn(environments, "useEnvironments").mockImplementation((() => ({
    environments: shell.environments,
  })) as typeof environments.useEnvironments);
  vi.spyOn(environmentShell, "stateValueAtom").mockReturnValue(cached);
  // This fixture proves route lifetime; the shared stage's rendering has its own tests.
  vi.spyOn(stage, "MateConnectionState").mockImplementation(({ headline, secondary, actions }) => (
    <section>
      {headline} {secondary} {actions}
    </section>
  ));
  const document = new TestNode("#document", null, 9);
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", {
    document,
    HTMLIFrameElement: TestNode,
    addEventListener() {},
    removeEventListener() {},
    // The app's shared clock ticks on the tab's timers, fake ones where a case moves time.
    setTimeout: (...args: Parameters<typeof setTimeout>) => setTimeout(...args),
    clearTimeout: (id: Parameters<typeof clearTimeout>[0]) => clearTimeout(id),
    setInterval: (...args: Parameters<typeof setInterval>) => setInterval(...args),
    clearInterval: (id: Parameters<typeof clearInterval>[0]) => clearInterval(id),
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  root = createRoot(container as unknown as Element);
  atoms = AtomRegistry.make();
  // The organization's services listing holds the project's zcp container.
  store = mountRoster(atoms, "org-1", [project], {
    services: [{ ...zcp("ACTIVE"), projectId: "project-1" }],
  });
  shown = new Set();
  shell.environments = [];
  shell.routes = [];
  shell.organization = "selected";
  unbindStage = bindAccountEnvironments(shellStage());
});

let unbindStage: () => void = () => undefined;

/** Renders under the test's atoms, as the app's registry holds the account's store. */
const renderIn = (node: ReactNode) =>
  root.render(
    <RegistryContext value={atoms}>
      <ZeropsSessionContext
        value={{ organizationStatus: shell.organization } as ZeropsSessionValue}
      >
        {node}
      </ZeropsSessionContext>
    </RegistryContext>,
  );

afterEach(() => {
  act(() => root.unmount());
  unbindStage();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** The gate `__root` selects on a route to `env-a`, over the mocked shell and `inventory`. */
async function gateOnRoute(value: Inventory): Promise<RouteGate> {
  const { useRouteGateInputs } = await import("./-environmentTargets");
  function Probe() {
    return JSON.stringify(selectRouteGate(useRouteGateInputs(ENV_A).target));
  }
  act(() =>
    renderIn(
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

/** A Mate's container answering as Mate for this environment, stating this project. */
const readyAt = (environmentId: EnvironmentId, projectId: string): ProbeReading => ({
  kind: "ready",
  descriptor: {
    environmentId,
    serverVersion: "0.16.0",
    update: null,
    identity: "ok",
    identityCheckedAt: null,
  },
  projectId,
  initAt: null,
});

/**
 * A real Mate adapter over the account's store whose door admits `env-a`, whose registry takes
 * every credential, and whose container answers ready.
 */
function admittingAdapter(): MateAdapter {
  return makeMateAdapter<unknown>({
    store,
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
        serverVersion: "0.16.0",
        update: null,
        identity: "ok",
        identityCheckedAt: null,
      },
      credential: {},
    }),
    install: async () => ({ ok: true }),
    readDescriptor: () => new Promise(() => undefined),
    retryLink: () => undefined,
    retire: () => undefined,
    probe: async () => ({
      reading: readyAt(ENV_A, "project-1"),
      sentAt: { wall: nowMs, mono: nowMs },
    }),
    readInitAt: async () => null,
    readMateFlag: async () => "unknown",
    intents: { read: () => null, write: () => undefined },
  });
}

/** Lets the adapter's queue and every port's answer run. */
const settle = (adapter: MateAdapter) => act(() => adapter.settled());

/** The route's target as the listing publishes it, its service in this status. */
const target = (presence: Presence, service: string) => ({
  key: KEY,
  orgId: "org-1",
  presence,
  origin: ORIGIN,
  platform: { project: "ACTIVE", service },
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

describe("the route gate over the Mate adapter's machines", () => {
  it("a zcp restart while connected keeps the same ChatView instance and never shows 'not reachable'", async () => {
    const driver = admittingAdapter();
    shell.environments = [
      {
        environmentId: ENV_A,
        displayUrl: ORIGIN,
        label: "shop",
        connection: { phase: "connected" },
      },
    ];
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
        renderIn(
          <InventoryContext value={inventory("ACTIVE")}>
            <RoutedOutlet gates={gates}>
              <ChatView />
            </RoutedOutlet>
          </InventoryContext>,
        ),
      );
      texts.push(container.textContent);
    };
    const active = target({ kind: "present", origin: ORIGIN }, "ACTIVE");
    const restarting = target({ kind: "transitioning", status: "RESTARTING" }, "RESTARTING");

    driver.setAccount({
      verified: true,

      zeropsState: "live",
    });
    driver.setVisible(true);
    driver.setTargets([active]);
    driver.setDemand("route", [KEY]);
    await settle(driver);
    driver.link(ENV_A, { phase: "connected" });
    await settle(driver);
    look();

    // zcp goes RESTARTING under a live socket, which then drops and keeps retrying for ~25 s.
    driver.setTargets([restarting]);
    await settle(driver);
    look();
    driver.link(ENV_A, { phase: "backoff", retryAtMs: nowMs + 2_000 });
    await settle(driver);
    look();
    for (let second = 0; second < 30; second += 5) {
      nowMs += 5_000;
      driver.link(ENV_A, { phase: "connecting" });
      await settle(driver);
      look();
      driver.link(ENV_A, { phase: "backoff", retryAtMs: nowMs + 4_000 });
      await settle(driver);
      look();
    }

    driver.setTargets([active]);
    driver.link(ENV_A, { phase: "connected" });
    await settle(driver);
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
  ["update-required", machine(below("0.16.0"))],
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
    showMates(new Map([[KEY, entry]]));
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
      renderIn(
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
    showMates(new Map(machines));
    shell.environments = registered ? [REGISTERED] : [];
    function Probe() {
      return JSON.stringify(useEnvironmentLinks().linkTarget(row) ?? null);
    }
    act(() =>
      renderIn(
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
      gate: { kind: "unavailable", reachability: null },
    },
    {
      name: "the only present Mate serves no Mate at all",
      machines: other({ kind: "none", reconnect: false }),
      readings: new Map([[OTHER, { kind: "predates-mate" }]]),
      gate: { kind: "unavailable", reachability: null },
    },
    {
      // Absence requires complete source coverage.
      name: "every descriptor named another, while the project roster is still partial",
      machines: other({ kind: "none", reconnect: false }),
      readings: new Map([[OTHER, { kind: "predates-mate" }]]),
      inventory: { ...inventory("ACTIVE"), isLoading: true },
      gate: { kind: "wait", reachability: null },
    },
  ];

  it.each(DISCOVERY.map((row) => [row.name, row] as const))(
    "an environment no target names: %s",
    async (_name, row) => {
      showMates(row.machines, row.readings ?? new Map());

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
      "a confirmed loss of its project",
      { ...inventory("ACTIVE"), lost: new Set(["project-1"]) },
      machine({ credential: HELD, link: { phase: "connected", since: { wall: 0, mono: 0 } } }),
      { kind: "suppressed", reason: "access-denied" },
    ],
  ] as const)("the route's conversation under %s", (_name, value, target, conversation) => {
    showMates(new Map([[KEY, target]]));
    function Probe() {
      return JSON.stringify(useRouteConversation(ENV_A));
    }
    act(() =>
      renderIn(
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
    serverVersion: "0.16.0",
    update: null,
    identity: "ok",
    identityCheckedAt: null,
  },
  projectId,
  initAt: null,
});

/**
 * A real Mate adapter over the account's store for present candidates, remembered by `records` or
 * not at all: every exchange waits for the test to answer what its door read of the Mate.
 */
function descriptorRig(
  mates: ReadonlyArray<ReturnType<typeof mate>>,
  records: ReadonlyMap<string, EnvironmentId> = new Map(),
) {
  const pending = new Map<string, (reading: ProbeReading) => void>();
  const retired: Array<string> = [];
  const clock = {
    now: () => ({ wall: nowMs, mono: nowMs }),
    random: () => 0.5,
    setTimer: () => () => undefined,
  };
  const adapter = makeMateAdapter<unknown>({
    store,
    clock,
    exchange: (request) =>
      new Promise((resolve) => {
        // The door read the Mate's descriptor; its exchange goes no further here.
        pending.set(request.origin, (reading) =>
          resolve({
            ok: false,
            failure: { class: "retryable", cause: { kind: "server", status: 503 } },
            descriptor: reading.kind === "ready" ? reading.descriptor : null,
          }),
        );
      }),
    install: async () => ({ ok: true }),
    readDescriptor: () => new Promise(() => undefined),
    retryLink: () => undefined,
    retire: (key) => {
      retired.push(key);
    },
    probe: () => new Promise(() => undefined),
    readInitAt: async () => null,
    readMateFlag: async () => "unknown",
    intents: { read: () => null, write: () => undefined },
  });
  adapter.setAccount({
    verified: true,

    zeropsState: "live",
  });
  adapter.setVisible(true);
  adapter.setTargets(
    mates.map(({ key, origin }) => ({
      key,
      orgId: "org-1",
      presence: { kind: "present", origin } as const,
      origin,
      platform: { project: "ACTIVE", service: "ACTIVE" },
      record: records.get(key) ?? null,
    })),
  );
  return {
    adapter,
    retired,
    /** Answers the exchange in flight at this origin with what its door read. */
    answer: async (origin: string, reading: ProbeReading) => {
      const answer = pending.get(origin);
      if (answer === undefined) throw new Error(`No exchange at ${origin} is in flight.`);
      pending.delete(origin);
      answer(reading);
      await settle(adapter);
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
    renderIn(
      <RegistryContext value={atoms}>
        <InventoryContext value={value}>
          <Probe />
        </InventoryContext>
      </RegistryContext>,
    ),
  );
  return { read: () => JSON.parse(container.textContent) as Routed };
}

const ORG_1 = "org-1";
const OWN_ROW = { clientId: ORG_1 };

describe("routeTarget", () => {
  const NONE_INDEXED = { serving: new Map(), reported: new Map() };
  type Named = Parameters<typeof namedProject>[0];
  /** HQ answered for the organization unless a case says otherwise. */
  const target = (
    named: Omit<Named, "hqIndex" | "hqOutage" | "overdue" | "absenceSaid"> & {
      readonly hqIndex?: Named["hqIndex"] | undefined;
      readonly hqOutage?: Named["hqOutage"] | undefined;
      readonly overdue?: boolean | undefined;
      readonly absenceSaid?: boolean | undefined;
    },
  ) =>
    routeTarget({
      machines: new Map(),
      index: NONE_INDEXED,
      environmentId: ENV_A,
      named: namedProject({
        ...named,
        hqIndex: named.hqIndex ?? "answered",
        hqOutage: named.hqOutage ?? null,
        overdue: named.overdue ?? false,
        absenceSaid: named.absenceSaid ?? false,
      }),
      inventoryKnown: true,
      organization: "chosen",
      content: "empty",
    });
  const MATE_ROW = { service: { id: "service-1" } } as Pick<ZeropsCandidate, "service">;

  it.each([
    {
      name: "its read under way",
      named: {
        hqProject: "project-1",
        listingAnswered: false,
        orgId: ORG_1,
        row: null,
        rows: null,
      },
    },
  ])(
    "a conversation HQ names before the Zerops listing does waits for the listing instead of saying it isn't in your projects: $name",
    ({ named }) => {
      const gate = selectRouteGate(target(named));
      expect(gate).toEqual({ kind: "wait", reachability: null });
      expect(routeGatePhrase(gate, { nowMs: 0, mateName: "Ada" }).text).toBe(
        "Opening this conversation…",
      );
    },
  );
  it.each([
    {
      name: "the listing holds the project, its services not read yet",
      named: {
        hqProject: "project-1",
        listingAnswered: true,
        orgId: ORG_1,
        row: OWN_ROW,
        rows: null,
      },
    },
    {
      name: "its services read with a Mate the account has not taken in yet",
      named: {
        hqProject: "project-1",
        listingAnswered: true,
        orgId: ORG_1,
        row: OWN_ROW,
        rows: [MATE_ROW],
      },
    },
    {
      name: "its services read ahead of the listing, with a Mate",
      named: {
        hqProject: "project-1",
        listingAnswered: false,
        orgId: ORG_1,
        row: OWN_ROW,
        rows: [MATE_ROW],
      },
    },
  ])(
    "a conversation whose project HQ names never says it isn't in your projects before that project's Mate is read: $name",
    ({ named }) => {
      expect(selectRouteGate(target(named))).toEqual({ kind: "wait", reachability: null });
    },
  );
  it.each([
    {
      name: "HQ naming it",
      named: { hqProject: "project-1", listingAnswered: true, orgId: ORG_1, row: null, rows: null },
    },
    {
      name: "the project HQ names another organization's",
      named: {
        hqProject: "project-1",
        orgId: ORG_1,
        listingAnswered: true,
        row: { clientId: "org-2" },
        rows: null,
      },
    },
    {
      name: "HQ naming nothing",
      named: { hqProject: null, listingAnswered: true, orgId: ORG_1, row: null, rows: null },
    },
  ])(
    "once the listing read after HQ named it still lacks the project, the conversation says it isn't in your Zerops projects: $name",
    ({ named }) => {
      const gate = selectRouteGate(target(named));
      expect(gate).toEqual({ kind: "unavailable", reachability: null });
      expect(routeGatePhrase(gate, { nowMs: 0, mateName: "Ada" }).text).toBe(
        "This conversation isn't in your Zerops projects.",
      );
    },
  );
  const RECONNECTING = { kind: "syncing", line: "Reconnecting…", again: false } as const;
  const UNAVAILABLE = { kind: "unavailable", line: "HQ unavailable.", again: true } as const;
  it.each([
    {
      name: "HQ's answer due, nothing saying HQ is slow",
      hqIndex: "due",
      gate: { kind: "wait", reachability: null },
      text: "Opening this conversation…",
      actions: [],
    },
    {
      name: "HQ slow in the menu's sense, with nothing to try again",
      hqIndex: "slow",
      gate: { kind: "wait", reachability: null, hq: { kind: "slow" } },
      text: "HQ is connected but slow to answer. Still waiting…",
      actions: [],
    },
    {
      name: "HQ's answer due past the route's deadline",
      hqIndex: "slow",
      overdue: true,
      gate: { kind: "wait", reachability: null, hq: { kind: "unconfirmed" } },
      text: "HQ hasn't confirmed where this conversation is yet.",
      actions: ["go-to-projects"],
    },
    {
      name: "HQ reconnecting, as the menu says it with nothing to press",
      hqIndex: "due",
      hqOutage: RECONNECTING,
      gate: {
        kind: "wait",
        reachability: null,
        hq: { kind: "outage", line: "Reconnecting…", again: false, overdue: false },
      },
      text: "Reconnecting…",
      actions: [],
    },
    {
      name: "HQ reconnecting past the route's deadline, in the menu's words with the way back to the projects",
      hqIndex: "due",
      hqOutage: RECONNECTING,
      overdue: true,
      gate: {
        kind: "wait",
        reachability: null,
        hq: { kind: "outage", line: "Reconnecting…", again: false, overdue: true },
      },
      text: "Reconnecting…",
      actions: ["go-to-projects"],
    },
    {
      name: "HQ unavailable once its retries are capped, with the menu's Try again",
      hqIndex: "due",
      hqOutage: UNAVAILABLE,
      gate: {
        kind: "wait",
        reachability: null,
        hq: { kind: "outage", line: "HQ unavailable.", again: true, overdue: false },
      },
      text: "HQ unavailable.",
      actions: ["try-again"],
    },
  ] as const)(
    "a conversation nothing remembers names never says it isn't in your projects before every Mate HQ places named its environment: $name",
    ({ gate, text, actions, ...hq }) => {
      const selected = selectRouteGate(
        target({
          hqProject: null,
          ...hq,
          listingAnswered: true,
          orgId: ORG_1,
          row: null,
          rows: null,
        }),
      );
      expect(selected).toEqual(gate);
      expect(routeGatePhrase(selected, { nowMs: 0, mateName: "Ada" })).toEqual({ text, actions });
    },
  );
  it.each([
    { name: "HQ's index waiting again for a Mate placed since", hqIndex: "slow", hqOutage: null },
    { name: "HQ unavailable since", hqIndex: "due", hqOutage: UNAVAILABLE },
  ] as const)(
    "a conversation already said not to be in your projects on HQ's answer is not taken back while HQ still names nothing: $name",
    ({ hqIndex, hqOutage }) => {
      const named = {
        hqProject: null,
        hqIndex,
        hqOutage,
        absenceSaid: true,
        listingAnswered: true,
        orgId: ORG_1,
        row: null,
        rows: null,
      };
      expect(selectRouteGate(target(named))).toEqual({ kind: "unavailable", reachability: null });
      expect(
        selectRouteGate(target({ ...named, hqProject: "project-1", rows: [MATE_ROW] })),
      ).toEqual({ kind: "wait", reachability: null });
    },
  );
});

it.each([
  { name: "read with the listing", listingAnswered: true },
  { name: "read ahead of the listing", listingAnswered: false },
])(
  "a conversation whose project HQ names says it isn't in your Zerops projects once that project's services are read without a Mate: $name",
  ({ listingAnswered }) => {
    const gate = selectRouteGate(
      routeTarget({
        machines: new Map(),
        index: { serving: new Map(), reported: new Map() },
        environmentId: ENV_A,
        named: namedProject({
          hqProject: "project-1",
          hqIndex: "answered",
          hqOutage: null,
          overdue: false,
          absenceSaid: false,
          listingAnswered,
          orgId: ORG_1,
          row: OWN_ROW,
          rows: [{}],
        }),
        inventoryKnown: true,
        organization: "chosen",
        content: "empty",
      }),
    );
    expect(gate).toEqual({ kind: "unavailable", reachability: null });
  },
);

describe("the route's wait on HQ", () => {
  const ENV_C = EnvironmentId.make("env-c");
  const LINK = "hq:org-1" as const;
  const PLACEMENTS = "hq:org-1:hq-placements" as const;
  const PRESENCE = { online: true, since: "2026-10-06T00:00:00Z", overview: "live" } as const;
  /** HQ names one other Mate, serving `env-c`; `unanswered` are placed Mates it relayed nothing of. */
  const hqNaming = (unanswered: ReadonlyArray<string> = []) => ({
    structure: {
      apps: [],
      ungrouped: ["project-9", ...unanswered].map((projectId) => ({
        projectId,
        name: projectId,
        mate: { face: "" },
      })),
    },
    mates: {
      "project-9": {
        presence: PRESENCE,
        identity: { environmentId: ENV_C, serverVersion: "0.16.0", update: null },
      },
    },
    attentionUnanswered: [...unanswered],
  });
  const stream = (key: string, event: object) =>
    act(() => store.dispatch({ kind: "stream", key, now: 0, event } as never));
  /** HQ's connection asked for, its placements unanswered past a first answer's patience. */
  const hqConnecting = () => {
    stream(LINK, { kind: "demand", demanded: true });
    stream(LINK, { kind: "attempt" });
    stream(PLACEMENTS, { kind: "demand", demanded: true });
    stream(PLACEMENTS, { kind: "attempt" });
    stream(PLACEMENTS, { kind: "grace-over", since: 0 });
  };
  function Probe({ environmentId }: { readonly environmentId: EnvironmentId | null }) {
    return JSON.stringify(selectRouteGate(useRouteGateInputs(environmentId).target));
  }
  /** The gate on a route to `environmentId` — the same mount throughout, as `__root` holds it. */
  const look = (environmentId: EnvironmentId | null, value: Inventory = inventory("ACTIVE")) => {
    act(() =>
      renderIn(
        <AccountDataContext value={{ orgId: "org-1", data: store.data, retry: () => {} } as never}>
          <InventoryContext value={value}>
            <Probe environmentId={environmentId} />
          </InventoryContext>
        </AccountDataContext>,
      ),
    );
    return JSON.parse(container.textContent) as RouteGate;
  };
  const pass = (ms: number) => act(() => vi.advanceTimersByTime(ms));
  const OPENING: RouteGate = { kind: "wait", reachability: null };
  const UNCONFIRMED: RouteGate = { kind: "wait", reachability: null, hq: { kind: "unconfirmed" } };
  const ABSENT: RouteGate = { kind: "unavailable", reachability: null };

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("an open conversation does not re-render when HQ's navigation changes or the minute turns", async () => {
    const one = mate(1);
    const rig = descriptorRig([one]);
    /** HQ names the route's Mate, beside the applications `apps` names, none with a project. */
    const naming = (apps: ReadonlyArray<string>) => ({
      structure: {
        apps: apps.map((id) => ({ id, name: id, projects: [], births: [] })),
        ungrouped: [{ projectId: one.projectId, name: "Mate", mate: { face: "" } }],
      },
      mates: {
        [one.projectId]: {
          presence: PRESENCE,
          identity: { environmentId: ENV_A, serverVersion: "0.16.0", update: null },
        },
      },
    });
    mountHqNavigation(atoms, "org-1", naming([]), store);
    await settle(rig.adapter);
    const seen = { renders: 0 };
    function Counted() {
      const kind = useRouteGateInputs(ENV_A).target?.kind ?? null;
      // Each commit of the route's inputs: a render that changed nothing commits all the same.
      useEffect(() => {
        seen.renders += 1;
      });
      return JSON.stringify(kind);
    }
    act(() =>
      renderIn(
        <AccountDataContext value={{ orgId: "org-1", data: store.data, retry: () => {} } as never}>
          <InventoryContext value={inventory("ACTIVE")}>
            <Counted />
          </InventoryContext>
        </AccountDataContext>,
      ),
    );
    expect(container.textContent).toBe('"resolved"');
    const settled = seen.renders;
    // A new application in HQ: its navigation moves on, the route's Mate does not.
    act(() => mountHqNavigation(atoms, "org-1", naming(["docs"]), store));
    pass(60_000);
    expect(seen.renders, "ASSERTION: nothing the open conversation reads changed").toBe(settled);
    rig.adapter.dispose();
  });

  it("a conversation only HQ can name says HQ's outage as the menu says it, Try again where the menu offers it", () => {
    stream(LINK, { kind: "demand", demanded: true });
    stream(LINK, { kind: "attempt" });
    stream(LINK, {
      kind: "fault",
      fault: { outcome: "definitive-refusal", message: "HQ refused" },
      jitter: 0,
    });
    const menu = hqOutage(atoms.get(shownCanonicalHqListNavigationAtom), null, "locale", 0);
    expect(menu?.again, "ASSERTION: the menu says HQ refused, with Try again").toBe(true);
    expect(look(ENV_A)).toEqual({
      kind: "wait",
      reachability: null,
      hq: { kind: "outage", line: menu?.line, again: true, overdue: false },
    });
    pass(20_000);
    expect(look(ENV_A), "ASSERTION: past the deadline, the projects as well").toEqual({
      kind: "wait",
      reachability: null,
      hq: { kind: "outage", line: menu?.line, again: true, overdue: true },
    });
  });

  it("a conversation is said absent when the only other Mate HQ places has never connected", () => {
    mountHqNavigation(
      atoms,
      "org-1",
      {
        structure: {
          apps: [
            {
              id: "app",
              name: "Shop",
              projects: [
                {
                  projectId: "project-8",
                  name: "Newborn",
                  kind: "mate",
                  mate: { face: "", birthId: "birth" },
                },
              ],
              births: [{ id: "birth", face: "", projectId: "project-8" }],
            },
          ],
          ungrouped: [],
        },
        attentionUnanswered: ["project-8"],
      },
      store,
    );
    expect(look(ENV_A)).toEqual(ABSENT);
  });

  it("a conversation a Mate from before the overview may serve says HQ hasn't confirmed it, never that it is absent", () => {
    mountHqNavigation(
      atoms,
      "org-1",
      {
        structure: {
          apps: [],
          ungrouped: [{ projectId: "project-7", name: "Legacy", mate: { face: "" } }],
        },
        mates: {
          "project-7": {
            presence: { ...PRESENCE, overview: "none" },
            identity: null,
          } as never,
        },
      },
      store,
    );
    expect(look(ENV_A)).toEqual(OPENING);
    pass(20_000);
    expect(look(ENV_A), "ASSERTION: past the deadline").toEqual(UNCONFIRMED);
  });

  it("a conversation whose HQ link is still connecting never says HQ is slow", () => {
    hqConnecting();
    expect(look(ENV_A)).toEqual(OPENING);
    pass(6_000);
    expect(look(ENV_A), "ASSERTION: past a first answer's patience, HQ still connecting").toEqual(
      OPENING,
    );
    stream(LINK, { kind: "handshake" });
    expect(look(ENV_A), "ASSERTION: HQ connected, its placements still unanswered").toEqual({
      kind: "wait",
      reachability: null,
      hq: { kind: "slow" },
    });
  });

  it("a conversation's wait on HQ that ended starts its deadline afresh when the route returns", () => {
    hqConnecting();
    look(ENV_A);
    pass(20_000);
    expect(look(ENV_A)).toEqual(UNCONFIRMED);
    expect(look(null)).toEqual({ kind: "outlet", banner: null, composer: "enabled" });
    expect(look(ENV_A), "ASSERTION: back on the route, its wait starts over").toEqual(OPENING);
    pass(20_000);
    expect(look(ENV_A)).toEqual(UNCONFIRMED);
  });

  it("a conversation's HQ deadline spent waiting on another conversation is its own to spend", () => {
    hqConnecting();
    look(ENV_A);
    pass(20_000);
    expect(look(ENV_A)).toEqual(UNCONFIRMED);
    expect(
      look(ENV_B),
      "ASSERTION: another environment's wait starts at its own beginning",
    ).toEqual(OPENING);
  });

  it("a conversation the route never said was absent is not held absent once HQ waits again", () => {
    mountHqNavigation(atoms, "org-1", hqNaming(), store);
    // HQ answered while the projects were still loading: nothing said the conversation is absent.
    expect(look(ENV_A, { ...inventory("ACTIVE"), isLoading: true })).toEqual(OPENING);
    mountHqNavigation(atoms, "org-1", hqNaming(["project-8"]), store);
    expect(look(ENV_A), "ASSERTION: HQ waits on a Mate placed since").toEqual(OPENING);
  });

  it("a conversation said absent on HQ's answer stays absent while HQ waits on a Mate placed since, and only there", () => {
    mountHqNavigation(atoms, "org-1", hqNaming(), store);
    expect(look(ENV_A)).toEqual(ABSENT);
    mountHqNavigation(atoms, "org-1", hqNaming(["project-8"]), store);
    expect(look(ENV_A), "ASSERTION: said absent, and HQ names nothing still").toEqual(ABSENT);
    expect(look(ENV_B), "ASSERTION: another conversation, HQ waiting").toEqual(OPENING);
  });
});

describe("the descriptor index", () => {
  it("resolves a route's environment through HQ's index without a descriptor sweep", async () => {
    const one = mate(1);
    const rig = descriptorRig([one]);
    atoms.set(zeropsSessionAtom, {
      status: "signed-in",
      organizationStatus: "selected",
      activeOrganization: organization,
    });
    mountHqNavigation(
      atoms,
      "org-1",
      {
        structure: {
          apps: [],
          ungrouped: [{ projectId: one.projectId, name: "Mate", mate: { face: "" } }],
        },
        mates: {
          [one.projectId]: {
            presence: { online: true, since: "2026-10-06T00:00:00Z", overview: "live" },
            identity: { environmentId: ENV_A, serverVersion: "0.14.43", update: null },
          },
        },
      },
      store,
    );
    await settle(rig.adapter);

    // Its descriptor never answers: HQ's word alone names the route's Mate.
    const seen = routeTo(ENV_A).read();
    expect(seen.target?.kind).toBe("resolved");
    expect(seen.projectId).toBe(one.projectId);
    rig.adapter.dispose();
  });

  it("an unknown deep link offers the organization picker without waiting for other projects", async () => {
    const one = mate(1);
    const rig = descriptorRig([one]);
    shell.organization = "needs-selection";
    await settle(rig.adapter);
    const made = EnvironmentId.make("env-made-up");
    const before = {
      real: selectRouteGate(routeTo(ENV_A).read().target),
      made: selectRouteGate(routeTo(made).read().target),
    };

    // A descriptor read for an explicit demand may subsequently name the route.
    rig.adapter.setDemand("screen", [one.key]);
    await settle(rig.adapter);
    await rig.answer(one.origin, answering(ENV_A, one.projectId));

    expect(before).toEqual({
      real: { kind: "choose-organization" },
      made: { kind: "choose-organization" },
    });
    expect(routeTo(ENV_A).read().target?.kind).toBe("resolved");
    // Settled without naming it: choosing an organization is what is left to offer (A5).
    expect(selectRouteGate(routeTo(made).read().target)).toEqual({ kind: "choose-organization" });
    rig.adapter.dispose();
  });

  it("a changed envId marks the old route replaced, drafts kept", async () => {
    const one = mate(1);
    const rig = descriptorRig([one], new Map([[one.key, ENV_A]]));
    rig.adapter.setDemand("recent", [one.key]);
    const draft = scopeThreadRef(ENV_A, ThreadId.make("thread-1"));
    useComposerDraftStore.getState().setPrompt(draft, "keep me");
    await settle(rig.adapter);
    function Probe({ environmentId }: { readonly environmentId: EnvironmentId }) {
      const inputs = useRouteGateInputs(environmentId);
      return JSON.stringify({
        gate: selectRouteGate(inputs.target),
        linkable: useEnvironmentLinks().linkable(environmentId),
      });
    }
    const look = (environmentId: EnvironmentId) => {
      act(() =>
        renderIn(
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
    expect(rig.adapter.machines(one.key)?.environment.record).toBe(ENV_A);
    expect(useComposerDraftStore.getState().draftsByThreadKey[scopedThreadKey(draft)]?.prompt).toBe(
      "keep me",
    );
    rig.adapter.dispose();
  });
});

it("the gate names HQ's Mate on its first render instead of the environment catalog label", () => {
  shell.environments = [
    {
      environmentId: ENV_A,
      displayUrl: ORIGIN,
      label: "Old label",
      connection: { phase: "connected" },
    },
  ];
  mountHqNavigation(
    atoms,
    "org-1",
    {
      structure: {
        apps: [],
        ungrouped: [{ projectId: "project-1", name: "Quill", mate: { face: "sky:seal" } }],
      },
      mates: {
        "project-1": {
          presence: { online: true, since: "2026-10-07T00:00:00Z", overview: "live" },
          identity: { environmentId: ENV_A, serverVersion: "0.14.43", update: null },
        },
      },
    },
    store,
  );
  const frames: Array<{ name: string; projectId: string | null }> = [];
  function Probe() {
    const inputs = useRouteGateInputs(ENV_A);
    frames.push({ name: inputs.mateName, projectId: inputs.projectId });
    return inputs.mateName;
  }
  act(() => renderIn(<Probe />));
  expect(frames[0]).toEqual({ name: "Quill", projectId: "project-1" });
  expect(container.textContent).toBe("Quill");
});

it("the gate keeps its placeholder when HQ names no Mate for the environment", () => {
  shell.environments = [
    {
      environmentId: ENV_A,
      displayUrl: ORIGIN,
      label: "Guess",
      connection: { phase: "connected" },
    },
  ];
  function Probe() {
    return useRouteGateInputs(ENV_A).mateName;
  }
  act(() => renderIn(<Probe />));
  expect(container.textContent).toBe("This Mate");
});
