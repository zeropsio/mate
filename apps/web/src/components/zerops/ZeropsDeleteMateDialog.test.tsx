/**
 * Deleting a Mate asks for its name, typed: the button stays shut until the name is there,
 * says so while the platform answers, and keeps the dialog open with the platform's reason when
 * it refuses.
 */
import { act, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { Dialog } from "../ui/dialog";
import { ZeropsDeleteMateForm } from "./ZeropsDeleteMateDialog";
import { deleteMateWords } from "./ZeropsDeleteMateDialog.logic";

type FormProps = Parameters<typeof ZeropsDeleteMateForm>[0];

const WORDS = deleteMateWords({
  name: "Quinn",
  environment: "Acme Docs - Quinn",
  services: 3,
  owner: undefined,
});

function form(props: Partial<FormProps> = {}): ReactElement {
  // The title and the description are Base UI's, and both need the dialog's context.
  return (
    <Dialog open onOpenChange={() => {}}>
      <ZeropsDeleteMateForm
        error={null}
        name="Quinn"
        onCancel={() => {}}
        onConfirm={() => {}}
        pending={false}
        words={WORDS}
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

const button = (tree: ReactTestRenderer, type: "submit" | "button") =>
  host(tree, (node) => node.type === "button" && node.props.type === type);

function type(tree: ReactTestRenderer, value: string) {
  const input = host(tree, (node) => node.type === "input");
  act(() => {
    input.props.onChange({ target: { value }, currentTarget: { value } });
  });
}

/** Enter in the field: the form's own submit. */
function enter(tree: ReactTestRenderer) {
  act(() => {
    host(tree, (node) => node.type === "form").props.onSubmit({ preventDefault: () => {} });
  });
}

describe("ZeropsDeleteMateForm", () => {
  it("asks about the Mate by name, says what goes, and asks for the name typed", () => {
    const html = renderToStaticMarkup(form());
    expect(html).toContain(">Delete Quinn?<");
    expect(html).toContain(
      "The environment Acme Docs - Quinn goes from Zerops with its 3 services and everything in them, and Quinn&#x27;s conversations go with it. Anything Quinn hasn&#x27;t pushed is lost. This can&#x27;t be undone.",
    );
    expect(html).toContain(">Type Quinn to confirm<");
    expect(html).toContain(">Cancel<");
    expect(html).toContain(">Delete Quinn<");
    expect(html).toContain('data-zerops-surface="delete-mate-form"');
  });

  it.each([
    { typed: "", enabled: false },
    { typed: "quinn", enabled: false },
    { typed: "Quin", enabled: false },
    { typed: "Quinn", enabled: true },
    { typed: " Quinn ", enabled: true },
  ])("opens its button only on the name: '$typed' → $enabled", ({ typed, enabled }) => {
    const tree = mount(form());
    type(tree, typed);
    expect(button(tree, "submit").props.disabled).toBe(!enabled);
    expect(button(tree, "button").props.disabled).not.toBe(true);
  });

  it("deletes on Enter only once the name is typed", () => {
    const onConfirm = vi.fn();
    const tree = mount(form({ onConfirm }));
    type(tree, "Quin");
    enter(tree);
    expect(onConfirm).not.toHaveBeenCalled();
    type(tree, "Quinn");
    enter(tree);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("says Deleting… and allows dismissal but prevents another delete while the platform answers", () => {
    const onConfirm = vi.fn();
    const tree = mount(form({ onConfirm, pending: true }));
    type(tree, "Quinn");
    const submit = button(tree, "submit");
    expect(submit.props.disabled).toBe(true);
    expect(submit.props["aria-busy"]).toBe(true);
    expect(button(tree, "button").props.disabled).not.toBe(true);
    expect(submit.props["aria-label"]).toBe("Deleting…");
    const shown = submit.findAll(
      (node) =>
        typeof node.type === "string" &&
        node.type === "span" &&
        node.children.length === 1 &&
        typeof node.children[0] === "string" &&
        node.props["aria-hidden"] === false,
    );
    expect(shown.map((node) => node.children[0])).toEqual(["Deleting…"]);
    enter(tree);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("says the platform's reason under the field, and lets the name be pressed again", () => {
    const onConfirm = vi.fn();
    const tree = mount(
      form({ onConfirm, error: "You don't have the permission to delete this project." }),
    );
    const alert = host(tree, (node) => node.props.role === "alert");
    expect(alert.children.join("")).toBe("You don't have the permission to delete this project.");
    type(tree, "Quinn");
    expect(button(tree, "submit").props.disabled).toBe(false);
    enter(tree);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

it("a deleted Mate offers manual key retirement without asking to delete it again", () => {
  const onConfirm = vi.fn();
  const tree = mount(form({ cleanup: true, onConfirm, error: "Key retirement refused" }));
  expect(tree.root.findAll((node) => node.type === "input")).toHaveLength(0);
  expect(button(tree, "submit").props.disabled).toBe(false);
  expect(renderToStaticMarkup(form({ cleanup: true }))).toContain("Try again");
  expect(renderToStaticMarkup(form({ cleanup: true }))).toContain("Quinn was deleted");
  enter(tree);
  expect(onConfirm).toHaveBeenCalledTimes(1);
});

it("explains an unfinished HQ completion beside its refusal and Again", () => {
  const html = renderToStaticMarkup(
    form({ cleanup: true, error: "HQ refused: project still exists" }),
  );
  expect(html).toContain("HQ records");
  expect(html).toContain("HQ refused: project still exists");
  expect(html).toContain("Try again");
});
