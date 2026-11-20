/**
 * Reviewing together: several changes waiting for the same person, read one after another in one
 * review. Each change is still reviewed on its own — its own diff, checks and Merge — the queue only
 * says where the person stands ("1 of 3"), steps to the next and the previous change, and after a
 * merge moves on to the next one instead of leaving the person on a change that is done.
 *
 * A change another builds on comes before it; otherwise the oldest first (its number grows within
 * its repository as changes open). A change that settles while queued — merged elsewhere, closed,
 * folded by its Mate — leaves the queue quietly; one the person merged or asked for here stays
 * counted, so the position reads as progress. Nothing here merges: a merge is the change's own
 * press.
 *
 * Pure: no React, no clock.
 */
import type { ReviewTarget } from "~/zerops/review";

/** The press that reviews several waiting changes one after another, in one review. */
export const REVIEW_ALL_LABEL = "Review all";

export type QueuedTarget = Extract<ReviewTarget, { readonly kind: "change" }>;

/** What the person did to a queued change here: merged it, or asked the people who merge. */
export type QueuedDone = "merged" | "asked";

export interface ReviewQueue {
  /** The changes, in the order they are reviewed (`reviewQueueOrder`). */
  readonly entries: ReadonlyArray<QueuedTarget>;
  /** The change shown, by `queuedKey`. */
  readonly at: string;
  /** What the person did here, by `queuedKey`. */
  readonly done: ReadonlyMap<string, QueuedDone>;
  /** How the change shown was reached: its review comes in from that side. */
  readonly arrived?: "next" | "previous" | undefined;
}

/** One key per change, within its application. */
export function queuedKey(target: Pick<QueuedTarget, "repository" | "number">): string {
  return `${target.repository}#${String(target.number)}`;
}

/**
 * The changes in the order they are reviewed: a change before every change built on it
 * (`buildsOn`, numbers in its own repository), otherwise the oldest first. Bases outside the queue
 * hold nothing; a cycle, which HQ never sends, falls back to the oldest.
 */
export function reviewQueueOrder(
  changes: ReadonlyArray<{
    readonly target: QueuedTarget;
    readonly buildsOn?: ReadonlyArray<number> | undefined;
  }>,
): ReadonlyArray<QueuedTarget> {
  const oldest = [...changes].sort(
    (left, right) =>
      left.target.repository.localeCompare(right.target.repository) ||
      left.target.number - right.target.number,
  );
  const queued = new Set(oldest.map((entry) => queuedKey(entry.target)));
  const placed = new Set<string>();
  const order: Array<QueuedTarget> = [];
  const waitsOn = (entry: (typeof oldest)[number]) =>
    (entry.buildsOn ?? [])
      .map((number) => queuedKey({ ...entry.target, number }))
      .filter((key) => queued.has(key) && !placed.has(key));
  while (order.length < oldest.length) {
    const left = oldest.filter((entry) => !placed.has(queuedKey(entry.target)));
    const next = left.find((entry) => waitsOn(entry).length === 0) ?? left[0];
    if (next === undefined) break;
    placed.add(queuedKey(next.target));
    order.push(next.target);
  }
  return order;
}

/** A queue standing on its first change. */
export function reviewQueueStart(entries: ReadonlyArray<QueuedTarget>): ReviewQueue {
  const [first] = entries;
  return { entries, at: first === undefined ? "" : queuedKey(first), done: new Map() };
}

/** The side a queued change stands on from the one shown: where its review comes in from. */
export function reviewQueueSide(queue: ReviewQueue, target: QueuedTarget): "next" | "previous" {
  const index = (key: string) => queue.entries.findIndex((entry) => queuedKey(entry) === key);
  return index(queuedKey(target)) < index(queue.at) ? "previous" : "next";
}

