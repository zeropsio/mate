/**
 * Whether a project takes another Mate, and why not — the door the new-Mate form, the menu's
 * *Add a Mate* and a press read alike, decided without React.
 */

import {
  hasMate,
  projectNameInApp,
  isRecipeProposal,
  recipeProposalRedone,
  type EnvironmentCreationStepProgress,
  type FlowPullRequest,
  type ZeropsGroupPendingMember,
} from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { crewPossessive } from "@t3tools/client-runtime/zerops/crew/phrases";

/** Where the project's recipe stands, as the Mate's dialog tells it. */
export type NewMateRecipe = "reading" | "recipe" | "none";

/** Where the recipe on its repository's `main` stands, as HQ answered (`useZeropsGroupRecipe`). */
export type NewMateRecipeRead = "loading" | "present" | "absent" | "unreadable";

/** One of the project's Mates, as the door names it. */
interface NewMateDoorMate {
  readonly projectId: string;
  readonly name: string;
  /** Up, its agent waiting for the viewer's own sign-in (`useSignInWaits`): it sets nothing up yet. */
  readonly awaitsYourSignIn?: true;
}

/** The change a Mate proposed the recipe in, still open, and that Mate while the project has it. */
interface NewMateRecipeChange {
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
      // One waiting for the viewer's sign-in waits on them, not on its own work.
      reason:
        writer.awaitsYourSignIn === true
          ? `Sign ${writer.name} in first. New Mates can join once it has set ${groupName} up.`
          : `${writer.name} is still setting ${groupName} up. New Mates can join once it's done.`,
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
  /** Its agent waits for the viewer's own sign-in (`useSignInWaits`); none while not read. */
  readonly awaitsYourSignIn?: ((item: ZeropsCandidate) => boolean) | undefined;
}): ReadonlyArray<NewMateDoorMate> {
  const listed = input.environments.flatMap(({ item }) =>
    hasMate(item)
      ? [
          {
            projectId: item.project.id,
            name: projectNameInApp(item.project),
            ...(input.awaitsYourSignIn?.(item) === true ? { awaitsYourSignIn: true as const } : {}),
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

/**
 * Every step before the wait is through — Zerops accepted its one import, so the platform finishes
 * it and the Mate needs no browser — and its registration, where it writes one, went through or was
 * refused: its record may go.
 */
export function pressThrough(progress: ReadonlyArray<EnvironmentCreationStepProgress>): boolean {
  return (
    progress.length > 0 &&
    progress.every(
      ({ step, state }) =>
        step.kind === "await-ready" ||
        state === "done" ||
        (step.kind === "register" && state === "failed"),
    )
  );
}
