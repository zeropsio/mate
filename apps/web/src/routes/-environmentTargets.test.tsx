import { EnvironmentId } from "@t3tools/contracts";
import type { ZeropsProject, ZeropsService } from "@t3tools/client-runtime/zerops";
import { selectRouteGate, type RouteGate } from "@t3tools/client-runtime/zerops/environments";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { TestNode } from "../zerops/__fixtures__/testDom";
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
  pending: new Set<string>(),
  restoring: false,
  organization: "selected" as ZeropsOrganizationStatus,
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
  hasPendingEnvironmentIdentityExchange: (origin: string) => shell.pending.has(origin),
  useEnvironmentIdentityVersion: () => 0,
}));
vi.mock("../zerops/ZeropsEnvironmentLifetime", () => ({
  useEnvironmentRestorePending: () => shell.restoring,
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
  shell.pending = new Set();
  shell.restoring = false;
  shell.organization = "selected";
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

describe("useRouteGateInputs", () => {
  it("asks for an organization on a thread deep link before one is chosen", async () => {
    shell.organization = "needs-selection";

    expect(await gateOnRoute(inventory(null))).toEqual({ kind: "choose-organization" });
  });

  it("keeps the outlet for a connected Mate whose zcp service is RESTARTING", async () => {
    shell.environments = [
      {
        environmentId: ENV_A,
        displayUrl: ORIGIN,
        label: "shop",
        connection: { phase: "connected" },
      },
    ];
    shell.records = [{ key: "project-1:service-1", environmentId: ENV_A }];

    expect(await gateOnRoute(inventory("RESTARTING"))).toEqual({
      kind: "outlet",
      banner: { kind: "ready", notice: { level: "restarting", by: "platform", overdue: false } },
      composer: "enabled",
    });
  });

  it("is never 'not in your projects' while an exchange is pending", async () => {
    shell.pending = new Set([ORIGIN]);

    expect(await gateOnRoute(inventory("ACTIVE"))).toEqual({ kind: "wait", reachability: null });

    shell.pending = new Set();
    expect(await gateOnRoute(inventory("ACTIVE"))).toEqual({
      kind: "unavailable",
      reachability: null,
    });
  });
});
