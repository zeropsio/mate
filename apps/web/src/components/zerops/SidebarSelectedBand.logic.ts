/**
 * Where the menu's one selected band stands, and how it gets there (pass 16,
 * M11, T2): over the open Mate's unit — its row and its crew's line —
 * measured from the list; clipped by the unit's project fold while it folds,
 * so it never stands out of it; sliding only when another Mate is opened — a
 * reflow moves it at once, so it never lags a frame behind its unit.
 */

export interface BandBox {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

export interface BandPlacement {
  /** From the list's top. */
  readonly top: number;
  /** From the list's left. */
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

/** The band over `unit` — its visible part, where a fold clips it — or none where nothing shows. */
export function bandPlacement(input: {
  readonly list: BandBox;
  /** The open Mate's unit: its row, and its crew's line where it has one. */
  readonly unit: BandBox | null;
  /** The unit's project fold, which clips it while it folds; `null` where nothing folds it. */
  readonly clip: BandBox | null;
}): BandPlacement | null {
  const { list, unit, clip } = input;
  if (unit === null) return null;
  const top = clip === null ? unit.top : Math.max(unit.top, clip.top);
  const bottom = clip === null ? unit.bottom : Math.min(unit.bottom, clip.bottom);
  if (bottom - top <= 0) return null;
  return {
    top: top - list.top,
    left: unit.left - list.left,
    width: unit.right - unit.left,
    height: bottom - top,
  };
}

/**
 * How the band gets to `next`: placed where it stands (a first paint, a
 * reflow, a unit coming back into view, reduced motion), sliding from the
 * Mate it was over to one opened after it, or hidden where its unit is not
 * shown.
 */
export function bandMove(
  previous:
    | { readonly key: string | undefined; readonly placement: BandPlacement | null }
    | undefined,
  key: string | undefined,
  next: BandPlacement | null,
  reducedMotion: boolean,
): "place" | "slide" | "hide" {
  if (next === null) return "hide";
  if (previous === undefined || previous.placement === null || reducedMotion) return "place";
  return previous.key === key ? "place" : "slide";
}
