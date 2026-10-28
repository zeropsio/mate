// @vitest-environment happy-dom
import { hqOfferWords } from "@t3tools/client-runtime/zerops/hq";
import { hqOffer, type HqOffers } from "@t3tools/shared/hqOffers";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { Dialog } from "../ui/dialog";
import {
  ZeropsEnvironmentCreationForm,
  type EnvironmentCreationChoice,
} from "./ZeropsEnvironmentCreationDialog";

const CHOSEN = [{ clientUserId: "cu-ada", roleCode: "READ_ONLY" }] as const;

/** A draft standing in for the account's (`ProjectAccessDraft`): it says its list once drawn. */
function Chosen({ onChange }: { onChange: (list: typeof CHOSEN) => void }) {
  useEffect(() => onChange(CHOSEN), [onChange]);
  return <ul aria-label="Chosen access" />;
}

let root: Root | undefined;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
});
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  host.remove();
  vi.unstubAllGlobals();
});
function render(
  props: Partial<Parameters<typeof ZeropsEnvironmentCreationForm>[0]> = {},
  destination = false,
) {
  // The title and the way out are Base UI's, and both need the root's context.
  root ??= createRoot(host);
  act(() =>
    root!.render(
      <Dialog open onOpenChange={() => {}}>
        <ZeropsEnvironmentCreationForm
          defaultName="Acme Docs - stage"
          defaultTintFor={() => "violet"}
          defaultWithAgent
          groupName="Acme Docs"
          onCancel={() => {}}
          onCreate={() => {}}
          role="stage"
          takenBotNames={{ names: ["Fen"], complete: true }}
          tier={{
            kind: "tier",
            tier: "stage",
            yaml: "services:\n  - hostname: app\n    startWithoutCode: true\n",
          }}
          recipe="present"
          tierServices={["app", "db"]}
          {...props}
        />
      </Dialog>,
    ),
  );
  // A stage's or a production's own form is the sheet's quiet way out.
  if (props.git === undefined && props.role !== "dev" && !destination) {
    act(() =>
      [...document.querySelectorAll("button")]
        .find(
          (button) =>
            button.textContent ===
            (props.role === "prod" ? "Change its name…" : "Change its name or services…"),
        )!
        .click(),
    );
  }
  return document.body.innerHTML;
}

/** Whether the form's submit button is disabled, as the markup draws it. */
function submitDisabled(html: string): boolean {
  const button = html.match(/<button[^>]*type="submit"[^>]*>/u)?.[0];
  if (button === undefined) throw new Error("no submit button");
  return /\sdisabled(=""|\s|>)/u.test(button);
}

