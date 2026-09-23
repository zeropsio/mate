/**
 * The one next step a Mate's conversation offers, from the project's flow
 * rather than from what the agent said (the owner, 2026-09-23).
 *
 * The conversation is where the person asks "put it on production", and the
 * agent's answer can be wrong about how that happens: production is the
 * person's to add and to release, on the projects page, and the Mate's part
 * ends at the pull request and the recipe. So the card beside the
 * conversation answers from the flow: merge this Mate's change, then release
 * what is merged, then add the production that releases go to.
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

import { ADD_PRODUCTION_LABEL, MAIN_WITHOUT_PRODUCTION, type GroupFlow } from "./groupFlow.ts";
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
  | {
      readonly kind: "release";
      readonly tag: string;
      /** How many changes the release puts live. */
      readonly waiting: number;
      readonly title: string;
      readonly verb: string;
      readonly running: string;
    }
  | {
      readonly kind: "add-production";
      readonly title: string;
      readonly detail: string;
      readonly verb: string;
    }
  | { readonly kind: "none" };

const NONE: MateNextStep = { kind: "none" };

export function mateNextStep(input: {
  /** The flow of the project this Mate belongs to; `undefined` before it is read. */
  readonly group: GroupFlow | undefined;
  /** The Zerops project of the Mate whose conversation this is. */
  readonly mateProjectId: string | undefined;
  /** What that Mate is called; the card says its name, never a bot login. */
  readonly mateName: string | undefined;
}): MateNextStep {
  const { group, mateProjectId } = input;
  if (group === undefined || mateProjectId === undefined) return NONE;

  // The newest where a Mate somehow has two, so the card is stable.
  const pull = group.pullRequests
    .map((entry) => entry.pull)
    .filter((entry) => entry.mateProjectId === mateProjectId && entry.mergeable)
    .sort((left, right) => right.number - left.number)[0];
  if (pull !== undefined)
    return {
      kind: "merge",
      pull,
      title: `${input.mateName ?? "This Mate"} is waiting on you to merge #${String(pull.number)}.`,
      verb: flowVerbLabel("merge", false),
      running: flowVerbLabel("merge", true),
    };

  const production = group.production;
  if (production.kind === "ready-to-release") {
    const { tag, waiting } = production.candidate;
    return {
      kind: "release",
      tag,
      waiting,
      title: `Release ${tag} to production`,
      verb: `${flowVerbLabel("release", false)} ${tag}`,
      running: flowVerbLabel("release", true),
    };
  }

  if (production.kind === "absent" && production.addable)
    return {
      kind: "add-production",
      title: MAIN_WITHOUT_PRODUCTION,
      detail: "Add it from the project's recipe; releases go there.",
      verb: ADD_PRODUCTION_LABEL,
    };

  return NONE;
}
