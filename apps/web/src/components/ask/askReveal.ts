/**
 * An ask's two homes, kept from showing it twice. The conversation's card says whether it is in
 * view, so the composer docks the ask only while it is not; "Show in conversation" takes the
 * person from the dock to the card: the dock names the ask and which conversation row holds its
 * card, the conversation scrolls that row into view and puts focus in the card. A row the
 * conversation has not loaded is not there to show, and nothing moves.
 */
import { type ReactNode, useCallback, useEffect } from "react";
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

/**
 * Takes the person to what the open conversation waits on them for, where it is drawn now: the ask
 * above the composer, else the last card still waiting in the conversation. It is brought into
 * view and rings once (`data-zerops-flash`), and focus goes to what it asks with. `false` where
 * neither is drawn — a card the list has set aside — and the caller goes by the card's row
 * (`showAskInConversation`).
 */
export function showWaitingAsk(root: ParentNode = document): boolean {
  const ask =
    root.querySelector<HTMLElement>("[data-chat-composer-asks]") ??
    [
      ...root.querySelectorAll<HTMLElement>('[data-ask-density="full"][data-ask-state="waiting"]'),
    ].at(-1);
  if (ask === undefined) return false;
  const still =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  ask.scrollIntoView({ block: "nearest", behavior: still ? "auto" : "smooth" });
  ask.removeAttribute("data-zerops-flash");
  // Read, so a second press rings again.
  void ask.offsetWidth;
  ask.setAttribute("data-zerops-flash", "");
  ask.addEventListener("animationend", () => ask.removeAttribute("data-zerops-flash"), {
    once: true,
  });
  ask
    .querySelector<HTMLElement>(
      "input:not(:disabled), textarea:not(:disabled), button:not(:disabled):not([data-pending-user-input-toggle])",
    )
    ?.focus({ preventScroll: true });
  return true;
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

/** An open ask a conversation's card offers to stand above the composer: its compact form. */
export interface DockedAsk {
  readonly askId: string;
  readonly render: () => ReactNode;
}

/**
 * The asks each conversation's cards offered to dock, newest last. A card offers its ask while it
 * waits on the person and takes it back once settled; a card scrolled out of the list keeps its
 * offer, since out of view is when the dock is wanted. The docked form settles it too.
 */
const useDocked = create<{
  readonly byThread: Readonly<Record<string, ReadonlyArray<DockedAsk>>>;
}>()(() => ({ byThread: {} }));

export function dockAsk(threadKey: string, ask: DockedAsk): void {
  useDocked.setState(({ byThread }) => ({
    byThread: {
      ...byThread,
      [threadKey]: [...(byThread[threadKey] ?? []).filter((each) => each.askId !== ask.askId), ask],
    },
  }));
}

export function undockAsk(threadKey: string, askId: string): void {
  useDocked.setState(({ byThread }) => {
    const held = byThread[threadKey];
    if (held === undefined || !held.some((each) => each.askId === askId)) return { byThread };
    return { byThread: { ...byThread, [threadKey]: held.filter((each) => each.askId !== askId) } };
  });
}

/** The newest ask a conversation's cards offered to dock; `null` with none. */
export function useDockedAsk(threadKey: string | null): DockedAsk | null {
  return useDocked((state) =>
    threadKey === null ? null : (state.byThread[threadKey]?.at(-1) ?? null),
  );
}
