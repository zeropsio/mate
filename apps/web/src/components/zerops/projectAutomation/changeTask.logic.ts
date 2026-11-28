import type { HqAppTask } from "@t3tools/shared/hqIntake";

/** A change of an application, as HQ links it to a task: its repository and its number there. */
export interface TaskChangeRef {
  readonly repo: string;
  readonly number: number;
}

/**
 * The Board task a change does, read from the application's Board: the task whose own change it
 * is, or one its taker's Mate linked it to; where several link it, the latest put. `null` where
 * no task of the application links it, or the Board is not read.
 */
export function taskOfChange(
  tasks: ReadonlyArray<HqAppTask> | null,
  change: TaskChangeRef,
): HqAppTask | null {
  if (tasks === null) return null;
  const same = (link: TaskChangeRef | null) =>
    link !== null && link.repo === change.repo && link.number === change.number;
  let found: HqAppTask | null = null;
  for (const task of tasks) {
    if (!same(task.change) && !(task.changes ?? []).some(same)) continue;
    if (found === null || Date.parse(task.createdAt) > Date.parse(found.createdAt)) found = task;
  }
  return found;
}
