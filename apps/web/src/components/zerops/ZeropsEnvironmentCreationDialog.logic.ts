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
    // A clone imports services, never their contents, so every runtime in one
    // arrives empty — whatever the source was built by. Saying so only when
    // `builtFromGit` was non-empty left a cloned stage and production coming
    // up READY_TO_DEPLOY with nothing said. That list is a sharper, separate
    // warning: the export carries no build setup for those, so their first
    // build fails rather than merely being empty.
    const buildSetup =
      source.builtFromGit.length === 0
        ? ""
        : ` · ${source.builtFromGit.join(", ")} builds from a repository, and its build setup is not carried`;
    options.push({
      id: `clone:${source.projectId}`,
      label: `Clone ${who}`,
      detail: `${source.services.join(", ")} · copied without code; the first deploy fills them${buildSetup}`,
      choice: {
        kind: "services",
        yaml: source.yaml,
        source: source.name,
        needsDeploy: source.builtFromGit,
      },
    });
  }
  // On a group with nothing built yet this is the only option, and a radio
  // list of one reads like a stub unless it says why it is alone.
  const alone = options.length === 0;
  options.push({
    id: "none",
    label: "Nothing yet",
    detail: alone
      ? "Nothing in this project has services to copy yet. The agent sets the application up."
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
    // Name the way out, not just the rule. A production is a copy of a dev's
    // services, so on a group that has not built anything the fix is not in
    // this dialog at all — it is one environment over.
    const nothingToCopy = context.options.every((entry) => entry.choice.kind === "none");
    errors.recipe = nothingToCopy
      ? "Nothing in this project has services to copy yet. Build something in a dev environment first, or switch the agent on."
      : "Choose an application to copy, or switch the agent on to have one set up.";
  }
  return errors;
}

export function hasCreationErrors(errors: CreationFormErrors): boolean {
  return errors.name !== undefined || errors.botName !== undefined || errors.recipe !== undefined;
}

/**
 * What to call a new environment: its role, and a number once the plain name
 * is taken. A group holds N Mates, so `<Group> - dev` is free only for the
 * first of them — proposing it again would hand two environments one name.
 */
export function proposedEnvironmentName(input: {
  readonly groupName: string;
  readonly roleLabel: string;
  readonly taken: ReadonlyArray<string>;
}): string {
  const base = `${input.groupName} - ${input.roleLabel}`;
  const taken = new Set(input.taken.map((name) => name.trim().toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base} ${suffix}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}
