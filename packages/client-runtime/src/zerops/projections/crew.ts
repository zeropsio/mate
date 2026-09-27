/**
 * The crew as a client reads it (ARCHITECTURE §6): the crew feed's snapshot
 * joined to the thread shells its stints run in.
 *
 * A crewmate's live state is its current stint's thread, read by the one
 * status resolver (R5) — the snapshot carries what the engine recorded, never
 * what a thread is doing now. The caller hands that read in (`readThread`):
 * the resolver's module graph is not a pure one (rule 3), so this projection
 * only joins. Board rows take their owner's joined row, so a working task's
 * word is its owner's thread word. A stint is retired when the engine says so
 * or its shell has `archivedAt` set — a crew shell the snapshot no longer
 * lists included; `stints` answers "whose conversation is this thread" for
 * the chat.
 *
 * Shells are structural: `crew` is the thread's crew origin, absent on a
 * person's thread, so any shell list passes and only crew threads join.
 *
 * Pure (rule 3): no clock, no I/O.
 */
import type {
  CrewSnapshot,
  CrewStatus,
  CrewSummary,
  CrewTask,
  Crewmate,
  ThreadId,
} from "@t3tools/contracts";
import type { ThreadStatus } from "@t3tools/shared/threadStatus";

import type { Known } from "../knowledge/known.ts";
import {
  crewBoardColumn,
  crewPersonLands,
  crewStateWord,
  crewTaskWord,
  type CrewBoardColumnId,
} from "../crew/phrases.ts";

export interface CrewShellInput {
  readonly id: ThreadId;
  readonly archivedAt: string | null;
  /** The thread's crew origin; absent or `null` on a person's thread. */
  readonly crew?:
    | { readonly crew: string; readonly crewmate: string; readonly stint: number }
    | null
    | undefined;
}

/** A thread's live state as the one status resolver and its phrase producer read it (R5). */
export interface CrewThreadRead {
  readonly status: ThreadStatus;
  /** `null` for an idle thread. */
  readonly word: string | null;
  /** The thread wears the working face. */
  readonly working: boolean;
}

/** Which prompt versions a crewmate's next turn brings in ("v5 at next turn"); `null` members are current. */
export interface CrewPendingVersions {
  readonly brief: number | null;
  readonly job: number | null;
}

export interface CrewmateView<S extends CrewShellInput = CrewShellInput> {
  readonly crewmate: Crewmate;
  /** The current stint's shell; `null` before its first turn or while the shell is not here. */
  readonly shell: S | null;
  readonly status: ThreadStatus | null;
  /** The status word from the one phrase producer; `null` for an idle thread or no shell. */
  readonly statusWord: string | null;
  /** Its thread wears the working face. */
  readonly working: boolean;
  readonly openTask: CrewTask | null;
  /** Its queued tasks, in the order they start. */
  readonly queuedTasks: ReadonlyArray<CrewTask>;
  /** `null` unless its running prompt is older than the current one. */
  readonly pending: CrewPendingVersions | null;
}

export interface CrewTaskView<S extends CrewShellInput = CrewShellInput> {
  readonly task: CrewTask;
  /** `null` for an owner no longer on the crew. */
  readonly owner: CrewmateView<S> | null;
  readonly column: CrewBoardColumnId;
  /** `null` for a working task whose owner's thread has no word (idle). */
  readonly word: string | null;
}

/** A crew thread: whose it is, which stint, and whether it is the one the crewmate talks in now. */
export interface CrewStintRef {
  readonly handle: string;
  readonly stint: number;
  readonly current: boolean;
  readonly retired: boolean;
}

export interface CrewView<S extends CrewShellInput = CrewShellInput> {
  readonly status: CrewStatus;
  readonly crew: CrewSummary | null;
  /** The lead first, then in the crew home's order. */
  readonly crewmates: ReadonlyArray<CrewmateView<S>>;
  readonly lead: CrewmateView<S> | null;
  /** A `ready` task waits for your *Land* (`crewPersonLands`). */
  readonly personLands: boolean;
  /** Every board row the board shows (not discarded), in the snapshot's order. */
  readonly tasks: ReadonlyArray<CrewTaskView<S>>;
  readonly workingCount: number;
  /** The header's crew state word (`crewStateWord`). */
  readonly stateWord: string;
  readonly retiredThreadIds: ReadonlySet<ThreadId>;
  readonly stints: ReadonlyMap<ThreadId, CrewStintRef>;
}

function pendingVersions(crewmate: Crewmate): CrewPendingVersions | null {
  const { running, current } = crewmate.promptVersions;
  if (running === null) return null;
  const brief = current.brief > running.brief ? current.brief : null;
  const job = current.job > running.job ? current.job : null;
  return brief === null && job === null ? null : { brief, job };
}

