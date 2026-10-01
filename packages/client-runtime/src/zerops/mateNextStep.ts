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
 * change, only where Gitea said it merges — a change that conflicts or is
 * still being checked waits on the Mate or on Gitea, not on the person. A
 * recipe change is the group's document and is left to the projects page.
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module mateNextStep
 */

import {
  byNewest,
  changeNamesRepository,
  sidebarChangeLabel,
  type FlowPullRequest,
} from "./projectFlow.ts";

/** How many of its waiting changes the strip lists, each with its own Review. */
export const MATE_NEXT_STEP_LINES = 3;

export type MateNextStep =
  | {
      readonly kind: "review";
      /** The newest of its waiting changes. */
      readonly pull: FlowPullRequest;
      /**
       * `Wren is waiting for your review of #1` — `of apidev #1` where its changes span
       * repositories — or `of 2 changes` where more than one waits.
       */
      readonly title: string;
      /** What the newest change is: its own title. */
      readonly detail: string;
      /**
       * Where more than one waits, the newest three, each named as the menu names it
       * (`apidev #1 Rebuild the API`); none where one waits, which the title names.
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
}): MateNextStep {
  const { pullRequests, mateProjectId } = input;
  if (pullRequests === undefined || mateProjectId === undefined) return NONE;

  // The newest by its last move where a Mate has two — its number is per repository, so two
  // repositories' #1s would tie — and by number after that, so the strip is stable.
  const waiting = pullRequests
    .filter(
      (entry) =>
        entry.kind === "code" &&
        entry.mateProjectId === mateProjectId &&
        !entry.merged &&
        entry.mergeability === "mergeable",
    )
    .sort(byNewest);
  const [pull] = waiting;
  if (pull === undefined) return NONE;
  const who = `${input.mateName ?? "This Mate"} is waiting for your review of`;
  if (waiting.length === 1) {
    return {
      kind: "review",
      pull,
      title: `${who} ${
        changeNamesRepository(pull, pullRequests) ? `${pull.repository} ` : ""
      }#${String(pull.number)}`,
      detail: pull.title,
      lines: [],
      more: 0,
    };
  }
  return {
    kind: "review",
    pull,
    title: `${who} ${String(waiting.length)} changes`,
    detail: pull.title,
    lines: waiting.slice(0, MATE_NEXT_STEP_LINES).map((entry) => ({
      pull: entry,
      label: sidebarChangeLabel(entry, pullRequests),
    })),
    more: Math.max(0, waiting.length - MATE_NEXT_STEP_LINES),
  };
}
