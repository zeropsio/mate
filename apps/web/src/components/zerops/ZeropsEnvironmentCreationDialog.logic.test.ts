import type { MateShapeId, MateTintId } from "@t3tools/shared/brand";
import { describe, expect, it } from "vite-plus/test";

import {
  faceName,
  hasCreationErrors,
  newMateFace,
  newMateRecipe,
  newMateSubmit,
  newMateWords,
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

/** A name's own tint as the account would give it: fixed per name here, so each case reads. */
const TINTS: Readonly<Record<string, MateTintId>> = { Quinn: "olive", Ada: "sky", Otto: "violet" };
const defaultTint = (name: string): MateTintId => TINTS[name] ?? "slate";

describe("newMateFace — the face follows the name until its person picks", () => {
  it.each<{
    readonly case: string;
    readonly name: string;
    readonly picked: { readonly tint?: MateTintId; readonly shape?: MateShapeId };
    readonly face: { readonly tint: MateTintId; readonly shape: MateShapeId };
  }>([
    {
      case: "nothing picked: the name's tint and that tint's shape",
      name: "Quinn",
      picked: {},
      face: { tint: "olive", shape: "clover" },
    },
    {
      case: "nothing picked, another name: its own face",
      name: "Ada",
      picked: {},
      face: { tint: "sky", shape: "pick" },
    },
    {
      case: "a colour picked: that colour, and its shape until one is picked",
      name: "Quinn",
      picked: { tint: "rose" },
      face: { tint: "rose", shape: "flower" },
    },
    {
      case: "a shape picked: the name's colour still follows the name",
      name: "Ada",
      picked: { shape: "seal" },
      face: { tint: "sky", shape: "seal" },
    },
    {
      case: "both picked: the name moves neither",
      name: "Otto",
      picked: { tint: "amber", shape: "gem" },
      face: { tint: "amber", shape: "gem" },
    },
  ])("$case", ({ name, picked, face }) => {
    expect(newMateFace({ name, picked, defaultTint })).toEqual(face);
  });

  it.each([
    { case: "the name as typed", typed: "  Ada  ", held: "Quinn", name: "Ada" },
    { case: "the last name while the field is blank", typed: "   ", held: "Quinn", name: "Quinn" },
    { case: "one space between words", typed: "Big   Otto", held: "Quinn", name: "Big Otto" },
  ])("follows $case", ({ typed, held, name }) => {
    expect(faceName(typed, held)).toBe(name);
  });
});

describe("newMateSubmit — what pressing Add does now", () => {
  const TAKEN = { names: ["Fen"], complete: true };
  it.each<{
    readonly case: string;
    readonly botName: string;
    readonly takenBotNames: { readonly names: ReadonlyArray<string>; readonly complete: boolean };
    readonly tier: typeof TIER | undefined;
    readonly tierLoading: boolean;
    readonly submit: ReturnType<typeof newMateSubmit>;
  }>([
    {
      case: "creates it with the project's recipe",
      botName: "Quinn",
      takenBotNames: TAKEN,
      tier: TIER,
      tierLoading: false,
      submit: { kind: "create", recipe: TIER },
    },
    {
      case: "creates it with nothing where the project has no recipe on main",
      botName: "Quinn",
      takenBotNames: TAKEN,
      tier: undefined,
      tierLoading: false,
      submit: { kind: "create", recipe: { kind: "none" } },
    },
    {
      case: "waits while the recipe is read",
      botName: "Quinn",
      takenBotNames: TAKEN,
      tier: undefined,
      tierLoading: true,
      submit: { kind: "wait", on: "recipe" },
    },
    {
      case: "waits while the names are read, the name not among them yet",
      botName: "Quinn",
      takenBotNames: { names: ["Fen"], complete: false },
      tier: TIER,
      tierLoading: false,
      submit: { kind: "wait", on: "names" },
    },
    {
      case: "refuses a blank name before waiting on anything",
      botName: "  ",
      takenBotNames: { names: [], complete: false },
      tier: undefined,
      tierLoading: true,
      submit: { kind: "refuse", error: "Give the Mate a name." },
    },
    {
      case: "refuses a name already taken, even while the rest are read",
      botName: "fen",
      takenBotNames: { names: ["Fen"], complete: false },
      tier: undefined,
      tierLoading: true,
      submit: { kind: "refuse", error: "Another Mate already has that name." },
    },
    {
      case: "refuses a name too long",
      botName: "x".repeat(25),
      takenBotNames: TAKEN,
      tier: TIER,
      tierLoading: false,
      submit: { kind: "refuse", error: "Keep it under 24 characters." },
    },
  ])("$case", ({ botName, takenBotNames, tier, tierLoading, submit }) => {
    expect(newMateSubmit({ botName, takenBotNames, tier, tierLoading })).toEqual(submit);
  });
});

describe("newMateWords — what the Mate's dialog says", () => {
  it.each<{
    readonly case: string;
    readonly input: Parameters<typeof newMateWords>[0];
    readonly words: ReturnType<typeof newMateWords>;
  }>([
    {
      case: "a project with a recipe",
      input: { groupName: "Acme Docs", botName: "Quinn", recipe: "recipe", waitingOn: null },
      words: {
        description:
          "It gets its own copy of Acme Docs with the recipe deployed. It takes a couple of minutes.",
        button: "Add Quinn to Acme Docs",
        line: undefined,
      },
    },
    {
      case: "the recipe still being read",
      input: { groupName: "Acme Docs", botName: "Quinn", recipe: "reading", waitingOn: null },
      words: {
        description:
          "It gets its own copy of Acme Docs with the recipe deployed. It takes a couple of minutes.",
        button: "Add Quinn to Acme Docs",
        line: "Reading the project's recipe…",
      },
    },
    {
      case: "a project with no recipe on main",
      input: { groupName: "Acme Docs", botName: "Quinn", recipe: "none", waitingOn: null },
      words: {
        description:
          "It gets its own copy of Acme Docs. There's no recipe yet, so it sets the application up itself. It takes a couple of minutes.",
        button: "Add Quinn to Acme Docs",
        line: undefined,
      },
    },
    {
      case: "Add pressed while the names are read",
      input: { groupName: "Acme Docs", botName: "Quinn", recipe: "recipe", waitingOn: "names" },
      words: {
        description:
          "It gets its own copy of Acme Docs with the recipe deployed. It takes a couple of minutes.",
        button: "Add Quinn to Acme Docs",
        line: "Checking which names are taken…",
      },
    },
    {
      case: "a blank name",
      input: { groupName: "Acme Docs", botName: "  ", recipe: "recipe", waitingOn: null },
      words: {
        description:
          "It gets its own copy of Acme Docs with the recipe deployed. It takes a couple of minutes.",
        button: "Add a Mate to Acme Docs",
        line: undefined,
      },
    },
  ])("says so for $case", ({ input, words }) => {
    expect(newMateWords(input)).toEqual(words);
  });

  it.each([
    { tier: TIER, tierLoading: false, recipe: "recipe" },
    { tier: undefined, tierLoading: true, recipe: "reading" },
    { tier: undefined, tierLoading: false, recipe: "none" },
  ] as const)("reads the recipe as $recipe", ({ tier, tierLoading, recipe }) => {
    expect(newMateRecipe({ tier, tierLoading })).toBe(recipe);
  });
});
