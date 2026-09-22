import { describe, expect, it } from "vite-plus/test";

import {
  resolveModelPickerRailButtonState,
  type ModelPickerRailButtonState,
} from "./ModelPickerSidebar.logic";

describe("resolveModelPickerRailButtonState", () => {
  it.each([
    [
      "ready, unlocked",
      {
        isUnavailable: false,
        isContextDisabled: false,
        unavailableSelectionIsReachable: false,
        lockOverridden: false,
      },
      { isDisabled: false, tooltipKind: "default" },
    ],
    [
      "unavailable, no panel, no other reachability",
      {
        isUnavailable: true,
        isContextDisabled: false,
        unavailableSelectionIsReachable: false,
        lockOverridden: false,
      },
      { isDisabled: true, tooltipKind: "unavailable" },
    ],
    [
      "unavailable but reachable for a non-lock reason (persisted selection, setup offer)",
      {
        isUnavailable: true,
        isContextDisabled: false,
        unavailableSelectionIsReachable: true,
        lockOverridden: false,
      },
      { isDisabled: false, tooltipKind: "unavailable" },
    ],
    // Regression: a locked-out, signed-in, RUNNABLE agent (no panel) stays
    // disabled and shows the lock tooltip — never "Unavailable".
    [
      "locked out, ready (no panel) — stays disabled, lock tooltip",
      {
        isUnavailable: false,
        isContextDisabled: true,
        unavailableSelectionIsReachable: false,
        lockOverridden: false,
      },
      { isDisabled: true, tooltipKind: "lock" },
    ],
    // Regression: the live bug — locked out AND not signed in, but a zerops
    // panel exists (isContextDisabled must not win over the panel).
    [
      "locked out, not signed in, but a zerops panel exists — clickable, plain tooltip",
      {
        isUnavailable: true,
        isContextDisabled: true,
        unavailableSelectionIsReachable: true,
        lockOverridden: true,
      },
      { isDisabled: false, tooltipKind: "default" },
    ],
    // Not a zerops panel (lockOverridden false): the precedence must stay
    // exactly what it was before zerops existed, whatever else is reachable.
    [
      "locked out, unavailable, reachable for a non-lock reason but NOT lock-overridden — unavailable tooltip wins (non-zerops precedence, unchanged)",
      {
        isUnavailable: true,
        isContextDisabled: true,
        unavailableSelectionIsReachable: true,
        lockOverridden: false,
      },
      { isDisabled: true, tooltipKind: "unavailable" },
    ],
  ] satisfies ReadonlyArray<
    [string, Parameters<typeof resolveModelPickerRailButtonState>[0], ModelPickerRailButtonState]
  >)("%s", (_name, input, expected) => {
    expect(resolveModelPickerRailButtonState(input)).toEqual(expected);
  });
});
