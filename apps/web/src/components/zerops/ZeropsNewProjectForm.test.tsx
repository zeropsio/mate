/**
 * The New project dialog (board D1, 2026-09-30): New Mate with the project's name on top. It asks
 * the project's name, where it lives only where there is a choice, and who its first Mate is, and
 * ends with what happens next; Create hands the project and its Mate over at once.
 */
import { MATE_SHAPE_IDS, MATE_TINT_IDS, type MateTintId } from "@t3tools/shared/brand";
import { act, useEffect, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { ZeropsOrganization } from "@t3tools/client-runtime/zerops";

import { Dialog } from "../ui/dialog";
import { draftSummary, draftView } from "./projects/accessDraft.logic";
import { AccessDraftFold } from "./projects/ProjectAccessChips";
import { ZeropsNewProjectForm } from "./ZeropsNewProjectForm";

/** A draft standing in for the account's (`ProjectAccessDraft`): it says its list once drawn. */
function ChosenAccess({
  list,
  onChange,
}: {
  list: ReadonlyArray<{ clientUserId: string; roleCode: string }>;
  onChange: (list: ReadonlyArray<{ clientUserId: string; roleCode: string }>) => void;
}) {
  useEffect(() => onChange(list), [list, onChange]);
  return null;
}
import { zeropsNewProjectScopeStepVisible } from "./ZeropsNewProjectHost";

const ORGANIZATION: ZeropsOrganization = {
  id: "client-1",
  membershipId: "membership-1",
  name: "acme",
  roleCode: "OWNER",
  canCreateProjects: true,
};

describe("zeropsNewProjectScopeStepVisible", () => {
  it("is hidden once a single-membership account auto-resolves its organization", () => {
    expect(
      zeropsNewProjectScopeStepVisible({
        organizationStatus: "selected",
        activeOrganization: ORGANIZATION,
      }),
    ).toBe(false);
  });

  it("is shown while several memberships have not yet resolved an active one", () => {
    expect(
      zeropsNewProjectScopeStepVisible({
        organizationStatus: "needs-selection",
        activeOrganization: null,
      }),
    ).toBe(true);
  });

  it("is shown while the organization list is still loading", () => {
    expect(
      zeropsNewProjectScopeStepVisible({
        organizationStatus: "loading",
        activeOrganization: null,
      }),
    ).toBe(true);
  });
});

/** The tint the account gives each name: fixed here, so every case reads. */
const TINTS: Readonly<Record<string, MateTintId>> = { Ada: "sky", Otto: "violet", Fen: "sand" };

type FormProps = Parameters<typeof ZeropsNewProjectForm>[0];

function projectForm(props: Partial<FormProps> = {}): ReactElement {
  // The title and the description are Base UI's, and both need the dialog's context.
  return (
    <Dialog open onOpenChange={() => {}}>
      <ZeropsNewProjectForm
        creating={false}
        defaultBotName="Ada"
        defaultTintFor={(name) => TINTS[name] ?? "slate"}
        locationError={null}
        locationId={null}
        loading={false}
        locations={[]}
        onCancel={() => {}}
        onCreate={() => {}}
        onLocation={() => {}}
        takenBotNames={{ names: ["Fen"], complete: true }}
        {...props}
      />
    </Dialog>
  );
}

const mountedForms: ReactTestRenderer[] = [];
afterEach(() => {
  for (const tree of mountedForms.splice(0)) {
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
  mountedForms.push(tree!);
  return tree!;
}

const host = (tree: ReactTestRenderer, match: (node: ReactTestInstance) => boolean) =>
  tree.root.find((node) => typeof node.type === "string" && match(node));

const field = (tree: ReactTestRenderer, id: string) =>
  host(tree, (node) => node.type === "input" && node.props.id === id);

function type(tree: ReactTestRenderer, id: string, value: string) {
  act(() => {
    field(tree, id).props.onChange({ target: { value }, currentTarget: { value } });
  });
}

function pick(tree: ReactTestRenderer, label: string) {
  act(() => {
    host(
      tree,
      (node) => node.props.role === "radio" && node.props["aria-label"] === label,
    ).props.onClick();
  });
}

const createButton = (tree: ReactTestRenderer) =>
  host(
    tree,
    (node) => node.type === "button" && node.props["data-zerops-new-project"] === "create",
  );

function press(tree: ReactTestRenderer) {
  act(() => {
    host(tree, (node) => node.type === "form").props.onSubmit({ preventDefault: () => {} });
  });
}

/** A node's words as they are read: what `aria-hidden` keeps out of sight is not among them. */
function spoken(node: ReactTestInstance): string {
  if (node.props["aria-hidden"] === true) return "";
  return node.children.map((child) => (typeof child === "string" ? child : spoken(child))).join("");
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

const line = (tree: ReactTestRenderer) =>
  host(tree, (node) => node.type === "p" && node.props.id === "zerops-new-project-line");

/** What happens next, as its block shows it: each step's words and time. */
const nextSteps = (tree: ReactTestRenderer) =>
  host(tree, (node) => node.props["data-zerops-next"] === "shown")
    .findAll((node) => node.type === "li")
    .map((step) => [
      spoken(step.children[1] as ReactTestInstance),
      spoken(step.children[2] as ReactTestInstance),
    ]);

const PROJECT_FIELD = "zerops-new-project";
const MATE_FIELD = "zerops-new-project-mate";

describe("ZeropsNewProjectForm — the project and its first Mate", () => {
  it("asks the project's name, then its first Mate's: a name, a colour and a shape", () => {
    const html = renderToStaticMarkup(projectForm());
    expect(html).toContain(">New project<");
    expect(html.match(/<input/gu)).toHaveLength(2);
    expect(html).toContain(">Project name<");
    expect(html).toContain(">Its first Mate<");
    expect(html).toContain('value="Ada"');
    expect(html.match(/role="radiogroup"/gu)).toHaveLength(2);
    expect(html.match(/role="radio"/gu)).toHaveLength(MATE_TINT_IDS.length + MATE_SHAPE_IDS.length);
    expect(html).toContain('data-zerops-surface="mate-face-preview"');
  });

  // Location is asked only where the account has more than one place.
  it.each([
    { case: "one place: not asked", locations: [{ id: "prg1", name: "Prague" }], asked: false },
    {
      case: "two places: asked",
      locations: [
        { id: "prg1", name: "Prague" },
        { id: "fra1", name: "Frankfurt" },
      ],
      asked: true,
    },
  ])("asks where it lives only where there is a choice: $case", ({ locations, asked }) => {
    const html = renderToStaticMarkup(projectForm({ locations, locationId: "prg1" }));
    expect(html.includes('aria-label="Location"')).toBe(asked);
  });

  it("names what Create makes, as it is typed", () => {
    const tree = mount(projectForm());
    expect(spoken(createButton(tree))).toBe("Create a project with Ada");
    type(tree, PROJECT_FIELD, "Acme Shop");
    type(tree, MATE_FIELD, "Vera");
    expect(spoken(createButton(tree))).toBe("Create Acme Shop with Vera");
  });

  it("shows the face the Mate's name asks for, and follows the name until a pick sticks", () => {
    const tree = mount(projectForm());
    expect(face(tree)).toEqual({ tint: "sky", shape: "pick" });
    type(tree, MATE_FIELD, "Otto");
    expect(face(tree)).toEqual({ tint: "violet", shape: "gem" });
    pick(tree, "Rose");
    expect(face(tree)).toEqual({ tint: "rose", shape: "flower" });
    pick(tree, "Seal");
    type(tree, MATE_FIELD, "Ada");
    expect(face(tree)).toEqual({ tint: "rose", shape: "seal" });
  });

  it("hands over the project's name, the Mate's and the face picked", () => {
    const onCreate = vi.fn();
    const tree = mount(projectForm({ onCreate }));
    type(tree, PROJECT_FIELD, "Acme CRM");
    type(tree, MATE_FIELD, "  Mira   Lin ");
    pick(tree, "Olive");
    pick(tree, "Hexagon");
    press(tree);
    expect(onCreate).toHaveBeenCalledWith({
      name: "Acme CRM",
      botName: "Mira Lin",
      face: { tint: "olive", shape: "hexagon" },
    });
  });

  it("hands over the access chosen for its first Mate's project", () => {
    const onCreate = vi.fn();
    const chosen = [{ clientUserId: "cu-ada", roleCode: "ADMIN" }];
    const tree = mount(
      projectForm({
        onCreate,
        access: (onChange) => <ChosenAccess list={chosen} onChange={onChange} />,
      }),
    );
    type(tree, PROJECT_FIELD, "Acme CRM");
    type(tree, MATE_FIELD, "Mira");
    press(tree);
    expect(onCreate.mock.calls[0]?.[0]).toMatchObject({ userRoles: chosen });
  });

  it.each([
    { name: "", says: "Give the Mate a name." },
    { name: "Fen", says: "Another Mate already has that name." },
    { name: "A name far longer than twenty-four", says: "Keep it under 24 characters." },
  ])("refuses '$name' beside the button once pressed, and creates nothing", ({ name, says }) => {
    const onCreate = vi.fn();
    const tree = mount(projectForm({ onCreate }));
    type(tree, PROJECT_FIELD, "Acme CRM");
    type(tree, MATE_FIELD, name);
    expect(line(tree).children).toEqual([]);
    press(tree);
    expect(onCreate).not.toHaveBeenCalled();
    expect(line(tree).children).toEqual([says]);
    expect(field(tree, MATE_FIELD).props["aria-invalid"]).toBe(true);
  });

  it("a taken Mate name is refused before creating anything", () => {
    const onCreate = vi.fn();
    const tree = mount(
      projectForm({ takenBotNames: { names: ["Ada"], complete: true }, onCreate }),
    );
    type(tree, PROJECT_FIELD, "Garden");
    type(tree, MATE_FIELD, "ada");
    press(tree);
    expect(line(tree).children).toEqual(["Another Mate already has that name."]);
    expect(field(tree, MATE_FIELD).props["aria-invalid"]).toBe(true);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("waits for every Mate's name to be read before it can create, and says so", () => {
    const tree = mount(projectForm({ takenBotNames: { names: [], complete: false } }));
    type(tree, PROJECT_FIELD, "Acme CRM");
    expect(createButton(tree).props.disabled).toBe(true);
    expect(line(tree).children).toEqual(["Checking which names are taken…"]);
  });

  // Run 2 (2026-10-16): a Create greyed out with no reason read as blocked by the credit line.
  it("creates nothing without the project's name", () => {
    const onCreate = vi.fn();
    const tree = mount(projectForm({ onCreate }));
    expect(createButton(tree).props.disabled).toBe(false);
    press(tree);
    expect(onCreate).not.toHaveBeenCalled();
    expect(line(tree).children).toEqual(["Name your project."]);
    expect(field(tree, PROJECT_FIELD).props["aria-invalid"]).toBe(true);
    type(tree, PROJECT_FIELD, "Acme CRM");
    expect(field(tree, PROJECT_FIELD).props["aria-invalid"]).toBeUndefined();
    press(tree);
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  // Run 2 (2026-10-16): the unpressed Create spun for 17 minutes while the dialog read again.
  it("never spins Create before it is pressed, whatever the dialog still reads", () => {
    const busy = (tree: ReactTestRenderer) =>
      createButton(tree).props["aria-busy"] === true ||
      createButton(tree).findAll((node) => node.props["aria-label"] === "Loading").length > 0;
    expect(busy(mount(projectForm({ loading: true })))).toBe(false);
    expect(busy(mount(projectForm({ creating: true })))).toBe(true);
  });

  it("makes one project of one press: once pressed, Create waits for the Mate's view", () => {
    const onCreate = vi.fn();
    const tree = mount(projectForm({ creating: true, onCreate }));
    type(tree, PROJECT_FIELD, "Acme CRM");
    expect(createButton(tree).props.disabled).toBe(true);
    press(tree);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("gives Cancel back to its host", () => {
    const onCancel = vi.fn();
    const tree = mount(projectForm({ onCancel }));
    act(() => {
      host(tree, (node) => node.type === "button" && spoken(node) === "Cancel").props.onClick({
        nativeEvent: {},
        preventDefault: () => {},
        stopPropagation: () => {},
      });
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

// Board D1, 2026-09-30: the dialog ends with what happens next — the project and its Mate, then
// the person signs it in.
/** An organization of eighteen as the draft reads it: you, sixteen admins, and Karlos. */
function eighteen() {
  const member = (id: string, fullName: string, roleCode: string) => ({
    id: `cu-${id}`,
    status: "ACTIVE",
    roleCode,
    user: { id: `u-${id}`, fullName },
  });
  const list = [
    member("me", "Mia Moss", "ADMIN"),
    ...Array.from({ length: 16 }, (_, index) =>
      member(`p${String(index)}`, `Person ${String(index)}`, "ADMIN"),
    ),
    member("karlos", "Karlos", "BASIC_USER"),
  ];
  return draftView({
    members: { known: true, status: "ready", refused: false, list },
    kind: "mate",
    app: { projects: [], grants: {}, owners: {} },
    pictures: {},
    creator: { membershipId: "cu-me", userId: "u-me" },
    list: [],
  });
}

describe("ZeropsNewProjectForm — who can open the project", () => {
  it("the new project dialog says who can open the project in one line, and opens the full list to change it", () => {
    const view = eighteen();
    const summary = draftSummary({ view, organization: "Mate s.r.o.", prefill: [], list: [] });
    if (summary === null) throw new Error("the people are not read");
    const tree = mount(
      projectForm({
        access: () => (
          <AccessDraftFold label="Project access" summary={summary}>
            {/* The chips stand in as their list: Base UI's tooltips need a document. */}
            <ul aria-label="Project access">
              {view.kind === "people"
                ? view.people.map((person) => <li key={person.key}>{person.short}</li>)
                : null}
            </ul>
          </AccessDraftFold>
        ),
      }),
    );
    const chips = () =>
      tree.root.findAll(
        (node) => node.props["aria-label"] === "Project access" && node.type === "ul",
      );
    expect(spoken(host(tree, (node) => node.props["data-zerops-access"] === "line"))).toBe(
      "Everyone in Mate s.r.o. can open it: 17 with Full access, Karlos with Edit access.",
    );
    expect(chips()).toHaveLength(0);
    const change = host(
      tree,
      (node) => node.type === "button" && spoken(node) === "Change who can open it",
    );
    act(() => {
      change.props.onClick();
    });
    expect(chips()[0]?.findAll((node) => node.type === "li")).toHaveLength(18);
  });
});

describe("ZeropsNewProjectForm — what happens next", () => {
  it("says the project and its Mate come up, then the person signs it in", () => {
    const tree = mount(projectForm());
    type(tree, PROJECT_FIELD, "Acme Shop");
    type(tree, MATE_FIELD, "Vera");
    expect(nextSteps(tree)).toEqual([
      ["Acme Shop and Vera come up", "about 2–4 min"],
      ["You sign Vera in with your Claude or ChatGPT subscription", ""],
      ["You tell Vera what to build", ""],
    ]);
  });
});

describe("ZeropsNewProjectForm — where nothing can be created", () => {
  it("says why in the form's place, and offers only Close", () => {
    const onCreate = vi.fn();
    const tree = mount(
      projectForm({ closed: "Only the organization's owners add projects.", onCreate }),
    );
    expect(spoken(host(tree, (node) => node.props["data-slot"] === "dialog-description"))).toBe(
      "Only the organization's owners add projects.",
    );
    expect(tree.root.findAll((node) => node.type === "input")).toEqual([]);
    expect(
      tree.root
        .findAll((node) => node.type === "button" && node.props.role !== "radio")
        .map((node) => spoken(node)),
    ).toEqual(["Close"]);
    press(tree);
    expect(onCreate).not.toHaveBeenCalled();
  });
});
