/**
 * What a project needs a person for, in the order it needs them.
 *
 * A project's page listed its environments, its open changes, what was merged
 * and not live, and its history — four sections of equal weight, none of which
 * answers the question anybody opens the page with. The reader had to hold all
 * four in their head and work out whether anything was waiting on them. That
 * is the page doing none of the work.
 *
 * So the page leads with the answer, and the answer is derived here. Each item
 * names one thing and where it is dealt with; the page turns each into a way
 * there. Nothing waiting is itself an answer worth saying out loud — a
 * dashboard that goes blank when all is well teaches nobody to trust it.
 *
 * ## The order
 *
 * A Mate that has stopped and is waiting for an answer is first: it is the
 * only item where work is *not happening* until somebody acts, and it is the
 * one this product exists to surface. Then a deploy that failed, which is
 * something broken rather than something pending. Then a change that cannot
 * land. Then work merged and not live, which is the mildest — it is waiting
 * on a decision, not on a fix.
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module projectAttention
 */

import { pullRequestBlocked } from "./gitTab.ts";
import type { FlowPullRequest } from "./projectFlow.ts";

export type ProjectAttentionKind =
  | "mate-waiting"
  | "deploy-failed"
  | "change-blocked"
  | "not-live"
  | "never-deployed";

/** One thing a project needs somebody for. */
export interface ProjectAttentionItem {
  readonly kind: ProjectAttentionKind;
  /** What is waiting, in one line. */
  readonly text: string;
  /** The verb that deals with it, where the page has one. */
  readonly verb: string | undefined;
  /**
   * What the verb acts on: a Mate's project for a Mate, a change for a change,
   * a stop's project for a deploy. `undefined` where the verb is the project's
   * own (a release).
   */
  readonly target:
    | { readonly kind: "mate"; readonly projectId: string }
    | { readonly kind: "change"; readonly repository: string; readonly number: number }
    | { readonly kind: "stop"; readonly projectId: string }
    | undefined;
}

export interface ProjectAttentionInput {
  /** Mates that have stopped and are waiting on an answer. */
  readonly waitingMates: ReadonlyArray<{ readonly projectId: string; readonly name: string }>;
  /** Stops whose last deploy failed. */
  readonly failedStops: ReadonlyArray<{ readonly projectId: string; readonly name: string }>;
  readonly pullRequests: ReadonlyArray<FlowPullRequest>;
  /** How many commits are merged and not in front of people yet. */
  readonly notLive: number;
  /** Whether *Release* is offered at all; it is not always the account's to press. */
  readonly canRelease: boolean;
  /** What a Mate is called, for a change that names one. */
  readonly mateNames: ReadonlyMap<string, string>;
}

/** Everything waiting, worst first. Empty means nothing is. */
export function projectAttention(
  input: ProjectAttentionInput,
): ReadonlyArray<ProjectAttentionItem> {
  const items: Array<ProjectAttentionItem> = [];

  for (const mate of input.waitingMates) {
    items.push({
      kind: "mate-waiting",
      text: `${mate.name} is waiting on an answer`,
      verb: "Open",
      target: { kind: "mate", projectId: mate.projectId },
    });
  }

  for (const stop of input.failedStops) {
    items.push({
      kind: "deploy-failed",
      text: `The last deploy to ${stop.name} failed`,
      verb: "See the build",
      target: { kind: "stop", projectId: stop.projectId },
    });
  }

  for (const pull of input.pullRequests) {
    const blocked = pullRequestBlocked(pull);
    // Checks merely running are not waiting on anybody: waiting is correct.
    if (blocked === null || blocked.ask === undefined) continue;
    const mate =
      pull.mateProjectId === undefined ? undefined : input.mateNames.get(pull.mateProjectId);
    items.push({
      kind: "change-blocked",
      text: `#${String(pull.number)} ${blocked.word.toLocaleLowerCase()}`,
      verb: mate === undefined ? "Ask the Mate" : `Ask ${mate}`,
      target: { kind: "change", repository: pull.repository, number: pull.number },
    });
  }

  if (input.notLive > 0 && input.canRelease) {
    items.push({
      kind: "not-live",
      text: notLiveText(input.notLive, ""),
      verb: "Release",
      target: undefined,
    });
  }

  return items;
}

/** How many changes are merged and not live, said as a person would. */
function notLiveText(count: number, here: string): string {
  return count === 1
    ? `1 change is merged and not live${here}`
    : `${String(count)} changes are merged and not live${here}`;
}

/**
 * The same question one zoom in: what does *this* environment need somebody for.
 *
 * A stop's page listed what is running, what is not in it yet, where it answers
 * and how it got here — and, like the project's page before it, left the reader
 * to work out from a red dot and a count whether any of that was waiting on
 * them. It is the same panel because it is the same question; the answers are
 * just the ones an environment can give.
 *
 * Two of them carry no verb on purpose. The build behind a failed deploy is
 * drawn further down this very page, so a button would either scroll or go
 * where the reader already is; and nothing in this app deploys to an empty
 * environment directly — a merge or a release puts something there.
 */
export function environmentAttention(input: {
  /** Whether the last deploy here failed. */
  readonly failed: boolean;
  /** Whether anything has ever been deployed here at all. */
  readonly deployed: boolean;
  readonly production: boolean;
  /** How many commits are merged and not in front of people yet. */
  readonly notLive: number;
  readonly canRelease: boolean;
}): ReadonlyArray<ProjectAttentionItem> {
  const items: Array<ProjectAttentionItem> = [];
  if (input.failed) {
    items.push({
      kind: "deploy-failed",
      text: "The last deploy here failed",
      verb: undefined,
      target: undefined,
    });
  }
  if (!input.deployed) {
    items.push({
      kind: "never-deployed",
      text: "Nothing has been deployed here yet",
      verb: undefined,
      target: undefined,
    });
  }
  // Only a production is behind anything: a stage is where the work already is.
  if (input.production && input.canRelease && input.notLive > 0) {
    items.push({
      kind: "not-live",
      text: notLiveText(input.notLive, " here"),
      verb: "Release",
      target: undefined,
    });
  }
  return items;
}

/**
 * The line a project wears when nothing is waiting.
 *
 * Said rather than left blank: a panel that disappears when all is well is a
 * panel nobody learns to trust, because its absence and its failure to render
 * look identical.
 */
export const PROJECT_ALL_CLEAR = "Nothing needs you here.";
