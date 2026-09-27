/**
 * Crew mode's phrase producer (R5): the board's column titles, task-state
 * words, the section header's crew state, *Waiting on you* sentences and
 * refusal sentences — PRD §4.3, §4.4, §5.3, §6.3. A crew surface renders crew
 * and task words only from here; a thread's own status word still comes only
 * from `resolveThreadStatus` and is passed in where a task shows it.
 *
 * Pure: no clock, no I/O; every fact arrives from the crew snapshot.
 */
import type {
  CrewAttention,
  CrewRefusalReason,
  CrewRun,
  CrewSnapshot,
  CrewTask,
  CrewTaskState,
} from "@t3tools/contracts";

/** The board's columns, left to right (PRD §4.4). */
export const CREW_BOARD_COLUMNS = [
  { id: "waiting-on-you", title: "Waiting on you" },
  { id: "working", title: "Working" },
  { id: "in-review", title: "In review" },
  { id: "queued", title: "Queued" },
  { id: "landed", title: "Landed" },
] as const;
export type CrewBoardColumnId = (typeof CREW_BOARD_COLUMNS)[number]["id"];

/**
 * The column a task sits in (PRD §6.3); `null` for a discarded task, which the
 * board filters out. `personLands`: a `ready` task waits for your *Land*
 * rather than landing on its own.
 */
export function crewBoardColumn(
  state: CrewTaskState,
  personLands: boolean,
): CrewBoardColumnId | null {
  switch (state) {
    case "proposed":
    case "blocked":
    case "waiting-on-you":
    case "parked":
      return "waiting-on-you";
    case "working":
    case "rework":
    case "merging":
    case "checking":
    case "landing":
      return "working";
    case "review":
      return "in-review";
    case "ready":
      return personLands ? "waiting-on-you" : "in-review";
    case "queued":
      return "queued";
    case "landed":
      return "landed";
    case "discarded":
      return null;
  }
}

export interface CrewTaskWordContext {
  /** The board, to name a dependency a queued task still waits for. */
  readonly tasks: ReadonlyArray<CrewTask>;
  /** A crew with a lead reviews through it: "In review by lead". */
  readonly hasLead: boolean;
  /** The owner's thread status word from `resolveThreadStatus`, which a working task shows. */
  readonly threadStatusWord: string | null;
}

const WORKING_COLUMN_TITLE = CREW_BOARD_COLUMNS[1].title;

/** A task's state word (PRD §6.3). */
export function crewTaskWord(task: CrewTask, context: CrewTaskWordContext): string {
  switch (task.state) {
    case "proposed":
      return "Proposed";
    case "queued": {
      const waitsFor = task.dependsOn
        .map((id) => context.tasks.find((candidate) => candidate.id === id))
        .find((dependency) => dependency !== undefined && dependency.state !== "landed");
      return waitsFor === undefined ? "Queued" : `Queued · after #${waitsFor.number}`;
    }
    case "working":
      return context.threadStatusWord ?? WORKING_COLUMN_TITLE;
    case "rework":
      return task.reason === null ? "Rework" : `Rework: ${task.reason}`;
    case "blocked":
      return "Asks a question";
    case "merging":
    case "checking":
      return "Checking";
    case "review":
      return context.hasLead ? "In review by lead" : "In review";
    case "ready":
      return "Ready to land";
    case "landing":
      return "Landing";
    case "waiting-on-you": {
      const [first, ...rest] = task.waitingOn;
      if (first === undefined) return "Waits on your tree";
      return rest.length === 0
        ? `Waits on your tree: ${first}`
        : `Waits on your tree: ${first} +${rest.length}`;
    }
    case "landed":
      return task.delivered ? "Delivered" : "Landed · not delivered";
    case "parked":
      return task.reason === null ? "Stopped" : `Stopped: ${task.reason}`;
    case "discarded":
      return "Discarded";
  }
}

/** A run is on while it is running or paused; its options govern only then. */
const isRunOn = (run: CrewRun | null): run is CrewRun =>
  run !== null && (run.state === "running" || run.state === "paused");

/** Whether a `ready` task waits for your *Land*: always without a run on, else per its landing option. */
export function crewPersonLands(run: CrewRun | null): boolean {
  return !isRunOn(run) || run.options.landing === "person";
}

/** `1 h 12 m`, `45 m`, `8 h`. */
function formatCrewDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} m`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} m`;
}

function pausedWord(run: CrewRun): string {
  switch (run.reason) {
    case "budget":
      return "Paused · budget reached";
    case "time":
      return "Paused · time limit reached";
    case "usage":
      return run.options.stopAtUsagePercent === null
        ? "Paused · usage limit reached"
        : `Paused · usage at ${run.options.stopAtUsagePercent} %`;
    case "refused":
      return run.reasonDetail === null ? "Paused" : `Paused · ${run.reasonDetail}`;
    case "person":
    case null:
      return "Paused";
  }
}

/**
 * The crew state beside the section's header (PRD §4.3 item 1). `run` is the
 * crew's latest run; `workingCount` is how many crewmates' current threads
 * `resolveThreadStatus` reads as working.
 */
