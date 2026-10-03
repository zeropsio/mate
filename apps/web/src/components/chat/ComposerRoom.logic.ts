/**
 * The draft as the held composer room lays it out (`ComposerRoomHeld`): what the composer's editor
 * will draw — its words, line for line, and its pictures and files where they stand in the text,
 * each on the row the editor gives it — so the room is the composer's height before the composer
 * is drawn, and nothing moves as it takes the room's place.
 */
import { INLINE_FILE_PLACEHOLDER, INLINE_PICTURE_PLACEHOLDER } from "~/lib/composerPictures";

export type HeldDraftRun =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "picture" }
  | { readonly kind: "file" };

export function heldDraftRuns(prompt: string): ReadonlyArray<HeldDraftRun> {
  const runs: HeldDraftRun[] = [];
  let text = "";
  const flush = () => {
    if (text.length === 0) return;
    // The editor keeps an empty last line a line tall; laid-out text drops it without a mark.
    runs.push({ kind: "text", text: text.endsWith("\n") ? `${text}​` : text });
    text = "";
  };
  for (const char of prompt) {
    if (char === INLINE_PICTURE_PLACEHOLDER || char === INLINE_FILE_PLACEHOLDER) {
      flush();
      runs.push({ kind: char === INLINE_PICTURE_PLACEHOLDER ? "picture" : "file" });
    } else {
      text += char;
    }
  }
  flush();
  return runs;
}
