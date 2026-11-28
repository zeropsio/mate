/**
 * A conversation opened at a task's card: `?task=<HQ's id of it>` on the conversation's address,
 * which a Take and the Board's Open its conversation go to, so a reload or a shared link lands there
 * too. Once the list has placed itself and holds the card's row, the row is scrolled into view (the
 * list's own way there, so it stops following its end) and the address drops the task, so nothing
 * scrolls there again. A card the list does not hold yet (a brief still queued behind a turn, a
 * card above what is read) waits for its row; nothing moves meanwhile.
 */
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect } from "react";

/** HQ's ids are short; anything else names no task. */
const TASK_ID = /^[A-Za-z0-9_-]{1,64}$/u;

/** The conversation route's search: the task whose card it opens at, if any. */
export function taskCardSearch(raw: Record<string, unknown>): { readonly task?: string } {
  return typeof raw.task === "string" && TASK_ID.test(raw.task) ? { task: raw.task } : {};
}

/** Scrolls to the card of the task the address names (`taskCardSearch`), once its row is there. */
export function useTaskCardReveal(
  rows: ReadonlyArray<{ readonly kind: string; readonly taskId?: string | null }>,
  placed: boolean,
  scrollTo: (index: number) => void,
): void {
  const taskId = useSearch({ strict: false, select: (search) => taskCardSearch(search).task });
  const navigate = useNavigate();
  useEffect(() => {
    if (taskId === undefined || !placed) return;
    const index = rows.findIndex((row) => row.kind === "task-ask" && row.taskId === taskId);
    if (index < 0) return;
    void navigate({ to: ".", replace: true, search: ({ task: _shown, ...rest }) => rest });
    scrollTo(index);
  }, [navigate, placed, rows, scrollTo, taskId]);
}
