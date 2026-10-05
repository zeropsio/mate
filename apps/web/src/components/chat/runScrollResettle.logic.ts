/**
 * A run's scroll moved by nobody: the list re-inserting its row's node (a
 * message of the person's mid-turn re-makes the card's row) puts the browser's
 * scroll back at 0, with no scroll event to say so (run 11: the card read its
 * first items for half an hour). Its end sentinel leaving view is the one
 * word of it (`useRunScrollResettle`).
 *
 * Pure.
 *
 * @module runScrollResettle.logic
 */
import { FOLLOW_SLACK_PX, footTop, type RunScrollPosition, standsAtFoot } from "./runCard.logic";

/**
 * Where a run's scroll goes back to once it stands somewhere no move of
 * anybody's took it: its foot, while it followed and stands above where it
 * last stood. A move the page heard — the person's, a glide, the browser
 * clamping it — has already moved where it last stood: none.
 */
export function resettledTop(input: {
  readonly follows: boolean;
  /** Where its top last stood, as the moves it heard left it. */
  readonly stood: number;
  readonly position: RunScrollPosition;
}): number | null {
  const { follows, stood, position } = input;
  if (!follows || standsAtFoot(position)) return null;
  return position.scrollTop < stood - FOLLOW_SLACK_PX ? footTop(position) : null;
}
