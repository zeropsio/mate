/**
 * HQ's card shows HQ's services as the organization's services listing holds them, and holds HQ's
 * project's newest builds — its process history, a detail of the account's store — only while it
 * is open. It weighs them anew when HQ answers with another Core, reading nothing again. A listing
 * that was refused says so.
 */
import {
  accountReadsAtom,
  historyScope,
  servicesScope,
  type AccountStore,
} from "@t3tools/client-runtime/data";
import type { ZeropsService } from "@t3tools/client-runtime/zerops";
import type { ActivityProcess } from "@t3tools/client-runtime/zerops/activity/dto";
import { mountRoster } from "@t3tools/client-runtime/zerops/testing";
import { RegistryContext } from "@effect/atom-react";
import { type Atom, AtomRegistry } from "effect/reactivity";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { hqStandingAtom } from "~/state/zerops";
import type { HqStanding } from "~/zerops/accountHq";

import { ZeropsHqCard } from "./ZeropsHqCard";

const RUNS = "20261003T080500Z.ba9876543210";
const CARRIED = "20261004T100000Z.0123456789ab";

/** The Core HQ's health answers with. */
const health = vi.hoisted(() => ({ build: "20261003T080500Z.ba9876543210" }));

vi.mock("~/zerops/ZeropsSessionProvider", () => ({
  useZeropsSession: () => ({
    activeOrganization: { id: "org1", membershipId: "m1", roleCode: "OWNER" },
    user: { id: "u1" },
  }),
}));
vi.mock("~/zerops/accountOperations", () => ({
  useAccountOperations: () => ({ run: async () => undefined }),
}));
vi.mock("~/zerops/accountHq", () => ({
  useAccountHq: () => ({
    hq: { kind: "official", projectId: "hq1", address: "https://hq.example.test" },
  }),
  useCarriedCoreBuild: () => CARRIED,
  readBundledCore: () => Promise.reject(new Error("no Core in this test")),
}));
// Where HQ stands, as its stream says it (`hqStandingAtom`): written here as the stream would.
vi.mock("~/state/zerops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/state/zerops")>();
  const { Atom } = await import("effect/reactivity");
  return { ...actual, hqStandingAtom: Atom.make<HqStanding>({ kind: "unknown" }) };
});
vi.mock("~/hooks/useSettings", () => ({
  useClientSettings: (select: (settings: { readonly timestampFormat: string }) => unknown) =>
    select({ timestampFormat: "24-hour" }),
}));

/**
 * HQ's services as the organization's services listing holds them, shaped as the live listing is
 * (client-runtime `__fixtures__/z3-eval.service-stack.json`): the project's system `core` among
 * them, an active version embedded without its name (KRLS, 2026-10-04), a managed service with none.
 */
const SERVICES: ReadonlyArray<ZeropsService> = [
  {
    id: "s-hq",
    name: "hq",
    status: "ACTIVE",
    isSystem: false,
    serviceStackTypeInfo: {
      serviceStackTypeName: "Node.js",
      serviceStackTypeCategory: "USER",
      serviceStackTypeVersionName: "ubuntu/nodejs@24",
    },
    activeAppVersion: { id: "av-runs", status: "ACTIVE", source: "CLI" },
  },
  {
    id: "s-db",
    name: "db",
    status: "ACTIVE",
    isSystem: false,
    serviceStackTypeInfo: {
      serviceStackTypeName: "PostgreSQL",
      serviceStackTypeCategory: "STANDARD",
      serviceStackTypeVersionName: "postgresql:single@18",
    },
    activeAppVersion: null,
  },
  {
    id: "s-core",
    name: "core",
    status: "ACTIVE",
    isSystem: true,
    serviceStackTypeInfo: {
      serviceStackTypeName: "Core",
      serviceStackTypeCategory: "CORE",
      serviceStackTypeVersionName: "core:single@2",
    },
    activeAppVersion: null,
  },
];

/** A build of HQ's Core under way, as Zerops lists it. */
const BUILDING: ActivityProcess = {
  id: "p1",
  projectId: "hq1",
  serviceStackIds: ["s-hq"],
  status: "RUNNING",
  actionName: "stack.build",
  created: "2026-10-04T10:00:00Z",
  appVersion: { name: `hq-core.${CARRIED}` },
};

const mounted: ReactTestRenderer[] = [];
afterEach(() => {
  for (const tree of mounted.splice(0)) act(() => tree.unmount());
  health.build = RUNS;
});

let registry = AtomRegistry.make();
let store: AccountStore;
/** The details the card holds now, by scope owner. */
let held: string[] = [];

