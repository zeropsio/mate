/**
 * The projects page deletes a project without a Mate the way the menu does: one holding code goes
 * through the dialog that lists what goes with it, and HQ deletes it with its code.
 */
import { act } from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { CanonicalGroup } from "@t3tools/client-runtime/zerops";

import { useDeleteApplicationDialog } from "~/zerops/deleteApplicationDialog";

import { ZeropsDeleteApplicationHost } from "../ZeropsDeleteApplicationDialog";
import type { ZeropsMenuAction } from "../ZeropsProjectMenu";
import { projectDeleteActions } from "./projectDelete";

const mock = vi.hoisted(() => ({
  writes: [] as Array<unknown>,
  stagesDeleted: [] as Array<string>,
}));

// The test renderer draws no portal: the popup is drawn in place.
vi.mock("~/components/ui/dialog", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  DialogPopup: ({ children }: { readonly children: React.ReactNode }) => children,
}));
vi.mock("~/zerops/useHqAppDetail", () => ({
  useHqAppDetail: () => ({
    repos: [{ name: "group" }, { name: "appdev" }],
    changes: [{ state: "open" }, { state: "merged" }],
  }),
}));
vi.mock("~/zerops/ZeropsSessionProvider", () => ({
  useZeropsSession: () => ({ activeOrganization: { id: "org-1" } }),
}));
vi.mock("~/zerops/accountOperations", () => ({ useAccountOperations: () => ({}) }));
vi.mock("~/zerops/deleteProject", () => ({
  useDeleteProject: () => async (projectId: string) => {
    mock.stagesDeleted.push(projectId);
  },
}));
vi.mock("~/zerops/hqAppWrite", () => ({
  submitHqAppWrite: async (_operations: unknown, write: unknown) => {
    mock.writes.push(write);
  },
}));

const GROUP = {
  groupId: "app-1",
  name: "mono-rig",
  environments: [] as unknown as CanonicalGroup["environments"],
  pending: [],
};

const mounted: ReactTestRenderer[] = [];
afterEach(() => {
  for (const tree of mounted.splice(0)) act(() => tree.unmount());
  useDeleteApplicationDialog.getState().close();
  mock.writes.length = 0;
  mock.stagesDeleted.length = 0;
});

const textOf = (node: ReactTestInstance | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join("");
const host = (tree: ReactTestRenderer, match: (node: ReactTestInstance) => boolean) =>
  tree.root.find((node) => typeof node.type === "string" && match(node));

function onlyAction(
  contents: { readonly empty: boolean; readonly deletingProjectIds: ReadonlyArray<string> },
  openEmpty: () => void = () => {},
  group: Parameters<typeof projectDeleteActions>[0]["group"] = GROUP,
): ZeropsMenuAction {
  const actions = projectDeleteActions({ group, offer: "allowed", contents, openEmpty });
  expect(actions).toHaveLength(1);
  return actions[0] as ZeropsMenuAction;
}

describe("Delete, on the projects page", () => {
  it("deletes a project without a Mate that holds code through the menu's dialog, with its code", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const openEmpty = vi.fn();
    const action = onlyAction({ empty: false, deletingProjectIds: [] }, openEmpty);
    expect(action).toMatchObject({ label: "Delete mono-rig…", variant: "destructive" });
    expect(action.disabled).toBe(false);

    let tree: ReactTestRenderer | undefined;
    act(() => {
      tree = create(<ZeropsDeleteApplicationHost />);
    });
    mounted.push(tree!);
    act(() => action.onSelect());
    expect(openEmpty).not.toHaveBeenCalled();

    const form = host(tree!, (node) => node.type === "form");
    expect(textOf(form)).toContain("Delete mono-rig?");
    expect(textOf(form)).toContain("Repository appdev, with its history");
    expect(textOf(form)).toContain("Its setup files");
    expect(textOf(form)).toContain("1 open change");
    expect(textOf(form)).toContain("Anything on GitHub");

    const input = host(tree!, (node) => node.type === "input");
    act(() =>
      input.props.onChange({ target: { value: "mono-rig" }, currentTarget: { value: "mono-rig" } }),
    );
    await act(async () => {
      host(tree!, (node) => node.type === "form").props.onSubmit({ preventDefault() {} });
    });

    expect(mock.stagesDeleted).toEqual([]);
    expect(mock.writes).toEqual([
      { kind: "delete-app", orgId: "org-1", appId: "app-1", withCode: true },
    ]);
    expect(useDeleteApplicationDialog.getState().request).toBeNull();
  });

  it("lists a project's real stage as going and its productions, a Git branch among them, as staying", () => {
    const group = {
      ...GROUP,
      environments: [
        { kind: "project", role: "stage", project: { id: "P_STAGE", name: "mono-stage" } },
        { kind: "project", role: "prod", project: { id: "P_PROD", name: "mono-prod" } },
        {
          kind: "managed",
          role: "prod",
          project: undefined,
          target: { kind: "git", branch: "release" },
        },
      ] as unknown as CanonicalGroup["environments"],
    };
    let tree: ReactTestRenderer | undefined;
    act(() => {
      tree = create(<ZeropsDeleteApplicationHost />);
    });
    mounted.push(tree!);
    act(() => onlyAction({ empty: false, deletingProjectIds: [] }, () => {}, group).onSelect());

    const form = textOf(host(tree!, (node) => node.type === "form"));
    expect(form).toContain("Stage mono-stage, with everything in it");
    expect(form).toContain("Production mono-prod.");
    expect(form).toContain("Production on Git branch release.");
  });

  it("keeps the plain Delete for a project HQ says holds nothing", () => {
    const openEmpty = vi.fn();
    onlyAction({ empty: true, deletingProjectIds: [] }, openEmpty).onSelect();
    expect(openEmpty).toHaveBeenCalledOnce();
    expect(useDeleteApplicationDialog.getState().request).toBeNull();
  });

  it.each([
    { name: "HQ has not answered", offer: "allowed", contents: undefined },
    {
      name: "a deletion is under way",
      offer: "allowed",
      contents: { empty: false, deletingProjectIds: ["p-1"] },
    },
    {
      name: "HQ refuses delete_app",
      offer: "refused",
      contents: { empty: false, deletingProjectIds: [] },
    },
  ] as const)("offers no Delete where $name", ({ offer, contents }) => {
    expect(projectDeleteActions({ group: GROUP, offer, contents, openEmpty: () => {} })).toEqual(
      [],
    );
  });
});
