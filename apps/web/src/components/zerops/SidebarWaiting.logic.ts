/**
 * What waits on the viewer, one list: the Mates' things — a plan to approve, a question to answer,
 * a Mate of theirs stopped on an error, a change of theirs to review — in the menu's order, then
 * every project whose release is offered. The Waiting on you row says the first two in a few plain
 * words; its list holds each with the buttons that act on it.
 */
import { changesCountWords } from "@t3tools/client-runtime/zerops";
import type { MateMarkState, MateShapeId, MateTintId } from "@t3tools/shared/brand";
import type { ThreadStatusKind } from "@t3tools/shared/threadStatus";

export type WaitingKind = "plan" | "question" | "failed" | "change";

/** A Mate's change that waits for the viewer's review: the review's own target. */
export interface WaitingChange {
  readonly groupId: string;
  readonly repository: string;
  readonly number: number;
  readonly title: string;
}

export interface WaitingMate {
  readonly projectId: string;
  readonly name: string;
  readonly tint: MateTintId;
  /** The shape its person picked, else its tint's own (`mateShapeOf`). */
  readonly shape: MateShapeId;
  readonly face: MateMarkState;
  readonly kind: WaitingKind;
  /** Its words for it: the question, the plan, the error, the change's title. */
  readonly text?: string | undefined;
  /** Where its conversation is, for the list to answer it in place. */
  readonly environmentId?: string | undefined;
  readonly threadId?: string | undefined;
  /** Its change waiting for review, where that is what waits. */
  readonly change?: WaitingChange | undefined;
}

/** A project whose next release is offered: what is on its stage, not yet in production. */
export interface WaitingRelease {
  readonly changeCount?: number | undefined;
  readonly groupId: string;
  readonly name: string;
  /** How many changes the release would carry; unknown where HQ did not count. */
  readonly ahead: number | undefined;
}

export type WaitingItem =
  | { readonly kind: WaitingKind; readonly key: string; readonly mate: WaitingMate }
  | { readonly kind: "release"; readonly key: string; readonly release: WaitingRelease };

/**
 * What a Mate waiting on the viewer waits for, by the one resolver's kind (R5): asking comes
 * before its change, since the change waits on the answer.
 */
export function waitingKindOf(input: {
  readonly activityKind: ThreadStatusKind | undefined;
  readonly reviewWaits: boolean;
}): WaitingKind {
  if (input.activityKind === "failed") return "failed";
  if (input.activityKind === "planReady") return "plan";
  if (input.activityKind === "input" || input.activityKind === "approval") return "question";
  return input.reviewWaits ? "change" : "question";
}

export function waitingItemsOf(input: {
  readonly mates: ReadonlyArray<WaitingMate>;
  readonly releases: ReadonlyArray<WaitingRelease>;
}): ReadonlyArray<WaitingItem> {
  return [
    ...input.mates.map((mate) => ({ kind: mate.kind, key: `m:${mate.projectId}`, mate })),
    ...input.releases.map((release) => ({
      kind: "release" as const,
      key: `r:${release.groupId}`,
      release,
    })),
  ];
}

export function waitingPhrase(item: WaitingItem): string {
  if (item.kind === "release") return `Release ${item.release.name}`;
  const { name } = item.mate;
  switch (item.kind) {
    case "plan":
      return `Approve ${name}'s plan`;
    case "change":
      return `Review ${name}'s change`;
    case "failed":
      return `Help ${name}`;
    case "question":
      return `Answer ${name}`;
  }
}

/** The row's line: the first two things, and how many more wait. */
export function waitingSummary(items: ReadonlyArray<WaitingItem>): {
  readonly words: string;
  readonly more: number;
} {
  const shown = items.slice(0, 2);
  return { words: shown.map(waitingPhrase).join(" · "), more: items.length - shown.length };
}

/**
 * What a bare count of the waiting things says it counts — its accessible name, and the line its
 * tooltip carries under "Waiting on you" — so a number never stands without its noun.
 */
export function waitingCountWords(items: ReadonlyArray<WaitingItem>): {
  readonly label: string;
  readonly line: string;
} {
  const { words, more } = waitingSummary(items);
  return {
    label: `${String(items.length)} waiting on you: ${words}${more > 0 ? `, ${String(more)} more` : ""}`,
    line: `${words}${more > 0 ? ` · ${String(more)} more` : ""}`,
  };
}

/** An item's title in the list: the Mate's name, or the release in a sentence. */
export function waitingTitle(item: WaitingItem): string {
  return item.kind === "release" ? `${item.release.name} is ready to release` : item.mate.name;
}

export function releaseWaitingLine(release: WaitingRelease): string {
  const { ahead } = release;
  if (ahead === undefined || ahead <= 0) return "What is on stage is not in production yet.";
  if (release.changeCount !== undefined)
    return `${changesCountWords(ahead, false, release.changeCount)} waiting for production.`;
  return `${String(ahead)} change${ahead === 1 ? " is" : "s are"} on stage, not yet in production.`;
}
