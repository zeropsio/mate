/**
 * A crew task card as its crewmate's chat shows it (PRD §4.5): "#12 Camera
 * rig · from you · Done when: …". The card is the engine's message into the
 * thread — its first line the task's `#N` and title, its lines after that the
 * task's words, a `Done when:` line among them. The board, when it still holds
 * that task, supplies where it came from and its done-when; a card the board
 * does not know is drawn as it was written.
 *
 * Pure: no clock, no I/O.
 */
import type { CrewTask, CrewTaskSource } from "@t3tools/contracts";

export interface CrewTaskCardModel {
  readonly heading: string;
  /** "from you"; `null` when the board does not know the task. */
  readonly source: string | null;
  /** The card's words, its `Done when:` line taken out. */
  readonly text: string;
  readonly doneWhen: string | null;
}

const SOURCE: Readonly<Record<CrewTaskSource, string>> = {
  you: "from you",
  lead: "from the lead",
  message: "from a message",
  issue: "from an issue",
};

const TASK_NUMBER = /^#(\d+)\s/u;
const DONE_WHEN = /^done when:\s*/iu;

export function crewTaskCardModel(
  card: { readonly title: string; readonly text: string },
  tasks: ReadonlyArray<CrewTask>,
): CrewTaskCardModel {
  const lines = card.text.split("\n");
  const doneWhenLine = lines.find((line) => DONE_WHEN.test(line.trim()));
  const text = lines
    .filter((line) => line !== doneWhenLine)
    .join("\n")
    .trim();
  const written = doneWhenLine?.trim().replace(DONE_WHEN, "") ?? "";
  const number = TASK_NUMBER.exec(card.title)?.[1];
  const task =
    number === undefined
      ? undefined
      : tasks.find((candidate) => candidate.number === Number(number));
  const doneWhen = task === undefined || task.doneWhen === "" ? written : task.doneWhen;
  return {
    heading: task === undefined ? card.title : `#${task.number} ${task.title}`,
    source: task === undefined ? null : SOURCE[task.source],
    text,
    doneWhen: doneWhen === "" ? null : doneWhen,
  };
}
