import type { ComposerDraftLoad } from "./facts.ts";

/** Is the typed command the only nonblank text in the draft? */
export function commandStandsAlone(words: string, range: { start: number; end: number }): boolean {
  return words.slice(0, range.start).trim() === "" && words.slice(range.end).trim() === "";
}

/** Can this draft offer a command to compact its conversation? */
export function compactCommandOffered(input: {
  standsAlone: boolean;
  compactUnavailable: boolean;
  load: ComposerDraftLoad;
}): boolean {
  if (!input.standsAlone || input.compactUnavailable) return false;
  const { pictures, files, keptAttachments, terminalContexts, reviewComments } = input.load;
  return (
    pictures === 0 &&
    files === 0 &&
    keptAttachments === 0 &&
    terminalContexts === 0 &&
    reviewComments === 0
  );
}

/** Does this provider command belong in the menu for this draft? */
export function providerCommandOffered(name: string, compactOffered: boolean): boolean {
  return name !== "compact" || compactOffered;
}
