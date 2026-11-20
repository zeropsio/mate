/**
 * The rail button's disabled state and which tooltip it shows, for `ModelPickerSidebar`. An
 * instance that is not ready is disabled unless its selection stays reachable; one with a zerops
 * panel (`ModelPickerContent`'s `renderInstancePanel`) is reachable and named, never called
 * unavailable, since its panel says what it needs (a not-yet-authorized Codex offers sign-in). On
 * a started conversation every instance but the one it runs on says it continues the conversation.
 */

export type ModelPickerRailTooltipKind = "unavailable" | "continue" | "default";

export interface ModelPickerRailButtonState {
  readonly isDisabled: boolean;
  readonly tooltipKind: ModelPickerRailTooltipKind;
}

export function resolveModelPickerRailButtonState(input: {
  /** `!isProviderInstancePickerReady(entry)`. */
  readonly isUnavailable: boolean;
  /** A non-ready instance whose selected model stays reachable (persisted selection, setup offer, or a zerops panel). */
  readonly unavailableSelectionIsReachable: boolean;
  /** A zerops panel exists for this instance. */
  readonly hasPanel: boolean;
  /** A started conversation runs on another instance. */
  readonly continues: boolean;
}): ModelPickerRailButtonState {
  const isDisabled = input.isUnavailable && !input.unavailableSelectionIsReachable;
  const tooltipKind: ModelPickerRailTooltipKind =
    input.isUnavailable && !input.hasPanel
      ? "unavailable"
      : input.continues
        ? "continue"
        : "default";
  return { isDisabled, tooltipKind };
}
