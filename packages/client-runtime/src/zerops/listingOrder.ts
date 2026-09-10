/**
 * The one place every Zerops listing's total order lives, so a row's
 * position depends only on facts the user can see and never on whatever
 * order the backend happened to return records in.
 *
 * Two orders live here:
 *
 * - `compareZeropsHostnames` — a locale-aware, case-insensitive,
 *   numeric-aware string order (`db` < `db2` < `db10`), reused by
 *   `serviceMap.ts` for rows inside a section and by `groups.ts` for names.
 * - `rankZeropsCandidateForListing` — the tier a project-picker candidate
 *   sorts into before its name decides. Tiers change only on the user's own
 *   action (starting a project, enabling Mate on a container), never on
 *   their own — so the list does not reshuffle itself while the user is
 *   looking at it. Within a tier, name order takes over.
 *
 * @module listingOrder
 */

import type { ZeropsCandidate } from "./candidates.ts";

/**
 * Locale-aware, case-insensitive, numeric-aware: `db` sorts before `db2`,
 * which sorts before `db10` — plain string comparison would put `db10`
 * before `db2`. Ties (case or diacritics only) are broken by the tiebreak
 * the caller passes, never left to insertion order.
 */
export function compareZeropsHostnames(left: string, right: string): number {
  return left.localeCompare(right, "en", { sensitivity: "base", numeric: true });
}

/**
 * The project-picker's tiers, lowest first. A candidate's tier is the
 * primary sort key; `buildZeropsGroupTree`'s `options.rank` applies it to
 * the ungrouped list ahead of the name.
 *
 * - 0 — a Mate is there: `connected` (a live session) or `ready` (one click
 *   away).
 * - 1 — `provisioning`: the project or its container is still coming up.
 * - 2 — `unavailable` while the project itself is `ACTIVE`: Mate is not
 *   enabled on the container, the container is not answering, or there is
 *   no container yet (`missingContainer`).
 * - 3 — the project is not `ACTIVE` at all (`STOPPED` or any other
 *   non-active status) — the coarsest, least actionable case.
 */
export function rankZeropsCandidateForListing(candidate: ZeropsCandidate): number {
  if (candidate.group === "connected" || candidate.group === "ready") return 0;
  if (candidate.group === "provisioning") return 1;
  if (candidate.project.status === "ACTIVE") return 2;
  return 3;
}
