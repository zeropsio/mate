import { describe, expect, it, vi } from "vite-plus/test";
import {
  getAnchoredTurnMetrics,
  getRowBottom,
  keepTimelineEndVisibleAfterOverlayGrowth,
  readTimelinePosition,
  rememberTimelinePosition,
  resolveTimelineScrollAnchor,
  shouldRepinTimelineEndAfterRowResize,
} from "./timelineScrollAnchoring";

function buildState({
  positions,
  sizes,
  scroll = 0,
  scrollLength = 700,
}: {
  readonly positions: readonly number[];
  readonly sizes: readonly number[];
  readonly scroll?: number;
  readonly scrollLength?: number;
}) {
  return {
    data: positions.map((_, index) => index),
    scroll,
    scrollLength,
    positionAtIndex: (index: number) => positions[index],
    sizeAtIndex: (index: number) => sizes[index],
  };
}

describe("timeline scroll anchoring", () => {
  it("keeps the live edge visible when the composer overlay grows", () => {
    const scrollToEnd = vi.fn();

    keepTimelineEndVisibleAfterOverlayGrowth({
      timeline: { scrollToEnd },
      previousOverlayHeight: 120,
      overlayHeight: 180,
      followingEnd: true,
    });

    expect(scrollToEnd).toHaveBeenCalledOnce();
    expect(scrollToEnd).toHaveBeenCalledWith({ animated: false });
  });

  it("leaves the scroll position alone while the user reads history", () => {
    const scrollToEnd = vi.fn();

    keepTimelineEndVisibleAfterOverlayGrowth({
      timeline: { scrollToEnd },
      previousOverlayHeight: 120,
      overlayHeight: 180,
      followingEnd: false,
    });

    expect(scrollToEnd).not.toHaveBeenCalled();
  });

  // A row easing to a new height — the Mate's stream opening for its
  // question — grows by a few pixels in each late frame. LegendList re-pins
  // only a measurement that moved a row by more than 5 px, and those frames
  // left the end 40 px under the composer.
  it.each([
    {
      case: "follows a late frame of a row easing taller",
      followingEnd: true,
      withinFollowThreshold: true,
      previousSize: 412,
      size: 415,
      repin: true,
    },
    {
      case: "follows a step LegendList re-pins itself too",
      followingEnd: true,
      withinFollowThreshold: true,
      previousSize: 300,
      size: 312,
      repin: true,
    },
    {
      case: "leaves a row settling shorter to the browser's clamp",
      followingEnd: true,
      withinFollowThreshold: true,
      previousSize: 415,
      size: 410,
      repin: false,
    },
    {
      case: "ignores a measurement that changed nothing",
      followingEnd: true,
      withinFollowThreshold: true,
      previousSize: 415,
      size: 415,
      repin: false,
    },
    {
      case: "holds still while history is read",
      followingEnd: false,
      withinFollowThreshold: true,
      previousSize: 412,
      size: 415,
      repin: false,
    },
    {
      case: "holds still with the end more than a viewport away",
      followingEnd: true,
      withinFollowThreshold: false,
      previousSize: 412,
      size: 415,
      repin: false,
    },
  ])("$case", ({ followingEnd, withinFollowThreshold, previousSize, size, repin }) => {
    expect(
      shouldRepinTimelineEndAfterRowResize({
        followingEnd,
        withinFollowThreshold,
        previousSize,
        size,
      }),
    ).toBe(repin);
  });

  it("measures row bottoms from LegendList row position and size", () => {
    const state = buildState({
      positions: [0, 120],
      sizes: [80, 40],
    });

    expect(getRowBottom(state, 1)).toBe(160);
  });

  it("treats the active turn as fitting when it fits above the composer", () => {
    const state = buildState({
      positions: [0, 300, 460],
      sizes: [240, 80, 140],
      scrollLength: 760,
    });

    const metrics = getAnchoredTurnMetrics({
      state,
      anchorIndex: 1,
      composerOverlayHeight: 180,
      anchorOffset: 16,
    });

    expect(metrics?.turnHeight).toBe(300);
    expect(metrics?.usableViewportHeight).toBe(564);
    expect(metrics?.overflowsUsableViewport).toBe(false);
    expect(metrics?.targetScrollToRevealEnd).toBe(36);
    expect(metrics?.scrollDeltaToRevealEnd).toBe(36);
  });

  it("targets the real row end instead of any temporary reserved tail", () => {
    const state = buildState({
      positions: [0, 1720, 1880],
      sizes: [1600, 80, 120],
      scroll: 1900,
      scrollLength: 760,
    });

    const metrics = getAnchoredTurnMetrics({
      state,
      anchorIndex: 1,
      composerOverlayHeight: 180,
      anchorOffset: 16,
    });

    expect(metrics?.lastBottom).toBe(2000);
    expect(metrics?.targetScrollToRevealEnd).toBe(1436);
    expect(metrics?.scrollDeltaToRevealEnd).toBe(0);
  });

  it("reports overflow only for the current anchored turn", () => {
    const state = buildState({
      positions: [0, 900, 1180],
      sizes: [800, 220, 300],
      scroll: 900,
      scrollLength: 760,
    });

    const metrics = getAnchoredTurnMetrics({
      state,
      anchorIndex: 1,
      composerOverlayHeight: 180,
      anchorOffset: 16,
    });

    expect(metrics?.turnHeight).toBe(580);
    expect(metrics?.usableViewportHeight).toBe(564);
    expect(metrics?.overflowsUsableViewport).toBe(true);
  });

  it("returns the minimal positive scroll delta needed to reveal the turn end", () => {
    const state = buildState({
      positions: [0, 900, 1180],
      sizes: [800, 220, 360],
      scroll: 900,
      scrollLength: 760,
    });

    const metrics = getAnchoredTurnMetrics({
      state,
      anchorIndex: 1,
      composerOverlayHeight: 180,
      anchorOffset: 16,
    });

    expect(metrics?.lastBottom).toBe(1540);
    expect(metrics?.visibleUsableBottom).toBe(1464);
    expect(metrics?.scrollDeltaToRevealEnd).toBe(76);
  });

  it("subtracts composer height from usable viewport height", () => {
    const state = buildState({
      positions: [0, 300],
      sizes: [120, 470],
      scrollLength: 700,
    });

    const withoutComposer = getAnchoredTurnMetrics({
      state,
      anchorIndex: 1,
      composerOverlayHeight: 0,
      anchorOffset: 16,
    });
    const withComposer = getAnchoredTurnMetrics({
      state,
      anchorIndex: 1,
      composerOverlayHeight: 220,
      anchorOffset: 16,
    });

    expect(withoutComposer?.overflowsUsableViewport).toBe(false);
    expect(withComposer?.overflowsUsableViewport).toBe(true);
  });
});

