/**
 * The card a person's conversation shows for a task it handed to a crewmate (`crew_hand_off`),
 * following the task as the crew holds it: where it stands, in the words the Crew tab says it, and
 * what the person may press about it from here — what the crew needs of them about this task, as
 * the Crew tab offers it.
 *
 * Pure: no clock, no I/O.
 */
import {
  CREW_HANDED_DROPPED,
  CREW_HANDED_STOPPED,
  CREW_HANDED_WAITING,
  CREW_HANDED_WORKING,
  crewNeedSentence,
  crewReadyWords,
  crewWentInWord,
} from "@t3tools/client-runtime/zerops/crew/phrases";
import type { CrewView } from "@t3tools/client-runtime/zerops/projections/crew";
import type { CrewSnapshot, CrewTask } from "@t3tools/contracts";

import { crewNeedActions, crewTaskStanding, type CrewRowAction } from "./CrewRows.logic";

export interface CrewHandOffModel {
  readonly title: string;
  /** Its crewmate, by name; by its handle once the crew no longer has it. */
  readonly who: string;
  /** Where it stands, or what it needs of the person. */
  readonly line: string;
  /** What the crew needs of the person about this task, in the Crew tab's order. */
  readonly actions: ReadonlyArray<CrewRowAction>;
  /** Still the crew's: a message to its crewmate steers it, or sends finished work back. */
  readonly open: boolean;
}

export function crewHandOffModel(input: {
  readonly task: CrewTask;
  readonly snapshot: Pick<CrewSnapshot, "crewmates" | "hosts" | "board" | "revision" | "attention">;
  readonly view: Pick<CrewView, "lead" | "personLands">;
  readonly mateName: string;
}): CrewHandOffModel {
  const { task, snapshot, view, mateName } = input;
  const who =
    snapshot.crewmates.find((crewmate) => crewmate.handle === task.owner)?.displayName ??
    task.owner;
  const open = task.state !== "landed" && task.state !== "discarded";
  const need = snapshot.attention.find((row) => row.taskId === task.id);
  if (need !== undefined) {
    return {
      title: task.title,
      who,
      line: crewNeedSentence(need, snapshot, mateName),
      actions: crewNeedActions(need, snapshot, mateName),
      open,
    };
  }
  return {
    title: task.title,
    who,
    line: standingWords(task, view, mateName),
    actions: [],
    open,
  };
}

/** Where the task stands when nothing about it needs the person. */
function standingWords(
  task: CrewTask,
  view: Pick<CrewView, "lead" | "personLands">,
  mateName: string,
): string {
  const standing = crewTaskStanding(task, view, mateName);
  if (standing !== null) return standing;
  switch (task.state) {
    case "proposed":
    case "queued":
      return CREW_HANDED_WAITING;
    case "waiting-on-you":
      return crewReadyWords(mateName);
    case "landed":
      return crewWentInWord(null, mateName);
    case "parked":
      return CREW_HANDED_STOPPED;
    case "discarded":
      return CREW_HANDED_DROPPED;
    default:
      return CREW_HANDED_WORKING;
  }
}
