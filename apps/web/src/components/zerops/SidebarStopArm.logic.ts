/**
 * Stopping a Mate's run from its row is two presses (the owner, 2026-10-01: "this has confirm,
 * right?"): the row's ■, or `x` on it, arms the row — its clock gives way to a red *Stop?* — and
 * a second press within {@link STOP_ARM_MS} stops. The pointer leaving the row, Esc, focus
 * leaving it, the time passing or the run ending by itself let it go. The ⋯ menu's *Stop the
 * run* is two steps already, and stops at once. Pure, so each rule has its row in the table.
 */

/** How long an armed row waits for its second press. */
export const STOP_ARM_MS = 3000;

/** When the row was armed, wall ms; `null` while it is not. */
export type StopArm = { readonly armedAt: number } | null;

export type StopArmEvent =
  /** The ■, the *Stop?* standing in its place, or `x` on the row. */
  | { readonly kind: "press"; readonly at: number }
  | { readonly kind: "leave" }
  | { readonly kind: "escape" }
  | { readonly kind: "blur" }
  | { readonly kind: "run-ended" }
  /** The clock reaching the arm's end. */
  | { readonly kind: "tick"; readonly at: number };

export function stopArmStep(
  state: StopArm,
  event: StopArmEvent,
): { readonly state: StopArm; readonly stop: boolean } {
  switch (event.kind) {
    case "press":
      return state !== null && event.at - state.armedAt < STOP_ARM_MS
        ? { state: null, stop: true }
        : { state: { armedAt: event.at }, stop: false };
    case "tick":
      return {
        state: state !== null && event.at - state.armedAt < STOP_ARM_MS ? state : null,
        stop: false,
      };
    case "leave":
    case "escape":
    case "blur":
    case "run-ended":
      return { state: null, stop: false };
  }
}
