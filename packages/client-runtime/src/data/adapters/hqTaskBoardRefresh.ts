/**
 * When HQ's answers about automated Mates' tasks go stale, read from HQ's navigation: HQ streams
 * no task board and no monthly spend of its own, while its navigation says, for each automated
 * Mate, the task it is on and where that stands. An application's board is read again when one
 * of its automated Mates takes another task, waits on a person, has a stop taken, ends one, or
 * gets a pull request; when one of them opens a change; and when its queue grows or shrinks. The
 * organization's limits (with what was spent this month) are read again when any automated task
 * starts, changes state or ends. A task's cost and time alone moving reads nothing again: a row
 * at work takes them from navigation, re-sent on each report.
 */
import { hqAppsScope, placementsScope, type PlacementValue } from "../families/hqNavigation.ts";
import type { AccountState } from "../model.ts";
import { readsOfState } from "../store.ts";

type NavigationTask = NonNullable<NonNullable<PlacementValue["mate"]>["task"]>;

/** A task's state as navigation says it, without what it cost or how long it worked. */
const stateOf = (task: NavigationTask | null | undefined) =>
  task == null
    ? null
    : [
        task.id,
        task.waiting === true,
        task.stopping === true,
        task.done === true,
        task.ended ?? null,
        task.pullRequest?.number ?? null,
        task.pullRequest?.state ?? null,
      ];

/** The automated Mates navigation places, by project id: in one application, or anywhere. */
function automatedMates(state: AccountState, orgId: string, appId: string | null) {
  const read = readsOfState(state);
  const mates: Array<[string, NavigationTask | null | undefined]> = [];
  for (const id of read.members(placementsScope(orgId)).ids) {
    const fact = read.fact("placement", id);
    if (fact.kind !== "known") continue;
    const placement = fact.value;
    if (placement.mate?.automated !== true) continue;
    if (appId !== null && placement.appId !== appId) continue;
    mates.push([id, placement.mate.task]);
  }
  return mates.sort(([a], [b]) => a.localeCompare(b));
}

/** What moves an application's task board: its Mates' tasks, their open changes, its queue. */
export function appTasksSignature(state: AccountState, orgId: string, appId: string): string {
  const mates = automatedMates(state, orgId, appId);
  const read = readsOfState(state);
  const app = read.members(hqAppsScope(orgId)).ids.includes(appId)
    ? read.fact("hqApp", appId)
    : null;
  const ids = new Set(mates.map(([id]) => id));
  const changes =
    app?.kind === "known" && Array.isArray(app.value.changes)
      ? app.value.changes
          .filter((change) => change.mateProjectId !== null && ids.has(change.mateProjectId))
          .map((change) => `${change.repo}#${String(change.number)}`)
          .sort()
      : [];
  const waiting = app?.kind === "known" ? (app.value.intake?.waiting ?? null) : null;
  return JSON.stringify([mates.map(([id, task]) => [id, stateOf(task)]), changes, waiting]);
}

/** What moves the organization's spend this month: any automated task's state. */
export function orgTasksSignature(state: AccountState, orgId: string): string {
  return JSON.stringify(
    automatedMates(state, orgId, null).map(([id, task]) => [id, stateOf(task)]),
  );
}
