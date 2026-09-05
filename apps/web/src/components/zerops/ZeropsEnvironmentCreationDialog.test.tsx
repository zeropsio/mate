import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ZeropsEnvironmentCreationForm } from "./ZeropsEnvironmentCreationDialog";

function render(props: Partial<Parameters<typeof ZeropsEnvironmentCreationForm>[0]> = {}) {
  return renderToStaticMarkup(
    <ZeropsEnvironmentCreationForm
      cloneSources={[
        {
          projectId: "p1",
          name: "acme-docs-dev",
          agentName: "Fen",
          services: ["app", "db"],
          builtFromGit: [],
          yaml: "services:\n  - hostname: app\n",
        },
      ]}
      cloneSourcesLoading={false}
      defaultBotName="Otto"
      defaultName="Acme Docs - stage"
      defaultWithAgent
      groupName="Acme Docs"
      onCancel={() => {}}
      onCreate={() => {}}
      role="stage"
      storeRecipeAvailable={false}
      takenBotNames={["Fen"]}
      {...props}
    />,
  );
}

describe("ZeropsEnvironmentCreationForm", () => {
  it("prefills the environment and the agent from the role and the group", () => {
    const html = render();
    expect(html).toContain('value="Acme Docs - stage"');
    expect(html).toContain('value="Otto"');
    expect(html).toContain("Add stage to Acme Docs");
  });

  it("offers a sibling to clone, and nothing yet", () => {
    const html = render();
    expect(html).toContain("Clone Fen (acme-docs-dev)");
    expect(html).toContain("app, db");
    expect(html).toContain("Nothing yet");
    expect(html).not.toContain("The group&#x27;s stage recipe");
  });

  it("offers the group's own recipe when the store has one", () => {
    expect(render({ storeRecipeAvailable: true })).toContain("stage recipe");
  });

  it("says it is still reading the siblings", () => {
    expect(render({ cloneSources: [], cloneSourcesLoading: true })).toContain(
      "Reading the group&#x27;s environments",
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
