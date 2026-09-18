import type { TurnId } from "@t3tools/contracts";

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

export function keepTimelineEndVisibleAfterOverlayGrowth({
  timeline,
  previousOverlayHeight,
  overlayHeight,
  followingEnd,
}: {
  readonly timeline: { scrollToEnd: (options: { animated: boolean }) => unknown } | null;
  readonly previousOverlayHeight: number;
  readonly overlayHeight: number;
  readonly followingEnd: boolean;
}): void {
  if (timeline && followingEnd && overlayHeight > previousOverlayHeight) {
    void timeline.scrollToEnd({ animated: false });
  }
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

export interface RememberedTimelinePosition {
  readonly rowId: string;
  readonly offsetWithinRow: number;
  readonly scrollOffset: number;
  readonly atEnd: boolean;
  readonly disclosures?: {
    readonly turns: ReadonlySet<TurnId>;
    readonly workGroups: ReadonlySet<string>;
    readonly spawnEntries: ReadonlySet<string>;
  };
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
  let rowTop = state.positionAtIndex(0);
  if (rowTop === undefined || !Number.isFinite(rowTop)) return undefined;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const top = state.positionAtIndex(middle);
    if (top === undefined || !Number.isFinite(top)) return undefined;
    if (top <= scrollOffset) {
      index = middle;
      rowTop = top;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return {
    rowId: state.data[index]!.id,
    offsetWithinRow: Math.max(0, scrollOffset - rowTop),
    scrollOffset,
  };
}
