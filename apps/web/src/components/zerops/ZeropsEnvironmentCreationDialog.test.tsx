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
        tierLoading={false}
        tierServices={["app", "db"]}
        {...props}
      />
    </Dialog>,
  );
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

  it("offers only an empty environment when nothing is merged on main", () => {
    const html = render({ tier: undefined, tierServices: [] });
    expect(html).not.toContain("stage recipe");
    expect(html).toContain("no recipe on main yet");
  });

  it("says it is still reading the recipe", () => {
    expect(render({ tier: undefined, tierServices: [], tierLoading: true })).toContain(
      "Reading the project&#x27;s recipe",
    );
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

// A registration the platform refused is said in the dialog, which offers the Mate to open: it
// runs, and an owner registers it (pass 28 review).
describe("ZeropsEnvironmentCreationForm while it presses", () => {
  const steps = [
    { label: "Container", state: "done" as const },
    { label: "Closed off", state: "done" as const },
    { label: "Registered", state: "failed" as const },
  ];

  it("says a refused registration and offers the Mate to open", () => {
    const html = render({
      pressing: {
        name: "Ada",
        steps,
        notice: "Ada is running. An owner needs to register it before it can use Git.",
        onOpen: () => {},
      },
    });
    expect(html).toContain("Ada is running. An owner needs to register it before it can use Git.");
    expect(html).toContain("Open Ada");
    expect(html).not.toContain("Try again");
  });

  it("asks to be kept open while it runs, with nothing to press", () => {
    const html = render({ pressing: { name: "Ada", steps: steps.slice(0, 2) } });
    expect(html).toContain("Keep this open for about half a minute");
    expect(html).not.toContain("Open Ada");
  });
});
