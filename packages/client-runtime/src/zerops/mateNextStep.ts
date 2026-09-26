/**
 * The one next step a Mate's conversation offers, from the project's flow
 * rather than from what the agent said (the owner, 2026-09-23): the merge of
 * this Mate's own change, which waits on the person.
 *
 * Only what is this Mate's: a release carries every Mate's merges and
 * production is the project's, so both stay on the left, with the project,
 * where they read the same from every Mate's conversation (the owner,
 * 2026-09-26 — "merges could be coming from different mates").
 *
 * The merge keeps the in-chat offer's rule exactly (MB-30): this Mate's own
 * code change, only where Gitea said it merges — the app never guesses a right
 * the forge decides. A recipe change is the group's document and is left to
 * the projects page.
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module mateNextStep
 */

import { flowVerbLabel, type FlowPullRequest } from "./projectFlow.ts";

export type MateNextStep =
  | {
      readonly kind: "merge";
      readonly pull: FlowPullRequest;
      /** `Wren is waiting on you to merge #1.` */
      readonly title: string;
      readonly verb: string;
      /** What the verb reads while it runs. */
      readonly running: string;
    }
  | { readonly kind: "none" };

const NONE: MateNextStep = { kind: "none" };

export function mateNextStep(input: {
  /** The project's open changes, as its flow reads them; `undefined` before it is read. */
  readonly pullRequests: ReadonlyArray<FlowPullRequest> | undefined;
  /** The Zerops project of the Mate whose conversation this is. */
  readonly mateProjectId: string | undefined;
  /** What that Mate is called; the card says its name, never a bot login. */
  readonly mateName: string | undefined;
}): MateNextStep {
  const { pullRequests, mateProjectId } = input;
  if (pullRequests === undefined || mateProjectId === undefined) return NONE;

  // The newest where a Mate somehow has two, so the card is stable.
  const pull = pullRequests
    .filter(
      (entry) =>
        entry.kind === "code" &&
        entry.mateProjectId === mateProjectId &&
        !entry.merged &&
        entry.mergeability === "mergeable",
    )
    .sort((left, right) => right.number - left.number)[0];
  if (pull === undefined) return NONE;
  return {
    kind: "merge",
    pull,
    title: `${input.mateName ?? "This Mate"} is waiting on you to merge #${String(pull.number)}.`,
    verb: flowVerbLabel("merge", false),
    running: flowVerbLabel("merge", true),
  };
}
