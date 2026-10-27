/**
 * What stands behind an open review keeps its shape until the review closes. A merge pressed in
 * the review took the composer's review strip and the header's Review tag away at once: the
 * composer shrank under the conversation and the header's goal slid left while the person's eye
 * was on the button they had pressed (a run 2 follow-up). Held, the thing stands invisible in its
 * own room, and goes once the review closes.
 */
import { useState } from "react";

import { useReviewShown } from "./review";

export interface BehindReview<T> {
  /** What to draw: the value, or the last one while it is held. */
  readonly value: T | null;
  /** Drawn only to keep its room: what it said is no longer true. */
  readonly held: boolean;
  /** The last value drawn, kept to hold. */
  readonly last: T | null;
}

export function behindReview<T>(input: {
  readonly value: T | null;
  readonly last: T | null;
  /** Whether a review stands open over the page. */
  readonly shown: boolean;
}): BehindReview<T> {
  if (input.value !== null) return { value: input.value, held: false, last: input.value };
  if (input.shown && input.last !== null)
    return { value: input.last, held: true, last: input.last };
  return { value: null, held: false, last: null };
}

/** `value`, held in its room while a review stands open over the page (`behindReview`). */
export function useHeldBehindReview<T>(value: T | null): {
  readonly value: T | null;
  readonly held: boolean;
} {
  const shown = useReviewShown();
  const [last, setLast] = useState(value);
  const next = behindReview({ value, last, shown });
  if (next.last !== last) setLast(next.last);
  return next;
}
