/**
 * What the agent is told that the person did not type.
 *
 * A Mate is a live process whose beliefs are whatever was sent to it. The
 * app's own timeline never reaches it — activities are a projection, and a
 * turn carries only the person's text — so a change that landed while it was
 * idle leaves it saying "two pull requests wait for review" an hour after both
 * merged (the owner, 2026-09-20).
 *
 * The alternative was to have it check: a tool call every turn, mostly to
 * learn nothing changed, and one a model under a long context will skip. A
 * fact placed in front of it cannot be skipped, arrives at the moment it would
 * have checked, and costs nothing when there is nothing to say.
 *
 * It goes to the provider only. The stored message stays exactly what was
 * typed, because the thread is the person's record too, and a line they did
 * not write appearing as theirs would be a lie in their own transcript.
 *
 * Pure: no clock, no network.
 *
 * @module agentNotes
 */

/** The tag around the block, so the agent can tell it from the person. */
const OPEN = "<zerops-update>";
const CLOSE = "</zerops-update>";

/**
 * The person's message with the notes placed in front of it, or the message
 * exactly as it was when there are none.
 */
export function withAgentNotes(
  text: string,
  notes: ReadonlyArray<string> | undefined | null,
): string {
  const lines = (notes ?? []).map((note) => note.trim()).filter((note) => note.length > 0);
  if (lines.length === 0) return text;
  const block = [OPEN, ...lines, CLOSE].join("\n");
  const typed = text.trim();
  // A turn can carry no text at all — a queued send, a hand-over — and the
  // block is then the whole of it rather than a blank line before nothing.
  return typed.length === 0 ? block : `${block}\n\n${text}`;
}
