/**
 * A crew task card as its crewmate's chat shows it (PRD §4.5): the task, by
 * its title, and when it is done. The card is the engine's message into the
 * thread — its first line the task's `#N`, title and what the card is for,
 * its lines after that the task's words, a `Done when:` line among them. The
 * person reads the title alone: the number and the engine's label are its
 * bookkeeping. The board, when it still holds that task, supplies its title
 * and done-when.
 *
 * On the engine the card is typed (`note.card`): its task's id, title, words and done-when, so
 * nothing is read from the words the agent got.
 *
 * Pure: no clock, no I/O.
 */
import { CREW_NEW_STINT_WORD } from "@t3tools/client-runtime/zerops/crew/phrases";
import type { CrewCard, CrewStint, CrewTask, ThreadId } from "@t3tools/contracts";

export interface CrewTaskCardModel {
  readonly heading: string;
  /** The card's words, its `Done when:` line taken out. */
  readonly text: string;
  readonly doneWhen: string | null;
}

const TASK_NUMBER = /^#(\d+)\s/u;
/** The engine's label after the title: " · from you", " · rework after review". */
const CARD_LABEL = /\s·\s[^·]*$/u;
const DONE_WHEN = /^done when:\s*/iu;

export function crewTaskCardModel(
  card: { readonly title: string; readonly text: string; readonly typed?: CrewCard },
  tasks: ReadonlyArray<CrewTask>,
): CrewTaskCardModel {
  if (card.typed !== undefined) return typedCardModel(card.typed, tasks);
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
  const writtenTitle =
    number === undefined ? card.title : card.title.replace(TASK_NUMBER, "").replace(CARD_LABEL, "");
  return {
    heading: task === undefined ? writtenTitle.trim() : task.title,
    text,
    doneWhen: doneWhen === "" ? null : doneWhen,
  };
}

/** The engine's typed card: its task as the board holds it, else the card's own facts. */
function typedCardModel(card: CrewCard, tasks: ReadonlyArray<CrewTask>): CrewTaskCardModel {
  const task =
    card.taskId === null ? undefined : tasks.find((candidate) => candidate.id === card.taskId);
  const doneWhen =
    task === undefined || task.doneWhen === "" ? (card.doneWhen ?? "") : task.doneWhen;
  return {
    heading: task?.title ?? card.title,
    text: card.why.trim(),
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
