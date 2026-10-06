/**
 * Renaming an application renames its projects in Zerops after HQ has the name: every member is
 * planned from the full held set — a project the grant withholds is a member still — before HQ's
 * write, and HQ's refusal leaves every project as it was.
 */
import type { ZeropsGroup, ZeropsProject } from "@t3tools/client-runtime/zerops";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { HeldInventoryContext } from "./inventoryContext";
import { useRenameGroup, type GroupRenaming } from "./useRenameGroup";

const mock = vi.hoisted(() => ({
  renameApp: vi.fn(),
  renameProjects: vi.fn(),
  shown: [] as ReadonlyArray<unknown>,
}));

vi.mock("./accountHq", () => ({
  officialHq: () => ({ kind: "official" }),
  useAccountHq: () => ({ status: "ready" }),
  accountHqApi: () => ({ renameApp: mock.renameApp }),
}));
vi.mock("./ZeropsSessionProvider", () => ({
  useZeropsSession: () => ({ activeOrganization: { id: "org-1" }, client: {} }),
}));
vi.mock("./ZeropsInventoryProvider", () => ({
  useZeropsInventory: () => ({ projects: mock.shown }),
}));
vi.mock("./useRenameProjects", () => ({ useRenameProjects: () => mock.renameProjects }));

const GROUP = { groupId: "app-1", name: "SPN", nameSource: "hq" } as unknown as ZeropsGroup;

const inApp = (id: string, name: string) =>
  ({
    id,
    name,
    status: "ACTIVE",
    hq: { appId: "app-1", appName: "SPN", kind: "mate", mate: { face: "" } },
  }) as unknown as ZeropsProject;

const mounted: ReactTestRenderer[] = [];
afterEach(() => {
  for (const tree of mounted.splice(0)) act(() => tree.unmount());
  mock.renameApp.mockReset();
  mock.renameProjects.mockReset();
});

function hook(held: ReadonlyArray<ZeropsProject>): () => GroupRenaming {
  let latest: GroupRenaming | undefined;
  function Probe() {
    latest = useRenameGroup();
    return null;
  }
  act(() => {
    mounted.push(
      create(
        createElement(HeldInventoryContext, { value: { projects: held } }, createElement(Probe)),
      ),
    );
  });
  return () => latest!;
}

describe("useRenameGroup", () => {
  it("plans every member from the held projects, one the grant withholds included, before HQ's write", async () => {
    mock.shown = [inApp("p1", "SPN - Rune")];
    mock.renameApp.mockResolvedValue(undefined);
    mock.renameProjects.mockResolvedValue([]);
    const renaming = hook([inApp("p1", "SPN - Rune"), inApp("p2", "SPN - Ada")]);

    await act(async () => {
      await renaming().rename(GROUP, "Shop");
    });

    expect(mock.renameProjects).toHaveBeenCalledWith([
      { projectId: "p1", from: "SPN - Rune", to: "Shop - Rune" },
      { projectId: "p2", from: "SPN - Ada", to: "Shop - Ada" },
    ]);
  });

  it("renames no project where HQ refuses the name", async () => {
    mock.shown = [];
    mock.renameApp.mockRejectedValue(new Error("HQ refused."));
    const renaming = hook([inApp("p1", "SPN - Rune")]);

    await act(async () => {
      await expect(renaming().rename(GROUP, "Shop")).rejects.toThrow("HQ refused.");
    });

    expect(mock.renameProjects).not.toHaveBeenCalled();
  });
});