function crewmateView<S extends CrewShellInput>(
  crewmate: Crewmate,
  shellsById: ReadonlyMap<ThreadId, S>,
  tasksById: ReadonlyMap<string, CrewTask>,
  readThread: (shell: S) => CrewThreadRead,
): CrewmateView<S> {
  const shell =
    crewmate.currentThreadId === null ? null : (shellsById.get(crewmate.currentThreadId) ?? null);
  const thread = shell === null ? null : readThread(shell);
  return {
    crewmate,
    shell,
    status: thread?.status ?? null,
    statusWord: thread?.word ?? null,
    working: thread?.working ?? false,
    openTask: crewmate.openTaskId === null ? null : (tasksById.get(crewmate.openTaskId) ?? null),
    queuedTasks: crewmate.queuedTaskIds.flatMap((id) => {
      const task = tasksById.get(id);
      return task === undefined ? [] : [task];
    }),
    pending: pendingVersions(crewmate),
  };
}

export function deriveCrewView<S extends CrewShellInput>(
  snapshot: CrewSnapshot,
  shells: ReadonlyArray<S>,
  readThread: (shell: S) => CrewThreadRead,
): CrewView<S> {
  const shellsById = new Map(shells.map((shell) => [shell.id, shell]));
  const tasksById = new Map(snapshot.board.tasks.map((task) => [task.id, task]));
  const crewmates = snapshot.crewmates.map((crewmate) =>
    crewmateView(crewmate, shellsById, tasksById, readThread),
  );
  const byHandle = new Map(crewmates.map((row) => [row.crewmate.handle, row]));
  const lead = crewmates.find((row) => row.crewmate.kind === "lead") ?? null;
  const personLands = crewPersonLands(snapshot.run);

  const tasks = snapshot.board.tasks.flatMap((task): ReadonlyArray<CrewTaskView<S>> => {
    const column = crewBoardColumn(task.state, personLands);
    if (column === null) return [];
    const owner = byHandle.get(task.owner) ?? null;
    const threadStatusWord = owner?.statusWord ?? null;
    const word =
      task.state === "working" && threadStatusWord === null
        ? null
        : crewTaskWord(task, {
            tasks: snapshot.board.tasks,
            hasLead: lead !== null,
            threadStatusWord: threadStatusWord ?? "",
          });
    return [{ task, owner, column, word }];
  });

  const stints = new Map<ThreadId, CrewStintRef>();
  for (const { crewmate } of crewmates) {
    for (const stint of crewmate.stints) {
      stints.set(stint.threadId, {
        handle: crewmate.handle,
        stint: stint.stint,
        current: stint.threadId === crewmate.currentThreadId,
        retired: stint.state === "retired" || shellsById.get(stint.threadId)?.archivedAt != null,
      });
    }
  }
  for (const shell of shells) {
    if (shell.crew == null || stints.has(shell.id)) continue;
    stints.set(shell.id, {
      handle: shell.crew.crewmate,
      stint: shell.crew.stint,
      current: false,
      retired: shell.archivedAt !== null,
    });
  }
  const retiredThreadIds = new Set(
    [...stints].flatMap(([threadId, ref]) => (ref.retired ? [threadId] : [])),
  );

  const workingCount = crewmates.filter((row) => row.working).length;
  return {
    status: snapshot.status,
    crew: snapshot.crew,
    crewmates,
    lead,
    personLands,
    tasks,
    workingCount,
    stateWord: crewStateWord({ run: snapshot.run, workingCount }),
    retiredThreadIds,
    stints,
  };
}

export interface CrewFeedRead {
  /**
   * `null` while nothing is known yet or the read failed; `off` also for a Mate
   * without the crew feed, which has no crew to show.
   */
  readonly status: CrewStatus | null;
  /** The latest snapshot, kept while the feed is stale. */
  readonly snapshot: CrewSnapshot | null;
  /** The snapshot is current: a press acts on what is shown. */
  readonly current: boolean;
}

/** The crew feed's knowledge as the section and the board switch on it (seam 21). */
export function crewFeedRead(read: Known<CrewSnapshot> | undefined): CrewFeedRead {
  if (read?.state === "known") {
    const stale = read.freshness.kind === "stale" || read.freshness.kind === "paused";
    return { status: read.value.status, snapshot: read.value, current: !stale };
  }
  if (read?.state === "failed" && read.failure.kind === "unsupported") {
    return { status: "off", snapshot: null, current: false };
  }
  return { status: null, snapshot: null, current: false };
}
