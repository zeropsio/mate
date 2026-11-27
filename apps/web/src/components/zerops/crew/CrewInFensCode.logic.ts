import type { CrewTask } from "@t3tools/contracts";

/** The work that went in — a commit, not a task closed with nothing of its own — newest first. */
export function crewWorkInCode(tasks: ReadonlyArray<CrewTask>): ReadonlyArray<CrewTask> {
  return tasks
    .filter((task) => task.state === "landed" && task.landedCommit !== null)
    .toSorted(
      (left, right) =>
        (right.landedAt ?? right.createdAt).localeCompare(left.landedAt ?? left.createdAt) ||
        right.number - left.number,
    );
}

/**
 * Which of the work that went in is marked as not shipped: the pieces not delivered, and only while
 * they are exactly the `notShipped` the Mate read and nothing is left to read (`unread`). A piece
 * not delivered may only be unread or past the read's bounds (`delivered` says nothing of those),
 * so where the two disagree none is marked and the footer says how many.
 */
export function crewNotShippedWork(
  work: ReadonlyArray<Pick<CrewTask, "id" | "delivered">>,
  notShipped: number,
  unread: number,
): ReadonlySet<string> {
  if (notShipped === 0 || unread > 0) return new Set();
  const pending = work.filter((task) => !task.delivered);
  return pending.length === notShipped ? new Set(pending.map((task) => task.id)) : new Set();
}
