/**
 * The New Mate dialog asks who the Mate is — a name, a colour, a shape — and decides the rest: it
 * always deploys the project's recipe, and a project with none gets its Mate with nothing in it.
 */
import { MATE_SHAPE_IDS, MATE_TINT_IDS, type MateTintId } from "@t3tools/shared/brand";
import { act, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { Dialog } from "../ui/dialog";
import {
  ZeropsEnvironmentCreationForm,
  type EnvironmentCreationChoice,
} from "./ZeropsEnvironmentCreationDialog";

const TIER = {
  kind: "tier" as const,
  tier: "mate" as const,
  yaml: "services:\n  - hostname: app\n    startWithoutCode: true\n",
  sources: { app: { repository: "https://gitea.test/acme/app", setup: "app" } },
};

/** The tint the account gives each name: fixed here, so every case reads. */
const TINTS: Readonly<Record<string, MateTintId>> = { Otto: "violet", Ada: "sky", Milo: "coral" };

type Props = Parameters<typeof ZeropsEnvironmentCreationForm>[0];

function form(props: Partial<Props> = {}): ReactElement {
  // The title and the description are Base UI's, and both need the dialog's context.
  return (
    <Dialog open onOpenChange={() => {}}>
      <ZeropsEnvironmentCreationForm
        defaultBotName="Otto"
        defaultName="Acme Docs - Otto"
        defaultTintFor={(name) => TINTS[name] ?? "slate"}
        defaultWithAgent
        groupName="Acme Docs"
        onCancel={() => {}}
        onCreate={() => {}}
        proposeName={(botName) => `Acme Docs - ${botName}`}
        role="dev"
        takenBotNames={{ names: ["Fen"], complete: true }}
        tier={TIER}
        tierLoading={false}
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
      node.props["data-new-mate-face"] !== "out",
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

  it("says what happens, and names the Mate on its button", () => {
    const html = renderToStaticMarkup(form());
    expect(html).toContain(">New Mate<");
    expect(html).toContain(
      "It gets its own copy of Acme Docs with the recipe deployed. It takes a couple of minutes.",
    );
    expect(html).toContain(">Add Otto to Acme Docs</button>");
  });

  it("shows the face being made, big, in the colour and shape the name asks for", () => {
    const tree = mount(form());
    const svg = host(tree, (node) => node.props["data-zerops-primitive"] === "mate-face");
    expect(svg.props.className).toContain("size-28");
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
        name: "Acme Docs - Ada Lin",
        withAgent: true,
        botName: "Ada Lin",
        recipe: TIER,
        face: { tint: "amber", shape: "hexagon" },
      },
    ]);
  });

  it("waits while the recipe is read, says so, and adds the Mate the moment it arrives", () => {
    const made: EnvironmentCreationChoice[] = [];
    const onCreate = (choice: EnvironmentCreationChoice) => made.push(choice);
    const tree = mount(form({ onCreate, tier: undefined, tierLoading: true }));
    expect(lineText(tree)).toBe("Reading the project's recipe…");
    press(tree);
    expect(made).toEqual([]);
    expect(
      host(tree, (node) => node.type === "button" && node.props.type === "submit").props,
    ).toMatchObject({ disabled: true, "aria-busy": true });
    act(() => {
      tree.update(form({ onCreate, tier: TIER, tierLoading: false }));
    });
    expect(made.map((choice) => choice.recipe)).toEqual([TIER]);
  });

  it("does not add an empty Mate for a press made before the project was read as having no recipe", () => {
    const made: EnvironmentCreationChoice[] = [];
    const onCreate = (choice: EnvironmentCreationChoice) => made.push(choice);
    const tree = mount(form({ onCreate, tier: undefined, tierLoading: true }));
    press(tree);
    act(() => {
      tree.update(form({ onCreate, tier: undefined, tierLoading: false }));
    });
    expect(made).toEqual([]);
    expect(lineText(tree)).toBe("");
    expect(renderToStaticMarkup(form({ tier: undefined, tierLoading: false }))).toContain(
      "There&#x27;s no recipe yet, so it sets the application up itself.",
    );
    press(tree);
    expect(made.map((choice) => choice.recipe)).toEqual([{ kind: "none" }]);
  });

  it("tells a project with no recipe on main that its Mate sets the application up", () => {
    const html = renderToStaticMarkup(form({ tier: undefined, tierLoading: false }));
    // The saying with the recipe keeps its room, out of sight and out of the reading.
    expect(html).toMatch(
      /invisible opacity-0 duration-100">It gets its own copy of Acme Docs with the recipe deployed\./u,
    );
    expect(html).toMatch(
      /delay-100 duration-200">It gets its own copy of Acme Docs\. There&#x27;s no recipe yet, so it sets the application up itself\. It takes a couple of minutes\./u,
    );
  });

  it("says nothing until Add is pressed, then why a name will not do", () => {
    const made: EnvironmentCreationChoice[] = [];
    const tree = mount(form({ onCreate: (choice) => made.push(choice) }));
    type(tree, "fen");
    expect(lineText(tree)).toBe("");
    press(tree);
    expect(made).toEqual([]);
    expect(lineText(tree)).toBe("Another Mate already has that name.");
    expect(line(tree).props.className).toContain("text-status-failed-text");
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
    const tree = mount(form({ onCreate, tier: undefined, tierLoading: true }));
    if (refused) type(tree, "Fen");
    press(tree);
    type(tree, name);
    act(() => {
      tree.update(form({ onCreate, tier: TIER, tierLoading: false }));
    });
    expect(made).toEqual([]);
    press(tree);
    expect(made.map((choice) => choice.botName)).toEqual([name]);
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
    expect(made.map((choice) => choice.botName)).toEqual(["Otto"]);
  });

  // After Add the dialog stays until the platform has taken the Mate's project — a second, and the
  // person lands on the new Mate — so it says it is adding, takes no second press and cannot be
  // closed half way; a refusal before that is said beside the button, and Add tries again.
  it("says it is adding the Mate while the platform takes its project, and takes no second press", () => {
    const made: EnvironmentCreationChoice[] = [];
    const tree = mount(form({ adding: true, onCreate: (choice) => made.push(choice) }));
    expect(lineText(tree)).toBe("Adding Otto…");
    const submit = host(tree, (node) => node.type === "button" && node.props.type === "submit");
    expect(submit.props).toMatchObject({ disabled: true, "aria-busy": true });
    const cancel = host(
      tree,
      (node) =>
        node.type === "button" && node.props.type === "button" && node.props.children === "Cancel",
    );
    expect(cancel.props.disabled).toBe(true);
    // What made the Mate stays as it was: nothing typed or picked changes the Mate on its way.
    const input = host(
      tree,
      (node) => node.type === "input" && node.props["aria-label"] === "Name",
    );
    expect(input.props.readOnly).toBe(true);
    const before = face(tree);
    act(() => {
      option(tree, "Violet").props.onClick();
    });
    expect(face(tree)).toEqual(before);
    press(tree);
    expect(made).toEqual([]);
  });

  it("says why the platform refused beside the button, in the failed ink, and Add tries again", () => {
    const made: EnvironmentCreationChoice[] = [];
    const tree = mount(
      form({
        addError: "Your organization has no room for a project.",
        onCreate: (c) => made.push(c),
      }),
    );
    expect(lineText(tree)).toBe("Your organization has no room for a project.");
    expect(line(tree).props.className).toContain("text-status-failed-text");
    // The platform said no, not the name: the field is not marked wrong.
    const input = host(
      tree,
      (node) => node.type === "input" && node.props["aria-label"] === "Name",
    );
    expect(input.props["aria-invalid"]).toBeUndefined();
    press(tree);
    expect(made.map((choice) => choice.botName)).toEqual(["Otto"]);
  });
});
