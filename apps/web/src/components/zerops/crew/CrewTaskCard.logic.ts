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
import {
  CREW_NEW_STINT_WORD,
  crewTaskSourceWord,
} from "@t3tools/client-runtime/zerops/crew/phrases";
import type { CrewStint, CrewTask, ThreadId } from "@t3tools/contracts";

export interface CrewTaskCardModel {
  readonly heading: string;
  /** "from you"; `null` when the board does not know the task. */
  readonly source: string | null;
  /** The card's words, its `Done when:` line taken out. */
  readonly text: string;
  readonly doneWhen: string | null;
}

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
    source: task === undefined ? null : crewTaskSourceWord(task.source),
    text,
    doneWhen: doneWhen === "" ? null : doneWhen,
  };
}

/**
 * Why this conversation began, for the seam above its first card, and the one
 * before it; `null` for a crewmate's first conversation, and where the
 * engine's own `stint` seam says it already (`seamed`), so it stands once.
 */
export function crewCardOrigin(input: {
  readonly stints: ReadonlyArray<Pick<CrewStint, "threadId" | "reason">>;
  readonly threadId: ThreadId;
  readonly seamed: boolean;
}): { readonly text: string; readonly previousThreadId: ThreadId | null } | null {
  if (input.seamed) return null;
  const index = input.stints.findIndex((stint) => stint.threadId === input.threadId);
  const stint = input.stints[index];
  if (stint === undefined || (index === 0 && stint.reason === null)) return null;
  return {
    text: stint.reason ?? CREW_NEW_STINT_WORD,
    previousThreadId: input.stints[index - 1]?.threadId ?? null,
  };
}
