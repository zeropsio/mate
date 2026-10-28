/**
 * What the creation dialog offers and what it accepts — decided without React.
 */

import {
  hasMate,
  nameUnderApp,
  projectNameInApp,
  isRecipeProposal,
  recipeProposalRedone,
  ZEROPS_BOT_NAME_MAX_LENGTH,
  type EnvironmentCreationStep,
  type EnvironmentCreationStepProgress,
  type EnvironmentRecipeChoice,
  type FlowPullRequest,
  type ZeropsGroupPendingMember,
  type ZeropsMateFace,
  type ZeropsEnvironmentRole,
} from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { crewPossessive } from "@t3tools/client-runtime/zerops/crew/phrases";
import type { ProjectGrant } from "@t3tools/client-runtime/zerops/projectAccess";
import type { TakenBotNames } from "@t3tools/client-runtime/zerops/projections";
import { MATE_SHAPE_OF_TINT, type MateShapeId, type MateTintId } from "@t3tools/shared/brand";
import { RECIPE_REPO } from "@t3tools/shared/hqRecipe";

import type { DraftPeople } from "./projects/accessDraft.logic";

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
 * says why rather than leaving a list of one that reads like a stub — only where HQ answered that
 * there is none: a recipe still being read, or one that could not be read, is not a missing one.
 */
export function recipeOptions(input: {
  /** The word for what is being added, as the dialog says it: "Mate", "stage", "production". */
  readonly roleLabel: string;
  /** The tier read from the group repo, when there is one merged. */
  readonly tier: Extract<EnvironmentRecipeChoice, { kind: "tier" }> | undefined;
  /** Every service that tier declares, for the line under it. */
  readonly services: ReadonlyArray<string>;
  /** Where the recipe stands (`creationRecipe`). */
  readonly recipe: CreationRecipe;
}): ReadonlyArray<RecipeOption> {
  const options: Array<RecipeOption> = [];
  if (input.tier !== undefined) {
    options.push({
      id: "tier",
      label: "Same services as the project",
      // Every service arrives empty: the platform cannot clone a private
      // repository, so the tier is imported `startWithoutCode` and the first
      // deploy fills them.
      detail:
        input.services.length === 0
          ? "As the project's setup files describe them."
          : `${input.services.join(", ")} · your code arrives with the first deploy`,
      choice: input.tier,
    });
  }
  options.push({
    id: "none",
    label: "Empty",
    detail:
      options.length === 0 && input.recipe === "absent"
        ? "This project has no setup files yet. Set it up later."
        : "Set it up later.",
    choice: { kind: "none" },
  });
  return options;
}

/**
 * A stage's or a production's form: one name, its project's in full, whether an agent runs in it or
 * not — its agent goes by what follows the application's name in it.
 */
export interface CreationForm {
  readonly name: string;
  readonly withAgent: boolean;
  readonly recipeId: string;
}

export interface CreationFormErrors {
  readonly name?: string;
  readonly recipe?: string;
}

/** What the one rule says of a name: free, refused and why, or not known until the rest is read. */
type BotNameVerdict =
  | { readonly kind: "free" }
  | { readonly kind: "refused"; readonly reason: "blank" | "long" | "taken"; readonly bot: string }
  | { readonly kind: "unread" };

export const CHECKING_NAMES = "Checking which names are taken…";

function botNameVerdict(
  raw: string,
  taken: TakenBotNames,
  options: { readonly current?: string; readonly appName?: string | undefined } = {},
): BotNameVerdict {
  // A typed `"<application> - "` is the prefix of the project's name, not part of the Mate's own.
  const bot = nameUnderApp(raw.replace(/\s+/g, " ").trim(), options.appName);
  if (bot.length === 0) return { kind: "refused", reason: "blank", bot };
  // The name a Mate already has is never refused, however long it is.
  const isCurrent =
    options.current !== undefined && options.current.toLowerCase() === bot.toLowerCase();
  if (isCurrent) return { kind: "free" };
  if (bot.length > ZEROPS_BOT_NAME_MAX_LENGTH) return { kind: "refused", reason: "long", bot };
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
  options: { readonly current?: string; readonly appName?: string | undefined } = {},
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
    readonly options: ReadonlyArray<RecipeOption>;
    /** Where the recipe stands (`creationRecipe`). */
    readonly recipe: CreationRecipe;
    readonly role?: ZeropsEnvironmentRole | undefined;
  },
): CreationFormErrors {
  const errors: { name?: string; recipe?: string } = {};
  if (form.name.trim().length === 0) errors.name = "Give the environment a name.";

  if (context.role === "prod") return errors;

  // What is created comes from this read: a recipe not read yet, or not read at all, holds it.
  const held = creationRecipeHold(context.recipe);
  const option = context.options.find((entry) => entry.id === form.recipeId);
  if (held !== undefined) errors.recipe = held;
  else if (option === undefined) errors.recipe = "Choose what goes in the environment.";
  else if (option.choice.kind === "none" && !form.withAgent) {
    // Name the way out, not just the rule. With no recipe on `main` the fix is
    // not in this dialog at all — it is a pull request on the group repo.
    errors.recipe =
      context.recipe === "absent"
        ? "This project has no setup files yet. Merge its setup change first, or give it its own Mate."
        : "Start with the project's services, or give it its own Mate to set them up.";
  }
  return errors;
}

