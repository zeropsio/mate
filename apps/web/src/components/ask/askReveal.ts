/**
 * An ask's two homes, kept from showing it twice. The conversation's card says whether it is in
 * view, so the composer docks the ask only while it is not; "Show in conversation" takes the
 * person from the dock to the card: the dock names the ask and which conversation row holds its
 * card, the conversation scrolls that row into view and puts focus in the card. A row the
 * conversation has not loaded is not there to show, and nothing moves.
 */
import { useCallback, useEffect } from "react";
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

/** The asks whose card is drawn in the conversation, and whether each is in view. */
const useOnScreen = create<{ readonly cards: Readonly<Record<string, boolean>> }>()(() => ({
  cards: {},
}));

const setOnScreen = (askId: string, onScreen: boolean | null) =>
  useOnScreen.setState(({ cards }) => {
    if (onScreen === null) {
      const { [askId]: _gone, ...rest } = cards;
      return { cards: rest };
    }
    return cards[askId] === onScreen ? { cards } : { cards: { ...cards, [askId]: onScreen } };
  });

/**
 * Whether an ask's card is in view in the conversation. A card scrolled away, or not drawn (its
 * row unloaded or set aside by the list), is not.
 */
export function useAskCardOnScreen(askId: string | null): boolean {
  return useOnScreen((state) => askId !== null && state.cards[askId] === true);
}

/**
 * The card's side: a ref that says whether at least half of the card is in view. A card just
 * drawn counts as in view until it is measured, so the dock never shows and goes at once.
 */
export function useReportAskOnScreen(askId: string) {
  return useCallback(
    (node: HTMLElement | null) => {
      if (node === null) return;
      setOnScreen(askId, true);
      if (typeof IntersectionObserver === "undefined") return () => setOnScreen(askId, null);
      const observer = new IntersectionObserver(
        (entries) => {
          const entry = entries.at(-1);
          if (entry !== undefined) setOnScreen(askId, entry.intersectionRatio >= 0.5);
        },
        { threshold: [0, 0.5, 1] },
      );
      observer.observe(node);
      return () => {
        observer.disconnect();
        setOnScreen(askId, null);
      };
    },
    [askId],
  );
}
