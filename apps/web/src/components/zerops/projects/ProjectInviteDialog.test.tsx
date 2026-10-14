/**
 * Inviting someone from a project's People: the address checked with Zerops, a name asked only
 * where the address has no Zerops account, then how much they may do — each answer awaited in the
 * dialog, a refusal said there.
 */
import type { ReactNode } from "react";
import { act } from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { ProjectInviteForm, type ProjectInviteActions } from "./ProjectInviteDialog";

vi.mock("../../ui/dialog", () => {
  const passThrough = ({ children }: { readonly children?: ReactNode }) => <div>{children}</div>;
  return {
    DialogHeader: passThrough,
    DialogTitle: passThrough,
    DialogDescription: passThrough,
    DialogPanel: passThrough,
    DialogFooter: passThrough,
  };
});

vi.mock("../../ui/input", () => ({
  Input: (props: Record<string, unknown>) => <input {...props} />,
}));

vi.mock("../../ui/radio-group", () => ({
  RadioGroup: (props: { readonly children?: ReactNode }) => <div>{props.children}</div>,
  Radio: () => <span />,
}));

const mounted: ReactTestRenderer[] = [];

afterEach(() => {
  for (const tree of mounted.splice(0)) act(() => tree.unmount());
});

function mount(actions: Partial<ProjectInviteActions> = {}) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const check = vi.fn(actions.check ?? (async () => ({ kind: "new" as const })));
  const send = vi.fn(actions.send ?? (async () => {}));
  const onDone = vi.fn();
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <ProjectInviteForm
        actions={{ check, send }}
        onCancel={() => {}}
        onDone={onDone}
        projectName="Shop"
      />,
    );
  });
  mounted.push(tree);
  const root = tree.root;
  const text = (node: ReactTestInstance): string =>
    node.children.map((child) => (typeof child === "string" ? child : text(child))).join("");
  const field = (id: string) =>
    root.find((node) => node.type === "input" && String(node.props.id).endsWith(id));
  return {
    check,
    send,
    onDone,
    type: (id: string, value: string) => act(() => field(id).props.onChange({ target: { value } })),
    submit: () =>
      act(async () => {
        root.findByType("form").props.onSubmit({ preventDefault: () => {} });
      }),
    pressLabel: () => text(root.findAllByType("button").at(-1)!),
    alerts: () =>
      root
        .findAll((node) => node.type === "p" && node.props.role === "alert")
        .map(text)
        .filter((line) => line !== ""),
  };
}

describe("inviting someone to a project", () => {
  it("A new address is asked for a name, then how much they may do, then sent", async () => {
    const form = mount();
    form.type("-email", " eva@example.com ");
    await form.submit();
    expect(form.check).toHaveBeenCalledWith("eva@example.com");
    form.type("-first", "Eva");
    form.type("-last", "Dvořáková");
    await form.submit();
    expect(form.pressLabel()).toBe("Send invite");
    await form.submit();
    expect(form.send).toHaveBeenCalledWith(
      "eva@example.com",
      { kind: "new", firstName: "Eva", lastName: "Dvořáková" },
      "work",
    );
    expect(form.onDone).toHaveBeenCalledOnce();
  });

  it("An address with a Zerops account goes straight to how much they may do", async () => {
    const form = mount({ check: async () => ({ kind: "existing", userId: "u-eva" }) });
    form.type("-email", "eva@example.com");
    await form.submit();
    expect(form.pressLabel()).toBe("Send invite");
  });

  it("An address that isn't one is said before Zerops is asked", async () => {
    const form = mount();
    form.type("-email", "eva");
    await form.submit();
    expect(form.check).not.toHaveBeenCalled();
    expect(form.alerts()).toEqual(["That isn't an e-mail address."]);
  });

  it("Zerops's refusal is said in the dialog, which stays open", async () => {
    const form = mount({
      check: async () => {
        throw new Error("Already in this organization — change their access in the list.");
      },
    });
    form.type("-email", "eva@example.com");
    await form.submit();
    expect(form.alerts()).toEqual([
      "Already in this organization — change their access in the list.",
    ]);
    expect(form.onDone).not.toHaveBeenCalled();
  });
});
