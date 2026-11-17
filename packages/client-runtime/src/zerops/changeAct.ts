/**
 * What is being done to a change right now, in one vocabulary on every door to it — the
 * conversation's composer top and header, the menu's tags and marks, a change's chip, its rows —
 * so none says *Review* while its merge is on its way (the owner, 2026-11-17: "they do not change
 * / show indication when the merge is happening").
 *
 * A merge, a close and an ask to merge are the account's operations (`flowWrites.ts`): pending from
 * the press until HQ's records show their end, then done, refused or unresolved. Its Mate fixing it
 * is its conversation's row naming the change (`workingOn`), as the review says it
 * (`mateAtIt`). The review's own words for the same states are the source of these: "Merging into
 * main", "<Mate> is fixing it", "Not merged".
 *
 * Pure: no network, no clock, no platform globals.
 *
 * @module changeAct
 */
import type { ConversationWorkingOn } from "@t3tools/contracts";
import type { ServiceStatusToneId } from "@t3tools/shared/brand";

import type { OperationProgress } from "../data/projections/operation.ts";

export type ChangeAct =
  /** Its merge was pressed and HQ's records do not show it merged yet. */
  | { readonly kind: "merging" }
  /** Its merge, pressed here, ended merged. */
  | { readonly kind: "merged" }
  /** Its merge, pressed here at the head it still has, was refused or did not end merged. */
  | { readonly kind: "merge-failed"; readonly reason: string }
  /** Closing it without merging is on its way. */
  | { readonly kind: "closing" }
  /** Its merge is being asked of the people who merge. */
  | { readonly kind: "asking" }
  /** Its Mate works on it, asked from its review (`workingOn`). */
  | { readonly kind: "fixing"; readonly mateName: string };

/** One verb's press on a change, as the account holds it: on its way, and where its operation stands. */
export interface ChangeVerbRead {
  readonly pending: boolean;
  /** Its operation's progress, once it was recorded; absent before, or for a verb never pressed. */
  readonly progress?: OperationProgress | undefined;
  /** The head it was pressed for: a refusal is about that head only. */
  readonly head?: string | undefined;
}

const MERGING: ChangeAct = { kind: "merging" };
const MERGED: ChangeAct = { kind: "merged" };
const CLOSING: ChangeAct = { kind: "closing" };
const ASKING: ChangeAct = { kind: "asking" };

/** What HQ's end of a merge says where it named no reason. */
const NOT_MERGED = "HQ did not merge it.";

/**
 * A change's act from its verbs' presses: a press on its way first (merge, then close, then ask),
 * then its Mate at work on it, then how its last merge ended — a refusal only while the change still
 * has the head the merge was pressed for: a push since is new work, and its review says anew.
 */
export function changeActOf(input: {
  readonly merge?: ChangeVerbRead | undefined;
  readonly close?: ChangeVerbRead | undefined;
  readonly ask?: ChangeVerbRead | undefined;
  /** The change's head now. */
  readonly head?: string | undefined;
  /** Its Mate works on it, by its name (`worksOnChange`). */
  readonly fixing?: string | undefined;
}): ChangeAct | undefined {
  const { merge } = input;
  if (merge?.pending === true) return MERGING;
  if (input.close?.pending === true) return CLOSING;
  if (input.ask?.pending === true) return ASKING;
  if (input.fixing !== undefined) return { kind: "fixing", mateName: input.fixing };
  const progress = merge?.progress;
  if (progress === undefined) return undefined;
  const failed = (reason: string): ChangeAct | undefined =>
    merge?.head !== undefined && input.head !== undefined && merge.head !== input.head
      ? undefined
      : { kind: "merge-failed", reason };
  switch (progress.stage) {
    case "done":
      if (progress.outcome === "succeeded") return MERGED;
      return progress.outcome === "failed" ? failed(progress.reason ?? NOT_MERGED) : undefined;
    case "refused":
      return failed(progress.reason);
    case "unsent":
      return failed(progress.reason ?? "HQ could not be reached.");
    case "unresolved":
      return failed(progress.reason ?? "HQ didn't say whether it merged.");
    case "unknown":
      return undefined;
    default:
      // Answered and not ended: still on its way.
      return MERGING;
  }
}

/** Whether an act holds the change's next step: it waits on HQ or its Mate, never on the person. */
export function changeActBusy(act: ChangeAct | undefined): boolean {
  return (
    act?.kind === "merging" ||
    act?.kind === "closing" ||
    act?.kind === "asking" ||
    act?.kind === "fixing"
  );
}

export interface ChangeActWords {
  /** Where the change is named by its number: "Merging #7…", "#7 merged", "Couldn't merge #7". */
  readonly title: string;
  /** Where the change is already named, as a tag's word or after its name: "Merging…". */
  readonly word: string;
  readonly tone: ServiceStatusToneId;
}

/** An act's words, for the change numbered `number`. */
export function changeActWords(act: ChangeAct, number: number): ChangeActWords {
  const n = `#${String(number)}`;
  switch (act.kind) {
    case "merging":
      return { title: `Merging ${n}…`, word: "Merging…", tone: "busy" };
    case "merged":
      return { title: `${n} merged`, word: "Merged", tone: "ok" };
    case "merge-failed":
      return { title: `Couldn't merge ${n}`, word: "Couldn't merge", tone: "attention" };
    case "closing":
      return { title: `Closing ${n}…`, word: "Closing…", tone: "busy" };
    case "asking":
      return { title: `Asking to merge ${n}…`, word: "Asking…", tone: "busy" };
    case "fixing":
      return { title: `${act.mateName} is fixing ${n}`, word: "Fixing…", tone: "busy" };
  }
}

/**
 * Whether a Mate's conversations work on this change (`workingOn`): the change by its repository
 * and number, at the head it has — a push since moves it on, and the new head's verdict stands.
 */
export function worksOnChange(
  workingOn: ReadonlyArray<ConversationWorkingOn> | undefined,
  pull: {
    readonly repository?: string | undefined;
    readonly number: number;
    readonly headSha?: string | undefined;
  },
): boolean {
  return (workingOn ?? []).some(
    (on) =>
      on.kind === "change" &&
      on.repo === pull.repository &&
      on.number === pull.number &&
      (on.head === undefined || on.head === pull.headSha),
  );
}
