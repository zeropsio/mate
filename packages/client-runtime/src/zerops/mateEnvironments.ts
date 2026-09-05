/**
 * Which of the account's projects have a Mate — the rows of the left menu and
 * the cards of the projects screen.
 *
 * The rule is a declared fact with a fallback, and one exclusion:
 *
 * - **The project says so** — it carries the `mate` marker tag (`groups.ts`).
 *   Written when the Mate is set up, kept when its container is rebuilt or
 *   lost, visible in the Zerops GUI: the Mate exists whether or not its body
 *   is there right now. Not "is connected" — keying membership on a live
 *   session would reshuffle a person's navigation every time the platform
 *   hiccuped. Presence is durable; only the face moves.
 * - **Or a Mate container is there** — a project set up before the marker
 *   existed, or by something that does not write it, is still a Mate.
 *   `candidates.ts` already emits a candidate with a `service` per zcp
 *   container, so this only reads that.
 * - **Never stage or production.** A Mate is a coding agent with a shell in
 *   the environment; that is what a dev box is for and not what stage or
 *   production are for — they get their code from dev. A container found in
 *   one is a fact about the platform, not a Mate, and the row is an
 *   environment's.
 *
 * It is not "is tagged into a group": a group tag is grouping, not membership.
 */
import type { ZeropsCandidate } from "./candidates.ts";
import { readZeropsGroupTags } from "./groups.ts";

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

/** A Mate container backs this candidate — the body, whether or not the project declares the Mate. */
export function hasMateContainer(candidate: ZeropsCandidate): boolean {
  return candidate.service !== undefined;
}

/** A Mate lives here — see the module doc for the rule. */
export function hasMate(candidate: ZeropsCandidate): boolean {
  const tags = readZeropsGroupTags(candidate.project.tagList);
  if (tags.role === "stage" || tags.role === "prod") return false;
  return tags.mate || hasMateContainer(candidate);
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
export function mateEnvironmentsEmptyReason(
  candidates: ReadonlyArray<ZeropsCandidate>,
): "no-projects" | "no-mate" | undefined {
  if (candidates.some(hasMate)) return undefined;
  return candidates.length === 0 ? "no-projects" : "no-mate";
}
