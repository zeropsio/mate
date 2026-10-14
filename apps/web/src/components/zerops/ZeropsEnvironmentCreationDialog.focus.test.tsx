// @vitest-environment happy-dom
import { act, createElement as h, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { Dialog } from "../ui/dialog";
import {
  ZeropsEnvironmentCreationDialog,
  ZeropsEnvironmentCreationForm,
} from "./ZeropsEnvironmentCreationDialog";

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
        defaultName: "Acme Docs - stage",
        defaultShapeFor: () => "seal" as const,
        defaultTintFor: () => "violet" as const,
        defaultWithAgent: true,
        groupName: "Acme Docs",
        onCancel: () => undefined,
        onCreate: () => undefined,
        role: "stage",
        takenBotNames: { names: [], complete: true },
        tier: undefined,
        recipe: "absent",
        tierServices: [],
      }),
    );
  });
  const destination = tree!.root.findByProps({
    "data-zerops-surface": "environment-destination-form",
  });
  act(() => destination.props.onSubmit({ preventDefault: () => undefined }));
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

it("A chosen Git target survives the recipe arriving after first paint", () => {
  const props = {
    defaultName: "Shop - production",
    defaultTintFor: () => "violet" as const,
    defaultWithAgent: false,
    groupName: "Shop",
    onCancel: () => {},
    onCreate: vi.fn(),
    role: "prod" as const,
    takenBotNames: { names: [], complete: true },
    tier: undefined,
    recipe: "reading" as const,
    tierServices: [],
    git: {
      takenNames: [],
      repos: undefined,
      offered: { add: true, connect: true, replace: true },
      setup: { connect: vi.fn(), preview: vi.fn(), add: vi.fn() },
      onAdded: vi.fn(),
    },
  };
  const draw = (next: Parameters<typeof ZeropsEnvironmentCreationForm>[0]) =>
    h(Dialog, {}, h(ZeropsEnvironmentCreationForm, next));
  act(() => {
    tree = create(draw(props));
  });
  const choose = tree!.root.find(
    (node) =>
      node.props["aria-label"] === "Where does it go?" &&
      typeof node.props.onValueChange === "function",
  );
  act(() => choose.props.onValueChange("git"));
  const chooser = tree!.root.findByProps({ "data-zerops-surface": "environment-destination-form" });
  act(() => chooser.props.onSubmit({ preventDefault: () => undefined }));
  expect(tree!.root.findByProps({ "data-zerops-surface": "git-environment-form" })).toBeDefined();
  act(() =>
    tree!.update(
      draw({
        ...props,
        recipe: "present",
        tier: { kind: "tier", tier: "production", yaml: "services: []" },
      }),
    ),
  );
  expect(tree!.root.findByProps({ "data-zerops-surface": "git-environment-form" })).toBeDefined();
  expect(props.onCreate).not.toHaveBeenCalled();
});
