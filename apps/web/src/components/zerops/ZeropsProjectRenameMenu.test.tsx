import type { ZeropsGroup } from "@t3tools/client-runtime/zerops";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { ZeropsProjectRenameMenu } from "./ZeropsProjectRenameMenu";
import type { ZeropsMenuEntry } from "./ZeropsProjectMenu";

const mock = vi.hoisted(() => ({
  user: { id: "person" } as { id: string } | null,
  organization: {
    membershipId: "member",
    roleCode: "OWNER",
    canCreateProjects: true,
  } as { membershipId: string; roleCode: string; canCreateProjects: boolean } | null,
  actions: [] as ReadonlyArray<ZeropsMenuEntry>,
}));

vi.mock("~/zerops/ZeropsSessionProvider", () => ({
  useZeropsSession: () => ({ user: mock.user, activeOrganization: mock.organization }),
}));
vi.mock("./ZeropsProjectMenu", () => ({
  ZeropsProjectMenu: ({ actions }: { actions: ReadonlyArray<ZeropsMenuEntry> }) => {
    mock.actions = actions;
    return (
      <span>{actions.map((action) => ("label" in action ? action.label : "")).join(",")}</span>
    );
  },
}));
vi.mock("./ZeropsRenameProjectDialog", () => ({
  ZeropsRenameProjectDialog: ({ onClose }: { onClose: () => void }) => (
    <button onClick={onClose}>Close rename</button>
  ),
}));

const GROUP = { groupId: "app-1", name: "Shop", nameSource: "hq" } as ZeropsGroup;
let tree: ReactTestRenderer | undefined;

afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
  mock.actions = [];
  mock.user = { id: "person" };
  mock.organization = { membershipId: "member", roleCode: "OWNER", canCreateProjects: true };
});

function mount(group = GROUP, actions: ReadonlyArray<ZeropsMenuEntry> = []) {
  act(() => {
    tree = create(<ZeropsProjectRenameMenu group={group} actions={actions} />);
  });
}

describe("project rename in the row and detail menu", () => {
  it.each(["NO_ACCESS", "READ_ONLY", "BASIC_USER", "unknown"])(
    "offers no rename form to %s, even with project creation rights",
    (roleCode) => {
      mock.organization!.roleCode = roleCode;
      for (const nameSource of ["hq", "unread"] as const) {
        mount({ ...GROUP, nameSource });
        expect(mock.actions).toEqual([]);
        expect(tree!.root.findAllByType("button")).toHaveLength(0);
        act(() => tree!.unmount());
      }
    },
  );

  it.each(["OWNER", "ADMIN"])("offers %s rename, opens and closes its form", (roleCode) => {
    mock.organization!.roleCode = roleCode;
    mock.organization!.canCreateProjects = false;
    mount();
    const rename = mock.actions.find((action) => action.id === "rename-group");
    expect(rename).toMatchObject({ label: "Rename project" });
    if (rename === undefined || "separator" in rename) throw new Error("No rename offered");
    act(() => rename.onSelect());
    expect(tree!.root.findAllByType("button")).toHaveLength(1);
    act(() => tree!.root.findByType("button").props.onClick());
    expect(tree!.root.findAllByType("button")).toHaveLength(0);
  });

  it("offers a project whose name could not be read the same rename, never a naming", () => {
    mount({ ...GROUP, nameSource: "unread" });
    expect(mock.actions).toMatchObject([{ id: "rename-group", label: "Rename project" }]);
  });

  it.each(["user", "organization"] as const)("offers nothing without its %s", (missing) => {
    mock[missing] = null;
    mount();
    expect(mock.actions).toEqual([]);
  });

  it("keeps the row's other permitted actions for a Developer", () => {
    mock.organization!.roleCode = "NO_ACCESS";
    const addMate = { id: "add-mate", label: "Add Mate", onSelect: vi.fn() };
    mount(GROUP, [addMate]);
    expect(mock.actions).toEqual([addMate]);
  });

  it("withdraws an open form when the viewer loses writer access", () => {
    mount();
    const rename = mock.actions[0]!;
    if ("separator" in rename) throw new Error("No rename offered");
    act(() => rename.onSelect());
    mock.organization!.roleCode = "NO_ACCESS";
    act(() => tree!.update(<ZeropsProjectRenameMenu group={GROUP} />));
    expect(mock.actions).toEqual([]);
    expect(tree!.root.findAllByType("button")).toHaveLength(0);
  });
});
