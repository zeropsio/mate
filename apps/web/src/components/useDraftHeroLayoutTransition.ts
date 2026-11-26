import { useLayoutEffect, useRef } from "react";
import { prefersReducedMotion } from "~/lib/reducedMotion";
import {
  DRAFT_HERO_TRANSITION_ANIMATION_ID,
  DRAFT_HERO_TRANSITION_DURATION_MS,
  DRAFT_HERO_TRANSITION_EASING,
} from "./chat/draftHeroTransition";

/** How far a composer nobody saw rises as it arrives in its new place, instead of travelling. */
const ARRIVE_RISE_PX = 6;
const ARRIVE_EASING = "cubic-bezier(0.23, 1, 0.32, 1)";

/**
 * Moves the composer between the empty conversation's centre and its dock. A composer that was
 * held unseen (a Mate's sign-in) has no place to travel from: it fades in where it lands, rising a
 * few pixels, rather than sliding up from where it was hidden.
 */
export function useDraftHeroLayoutTransition(isDraftHeroState: boolean, composerSeen: boolean) {
  const transitionGroupRef = useRef<HTMLDivElement | null>(null);
  const composerAnchorRef = useRef<HTMLDivElement | null>(null);
  const previousStateRef = useRef(isDraftHeroState);
  const previousSeenRef = useRef(composerSeen);
  const previousComposerRectRef = useRef<DOMRect | null>(null);
  const animationRef = useRef<Animation | null>(null);
  const attachTransitionGroupRef = (element: HTMLDivElement | null) => {
    transitionGroupRef.current = element;
  };
  const attachComposerAnchorRef = (element: HTMLDivElement | null) => {
    composerAnchorRef.current = element;
  };
  const captureComposerRect = () => {
    previousComposerRectRef.current = composerAnchorRef.current?.getBoundingClientRect() ?? null;
  };

  useLayoutEffect(() => {
    const transitionGroup = transitionGroupRef.current;
    const nextComposerRect = composerAnchorRef.current?.getBoundingClientRect() ?? null;
    const stateChanged = previousStateRef.current !== isDraftHeroState;
    const mobileComposerTransitionActive =
      typeof document !== "undefined" &&
      document.documentElement.dataset.mobileComposerRouteTransition === "true";

    animationRef.current?.cancel();
    animationRef.current = null;

    const previousComposerRect = previousComposerRectRef.current;
    if (
      stateChanged &&
      !prefersReducedMotion() &&
      !mobileComposerTransitionActive &&
      transitionGroup &&
      previousComposerRect &&
      nextComposerRect &&
      typeof transitionGroup.animate === "function"
    ) {
      const translateX = previousComposerRect.left - nextComposerRect.left;
      const translateY = previousComposerRect.top - nextComposerRect.top;
      if (Math.abs(translateX) >= 0.5 || Math.abs(translateY) >= 0.5) {
        const animation = previousSeenRef.current
          ? transitionGroup.animate(
              [
                { transform: `translate3d(${translateX}px, ${translateY}px, 0)` },
                { transform: "translate3d(0, 0, 0)" },
              ],
              {
                duration: DRAFT_HERO_TRANSITION_DURATION_MS,
                easing: DRAFT_HERO_TRANSITION_EASING,
              },
            )
          : transitionGroup.animate(
              [
                { opacity: 0, transform: `translate3d(0, ${ARRIVE_RISE_PX}px, 0)` },
                { opacity: 1, transform: "translate3d(0, 0, 0)" },
              ],
              { duration: 220, easing: ARRIVE_EASING },
            );
        animation.id = DRAFT_HERO_TRANSITION_ANIMATION_ID;
        animationRef.current = animation;
        void animation.finished
          .catch(() => undefined)
          .then(() => {
            if (animationRef.current !== animation) {
              return;
            }
            animationRef.current = null;
          });
      }
    }

    previousStateRef.current = isDraftHeroState;
    previousSeenRef.current = composerSeen;
    previousComposerRectRef.current = nextComposerRect;
  }, [composerSeen, isDraftHeroState]);

  return [attachTransitionGroupRef, attachComposerAnchorRef, captureComposerRect] as const;
}
