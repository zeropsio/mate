import { flowChanges, type ZeropsOrganizationMember } from "@t3tools/client-runtime/zerops";
import type { MateShapeId, MateTintId } from "@t3tools/shared/brand";
import type { HqChange } from "@t3tools/shared/hqChanges";
import { RECIPE_PROPOSAL_TITLE, RECIPE_REPO } from "@t3tools/shared/hqRecipe";
import { describe, expect, it } from "vite-plus/test";

import {
  creationRecipe,
  environmentSheetSubmit,
  faceName,
  hasCreationErrors,
  newMateDoorTitle,
  newMateFace,
  newMateRecipe,
  newMateSubmit,
  newMateWords,
  PEOPLE_UNREADABLE,
  proposedEnvironmentName,
  READING_PEOPLE,
  recipeChangeView,
  recipeOptions,
  validateBotName,
  validateCreationForm,
  type RecipeOption,
} from "./ZeropsEnvironmentCreationDialog.logic";
import {
  type NewMateDoorAction,
  newMateRecipeChange,
} from "@t3tools/client-runtime/zerops/newMateDoor";
import { draftPeople, type DraftInput } from "./projects/accessDraft.logic";

/** A tier as the group repo's `main` hands it over, already import-ready. */
const TIER = {
  kind: "tier" as const,
  revision: "recipe-revision",
  tier: "stage" as const,
  yaml: "services:\n  - hostname: app\n    startWithoutCode: true\n",
};

describe("recipeOptions", () => {
  it("offers the project's recipe first, then nothing yet", () => {
    const options = recipeOptions({
      roleLabel: "stage",
      tier: TIER,
      services: ["app", "db"],
      recipe: "present",
    });
    expect(options.map((option) => option.id)).toEqual(["tier", "none"]);
    expect(options[0]?.label).toBe("Same services as the project");
    // The platform cannot clone a private repository; the first deploy fills the services.
    expect(options[0]?.detail).toBe("app, db · your code arrives with the first deploy");
  });

  it("explains a project with no recipe rather than showing a lone option", () => {
    const options = recipeOptions({
      roleLabel: "Mate",
      tier: undefined,
      services: [],
      recipe: "absent",
    });
    expect(options.map((option) => option.id)).toEqual(["none"]);
    expect(options[0]?.detail).toBe("This project has no setup files yet. Set it up later.");
  });

  // F9 (e2e, 2026-10-03): a recipe not read yet read as a missing one for a minute.
  it.each(["reading", "unreadable"] as const)(
    "never says there is no recipe while it is %s",
    (recipe) => {
      const options = recipeOptions({
        roleLabel: "production",
        tier: undefined,
        services: [],
        recipe,
      });
      expect(options[0]?.detail).toBe("Set it up later.");
    },
  );

  it("still names the recipe when the tier declares no services", () => {
    const options = recipeOptions({
      roleLabel: "Mate",
      tier: TIER,
      services: [],
      recipe: "present",
    });
    expect(options[0]?.detail).toBe("As the project's setup files describe them.");
  });
});

describe("validateBotName — under an application", () => {
  const taken = { names: ["Fen"], complete: true };

  it.each([
    { value: "SPN - Fen", verdict: "Fen is already an agent on this account." },
    { value: "Fen", verdict: "Fen is already an agent on this account." },
    // Another application's prefix is part of the name: its own name, whole.
    { value: "Shop - Fen", verdict: undefined },
    { value: "SPN - Ada", verdict: undefined },
  ])("judges $value by its own name under SPN", ({ value, verdict }) => {
    expect(validateBotName(value, taken, { appName: "SPN" })).toBe(verdict);
  });

  it("refuses a typed prefix of a Mate that exists when a Mate is added", () => {
    expect(
      newMateSubmit({
        botName: "SPN - Fen",
        appName: "SPN",
        takenBotNames: taken,
        tier: undefined,
        tierLoading: false,
      }),
    ).toEqual({ kind: "refuse", error: "Another Mate already has that name." });
  });

  it("keeps a Mate's current name whole when it is stale-prefixed and long", () => {
    const current = "Old - A Mate With A Very Long Name";
    expect(validateBotName(current, taken, { appName: "SPN", current })).toBeUndefined();
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
      name: "the name a Mate already has stays its own, however long",
      value: "Old - A Mate With A Very Long Name",
      taken: { names: [], complete: true },
      current: "Old - A Mate With A Very Long Name",
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
    recipe: "present",
  });
  const valid = { name: "Acme Docs - stage", withAgent: true, recipeId: "tier" };

  it("accepts a complete form", () => {
    expect(hasCreationErrors(validateCreationForm(valid, { options, recipe: "present" }))).toBe(
      false,
    );
  });

  // D3: one name, the project's, whether an agent runs in it or not.
  it.each([true, false])("wants a name for the environment, the agent %s", (withAgent) => {
    expect(
      validateCreationForm({ ...valid, withAgent, name: " " }, { options, recipe: "present" }).name,
    ).toBe("Give the environment a name.");
  });

  it("refuses nothing yet without an agent, and names a way out", () => {
    const errors = validateCreationForm(
      { ...valid, withAgent: false, recipeId: "none" },
      { options, recipe: "present" },
    );
    expect(errors.recipe).toContain("give it its own Mate");
  });

  it("refuses an option that is not on offer", () => {
    expect(
      validateCreationForm({ ...valid, recipeId: "store" }, { options, recipe: "present" }).recipe,
    ).toBe("Choose what goes in the environment.");
  });
});

