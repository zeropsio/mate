import { flushSync } from "react-dom";
import { prefersReducedMotion } from "~/lib/reducedMotion";
import type { TimelineRowSharedState } from "./timelineContext";

/** How "Show work" and "Hide work" ease the work's room open or shut (K12). */
const FOLD_EASE_MS = 220;
export const FOLD_EASING = "cubic-bezier(0.23, 1, 0.32, 1)";

/** The room a run's work stands in under its line: its height and the gap over it. */
export interface FeedRoom {
  readonly height: number;
  readonly gap: number;
}

export function roomOf(feed: HTMLElement): FeedRoom {
  return {
    height: feed.getBoundingClientRect().height,
    gap: parseFloat(getComputedStyle(feed).marginTop) || 0,
  };
}

function feedFrame({ height, gap }: FeedRoom): Keyframe {
  return { height: `${height}px`, marginTop: `${gap}px`, overflow: "hidden" };
}

/**
 * Eases a run's work from the room it stood in before the person asked, to
 * its own: only what is under the line they clicked moves. Reduced motion
 * shows it at once.
 */
export function easeFeedHeight(feed: HTMLElement, from: FeedRoom): void {
  const to = roomOf(feed);
  if (Math.abs(to.height + to.gap - from.height - from.gap) < 1 || prefersReducedMotion()) {
    return;
  }
  feed.animate([feedFrame(from), feedFrame(to)], { duration: FOLD_EASE_MS, easing: FOLD_EASING });
}

/**
 * Eases a run's work shut from `from`, drawn as it goes, and folds it (`done`, drawn at once, so
 * no frame shows it open again) once it is shut.
 */
export function shutFeed(feed: HTMLElement, from: FeedRoom, done: () => void): Animation {
  const shut = feed.animate([feedFrame(from), feedFrame({ height: 0, gap: 0 })], {
    duration: FOLD_EASE_MS,
    easing: FOLD_EASING,
    fill: "forwards",
  });
  shut.onfinish = () => {
    flushSync(done);
    shut.cancel();
  };
  return shut;
}

/**
 * Folds the work over a run's line shut (`foldWork`): from its height, less
 * `shift` — how much higher the line stands without its hairline and room,
 * which the fold starts by keeping — to nothing, clipping as it closes; `done`
 * once it is shut.
 */
export function foldAway(
  above: HTMLElement,
  shift: number,
  done: () => void,
  onFoldWork: NonNullable<TimelineRowSharedState["onFoldWork"]>,
): () => void {
  const from = above.getBoundingClientRect().height + shift;
  if (from < 1) {
    done();
    return () => undefined;
  }
  return onFoldWork({ above, from, done });
}
