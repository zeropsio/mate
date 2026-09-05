/**
 * Which of the account's projects belong in the left menu.
 *
 * The rule is one fact: **the project has a Mate container**. Not "is
 * connected" — a container that is asleep, restarting or wiped by a redeploy
 * is still somewhere you work, and keying the menu on a live session would
 * reshuffle a person's navigation every time the platform hiccuped. Presence
 * is durable; only the status dot moves.
 *
 * It is also not "is tagged into a group". A tag is grouping, not membership:
 * a tagged project with no container would be a menu row that opens nothing,
 * and "remove from the menu" would have to mean "leave the group".
 *
 * `candidates.ts` already answers the question — it emits a candidate with a
 * `service` for every zcp container it finds, and a service-less `unavailable`
 * for a project that has none — so this only has to read that, never re-derive
 * it.
 */
import type { ZeropsCandidate } from "./candidates.ts";

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

/** A candidate is a menu row only if a Mate container backs it. */
export function hasMateContainer(candidate: ZeropsCandidate): boolean {
  return candidate.service !== undefined;
}

/**
 * The left menu's rows: one per project that has Mate, best container first.
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
    if (!hasMateContainer(candidate)) continue;
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
  if (candidates.some(hasMateContainer)) return undefined;
  return candidates.length === 0 ? "no-projects" : "no-mate";
}
