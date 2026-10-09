import { onAccountLifetimeClose } from "../../zerops/accountLifetime";

export type TimelineScrollMode = "following-end" | "anchoring-new-turn" | "free-scrolling";

export interface TimelineListMeasurementState {
  readonly data: readonly unknown[];
  readonly scroll: number;
  readonly scrollLength: number;
  readonly positionAtIndex: (index: number) => number | undefined;
  readonly sizeAtIndex: (index: number) => number | undefined;
}

export interface AnchoredTurnMetrics {
  readonly anchorTop: number;
  readonly lastBottom: number;
  readonly turnHeight: number;
  readonly usableViewportHeight: number;
  readonly visibleUsableBottom: number;
  readonly overflowsUsableViewport: boolean;
  readonly targetScrollToRevealEnd: number;
  readonly scrollDeltaToRevealEnd: number;
}

export function getRowBottom(state: TimelineListMeasurementState, index: number): number | null {
  const top = state.positionAtIndex(index);
  const height = state.sizeAtIndex(index);
  if (
    typeof top !== "number" ||
    typeof height !== "number" ||
    !Number.isFinite(top) ||
    !Number.isFinite(height)
  ) {
    return null;
  }

  return top + Math.max(1, height);
}

export function getAnchoredTurnMetrics({
  state,
  anchorIndex,
  composerOverlayHeight,
  anchorOffset,
}: {
  readonly state: TimelineListMeasurementState;
  readonly anchorIndex: number;
  readonly composerOverlayHeight: number;
  readonly anchorOffset: number;
}): AnchoredTurnMetrics | null {
  if (state.data.length === 0) {
    return null;
  }

  const boundedAnchorIndex = Math.max(0, Math.min(anchorIndex, state.data.length - 1));
  const anchorTop = state.positionAtIndex(boundedAnchorIndex);
  const lastBottom = getRowBottom(state, state.data.length - 1);
  if (typeof anchorTop !== "number" || !Number.isFinite(anchorTop) || lastBottom === null) {
    return null;
  }

  const usableViewportHeight = Math.max(
    0,
    state.scrollLength - composerOverlayHeight - anchorOffset,
  );
  const turnHeight = Math.max(0, lastBottom - anchorTop);
  const visibleUsableBottom = state.scroll + usableViewportHeight;
  const targetScrollToRevealEnd = Math.max(0, lastBottom - usableViewportHeight);
  const scrollDeltaToRevealEnd = Math.max(0, targetScrollToRevealEnd - state.scroll);

  return {
    anchorTop,
    lastBottom,
    turnHeight,
    usableViewportHeight,
    visibleUsableBottom,
    overflowsUsableViewport: turnHeight > usableViewportHeight,
    targetScrollToRevealEnd,
    scrollDeltaToRevealEnd,
  };
}

/**
 * Where the person was in a conversation, kept by row, not by pixels: the row
 * at the reading line (the viewport's top edge) and how far into it, with
 * what it takes to find that place again once the rows have changed — a run
 * the person watched folds when they leave it (K7), and its offset in pixels
 * points somewhere else then.
 */
export interface RememberedTimelinePosition {
  readonly rowId: string;
  readonly offsetWithinRow: number;
  /** The row's height then: shorter now, it has folded. */
  readonly rowHeight: number;
  /** The top of the run's card the row stands in: the run's line. */
  readonly cardTopId: string | null;
  /** The row above it: at its foot is where a row since gone stood. */
  readonly previousRowId: string | null;
  readonly atEnd: boolean;
}

// Scoped thread keys keep separate environments independent. Bound the session cache.
const rememberedTimelinePositions = new Map<string, RememberedTimelinePosition>();
// A reading position is account state: it goes with the account.
onAccountLifetimeClose(() => rememberedTimelinePositions.clear());

export function readTimelinePosition(threadKey: string) {
  return rememberedTimelinePositions.get(threadKey);
}

export function rememberTimelinePosition(threadKey: string, position: RememberedTimelinePosition) {
  rememberedTimelinePositions.delete(threadKey);
  rememberedTimelinePositions.set(threadKey, position);
  if (rememberedTimelinePositions.size > 100) {
    const oldest = rememberedTimelinePositions.keys().next().value;
    if (oldest !== undefined) rememberedTimelinePositions.delete(oldest);
  }
}

