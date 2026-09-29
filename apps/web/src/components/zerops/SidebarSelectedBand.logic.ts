/**
 * Where the menu's one selected band stands, and how it gets there (pass 16,
 * M11, T2): over the open Mate's row, measured from the list; clipped by the
 * row's project fold while it folds, so it never stands out of it; sliding
 * only when another row is opened — a reflow moves it at once, so it never
 * lags a frame behind its row.
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

/** The band over `row` — its visible part, where a fold clips it — or none where nothing shows. */
export function bandPlacement(input: {
  readonly list: BandBox;
  readonly row: BandBox | null;
  /** The row's project fold, which clips it while it folds; `null` where nothing folds it. */
  readonly clip: BandBox | null;
}): BandPlacement | null {
  const { list, row, clip } = input;
  if (row === null) return null;
  const top = clip === null ? row.top : Math.max(row.top, clip.top);
  const bottom = clip === null ? row.bottom : Math.min(row.bottom, clip.bottom);
  if (bottom - top <= 0) return null;
  return {
    top: top - list.top,
    left: row.left - list.left,
    width: row.right - row.left,
    height: bottom - top,
  };
}

/**
 * How the band gets to `next`: placed where it stands (a first paint, a
 * reflow, a row coming back into view, reduced motion), sliding from the row
 * it was over to a row opened after it, or hidden where its row is not shown.
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
