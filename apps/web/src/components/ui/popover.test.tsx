// @vitest-environment happy-dom
/**
 * A popover is sized by its own CSS, capped by the room beside its trigger
 * (`--available-height`), from its first frame. Nothing measures it with that
 * cap lifted and pins the measurement on it: a pinned size held a menu taller
 * than the room at its full height while it opened, then snapped it to its
 * cap, and positioned it by the uncapped size.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { Popover, PopoverPopup, PopoverTrigger } from "./popover";

let root: Root | undefined;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("an open popover", () => {
  it.each([
    { slot: "popover-positioner", size: "--positioner-height" },
    { slot: "popover-positioner", size: "--positioner-width" },
    { slot: "popover-popup", size: "--popup-height" },
    { slot: "popover-popup", size: "--popup-width" },
  ])("sizes its $slot by CSS alone, with no $size set on it", async ({ slot, size }) => {
    root = createRoot(document.body.appendChild(document.createElement("div")));
    await act(() =>
      root!.render(
        <Popover open>
          <PopoverTrigger>Opus 5.5 · Max</PopoverTrigger>
          <PopoverPopup padding="none">
            <p>Low, Medium, High, Extra High, Max, Ultracode, Ultrathink</p>
          </PopoverPopup>
        </Popover>,
      ),
    );

    const element = document.querySelector<HTMLElement>(`[data-slot="${slot}"]`);
    expect(element).not.toBeNull();
    expect(element!.style.getPropertyValue(size)).toBe("");
  });
});
