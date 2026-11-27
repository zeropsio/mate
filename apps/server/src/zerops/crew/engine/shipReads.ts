/**
 * Which landings the Mate reads for whether they went out (`CrewReads.shipped`), one rule for the
 * read and for the snapshot that counts what it has not read yet: per dev service, its newest
 * {@link SHIP_READS_PER_HOST} landings not already read as shipped, none landed more than
 * {@link SHIP_READ_MAX_AGE_MS} ago. A landing past either bound is never read, and claims nothing.
 *
 * @module zerops/crew/engine/shipReads
 */
import { tasksInOrder, type CrewState, type TaskRecord } from "./state.ts";

/** How many landings of one dev service a read looks at, newest first. */
export const SHIP_READS_PER_HOST = 20;

/** How long after its landing a landing is still read: 30 days. */
export const SHIP_READ_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** The landings a read looks at, by the dev service their tree is on, newest first. */
export const landingsToRead = (
  state: CrewState,
  nowMs: number,
): ReadonlyMap<string, ReadonlyArray<TaskRecord>> => {
  const byHost = new Map<string, Array<TaskRecord>>();
  for (const task of tasksInOrder(state)) {
    if (task.state !== "landed" || task.landedCommit === null || task.landedAt === null) continue;
    if (task.shipRead?.commit === task.landedCommit && task.shipRead.shipped) continue;
    if (nowMs - task.landedAt > SHIP_READ_MAX_AGE_MS) continue;
    const host = state.members[task.owner]?.host;
    if (host == null) continue;
    byHost.set(host, [...(byHost.get(host) ?? []), task]);
  }
  return new Map(
    [...byHost].map(([host, tasks]) => [
      host,
      tasks.toSorted((a, b) => b.landedAt! - a.landedAt!).slice(0, SHIP_READS_PER_HOST),
    ]),
  );
};