/**
 * Where the project's recipe stands for the creation forms: being read — no answer this time yet,
 * whatever the last read said (`useZeropsGroupRecipe`'s `loading`) — or what HQ answered: a recipe,
 * none on `main`, or a read that failed.
 */
export type CreationRecipe = "reading" | "present" | "absent" | "unreadable";

export function creationRecipe(read: {
  readonly state: NewMateRecipeRead;
  readonly loading: boolean;
}): CreationRecipe {
  return read.loading || read.state === "loading" ? "reading" : read.state;
}

const RECIPE_UNREADABLE = "The project's setup files can't be read right now.";

/** What holds a form that imports its recipe: still being read, or not readable. */
export function creationRecipeHold(recipe: CreationRecipe): string | undefined {
  if (recipe === "reading") return READING_RECIPE;
  return recipe === "unreadable" ? RECIPE_UNREADABLE : undefined;
}

export function hasCreationErrors(errors: CreationFormErrors): boolean {
  return errors.name !== undefined || errors.recipe !== undefined;
}

export const READING_PEOPLE = "Reading who can see the project…";
export const PEOPLE_UNREADABLE = "Who can see the project can't be read right now.";

/**
 * What a stage's or a production's one sheet sends, or why its button waits. It asks nothing the
 * project already says: its name, a stage's setup, and the people who reach the project now, at
 * their level there (`draftPeople`) — a Developer or a Guest on the project sees the new
 * environment too.
 */
export function environmentSheetSubmit(input: {
  readonly role?: ZeropsEnvironmentRole | undefined;
  readonly name: string;
  readonly withAgent: boolean;
  readonly options: ReadonlyArray<RecipeOption>;
  readonly recipe: CreationRecipe;
  /** The project's people as the access draft reads them; absent where the host sends none. */
  readonly people: DraftPeople | undefined;
}):
  | {
      readonly kind: "held";
      readonly reason: string;
      /** The one thing that moves it on: the setup change to merge, where none is merged. */
      readonly action?: "setup-change" | undefined;
    }
  | {
      readonly kind: "create";
      readonly choice: {
        readonly name: string;
        readonly withAgent: boolean;
        readonly recipe: EnvironmentRecipeChoice;
        readonly userRoles?: ReadonlyArray<ProjectGrant>;
      };
    } {
  const option = input.options[0];
  // The stage needs services now; production reserves its project for the first release.
  const errors = validateCreationForm(
    { name: input.name, withAgent: input.withAgent, recipeId: option?.id ?? "" },
    { options: input.options, recipe: input.recipe, role: input.role },
  );
  const reason = errors.recipe ?? errors.name;
  if (reason !== undefined || (option === undefined && input.role !== "prod"))
    return {
      kind: "held",
      reason: reason ?? "Choose what goes in the environment.",
      ...(input.recipe === "absent" && errors.recipe !== undefined
        ? { action: "setup-change" as const }
        : {}),
    };
  const { people } = input;
  if (people?.kind === "reading") return { kind: "held", reason: READING_PEOPLE };
  if (people?.kind === "failed") return { kind: "held", reason: PEOPLE_UNREADABLE };
  const userRoles = people?.kind === "ready" ? people.userRoles : [];
  return {
    kind: "create",
    choice: {
      name: input.name,
      withAgent: input.role === "prod" ? false : input.withAgent,
      recipe: input.role === "prod" ? { kind: "none" } : (option?.choice ?? { kind: "none" }),
      ...(userRoles.length === 0 ? {} : { userRoles }),
    },
  };
}

/**
 * What to call a new stage or production: after its application and its role — `Todo - stage` — so
 * it reads in the organization's project list in Zerops, numbered once the plain name is taken. A
 * suggestion the person may change, here or in Zerops. Under its application the client shows what
 * follows the `Todo - ` (`nameUnderApp`); a Mate's project is named in full the same way, its own
 * name after the application's.
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

/**
 * The New Mate dialog asks three things — a name, a colour, a shape — and decides the rest: the
 * Mate gets its own copy of the project with the project's recipe deployed (the tier read from
 * the group repo's `main`), runs its agent, and its project is named in full, the application's name and the Mate's.
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
  /** The application the Mate is added to: a typed prefix of it is cut before the name is judged. */
  readonly appName?: string | undefined;
  readonly takenBotNames: TakenBotNames;
  readonly tier: Extract<EnvironmentRecipeChoice, { kind: "tier" }> | undefined;
  readonly tierLoading: boolean;
}): NewMateSubmit {
  const verdict = botNameVerdict(input.botName, input.takenBotNames, {
    appName: input.appName,
  });
  if (verdict.kind === "refused")
    return { kind: "refuse", error: NEW_MATE_REFUSALS[verdict.reason] };
  if (verdict.kind === "unread") return { kind: "wait", on: "names" };
  if (input.tier !== undefined) return { kind: "create", recipe: input.tier };
  return input.tierLoading
    ? { kind: "wait", on: "recipe" }
    : { kind: "create", recipe: { kind: "none" } };
}