export function crewStateWord(input: {
  readonly run: CrewRun | null;
  readonly workingCount: number;
}): string {
  const { run, workingCount } = input;
  if (run?.state === "running") return `Running · ${formatCrewDuration(run.elapsedMs)}`;
  if (run?.state === "paused") return pausedWord(run);
  if (run?.state === "finishing") return "Finishing";
  return workingCount === 0 ? "Idle" : `${workingCount} working`;
}

export interface CrewRunMeters {
  readonly spend: string;
  readonly time: string;
  /** `null` when the login reports no usage. */
  readonly usage: string | null;
}

const dollars = (amount: number, cents: boolean) =>
  cents || !Number.isInteger(amount) ? `$${amount.toFixed(2)}` : `$${amount}`;

/** The run meters under the header while a run is on (PRD §4.3 item 2). */
export function crewRunMeters(run: CrewRun): CrewRunMeters {
  const { budgetUsd, timeLimitHours, stopAtUsagePercent } = run.options;
  const spent = dollars(run.spentUsd, true);
  const elapsed = formatCrewDuration(run.elapsedMs);
  return {
    spend:
      budgetUsd === "unlimited"
        ? `Spend ${spent} · no limit`
        : `Spend ${spent} of ${dollars(budgetUsd, false)}`,
    time:
      timeLimitHours === "unlimited"
        ? `Time ${elapsed} · no limit`
        : `Time ${elapsed} of ${timeLimitHours} h`,
    usage:
      run.usagePercent === null
        ? null
        : stopAtUsagePercent === null
          ? `Usage ${Math.round(run.usagePercent)} %`
          : `Usage ${Math.round(run.usagePercent)} %, stops at ${stopAtUsagePercent}`,
  };
}

/** `a.ts`, or `a.ts and 2 more`. */
function pathSummary(paths: ReadonlyArray<string>): string {
  const [first, ...rest] = paths;
  if (first === undefined) return "a file";
  return rest.length === 0 ? first : `${first} and ${rest.length} more`;
}

/**
 * One *Waiting on you* row as a sentence (PRD §4.3 item 4, §5.2, §5.2a). A
 * crewmate is named by its display name; a handle no longer on the crew reads
 * as `@handle`.
 */
export function crewAttentionSentence(
  row: CrewAttention,
  crew: Pick<CrewSnapshot, "crewmates" | "board">,
): string {
  const mate = crew.crewmates.find((candidate) => candidate.handle === row.handle);
  const name = mate?.displayName ?? (row.handle === null ? "The crew" : `@${row.handle}`);
  const task = crew.board.tasks.find((candidate) => candidate.id === row.taskId);
  switch (row.kind) {
    case "question":
      return row.text === null ? `${name} asks a question` : `${name} asks: ${row.text}`;
    case "landing-wait":
      return `${name}'s landing waits: ${pathSummary(row.paths)} ${row.paths.length > 1 ? "are" : "is"} edited in your tree`;
    case "ready-to-land":
      return task === undefined
        ? `${name}'s work is ready to land`
        : `${name}'s #${task.number} is ready to land`;
    case "plan": {
      const count = crew.board.tasks.filter((candidate) => candidate.state === "proposed").length;
      return `${name} proposes ${count} ${count === 1 ? "task" : "tasks"}`;
    }
    case "show-on-dev":
      return `${name} asks to show its work on ${row.host ?? "dev"}`;
    case "parked":
      return row.text === null ? `${name} stopped` : `${name} stopped: ${row.text}`;
    case "cant-start":
      return row.text === null ? `Can't start ${name}` : `Can't start ${name}: ${row.text}`;
    case "conflict":
      return `${name}'s copy conflicts with what landed: ${pathSummary(row.paths)}`;
    case "check-failed":
      return `${name}'s check failed`;
  }
}

const REFUSALS: Readonly<Record<CrewRefusalReason, string>> = {
  unavailable: "Crew mode is off in this Mate",
  "no-crew": "No crew is set up yet",
  "invalid-definition": "The crew files need a fix",
  "handle-taken": "That handle is already taken",
  "no-free-disk": "The service has no free disk for another copy of the code",
  "database-undeclared":
    "A crewmate on a service with a database needs `env:` or `database: shared`",
  "no-mention": "Name a crewmate with @, or add a lead to split the work",
  "unknown-crewmate": "There is no such crewmate on the crew",
  "unknown-task": "That task is no longer on the board",
  "wrong-state": "That can't be done in its current state",
  "not-allowed": "You can't start this crewmate's turn",
  "unlanded-commits": "Its copy of the code has commits that never landed",
  "login-needs-fresh": "A different login needs a fresh conversation",
  io: "The crew files could not be read or saved",
};

/** A refused command or files request as one sentence, with the engine's detail after a colon. */
export function crewRefusalSentence(reason: CrewRefusalReason, detail: string | null): string {
  const base = REFUSALS[reason];
  return detail === null ? `${base}.` : `${base}: ${detail.replace(/\.$/u, "")}.`;
}
