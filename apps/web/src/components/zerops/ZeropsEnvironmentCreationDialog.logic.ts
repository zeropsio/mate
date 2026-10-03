/**
 * What the creation dialog offers and what it accepts — decided without React.
 */

import {
  botDisplayName,
  GROUP_REPOSITORY,
  hasMate,
  isRecipeProposal,
  readZeropsGroupTags,
  ZEROPS_BOT_NAME_MAX_LENGTH,
  type EnvironmentCreationStep,
  type EnvironmentCreationStepProgress,
  type EnvironmentRecipeChoice,
  type FlowPullRequest,
  type ZeropsGroupPendingMember,
  type ZeropsMateFace,
} from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { crewPossessive } from "@t3tools/client-runtime/zerops/crew/phrases";
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
  /** The shape a name was asked with before — an Add started over — while no colour is picked. */
  readonly defaultShape?: ((name: string) => MateShapeId | undefined) | undefined;
}): ZeropsMateFace {
  const tint = input.picked.tint ?? input.defaultTint(input.name);
  const asked = input.picked.tint === undefined ? input.defaultShape?.(input.name) : undefined;
  return { tint, shape: input.picked.shape ?? asked ?? MATE_SHAPE_OF_TINT[tint] };
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

/** The quiet line while the group repo is read for the recipe. */
export const READING_RECIPE = "Reading the project's recipe…";

/**
 * What the Mate's dialog says: what the button does, and the one quiet line beside it, for what
 * Add waits on. What happens once it is added is its closing block's (`newMateNext`).
 */
export function newMateWords(input: {
  readonly groupName: string;
  readonly botName: string;
  readonly recipe: NewMateRecipe;
  /** What a pressed Add waits on, if anything. */
  readonly waitingOn: "names" | "recipe" | null;
}): { readonly button: string; readonly line: string | undefined } {
  const { groupName, recipe } = input;
  const name = input.botName.replace(/\s+/g, " ").trim();
  return {
    button: name.length === 0 ? `Add a Mate to ${groupName}` : `Add ${name} to ${groupName}`,
    line:
      input.waitingOn === "names"
        ? CHECKING_NAMES
        : recipe === "reading"
          ? READING_RECIPE
          : undefined,
  };
}

/** Where the recipe on the group repo's `main` stands, as it answered (`useZeropsGroupRecipe`). */
export type NewMateRecipeRead = "loading" | "present" | "absent" | "unreadable";

/** One of the project's Mates, as the door names it. */
export interface NewMateDoorMate {
  readonly projectId: string;
  readonly name: string;
}

/** The change a Mate proposed the recipe in, still open, and that Mate while the project has it. */
export interface NewMateRecipeChange {
  readonly number: number;
  readonly mate: string | undefined;
}

/** The one thing to do while the project takes no Mate. */
export type NewMateDoorAction =
  | { readonly kind: "change"; readonly label: string; readonly number: number }
  | { readonly kind: "mate"; readonly label: string; readonly projectId: string }
  | { readonly kind: "retry"; readonly label: string; readonly busy: boolean };

/** Why the project takes no Mate now, and what to do about it where anything can be done. */
export interface NewMateDoorClosed {
  readonly kind: "closed";
  readonly reason: string;
  readonly action: NewMateDoorAction | undefined;
}

/** Whether the project takes another Mate: the form, knowing the recipe as it stands, or why not. */
export type NewMateDoor =
  | { readonly kind: "open"; readonly recipe: NewMateRecipe }
  | NewMateDoorClosed;

/**
 * Whether "Add a Mate" can add one now (the owner, 2026-09-30: adding a second Mate before the
 * first has written the group's import files "shouldn't be possible with explanation").
 *
 * A new Mate is made from the project's recipe on `main`, and its first Mate writes it: a project
 * with no Mate yet takes one, which sets the application up itself, and a project whose recipe is
 * on `main` takes any. A project whose Mates have not written it yet takes none — an empty Mate
 * would set the application up a second time, beside the first — and says where the recipe is:
 * waiting in a Mate's change, which it offers to review, or still to be written by the Mate
 * setting the project up, which it offers to open. A recipe that cannot be read takes none either:
 * nobody knows what the Mate would be made from, so the dialog offers to read it again.
 */
export function newMateDoor(input: {
  readonly groupName: string;
  readonly recipe: NewMateRecipeRead;
  readonly mates: ReadonlyArray<NewMateDoorMate>;
  readonly change: NewMateRecipeChange | undefined;
  /** The recipe that could not be read is being read again (`useZeropsGroupRecipe`). */
  readonly rereading: boolean;
}): NewMateDoor {
  const { change, groupName, mates } = input;
  switch (input.recipe) {
    case "loading":
      return { kind: "open", recipe: "reading" };
    case "present":
      return { kind: "open", recipe: "recipe" };
    case "unreadable":
      return {
        kind: "closed",
        reason: `${crewPossessive(groupName)} recipe can't be read right now.`,
        action: { kind: "retry", label: "Try again", busy: input.rereading },
      };
    case "absent":
      break;
  }
  if (mates.length === 0) return { kind: "open", recipe: "none" };
  if (change !== undefined) {
    const where = change.mate === undefined ? "a change" : `${crewPossessive(change.mate)} change`;
    return {
      kind: "closed",
      reason: `${crewPossessive(groupName)} recipe is waiting in ${where}. New Mates start from it once it's merged.`,
      action: { kind: "change", label: "Review the change", number: change.number },
    };
  }
  const [writer, ...others] = mates;
  if (writer !== undefined && others.length === 0) {
    return {
      kind: "closed",
      reason: `${groupName} has no recipe yet. ${writer.name} writes it when it finishes setting ${groupName} up, and new Mates start from it.`,
      action: { kind: "mate", label: `Open ${writer.name}`, projectId: writer.projectId },
    };
  }
  return {
    kind: "closed",
    reason: `${groupName} has no recipe yet. ${crewPossessive(groupName)} Mates write it when one of them finishes setting ${groupName} up.`,
    action: undefined,
  };
}

/**
 * The project's Mates, as the door counts and names them: the listed ones by their agent, in the
 * tree's order, then the ones still coming up — a Mate the platform took and the listing does not
 * hold yet is setting the project up as surely as one it does.
 */
export function newMateDoorMates(input: {
  readonly environments: ReadonlyArray<{ readonly item: ZeropsCandidate }>;
  readonly pending: ReadonlyArray<ZeropsGroupPendingMember>;
}): ReadonlyArray<NewMateDoorMate> {
  const listed = input.environments.flatMap(({ item }) =>
    hasMate(item)
      ? [
          {
            projectId: item.project.id,
            name: botDisplayName({
              bot: readZeropsGroupTags(item.project.tagList).bot,
              projectName: item.project.name,
            }),
          },
        ]
      : [],
  );
  const held = new Set(listed.map((mate) => mate.projectId));
  const coming = input.pending
    .filter((member) => member.kind === "mate" && !held.has(member.projectId))
    .map(({ projectId, name }) => ({ projectId, name }));
  return [...listed, ...coming];
}

/**
 * The change the recipe waits in: a Mate's proposal of it still open on the group repo
 * (`isRecipeProposal`) — the first opened, should two Mates each have proposed it — and the name
 * of the Mate that opened it, while there is one.
 *
 * None is known before the forge has answered for the project (`changesKnown`): until then the
 * door says who writes the recipe, never a form that the answer would take back, and where the
 * recipe waits once the forge says so.
 */
export function newMateRecipeChange(input: {
  /** The project's changes as the forge last read them (`ZeropsProjectFlow`); none read yet. */
  readonly flow:
    | {
        readonly changesKnown: boolean;
        readonly pullRequests: ReadonlyArray<FlowPullRequest>;
      }
    | undefined;
  readonly mateName: (projectId: string) => string | undefined;
}): NewMateRecipeChange | undefined {
  const { flow } = input;
  if (flow === undefined || !flow.changesKnown) return undefined;
  let first: FlowPullRequest | undefined;
  for (const pull of flow.pullRequests) {
    if (!isRecipeProposal(pull) || pull.merged) continue;
    if (first === undefined || pull.number < first.number) first = pull;
  }
  if (first === undefined) return undefined;
  const mate = first.mateProjectId === undefined ? undefined : input.mateName(first.mateProjectId);
  return { number: first.number, mate };
}

/** The proposal of the recipe that landed last, by its number: another landing may put one on `main`. */
export function landedRecipeProposal(merged: ReadonlyArray<FlowPullRequest>): number | undefined {
  let newest: number | undefined;
  for (const pull of merged) {
    if (isRecipeProposal(pull) && (newest === undefined || pull.number > newest)) {
      newest = pull.number;
    }
  }
  return newest;
}

/** Where *Review the change* goes: the recipe's change on the group repo, on its own page. */
export function recipeChangeView(
  groupId: string,
  number: number,
): {
  readonly to: "/change/$groupId/$repository/$number";
  readonly params: {
    readonly groupId: string;
    readonly repository: string;
    readonly number: string;
  };
} {
  return {
    to: "/change/$groupId/$repository/$number",
    params: { groupId, repository: GROUP_REPOSITORY, number: String(number) },
  };
}

/** One step of a press, as the Add dialog draws it while it stays open. */
export interface PressStepView {
  readonly label: string;
  readonly state: "waiting" | "active" | "done" | "failed";
}

/** The press's steps the person waits on, and which runner steps make each. */
const PRESS_STEPS: ReadonlyArray<{
  readonly label: string;
  readonly kinds: ReadonlyArray<EnvironmentCreationStep["kind"]>;
}> = [
  { label: "Project", kinds: ["create-project", "import-project", "import-managed"] },
  { label: "Container", kinds: ["import-container"] },
  { label: "Closed off", kinds: ["close-off"] },
  { label: "Registered", kinds: ["register"] },
];

/**
 * The press as *Finish setup* on a Mate's view draws it: Project, Container, Closed off,
 * Registered — what the Mate needs before it needs no browser, and the registration a call or two
 * after. A step a press does not make is left out.
 */
export function pressSteps(
  progress: ReadonlyArray<EnvironmentCreationStepProgress>,
): ReadonlyArray<PressStepView> {
  return PRESS_STEPS.flatMap(({ label, kinds }) => {
    const own = progress.filter((entry) => kinds.includes(entry.step.kind));
    if (own.length === 0) return [];
    const state: PressStepView["state"] = own.some((entry) => entry.state === "failed")
      ? "failed"
      : own.every((entry) => entry.state === "done")
        ? "done"
        : own.some((entry) => entry.state === "running" || entry.state === "done")
          ? "active"
          : "waiting";
    return [{ label, state }];
  });
}

/**
 * The press has marked the project closed off — the Mate needs no browser — and its registration,
 * where it writes one, went through or was refused: its record may go.
 */
export function pressThrough(progress: ReadonlyArray<EnvironmentCreationStepProgress>): boolean {
  const closedOff = progress.some(
    (entry) => entry.step.kind === "close-off" && entry.state === "done",
  );
  const registration = progress.find((entry) => entry.step.kind === "register");
  return (
    closedOff &&
    (registration === undefined || registration.state === "done" || registration.state === "failed")
  );
}
