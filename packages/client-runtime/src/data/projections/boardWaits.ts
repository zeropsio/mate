/**
 * The Board's tasks that wait on the reader, as HQ's navigation says them of each application:
 * those they put whose automated Mate asks them (`asksYou`), and their held tasks whose need broke
 * (`heldBroken`). HQ decides both for the reader, so they reach Needs you even where the automated
 * Mate is in none of the reader's lists. Applications in HQ's order, each list in HQ's own.
 *
 * @module data/projections/boardWaits
 */
import { hqAppsScope } from "../families/hqNavigation.ts";
import type { Projection } from "../store.ts";
import { sameValue } from "./equal.ts";

/** One Board task waiting on the reader, with its application's name. */
export interface BoardWait {
  readonly appId: string;
  /** Its application's name, as the menu calls the project. */
  readonly appName: string;
  readonly taskId: string;
  readonly title: string;
  /**
   * When it came to wait on the reader — the task's last question (`askedAt`), or its last need's
   * break (`brokenAt`): the revision a snooze of it holds.
   */
  readonly at: string;
}

export interface BoardWaitsRead {
  readonly asksYou: ReadonlyArray<BoardWait>;
  readonly heldBroken: ReadonlyArray<BoardWait>;
}

export const NO_BOARD_WAITS: BoardWaitsRead = { asksYou: [], heldBroken: [] };

export const boardWaits: Projection<string, BoardWaitsRead> = {
  name: "boardWaits",
  keyOf: (orgId) => orgId,
  derive: (read, orgId) => {
    const asksYou: Array<BoardWait> = [];
    const heldBroken: Array<BoardWait> = [];
    for (const id of read.members(hqAppsScope(orgId)).ids) {
      const fact = read.fact("hqApp", id);
      if (fact.kind !== "known") continue;
      const appName = fact.value.name ?? "Unknown";
      for (const task of fact.value.asksYou ?? [])
        asksYou.push({
          appId: task.appId,
          appName,
          taskId: task.taskId,
          title: task.title,
          at: task.askedAt,
        });
      for (const task of fact.value.heldBroken ?? [])
        heldBroken.push({
          appId: task.appId,
          appName,
          taskId: task.taskId,
          title: task.title,
          at: task.brokenAt,
        });
    }
    return asksYou.length === 0 && heldBroken.length === 0
      ? NO_BOARD_WAITS
      : { asksYou, heldBroken };
  },
  equals: sameValue,
};
