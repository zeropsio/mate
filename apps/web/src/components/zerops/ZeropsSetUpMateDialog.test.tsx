/**
 * Set up Mate on an existing project confirms first, in the page's own words (security review 1,
 * 5): what it adds, and that the project's services restart once while it is closed off.
 */
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { SET_UP_MATE_RESTART_LINE, ZeropsSetUpMateDialog } from "./ZeropsSetUpMateDialog";

vi.mock("../ui/dialog", () => {
  const pass = ({ children }: { readonly children?: React.ReactNode }) => children ?? null;
  return {
    Dialog: pass,
    DialogPopup: pass,
    DialogHeader: pass,
    DialogTitle: pass,
    DialogDescription: pass,
    DialogPanel: pass,
    DialogFooter: pass,
  };
});

const mounted: ReactTestRenderer[] = [];
afterEach(() => {
  for (const tree of mounted.splice(0)) act(() => tree.unmount());
});

function mount() {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<ZeropsSetUpMateDialog name="shop" onCancel={onCancel} onConfirm={onConfirm} />);
  });
  mounted.push(tree);
  const text = JSON.stringify(tree.toJSON());
  const button = (label: string) =>
    tree.root.findAll(
      (node) => node.type === "button" && JSON.stringify(node.props.children).includes(label),
    )[0]!;
  return { text, button, onConfirm, onCancel };
}

describe("ZeropsSetUpMateDialog", () => {
  it("says what it adds to the project, and that its services restart once", () => {
    const { text } = mount();
    expect(text).toContain("shop");
    expect(text).toContain("Mate container");
    expect(text).toContain(SET_UP_MATE_RESTART_LINE);
  });

  it("sets it up only on its confirm, and Cancel does nothing else", () => {
    const { button, onConfirm, onCancel } = mount();
    act(() => button("Cancel").props.onClick());
    expect([onCancel.mock.calls.length, onConfirm.mock.calls.length]).toEqual([1, 0]);
    act(() => button("Set up Mate").props.onClick());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
