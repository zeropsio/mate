import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { Dialog } from "../ui/dialog";
import { RadioGroup } from "../ui/radio-group";
import { ZeropsMoveToGroupForm } from "./ZeropsMoveToGroupDialog";

const noop = () => {};
const mounted: ReactTestRenderer[] = [];
afterEach(() => {
  for (const tree of mounted.splice(0)) act(() => tree.unmount());
});
function mount(props: Partial<Parameters<typeof ZeropsMoveToGroupForm>[0]> = {}) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let tree!: ReactTestRenderer;
  const draw = (overrides = props) => (
    <Dialog open onOpenChange={noop}>
      <ZeropsMoveToGroupForm
        choices={{
          apps: [{ id: "acme", name: "Acme", roles: ["dev", "prod"] }],
          newApp: [],
          none: true,
        }}
        currentGroupId="acme"
        currentRole="dev"
        name="Fen"
        onCancel={noop}
        onSubmit={noop}
        {...overrides}
      />
    </Dialog>
  );
  act(() => {
    tree = create(draw());
  });
  mounted.push(tree);
  return { tree, update: (next: typeof props) => act(() => tree.update(draw(next))) };
}
const submit = (tree: ReactTestRenderer) =>
  act(() => {
    tree.root.findByType("form").props.onSubmit({ preventDefault: noop });
  });

/** The form as the dialog draws it, its first choice picked. */
const drawn = (target: { readonly groupId: string | undefined }) =>
  renderToStaticMarkup(
    <Dialog open onOpenChange={noop}>
      <ZeropsMoveToGroupForm
        choices={{
          apps: [{ id: "acme", name: "Acme Docs", roles: ["dev", "stage", "prod"] }],
          newApp: ["dev", "stage", "prod"],
          none: true,
        }}
        currentGroupId={target.groupId}
        currentRole={undefined}
        name="Fen"
        onCancel={noop}
        onSubmit={noop}
      />
    </Dialog>,
  );

// e2e-krls F29: the menu offers "Move to project…", and the dialog spoke of groups.
describe("ZeropsMoveToGroupForm — in the words of the menu that opens it", () => {
  it("calls an application a project, never a group", () => {
    // What it says, without its markup's own names (a radio group is one).
    const said = drawn({ groupId: "acme" })
      .replace(/<style[^]*?<\/style>/gu, " ")
      .replace(/<[^>]*>/gu, " ");

    expect(said).toContain("Move Fen");
    expect(said).toMatch(/\bProject\b/u);
    expect(said).toContain("New project");
    expect(said).toContain("No project");
    expect(said).not.toMatch(/group/iu);
  });
});

it("reviews a role change and requires acknowledgement before moving the named Mate", () => {
  const onSubmit = vi.fn();
  const { tree } = mount({ onSubmit });
  act(() => tree.root.findAllByType(RadioGroup)[1]!.props.onValueChange("prod"));
  const review = tree.root.findByProps({ "data-zerops-surface": "move-review" });
  const said = review
    .findAllByType("p")
    .map((p) => p.children.join(""))
    .join(" ");
  expect(said).toContain("Fen becomes Production in Acme");
  expect(said).toContain("conversations and change history stay with Fen");
  expect(said).toContain("Open changes stay with their repository");
  expect(said).toContain("revoked and re-issued");
  submit(tree);
  expect(onSubmit).not.toHaveBeenCalled();
  act(() =>
    tree.root.findByProps({ type: "checkbox" }).props.onChange({ target: { checked: true } }),
  );
  submit(tree);
  expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ kind: "group", appId: "acme", role: "prod" });
});

it("withholds a destination withdrawn after the form opened, including Enter", () => {
  const onSubmit = vi.fn();
  const { tree, update } = mount({ onSubmit });
  update({ onSubmit, choices: { apps: [], newApp: [], none: false } });
  submit(tree);
  expect(onSubmit).not.toHaveBeenCalled();
  expect(tree.root.findByProps({ type: "submit" }).props.disabled).toBe(true);
});

it("locks the picker, Cancel and Enter while Move is being answered", () => {
  const onSubmit = vi.fn();
  const { tree } = mount({ onSubmit, pending: true });
  submit(tree);
  expect(onSubmit).not.toHaveBeenCalled();
  expect(tree.root.findByProps({ type: "submit" }).props.disabled).toBe(true);
  expect(tree.root.findByProps({ type: "button" }).props.disabled).toBe(true);
  expect(tree.root.findAllByType(RadioGroup).every((group) => group.props.disabled)).toBe(true);
});

it("explains the supported Move boundary without offering migration", () => {
  expect(drawn({ groupId: "acme" })).toContain(
    "Moves across HQs, organizations or physical environments are not supported",
  );
});