/** The account's store: HQ's project and its services listed, its history held by demand. */
function account(services: ReadonlyArray<ZeropsService> = SERVICES) {
  registry = AtomRegistry.make();
  held = [];
  store = mountRoster(registry, "org1", [{ id: "hq1", name: "hq", status: "ACTIVE" }], {
    services: services.map((service) => ({ ...service, projectId: "hq1" })),
  });
  registry.set(accountReadsAtom, {
    data: store.data,
    orgId: "org1",
    demandDetail: ({ ownerId }) => {
      held.push(ownerId);
      return () => void held.splice(held.indexOf(ownerId), 1);
    },
    renewHeld: () => {},
  });
}

/** HQ's project's newest processes, read for the held history. */
const historyRead = (processes: ReadonlyArray<ActivityProcess>) => {
  const scope = historyScope("org1", "hq1");
  for (const event of [
    { kind: "demand", demanded: true },
    { kind: "attempt" },
    { kind: "handshake" },
  ] as const)
    store.dispatch({ kind: "stream", key: scope, now: 0, event });
  store.dispatch({ kind: "baseline-begin", scope, generation: 1 });
  store.dispatch({
    kind: "baseline-commit",
    scope,
    generation: 1,
    via: "zerops-read",
    members: processes.map(({ id }) => id),
    rows: processes.map((process) => ({
      family: "process",
      id: process.id,
      value: process,
      revision: { kind: "zerops", version: 1 },
    })),
  });
  store.dispatch({ kind: "stream", key: scope, now: 0, event: { kind: "baseline-committed" } });
};
/** HQ's stream saying HQ serves on the Core `build`, its parts quiet. */
const serving = (build: string) =>
  registry.set(hqStandingAtom as unknown as Atom.Writable<HqStanding>, {
    kind: "healthy",
    build,
    parts: { quarantined: [] },
  });

async function mount(): Promise<ReactTestRenderer> {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  serving(health.build);
  let tree: ReactTestRenderer | undefined;
  await act(async () => {
    tree = create(
      <RegistryContext.Provider value={registry}>
        <ZeropsHqCard />
      </RegistryContext.Provider>,
    );
  });
  mounted.push(tree!);
  return tree!;
}

const text = (tree: ReactTestRenderer) =>
  tree.root
    .findAll((node) => typeof node.type === "string")
    .flatMap((node) => node.children.filter((child) => typeof child === "string"))
    .join(" ");

const press = async (tree: ReactTestRenderer) => {
  const toggle = tree.root.find(
    (node) => node.type === "button" && node.props["aria-expanded"] !== undefined,
  );
  await act(async () => {
    toggle.props.onClick();
  });
};

describe("ZeropsHqCard — HQ's project in Zerops", () => {
  it("holds HQ's builds only while an admin has the card open", async () => {
    account();
    const tree = await mount();
    expect(held).toEqual([]);
    expect(text(tree)).toContain("Healthy");

    await press(tree);
    expect(held).toEqual(["hq1"]);
    await act(async () => historyRead([BUILDING]));
    expect(text(tree)).toContain("hq · Active");
    expect(text(tree)).toContain("db · Active");
    expect(text(tree)).not.toContain("core · Active");
    expect(text(tree)).toContain("Healthy");
    expect(text(tree)).toContain(
      "HQ is being updated to Core 2026-10-04 10:00 UTC · 0123456789ab.",
    );

    await press(tree);
    expect(held).toEqual([]);
  });

  it("is weighed anew, reading nothing again, once HQ answers with the Core being deployed", async () => {
    account();
    const tree = await mount();
    await press(tree);
    await act(async () => historyRead([BUILDING]));
    expect(text(tree)).toContain("Healthy");

    await act(async () => {
      serving(CARRIED);
    });
    expect(text(tree)).toContain("Healthy");
    expect(text(tree)).not.toContain("Updating");
    expect(held).toEqual(["hq1"]);
  });

  it("opening history cannot change the headline of a serving HQ during a service transition", async () => {
    account(
      SERVICES.map((service) =>
        service.name === "hq" ? { ...service, status: "UPGRADING" } : service,
      ),
    );
    const tree = await mount();
    const headline = () =>
      tree.root.findByProps({ "data-zerops-surface": "hq-card" }).props["data-hq-state"];
    expect(headline()).toBe("transitioning");
    expect(text(tree)).not.toContain("Needs attention");
    await press(tree);
    await act(async () => historyRead([BUILDING]));
    expect(headline()).toBe("transitioning");
    expect(text(tree)).toContain("hq · Upgrading");
    await press(tree);
    expect(headline()).toBe("transitioning");
    expect(held).toEqual([]);
  });

  it("a services listing Zerops refused says so", async () => {
    account();
    store.dispatch({
      kind: "stream",
      key: servicesScope("org1"),
      now: 0,
      event: {
        kind: "fault",
        fault: { outcome: "authoritative-denial", message: "HTTP 403" },
        jitter: 0,
      },
    });
    const tree = await mount();
    await press(tree);
    expect(text(tree)).toContain("Couldn't read HQ from Zerops: Zerops refused this read.");
  });
});
