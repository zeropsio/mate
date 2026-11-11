import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import type { LexicalEditor } from "lexical";

let editor: LexicalEditor | undefined;

/** The real composer's editor, with only its DOM view omitted in headless tests. */
export function HeadlessEditor() {
  [editor] = useLexicalComposerContext();
  return null;
}

export function getLexicalEditor(): LexicalEditor {
  if (editor === undefined) throw new Error("The composer editor is not mounted");
  return editor;
}

export function resetLexicalEditor() {
  editor = undefined;
}
