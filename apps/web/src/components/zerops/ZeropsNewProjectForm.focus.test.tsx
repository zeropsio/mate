// @vitest-environment happy-dom
import { act, createElement as h, type ReactNode, type RefObject } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { ZeropsNewProjectDialog } from "./ZeropsNewProjectForm";

/** Where the dialog puts the focus as it opens: its popup's `initialFocus`. */
const popup = vi.hoisted(() => ({
  initialFocus: undefined as undefined | RefObject<{ readonly id: string } | null>,
}));
vi.mock("../ui/dialog", async (original) => ({
  ...(await original<typeof import("../ui/dialog")>()),
  Dialog: (props: { readonly children: ReactNode }) => props.children,
  DialogPopup: (props: {
    readonly initialFocus: RefObject<{ readonly id: string } | null>;
    readonly children: ReactNode;
  }) => {
    popup.initialFocus = props.initialFocus;
    return props.children;
  },
  DialogHeader: (props: { readonly children: ReactNode }) => props.children,
  DialogTitle: (props: { readonly children: ReactNode }) => props.children,
  DialogDescription: (props: { readonly children: ReactNode }) => props.children,
  DialogPanel: (props: { readonly children: ReactNode }) => props.children,
  DialogFooter: (props: { readonly children: ReactNode }) => props.children,
}));

let tree: ReactTestRenderer | undefined;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  popup.initialFocus = undefined;
});
afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
  vi.unstubAllGlobals();
});

// Run 2 (2026-10-16): the dialog opened with nothing focused; the person clicked into the name
// before they could type it.
describe("where the focus is as New project opens", () => {
  it("on the project's name, ready to type", () => {
    act(() => {
      tree = create(
        h(ZeropsNewProjectDialog, {
          onOpenChange: () => undefined,
          creating: false,
          defaultBotName: "Ada",
          defaultTintFor: () => "sky" as const,
          locationError: null,
          locationId: null,
          loading: false,
          locations: [],
          onCancel: () => undefined,
          onCreate: () => undefined,
          onLocation: () => undefined,
          takenBotNames: { names: [], complete: true },
        }),
        {
          createNodeMock: (element) =>
            element.type === "input" ? { id: (element.props as { id: string }).id } : null,
        },
      );
    });
    expect(popup.initialFocus?.current?.id).toBe("zerops-new-project");
  });
});