/** The row at the current offset; a virtualizer's cached visible range can lag a fling. */
export function resolveTimelineScrollAnchor(state: {
  readonly data: ReadonlyArray<{ readonly id: string }>;
  readonly scroll: number;
  readonly positionAtIndex: (index: number) => number | undefined;
}) {
  if (state.data.length === 0 || !Number.isFinite(state.scroll)) return undefined;
  const scrollOffset = Math.max(0, state.scroll);
  let low = 0;
  let high = state.data.length - 1;
  let index = 0;
  const firstTop = state.positionAtIndex(0);
  if (firstTop === undefined || !Number.isFinite(firstTop)) return undefined;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const top = state.positionAtIndex(middle);
    if (top === undefined || !Number.isFinite(top)) return undefined;
    if (top <= scrollOffset) {
      index = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return { rowId: state.data[index]!.id, index };
}

/** The run's line and the row above, for the row at `index`. */
export function describeTimelineAnchor(
  rows: ReadonlyArray<{ readonly id: string; readonly card?: "top" | "middle" | "bottom" }>,
  index: number,
): Pick<RememberedTimelinePosition, "cardTopId" | "previousRowId"> {
  let cardTopId: string | null = null;
  if (rows[index]?.card !== undefined) {
    for (let cursor = index; cursor >= 0; cursor -= 1) {
      if (rows[cursor]!.card === "top") {
        cardTopId = rows[cursor]!.id;
        break;
      }
    }
  }
  return { cardTopId, previousRowId: rows[index - 1]?.id ?? null };
}

/**
 * Where a remembered position lands: the reading line exactly where it was
 * (`row`), or a row's top or foot where a conversation's first line sits,
 * clear of the fade under the header (`line`).
 */
export type TimelineRestoreTarget =
  | { readonly kind: "end" }
  | { readonly kind: "row"; readonly rowId: string; readonly offsetWithinRow: number }
  | { readonly kind: "line"; readonly rowId: string; readonly edge: "top" | "foot" };

/** A row this much shorter than it was has folded; less is the measure's rounding. */
const FOLDED_BY_PX = 1;

/**
 * Where a remembered position lands in the rows as they are now, measured
 * once they are: the same line of the same row; the run's line when the row
 * has folded since or is gone from its card; the foot of the row above one
 * gone from outside a card; the end when nothing of it is left.
 */
export function resolveTimelineRestoreTarget({
  position,
  rowIds,
  heightOf,
}: {
  readonly position: RememberedTimelinePosition;
  readonly rowIds: ReadonlyArray<string>;
  /** The row's height as measured now, once it is. */
  readonly heightOf: (rowId: string) => number | undefined;
}): TimelineRestoreTarget {
  if (position.atEnd) return { kind: "end" };
  const present = (rowId: string | null): rowId is string =>
    rowId !== null && rowIds.includes(rowId);
  const runLine = present(position.cardTopId) ? position.cardTopId : null;
  if (present(position.rowId)) {
    const height = heightOf(position.rowId);
    if (height === undefined || height > position.rowHeight - FOLDED_BY_PX) {
      return { kind: "row", rowId: position.rowId, offsetWithinRow: position.offsetWithinRow };
    }
    return { kind: "line", rowId: runLine ?? position.rowId, edge: "top" };
  }
  if (runLine !== null) return { kind: "line", rowId: runLine, edge: "top" };
  if (present(position.previousRowId)) {
    return { kind: "line", rowId: position.previousRowId, edge: "foot" };
  }
  return { kind: "end" };
}

/** A declared CSS length in px: rem against the root's font size; anything else is none. */
export function cssLengthToPx(value: string, rootFontSize: number): number {
  const length = /^(\d+(?:\.\d+)?)(rem|px)$/u.exec(value.trim());
  if (length === null) return 0;
  return length[2] === "rem" ? Number(length[1]) * rootFontSize : Number(length[1]);
}

/**
 * Where a conversation's first line sits in `scroller`: under the fade the
 * header casts on the list, when it casts one — a run's line put back at the
 * very top would stand half faded.
 */
export function readTimelineFirstLineInset(scroller: Element): number {
  const view = scroller.ownerDocument.defaultView;
  if (view === null) return 0;
  return cssLengthToPx(
    view.getComputedStyle(scroller).getPropertyValue("--topbar-scroll-fade-height"),
    Number.parseFloat(view.getComputedStyle(scroller.ownerDocument.documentElement).fontSize),
  );
}

/** Frames a conversation must stand where it stays before it is shown. */
const PLACED_AFTER_FRAMES = 2;

/**
 * One frame of placing a conversation: wait for the list and the row it
 * lands on, put back a place more than a pixel off, call it placed after two
 * frames standing where it stays. A deadline cannot prove the rows ready.
 */
export function judgeTimelinePlacing(
  frame: {
    /** The list has placed and shown its rows once (LegendList's `onLoad`). */
    readonly listReady: boolean;
    /** How far the view stands from where it should, in px; null until measurable. */
    readonly offBy: number | null;
  },
  stableFrames: number,
): { readonly verdict: "wait" | "correct" | "placed"; readonly stableFrames: number } {
  if (!frame.listReady || frame.offBy === null) return { verdict: "wait", stableFrames: 0 };
  if (Math.abs(frame.offBy) > 1) return { verdict: "correct", stableFrames: 0 };
  const stable = stableFrames + 1;
  return { verdict: stable >= PLACED_AFTER_FRAMES ? "placed" : "wait", stableFrames: stable };
}
