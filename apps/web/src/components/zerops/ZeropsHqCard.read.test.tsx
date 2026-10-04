/**
 * HQ's card reads HQ's project from Zerops — its services and its builds — once each time an admin
 * opens it, never while it is closed and never again on its own: not when HQ answers with another
 * Core, which it weighs its read against anew. A read that failed says so. The projects page holds
 * no read of HQ's project (it draws none of its stops), so nothing comes from the inventory.
 */
import type { ZeropsService } from "@t3tools/client-runtime/zerops";
import type { ActivityProcess } from "@t3tools/client-runtime/zerops/activity/dto";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { ZeropsHqCard } from "./ZeropsHqCard";

const RUNS = "20261003T080500Z.ba9876543210";
const CARRIED = "20261004T100000Z.0123456789ab";

const zerops = vi.hoisted(() => ({
  listProjectServices: vi.fn<(projectId: string) => Promise<ReadonlyArray<unknown>>>(),
  listProjectProcesses: vi.fn<(projectId: string) => Promise<ReadonlyArray<unknown>>>(),
}));
/** The Core HQ's health answers with. */
const health = vi.hoisted(() => ({ build: "20261003T080500Z.ba9876543210" }));

vi.mock("~/zerops/ZeropsSessionProvider", () => ({
  useZeropsSession: () => ({
    activeOrganization: { id: "org1", membershipId: "m1", roleCode: "OWNER" },
    client: zerops,
    user: { id: "u1" },
  }),
}));
vi.mock("~/zerops/accountHq", () => ({
  useAccountHq: () => ({
    hq: { kind: "official", projectId: "hq1", address: "https://hq.example.test" },
  }),
  useHqStanding: () => ({ kind: "healthy", build: health.build, parts: { quarantined: [] } }),
  useCarriedCoreBuild: () => CARRIED,
  readBundledCore: () => Promise.reject(new Error("no Core in this test")),
}));
vi.mock("~/hooks/useSettings", () => ({
  useClientSettings: (select: (settings: { readonly timestampFormat: string }) => unknown) =>
    select({ timestampFormat: "24-hour" }),
}));

/**
 * HQ's services as `GET /project/{id}/service-stack` lists them, shaped as the live listing is
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
  zerops.listProjectServices.mockReset();
  zerops.listProjectProcesses.mockReset();
  health.build = RUNS;
});

async function mount(): Promise<ReactTestRenderer> {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let tree: ReactTestRenderer | undefined;
  await act(async () => {
    tree = create(<ZeropsHqCard />);
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

/** Zerops answering with HQ's services and `processes`. */
const answering = (processes: ReadonlyArray<ActivityProcess>) => {
  zerops.listProjectServices.mockResolvedValue(SERVICES);
  zerops.listProjectProcesses.mockResolvedValue(processes);
};

describe("ZeropsHqCard — HQ's project in Zerops", () => {
  it("is read once each time an admin opens the card, and never while it is closed", async () => {
    answering([BUILDING]);
    const tree = await mount();
    expect(zerops.listProjectServices).not.toHaveBeenCalled();
    expect(zerops.listProjectProcesses).not.toHaveBeenCalled();
    expect(text(tree)).toContain("Healthy");

    await press(tree);
    expect(zerops.listProjectServices.mock.calls).toEqual([["hq1"]]);
    expect(zerops.listProjectProcesses.mock.calls).toEqual([["hq1"]]);
    expect(text(tree)).toContain("hq · Active");
    expect(text(tree)).toContain("db · Active");
    expect(text(tree)).not.toContain("core · Active");
    expect(text(tree)).toContain("Updating");
    expect(text(tree)).toContain(
      "HQ is being updated to Core 2026-10-04 10:00 UTC · 0123456789ab.",
    );

    await press(tree);
    expect(zerops.listProjectServices).toHaveBeenCalledTimes(1);
    await press(tree);
    expect(zerops.listProjectServices).toHaveBeenCalledTimes(2);
    expect(zerops.listProjectProcesses).toHaveBeenCalledTimes(2);
  });

  it("is weighed anew, not read again, once HQ answers with the Core being deployed", async () => {
    answering([BUILDING]);
    const tree = await mount();
    await press(tree);
    expect(text(tree)).toContain("Updating");

    health.build = CARRIED;
    await act(async () => {
      tree.update(<ZeropsHqCard />);
    });
    expect(text(tree)).toContain("Healthy");
    expect(text(tree)).not.toContain("Updating");
    expect(zerops.listProjectServices).toHaveBeenCalledTimes(1);
    expect(zerops.listProjectProcesses).toHaveBeenCalledTimes(1);
  });

  it("that could not be read says so, and is not read again", async () => {
    zerops.listProjectServices.mockRejectedValue(new Error("Zerops refused."));
    zerops.listProjectProcesses.mockResolvedValue([]);
    const tree = await mount();
    await press(tree);
    expect(text(tree)).toContain("Couldn't read HQ from Zerops: Zerops refused.");
    expect(zerops.listProjectServices).toHaveBeenCalledTimes(1);
  });
});