describe("ZeropsEnvironmentCreationForm", () => {
  // D3: one name, its project's — an agent in it goes by it too, with no name of its own.
  it("prefills the environment from the role and the group, and asks no agent's name", () => {
    const html = render();
    expect(html).toContain('value="Acme Docs - stage"');
    expect(html).not.toContain("Agent's name");
    expect(html).not.toContain("Mate's name");
    expect(html).toContain("Add stage to Acme Docs");
  });

  it("hands a Mate to a form of its own: who it is, its project named as it is", () => {
    const html = render({ role: "dev", defaultName: "Otto" });
    expect(html).toContain('data-zerops-surface="new-mate-form"');
    expect(html).toContain(">Add a project Mate to Acme Docs<");
    expect(html).toContain("Add Otto to Acme Docs");
    expect(html).not.toContain("Environment");
    expect(html).not.toContain("Starts with");
  });

  it("The New Mate form says what a Mate costs: its own computer, billed by Zerops by use, Zerops's prices a link away", () => {
    render({ role: "dev", defaultName: "Nova" });
    const line = document.querySelector("[data-zerops-mate-cost]");
    expect(line?.textContent).toBe(
      "Nova runs on its own computer, which Zerops bills by use while it runs. Zerops pricing",
    );
    expect(line?.querySelector("a")?.getAttribute("href")).toBe("https://zerops.io/pricing");
  });

  it("keeps a stage's own form, its title naming the role", () => {
    const html = render();
    expect(html).toContain(">New stage environment<");
    expect(html).not.toContain('data-zerops-surface="new-mate-form"');
  });

  it("offers the project's own recipe, and nothing yet", () => {
    const html = render();
    expect(html).toContain("Same services as the project");
    expect(html).toContain("app, db");
    expect(html).toContain("Empty");
  });

  it("offers only an empty environment when HQ says nothing is merged on main", () => {
    const html = render({ tier: undefined, tierServices: [], recipe: "absent" });
    expect(html).not.toContain("Same services as the project");
    expect(html).toContain("no setup files yet");
    expect(submitDisabled(html)).toBe(false);
  });

  // F9 (e2e, 2026-10-03): for a minute after the page opened, Add production said "no recipe on
  // main yet" and refused a press, then switched to the recipe by itself.
  it("says it is still reading the recipe, never that there is none, and waits for it", () => {
    const html = render({ tier: undefined, tierServices: [], recipe: "reading" });
    expect(html).toContain("Reading the project's setup files…");
    expect(html).not.toContain("no setup files yet");
    expect(submitDisabled(html)).toBe(true);
  });

  it("says a recipe it could not read, offers to read it again, and waits for it", () => {
    const html = render({
      tier: undefined,
      tierServices: [],
      recipe: "unreadable",
      onRecipeRetry: () => {},
    });
    expect(html).toContain("The project's setup files can't be read right now.");
    expect(html).toContain("Try again");
    expect(html).not.toContain("no setup files yet");
    expect(submitDisabled(html)).toBe(true);
  });

  it("The person creating production is told that its services come with the first release", () => {
    const html = render({ role: "prod", defaultWithAgent: false });
    expect(html).toContain("Its services arrive with the first approved release.");
    expect(host.querySelector('[role="switch"]')).toBeNull();
    expect(host.querySelector('[aria-label="Starts with"]')).toBeNull();
  });

  it("asks who will reach the stage, and adds it with the access chosen", () => {
    const made: Array<EnvironmentCreationChoice> = [];
    const html = render({
      access: (onChange) => <Chosen onChange={onChange} />,
      onCreate: (choice) => made.push(choice),
    });
    // The access names its own section (`ProjectAccessDraft`): the dialog draws it whole.
    expect(html).toContain('aria-label="Chosen access"');
    act(() =>
      host
        .querySelector('form[data-zerops-surface="environment-creation-form"]')!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(made.map(({ userRoles }) => userRoles)).toEqual([CHOSEN]);
  });

  it("shows no errors before the first submit", () => {
    expect(render({ defaultName: "" })).not.toContain("Give the environment a name.");
  });
});

it("offers Git without a recipe when HQ authorizes while Zerops stays the default", () => {
  const html = render({
    recipe: "absent",
    tier: undefined,
    tierServices: [],
    git: {
      repos: [],
      takenNames: [],
      offered: { add: true, connect: true, replace: true },
      setup: {
        connect: async () => ({ ok: false, reason: "refused" }),
        preview: async () => [],
        add: async () => {},
      },
      onAdded: () => {},
    },
  });
  expect(html).toContain("Use a branch in your Git repository instead…");
  expect(html).toContain("A separate copy of");
  expect(html).not.toContain('data-zerops-surface="git-environment-form"');
});

it("Adding a stage is one sheet: what it is for, where, and one button", () => {
  const onCreate = vi.fn();
  const html = render({ onCreate }, true);
  expect(html).toContain("Add a stage to Acme Docs");
  expect(html).toContain("A place to try merged changes before they go live.");
  expect(html).toContain("Acme Docs - stage");
  // Nothing it knows is asked: no name, agent or application fields.
  expect(
    host.ownerDocument.querySelectorAll('[role="dialog"] input:not([type="hidden"])'),
  ).toHaveLength(0);
  act(() =>
    [...document.querySelectorAll("button")]
      .find((button) => button.textContent === "Add stage")!
      .click(),
  );
  expect(onCreate).toHaveBeenCalledWith({
    name: "Acme Docs - stage",
    withAgent: true,
    recipe: {
      kind: "tier",
      tier: "stage",
      yaml: "services:\n  - hostname: app\n    startWithoutCode: true\n",
    },
  });
});

it.each(["reading", "unreadable", "absent", "present"] as const)(
  "Production reserves its project and access before its recipe is available: %s",
  (recipe) => {
    const onCreate = vi.fn();
    const html = render(
      {
        role: "prod",
        recipe,
        tier: undefined,
        onCreate,
        people: { kind: "ready", userRoles: CHOSEN },
      },
      true,
    );
    expect(html).toContain("Its services arrive with the first approved release.");
    const button = [...document.querySelectorAll("button")].find(
      (entry) => entry.textContent === "Set up production",
    )!;
    expect(button.hasAttribute("disabled")).toBe(false);
    act(() => button.click());
    expect(onCreate).toHaveBeenCalledWith({
      name: "Acme Docs - stage",
      withAgent: false,
      recipe: { kind: "none" },
      userRoles: CHOSEN,
    });
  },
);

it.each(["reading", "failed"] as const)(
  "Production waits for its access and keeps the grants when they arrive: %s",
  (kind) => {
    const onCreate = vi.fn();
    render({ role: "prod", recipe: "unreadable", people: { kind }, onCreate }, true);
    const submit = () =>
      [...document.querySelectorAll("button")].find(
        (entry) => entry.textContent === "Set up production",
      )!;
    expect(submit().hasAttribute("disabled")).toBe(true);
    expect(onCreate).not.toHaveBeenCalled();
    render(
      {
        role: "prod",
        recipe: "unreadable",
        people: { kind: "ready", userRoles: CHOSEN },
        onCreate,
      },
      true,
    );
    expect(submit().hasAttribute("disabled")).toBe(false);
    act(() => submit().click());
    expect(onCreate).toHaveBeenCalledWith({
      name: "Acme Docs - stage",
      withAgent: false,
      recipe: { kind: "none" },
      userRoles: CHOSEN,
    });
  },
);

it("Production's own form reserves the chosen name and access without its recipe", () => {
  const onCreate = vi.fn();
  render({
    role: "prod",
    recipe: "unreadable",
    tier: undefined,
    onCreate,
    access: (onChange) => <Chosen onChange={onChange} />,
  });
  act(() =>
    host
      .querySelector('form[data-zerops-surface="environment-creation-form"]')!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(onCreate).toHaveBeenCalledWith({
    name: "Acme Docs - stage",
    withAgent: false,
    recipe: { kind: "none" },
    userRoles: CHOSEN,
  });
});

const gitChoice = () =>
  [...document.querySelectorAll("button")].find(
    (button) => button.textContent === "Use a branch in your Git repository instead…",
  );

function gitAuthority(can: HqOffers | undefined, current = true) {
  const add = hqOffer(can, "add_git_environment", {
    current,
    unavailableSince: current ? null : 0,
  });
  return {
    repos: [],
    takenNames: [],
    offered: { add: add.kind === "allowed", connect: false, replace: false },
    unavailableReason: hqOfferWords(add, { at: () => "12:00", rolesAnsweredAt: null }),
    setup: {
      connect: async () => ({ ok: false as const, reason: "refused" }),
      preview: async () => [],
      add: async () => {},
    },
    onAdded: () => {},
  };
}

it.each([
  {
    situation: "a developer cannot add a Git production",
    can: { add_git_environment: { allow: false, reason: "not_structure_writer" } },
    current: true,
    reason: "Only an owner or admin of the organization can do this.",
  },
  {
    situation: "HQ has not answered Git production setup",
    can: undefined,
    current: true,
    reason: "HQ has not said yet.",
  },
  {
    situation: "HQ stopped answering Git production setup",
    can: { add_git_environment: { allow: true } },
    current: false,
    reason: "HQ unavailable since 12:00.",
  },
])("says why the Git choice is unavailable when $situation", ({ can, current, reason }) => {
  const html = render({ role: "prod", git: gitAuthority(can, current) });
  expect(html).toContain(reason);
  expect(gitChoice()?.hasAttribute("disabled")).toBe(true);
});

it("updates the Git choice's reason when HQ refuses setup after the form opens", () => {
  const initial = render({
    role: "prod",
    git: gitAuthority({ add_git_environment: { allow: true } }),
  });
  expect(initial).not.toContain("Only an owner or admin of the organization can do this.");
  const html = render({
    role: "prod",
    git: gitAuthority({ add_git_environment: { allow: false, reason: "not_structure_writer" } }),
  });
  expect(html).toContain("Only an owner or admin of the organization can do this.");
  expect(gitChoice()?.hasAttribute("disabled")).toBe(true);
});
