/**
 * Deleting a project with its code lists what goes and what stays, and asks for its name typed
 * once HQ said what it holds.
 */
import { act, type ReactElement } from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { Dialog } from "../ui/dialog";
import { ZeropsDeleteApplicationForm } from "./ZeropsDeleteApplicationDialog";
import { deleteApplicationWords } from "./ZeropsDeleteApplicationDialog.logic";

const TARGET = {
  appId: "app-1",
  name: "shop",
  stages: [{ projectId: "P_STAGE", name: "shop-stage" }],
  productions: [{ name: "shop-prod" }],
};

const mounted: ReactTestRenderer[] = [];
afterEach(() => {
  for (const tree of mounted.splice(0)) act(() => tree.unmount());
});

function mount(element: ReactElement): ReactTestRenderer {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let tree: ReactTestRenderer | undefined;
  act(() => {
    tree = create(element);
  });
  mounted.push(tree!);
  return tree!;
}

const textOf = (node: ReactTestInstance | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join("");
const host = (tree: ReactTestRenderer, match: (node: ReactTestInstance) => boolean) =>
  tree.root.find((node) => typeof node.type === "string" && match(node));
const submit = (tree: ReactTestRenderer) =>
  host(tree, (node) => node.type === "button" && node.props.type === "submit");
const type = (tree: ReactTestRenderer, value: string) => {
  const input = host(tree, (node) => node.type === "input");
  act(() => input.props.onChange({ target: { value }, currentTarget: { value } }));
};

function form(
  holdings: Parameters<typeof deleteApplicationWords>[1],
  onConfirm: () => void = () => {},
): ReactElement {
  return (
    <Dialog open onOpenChange={() => {}}>
      <ZeropsDeleteApplicationForm
        error={null}
        name="shop"
        onCancel={() => {}}
        onConfirm={onConfirm}
        pending={false}
        words={deleteApplicationWords(TARGET, holdings)}
      />
    </Dialog>
  );
}

describe("ZeropsDeleteApplicationForm", () => {
  it("lists exactly what goes and what stays, and deletes only once the name is typed", () => {
    const onConfirm = vi.fn();
    const tree = mount(form({ repos: ["appdev", "group"], openChanges: 3 }, onConfirm));
    const items = (surface: string) =>
      host(tree, (node) => node.props["data-zerops-surface"] === surface)
        .findAll((node) => node.type === "li")
        .map(textOf);
    expect(items("delete-application-goes")).toEqual([
      "Repository appdev, with its history",
      "Its setup files",
      "3 open changes",
      "Stage shop-stage, with everything in it",
    ]);
    expect(items("delete-application-stays")).toEqual([
      "Production shop-prod. Delete it in Zerops if you no longer need it.",
      "Anything on GitHub",
    ]);
    expect(submit(tree).props.disabled).toBe(true);
    type(tree, "shop");
    expect(submit(tree).props.disabled).toBe(false);
    act(() => host(tree, (node) => node.type === "form").props.onSubmit({ preventDefault() {} }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("stays shut, the name typed, until HQ said what the project holds", () => {
    const tree = mount(form(undefined));
    expect(
      textOf(
        host(tree, (node) => node.props["data-zerops-surface"] === "delete-application-lists"),
      ),
    ).toContain("Reading what HQ holds…");
    type(tree, "shop");
    expect(submit(tree).props.disabled).toBe(true);
  });
});
