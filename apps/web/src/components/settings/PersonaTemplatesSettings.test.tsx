/**
 * Settings › Zerops › Persona templates, from what is read: HQ's record of the organization's
 * templates, the person's role, and where their last write stands.
 */
import type { PersonaTemplateWrite } from "@t3tools/client-runtime/data";
import type { PersonaTemplate } from "@t3tools/shared/personaTemplates";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { create, type ReactTestInstance } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

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
  const handlers = {
    onSave: vi.fn(),
    onDelete: vi.fn(),
    onReset: vi.fn(),
    onAskAgain: vi.fn(),
  };
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
const frames: FrameRequestCallback[] = [];
const flushFrames = () => {
  for (const frame of frames.splice(0)) frame(0);
};
beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (frame: FrameRequestCallback) => frames.push(frame));
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
});
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
  act(flushFrames);
  vi.unstubAllGlobals();
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
      title: "an organization without templates says it has none yet",
      read: { templates: [] },
      says: "No templates yet.",
    },
    {
      title: "a failed read gives its cause",
      read: { state: "failed" as const, templates: [], failure: "HQ is not answering right now." },
      says: "HQ could not read the persona templates. HQ is not answering right now.",
    },
    {
      title: "a list HQ no longer keeps current says it may be out of date, and why",
      read: { failure: "Zerops refused HQ's access." },
      says: "This list may be out of date. Zerops refused HQ's access.",
    },
  ])("$title", ({ read, says }) => {
    expect(shown(read)).toContain(says);
  });

  it("an Admin's new template is sent with its trimmed text and its instructions counted against 3,000", () => {
    const { element, onSave } = view();
    const tree = mount(element);
    press(tree, "Add template");
    const [name, description] = tree.root.findAll((node) => node.type === "input");
    const instructions = tree.root.find((node) => node.type === "textarea");
    act(() => name!.props.onChange(typed("  Pairer ")));
    act(() => description!.props.onChange(typed(" Thinks aloud.  ")));
    act(() => instructions.props.onChange(typed("\n Explain each step.\n\n")));
    expect(JSON.stringify(tree.toJSON())).toContain('"18"," / ","3,000"');
    act(() => tree.root.find((node) => node.type === "form").props.onSubmit(EVENT));
    expect(onSave).toHaveBeenCalledWith({
      templateId: expect.any(String),
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
    act(flushFrames);
    expect(button(tree, "Save").props.disabled).toBe(true);
    expect(JSON.stringify(tree.toJSON())).toContain("Instructions have at most 3,000 characters.");
  });

  it("a conflict says someone else changed the template and offers their version", () => {
    const theirs = { ...REVIEWER, instructions: "Ship fast.", revision: 3 };
    const { element: _, ...props } = view();
    const { onSave } = props;
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

  it("a new template keeps its id across presses, and one HQ could not confirm is asked after, never sent again", () => {
    const { element: _, ...props } = view();
    const tree = mount(<PersonaTemplatesView read={READY} write={IDLE} {...props} />);
    press(tree, "Add template");
    const [name] = tree.root.findAll((node) => node.type === "input");
    act(() => name!.props.onChange(typed("Pairer")));
    act(() => tree.root.find((node) => node.type === "textarea").props.onChange(typed("Pair.")));
    const submit = () =>
      act(() => tree.root.find((node) => node.type === "form").props.onSubmit(EVENT));
    submit();
    act(() =>
      tree.update(
        <PersonaTemplatesView read={READY} write={{ stage: "failed", reason: "x" }} {...props} />,
      ),
    );
    submit();
    const [first, second] = props.onSave.mock.calls.map(([draft]) => draft.templateId);
    expect(first).toEqual(expect.any(String));
    expect(second).toBe(first);
    act(() =>
      tree.update(
        <PersonaTemplatesView
          read={READY}
          write={{ stage: "unconfirmed", reason: "HQ could not confirm this change." }}
          {...props}
        />,
      ),
    );
    expect(button(tree, "Save").props.disabled).toBe(true);
    submit();
    expect(props.onSave).toHaveBeenCalledTimes(2);
    press(tree, "Ask HQ again");
    expect(props.onAskAgain).toHaveBeenCalledOnce();
  });

  it("an edit whose template someone deleted keeps its draft and can keep it as a new template", () => {
    const { element: _, ...props } = view();
    const tree = mount(<PersonaTemplatesView read={READY} write={IDLE} {...props} />);
    press(tree, "Show instructions");
    press(tree, "Edit");
    act(() =>
      tree.root.find((node) => node.type === "textarea").props.onChange(typed("Mine, typed.")),
    );
    act(() =>
      tree.update(
        <PersonaTemplatesView read={{ ...READY, templates: [SHIPPER] }} write={IDLE} {...props} />,
      ),
    );
    expect(tree.root.find((node) => node.type === "textarea").props.value).toBe("Mine, typed.");
    expect(JSON.stringify(tree.toJSON())).toContain(
      "Someone else deleted this template meanwhile.",
    );
    expect(button(tree, "Save").props.disabled).toBe(true);
    press(tree, "Keep it as a new template");
    act(() => tree.root.find((node) => node.type === "form").props.onSubmit(EVENT));
    expect(props.onSave).toHaveBeenCalledWith(
      expect.objectContaining({ revision: 0, name: "Reviewer", instructions: "Mine, typed." }),
    );
    expect(props.onSave.mock.calls[0]![0].templateId).not.toBe("t-1");
  });

  it("while a save is under way no other template's edit or delete can drop its outcome", () => {
    const { element: _, ...props } = view();
    const tree = mount(<PersonaTemplatesView read={READY} write={IDLE} {...props} />);
    press(tree, "Show instructions");
    press(tree, "Edit");
    act(() =>
      tree.update(<PersonaTemplatesView read={READY} write={{ stage: "pending" }} {...props} />),
    );
    press(tree, "Show instructions");
    expect(button(tree, "Edit").props.disabled).toBe(true);
    expect(button(tree, "Delete").props.disabled).toBe(true);
    const resets = props.onReset.mock.calls.length;
    press(tree, "Edit");
    expect(props.onReset).toHaveBeenCalledTimes(resets);
    act(() =>
      tree.update(
        <PersonaTemplatesView
          read={READY}
          write={{ stage: "failed", reason: "HQ refused this." }}
          {...props}
        />,
      ),
    );
    expect(JSON.stringify(tree.toJSON())).toContain("HQ refused this.");
  });
});