/** The quiet line while the group repo is read for the recipe. */
export const READING_RECIPE = "Reading the project's setup files…";

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
    button:
      name.length === 0 ? `Add a project Mate to ${groupName}` : `Add ${name} to ${groupName}`,
    line:
      input.waitingOn === "names"
        ? CHECKING_NAMES
        : recipe === "reading"
          ? READING_RECIPE
          : undefined,
  };
}

/** Where the recipe on its repository's `main` stands, as HQ answered (`useZeropsGroupRecipe`). */
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
  /** It conflicts with main, and its Mate composes it again from main (`recipeProposalRedone`). */
  readonly redone?: true;
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
        reason: `${crewPossessive(groupName)} setup files can't be read right now.`,
        action: { kind: "retry", label: "Try again", busy: input.rereading },
      };
    case "absent":
      break;
  }
  if (mates.length === 0) return { kind: "open", recipe: "none" };
  if (change !== undefined) {
    const where = change.mate === undefined ? "a change" : `${crewPossessive(change.mate)} change`;
    // Its Mate composes it again from main by itself: the person only looks.
    if (change.redone === true) {
      return {
        kind: "closed",
        reason: `${crewPossessive(groupName)} setup for new Mates is waiting in ${where}, which ${change.mate ?? "its Mate"} is redoing from main. New Mates can join once it lands.`,
        action: { kind: "change", label: "See the change", number: change.number },
      };
    }
    return {
      kind: "closed",
      reason: `${crewPossessive(groupName)} setup for new Mates is waiting in ${where}. New Mates can join once it's merged.`,
      action: { kind: "change", label: "Review the change", number: change.number },
    };
  }
  const [writer, ...others] = mates;
  if (writer !== undefined && others.length === 0) {
    return {
      kind: "closed",
      reason: `${writer.name} is still setting ${groupName} up. New Mates can join once it's done.`,
      action: { kind: "mate", label: `Open ${writer.name}`, projectId: writer.projectId },
    };
  }
  return {
    kind: "closed",
    reason: `${crewPossessive(groupName)} Mates are still setting it up. New Mates can join once one of them is done.`,
    action: undefined,
  };
}

/**
 * What the Mate's dialog is titled: the form it offers, or, while the project takes no Mate, that
 * state — never a title promising a form the dialog then refuses (run 2).
 */
export function newMateDoorTitle(groupName: string, closed: NewMateDoorClosed | undefined): string {
  if (closed === undefined) return `Add a project Mate to ${groupName}`;
  return closed.action?.kind === "retry"
    ? `Can't add a Mate to ${groupName} right now`
    : `${groupName} isn't ready for new Mates yet`;
}

/**
 * Why *Add a Mate* stands off before it is pressed, in the words the door says after the press —
 * only where the project's setup files and changes are already read and the door is closed on
 * them. Anything not known yet leaves Add on, as before; so do setup files that can't be read,
 * whose way on (*Try again*) is behind the press. `null` while Add may be pressed.
 */
export function newMateGate(input: {
  readonly groupName: string;
  /** The project's setup files for a Mate as a held read says them; `undefined` while none is held. */
  readonly recipe: NewMateRecipeRead | undefined;
  readonly mates: ReadonlyArray<NewMateDoorMate>;
  /** The project's changes as read; `undefined` while they are not. */
  readonly changes: ReadonlyArray<FlowPullRequest> | undefined;
  readonly mateName: (projectId: string) => string | undefined;
}): string | null {
  const { changes, mates } = input;
  if (input.recipe !== "absent" || changes === undefined) return null;
  const door = newMateDoor({
    groupName: input.groupName,
    recipe: "absent",
    mates,
    change: newMateRecipeChange({
      flow: { changesKnown: true, pullRequests: changes },
      mateName: (projectId) =>
        mates.find((mate) => mate.projectId === projectId)?.name ?? input.mateName(projectId),
    }),
    rereading: false,
  });
  return door.kind === "closed" ? door.reason : null;
}

/**
 * The project's Mates, as the door counts and names them: the listed ones by their project, in the
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
            name: projectNameInApp(item.project),
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
  return {
    number: first.number,
    mate: input.mateName(first.mateProjectId),
    ...(recipeProposalRedone(first) ? { redone: true as const } : {}),
  };
}

/** Where *Review the change* goes: the recipe's change in its recipe repository, on its own page. */
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
    params: { groupId, repository: RECIPE_REPO, number: String(number) },
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
  { label: "Registered", kinds: ["register"] },
  { label: "Its computer", kinds: ["import-container"] },
  { label: "Private network ready", kinds: ["close-off"] },
];

/**
 * The press as the Add dialog draws it, in the order it runs: Project, Registered — its record in
 * its application before its container (F6b) — Container, Closed off: what the Mate needs before
 * it needs no browser. The wait for it comes after, the dialog gone. A step a press does not make
 * is left out.
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
