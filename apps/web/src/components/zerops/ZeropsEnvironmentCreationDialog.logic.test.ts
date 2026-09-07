import { describe, expect, it } from "vite-plus/test";

import {
  hasCreationErrors,
  proposedEnvironmentName,
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
    expect(options[1]?.detail).toBe("app, db · copied without code; the first deploy fills them");
  });

  /**
   * Measured on the demo: `Shortlink - stage` and `- production` both cloned a
   * dev whose app was deployed by `zerops_deploy`, so `builtFromGit` was empty
   * and nothing was said — and both came up `READY_TO_DEPLOY` with no code.
   * The old note answered "was this built from git"; the reader is asking
   * "will this run when it comes up".
   */
  it("says a clone arrives without code, whatever the source was built by", () => {
    const options = recipeOptions({
      roleLabel: "Stage",
      storeRecipeAvailable: false,
      sources: [SOURCE],
    });
    expect(options[0]?.detail).toBe("app, db · copied without code; the first deploy fills them");
  });

  it("keeps the sharper warning for a service whose build setup cannot be carried", () => {
    const options = recipeOptions({
      roleLabel: "Dev",
      storeRecipeAvailable: false,
      sources: [{ ...SOURCE, builtFromGit: ["app"] }],
    });
    expect(options[0]?.detail).toBe(
      "app, db · copied without code; the first deploy fills them · app builds from a repository, and its build setup is not carried",
    );
  });

  it("explains an empty clone list rather than showing a lone option", () => {
    const options = recipeOptions({ roleLabel: "Dev", storeRecipeAvailable: false, sources: [] });
    expect(options).toHaveLength(1);
    expect(options[0]?.detail).toBe(
      "Nothing in this project has services to copy yet. The agent sets the application up.",
    );
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

  it("refuses nothing yet without an agent, and names a way out", () => {
    const errors = validateCreationForm(
      { ...valid, withAgent: false, recipeId: "none" },
      { takenBotNames: [], options },
    );
    expect(errors.recipe).toContain("switch the agent on");
  });

  it("refuses an option that is not on offer", () => {
    expect(
      validateCreationForm({ ...valid, recipeId: "store" }, { takenBotNames: [], options }).recipe,
    ).toBe("Choose what goes in the environment.");
  });
});

describe("validateCreationForm, on an environment with no agent", () => {
  /**
   * A production is a copy of a dev's services, so it cannot be made until a
   * dev has some. The old message stated the rule and left the reader to
   * deduce the order — measured on the demo, where "Add production" refused
   * on a group whose only Mate had not built anything yet.
   */
  it("says to build something first when the group has nothing to copy", () => {
    const options = recipeOptions({ roleLabel: "Prod", storeRecipeAvailable: false, sources: [] });
    expect(
      validateCreationForm(
        { name: "Acme - production", withAgent: false, botName: "", recipeId: "none" },
        { takenBotNames: [], options },
      ).recipe,
    ).toBe(
      "Nothing in this project has services to copy yet. Build something in a dev environment first, or switch the agent on.",
    );
  });

  it("says to pick one when there is something to copy", () => {
    const options = recipeOptions({
      roleLabel: "Prod",
      storeRecipeAvailable: false,
      sources: [SOURCE],
    });
    expect(
      validateCreationForm(
        { name: "Acme - production", withAgent: false, botName: "", recipeId: "none" },
        { takenBotNames: [], options },
      ).recipe,
    ).toBe("Choose an application to copy, or switch the agent on to have one set up.");
  });
});

describe("proposedEnvironmentName", () => {
  it("names the environment after its role while that name is free", () => {
    expect(proposedEnvironmentName({ groupName: "Shortlink", roleLabel: "dev", taken: [] })).toBe(
      "Shortlink - dev",
    );
  });

  it("numbers the second Mate rather than proposing the first one's name", () => {
    expect(
      proposedEnvironmentName({
        groupName: "Shortlink",
        roleLabel: "dev",
        taken: ["Shortlink - dev"],
      }),
    ).toBe("Shortlink - dev 2");
  });

  it("keeps counting past a run of them", () => {
    expect(
      proposedEnvironmentName({
        groupName: "Shortlink",
        roleLabel: "dev",
        taken: ["Shortlink - dev", "Shortlink - dev 2", "Shortlink - dev 3"],
      }),
    ).toBe("Shortlink - dev 4");
  });

  it("fills a gap left by a deleted environment", () => {
    expect(
      proposedEnvironmentName({
        groupName: "Shortlink",
        roleLabel: "dev",
        taken: ["Shortlink - dev", "Shortlink - dev 3"],
      }),
    ).toBe("Shortlink - dev 2");
  });

  it("reads a taken name regardless of case or padding", () => {
    expect(
      proposedEnvironmentName({
        groupName: "Shortlink",
        roleLabel: "dev",
        taken: ["  SHORTLINK - DEV  "],
      }),
    ).toBe("Shortlink - dev 2");
  });

  it("counts only the role it is naming", () => {
    expect(
      proposedEnvironmentName({
        groupName: "Shortlink",
        roleLabel: "stage",
        taken: ["Shortlink - dev", "Shortlink - dev 2"],
      }),
    ).toBe("Shortlink - stage");
  });
});
