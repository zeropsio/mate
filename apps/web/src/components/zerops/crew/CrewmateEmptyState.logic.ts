/**
 * What a crewmate's empty conversation says about the crewmate (PRD §4.5):
 * whose it is and what it does, under its name; its job's first line whole,
 * in the person's words; and the work it finished, so a conversation cleared
 * or started fresh never reads as if the crewmate had never done anything —
 * what went into the Mate's code and what closed with nothing to add, newest
 * first, each by its title and what became of it, as its chat's seam says it.
 * Every word is the crew phrases' (R5).
 *
 * Pure: no clock, no I/O.
 */
import {
  crewClosedOutcome,
  crewJobLine,
  crewmateWhoseLine,
  crewWentInOutcome,
} from "@t3tools/client-runtime/zerops/crew/phrases";
import type { CrewTask, Crewmate } from "@t3tools/contracts";

/** One piece of the crewmate's finished work. */
export interface CrewmateWorkRow {
  readonly taskId: string;
  readonly title: string;
  /** What became of it: "went into Fen's code", "closed with nothing to add to Fen's code". */
  readonly outcome: string;
  /** A commit went into the Mate's code: its review shows what changed. */
  readonly wentIn: boolean;
  /** When it went in or closed; `null` where the engine did not say. */
  readonly at: string | null;
}

export interface CrewmateEmptyModel {
  /** "Fen's lead · plans and reviews the crew's work". */
  readonly whose: string;
  /** Its job's first line, whole, in the person's words; empty while it has none. */
  readonly job: string;
  /** Its finished work, newest first. */
  readonly work: ReadonlyArray<CrewmateWorkRow>;
}

export function crewmateEmptyModel(
  crewmate: Pick<Crewmate, "handle" | "kind" | "jobFirstLine" | "displayName">,
  tasks: ReadonlyArray<CrewTask>,
  mateName: string,
): CrewmateEmptyModel {
  const work = tasks
    .filter((task) => task.owner === crewmate.handle && task.state === "landed")
    .toSorted(
      (left, right) =>
        (right.landedAt ?? right.createdAt).localeCompare(left.landedAt ?? left.createdAt) ||
        right.number - left.number,
    )
    .map((task): CrewmateWorkRow => ({
      taskId: task.id,
      title: task.title,
      outcome:
        task.landedCommit === null ? crewClosedOutcome(mateName) : crewWentInOutcome(mateName),
      wentIn: task.landedCommit !== null,
      at: task.landedAt,
    }));
  return {
    whose: crewmateWhoseLine(crewmate.kind, mateName),
    job: crewJobLine(crewmate.jobFirstLine, crewmate.displayName),
    work,
  };
}
