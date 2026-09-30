/**
 * The Crew tab's head: the goal's title, and the mode line under it — how the
 * crew works right now, in one line, with its one press (the owner's
 * decision, 2026-09-29: one Stop, and *Keep going…* when a limit stopped it).
 *
 * - No run on: it works when you give it something; while someone works,
 *   finished work waits for your review, and *Let it work on its own…*
 *   starts a run.
 * - A run running: what it spent and how long its crew worked, against its
 *   limits, and *Stop*. Pause is no longer offered.
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

const atWork = (input: CrewModeInput): boolean =>
  input.workingCount > 0 || input.tasks.some((task) => AT_WORK.has(task.state));

const leftToDo = (input: CrewModeInput): boolean =>
  atWork(input) || input.tasks.some((task) => task.state === "queued");

export function crewModeLine(input: CrewModeInput): CrewModeLine {
  const { run } = input;
  if (run === null || run.state === "finished" || run.state === "stopped") {
    return atWork(input)
      ? { words: CREW_WORKING_WITH_YOU, press: press("letItWork") }
      : { words: CREW_WORKS_WHEN_ASKED, press: null };
  }
  switch (run.state) {
    case "running":
      return { words: crewOnItsOwnWords(run), press: press("stop") };
    case "finishing":
      return { words: CREW_WRAPPING_UP, press: null };
    case "paused": {
      const words = crewStoppedWords(run);
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

export interface CrewGoalTitle {
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
