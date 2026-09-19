/**
 * Whether a change can land, and what moves it if it cannot.
 *
 * A change's page opened on a definition list — *Change*, *Opened by*,
 * *Checks*, *Merges* — four rows of equal weight, two of which said the same
 * thing in different words, and none of which answered the question anybody
 * opens a change with: can this go in? The reader assembled the answer from a
 * greyed-out button and a row two lines below it. That is the page doing none
 * of the work, and it is the same failure a project's page had before
 * `projectAttention` (the owner, 2026-09-19: "this didn't go through the
 * redesign like the group / prod / stage").
 *
 * So the page leads with one sentence and the verb that acts on it, and the
 * facts that were rows become the line under the title. The sentence is here
 * because it is a product decision, not a layout one — a harness and a test
 * can read every state of it without a forge behind them.
 *
 * Two states read alike and are not: a forge refuses a merge when the checks
 * are required and failed, and allows one when nothing required them. The
 * first says so; the second says only that the checks failed, because greying
 * out a button the forge would in fact accept is a lie, and leaving it lit
 * with no explanation is a trap.
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module changeVerdict
 */

import type { ServiceStatusToneId } from "@t3tools/shared/brand";

import type { GitCheckTone } from "./gitTab.ts";
import { pullRequestBlocked } from "./projectFlow.ts";

export type ChangeVerdictKind =
  | "ready"
  | "unchecked"
  | "checks-running"
  | "checks-failed"
  | "behind";

/** Where a change stands, as its own page says it. */
export interface ChangeVerdict {
  readonly kind: ChangeVerdictKind;
  readonly tone: ServiceStatusToneId;
  /** One sentence: what is true of this change right now. */
  readonly text: string;
  /**
   * The exact words that move it, where handing it to the Mate that wrote it
   * is what moves it — `undefined` where nothing is waiting on anybody.
   */
  readonly ask: string | undefined;
  /** Whether the forge would take a merge. Not whether it is a good idea. */
  readonly canMerge: boolean;
}

export function changeVerdict(pull: {
  readonly number: number;
  readonly mergeable: boolean;
  readonly checks: GitCheckTone;
}): ChangeVerdict {
  const blocked = pullRequestBlocked(pull);
  if (blocked !== null) {
    return {
      kind: blocked.kind,
      tone: blocked.tone,
      text: REFUSED_TEXT[blocked.kind],
      ask: blocked.ask,
      canMerge: false,
    };
  }
  switch (pull.checks) {
    case "failing":
      // Allowed, and still worth somebody's time — so the same words that
      // would fix a blocked change are offered on one the forge will take.
      return {
        kind: "checks-failed",
        tone: "failed",
        text: "The checks failed.",
        ask: pullRequestBlocked({ ...pull, mergeable: false })?.ask,
        canMerge: true,
      };
    case "pending":
      return {
        kind: "checks-running",
        tone: "busy",
        text: REFUSED_TEXT["checks-running"],
        ask: undefined,
        canMerge: true,
      };
    case "none":
      // No signal is not a good signal, so it is grey rather than green.
      return {
        kind: "unchecked",
        tone: "off",
        text: "No checks ran here. Nothing is stopping this change.",
        ask: undefined,
        canMerge: true,
      };
    case "passing":
      return {
        kind: "ready",
        tone: "ok",
        text: "The checks passed. Nothing is stopping this change.",
        ask: undefined,
        canMerge: true,
      };
  }
}

/** What the forge's refusal means, said to a person rather than to a client. */
const REFUSED_TEXT: Record<"checks-running" | "checks-failed" | "behind", string> = {
  "checks-running": "The checks are still running.",
  "checks-failed": "The checks failed, and this change cannot land until they pass.",
  behind: "This change no longer merges cleanly.",
};