/** The queue on another change, or with something done to one. */
export function reviewQueueWith(
  queue: ReviewQueue,
  change: {
    readonly at?: QueuedTarget | undefined;
    readonly arrived?: ReviewQueue["arrived"];
    readonly done?: { readonly target: QueuedTarget; readonly kind: QueuedDone } | undefined;
  },
): ReviewQueue {
  const done =
    change.done === undefined
      ? queue.done
      : new Map([...queue.done, [queuedKey(change.done.target), change.done.kind]]);
  return {
    entries: queue.entries,
    at: change.at === undefined ? queue.at : queuedKey(change.at),
    done,
    arrived: change.at === undefined ? queue.arrived : change.arrived,
  };
}

/** Whether the queue holds this change. */
export function reviewQueueHolds(queue: ReviewQueue, target: QueuedTarget): boolean {
  return queue.entries.some(
    (entry) => entry.groupId === target.groupId && queuedKey(entry) === queuedKey(target),
  );
}

/**
 * The changes still in the queue: the one shown, those done here, and those still open — a change
 * that settled elsewhere leaves. Every one stays while the open changes are not read (`open`
 * undefined).
 */
function kept(queue: ReviewQueue, open: ReadonlySet<string> | undefined) {
  return queue.entries.filter((entry) => {
    const key = queuedKey(entry);
    return key === queue.at || queue.done.has(key) || open === undefined || open.has(key);
  });
}

export interface ReviewQueueView {
  /** "1 of 3"; once every change is done, what was done: "#7, #8 and #9 merged". */
  readonly words: string;
  readonly previous?: QueuedTarget | undefined;
  readonly next?: QueuedTarget | undefined;
  /** Every change still queued is done here. */
  readonly done: boolean;
}

export function reviewQueueView(
  queue: ReviewQueue,
  open: ReadonlySet<string> | undefined,
): ReviewQueueView {
  const entries = kept(queue, open);
  const index = entries.findIndex((entry) => queuedKey(entry) === queue.at);
  const done = entries.length > 0 && entries.every((entry) => queue.done.has(queuedKey(entry)));
  return {
    words: done
      ? doneWords(entries, queue.done)
      : `${String(index + 1)} of ${String(entries.length)}`,
    previous: index <= 0 ? undefined : entries[index - 1],
    next: index < 0 ? undefined : entries[index + 1],
    done,
  };
}

/**
 * Where the queue goes once the change shown is done: the next change still waiting after it,
 * else one the person skipped before it; none when every change is done, or when the change shown
 * is not done — a refusal, a conflict or a change that moved stays where it is.
 */
export function reviewQueueAfterPress(
  queue: ReviewQueue,
  open: ReadonlySet<string> | undefined,
): QueuedTarget | undefined {
  if (!queue.done.has(queue.at)) return undefined;
  const entries = kept(queue, open);
  const index = entries.findIndex((entry) => queuedKey(entry) === queue.at);
  const waiting = (entry: QueuedTarget) => !queue.done.has(queuedKey(entry));
  return entries.slice(index + 1).find(waiting) ?? entries.slice(0, index).find(waiting);
}

/** "#7, #8 and #9 merged", "Asked to merge #7 and #8": what the queue did, in its order. */
function doneWords(
  entries: ReadonlyArray<QueuedTarget>,
  done: ReadonlyMap<string, QueuedDone>,
): string {
  const numbers = (kind: QueuedDone) =>
    entries
      .filter((entry) => done.get(queuedKey(entry)) === kind)
      .map((entry) => `#${String(entry.number)}`);
  const merged = numbers("merged");
  const asked = numbers("asked");
  return [
    merged.length === 0 ? undefined : `${listed(merged)} merged`,
    asked.length === 0 ? undefined : `Asked to merge ${listed(asked)}`,
  ]
    .filter((words) => words !== undefined)
    .join(" · ");
}

function listed(words: ReadonlyArray<string>): string {
  return words.length <= 1
    ? (words[0] ?? "")
    : `${words.slice(0, -1).join(", ")} and ${words.at(-1) ?? ""}`;
}