describe("validateCreationForm, on an environment with no agent", () => {
  /**
   * With no recipe on `main` the fix is not in this dialog at all — it is a
   * pull request on the group repo. The old message stated the rule and left
   * the reader to deduce the order.
   */
  // F9: only HQ answering "none" says there is no recipe; a read not back yet, or one that failed,
  // says so, and holds the form whatever is chosen.
  it.each([
    {
      recipe: "absent",
      withAgent: false,
      says: "This project has no setup files yet. Merge its setup change first, or give it its own Mate.",
    },
    { recipe: "reading", withAgent: false, says: "Reading the project's setup files…" },
    { recipe: "reading", withAgent: true, says: "Reading the project's setup files…" },
    {
      recipe: "unreadable",
      withAgent: false,
      says: "The project's setup files can't be read right now.",
    },
    {
      recipe: "unreadable",
      withAgent: true,
      says: "The project's setup files can't be read right now.",
    },
  ] as const)(
    "with the recipe $recipe, the agent $withAgent: $says",
    ({ recipe, withAgent, says }) => {
      const options = recipeOptions({ roleLabel: "Prod", tier: undefined, services: [], recipe });
      expect(
        validateCreationForm(
          { name: "Acme - production", withAgent, recipeId: "none" },
          { options, recipe },
        ).recipe,
      ).toBe(says);
    },
  );

  it("says to take the recipe when there is one", () => {
    const options = recipeOptions({
      roleLabel: "Prod",
      tier: TIER,
      services: ["app"],
      recipe: "present",
    });
    expect(
      validateCreationForm(
        { name: "Acme - production", withAgent: false, recipeId: "none" },
        { options, recipe: "present" },
      ).recipe,
    ).toBe("Start with the project's services, or give it its own Mate to set them up.");
  });
});

describe("creationRecipe — where the project's recipe stands for the creation forms", () => {
  it.each([
    { state: "loading", loading: true, recipe: "reading" },
    // A dialog opened again says what the last read said, and waits for this one.
    { state: "present", loading: true, recipe: "reading" },
    { state: "absent", loading: true, recipe: "reading" },
    { state: "present", loading: false, recipe: "present" },
    { state: "absent", loading: false, recipe: "absent" },
    { state: "unreadable", loading: false, recipe: "unreadable" },
  ] as const)("$state, loading $loading: $recipe", ({ state, loading, recipe }) => {
    expect(creationRecipe({ state, loading })).toBe(recipe);
  });
});

