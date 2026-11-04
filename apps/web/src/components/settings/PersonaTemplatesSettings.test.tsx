/**
 * Settings › Zerops › Persona templates, from what is read: HQ's record of the organization's
 * templates, the person's role, and where their last write stands.
 */
import type { PersonaTemplateWrite } from "@t3tools/client-runtime/data";
import type { PersonaTemplate } from "@t3tools/shared/personaTemplates";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { create, type ReactTestInstance } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { OrgPersonaTemplatesView } from "~/zerops/usePersonaTemplates";
import { PersonaTemplatesView } from "./PersonaTemplatesSettings";

const REVIEWER: PersonaTemplate = {
  id: "t-1",
  name: "Reviewer",
  description: "Reads every change twice.",
  instructions: "Review before you merge.",
  revision: 2,
};
const SHIPPER: PersonaTemplate = {
  id: "t-2",
  name: "Shipper",
  description: "Small steps, shipped daily.",
  instructions: "Ship every day.",
  revision: 1,
};
const READY: OrgPersonaTemplatesView = {
  state: "ready",
  templates: [REVIEWER, SHIPPER],
  orgName: "Acme",
  mayWrite: true,
  failure: null,
  retry: () => {},
};
const IDLE: PersonaTemplateWrite = { stage: "idle" };

function view(read: Partial<OrgPersonaTemplatesView> = {}, write = IDLE) {
  const handlers = { onSave: vi.fn(), onDelete: vi.fn(), onReset: vi.fn() };
  return {
    element: <PersonaTemplatesView read={{ ...READY, ...read }} write={write} {...handlers} />,
    ...handlers,
  };
}

/** The words a section's markup carries. */
const shown = (read: Partial<OrgPersonaTemplatesView> = {}, write = IDLE) =>
  renderToStaticMarkup(view(read, write).element)
    .replace(/<[^>]+>/gu, " ")
    .replace(/&#x27;|&rsquo;|’/gu, "'")
    .replace(/\s+/gu, " ")
    .trim();

let mounted: ReturnType<typeof create> | undefined;
function mount(element: React.ReactElement) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  act(() => {
    mounted = create(element);
  });
  return mounted!;
}
afterEach(() => {
  if (mounted !== undefined) act(() => mounted!.unmount());
  mounted = undefined;
});
const text = (node: ReactTestInstance): string =>
  node.children.map((child) => (typeof child === "string" ? child : text(child))).join("");
/** The first button the person reads with this label. */
const button = (tree: ReturnType<typeof create>, label: string) =>
  tree.root.findAll((node) => node.type === "button" && text(node) === label)[0]!;
const EVENT = { defaultPrevented: false, preventDefault() {}, stopPropagation() {} };
const typed = (value: string) => ({
  ...EVENT,
  nativeEvent: EVENT,
  currentTarget: { value },
  target: { value },
});
const buttons = (tree: ReturnType<typeof create>) =>
  tree.root.findAll((node) => node.type === "button").map(text);
const press = (tree: ReturnType<typeof create>, label: string) =>
  act(() => button(tree, label).props.onClick(EVENT));

