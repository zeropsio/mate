/**
 * The one next step a Mate's conversation offers, from the project's flow
 * rather than from what the agent said (the owner, 2026-09-23): this Mate's
 * own change, waiting for the person's review. It is the composer's top (C3),
 * and its one door is Review (R1) — the merge happens inside the review, never
 * from here.
 *
 * Only what is this Mate's: a release carries every Mate's merges and
 * production is the project's, so both stay on the left, with the project,
 * where they read the same from every Mate's conversation (the owner,
 * 2026-09-26 — "merges could be coming from different mates").
 *
 * The rule is the in-chat offer's exactly (MB-30): this Mate's own code
 * change, described at its head (a draft asks nothing), only where HQ said it merges — a change that conflicts or is
 * still being checked waits on the Mate or on HQ, not on the person. A
 * recipe change is the group's document and is left to the projects page.
 *
 * A Mate may hold several changes at once, one per branch: the conversation offers every one of
 * them, the change on the branch its lease is bound to first, then the newest (the owner, D-7,
 * 2026-10-25) — the conversation's own work leads, and nothing of its Mate's is hidden.
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module mateNextStep
 */

import {
  byNewest,
  changeShowsReview,
  sidebarChangeLabel,
  type FlowPullRequest,
} from "./projectFlow.ts";

/** How many of its waiting changes the strip lists, each with its own Review. */
export const MATE_NEXT_STEP_LINES = 3;

export type MateNextStep =
  | {
      readonly kind: "review";
      /** The change on the conversation's own branch, else the newest of its waiting changes. */
      readonly pull: FlowPullRequest;
      /**
       * `Wren is waiting for your review`, its change's title under it — or `… of 2 changes` where
       * more than one waits.
       */
      readonly title: string;
      /** What the newest change is: its own title. */
      readonly detail: string;
      /**
       * Where more than one waits, the first three — the conversation's own branch's, then the
       * newest — each named as the menu names it (`apidev #1 Rebuild the API`); none where one
       * waits, which the title names.
       */
      readonly lines: ReadonlyArray<{ readonly pull: FlowPullRequest; readonly label: string }>;
      /** How many more wait past the lines. */
      readonly more: number;
    }
  | { readonly kind: "none" };

const NONE: MateNextStep = { kind: "none" };

export function mateNextStep(input: {
  /** The project's open changes, as its flow reads them; `undefined` before it is read. */
  readonly pullRequests: ReadonlyArray<FlowPullRequest> | undefined;
  /** The Zerops project of the Mate whose conversation this is. */
  readonly mateProjectId: string | undefined;
  /** What that Mate is called; the strip says its name, never a bot login. */
  readonly mateName: string | undefined;
  /**
   * It works in one of its chats (`changeShowsReview`). The composer's top leaves it out and gives
   * way by its own hold instead, which keeps what it remembers of the strip (a dismissal).
   */
  readonly working?: boolean;
  /** Whether the Mate is the viewer's; a colleague's waits for a review, not the viewer's. */
  readonly yours?: boolean;
  /**
   * The branch of the lease this conversation is bound to (zcp's lease binding), where it is bound
   * to one: its change leads.
   */
  readonly boundBranch?: string | undefined;
}): MateNextStep {
  const { pullRequests, mateProjectId } = input;
  if (pullRequests === undefined || mateProjectId === undefined) return NONE;

  // The conversation's own branch's change first; then the newest by its last move where a Mate
  // has two — its number is per repository, so two repositories' #1s would tie — and by number
  // after that, so the strip is stable.
  const own = (entry: FlowPullRequest) =>
    input.boundBranch !== undefined && entry.branch === input.boundBranch ? 0 : 1;
  const waiting = pullRequests
    .filter(
      (entry) =>
        entry.kind === "code" &&
        entry.mateProjectId === mateProjectId &&
        !entry.merged &&
        entry.mergeability === "mergeable" &&
        changeShowsReview(entry, { working: input.working }),
    )
    .sort((left, right) => own(left) - own(right) || byNewest(left, right));
  const [pull] = waiting;
  if (pull === undefined) return NONE;
  const who = `${input.mateName ?? "This Mate"} is waiting for ${
    input.yours === false ? "a" : "your"
  } review`;
  if (waiting.length === 1) {
    // The change goes by its title, on the line under this one.
    return {
      kind: "review",
      pull,
      title: who,
      detail: pull.title,
      lines: [],
      more: 0,
    };
  }
  return {
    kind: "review",
    pull,
    title: `${who} of ${String(waiting.length)} changes`,
    detail: pull.title,
    lines: waiting.slice(0, MATE_NEXT_STEP_LINES).map((entry) => ({
      pull: entry,
      label: sidebarChangeLabel(entry, pullRequests),
    })),
    more: Math.max(0, waiting.length - MATE_NEXT_STEP_LINES),
  };
}
