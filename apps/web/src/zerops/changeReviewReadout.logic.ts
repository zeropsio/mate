/**
 * What a change's review shows of its files and record, never waited on for good.
 *
 * A change drawn from the menu's row has no head until the application's detail says it, and its
 * record is read only at a head: meanwhile nothing is read for it, so no read's deadline ends the
 * wait. The review gives HQ a while to say it, then says plainly that it hasn't, with Try again.
 * A change whose head HQ said is read and bounded by the record read's own deadline.
 *
 * Pure: no clock; the review times its patience.
 */
import type { ReadoutPart } from "./useZeropsChangeDetail";

/** How long a review waits for HQ to say which head a change is at before it says it hasn't. */
export const CHANGE_HEAD_PATIENCE_MS = 10_000;

/** Why a change's details are not shown once the review stopped waiting for its head. */
export const HEAD_NOT_SENT = "HQ hasn't sent them in time.";

export function changeReviewReadout<T>(input: {
  /** The change's record as read at its head: `none` while HQ has not said a head. */
  readonly detail: ReadoutPart<T>;
  /** HQ's words for why it cannot read the change's application, while it says one. */
  readonly appFailure: string | undefined;
  /** The review has waited past its patience for the change's head. */
  readonly outwaited: boolean;
}): ReadoutPart<T> {
  if (input.detail.kind !== "none") return input.detail;
  if (input.appFailure !== undefined) return { kind: "failed", reason: input.appFailure };
  return input.outwaited ? { kind: "failed", reason: HEAD_NOT_SENT } : { kind: "reading" };
}
