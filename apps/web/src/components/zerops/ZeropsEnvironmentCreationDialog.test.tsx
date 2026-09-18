import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ZeropsEnvironmentCreationForm } from "./ZeropsEnvironmentCreationDialog";

function render(props: Partial<Parameters<typeof ZeropsEnvironmentCreationForm>[0]> = {}) {
  return renderToStaticMarkup(
    <ZeropsEnvironmentCreationForm
      defaultBotName="Otto"
      defaultName="Acme Docs - stage"
      defaultWithAgent
      groupName="Acme Docs"
      onCancel={() => {}}
      onCreate={() => {}}
      role="stage"
      takenBotNames={["Fen"]}
      tier={{
        kind: "tier",
        tier: "stage",
        yaml: "services:\n  - hostname: app\n    startWithoutCode: true\n",
        sources: { app: { repository: "https://gitea.test/acme/app", setup: "app" } },
      }}
      tierLoading={false}
      tierServices={["app", "db"]}
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

  it("calls a dev environment a Mate, as the product does", () => {
    const html = render({ role: "dev", defaultName: "Acme Docs - Otto" });
    expect(html).toContain("Add Mate to Acme Docs");
    expect(html).toContain("The project&#x27;s Mate recipe");
    expect(html).not.toContain("dev ");
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
