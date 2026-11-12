/**
 * The mounted picker's content carries this id: every key pressed asks whether a picker is open,
 * and by id that is one lookup, where a selector searched the whole page each time.
 */
export const MODEL_PICKER_CONTENT_ID = "model-picker-content";

/**
 * Model-picker visibility is already represented by the mounted popover.
 * Shortcut arbitration reads that source directly instead of mirroring it in
 * a second React or external store.
 */
export function isModelPickerOpen(): boolean {
  return (
    typeof document !== "undefined" && document.getElementById(MODEL_PICKER_CONTENT_ID) !== null
  );
}
