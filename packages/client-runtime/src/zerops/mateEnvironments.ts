/**
 * Which of the account's projects have a Mate — the rows of the left menu and
 * the cards of the projects screen.
 *
 * The rule is HQ's word alone: a project is a Mate only where HQ records one
 * (`groups.ts`' `mate` — HQ places it as a Mate, dev or dev/stage).
 *
 * - **Kept when its container is rebuilt or lost:** the Mate exists whether or
 *   not its body is there right now. Not "is connected" — keying membership on
 *   a live session would reshuffle a person's navigation every time the
 *   platform hiccuped. Presence is durable; only the face moves. The project's
 *   `mate` tag is the Zerops GUI's marker and says nothing here.
 * - **Never a container alone:** a zcp container in a project HQ never recorded
 *   is a fact about the platform, not the person's Mate; the left menu leaves
 *   that project to Platform (the web app's `isPlatformProject`). The menu
 *   draws no project row before HQ's first answer, so nothing stands in for
 *   HQ's word while it is unread.
 * - **Never stage or production:** HQ records a Mate only on a dev place. A
 *   Mate is a coding agent with a shell in the environment; that is what a dev
 *   box is for and not what stage or production are for — they get their code
 *   from dev. A container found in one is a fact about the platform, and the
 *   row is an environment's.
 *
 * It is not "is tagged into a group": a group tag is grouping, not membership.
 */
import type { ZeropsCandidate } from "./candidates.ts";
import { readZeropsMembership } from "./groups.ts";

/**
 * Best-first, so a project running two containers shows the one a click can
 * actually reach rather than whichever the platform happened to list first.
 */
const GROUP_RANK: Record<ZeropsCandidate["group"], number> = {
  connected: 0,
  ready: 1,
  provisioning: 2,
  unavailable: 3,
};

/** A Mate lives here: HQ records one — see the module doc for the rule. */
export function hasMate(candidate: ZeropsCandidate): boolean {
  return readZeropsMembership(candidate.project).mate;
}

/** The platform's words for a project on its way off Zerops. */
export const PROJECT_GOING_STATUSES: ReadonlySet<string> = new Set(["DELETING", "DELETED"]);

/**
 * Whether a project's *Delete* is offered, on the menu and the projects page alike: a project with
 * no Mate in it (its Mates deleted, or a stage or a production alone), to whoever writes the
 * structure (`delete_app`).
 */
export function projectDeleteOffered(input: {
  readonly withoutMate: boolean;
  readonly mayDelete: boolean;
}): boolean {
  return input.withoutMate && input.mayDelete;
}

/** Whether a group holds no Mate, listed or coming: a dev place is a Mate's. */
export function groupWithoutMate(group: {
  readonly environments: ReadonlyArray<{ readonly role: string | undefined }>;
  readonly pending: ReadonlyArray<{ readonly kind: string }>;
}): boolean {
  return (
    !group.environments.some(({ role }) => role === "dev" || role === "devstage") &&
    !group.pending.some(({ kind }) => kind === "mate")
  );
}

/**
 * One per project that has a Mate, best container first.
 *
 * Deduplicated per project because a project is one environment — one
 * container, one agent, one conversation. Two zcp containers in a project is a
 * platform accident, not a second environment, and the menu must not imply
 * otherwise.
 *
 * Input order does not matter: ties beyond the group rank break on the
 * candidate key, so the same account always produces the same menu.
 */
export function selectMateEnvironments<T extends ZeropsCandidate>(
  candidates: ReadonlyArray<T>,
): ReadonlyArray<T> {
  const best = new Map<string, T>();
  for (const candidate of candidates) {
    if (!hasMate(candidate)) continue;
    const current = best.get(candidate.project.id);
    if (current === undefined || wins(candidate, current))
      best.set(candidate.project.id, candidate);
  }
  return [...best.values()];
}

function wins(candidate: ZeropsCandidate, incumbent: ZeropsCandidate): boolean {
  const rank = GROUP_RANK[candidate.group] - GROUP_RANK[incumbent.group];
  return rank === 0 ? candidate.key < incumbent.key : rank < 0;
}

/**
 * Why the menu is empty, or `undefined` when it is not.
 *
 * The distinction the first version got wrong: an account with projects but no
 * Mate anywhere is not an account with no projects, and saying so sends the
 * reader looking for a project they already have.
 */
export function mateEnvironmentsEmptyReason<C extends ZeropsCandidate>(
  candidates: ReadonlyArray<C>,
  /** A project the menu leaves to Platform: no Mate HQ records there. */
  platformOnly: (candidate: C) => boolean = () => false,
): "no-projects" | "no-mate" | undefined {
  if (candidates.some((candidate) => hasMate(candidate) && !platformOnly(candidate)))
    return undefined;
  return candidates.length === 0 ? "no-projects" : "no-mate";
}
