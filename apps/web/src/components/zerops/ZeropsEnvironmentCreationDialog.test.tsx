// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { Dialog } from "../ui/dialog";
import { ZeropsEnvironmentCreationForm } from "./ZeropsEnvironmentCreationDialog";

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
  root = createRoot(host);
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
  if (props.git === undefined && props.role !== "dev" && !destination) {
    act(() =>
      host
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
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
    expect(html).not.toContain("Application");
  });

  it("keeps a stage's own form, its title naming the role", () => {
    const html = render();
    expect(html).toContain(">New stage environment<");
    expect(html).not.toContain('data-zerops-surface="new-mate-form"');
  });

  it("offers the project's own recipe, and nothing yet", () => {
    const html = render();
    expect(html).toContain("The project's stage recipe");
    expect(html).toContain("app, db");
    expect(html).toContain("Nothing yet");
  });

  it("offers only an empty environment when HQ says nothing is merged on main", () => {
    const html = render({ tier: undefined, tierServices: [], recipe: "absent" });
    expect(html).not.toContain("stage recipe");
    expect(html).toContain("no recipe on main yet");
    expect(submitDisabled(html)).toBe(false);
  });

  // F9 (e2e, 2026-10-03): for a minute after the page opened, Add production said "no recipe on
  // main yet" and refused a press, then switched to the recipe by itself.
  it("says it is still reading the recipe, never that there is none, and waits for it", () => {
    const html = render({ tier: undefined, tierServices: [], recipe: "reading" });
    expect(html).toContain("Reading the project's recipe…");
    expect(html).not.toContain("no recipe on main yet");
    expect(submitDisabled(html)).toBe(true);
  });

  it("says a recipe it could not read, offers to read it again, and waits for it", () => {
    const html = render({
      tier: undefined,
      tierServices: [],
      recipe: "unreadable",
      onRecipeRetry: () => {},
    });
    expect(html).toContain("The project's recipe can't be read right now.");
    expect(html).toContain("Try again");
    expect(html).not.toContain("no recipe on main yet");
    expect(submitDisabled(html)).toBe(true);
  });

  it("says why production usually runs no agent", () => {
    const html = render({ role: "prod", defaultWithAgent: false });
    expect(html).toContain("Production usually does not");
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
  expect(html).toContain("Where does it go?");
  expect(html).toContain("A branch in your Git repository");
  expect(html).toContain("A new Zerops project");
  expect(html).not.toContain('data-zerops-surface="git-environment-form"');
});

it("New production starts with only a destination and Continue", () => {
  const html = render({
    role: "prod",
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
  expect(html).toContain("Production is where a release goes");
  expect(html).toContain(">Continue<");
  expect(html).not.toContain('data-zerops-surface="environment-creation-form"');
  expect(html).not.toContain('data-zerops-surface="git-environment-form"');
  expect(html).not.toContain('value="Acme Docs - stage"');
});

it("The destination is the first page while HQ authority is still arriving", () => {
  const html = render({ role: "prod" }, true);
  expect(html).toContain("Where does it go?");
  expect(html).toContain(">Continue<");
  expect(html).not.toContain('data-zerops-surface="environment-creation-form"');
});
