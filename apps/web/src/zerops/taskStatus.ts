/**
 * Where an automated Mate's task stands, in one vocabulary for every surface that says it — the
 * task conversation's session band, the project's Automation board, the menu row, Usage: the
 * same word for the same state, and the same dot beside it. Time means one thing too: how long
 * the task worked (`workedWords`, never the wall time since it came), and for one that ended,
 * when it ended (`endedWords`).
 */
import type { HqAppTask } from "@t3tools/shared/hqIntake";

export type TaskStatus =
  | "held"
  | "queued"
  | "taken"
  | "starting"
  | "working"
  | "waiting"
  | "stopping"
  | "review"
  | "merged"
  | "closed"
  | "done"
  | "failed"
  | "stopped";

/**
 * Each status in a word or two, as every surface says it beside its dot: the Board's lane words
 * where a lane holds it, so a task a person took says In progress wherever it is drawn.
 */
export const TASK_STATUS_WORDS: Readonly<Record<TaskStatus, string>> = {
  held: "Waits for other tasks",
  queued: "Queued",
  taken: "In progress",
  starting: "Starting",
  working: "Working",
  waiting: "Waiting for you",
  stopping: "Stopping",
  review: "Up for review",
  merged: "Merged",
  closed: "Closed",
  done: "Done",
  failed: "Failed",
  stopped: "Stopped",
};

/** What a status's dot means: its Mate at work, a person needed, a change to look at, a failure, or quiet. */
export type TaskTone = "working" | "needs" | "review" | "finished" | "failed" | "quiet";

const TASK_STATUS_TONE: Readonly<Record<TaskStatus, TaskTone>> = {
  held: "quiet",
  queued: "quiet",
  taken: "working",
  starting: "quiet",
  working: "working",
  waiting: "needs",
  stopping: "quiet",
  review: "review",
  merged: "finished",
  closed: "quiet",
  done: "finished",
  failed: "failed",
  stopped: "quiet",
};

/** What a status's dot means, which its surface draws in its own tone. */
export const taskStatusTone = (status: TaskStatus): TaskTone => TASK_STATUS_TONE[status];

/** A task not over yet: HQ can stop it, and it is on the board's At work or Queued. */
export const isLiveStatus = (status: TaskStatus): boolean =>
  status === "held" ||
  status === "queued" ||
  status === "taken" ||
  status === "starting" ||
  status === "working" ||
  status === "waiting" ||
  status === "stopping";

/** Whether a person's Stop applies: live, and no stop taken yet. */
export const isStoppableStatus = (status: TaskStatus): boolean =>
  isLiveStatus(status) && status !== "stopping";

/**
 * Where a task stands by its own record (`HqAppTask`): done with a change is up for review, and so
 * is a task a person took once its Mate linked a change to it (HQ ends it when that merges).
 */
export function recordStatus(
  task: Pick<HqAppTask, "state" | "change" | "pullRequest" | "changes">,
): TaskStatus {
  switch (task.state) {
    case "assigned":
      return "starting";
    case "taken":
      return (task.changes?.length ?? 0) > 0 ? "review" : "taken";
    case "done":
      return task.change !== null || task.pullRequest !== null ? "review" : "done";
    default:
      return task.state;
  }
}

/** How long a task worked, at the minute its Mate reports it: "<1m", "12m", "1h 04m". */
export function workedWords(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${String(minutes)}m`;
  return `${String(Math.floor(minutes / 60))}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** When a task ended, as of `nowMs`: "just now", "4m ago", "3h ago", "2d ago"; null unknown. */
export function endedWords(endedAt: string | null, nowMs: number): string | null {
  const at = endedAt === null ? Number.NaN : Date.parse(endedAt);
  if (!Number.isFinite(at)) return null;
  const minutes = Math.max(0, Math.floor((nowMs - at) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${String(minutes)}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h ago`;
  return `${String(Math.floor(hours / 24))}d ago`;
}
