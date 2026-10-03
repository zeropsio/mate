import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { Dialog } from "../ui/dialog";
import { ZeropsEnvironmentCreationForm } from "./ZeropsEnvironmentCreationDialog";

function render(props: Partial<Parameters<typeof ZeropsEnvironmentCreationForm>[0]> = {}) {
  // The title and the way out are Base UI's, and both need the root's context.
  return renderToStaticMarkup(
    <Dialog open onOpenChange={() => {}}>
      <ZeropsEnvironmentCreationForm
        defaultBotName="Otto"
        defaultName="Acme Docs - stage"
        defaultTintFor={() => "violet"}
        defaultWithAgent
        groupName="Acme Docs"
        onCancel={() => {}}
        onCreate={() => {}}
        proposeName={() => "Acme Docs - stage"}
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
  );
}

/** Whether the form's submit button is disabled, as the markup draws it. */
function submitDisabled(html: string): boolean {
  const button = html.match(/<button[^>]*type="submit"[^>]*>/u)?.[0];
  if (button === undefined) throw new Error("no submit button");
  return /\sdisabled(=""|\s|>)/u.test(button);
}

describe("ZeropsEnvironmentCreationForm", () => {
  it("prefills the environment and the agent from the role and the group", () => {
    const html = render();
    expect(html).toContain('value="Acme Docs - stage"');
    expect(html).toContain('value="Otto"');
    expect(html).toContain("Add stage to Acme Docs");
  });

  it("hands a Mate to a form of its own: who it is, and nothing else", () => {
    const html = render({ role: "dev", defaultName: "Acme Docs - Otto" });
    expect(html).toContain('data-zerops-surface="new-mate-form"');
    expect(html).toContain(">New Mate on Acme Docs<");
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
    expect(html).toContain("The project&#x27;s stage recipe");
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
    expect(html).toContain("Reading the project&#x27;s recipe…");
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
    expect(html).toContain("The project&#x27;s recipe can&#x27;t be read right now.");
    expect(html).toContain("Try again");
    expect(html).not.toContain("no recipe on main yet");
    expect(submitDisabled(html)).toBe(true);
  });

  it("hides the agent's name when production runs without one", () => {
    const html = render({ role: "prod", defaultWithAgent: false });
    expect(html).not.toContain("Agent&#x27;s name");
    expect(html).toContain("Production usually does not");
  });

  it("shows no errors before the first submit", () => {
    expect(render({ defaultName: "" })).not.toContain("Give the environment a name.");
  });
});