describe("remembered timeline positions", () => {
  it("keeps reading positions and end-follow independent across threads and environments", () => {
    const reading = { rowId: "message-4", offsetWithinRow: 32, scrollOffset: 932, atEnd: false };
    const following = { rowId: "message-9", offsetWithinRow: 10, scrollOffset: 2010, atEnd: true };
    rememberTimelinePosition("scroll-test-a:thread-1", reading);
    rememberTimelinePosition("scroll-test-a:thread-2", following);
    rememberTimelinePosition("scroll-test-b:thread-1", following);
    expect(readTimelinePosition("scroll-test-a:thread-1")).toEqual(reading);
    expect(readTimelinePosition("scroll-test-a:thread-2")).toEqual(following);
    expect(readTimelinePosition("scroll-test-b:thread-1")).toEqual(following);
    expect(readTimelinePosition("scroll-test-a:unvisited")).toBeUndefined();
    rememberTimelinePosition("scroll-test-a:thread-1", following);
    expect(readTimelinePosition("scroll-test-a:thread-1")).toEqual(following);
  });

  it("anchors on the row at the scroll offset", () => {
    const tops = [0, 100, 250, 400];
    const state = {
      data: tops.map((_, index) => ({ id: `row-${index}` })),
      scroll: 260,
      positionAtIndex: (index: number) => tops[index],
    };
    expect(resolveTimelineScrollAnchor(state)).toEqual({
      rowId: "row-2",
      offsetWithinRow: 10,
      scrollOffset: 260,
    });
    expect(resolveTimelineScrollAnchor({ ...state, data: [] })).toBeUndefined();
  });
});
