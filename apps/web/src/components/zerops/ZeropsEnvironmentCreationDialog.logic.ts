/**
 * What the creation dialog offers and what it accepts — decided without React.
 */

import {
  ZEROPS_BOT_NAME_MAX_LENGTH,
  type EnvironmentRecipeChoice,
} from "@t3tools/client-runtime/zerops";

export interface CloneSourceSummary {
  readonly projectId: string;
  readonly name: string;
  readonly agentName: string | undefined;
  readonly services: ReadonlyArray<string>;
  /** Services whose build setup a clone cannot carry; they will need a deploy. */
  readonly builtFromGit: ReadonlyArray<string>;
}

export interface RecipeOption {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
  readonly choice: EnvironmentRecipeChoice;
}

/**
 * The application choices, best first: the group's own recipe when the store
 * has one, then each sibling that has something to clone, then nothing yet.
 * The last is always offered — with an agent, an empty environment is a
 * starting point, not a mistake.
 */
export function recipeOptions(input: {
  readonly roleLabel: string;
  readonly storeRecipeAvailable: boolean;
  readonly sources: ReadonlyArray<CloneSourceSummary & { readonly yaml: string }>;
}): ReadonlyArray<RecipeOption> {
  const options: Array<RecipeOption> = [];
  if (input.storeRecipeAvailable) {
    options.push({
      id: "store",
      label: `The group's ${input.roleLabel.toLowerCase()} recipe`,
      detail: "Published for this group.",
      choice: { kind: "store" },
    });
  }
  for (const source of input.sources) {
    const who =
      source.agentName === undefined ? source.name : `${source.agentName} (${source.name})`;
    const needsDeploy =
      source.builtFromGit.length === 0
        ? ""
        : ` · ${source.builtFromGit.join(", ")} will need a deploy`;
    options.push({
      id: `clone:${source.projectId}`,
      label: `Clone ${who}`,
      detail: `${source.services.join(", ")}${needsDeploy}`,
      choice: { kind: "services", yaml: source.yaml, source: source.name },
    });
  }
  options.push({
    id: "none",
    label: "Nothing yet",
    detail: "The agent sets the application up.",
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
    errors.recipe = "Without an agent, the environment needs an application.";
  }
  return errors;
}

export function hasCreationErrors(errors: CreationFormErrors): boolean {
  return errors.name !== undefined || errors.botName !== undefined || errors.recipe !== undefined;
}
