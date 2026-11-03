/**
 * A harness that keeps the system prompt a conversation began with, even when resumed (Claude
 * Code), is handed Mate's current instructions once with its next message whenever they differ.
 */

/** What a conversation records of the instructions it was given: equal text, equal mark. */
export function instructionsMark(instructions: string): string {
  // FNV-1a: telling one release's text from another's needs no cryptography.
  let hash = 0x811c9dc5;
  for (let index = 0; index < instructions.length; index += 1) {
    hash = Math.imul(hash ^ instructions.charCodeAt(index), 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** The preface that carries them, in the reminder form Claude Code itself uses. */
export function instructionsRefresh(instructions: string): string {
  return `<system-reminder>\nMate's instructions changed since this conversation began; these replace the earlier ones.\n${instructions}\n</system-reminder>`;
}
