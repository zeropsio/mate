/**
 * What the creation dialog offers and what it accepts — decided without React.
 */

import {
  ZEROPS_BOT_NAME_MAX_LENGTH,
  type EnvironmentRecipeChoice,
} from "@t3tools/client-runtime/zerops";

export interface RecipeOption {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
  readonly choice: EnvironmentRecipeChoice;
}

/**
 * The two things a new environment can start as: the project's own recipe, or
 * nothing.
 *
 * There is no third. The group repo is where a project's shape is written down
 * (D13), and a tier read from its `main` is the only description of it anybody
 * has agreed on. Cloning a sibling used to be offered here; it carried service
 * shapes without their build setup, so it produced environments that looked
 * created and could not build.
 *
 * A project with no merged recipe is offered only the second, and the option
 * says why rather than leaving a list of one that reads like a stub.
 */
export function recipeOptions(input: {
  /** The word for what is being added, as the dialog says it: "Mate", "stage", "production". */
  readonly roleLabel: string;
  /** The tier read from the group repo, when there is one merged. */
  readonly tier: Extract<EnvironmentRecipeChoice, { kind: "tier" }> | undefined;
  /** Every service that tier declares, for the line under it. */
  readonly services: ReadonlyArray<string>;
}): ReadonlyArray<RecipeOption> {
  const options: Array<RecipeOption> = [];
  if (input.tier !== undefined) {
    options.push({
      id: "tier",
      label: `The project's ${input.roleLabel} recipe`,
      // Every service arrives empty: the platform cannot clone a private
      // repository, so the tier is imported `startWithoutCode` and the first
      // deploy fills them.
      detail:
        input.services.length === 0
          ? "From the project's repository, on main."
          : `${input.services.join(", ")} · imported without code; the first deploy fills them`,
      choice: input.tier,
    });
  }
  options.push({
    id: "none",
    label: "Nothing yet",
    detail:
      options.length === 0
        ? "This project has no recipe on main yet. The agent sets the application up."
        : "The agent sets the application up.",
    choice: { kind: "none" },
  });
  return options;
}

export interface CreationForm {
  readonly name: string;
  readonly withAgent: boolean;
  readonly botName: string;
  readonly recipeId: string;
}

export interface CreationFormErrors {
  readonly name?: string;
  readonly botName?: string;
  readonly recipe?: string;
}

/** The one rule for an agent's name: present, short, and new on the account. */
export function validateBotName(
  raw: string,
  takenBotNames: ReadonlyArray<string>,
  options: { readonly current?: string } = {},
): string | undefined {
  const bot = raw.replace(/\s+/g, " ").trim();
  if (bot.length === 0) return "Give the agent a name.";
  if (bot.length > ZEROPS_BOT_NAME_MAX_LENGTH) {
    return `Keep it under ${ZEROPS_BOT_NAME_MAX_LENGTH} characters.`;
  }
  const isCurrent =
    options.current !== undefined && options.current.toLowerCase() === bot.toLowerCase();
  if (!isCurrent && takenBotNames.some((taken) => taken.toLowerCase() === bot.toLowerCase())) {
    return `${bot} is already an agent on this account.`;
  }
  return undefined;
}

export function validateCreationForm(
  form: CreationForm,
  context: {
    readonly takenBotNames: ReadonlyArray<string>;
    readonly options: ReadonlyArray<RecipeOption>;
  },
): CreationFormErrors {
  const errors: { name?: string; botName?: string; recipe?: string } = {};
  if (form.name.trim().length === 0) errors.name = "Give the environment a name.";

  if (form.withAgent) {
    const botError = validateBotName(form.botName, context.takenBotNames);
    if (botError !== undefined) errors.botName = botError;
  }

  const option = context.options.find((entry) => entry.id === form.recipeId);
  if (option === undefined) errors.recipe = "Choose what goes in the environment.";
  else if (option.choice.kind === "none" && !form.withAgent) {
    // Name the way out, not just the rule. With no recipe on `main` the fix is
    // not in this dialog at all — it is a pull request on the group repo.
    const noRecipe = context.options.every((entry) => entry.choice.kind === "none");
    errors.recipe = noRecipe
      ? "This project has no recipe on main yet. Merge one first, or switch the agent on."
      : "Take the project's recipe, or switch the agent on to have one set up.";
  }
  return errors;
}

export function hasCreationErrors(errors: CreationFormErrors): boolean {
  return errors.name !== undefined || errors.botName !== undefined || errors.recipe !== undefined;
}

/**
 * What to call a new environment: a Mate after its bot — `Todo - Fen`, the
 * name the person will say — and a stage or a production after its role;
 * numbered once the plain name is taken, since a group holds N Mates and two
 * environments must not share one name (the owner, 2026-09-17, on
 * "Todo - dev 2": "why is it called that and not Todo - Fen?").
 */
export function proposedEnvironmentName(input: {
  readonly groupName: string;
  readonly roleLabel: string;
  /** The Mate's bot, when the environment runs one; it names the Mate. */
  readonly botName?: string | undefined;
  readonly taken: ReadonlyArray<string>;
}): string {
  const who = input.botName?.trim() ? input.botName.trim() : input.roleLabel;
  const base = `${input.groupName} - ${who}`;
  const taken = new Set(input.taken.map((name) => name.trim().toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base} ${suffix}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}
