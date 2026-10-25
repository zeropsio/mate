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
 * The rule is the conversation header's Review (`headerReviewItems`): this Mate's own code change,
 * described at its head (a draft asks nothing), its Mate at rest (D7). A recipe change is the
 * group's document and is left to the projects page.
 *
 * A change that does not merge as it stands — it conflicts with `main`, HQ still checks it, or
 * `main` holds all of it — waits on the Mate or on HQ, not on the person, yet the header counts it:
 * the strip lists it too, after those that merge, in the word its row says (`changeState`: one
 * answer on every surface) and with the fix its review offers (`Ask Wren to resolve it`), so the
 * header's count and the strip's never part (the rehearsal of 2026-10-25: "Review 2" over a strip
 * of one). Only a change that merges makes the Mate's face need the person (`waiting`).
 *
 * A Mate may hold several changes at once, one per branch: the conversation offers every one of
 * them, the change on the branch its lease is bound to first, then the newest that merge, then the
 * newest of the rest (the owner, D-7, 2026-10-25) — the conversation's own work leads, and nothing
 * of its Mate's is hidden.
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module mateNextStep
 */

import {
  byNewest,
  changeShowsReview,
  changeState,
  sidebarChangeLabel,
  type FlowPullRequest,
} from "./projectFlow.ts";
import { changeMergeVerdict, type ReviewFixProblem } from "./reviewVerdict.ts";

/** How many of its waiting changes the strip lists, each with its own Review. */
export const MATE_NEXT_STEP_LINES = 3;

/**
 * What a change that does not merge as it stands says on its line: the word its row says
 * (`changeState` — `Conflicts with main`, `Checking`, `Nothing to merge`), and the fix its review
 * offers (`changeMergeVerdict`), where the Mate is the viewer's and its name is known.
 */
export interface MateNextStepVerdict {
  readonly title: string;
  /** `Ask Wren to resolve it`, and what goes into the Mate's composer; else its line offers Review. */
  readonly fix?: { readonly label: string; readonly problem: ReviewFixProblem } | undefined;
}

export interface MateNextStepLine {
  readonly pull: FlowPullRequest;
  /** As the menu names it: `apidev #1 Rebuild the API`. */
  readonly label: string;
  /** Where it does not merge as it stands; absent on a change that merges. */
  readonly verdict?: MateNextStepVerdict | undefined;
}

export type MateNextStep =
  | {
      readonly kind: "review";
      /**
       * The change on the conversation's own branch, else the newest of those that merge, else the
       * newest of the rest.
       */
      readonly pull: FlowPullRequest;
      /**
       * `Wren is waiting for your review`, its change's title under it — or `… of 2 changes` where
       * the header counts more than one.
       */
      readonly title: string;
      /** What the leading change is: its own title. */
      readonly detail: string;
      /**
       * Where more than one is listed, or one that does not merge, the first three — the
       * conversation's own branch's, then those that merge, then the rest, each newest first — each
       * named as the menu names it (`apidev #1 Rebuild the API`); none where one change waits and
       * merges, which the title names.
       */
      readonly lines: ReadonlyArray<MateNextStepLine>;
      /** How many more are listed past the lines. */
      readonly more: number;
      /** How many of them wait on the person: HQ said they merge. The rest wait on the Mate or HQ. */
      readonly waiting: number;
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

  // The conversation's own branch's change first; then those that merge, which wait on the person,
  // before those that do not; within each, the newest by its last move where a Mate has two — its
  // number is per repository, so two repositories' #1s would tie — and by number after that, so
  // the strip is stable.
  const merges = (entry: FlowPullRequest) => entry.mergeability === "mergeable";
  const rank = (entry: FlowPullRequest) =>
    input.boundBranch !== undefined && entry.branch === input.boundBranch
      ? 0
      : merges(entry)
        ? 1
        : 2;
  const listed = pullRequests
    .filter(
      (entry) =>
        entry.kind === "code" &&
        entry.mateProjectId === mateProjectId &&
        !entry.merged &&
        changeShowsReview(entry, { working: input.working }),
    )
    .sort((left, right) => rank(left) - rank(right) || byNewest(left, right));
  const [pull] = listed;
  if (pull === undefined) return NONE;
  const waiting = listed.filter(merges).length;
  const who = `${input.mateName ?? "This Mate"} is waiting for ${
    input.yours === false ? "a" : "your"
  } review`;
  if (listed.length === 1 && merges(pull)) {
    // The change goes by its title, on the line under this one.
    return {
      kind: "review",
      pull,
      title: who,
      detail: pull.title,
      lines: [],
      more: 0,
      waiting,
    };
  }
  return {
    kind: "review",
    pull,
    title: listed.length === 1 ? who : `${who} of ${String(listed.length)} changes`,
    detail: pull.title,
    lines: listed.slice(0, MATE_NEXT_STEP_LINES).map((entry) => {
      const line = { pull: entry, label: sidebarChangeLabel(entry, pullRequests) };
      return merges(entry) ? line : { ...line, verdict: notMerging(entry, input) };
    }),
    more: Math.max(0, listed.length - MATE_NEXT_STEP_LINES),
    waiting,
  };
}

/**
 * A change that does not merge as it stands: its row's word, and its review's fix — offered only to
 * the Mate's own person, who alone writes to it, by the Mate's name.
 */
function notMerging(
  pull: FlowPullRequest,
  mate: { readonly mateName: string | undefined; readonly yours?: boolean },
): MateNextStepVerdict {
  const { verdict } = changeMergeVerdict({ pull, mateName: mate.mateName ?? "This Mate" });
  const title = changeState(pull)?.word ?? verdict.title;
  if (verdict.fix === undefined || mate.yours === false || mate.mateName === undefined) {
    return { title };
  }
  return {
    title,
    fix: { label: `Ask ${mate.mateName} to ${verdict.fix.verb}`, problem: verdict.fix.problem },
  };
}
