/**
 * The New Mate dialog asks who the Mate is — a name, a colour, a shape — and decides the rest: it
 * always deploys the project's recipe, and a project with none gets its first Mate with nothing
 * in it. A project whose Mates have not written its recipe yet takes no other: the dialog says
 * why, in the form's place, and offers the one thing to do about it.
 */
import { MATE_SHAPE_IDS, MATE_TINT_IDS, type MateTintId } from "@t3tools/shared/brand";
import { act, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { Dialog } from "../ui/dialog";
import {
  ZeropsEnvironmentCreationForm,
  type EnvironmentCreationChoice,
} from "./ZeropsEnvironmentCreationDialog";
import type { NewMateDoorAction, NewMateDoorClosed } from "./ZeropsEnvironmentCreationDialog.logic";

const TIER = {
  kind: "tier" as const,
  tier: "mate" as const,
  yaml: "services:\n  - hostname: app\n    startWithoutCode: true\n",
};

/** The tint the account gives each name: fixed here, so every case reads. */
const TINTS: Readonly<Record<string, MateTintId>> = { Otto: "violet", Ada: "sky", Milo: "coral" };

type Props = Parameters<typeof ZeropsEnvironmentCreationForm>[0];

function form(props: Partial<Props> = {}): ReactElement {
  // The title and the description are Base UI's, and both need the dialog's context.
  return (
    <Dialog open onOpenChange={() => {}}>
      <ZeropsEnvironmentCreationForm
        defaultName="Otto"
        defaultTintFor={(name) => TINTS[name] ?? "slate"}
        defaultWithAgent
        groupName="Acme Docs"
        onCancel={() => {}}
        onCreate={() => {}}
        role="dev"
        takenBotNames={{ names: ["Fen"], complete: true }}
        tier={TIER}
        recipe="present"
        tierServices={["app"]}
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
  vi.unstubAllGlobals();
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

/** The face being made: the one the preview draws now, not the one fading out. */
function face(tree: ReactTestRenderer) {
  const svg = host(
    tree,
    (node) =>
      node.props["data-zerops-primitive"] === "mate-face" &&
      node.props["data-mate-face-preview"] !== "out",
  );
  return { tint: svg.props["data-mate-face-tint"], shape: svg.props["data-mate-face-shape"] };
}

const option = (tree: ReactTestRenderer, label: string) =>
  host(tree, (node) => node.props.role === "radio" && node.props["aria-label"] === label);

function type(tree: ReactTestRenderer, value: string) {
  const input = host(tree, (node) => node.type === "input" && node.props["aria-label"] === "Name");
  act(() => {
    input.props.onChange({ target: { value }, currentTarget: { value } });
  });
}

function press(tree: ReactTestRenderer) {
  act(() => {
    host(tree, (node) => node.type === "form").props.onSubmit({ preventDefault: () => {} });
  });
}

const line = (tree: ReactTestRenderer) =>
  host(tree, (node) => node.type === "p" && node.props["aria-live"] === "polite");

const lineText = (tree: ReactTestRenderer) =>
  line(tree)
    .children.filter((child): child is string => typeof child === "string")
    .join("");

/** A node's words as they are read: what `aria-hidden` keeps out of sight is not among them. */
function spoken(node: ReactTestInstance): string {
  if (node.props["aria-hidden"] === true) return "";
  return node.children.map((child) => (typeof child === "string" ? child : spoken(child))).join("");
}

/** What the dialog's description says now. */
const said = (tree: ReactTestRenderer) =>
  spoken(host(tree, (node) => node.props["data-slot"] === "dialog-description"));

/**
 * What happens next, as the dialog's closing block shows it now: each step's words and time,
 * then the line under them.
 */
function next(tree: ReactTestRenderer) {
  const shown = host(tree, (node) => node.props["data-zerops-next"] === "shown");
  return {
    steps: shown
      .findAll((node) => node.type === "li")
      .map((step) => [
        spoken(step.children[1] as ReactTestInstance),
        spoken(step.children[2] as ReactTestInstance),
      ]),
    note: spoken(shown.find((node) => node.type === "p")),
  };
}

/** Out of reach: under an `inert` form, or not a button a person can press there at all. */
function inReach(node: ReactTestInstance): boolean {
  for (let at: ReactTestInstance | null = node; at !== null; at = at.parent) {
    if (at.props.inert === true) return false;
  }
  return true;
}

/** Every button a person can reach, its words, in order. */
const buttons = (tree: ReactTestRenderer) =>
  tree.root
    .findAll((node) => node.type === "button" && node.props.role !== "radio" && inReach(node))
    .map((node) => spoken(node));

const button = (tree: ReactTestRenderer, words: string) =>
  host(tree, (node) => node.type === "button" && spoken(node) === words);

describe("the New Mate dialog", () => {
  it("asks for a name, a colour and a shape, and nothing else", () => {
    const html = renderToStaticMarkup(form());
    expect(html.match(/<input/gu)).toHaveLength(1);
    expect(html).toContain('value="Otto"');
    expect(html.match(/role="radiogroup"/gu)).toHaveLength(2);
    expect(html).toContain('aria-label="Color"');
    expect(html).toContain('aria-label="Shape"');
    expect(html.match(/role="radio"/gu)).toHaveLength(MATE_TINT_IDS.length + MATE_SHAPE_IDS.length);
    for (const gone of ["Environment", "Runs an agent", "Application", "Nothing yet", "Agent"]) {
      expect(html).not.toContain(gone);
    }
  });

  // Board D1, 2026-09-30: the dialog ends with what happens next, with honest times, and names
  // the project in its title; nothing above the form says it twice.
  it("ends with what happens next, names the project and the Mate, and says nothing twice", () => {
    const tree = mount(form());
    expect(next(tree)).toEqual({
      steps: [
        ["Otto comes up", "about 1½–2 min"],
        ["You sign Otto in with your Claude or ChatGPT subscription", ""],
        ["Otto sets up development, deploying Acme Docs' code", "up to 15 min"],
      ],
      note: "You can leave meanwhile.",
    });
    type(tree, "Ada");
    expect(next(tree).steps[0]).toEqual(["Ada comes up", "about 1½–2 min"]);
    expect(said(tree)).toBe("");
    const html = renderToStaticMarkup(form());
    expect(html).toContain(">New Mate on Acme Docs<");
    expect(html).toContain(">Add Otto to Acme Docs</button>");
  });

  it("rolls another name free on the account with its die, and the face follows it", () => {
    // The die's tooltip listens on `window` once mounted; there is no DOM here.
    const noDom = Object.fromEntries(
      ["Node", "Element", "HTMLElement", "ShadowRoot"].map((name) => [name, function none() {}]),
    );
    vi.stubGlobal("window", Object.assign(new EventTarget(), noDom));
    for (const [name, type] of Object.entries(noDom)) vi.stubGlobal(name, type);
    const asked: string[] = [];
    const tree = mount(
      form({
        proposeAnotherName: (current) => {
          asked.push(current);
          return "Milo";
        },
      }),
    );
    act(() => {
      host(tree, (node) => node.props["data-zerops-mate-name"] === "another").props.onClick({
        nativeEvent: {},
        preventDefault: () => {},
        stopPropagation: () => {},
      });
    });
    expect(asked).toEqual(["Otto"]);
    expect(
      host(tree, (node) => node.type === "input" && node.props["aria-label"] === "Name").props
        .value,
    ).toBe("Milo");
    expect(face(tree).tint).toBe("coral");
  });

  it("offers no die where no other name can be proposed", () => {
    expect(renderToStaticMarkup(form())).not.toContain("Another name");
  });

  it("shows the face selected for the Mate", () => {
    const tree = mount(form());
    expect(face(tree)).toEqual({ tint: "violet", shape: "gem" });
  });

  it("makes every colour and shape a named button, the picked one the only stop for Tab", () => {
    const tree = mount(form());
    const radios = tree.root.findAll(
      (node) => typeof node.type === "string" && node.props.role === "radio",
    );
    expect(radios.every((radio) => radio.type === "button")).toBe(true);
    expect(radios.map((radio) => radio.props["aria-label"])).toEqual([
      "Coral",
      "Amber",
      "Olive",
      "Sky",
      "Violet",
      "Rose",
      "Sand",
      "Slate",
      "Squircle",
      "Gem",
      "Hexagon",
      "Pentagon",
      "Clover",
      "Flower",
      "Seal",
      "Guitar pick",
    ]);
    const stops = radios.filter((radio) => radio.props.tabIndex === 0);
    expect(stops.map((radio) => [radio.props["aria-label"], radio.props["aria-checked"]])).toEqual([
      ["Violet", true],
      ["Gem", true],
    ]);
  });

  it("follows the name as it is typed until a colour and a shape are picked", () => {
    const tree = mount(form());
    expect(face(tree)).toEqual({ tint: "violet", shape: "gem" });
    type(tree, "Ada");
    expect(face(tree)).toEqual({ tint: "sky", shape: "pick" });
    // A blank field keeps the face it had.
    type(tree, "  ");
    expect(face(tree)).toEqual({ tint: "sky", shape: "pick" });
    act(() => {
      option(tree, "Rose").props.onClick();
    });
    expect(face(tree)).toEqual({ tint: "rose", shape: "flower" });
    type(tree, "Milo");
    expect(face(tree)).toEqual({ tint: "rose", shape: "flower" });
    act(() => {
      option(tree, "Seal").props.onClick();
    });
    type(tree, "Otto");
    expect(face(tree)).toEqual({ tint: "rose", shape: "seal" });
  });

  it.each([
    { key: "ArrowRight", from: "Violet", to: "Rose" },
    { key: "ArrowDown", from: "Violet", to: "Rose" },
    { key: "ArrowLeft", from: "Violet", to: "Sky" },
    { key: "ArrowRight", from: "Guitar pick", to: "Squircle" },
    { key: "ArrowLeft", from: "Squircle", to: "Guitar pick" },
  ])("walks a row with $key: $from to $to", ({ key, from, to }) => {
    const tree = mount(form());
    act(() => {
      option(tree, from).props.onClick();
    });
    act(() => {
      option(tree, from).props.onKeyDown({ key, preventDefault: () => {} });
    });
    expect(option(tree, to).props["aria-checked"]).toBe(true);
  });

  // The form hands over the Mate's own name; its project is named in full from it.
  it("adds the Mate with the project's recipe, its name and the face it was given", () => {
    const made: EnvironmentCreationChoice[] = [];
    const tree = mount(form({ onCreate: (choice) => made.push(choice) }));
    type(tree, " Ada  Lin ");
    act(() => {
      option(tree, "Amber").props.onClick();
    });
    press(tree);
    expect(made).toEqual([
      {
        name: "Ada Lin",
        withAgent: true,
        recipe: TIER,
        face: { tint: "amber", shape: "hexagon" },
      },
    ]);
  });

  it("waits while the recipe is read, says so, and adds the Mate the moment it arrives", () => {
    const made: EnvironmentCreationChoice[] = [];
    const onCreate = (choice: EnvironmentCreationChoice) => made.push(choice);
    const tree = mount(form({ onCreate, tier: undefined, recipe: "reading" }));
    expect(lineText(tree)).toBe("Reading the project's recipe…");
    press(tree);
    expect(made).toEqual([]);
    expect(
      host(tree, (node) => node.type === "button" && node.props.type === "submit").props,
    ).toMatchObject({ disabled: true, "aria-busy": true });
    act(() => {
      tree.update(form({ onCreate, tier: TIER, recipe: "present" }));
    });
    expect(made.map((choice) => choice.recipe)).toEqual([TIER]);
  });

  it("does not add an empty Mate for a press made before the project was read as having no recipe", () => {
    const made: EnvironmentCreationChoice[] = [];
    const onCreate = (choice: EnvironmentCreationChoice) => made.push(choice);
    const tree = mount(form({ onCreate, tier: undefined, recipe: "reading" }));
    press(tree);
    act(() => {
      tree.update(form({ onCreate, tier: undefined, recipe: "absent" }));
    });
    expect(made).toEqual([]);
    expect(lineText(tree)).toBe("");
    expect(next(tree).steps[2]).toEqual(["You tell Otto what to build", ""]);
    press(tree);
    expect(made.map((choice) => choice.recipe)).toEqual([{ kind: "none" }]);
  });

  it("tells a project with nothing to deploy yet that its person says what to build", () => {
    const tree = mount(form({ tier: undefined, recipe: "absent" }));
    expect(next(tree)).toEqual({
      steps: [
        ["Otto comes up", "about 1½–2 min"],
        ["You sign Otto in with your Claude or ChatGPT subscription", ""],
        ["You tell Otto what to build", ""],
      ],
      note: "You can leave while Otto comes up.",
    });
  });

  it("says nothing until Add is pressed, then why a name will not do", () => {
    const made: EnvironmentCreationChoice[] = [];
    const tree = mount(form({ onCreate: (choice) => made.push(choice) }));
    type(tree, "fen");
    expect(lineText(tree)).toBe("");
    press(tree);
    expect(made).toEqual([]);
    expect(lineText(tree)).toBe("Another Mate already has that name.");
    expect(
      host(tree, (node) => node.type === "input" && node.props["aria-label"] === "Name").props[
        "aria-invalid"
      ],
    ).toBe(true);
  });

  it.each([
    { case: "a name typed while the recipe was read", name: "Milo", refused: false },
    { case: "a name refused, then set right", name: "Ada", refused: true },
  ])("lets a press go once $case: only a press adds", ({ name, refused }) => {
    const made: EnvironmentCreationChoice[] = [];
    const onCreate = (choice: EnvironmentCreationChoice) => made.push(choice);
    const tree = mount(form({ onCreate, tier: undefined, recipe: "reading" }));
    if (refused) type(tree, "Fen");
    press(tree);
    type(tree, name);
    act(() => {
      tree.update(form({ onCreate, tier: TIER, recipe: "present" }));
    });
    expect(made).toEqual([]);
    press(tree);
    expect(made.map((choice) => choice.name)).toEqual([name]);
  });

  it("waits for every Mate's name before a new one passes as free", () => {
    const made: EnvironmentCreationChoice[] = [];
    const onCreate = (choice: EnvironmentCreationChoice) => made.push(choice);
    const tree = mount(form({ onCreate, takenBotNames: { names: [], complete: false } }));
    press(tree);
    expect(made).toEqual([]);
    expect(lineText(tree)).toBe("Checking which names are taken…");
    act(() => {
      tree.update(form({ onCreate, takenBotNames: { names: ["Fen"], complete: true } }));
    });
    expect(made.map((choice) => choice.name)).toEqual(["Otto"]);
  });
});

describe("the New Mate dialog, while the project takes no Mate", () => {
  const REVIEW: NewMateDoorClosed = {
    kind: "closed",
    reason:
      "Acme Docs' recipe is waiting in Cleo's change. New Mates start from it once it's merged.",
    action: { kind: "change", label: "Review the change", number: 11 },
  };
  const OPEN_CLEO: NewMateDoorClosed = {
    kind: "closed",
    reason:
      "Acme Docs has no recipe yet. Cleo writes it when it finishes setting Acme Docs up, and new Mates start from it.",
    action: { kind: "mate", label: "Open Cleo", projectId: "cleo-project" },
  };
  const RETRY: NewMateDoorClosed = {
    kind: "closed",
    reason: "Acme Docs' recipe can't be read right now.",
    action: { kind: "retry", label: "Try again", busy: false },
  };
  const NOBODY: NewMateDoorClosed = {
    kind: "closed",
    reason:
      "Acme Docs has no recipe yet. Acme Docs' Mates write it when one of them finishes setting Acme Docs up.",
    action: undefined,
  };

  it("says why in the form's place, under the same title, with no Add", () => {
    const tree = mount(form({ tier: undefined, closed: REVIEW }));
    expect(said(tree)).toBe(REVIEW.reason);
    expect(renderToStaticMarkup(form({ tier: undefined, closed: REVIEW }))).toContain(
      ">New Mate on Acme Docs<",
    );
    expect(buttons(tree)).toEqual(["Close", "Review the change"]);
    expect(
      tree.root.findAll((node) => node.type === "button" && node.props.type === "submit"),
    ).toEqual([]);
  });

  it.each([
    { case: "the change the recipe waits in", closed: REVIEW, words: "Review the change" },
    { case: "the Mate that writes it", closed: OPEN_CLEO, words: "Open Cleo" },
    { case: "a read of it again", closed: RETRY, words: "Try again" },
  ])("sends its one action to $case", ({ closed, words }) => {
    const acted: NewMateDoorAction[] = [];
    const tree = mount(
      form({ tier: undefined, closed, onDoorAction: (action) => acted.push(action) }),
    );
    act(() => {
      button(tree, words).props.onClick();
    });
    expect(acted).toEqual([closed.action]);
  });

  it("offers no action where there is none, only the way out", () => {
    let cancelled = 0;
    const tree = mount(
      form({
        tier: undefined,
        closed: NOBODY,
        onCancel: () => {
          cancelled += 1;
        },
      }),
    );
    expect(said(tree)).toBe(NOBODY.reason);
    expect(buttons(tree)).toEqual(["Close"]);
    act(() => {
      button(tree, "Close").props.onClick();
    });
    expect(cancelled).toBe(1);
  });

  it("holds Try again while the recipe is read again, and says so", () => {
    const tree = mount(
      form({
        tier: undefined,
        closed: { ...RETRY, action: { kind: "retry", label: "Try again", busy: true } },
      }),
    );
    expect(button(tree, "Try again").props).toMatchObject({ disabled: true, "aria-busy": true });
    expect(lineText(tree)).toBe("Reading the project's recipe…");
  });

  it("takes no Mate while it says why: the name is out of reach, and a submit adds nothing", () => {
    const made: EnvironmentCreationChoice[] = [];
    const tree = mount(
      form({ tier: undefined, closed: OPEN_CLEO, onCreate: (choice) => made.push(choice) }),
    );
    let node: ReactTestInstance | null = host(
      tree,
      (candidate) => candidate.type === "input" && candidate.props["aria-label"] === "Name",
    );
    while (node !== null && node.props.inert !== true) node = node.parent;
    expect(node).not.toBeNull();
    press(tree);
    expect(made).toEqual([]);
  });

  it("drops a press made while the recipe was read once it says why, and adds only on a new one", () => {
    const made: EnvironmentCreationChoice[] = [];
    const onCreate = (choice: EnvironmentCreationChoice) => made.push(choice);
    const tree = mount(form({ onCreate, tier: undefined, recipe: "reading" }));
    type(tree, "Ada");
    press(tree);
    act(() => {
      tree.update(form({ onCreate, tier: undefined, closed: OPEN_CLEO }));
    });
    act(() => {
      tree.update(form({ onCreate, tier: TIER }));
    });
    expect(made).toEqual([]);
    // What was typed stayed, out of sight, while the door was shut.
    press(tree);
    expect(made.map((choice) => [choice.name, choice.recipe])).toEqual([["Ada", TIER]]);
  });
});