describe("an organization's persona templates in Settings", () => {
  it("lists each template HQ holds by its name and description, under what templates are", () => {
    const words = shown();
    expect(words).toContain("Reviewer Reads every change twice.");
    expect(words).toContain("Shipper Small steps, shipped daily.");
    expect(words).toContain("Starting points for each Mate's persona. A Mate keeps its own copy");
  });

  it("shows a template's instructions once it is opened", () => {
    const tree = mount(view().element);
    expect(JSON.stringify(tree.toJSON())).not.toContain("Review before you merge.");
    press(tree, "Show instructions");
    expect(JSON.stringify(tree.toJSON())).toContain("Review before you merge.");
  });

  it.each([
    {
      title: "a member reads the templates and is told Owners and Admins edit them",
      mayWrite: false,
    },
    { title: "an Owner or Admin can add, edit and delete templates", mayWrite: true },
  ])("$title", ({ mayWrite }) => {
    const tree = mount(view({ mayWrite, templates: [REVIEWER] }).element);
    press(tree, "Show instructions");
    const offered = buttons(tree);
    for (const action of ["Add template", "Edit", "Delete"])
      expect(offered.includes(action)).toBe(mayWrite);
    expect(shown({ mayWrite }).includes("Owners and Admins edit these.")).toBe(!mayWrite);
  });

  it.each([
    {
      title: "an HQ that offers no templates says so by the organization's name",
      read: { state: "unavailable" as const, templates: [] },
      says: "Acme's HQ doesn't offer persona templates yet.",
    },
    {
      title: "an organization without templates says it has none yet",
      read: { templates: [] },
      says: "No templates yet.",
    },
    {
      title: "a failed read gives its cause",
      read: { state: "failed" as const, templates: [], failure: "HQ is not answering right now." },
      says: "HQ could not read the persona templates.",
    },
  ])("$title", ({ read, says }) => {
    expect(shown(read)).toContain(says);
  });

  it("a failed read reads the templates again when asked", () => {
    const retry = vi.fn();
    const tree = mount(view({ state: "failed", templates: [], failure: "x", retry }).element);
    press(tree, "Read again");
    expect(retry).toHaveBeenCalledOnce();
  });

  it("an Admin's new template is sent with its trimmed text and its instructions counted against 3,000", () => {
    const { element, onSave } = view();
    const tree = mount(element);
    press(tree, "Add template");
    const [name, description] = tree.root.findAll((node) => node.type === "input");
    const instructions = tree.root.find((node) => node.type === "textarea");
    act(() => name!.props.onChange(typed("Pairer")));
    act(() => description!.props.onChange(typed("Thinks aloud.")));
    act(() => instructions.props.onChange(typed("Explain each step.")));
    expect(JSON.stringify(tree.toJSON())).toContain('"18"," / ","3,000"');
    act(() => tree.root.find((node) => node.type === "form").props.onSubmit(EVENT));
    expect(onSave).toHaveBeenCalledWith({
      revision: 0,
      name: "Pairer",
      description: "Thinks aloud.",
      instructions: "Explain each step.",
    });
  });

  it("instructions past 3,000 characters cannot be saved and say why", () => {
    const tree = mount(view().element);
    press(tree, "Add template");
    const [name] = tree.root.findAll((node) => node.type === "input");
    act(() => name!.props.onChange(typed("Long")));
    act(() =>
      tree.root.find((node) => node.type === "textarea").props.onChange(typed("x".repeat(3001))),
    );
    expect(button(tree, "Save").props.disabled).toBe(true);
    expect(JSON.stringify(tree.toJSON())).toContain("Instructions have at most 3,000 characters.");
  });

  it("a conflict says someone else changed the template and offers their version", () => {
    const theirs = { ...REVIEWER, instructions: "Ship fast.", revision: 3 };
    const { onSave, onDelete, onReset } = view();
    const props = { onSave, onDelete, onReset };
    const tree = mount(<PersonaTemplatesView read={READY} write={IDLE} {...props} />);
    press(tree, "Show instructions");
    press(tree, "Edit");
    act(() =>
      tree.update(
        <PersonaTemplatesView
          read={{ ...READY, templates: [theirs, SHIPPER] }}
          write={{ stage: "conflict", current: theirs }}
          {...props}
        />,
      ),
    );
    expect(JSON.stringify(tree.toJSON())).toContain(
      "Someone else changed this template meanwhile.",
    );
    press(tree, "Use their version");
    expect(tree.root.find((node) => node.type === "textarea").props.value).toBe("Ship fast.");
    act(() => tree.root.find((node) => node.type === "form").props.onSubmit(EVENT));
    expect(onSave).toHaveBeenLastCalledWith(
      expect.objectContaining({ revision: 3, templateId: "t-1" }),
    );
  });
});
