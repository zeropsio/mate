import { describe, expect, it } from "vite-plus/test";

import {
  hasCreationErrors,
  proposedEnvironmentName,
  recipeOptions,
  validateCreationForm,
  type RecipeOption,
} from "./ZeropsEnvironmentCreationDialog.logic";

/** A tier as the group repo's `main` hands it over, already import-ready. */
const TIER = {
  kind: "tier" as const,
  tier: "stage" as const,
  yaml: "services:\n  - hostname: app\n    startWithoutCode: true\n",
  sources: { app: { repository: "https://gitea.test/acme/app", setup: "app" } },
};

describe("recipeOptions", () => {
  it("offers the project's recipe first, then nothing yet", () => {
    const options = recipeOptions({
      roleLabel: "Stage",
      tier: TIER,
      services: ["app", "db"],
    });
    expect(options.map((option) => option.id)).toEqual(["tier", "none"]);
    expect(options[0]?.label).toBe("The project's stage recipe");
  });

  /**
   * Every service arrives empty whatever the tier said: the platform cannot
   * clone a private repository, so `importReadyTier` turned each build into
   * `startWithoutCode` and the first deploy is what fills them. Measured on the
   * demo where a stage came up `READY_TO_DEPLOY` and nothing said so.
   */
  it("says the services arrive without code", () => {
    const options = recipeOptions({ roleLabel: "Stage", tier: TIER, services: ["app", "db"] });
    expect(options[0]?.detail).toBe("app, db · imported without code; the first deploy fills them");
  });

  it("explains a project with no recipe rather than showing a lone option", () => {
    const options = recipeOptions({ roleLabel: "Dev", tier: undefined, services: [] });
    expect(options.map((option) => option.id)).toEqual(["none"]);
    expect(options[0]?.detail).toBe(
      "This project has no recipe on main yet. The agent sets the application up.",
    );
  });

  it("still names the recipe when the tier declares no services", () => {
    const options = recipeOptions({ roleLabel: "Dev", tier: TIER, services: [] });
    expect(options[0]?.detail).toBe("From the project's repository, on main.");
  });
});

describe("validateCreationForm", () => {
  const options: ReadonlyArray<RecipeOption> = recipeOptions({
    roleLabel: "Stage",
    tier: TIER,
    services: ["app"],
  });
  const valid = {
    name: "Acme Docs - stage",
    withAgent: true,
    botName: "Otto",
    recipeId: "tier",
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
   * With no recipe on `main` the fix is not in this dialog at all — it is a
   * pull request on the group repo. The old message stated the rule and left
   * the reader to deduce the order.
   */
  it("says to merge a recipe first when the project has none", () => {
    const options = recipeOptions({ roleLabel: "Prod", tier: undefined, services: [] });
    expect(
      validateCreationForm(
        { name: "Acme - production", withAgent: false, botName: "", recipeId: "none" },
        { takenBotNames: [], options },
      ).recipe,
    ).toBe("This project has no recipe on main yet. Merge one first, or switch the agent on.");
  });

  it("says to take the recipe when there is one", () => {
    const options = recipeOptions({ roleLabel: "Prod", tier: TIER, services: ["app"] });
    expect(
      validateCreationForm(
        { name: "Acme - production", withAgent: false, botName: "", recipeId: "none" },
        { takenBotNames: [], options },
      ).recipe,
    ).toBe("Take the project's recipe, or switch the agent on to have one set up.");
  });
});

describe("proposedEnvironmentName", () => {
  it("names a Mate after its bot, not its role", () => {
    expect(
      proposedEnvironmentName({
        groupName: "Todo",
        roleLabel: "dev",
        botName: "Fen",
        taken: ["Todo - dev", "Todo - Vera"],
      }),
    ).toBe("Todo - Fen");
  });

  it("numbers a Mate whose bot's name is taken, and falls back to the role for a blank bot", () => {
    expect(
      proposedEnvironmentName({
        groupName: "Todo",
        roleLabel: "dev",
        botName: "Fen",
        taken: ["todo - fen"],
      }),
    ).toBe("Todo - Fen 2");
    expect(
      proposedEnvironmentName({ groupName: "Todo", roleLabel: "dev", botName: "  ", taken: [] }),
    ).toBe("Todo - dev");
  });

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
