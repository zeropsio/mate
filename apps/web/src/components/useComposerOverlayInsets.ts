import { type Dispatch, type SetStateAction, useLayoutEffect } from "react";

/** The floating composer's measured height insets the conversation under it (`ConversationView`); a question it asks keeps the inset it had. */
export function useComposerOverlayInsets({
  composerOverlayElement,
  setComposerAskingHeight,
  setComposerElementHeight,
}: {
  composerOverlayElement: HTMLDivElement | null;
  setComposerAskingHeight: Dispatch<SetStateAction<number>>;
  setComposerElementHeight: Dispatch<SetStateAction<number>>;
}) {
  useLayoutEffect(() => {
    if (!composerOverlayElement) return;

    const updateHeight = () => {
      const overlay = composerOverlayElement.getBoundingClientRect();
      const nextHeight = Math.ceil(overlay.height);
      if (nextHeight <= 0) return;
      // The conversation thins out beside the floating composer over the composer's own height,
      // from its top edge down (`conversation-scroll-fade`): written where the list reads it,
      // with no render of its own.
      const shell = composerOverlayElement.querySelector<HTMLElement>(
        '[data-slot="composer-shell"]',
      );
      const card =
        shell === null || composerOverlayElement.dataset["chatComposerHero"] === "true"
          ? null
          : shell.getBoundingClientRect();
      const footing = composerOverlayElement.parentElement?.style;
      footing?.setProperty(
        "--composer-fade",
        `${card === null ? 0 : Math.max(0, Math.ceil(overlay.bottom - card.top))}px`,
      );
      // Under the card nothing shows: the fade ends where the card does.
      footing?.setProperty(
        "--composer-foot",
        `${card === null ? 0 : Math.max(0, Math.ceil(overlay.bottom - card.bottom))}px`,
      );
      // A question or an approval the agent asks stands over the conversation's end, the inset held
      // as it was: opening it pushed the conversation up 250 px in one frame and its answer pulled
      // it back down (Milo's stress run). What it covers more is room the person scrolls into.
      if (composerOverlayElement.querySelector("[data-chat-composer-asks]") !== null) {
        setComposerAskingHeight(nextHeight);
        return;
      }
      // What stands above the composer's own room (`data-over-conversation`: a notice, a lead's
      // plan, why Send waits) arrives after the conversation is read, so it takes the same seat:
      // over the conversation's end, the inset the composer's alone. It pushed the list by its own
      // height the moment it came, a beat after the conversation appeared. Measured as the room
      // it takes in the footer (a notice tucks under the composer, so its box says more).
      let over = 0;
      const composer = composerOverlayElement.querySelector("[data-footer-composer]");
      if (composer !== null && composerOverlayElement.dataset["chatComposerHero"] !== "true") {
        const padding = Number.parseFloat(getComputedStyle(composerOverlayElement).paddingTop);
        over = composer.getBoundingClientRect().top - overlay.top - (padding || 0);
        for (const part of composer.querySelectorAll("[data-over-conversation]"))
          over += part.getBoundingClientRect().height;
        over = over < 1 ? 0 : Math.round(over);
      }
      const inset = Math.max(1, nextHeight - over);
      setComposerAskingHeight(over > 0 ? nextHeight : 0);
      setComposerElementHeight((currentHeight) =>
        currentHeight === inset ? currentHeight : inset,
      );
    };

    updateHeight();
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(updateHeight);
    observer.observe(composerOverlayElement);
    return () => observer.disconnect();
  }, [composerOverlayElement]);
}
