/**
 * The rail button's disabled state and which tooltip branch to show, for
 * `ModelPickerSidebar`. Pulled out as pure logic because the three inputs
 * (unavailable, context-locked, zerops-panel-overridable) interact in a way
 * that is easy to get backwards — and was, once: `isContextDisabled` used to
 * win over a panel unconditionally, so a locked-out agent that Zerops could
 * still offer sign-in for (a not-yet-authorized Codex, say, on a started
 * Claude session) stayed disabled with the stale "Unavailable" tooltip
 * instead of the clickable panel it should have shown.
 *
 * `lockOverridden` is deliberately its own input, narrower than
 * `unavailableSelectionIsReachable`: only an entry with an actual zerops
 * panel may override the *session lock* — an entry reachable for other
 * reasons (a persisted Antigravity selection, a "needs setup" offer) still
 * must not be picked while the session is locked to a different agent.
 */

export type ModelPickerRailTooltipKind = "lockOverridden" | "unavailable" | "lock" | "default";

export interface ModelPickerRailButtonState {
  readonly isDisabled: boolean;
  readonly tooltipKind: ModelPickerRailTooltipKind;
}

export function resolveModelPickerRailButtonState(input: {
  /** `!isProviderInstancePickerReady(entry)`. */
  readonly isUnavailable: boolean;
  /** This instance's driver does not match the session's locked provider. */
  readonly isContextDisabled: boolean;
  /** A non-ready instance whose selected model stays reachable (persisted selection, setup offer, or a zerops panel). */
  readonly unavailableSelectionIsReachable: boolean;
  /** A zerops panel exists for this instance — the one thing allowed to override a session lock. */
  readonly lockOverridden: boolean;
}): ModelPickerRailButtonState {
  const isDisabled =
    (input.isUnavailable && !input.unavailableSelectionIsReachable) ||
    (input.isContextDisabled && !input.lockOverridden);

  const tooltipKind: ModelPickerRailTooltipKind = input.lockOverridden
    ? "default"
    : input.isUnavailable
      ? "unavailable"
      : input.isContextDisabled
        ? "lock"
        : "default";

  return { isDisabled, tooltipKind };
}
