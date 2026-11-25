/**
 * A slide-to-confirm's next state (`SlideConfirm`): where its thumb stands, 0 at the start and 1 at
 * the end, and whether the slide is confirmed. Only the end confirms: a drag let go of short of it
 * goes back to the start, an arrow steps a quarter and End jumps there. Confirmed, it stays at the
 * end until Undo, Home or an arrow back takes it to the start. Enter and Space are no move of
 * its own, so a form's Enter never confirms a deletion, and a locked slide does not move. Pure.
 */

export interface SlideConfirmValue {
  readonly position: number;
  readonly confirmed: boolean;
}

export type SlideConfirmEvent =
  /** The thumb is dragged to this point of the track, 0..1. */
  | { readonly type: "drag"; readonly to: number }
  /** The dragged thumb is let go of. */
  | { readonly type: "release" }
  | { readonly type: "key"; readonly key: string }
  | { readonly type: "undo" };

const START: SlideConfirmValue = { position: 0, confirmed: false };
const END: SlideConfirmValue = { position: 1, confirmed: true };
const STEP = 0.25;

const FORWARD_KEYS = new Set(["ArrowRight", "ArrowUp", "PageUp"]);
const BACK_KEYS = new Set(["ArrowLeft", "ArrowDown", "PageDown"]);

/** The keys the slide answers itself; every other key goes on to whatever holds it. */
export const SLIDE_CONFIRM_KEYS: ReadonlySet<string> = new Set([
  ...FORWARD_KEYS,
  ...BACK_KEYS,
  "Home",
  "End",
]);

function at(position: number): SlideConfirmValue {
  const clamped = Math.min(1, Math.max(0, position));
  return clamped >= 1 ? END : { position: clamped, confirmed: false };
}

export function slideConfirmNext(
  value: SlideConfirmValue,
  event: SlideConfirmEvent,
  locked: boolean,
): SlideConfirmValue {
  if (locked) return value;
  switch (event.type) {
    case "drag":
      return value.confirmed
        ? value
        : { position: Math.min(1, Math.max(0, event.to)), confirmed: false };
    case "release":
      if (value.confirmed) return value;
      return value.position >= 1 ? END : START;
    case "undo":
      return START;
    case "key":
      if (event.key === "End") return END;
      if (event.key === "Home") return START;
      if (FORWARD_KEYS.has(event.key)) return value.confirmed ? value : at(value.position + STEP);
      if (BACK_KEYS.has(event.key)) return value.confirmed ? START : at(value.position - STEP);
      return value;
  }
}
