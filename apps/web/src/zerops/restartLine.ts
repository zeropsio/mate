/**
 * Which restart line (`RESTART_LINES`) a Mate says: picked when its restart is first seen and
 * kept while it lasts, so every surface showing the same restart says the same line and none
 * changes mid-restart; the next restart takes the next line. Held for the page's lifetime only.
 */
const chosen = new Map<string, number>();
let turn = 0;

/** The line for `scope`'s restart while `restarting`; undefined otherwise, forgetting the last. */
export function restartLineFor(scope: string, restarting: boolean): number | undefined {
  if (!restarting) {
    chosen.delete(scope);
    return undefined;
  }
  let line = chosen.get(scope);
  if (line === undefined) {
    line = turn;
    turn += 1;
    chosen.set(scope, line);
  }
  return line;
}
