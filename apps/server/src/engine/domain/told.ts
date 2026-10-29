/**
 * What the agent hears with a person's message that the person did not type: the changes merged
 * since it last spoke, the vault keys added or removed (names, never a value).
 *
 * A Mate is a live process whose beliefs are whatever was sent to it. A change that landed while
 * it was idle would leave it saying "two pull requests wait for review" an hour after both merged
 * (the owner, 2026-09-20). A fact placed in front of its next message cannot be skipped, arrives
 * at the moment it would have checked, and costs nothing when there is nothing to say.
 *
 * It goes to the agent only: the person's message in the record stays exactly what they typed,
 * because the conversation is their record too, and a line they did not write appearing as theirs
 * would be a lie in their own transcript. What the agent was told is the run's own text
 * (`RunQueued.text`), so the record still holds it.
 *
 * Pure: no clock, no network.
 *
 * @module engine/domain/told
 */
import { isSlashCommand } from "@t3tools/shared/userAsk";

/** The tag around the block, so the agent can tell it from the person. */
const OPEN = "<zerops-update>";
const CLOSE = "</zerops-update>";

/**
 * What the agent hears after a person's message that goes into its running turn. A driver
 * surfaces such a message beside its next tool result, and an agent may answer it in its
 * thinking alone, which the person never sees: a compaction's summary then counts it answered
 * (Filip's Mate, 2026-10-28, two questions never answered across two compactions).
 */
export const STEERED_NOTE =
  "<zerops-note>The person sent this while you work. Answer it now, in words the person reads, before you carry on: your thinking never reaches them.</zerops-note>";

/**
 * The words a running turn takes from the person: the note after them, so the agent answers
 * where the person reads. A slash command goes alone, as `toldWith` keeps it.
 */
export function steeredWith(told: string): string {
  if (isSlashCommand(told)) return told;
  return told.trim().length === 0 ? STEERED_NOTE : `${told}\n\n${STEERED_NOTE}`;
}

/**
 * The person's words with the context in front of them, or the words exactly as they were when
 * there is none. A slash command goes alone: an agent runs one only when it opens the message, and
 * a block in front turns it into prose the model answers.
 */
export function toldWith(text: string, context: ReadonlyArray<string> | undefined): string {
  const lines = (context ?? []).map((line) => line.trim()).filter((line) => line.length > 0);
  if (lines.length === 0 || isSlashCommand(text)) return text;
  const block = [OPEN, ...lines, CLOSE].join("\n");
  // A message of pictures alone has no words: the block is then the whole of its text.
  return text.trim().length === 0 ? block : `${block}\n\n${text}`;
}
