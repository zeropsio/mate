import { type ComponentProps, memo, useSyncExternalStore } from "react";

import { ComposerPromptEditor } from "../ComposerPromptEditor";

/** Where an editor's words and its caret are held, for the editor alone to read as they change. */
export interface ComposerEditorWords {
  readonly subscribe: (onChange: () => void) => () => void;
  readonly value: () => string;
  readonly cursor: () => number;
}

/** A composer's caret, held beside the composer so that moving it draws the editor and no more. */
export interface ComposerCaret {
  readonly read: () => number;
  readonly set: (cursor: number) => void;
  readonly subscribe: (onChange: () => void) => () => void;
}

export function createComposerCaret(initial: number): ComposerCaret {
  let cursor = initial;
  const listeners = new Set<() => void>();
  return {
    read: () => cursor,
    set: (next) => {
      if (next === cursor) return;
      cursor = next;
      for (const listener of listeners) listener();
    },
    subscribe: (onChange) => {
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
      };
    },
  };
}

/**
 * The composer's editor on the words it shows. A key typed changes the words and the caret and
 * nothing else the composer draws, so the editor reads the two itself: the key draws the editor
 * again and leaves the composer around it, and the conversation behind it, as they were.
 */
export const ComposerEditorOnWords = memo(function ComposerEditorOnWords({
  words,
  ...editor
}: Omit<ComponentProps<typeof ComposerPromptEditor>, "value" | "cursor"> & {
  readonly words: ComposerEditorWords;
}) {
  const value = useSyncExternalStore(words.subscribe, words.value);
  const cursor = useSyncExternalStore(words.subscribe, words.cursor);
  return <ComposerPromptEditor {...editor} value={value} cursor={cursor} />;
});
