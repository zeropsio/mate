/**
 * The lead's plan (PRD §4.6, §5.4): the tasks its `crew_propose` left on the
 * crew as `proposed`, one line per task — whose it is, what it is, and what it
 * waits for — and what its Start sends for the run the crew is in.
 *
 * Start lets the crew work on its own: a running run takes the plan into its
 * work; with no run on, a run starts first on the last run's limits — the
 * first time, the dialog asks for them; a paused run goes on first — through
 * the dialog when one of its limits stopped it, since it goes on only with
 * more. A plan accepted into a paused run would wait unseen (`planAccept`
 * only queues, and the lead's tasks start only in a running run), so Start
 * never leaves it there.
 *
 * Pure: every word comes from the crew phrases; this module only arranges.
 */
import type { CrewAccess, CrewLock } from "@t3tools/client-runtime/zerops/crew/crewAccess";
import { crewAfterWord } from "@t3tools/client-runtime/zerops/crew/phrases";
import type { CrewmateView, CrewView } from "@t3tools/client-runtime/zerops/projections/crew";
import type { CrewCommand, CrewRun, CrewSnapshot, CrewTint } from "@t3tools/contracts";
import type { MateMarkState } from "@t3tools/shared/brand";
import { mateMarkStateForThreadStatus } from "@t3tools/shared/threadStatus";

/** A crewmate as a line names it: its face in its tint, wearing its thread's state. */
export interface CrewmateFace {
  readonly handle: string;
  readonly name: string;
  /** `null` for someone no longer on the crew, who has no face to draw. */
  readonly tint: CrewTint | null;
  readonly face: MateMarkState;
}

/** Someone the crew no longer has, as a line names them: never by a handle. */
const GONE_NAME = "Someone who left the crew";

export function crewmateFace(handle: string, owner: CrewmateView | null): CrewmateFace {
  if (owner === null) return { handle, name: GONE_NAME, tint: null, face: "idle" };
  return {
    handle,
    name: owner.crewmate.displayName,
    tint: owner.crewmate.tint,
    face: owner.status === null ? "idle" : mateMarkStateForThreadStatus(owner.status.kind),
  };
}

export interface CrewPlanRow {
  readonly taskId: string;
  readonly title: string;
  readonly owner: CrewmateFace;
  /** "after Season clock on the server" while a task it waits for has not gone in. */
  readonly after: string | null;
}

export interface CrewPlanCard {
  readonly rows: ReadonlyArray<CrewPlanRow>;
}

/** The first task `taskId` waits for that has not gone in yet. */
function waitsFor(
  dependsOn: ReadonlyArray<string>,
  tasks: CrewSnapshot["board"]["tasks"],
): string | null {
  const pending = dependsOn
    .map((id) => tasks.find((task) => task.id === id))
    .find((task) => task !== undefined && task.state !== "landed");
  return pending === undefined ? null : crewAfterWord(pending.title);
}

/** The lead's proposed tasks as one plan — the lead's row's and its chat's; `null` while none. */
export function crewPlanCard(snapshot: CrewSnapshot, view: CrewView): CrewPlanCard | null {
  const proposed = view.tasks.filter((row) => row.task.state === "proposed");
  if (proposed.length === 0) return null;
  return {
    rows: proposed.map(({ task, owner }) => ({
      taskId: task.id,
      title: task.title,
      owner: crewmateFace(task.owner, owner),
      after: waitsFor(task.dependsOn, snapshot.board.tasks),
    })),
  };
}

/** The plan's accept, or a drop of its lines; `null` for no lines. */
export function crewPlanCommand(
  tag: "planAccept" | "planDiscard",
  taskIds: ReadonlyArray<string>,
): CrewCommand | null {
  const [first, ...rest] = taskIds;
  return first === undefined ? null : { _tag: tag, taskIds: [first, ...rest] };
}

/**
 * What the plan's Start does: commands sent one after another, or the run
 * dialog first — to start a first run, or to give a run a limit stopped more
 * — with the plan's accept once it has done its part.
 */
export type CrewPlanStart =
  | { readonly kind: "send"; readonly commands: ReadonlyArray<CrewCommand> }
  | {
      readonly kind: "dialog";
      readonly dialog: "start" | "resume";
      readonly after: CrewCommand;
    };

export function crewPlanStart(
  run: CrewRun | null,
  taskIds: ReadonlyArray<string>,
): CrewPlanStart | null {
  const accept = crewPlanCommand("planAccept", taskIds);
  if (accept === null) return null;
  if (run === null) return { kind: "dialog", dialog: "start", after: accept };
  switch (run.state) {
    case "running":
    case "finishing":
      return { kind: "send", commands: [accept] };
    case "finished":
    case "stopped":
      return { kind: "send", commands: [{ _tag: "start", ...run.options }, accept] };
    case "paused":
      return run.reason === "budget" || run.reason === "time" || run.reason === "usage"
        ? { kind: "dialog", dialog: "resume", after: accept }
        : { kind: "send", commands: [{ _tag: "resume", runId: run.id }, accept] };
  }
}

/** What each of the plan's presses meets for this viewer (D6); `null` where it is offered. */
export interface CrewPlanLocks {
  readonly start: CrewLock | null;
  /** The run's limits: the dialog's start or resume, then the accept. */
  readonly change: CrewLock | null;
  readonly drop: CrewLock | null;
  /** A line's ×. */
  readonly leaveOut: (taskId: string) => CrewLock | null;
}

/**
 * Each press by what it sends: Start by every command it sends — through the
 * dialog, the run's start or resume, which reaches the whole crew, then the
 * accept; *Drop the plan* and a line's × by the tasks they drop.
 */
export function crewPlanLocks(
  run: CrewRun | null,
  taskIds: ReadonlyArray<string>,
  access: Pick<CrewAccess, "command" | "crew">,
): CrewPlanLocks {
  const lockOf = (command: CrewCommand | null) =>
    command === null ? null : access.command(command);
  const start = crewPlanStart(run, taskIds);
  return {
    start:
      start === null
        ? null
        : start.kind === "send"
          ? (start.commands.map(lockOf).find((lock) => lock !== null) ?? null)
          : (access.crew ?? lockOf(start.after)),
    change: access.crew ?? lockOf(crewPlanCommand("planAccept", taskIds)),
    drop: lockOf(crewPlanCommand("planDiscard", taskIds)),
    leaveOut: (taskId) => lockOf(crewPlanCommand("planDiscard", [taskId])),
  };
}
