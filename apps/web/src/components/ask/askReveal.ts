/**
 * "Show in conversation": an ask docked above the composer takes the person to its card where it
 * was asked. The dock names the ask and which conversation row holds its card; the conversation
 * scrolls that row into view and puts focus in the card. A row the conversation has not loaded is
 * not there to show, and nothing moves.
 */
import { useEffect } from "react";
import { create } from "zustand";

export interface AskRevealTarget {
  readonly askId: string;
  /** Whether a conversation row holds the ask's card; the last row that does is the one shown. */
  readonly holds: (row: { readonly kind: string }) => boolean;
}

const useRevealTarget = create<{ readonly target: AskRevealTarget | null }>()(() => ({
  target: null,
}));

/** Asks the conversation to show an ask's card; a second press asks again. */
export function showAskInConversation(target: AskRevealTarget): void {
  useRevealTarget.setState({ target: { ...target } });
}

/**
 * The conversation's side: the row that holds the asked card, scrolled to by `scrollTo` (the
 * list's own way there, so it stops following its end), then focus in the card's first control.
 */
export function useAskReveal<Row extends { readonly kind: string }>(
  rows: ReadonlyArray<Row>,
  scrollTo: (index: number) => Promise<void> | undefined,
): void {
  const target = useRevealTarget((state) => state.target);
  useEffect(() => {
    if (target === null) return;
    useRevealTarget.setState({ target: null });
    const index = rows.findLastIndex(target.holds);
    if (index < 0) return;
    void Promise.resolve(scrollTo(index)).then(() => {
      const card = document.querySelector<HTMLElement>(
        `[data-ask-density="full"][data-ask-id="${CSS.escape(target.askId)}"]`,
      );
      card
        ?.querySelector<HTMLElement>("input:not(:disabled), button:not(:disabled)")
        ?.focus({ preventScroll: true });
    });
  }, [rows, scrollTo, target]);
}
