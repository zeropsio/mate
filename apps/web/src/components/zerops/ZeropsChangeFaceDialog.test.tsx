/**
 * Changing a Mate's face: the dialog opens on the face the Mate wears, draws every pick as it is
 * made, saves the face picked — nothing when it is the one worn — and keeps itself open with the
 * platform's reason when the write is refused.
 */
import { MATE_SHAPE_IDS, MATE_TINT_IDS } from "@t3tools/shared/brand";
import { act, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { Dialog } from "../ui/dialog";
import { ZeropsChangeFaceDialog, ZeropsChangeFaceForm } from "./ZeropsChangeFaceDialog";

type FormProps = Parameters<typeof ZeropsChangeFaceForm>[0];

const WORN = { tint: "olive", shape: "clover" } as const;

function form(props: Partial<FormProps> = {}): ReactElement {
  // The title and the description are Base UI's, and both need the dialog's context.
  return (
    <Dialog open onOpenChange={() => {}}>
      <ZeropsChangeFaceForm
        error={null}
        face={WORN}
        name="Fen"
        onCancel={() => {}}
        onSave={() => {}}
        pending={false}
        {...props}
      />
    </Dialog>
  );
}

const mounted: ReactTestRenderer[] = [];
afterEach(() => {
  for (const tree of mounted.splice(0)) {
    act(() => {
      tree.unmount();
    });
  }
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

const host = (tree: ReactTestRenderer, match: (node: ReactTestInstance) => boolean) =>
  tree.root.find((node) => typeof node.type === "string" && match(node));

/** Save, or Cancel: the form's buttons, not the pickers' radios. */
const button = (tree: ReactTestRenderer, type: "submit" | "button") =>
  host(
    tree,
    (node) => node.type === "button" && node.props.type === type && node.props.role !== "radio",
  );

const option = (tree: ReactTestRenderer, label: string) =>
  host(tree, (node) => node.props.role === "radio" && node.props["aria-label"] === label);

function pick(tree: ReactTestRenderer, label: string) {
  act(() => {
    option(tree, label).props.onClick();
  });
}

function save(tree: ReactTestRenderer) {
  act(() => {
    host(tree, (node) => node.type === "form").props.onSubmit({ preventDefault: () => {} });
  });
}

/** The face the preview draws now, not the one fading out. */
function face(tree: ReactTestRenderer) {
  const svg = host(
    tree,
    (node) =>
      node.props["data-zerops-primitive"] === "mate-face" &&
      node.props["data-mate-face-preview"] !== "out",
  );
  return { tint: svg.props["data-mate-face-tint"], shape: svg.props["data-mate-face-shape"] };
}

const checked = (tree: ReactTestRenderer) =>
  tree.root
    .findAll((node) => node.props.role === "radio" && node.props["aria-checked"] === true)
    .map((node) => node.props["aria-label"] as string);

describe("ZeropsChangeFaceForm", () => {
  it("asks about the Mate by name, says the face is everyone's, and offers Save and Cancel", () => {
    const html = renderToStaticMarkup(form());
    expect(html).toContain(">Change Fen&#x27;s face<");
    expect(html).toContain(">Everyone sees Fen with this face.<");
    expect(html).toContain(">Cancel<");
    expect(html).toContain(">Save<");
    expect(html).toContain('data-zerops-surface="change-face-form"');
  });

  it("is the same picker New Mate uses: every colour and shape a radio, the face beside them", () => {
    const html = renderToStaticMarkup(form());
    expect(html.match(/role="radiogroup"/gu)).toHaveLength(2);
    expect(html.match(/role="radio"/gu)).toHaveLength(MATE_TINT_IDS.length + MATE_SHAPE_IDS.length);
    expect(html).toContain('data-zerops-surface="mate-face-preview"');
    expect(html).not.toContain("<input");
  });

  it("opens on the face the Mate wears, picked in both rows", () => {
    const tree = mount(form());
    expect(face(tree)).toEqual(WORN);
    expect(checked(tree)).toEqual(["Olive", "Clover"]);
  });

  it("draws each pick at once, a colour and a shape apart", () => {
    const tree = mount(form());
    pick(tree, "Rose");
    expect(face(tree)).toEqual({ tint: "rose", shape: "clover" });
    pick(tree, "Seal");
    expect(face(tree)).toEqual({ tint: "rose", shape: "seal" });
    expect(checked(tree)).toEqual(["Rose", "Seal"]);
  });

  it("saves the face picked", () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    const tree = mount(form({ onSave, onCancel }));
    pick(tree, "Sky");
    pick(tree, "Gem");
    save(tree);
    expect(onSave).toHaveBeenCalledWith({ tint: "sky", shape: "gem" });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("writes nothing when the face is the one the Mate wears: Save just closes", () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    const tree = mount(form({ onSave, onCancel }));
    pick(tree, "Rose");
    pick(tree, "Olive");
    save(tree);
    expect(onSave).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("says Saving… in the button's own room and takes no press while the platform answers", () => {
    const onSave = vi.fn();
    const tree = mount(form({ onSave, pending: true }));
    expect(button(tree, "submit").props.disabled).toBe(true);
    expect(button(tree, "submit").props["aria-busy"]).toBe(true);
    expect(button(tree, "button").props.disabled).not.toBe(true);
    pick(tree, "Rose");
    expect(face(tree)).toEqual(WORN);
    save(tree);
    expect(onSave).not.toHaveBeenCalled();
    const html = renderToStaticMarkup(form({ pending: true }));
    expect(html).toContain("Saving…");
    expect(html).toContain(">Save<");
  });

  it("says the platform's reason beside the buttons, on a line that is always there", () => {
    const idle = renderToStaticMarkup(form());
    expect(idle).toMatch(/<p[^>]*role="alert"[^>]*><\/p>/u);
    const refused = mount(form({ error: "Zerops rejected the request (forbidden)." }));
    const line = host(refused, (node) => node.type === "p" && node.props.role === "alert");
    expect(line.children).toEqual(["Zerops rejected the request (forbidden)."]);
    expect(line.props.className).toContain("min-h-4");
    expect(button(refused, "submit").props.disabled).toBe(false);
  });
});

describe("ZeropsChangeFaceDialog", () => {
  it("tells its host when its closing has finished moving, so it goes only then", () => {
    const onOpenChangeComplete = vi.fn();
    const tree = mount(
      <ZeropsChangeFaceDialog
        error={null}
        face={WORN}
        name="Fen"
        onCancel={() => {}}
        onOpenChange={() => {}}
        onOpenChangeComplete={onOpenChangeComplete}
        onSave={() => {}}
        open={false}
        pending
      />,
    );
    act(() => {
      tree.root.findByType(Dialog).props.onOpenChangeComplete(false);
    });
    expect(onOpenChangeComplete).toHaveBeenCalledWith(false);
  });
});
