/**
 * HQ's card reads Zerops once each time an admin opens it, never while it is closed and never
 * again on its own — not when HQ answers with another Core, which it weighs its read against
 * anew; a read that failed says so.
 */
import type { ActivityProcess } from "@t3tools/client-runtime/zerops/activity/dto";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { ZeropsHqCard } from "./ZeropsHqCard";

const RUNS = "20261003T080500Z.ba9876543210";
const CARRIED = "20261004T100000Z.0123456789ab";

const zerops = vi.hoisted(() => ({
  listProjectProcesses: vi.fn<(projectId: string) => Promise<ReadonlyArray<ActivityProcess>>>(),
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
vi.mock("~/zerops/inventoryContext", () => ({
  useZeropsInventory: () => ({
    services: new Map([
      [
        "hq1",
        {
          status: "resolved",
          services: [
            {
              id: "s-hq",
              name: "hq",
              status: "ACTIVE",
              // As Zerops' service list embeds it: no name (KRLS, 2026-10-04).
              activeAppVersion: { id: "av-runs" },
            },
          ],
        },
      ],
    ]),
  }),
}));
vi.mock("~/hooks/useSettings", () => ({
  useClientSettings: (select: (settings: { readonly timestampFormat: string }) => unknown) =>
    select({ timestampFormat: "24-hour" }),
}));

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

describe("ZeropsHqCard — HQ's builds", () => {
  it("are read once each time an admin opens the card, and never while it is closed", async () => {
    zerops.listProjectProcesses.mockResolvedValue([BUILDING]);
    const tree = await mount();
    expect(zerops.listProjectProcesses).not.toHaveBeenCalled();
    expect(text(tree)).toContain("Healthy");

    await press(tree);
    expect(zerops.listProjectProcesses).toHaveBeenCalledTimes(1);
    expect(zerops.listProjectProcesses).toHaveBeenCalledWith("hq1");
    expect(text(tree)).toContain("Updating");
    expect(text(tree)).toContain(
      "HQ is being updated to Core 2026-10-04 10:00 UTC · 0123456789ab.",
    );

    await press(tree);
    expect(zerops.listProjectProcesses).toHaveBeenCalledTimes(1);
    await press(tree);
    expect(zerops.listProjectProcesses).toHaveBeenCalledTimes(2);
  });

  it("are weighed anew, not read again, once HQ answers with the Core being deployed", async () => {
    zerops.listProjectProcesses.mockResolvedValue([BUILDING]);
    const tree = await mount();
    await press(tree);
    expect(text(tree)).toContain("Updating");

    health.build = CARRIED;
    await act(async () => {
      tree.update(<ZeropsHqCard />);
    });
    expect(text(tree)).toContain("Healthy");
    expect(text(tree)).not.toContain("Updating");
    expect(zerops.listProjectProcesses).toHaveBeenCalledTimes(1);
  });

  it("that could not be read say so, and are not read again", async () => {
    zerops.listProjectProcesses.mockRejectedValue(new Error("Zerops refused."));
    const tree = await mount();
    await press(tree);
    expect(text(tree)).toContain("Couldn't read HQ's builds from Zerops: Zerops refused.");
    expect(zerops.listProjectProcesses).toHaveBeenCalledTimes(1);
  });
});
