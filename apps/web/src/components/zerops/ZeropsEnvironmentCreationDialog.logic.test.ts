import { describe, expect, it } from "vite-plus/test";

import {
  hasCreationErrors,
  proposedEnvironmentName,
  recipeOptions,
  validateBotName,
  validateCreationForm,
  type RecipeOption,
} from "./ZeropsEnvironmentCreationDialog.logic";

/** The account's Mates' names, read in full. */
const FEN_TAKEN = { names: ["Fen"], complete: true };
const NONE_TAKEN = { names: [], complete: true };

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
      roleLabel: "stage",
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
    const options = recipeOptions({ roleLabel: "stage", tier: TIER, services: ["app", "db"] });
    expect(options[0]?.detail).toBe("app, db · imported without code; the first deploy fills them");
  });

  it("explains a project with no recipe rather than showing a lone option", () => {
    const options = recipeOptions({ roleLabel: "Mate", tier: undefined, services: [] });
    expect(options.map((option) => option.id)).toEqual(["none"]);
    expect(options[0]?.detail).toBe(
      "This project has no recipe on main yet. The agent sets the application up.",
    );
  });

  it("still names the recipe when the tier declares no services", () => {
    const options = recipeOptions({ roleLabel: "Mate", tier: TIER, services: [] });
    expect(options[0]?.detail).toBe("From the project's repository, on main.");
  });
});

describe("validateBotName", () => {
  it.each<{
    readonly name: string;
    readonly value: string;
    readonly taken: { readonly names: ReadonlyArray<string>; readonly complete: boolean };
    readonly current?: string;
    readonly verdict: string | undefined;
  }>([
    {
      name: "an unread listing never reads as no names taken",
      value: "Ada",
      taken: { names: [], complete: false },
      verdict: "Checking which names are taken…",
    },
    {
      name: "a name read as taken is refused while the rest are read",
      value: "fen",
      taken: { names: ["Fen"], complete: false },
      verdict: "fen is already an agent on this account.",
    },
    {
      name: "a name missing from a partial listing may still be taken",
      value: "Ada",
      taken: { names: ["Fen"], complete: false },
      verdict: "Checking which names are taken…",
    },
    {
      name: "a name missing from a complete listing is free",
      value: "Ada",
      taken: { names: ["Fen"], complete: true },
      verdict: undefined,
    },
    {
      name: "the Mate's own name stays its own while the rest are read",
      value: "Fen",
      taken: { names: ["Fen"], complete: false },
      current: "Fen",
      verdict: undefined,
    },
    {
      name: "an empty name is refused before anything is read",
      value: " ",
      taken: { names: [], complete: false },
      verdict: "Give the agent a name.",
    },
  ])("$name", ({ value, taken, current, verdict }) => {
    expect(validateBotName(value, taken, current === undefined ? {} : { current })).toBe(verdict);
  });
});

describe("validateCreationForm", () => {
  const options: ReadonlyArray<RecipeOption> = recipeOptions({
    roleLabel: "stage",
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
      hasCreationErrors(validateCreationForm(valid, { takenBotNames: FEN_TAKEN, options })),
    ).toBe(false);
  });

  it("wants a name for the environment", () => {
    expect(
      validateCreationForm({ ...valid, name: " " }, { takenBotNames: NONE_TAKEN, options }).name,
    ).toBe("Give the environment a name.");
  });

  it("wants a name for the agent, short and unused", () => {
    expect(
      validateCreationForm({ ...valid, botName: "" }, { takenBotNames: NONE_TAKEN, options })
        .botName,
    ).toBe("Give the agent a name.");
    expect(
      validateCreationForm(
        { ...valid, botName: "x".repeat(25) },
        { takenBotNames: NONE_TAKEN, options },
      ).botName,
    ).toContain("24");
    expect(
      validateCreationForm({ ...valid, botName: "fen" }, { takenBotNames: FEN_TAKEN, options })
        .botName,
    ).toContain("already");
  });

  it("waits for the rest of the listing before a name it has not read passes as free", () => {
    expect(
      validateCreationForm(valid, {
        takenBotNames: { names: ["Fen"], complete: false },
        options,
      }).botName,
    ).toBe("Checking which names are taken…");
  });

  it("does not care about the agent's name when there is no agent", () => {
    const errors = validateCreationForm(
      { ...valid, withAgent: false, botName: "" },
      { takenBotNames: NONE_TAKEN, options },
    );
    expect(errors.botName).toBeUndefined();
  });

  it("refuses nothing yet without an agent, and names a way out", () => {
    const errors = validateCreationForm(
      { ...valid, withAgent: false, recipeId: "none" },
      { takenBotNames: NONE_TAKEN, options },
    );
    expect(errors.recipe).toContain("switch the agent on");
  });

  it("refuses an option that is not on offer", () => {
    expect(
      validateCreationForm({ ...valid, recipeId: "store" }, { takenBotNames: NONE_TAKEN, options })
        .recipe,
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
        { takenBotNames: NONE_TAKEN, options },
      ).recipe,
    ).toBe("This project has no recipe on main yet. Merge one first, or switch the agent on.");
  });

  it("says to take the recipe when there is one", () => {
    const options = recipeOptions({ roleLabel: "Prod", tier: TIER, services: ["app"] });
    expect(
      validateCreationForm(
        { name: "Acme - production", withAgent: false, botName: "", recipeId: "none" },
        { takenBotNames: NONE_TAKEN, options },
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
