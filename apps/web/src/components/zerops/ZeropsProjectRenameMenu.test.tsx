import type { ZeropsGroup } from "@t3tools/client-runtime/zerops";
import type { HqOfferState } from "@t3tools/shared/hqOffers";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { ZeropsProjectRenameMenu } from "./ZeropsProjectRenameMenu";
import type { ZeropsMenuEntry } from "./ZeropsProjectMenu";

const ALLOWED: HqOfferState = { kind: "allowed" };

const mock = vi.hoisted(() => ({
  /** What HQ offers of renaming an application (`rename_app`). */
  rename: { kind: "allowed" } as HqOfferState,
  actions: [] as ReadonlyArray<ZeropsMenuEntry>,
}));

vi.mock("~/zerops/useHqOffers", () => ({
  useOrgOffers: () => (verb: string) =>
    verb === "rename_app" ? mock.rename : ({ kind: "unknown" } as const),
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
  mock.rename = ALLOWED;
});

function mount(group = GROUP, actions: ReadonlyArray<ZeropsMenuEntry> = []) {
  act(() => {
    tree = create(<ZeropsProjectRenameMenu group={group} actions={actions} />);
  });
}

describe("project rename in the row and detail menu, as HQ offers it", () => {
  it.each<HqOfferState>([{ kind: "refused", reason: "not_structure_writer" }])(
    "offers no rename form where HQ refuses it: %j",
    (offer) => {
      mock.rename = offer;
      for (const nameSource of ["hq", "unread"] as const) {
        mount({ ...GROUP, nameSource });
        expect(mock.actions).toEqual([]);
        expect(tree!.root.findAllByType("button")).toHaveLength(0);
        act(() => tree!.unmount());
      }
    },
  );

  it("offers rename where HQ does, opens and closes its form", () => {
    mount();
    const rename = mock.actions.find((action) => action.id === "rename-group");
    expect(rename).toMatchObject({ label: "Rename project", disabled: false });
    if (rename === undefined || "separator" in rename) throw new Error("No rename offered");
    act(() => rename.onSelect());
    expect(tree!.root.findAllByType("button")).toHaveLength(1);
    act(() => tree!.root.findByType("button").props.onClick());
    expect(tree!.root.findAllByType("button")).toHaveLength(0);
  });

  it.each<HqOfferState>([{ kind: "unavailable", since: 1 }, { kind: "unknown" }])(
    "draws it not pressable while HQ does not answer, or has not said: %j",
    (offer) => {
      mock.rename = offer;
      mount();
      expect(mock.actions).toMatchObject([{ id: "rename-group", disabled: true }]);
    },
  );

  it("offers a project whose name could not be read the same rename, never a naming", () => {
    mount({ ...GROUP, nameSource: "unread" });
    expect(mock.actions).toMatchObject([{ id: "rename-group", label: "Rename project" }]);
  });

  it("keeps the row's other permitted actions where HQ refuses renaming", () => {
    mock.rename = { kind: "refused", reason: "not_structure_writer" };
    const addMate = { id: "add-mate", label: "Add Mate", onSelect: vi.fn() };
    mount(GROUP, [addMate]);
    expect(mock.actions).toEqual([addMate]);
  });

  it("withdraws an open form once HQ no longer offers it", () => {
    mount();
    const rename = mock.actions[0]!;
    if ("separator" in rename) throw new Error("No rename offered");
    act(() => rename.onSelect());
    mock.rename = { kind: "refused", reason: "not_structure_writer" };
    act(() => tree!.update(<ZeropsProjectRenameMenu group={GROUP} />));
    expect(mock.actions).toEqual([]);
    expect(tree!.root.findAllByType("button")).toHaveLength(0);
  });
});
