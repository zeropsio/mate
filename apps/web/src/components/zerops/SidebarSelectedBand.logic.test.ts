import { describe, expect, it } from "vite-plus/test";

import { bandMove, bandPlacement } from "./SidebarSelectedBand.logic";

const box = (top: number, height: number, left = 9, width = 411) => ({
  top,
  bottom: top + height,
  left,
  right: left + width,
});

describe("bandPlacement — the selected band over the open Mate's unit", () => {
  const list = box(92, 1400, 9, 411);

  it("covers the unit's own box, measured from the list", () => {
    expect(bandPlacement({ list, unit: box(212, 76), clip: box(184, 600) })).toEqual({
      top: 120,
      left: 0,
      width: 411,
      height: 76,
    });
  });

  it.each([
    { case: "no Mate is open", unit: null, clip: null },
    { case: "the open Mate's project is folded shut", unit: box(212, 76), clip: box(212, 0) },
    { case: "the fold ends above the unit", unit: box(212, 76), clip: box(100, 90) },
  ])("hides where $case", ({ unit, clip }) => {
    expect(bandPlacement({ list, unit, clip })).toBeNull();
  });

  it("shrinks with a fold that is closing over the unit, never standing out of it", () => {
    expect(bandPlacement({ list, unit: box(212, 76), clip: box(184, 60) })).toEqual({
      top: 120,
      left: 0,
      width: 411,
      height: 32,
    });
  });

  it("covers the whole unit where nothing folds it", () => {
    expect(bandPlacement({ list, unit: box(212, 58), clip: null })?.height).toBe(58);
  });
});

describe("bandMove — how the band gets to its place", () => {
  const at = { top: 120, left: 0, width: 411, height: 76 };
  const below = { top: 320, left: 0, width: 411, height: 58 };

  it.each([
    {
      case: "the first paint places it without a move",
      previous: undefined,
      key: "nova",
      next: at,
      move: "place",
    },
    {
      case: "a row opened after another slides to it",
      previous: { key: "juno", placement: below },
      key: "nova",
      next: at,
      move: "slide",
    },
    {
      case: "the same row moved by a reflow follows at once",
      previous: { key: "nova", placement: below },
      key: "nova",
      next: at,
      move: "place",
    },
    {
      case: "a row coming back into view is placed, not flown in",
      previous: { key: "juno", placement: null },
      key: "nova",
      next: at,
      move: "place",
    },
    {
      case: "a row folded away hides the band",
      previous: { key: "nova", placement: at },
      key: "nova",
      next: null,
      move: "hide",
    },
  ] as const)("$case", ({ previous, key, next, move }) => {
    expect(bandMove(previous, key, next, false)).toBe(move);
  });

  it("never slides with reduced motion: the band is placed", () => {
    expect(bandMove({ key: "juno", placement: below }, "nova", at, true)).toBe("place");
  });
});
