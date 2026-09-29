/**
 * What the creation dialog offers and what it accepts — decided without React.
 */

import {
  ZEROPS_BOT_NAME_MAX_LENGTH,
  type EnvironmentRecipeChoice,
  type ZeropsMateFace,
} from "@t3tools/client-runtime/zerops";
import type { TakenBotNames } from "@t3tools/client-runtime/zerops/projections";
import { MATE_SHAPE_OF_TINT, type MateShapeId, type MateTintId } from "@t3tools/shared/brand";

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

/** What the one rule says of a name: free, refused and why, or not known until the rest is read. */
type BotNameVerdict =
  | { readonly kind: "free" }
  | { readonly kind: "refused"; readonly reason: "blank" | "long" | "taken"; readonly bot: string }
  | { readonly kind: "unread" };

const CHECKING_NAMES = "Checking which names are taken…";

function botNameVerdict(
  raw: string,
  taken: TakenBotNames,
  options: { readonly current?: string } = {},
): BotNameVerdict {
  const bot = raw.replace(/\s+/g, " ").trim();
  if (bot.length === 0) return { kind: "refused", reason: "blank", bot };
  if (bot.length > ZEROPS_BOT_NAME_MAX_LENGTH) return { kind: "refused", reason: "long", bot };
  const isCurrent =
    options.current !== undefined && options.current.toLowerCase() === bot.toLowerCase();
  if (isCurrent) return { kind: "free" };
  if (taken.names.some((name) => name.toLowerCase() === bot.toLowerCase())) {
    return { kind: "refused", reason: "taken", bot };
  }
  return taken.complete ? { kind: "free" } : { kind: "unread" };
}

const TOO_LONG = `Keep it under ${ZEROPS_BOT_NAME_MAX_LENGTH} characters.`;

/**
 * The one rule for an agent's name: present, short, and new on the account. A name read as taken
 * is refused at once; one missing from a listing not read in full may still be taken, so it waits
 * for the rest (M5) instead of passing as free. Keeping a Mate's own name needs no listing.
 */
export function validateBotName(
  raw: string,
  taken: TakenBotNames,
  options: { readonly current?: string } = {},
): string | undefined {
  const verdict = botNameVerdict(raw, taken, options);
  if (verdict.kind === "unread") return CHECKING_NAMES;
  if (verdict.kind === "free") return undefined;
  switch (verdict.reason) {
    case "blank":
      return "Give the agent a name.";
    case "long":
      return TOO_LONG;
    case "taken":
      return `${verdict.bot} is already an agent on this account.`;
  }
}

export function validateCreationForm(
  form: CreationForm,
  context: {
    readonly takenBotNames: TakenBotNames;
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

/**
 * The New Mate dialog asks three things — a name, a colour, a shape — and decides the rest: the
 * Mate gets its own copy of the project with the project's recipe deployed (the tier read from
 * the group repo's `main`), runs its agent, and is called what the project calls it
 * (`proposedEnvironmentName`).
 */

/** The name a new Mate's face follows: what is typed, or while the field is blank the last name typed. */
export function faceName(typed: string, held: string): string {
  const name = typed.replace(/\s+/g, " ").trim();
  return name.length === 0 ? held : name;
}

/**
 * A new Mate's face: what its person picked, else what its name asks for — the tint the account
 * would give the name (`newMateTint`) and that tint's shape. A pick sticks; until then both follow
 * the name as it is typed, and a picked colour brings its own shape until a shape is picked.
 */
export function newMateFace(input: {
  readonly name: string;
  readonly picked: {
    readonly tint?: MateTintId | undefined;
    readonly shape?: MateShapeId | undefined;
  };
  readonly defaultTint: (name: string) => MateTintId;
}): ZeropsMateFace {
  const tint = input.picked.tint ?? input.defaultTint(input.name);
  return { tint, shape: input.picked.shape ?? MATE_SHAPE_OF_TINT[tint] };
}

/** Where the project's recipe stands, as the Mate's dialog tells it. */
export type NewMateRecipe = "reading" | "recipe" | "none";

export function newMateRecipe(input: {
  readonly tier: Extract<EnvironmentRecipeChoice, { kind: "tier" }> | undefined;
  readonly tierLoading: boolean;
}): NewMateRecipe {
  if (input.tier !== undefined) return "recipe";
  return input.tierLoading ? "reading" : "none";
}

/** Why a name will not do, as the Mate's dialog says it — beside its button, so briefly. */
const NEW_MATE_REFUSALS = {
  blank: "Give the Mate a name.",
  long: TOO_LONG,
  taken: "Another Mate already has that name.",
} as const;

/** What pressing Add does now: refuse the name, wait on a read, or create the Mate. */
export type NewMateSubmit =
  | { readonly kind: "refuse"; readonly error: string }
  | { readonly kind: "wait"; readonly on: "names" | "recipe" }
  | { readonly kind: "create"; readonly recipe: EnvironmentRecipeChoice };

/**
 * The name first — a name refused is refused whatever is still being read — then the reads it
 * waits on: every Mate's name, so a new one cannot take another's, and the recipe, so a Mate is
 * never created empty for having been added before the group repo answered. A project with no
 * recipe on main gets its Mate with nothing in it; the Mate sets the application up.
 */
export function newMateSubmit(input: {
  readonly botName: string;
  readonly takenBotNames: TakenBotNames;
  readonly tier: Extract<EnvironmentRecipeChoice, { kind: "tier" }> | undefined;
  readonly tierLoading: boolean;
}): NewMateSubmit {
  const verdict = botNameVerdict(input.botName, input.takenBotNames);
  if (verdict.kind === "refused")
    return { kind: "refuse", error: NEW_MATE_REFUSALS[verdict.reason] };
  if (verdict.kind === "unread") return { kind: "wait", on: "names" };
  if (input.tier !== undefined) return { kind: "create", recipe: input.tier };
  return input.tierLoading
    ? { kind: "wait", on: "recipe" }
    : { kind: "create", recipe: { kind: "none" } };
}

/** What happens when a Mate is added, as the dialog's description says it. */
export function newMateDescription(groupName: string, recipe: NewMateRecipe): string {
  return recipe === "none"
    ? `It gets its own copy of ${groupName}. There's no recipe yet, so it sets the application up itself. It takes a couple of minutes.`
    : `It gets its own copy of ${groupName} with the recipe deployed. It takes a couple of minutes.`;
}

/**
 * What the Mate's dialog says: what happens, in its description — a project with no recipe to
 * deploy included; what the button does; and the one quiet line beside it, for what Add waits on.
 */
export function newMateWords(input: {
  readonly groupName: string;
  readonly botName: string;
  readonly recipe: NewMateRecipe;
  /** What a pressed Add waits on, if anything. */
  readonly waitingOn: "names" | "recipe" | null;
}): { readonly description: string; readonly button: string; readonly line: string | undefined } {
  const { groupName, recipe } = input;
  const name = input.botName.replace(/\s+/g, " ").trim();
  return {
    description: newMateDescription(groupName, recipe),
    button: name.length === 0 ? `Add a Mate to ${groupName}` : `Add ${name} to ${groupName}`,
    line:
      input.waitingOn === "names"
        ? CHECKING_NAMES
        : recipe === "reading"
          ? "Reading the project's recipe…"
          : undefined,
  };
}
