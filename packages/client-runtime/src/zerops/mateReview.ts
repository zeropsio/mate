/**
 * What a Mate is waiting to have merged, offered where the person is already
 * looking: the conversation (the owner, 2026-09-18 — "can the merge request
 * have a mergable button directly in the chat?").
 *
 * A Mate has one branch and one open pull request on it (`projectFlow.ts`), so
 * there is exactly one thing to offer and no list to draw. The offer exists
 * only where Gitea has already said this person may merge that branch: the
 * app never guesses a right the forge decides.
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module mateReview
 */

import type { FlowPullRequest } from "./projectFlow.ts";

/** The one request a Mate's conversation offers, and the words beside it. */
export interface MateReviewOffer {
  readonly pull: FlowPullRequest;
  /** `Iris is waiting on you to merge #4.` — what the row says. */
  readonly title: string;
}

/**
 * The Mate's own open request, when it is this Mate's and Gitea says it merges.
 *
 * A recipe change is not offered here: it is the group's document, not this
 * Mate's work, and it lands on the projects screen where the group lives. The
 * newest is taken where a Mate somehow has two, so the row is stable.
 */
export function mateReviewOffer(input: {
  readonly pullRequests: ReadonlyArray<FlowPullRequest>;
  /** The Zerops project of the Mate whose conversation this is. */
  readonly mateProjectId: string | undefined;
  /** What that Mate is called; the row says its name, never a bot login. */
  readonly mateName: string | undefined;
}): MateReviewOffer | undefined {
  if (input.mateProjectId === undefined) return undefined;
  const mine = input.pullRequests.filter(
    (pull) =>
      pull.mateProjectId === input.mateProjectId && pull.kind === "code" && pull.mergeable === true,
  );
  const pull = [...mine].sort((left, right) => right.number - left.number)[0];
  if (pull === undefined) return undefined;
  const who = input.mateName ?? "This Mate";
  return { pull, title: `${who} is waiting on you to merge #${pull.number}.` };
}

/** The verb beside it, and what it reads while it runs. */
export const MATE_REVIEW_MERGE_LABEL = "Merge";
export const MATE_REVIEW_MERGE_RUNNING = "Merging…";