describe("proposedEnvironmentName", () => {
  it("names the environment after its role while that name is free", () => {
    expect(proposedEnvironmentName({ groupName: "Shortlink", roleLabel: "stage", taken: [] })).toBe(
      "Shortlink - stage",
    );
  });

  it("numbers the second stage rather than proposing the first one's name", () => {
    expect(
      proposedEnvironmentName({
        groupName: "Shortlink",
        roleLabel: "stage",
        taken: ["Shortlink - stage"],
      }),
    ).toBe("Shortlink - stage 2");
  });

  it("keeps counting past a run of them", () => {
    expect(
      proposedEnvironmentName({
        groupName: "Shortlink",
        roleLabel: "stage",
        taken: ["Shortlink - stage", "Shortlink - stage 2", "Shortlink - stage 3"],
      }),
    ).toBe("Shortlink - stage 4");
  });

  it("fills a gap left by a deleted environment", () => {
    expect(
      proposedEnvironmentName({
        groupName: "Shortlink",
        roleLabel: "stage",
        taken: ["Shortlink - stage", "Shortlink - stage 3"],
      }),
    ).toBe("Shortlink - stage 2");
  });

  it("reads a taken name regardless of case or padding", () => {
    expect(
      proposedEnvironmentName({
        groupName: "Shortlink",
        roleLabel: "stage",
        taken: ["  SHORTLINK - STAGE  "],
      }),
    ).toBe("Shortlink - stage 2");
  });

  it("counts only the role it is naming", () => {
    expect(
      proposedEnvironmentName({
        groupName: "Shortlink",
        roleLabel: "stage",
        taken: ["Shortlink - production", "Shortlink - production 2"],
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

  // Run 6's second review: Start over brought the colour back, never the shape.
  it.each<{
    readonly case: string;
    readonly name: string;
    readonly picked: { readonly tint?: MateTintId; readonly shape?: MateShapeId };
    readonly face: { readonly tint: MateTintId; readonly shape: MateShapeId };
  }>([
    {
      case: "started over, the name as asked: the face as asked",
      name: "Quinn",
      picked: {},
      face: { tint: "olive", shape: "gem" },
    },
    {
      case: "started over, another name: that name's own face",
      name: "Ada",
      picked: {},
      face: { tint: "sky", shape: "pick" },
    },
    {
      case: "started over, a colour picked: that colour's shape",
      name: "Quinn",
      picked: { tint: "rose" },
      face: { tint: "rose", shape: "flower" },
    },
  ])("$case", ({ name, picked, face }) => {
    const defaultShape = (asked: string) => (asked === "Quinn" ? ("gem" as const) : undefined);
    expect(newMateFace({ name, picked, defaultTint, defaultShape })).toEqual(face);
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
      input: { groupName: "Acme Docs", botName: " Quinn ", recipe: "recipe", waitingOn: null },
      words: {
        button: "Add Quinn to Acme Docs",
        line: undefined,
      },
    },
    {
      case: "the recipe still being read",
      input: { groupName: "Acme Docs", botName: "Quinn", recipe: "reading", waitingOn: null },
      words: {
        button: "Add Quinn to Acme Docs",
        line: "Reading the project's setup files…",
      },
    },
    {
      case: "a project with no recipe on main",
      input: { groupName: "Acme Docs", botName: "Quinn", recipe: "none", waitingOn: null },
      words: {
        button: "Add Quinn to Acme Docs",
        line: undefined,
      },
    },
    {
      case: "Add pressed while the names are read",
      input: { groupName: "Acme Docs", botName: "Quinn", recipe: "recipe", waitingOn: "names" },
      words: {
        button: "Add Quinn to Acme Docs",
        line: "Checking which names are taken…",
      },
    },
    {
      case: "a blank name",
      input: { groupName: "Acme Docs", botName: "  ", recipe: "recipe", waitingOn: null },
      words: {
        button: "Add a project Mate to Acme Docs",
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

// Run 2: a refused dialog was titled "Add a project Mate to …" over "Works on this project only.",
// and only then said it could not add one.
describe("newMateDoorTitle — what the Mate's dialog is titled", () => {
  const closed = (action: NewMateDoorAction | undefined) =>
    ({ kind: "closed", reason: "Why.", action }) as const;
  it.each([
    {
      name: "the form, while the project takes a Mate",
      door: undefined,
      title: "Add a project Mate to Shop Front",
    },
    {
      name: "the state, while its setup is still being written",
      door: closed({ kind: "mate", label: "Open Nova", projectId: "p-nova" }),
      title: "Shop Front isn't ready for new Mates yet",
    },
    {
      name: "the state, while its setup waits in a change",
      door: closed({ kind: "change", label: "Review the change", number: 4 }),
      title: "Shop Front isn't ready for new Mates yet",
    },
    {
      name: "the state, while its setup files can't be read",
      door: closed({ kind: "retry", label: "Try again", busy: false }),
      title: "Can't add a Mate to Shop Front right now",
    },
  ])("$name", ({ door, title }) => {
    expect(newMateDoorTitle("Shop Front", door)).toBe(title);
  });
});

// SPEC §3.2c with main's D24/D25: Cleo's proposal as HQ's stream says it — a change in the
// application's recipe repository under zcp's exact title — shuts the door on Review the change
// while it is open, and reads the recipe again once it lands.
describe("the recipe's proposal, as HQ holds it", () => {
  const proposal = (over: Partial<HqChange>): HqChange => ({
    appId: "beviro",
    repo: RECIPE_REPO,
    number: 11,
    mateProjectId: "cleo-project",
    branch: "change",
    receipt: null,
    title: RECIPE_PROPOSAL_TITLE,
    body: "",
    state: "open",
    head: "c0ffee",
    mergedSha: null,
    landedHead: null,
    openedAt: "2026-10-02T09:00:00.000Z",
    mergedAt: null,
    closedAt: null,
    updatedAt: "2026-10-02T09:00:00.000Z",
    mergeability: "clean",
    behind: false,
    ready: true,
    comments: 0,
    ...over,
  });
  const flow = (changes: ReadonlyArray<HqChange>) =>
    flowChanges({ changes, hqAddress: "https://hq.example.test" });

  it("is the change the recipe waits in while it is open", () => {
    const { pullRequests } = flow([proposal({})]);
    expect(
      newMateRecipeChange({
        flow: { changesKnown: true, pullRequests },
        mateName: (id) => (id === "cleo-project" ? "Cleo" : undefined),
      }),
    ).toEqual({ number: 11, mate: "Cleo" });
  });
});

describe("recipeChangeView — where Review the change goes", () => {
  it("opens the change on the group repo, on its own page", () => {
    expect(recipeChangeView("beviro-group", 11)).toEqual({
      to: "/change/$groupId/$repository/$number",
      params: { groupId: "beviro-group", repository: "group", number: "11" },
    });
  });
});

describe("environmentSheetSubmit — what a stage's or a production's one sheet sends", () => {
  const member = (id: string, roleCode: string): ZeropsOrganizationMember => ({
    id: `cu-${id}`,
    status: "ACTIVE",
    roleCode,
    user: { id: `u-${id}`, fullName: id },
  });
  const MEMBERS = [
    member("me", "BASIC_USER"),
    member("dev", "NO_ACCESS"),
    member("guest", "NO_ACCESS"),
    member("tok", "NO_ACCESS"),
  ].map((entry) =>
    entry.id === "cu-tok"
      ? { ...entry, user: { id: "u-tok", email: "token-AbCdEfGhIjKl@zerops.io" } }
      : entry,
  );
  const people = (
    grants: DraftInput["app"]["grants"],
    members: Partial<DraftInput["members"]> = {},
  ) =>
    draftPeople({
      members: { known: true, status: "ready", refused: false, list: MEMBERS, ...members },
      kind: "stage",
      app: {
        projects: [
          { projectId: "prod", kind: "production" },
          { projectId: "m-me", kind: "mate" },
        ],
        grants,
        owners: { "m-me": "u-me" },
      },
      pictures: {},
      creator: { membershipId: "cu-me", userId: "u-me" },
      list: [],
    });
  const PROD_READ = {
    prod: {
      status: "ready" as const,
      grants: [
        { clientUserId: "cu-dev", roleCode: "ADMIN" },
        { clientUserId: "cu-guest", roleCode: "READ_ONLY" },
        { clientUserId: "cu-tok", roleCode: "ADMIN" },
      ],
    },
  };
  const options = recipeOptions({
    roleLabel: "stage",
    tier: TIER,
    services: [],
    recipe: "present",
  });
  const submit = (read: ReturnType<typeof people> | undefined) =>
    environmentSheetSubmit({
      name: "Tea Shop - stage",
      withAgent: false,
      options,
      recipe: "present",
      people: read,
    });

  it("a new stage keeps the people who could see the project", () => {
    expect(submit(people(PROD_READ))).toEqual({
      kind: "create",
      choice: {
        name: "Tea Shop - stage",
        withAgent: false,
        recipe: TIER,
        userRoles: [
          { clientUserId: "cu-dev", roleCode: "ADMIN" },
          { clientUserId: "cu-guest", roleCode: "READ_ONLY" },
        ],
      },
    });
  });

  it.each([
    [
      "with no setup merged and no Mate of its own, it waits for the setup change, saying so",
      false,
      {
        kind: "held",
        reason:
          "This project has no setup files yet. Merge its setup change first, or give it its own Mate.",
        action: "setup-change",
      },
    ],
    [
      "with no setup merged and a Mate of its own, it is made empty for the Mate to set up",
      true,
      {
        kind: "create",
        choice: { name: "Tea Shop - stage", withAgent: true, recipe: { kind: "none" } },
      },
    ],
  ] as const)("runs the form's own checks: %s", (_case, withAgent, outcome) => {
    expect(
      environmentSheetSubmit({
        name: "Tea Shop - stage",
        withAgent,
        options: recipeOptions({
          roleLabel: "stage",
          tier: undefined,
          services: [],
          recipe: "absent",
        }),
        recipe: "absent",
        people: people(PROD_READ),
      }),
    ).toMatchObject(outcome);
  });

  it.each([
    [
      "the project's people are read",
      { prod: { status: "loading" as const, grants: undefined } },
      {},
      READING_PEOPLE,
    ],
    [
      "the organization's members are read",
      PROD_READ,
      { known: false, status: "loading" as const, list: [] },
      READING_PEOPLE,
    ],
    [
      "who can see the project could not be read",
      { prod: { status: "failed" as const, grants: undefined } },
      {},
      PEOPLE_UNREADABLE,
    ],
  ])("holds its button while %s, saying why", (_case, grants, members, reason) => {
    expect(submit(people(grants, members))).toEqual({ kind: "held", reason });
  });
});
