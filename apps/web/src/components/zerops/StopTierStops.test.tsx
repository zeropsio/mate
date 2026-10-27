// @vitest-environment happy-dom
import type { StopTierStop } from "@t3tools/client-runtime/zerops/flow";
import type { ReactNode } from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { StopTierStops } from "./StopTierStops";

const deleted = vi.fn(async (_projectId: string, _serviceId: string) => {});
vi.mock("../../zerops/deleteService", () => ({ useDeleteService: () => deleted }));

// The dialog drawn in place while open, so its words and buttons are the tree's.
vi.mock("../ui/alert-dialog", () => {
  const children = ({ children }: { readonly children?: ReactNode }) => <>{children}</>;
  return {
    AlertDialog: ({ open, children }: { readonly open: boolean; readonly children?: ReactNode }) =>
      open ? <div data-dialog="">{children}</div> : null,
    AlertDialogClose: () => <button type="button">Cancel</button>,
    AlertDialogDescription: ({ children }: { readonly children?: ReactNode }) => <p>{children}</p>,
    AlertDialogFooter: children,
    AlertDialogHeader: children,
    AlertDialogPopup: children,
    AlertDialogTitle: ({ children }: { readonly children?: ReactNode }) => <h2>{children}</h2>,
  };
});

const mounted: ReactTestRenderer[] = [];
afterEach(() => {
  for (const tree of mounted.splice(0)) act(() => tree.unmount());
  deleted.mockClear();
});

const ROWS: ReadonlyArray<StopTierStop> = [
  { hostname: "cron", line: "stopped by rollback to v0.1.0", deletable: undefined },
  {
    hostname: "worker",
    line: "its tier no longer declares it",
    deletable: { serviceId: "S-worker" },
  },
];

const mount = (rows: ReadonlyArray<StopTierStop>) => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<StopTierStops projectId="P_STAGE" rowClassName="" rows={rows} />);
  });
  mounted.push(tree);
  return tree;
};
const text = (node: { readonly children: ReadonlyArray<unknown> }): string =>
  node.children.map((child) => (typeof child === "string" ? child : text(child as never))).join("");
const button = (tree: ReactTestRenderer, label: string) =>
  tree.root.findAll((node) => node.type === "button" && text(node) === label)[0];

describe("a stop's services the tier no longer declares", () => {
  it("offers Delete on a service the tier dropped, asks first, and deletes only on the person's confirm", async () => {
    const tree = mount(ROWS);
    const rows = tree.root.findAll((node) => node.props["data-zerops-tier-stop"] !== undefined);
    expect(rows.map((row) => text(row))).toEqual([
      "cron · stopped by rollback to v0.1.0",
      "worker · its tier no longer declares itDelete",
    ]);
    expect(tree.root.findAll((node) => node.props["data-dialog"] !== undefined)).toEqual([]);

    act(() => button(tree, "Delete")?.props.onClick());
    const dialog = tree.root.find((node) => node.props["data-dialog"] !== undefined);
    expect(text(dialog)).toContain("Delete worker?");
    expect(text(dialog)).toContain("You can’t undo this.");
    expect(deleted).not.toHaveBeenCalled();

    await act(async () => button(tree, "Delete worker")?.props.onClick());
    expect(deleted.mock.calls).toEqual([["P_STAGE", "S-worker"]]);
  });

  it("draws nothing for a one-part app, whose tier stops nothing", () => {
    expect(mount([]).toJSON()).toBeNull();
  });
});
