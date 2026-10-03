// @vitest-environment happy-dom
import { act, createElement as h, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { ZeropsEnvironmentCreationDialog } from "./ZeropsEnvironmentCreationDialog";

/** Where the dialog would hand the focus once it closes: its popup's `finalFocus`. */
const popup = vi.hoisted(() => ({ finalFocus: undefined as undefined | (() => boolean) }));
vi.mock("../ui/dialog", async (original) => ({
  ...(await original<typeof import("../ui/dialog")>()),
  DialogPopup: (props: { readonly finalFocus: () => boolean; readonly children: ReactNode }) => {
    popup.finalFocus = props.finalFocus;
    return props.children;
  },
}));

let tree: ReactTestRenderer | undefined;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  popup.finalFocus = undefined;
});
afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
  vi.unstubAllGlobals();
});

/** A stage with "Runs an agent" on, added: the dialog closes where it was opened. */
const addStage = (landsElsewhere: boolean | undefined) => {
  act(() => {
    tree = create(
      h(ZeropsEnvironmentCreationDialog, {
        open: true,
        onOpenChange: () => undefined,
        ...(landsElsewhere === undefined ? {} : { landsElsewhere }),
        defaultBotName: "Otto",
        defaultName: "Acme Docs - stage",
        defaultTintFor: () => "violet" as const,
        defaultWithAgent: true,
        groupName: "Acme Docs",
        onCancel: () => undefined,
        onCreate: () => undefined,
        proposeName: () => "Acme Docs - stage",
        role: "stage",
        takenBotNames: { names: [], complete: true },
        tier: undefined,
        tierLoading: false,
        tierServices: [],
      }),
    );
  });
  const form = tree!.root.find((node) => node.type === "form");
  act(() => form.props.onSubmit({ preventDefault: () => undefined }));
};

// Run 6's second review: the dialog dropped the focus whenever "Runs an agent" was on — a stage
// added stays on the projects page, its focus left on the body.
describe("where the focus goes once the dialog closes", () => {
  it("back to what opened it, where the person stays", () => {
    addStage(undefined);
    expect(popup.finalFocus?.()).toBe(true);
  });

  it("never back to what opened it, where Add lands on another page that takes it", () => {
    addStage(true);
    expect(popup.finalFocus?.()).toBe(false);
  });
});
