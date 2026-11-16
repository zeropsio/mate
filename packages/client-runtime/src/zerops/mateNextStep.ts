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
 * A change that does not merge as it stands — it conflicts with `main`, or HQ still checks it —
 * waits on the Mate or on HQ, not on the person, yet the header counts it: the strip lists it too,
 * after those that merge, in the word its row says (`changeState`: one answer on every surface)
 * and with the fix its review offers (`Ask Wren to resolve it`), so the header's count and the
 * strip's never part (the rehearsal of 2026-10-25: "Review 2" over a strip of one). Only a change
 * that merges makes the Mate's face need the person (`waiting`).
 *
 * A change `main` already holds all of waits on nobody and has no fix to offer, so neither the
 * header nor the strip counts it (`changeAsksForReview`): it is finished, not waiting (the owner,
 * 2026-11-10 — a strip of three changes waiting for a review, the third one saying `Nothing to
 * merge` under a Review of its own). HQ closes one another change's landing carried, and its own
 * page says which it was merged as part of (`landedWith`).
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

import type { ChangeStanding, ChangeStandingRead } from "./changeStanding.ts";
import {
  byNewest,
  changeShowsReview,
  changeState,
  READY_TO_MERGE,
  sidebarChangeLabel,
  type FlowPullRequest,
} from "./projectFlow.ts";
import { changeMergeVerdict, type ReviewFixProblem } from "./reviewVerdict.ts";

/** How many of its waiting changes the strip lists, each with its own Review. */
export const MATE_NEXT_STEP_LINES = 3;

/**
 * What a change that does not merge as it stands says on its line: the word its row says
 * (`changeState` — `Conflicts with main`, `Checking`), and the fix its review offers
 * (`changeMergeVerdict`), where the Mate is the viewer's and its name is known.
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
  /** {@link MateNextStepStanding} of a change that merges; absent where it is theirs to review. */
  readonly standing?: MateNextStepStanding | undefined;
  /**
   * What a change that merges says of its standing after its name (`standingWord`): "Dana L. asks
   * to merge", "Ready", "Waiting for Ada K. or Sam R."; absent on today's words.
   */
  readonly says?: string | undefined;
}

/**
 * Where a change that merges stands for the person looking where its application limits who
 * merges (`changeStanding`), past theirs to review: its press says *Ask to merge*, a plain *View*
 * where it only waits on the people who merge, or stays *Review* where somebody asked them.
 */
