/**
 * The Crew tab's head: the goal's title, and the mode line under it — how the
 * crew works right now, in one line, with its one press (the owner's
 * decision, 2026-09-29: one Stop, and *Keep going…* when a limit stopped it).
 *
 * - No run on: it works when you give it something; while someone works,
 *   finished work waits for your review, and *Let it work on its own…*
 *   starts a run.
 * - A run running: what it spent and how long its crew worked, against its
 *   limits, and *Stop*. Pause is no longer offered. Only a crewmate at work
 *   is "working", its clock running on; with nobody at work and something
 *   waiting on you it says so, its clock standing.
 * - A run stopped by a limit: which, and *Keep going…* — for its time, only
 *   while something is left to do. A refused turn offers *Try again*.
 *
 * A viewer who may not run the crew (D6) is offered *Stop* alone: a colleague
 * stops what they may not start (`crewModePressLock`).
 *
 * Pure: every word comes from the crew phrases.
 */
import {
  CREW_BRIEF_EMPTY_WORD,
  CREW_MODE_PRESS,
  CREW_MODE_PRESS_LINES,
  CREW_WORKING_WITH_YOU,
  CREW_WORKS_WHEN_ASKED,
  CREW_WRAPPING_UP,
  crewBriefPlainText,
  crewOnItsOwnWords,
  crewStoppedWords,
} from "@t3tools/client-runtime/zerops/crew/phrases";
import type { CrewAccess, CrewLock } from "@t3tools/client-runtime/zerops/crew/crewAccess";
import type { CrewRun, CrewSummary, CrewTask } from "@t3tools/contracts";
import { CREW_BRIEF_TEMPLATE } from "@t3tools/shared/crewTemplates";

export type CrewModePressKind = keyof typeof CREW_MODE_PRESS;

export interface CrewModePress {
  readonly kind: CrewModePressKind;
  readonly label: string;
  /** What it does: the press's tooltip. */
  readonly line: string;
}

export interface CrewModeLine {
  readonly words: string;
  readonly press: CrewModePress | null;
}

export interface CrewModeInput {
  readonly run: CrewRun | null;
  /** How many crewmates' threads work right now. */
  readonly workingCount: number;
  readonly tasks: ReadonlyArray<Pick<CrewTask, "state">>;
  /** Something stands on *Waiting on you*: an ask, a plan to start, work to land. */
  readonly waitsOnYou: boolean;
  /** Now, for the run's clock while a crew turn runs (`CrewRun.countingFrom`). */
  readonly nowMs: number;
  /** The plan the usage stop watches (`crewPlanOf`); "your plan" while unnamed. */
  readonly plan?: string;
}

const press = (kind: CrewModePressKind): CrewModePress => ({
  kind,
  label: CREW_MODE_PRESS[kind],
  line: CREW_MODE_PRESS_LINES[kind],
});

/** A task someone is on, with or without a turn running: made, checked or going in. */
const AT_WORK: ReadonlySet<CrewTask["state"]> = new Set([
  "working",
  "rework",
  "merging",
  "checking",
  "landing",
]);

const atWork = (input: Pick<CrewModeInput, "workingCount" | "tasks">): boolean =>
  input.workingCount > 0 || input.tasks.some((task) => AT_WORK.has(task.state));

const leftToDo = (input: CrewModeInput): boolean =>
  atWork(input) || input.tasks.some((task) => task.state === "queued");

/**
 * Where a running run stands: at work while a crewmate's turn runs, its clock running on from
 * when the Mate read it; else waiting on you when something does, or between turns, its clock
 * standing. A task left at work with no turn running (stopped midway, a conflict, a failed check)
 * is work left to do, never a crewmate working.
 */
export function crewRunStanding(
  run: Pick<CrewRun, "elapsedMs" | "countingFrom">,
  input: Omit<CrewModeInput, "run" | "plan">,
): { readonly at: "working" | "waiting-on-you" | "between"; readonly elapsedMs: number } {
  const working = input.workingCount > 0 || run.countingFrom != null;
  if (!working) {
    return { at: input.waitsOnYou ? "waiting-on-you" : "between", elapsedMs: run.elapsedMs };
  }
  const from = run.countingFrom == null ? null : Date.parse(run.countingFrom);
  return {
    at: "working",
    elapsedMs: run.elapsedMs + (from === null ? 0 : Math.max(0, input.nowMs - from)),
  };
}

export function crewModeLine(input: CrewModeInput): CrewModeLine {
  const { run } = input;
  if (run === null || run.state === "finished" || run.state === "stopped") {
    return atWork(input)
      ? { words: CREW_WORKING_WITH_YOU, press: press("letItWork") }
      : { words: CREW_WORKS_WHEN_ASKED, press: null };
  }
  switch (run.state) {
    case "running": {
      const { at, elapsedMs } = crewRunStanding(run, input);
      return { words: crewOnItsOwnWords(run, at, elapsedMs), press: press("stop") };
    }
    case "finishing":
      return { words: CREW_WRAPPING_UP, press: null };
    case "paused": {
      const words = crewStoppedWords(run, input.plan);
      switch (run.reason) {
        case "refused":
          return { words, press: press("tryAgain") };
        case "time":
          return { words, press: leftToDo(input) ? press("keepGoing") : null };
        case "budget":
        case "usage":
        case "person":
        case null:
          return { words, press: press("keepGoing") };
      }
    }
  }
}

/**
 * What the mode line's press meets for this viewer, by what it sends: *Stop*
 * is every member's — a runaway crew on somebody's account never waits for
 * them — while *Keep going…* and *Try again* resume the run and *Let it work
 * on its own…* starts one, each reaching the whole crew.
 */
export function crewModePressLock(
  kind: CrewModePressKind,
  run: Pick<CrewRun, "id"> | null,
  access: Pick<CrewAccess, "command" | "crew">,
): CrewLock | null {
  switch (kind) {
    case "stop":
      return run === null ? access.crew : access.command({ _tag: "stop", runId: run.id });
    case "keepGoing":
    case "tryAgain":
      return run === null ? access.crew : access.command({ _tag: "resume", runId: run.id });
    case "letItWork":
      return access.crew;
  }
}

interface CrewGoalTitle {
  /** The goal's title, or the question it answers while it has none. */
  readonly title: string;
  readonly placeholder: boolean;
  /** Its first lines, on hover; `null` while there are none worth reading. */
  readonly hover: string | null;
}

const TEMPLATE_TITLE = "New brief";
const TEMPLATE_OPENING = crewBriefPlainText(CREW_BRIEF_TEMPLATE).split("\n")[0];

/** The head's title: the goal's own, never the template's placeholder. */
export function crewGoalTitle(
  crew: Pick<CrewSummary, "briefTitle" | "briefExcerpt">,
): CrewGoalTitle {
  const plain = crewBriefPlainText(crew.briefExcerpt);
  const hover = plain === "" || plain.split("\n")[0] === TEMPLATE_OPENING ? null : plain;
  const title = crew.briefTitle.trim();
  return title === "" || title === TEMPLATE_TITLE
    ? { title: CREW_BRIEF_EMPTY_WORD, placeholder: true, hover }
    : { title, placeholder: false, hover };
}
