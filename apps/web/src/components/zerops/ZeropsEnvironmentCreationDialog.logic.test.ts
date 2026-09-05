import { describe, expect, it } from "vite-plus/test";

import {
  hasCreationErrors,
  recipeOptions,
  validateCreationForm,
  type RecipeOption,
} from "./ZeropsEnvironmentCreationDialog.logic";

const SOURCE = {
  projectId: "p1",
  name: "acme-docs-dev",
  agentName: "Fen",
  services: ["app", "db"],
  builtFromGit: [],
  yaml: "services:\n  - hostname: app\n",
};

describe("recipeOptions", () => {
  it("offers the store recipe first, then clones, then nothing yet", () => {
    const options = recipeOptions({
      roleLabel: "Stage",
      storeRecipeAvailable: true,
      sources: [SOURCE],
    });
    expect(options.map((option) => option.id)).toEqual(["store", "clone:p1", "none"]);
    expect(options[0]?.label).toBe("The group's stage recipe");
    expect(options[1]?.label).toBe("Clone Fen (acme-docs-dev)");
    expect(options[1]?.detail).toBe("app, db");
  });

  it("says which cloned services will need a deploy", () => {
    const options = recipeOptions({
      roleLabel: "Dev",
      storeRecipeAvailable: false,
      sources: [{ ...SOURCE, builtFromGit: ["app"] }],
    });
    expect(options[0]?.detail).toBe("app, db · app will need a deploy");
  });

  it("always offers nothing yet, even with no store and no siblings", () => {
    const options = recipeOptions({ roleLabel: "Dev", storeRecipeAvailable: false, sources: [] });
    expect(options.map((option) => option.id)).toEqual(["none"]);
  });

  it("names a sibling by its project when it has no agent", () => {
    const options = recipeOptions({
      roleLabel: "Dev",
      storeRecipeAvailable: false,
      sources: [{ ...SOURCE, agentName: undefined }],
    });
    expect(options[0]?.label).toBe("Clone acme-docs-dev");
  });
});

describe("validateCreationForm", () => {
  const options: ReadonlyArray<RecipeOption> = recipeOptions({
    roleLabel: "Stage",
    storeRecipeAvailable: false,
    sources: [SOURCE],
  });
  const valid = {
    name: "Acme Docs - stage",
    withAgent: true,
    botName: "Otto",
    recipeId: "clone:p1",
  };

  it("accepts a complete form", () => {
    expect(
      hasCreationErrors(validateCreationForm(valid, { takenBotNames: ["Fen"], options })),
    ).toBe(false);
  });

  it("wants a name for the environment", () => {
    expect(validateCreationForm({ ...valid, name: " " }, { takenBotNames: [], options }).name).toBe(
      "Give the environment a name.",
    );
  });

  it("wants a name for the agent, short and unused", () => {
    expect(
      validateCreationForm({ ...valid, botName: "" }, { takenBotNames: [], options }).botName,
    ).toBe("Give the agent a name.");
    expect(
      validateCreationForm({ ...valid, botName: "x".repeat(25) }, { takenBotNames: [], options })
        .botName,
    ).toContain("24");
    expect(
      validateCreationForm({ ...valid, botName: "fen" }, { takenBotNames: ["Fen"], options })
        .botName,
    ).toContain("already");
  });

  it("does not care about the agent's name when there is no agent", () => {
    const errors = validateCreationForm(
      { ...valid, withAgent: false, botName: "" },
      { takenBotNames: [], options },
    );
    expect(errors.botName).toBeUndefined();
  });

  it("refuses nothing yet without an agent", () => {
    const errors = validateCreationForm(
      { ...valid, withAgent: false, recipeId: "none" },
      { takenBotNames: [], options },
    );
    expect(errors.recipe).toContain("needs an application");
  });

  it("refuses an option that is not on offer", () => {
    expect(
      validateCreationForm({ ...valid, recipeId: "store" }, { takenBotNames: [], options }).recipe,
    ).toBe("Choose what goes in the environment.");
  });
});