export type MateNextStepStanding = Exclude<ChangeStanding["kind"], "to-merge">;

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
      /**
       * How many of them wait on the person: HQ said they merge, and the person has not already
       * asked the people who merge. The rest wait on the Mate, on HQ, or on those people.
       */
      readonly waiting: number;
      /** The leading change's {@link MateNextStepStanding}, where it merges. */
      readonly standing?: MateNextStepStanding | undefined;
      /**
       * Nothing listed asks the person: every change merges and waits on the people who merge. The
       * strip says so quietly, with no press of its own.
       */
      readonly quiet?: true | undefined;
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
  /**
   * Where each change stands for the person looking (`changeStandingOf`, by the Mate's
   * application); absent, every change is theirs to review, as without a limit on who merges.
   */
  readonly standingOf?: ((pull: FlowPullRequest) => ChangeStandingRead) | undefined;
}): MateNextStep {
  const { pullRequests, mateProjectId } = input;
  if (pullRequests === undefined || mateProjectId === undefined) return NONE;

  // The conversation's own branch's change first; then those that merge, which wait on the person,
  // before those that do not; within each, the newest by its last move where a Mate has two — its
  // number is per repository, so two repositories' #1s would tie — and by number after that, so
  // the strip is stable.
  // Among those that merge: what somebody asked the person to merge first, and what they asked
  // for themselves — it waits on the people who merge, not on them — last.
  const merges = (entry: FlowPullRequest) => entry.mergeability === "mergeable";
  const rank = (entry: FlowPullRequest) => {
    if (input.boundBranch !== undefined && entry.branch === input.boundBranch) return 0;
    if (!merges(entry)) return 4;
    const kind = input.standingOf?.(entry).standing.kind;
    return kind === "asked-of-me" ? 1 : kind === "waiting" ? 3 : 2;
  };
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
  const name = input.mateName ?? "This Mate";
  const reads = new Map(listed.map((entry) => [entry, input.standingOf?.(entry)]));
  // A change that merges, by whose press it waits for; one that does not waits on its Mate or HQ.
  const standingOf = (entry: FlowPullRequest): MateNextStepStanding | undefined => {
    const kind = merges(entry) ? reads.get(entry)?.standing.kind : undefined;
    return kind === "to-merge" ? undefined : kind;
  };
  const asked = listed.filter((entry) => standingOf(entry) === "waiting");
  const ready = listed.filter((entry) => standingOf(entry) === "to-ask");
  const waiting = listed.filter(merges).length - asked.length;
  // The person cannot merge here (`ViewerMerges` "held"), whatever stops each change.
  const held = listed.some((entry) => {
    const kind = reads.get(entry)?.standing.kind;
    return kind === "to-ask" || kind === "waiting";
  });
  const count = (several: number) => `${String(several)} changes`;
  const who = held
    ? heldTitle({
        name,
        ready: ready.length,
        asked: asked.length,
        listed: listed.length,
        mergers: reads.get(asked[0] ?? pull)?.who ?? "an Owner or Admin",
      })
    : `${name} is waiting for ${input.yours === false ? "a" : "your"} review`;
  const lead = standingOf(pull);
  const standing = {
    ...(lead === undefined ? {} : { standing: lead }),
    ...(asked.length === listed.length ? { quiet: true as const } : {}),
  };
  if (listed.length === 1 && merges(pull)) {
    // The change goes by its title, on the line under this one.
    return {
      kind: "review",
      pull,
      title:
        lead === "asked-of-me"
          ? `${reads.get(pull)?.asker ?? "Someone"} asks you to merge ${name}'s change`
          : who,
      detail: pull.title,
      lines: [],
      more: 0,
      waiting,
      ...standing,
    };
  }
  return {
    kind: "review",
    pull,
    title: held || listed.length === 1 ? who : `${who} of ${count(listed.length)}`,
    detail: pull.title,
    lines: listed.slice(0, MATE_NEXT_STEP_LINES).map((entry) => {
      const line = { pull: entry, label: sidebarChangeLabel(entry, pullRequests) };
      if (!merges(entry)) return { ...line, verdict: notMerging(entry, input) };
      const kind = standingOf(entry);
      const says = reads.get(entry)?.word;
      return {
        ...line,
        ...(kind === undefined ? {} : { standing: kind }),
        // Where every line waits on the same people, the title has said so once.
        ...(says === undefined || says === READY_TO_MERGE || standing.quiet === true
          ? {}
          : { says }),
      };
    }),
    more: Math.max(0, listed.length - MATE_NEXT_STEP_LINES),
    waiting,
    ...standing,
  };
}

/**
 * The strip's title for a person who cannot merge in the Mate's application: what is ready for
 * their ask — "Nova's change is ready", "Nova has 2 changes ready" — else, once they asked, whom
 * it waits for — "Waiting for Ada K. or Sam R. to merge it", "2 changes are waiting for Ada K. or
 * Sam R." — else that nothing of it is ready yet. Never a review: that is not theirs to give.
 */
function heldTitle(input: {
  readonly name: string;
  readonly ready: number;
  readonly asked: number;
  readonly listed: number;
  readonly mergers: string;
}): string {
  const { name, ready, asked, listed } = input;
  if (ready === 1) return `${name}'s change is ready`;
  if (ready > 1) return `${name} has ${String(ready)} changes ready`;
  if (asked === 1) return `Waiting for ${input.mergers} to merge it`;
  if (asked > 1) return `${String(asked)} changes are waiting for ${input.mergers}`;
  return listed === 1
    ? `${name}'s change is not ready yet`
    : `${name} has ${String(listed)} changes not ready yet`;
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
