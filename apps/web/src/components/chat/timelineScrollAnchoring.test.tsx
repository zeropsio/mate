import { describe, expect, it, vi } from "vite-plus/test";
import {
  cssLengthToPx,
  describeTimelineAnchor,
  getAnchoredTurnMetrics,
  getRowBottom,
  judgeTimelinePlacing,
  readTimelinePosition,
  rememberTimelinePosition,
  resolveTimelineRestoreTarget,
  resolveTimelineScrollAnchor,
  type RememberedTimelinePosition,
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
  const reading: RememberedTimelinePosition = {
    rowId: "message-4",
    offsetWithinRow: 32,
    rowHeight: 180,
    cardTopId: null,
    previousRowId: "message-3",
    atEnd: false,
  };
  const following: RememberedTimelinePosition = {
    rowId: "message-9",
    offsetWithinRow: 10,
    rowHeight: 120,
    cardTopId: null,
    previousRowId: "message-8",
    atEnd: true,
  };

  it("keeps reading positions and end-follow independent across threads and environments", () => {
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
    expect(resolveTimelineScrollAnchor(state)).toEqual({ rowId: "row-2", index: 2 });
    expect(resolveTimelineScrollAnchor({ ...state, data: [] })).toBeUndefined();
  });

  // What a reading position holds besides its row: the run's card the row
  // stands in, whose line is where a folded run is come back to, and the row
  // above it, whose foot is where a row since gone is come back to.
  it.each<{
    readonly case: string;
    readonly rows: ReadonlyArray<{
      readonly id: string;
      readonly card?: "top" | "middle" | "bottom";
    }>;
    readonly index: number;
    readonly cardTopId: string | null;
    readonly previousRowId: string | null;
  }>([
    {
      case: "a row outside any card has no run's line",
      rows: [{ id: "ask-1" }, { id: "answer-1" }],
      index: 1,
      cardTopId: null,
      previousRowId: "ask-1",
    },
    {
      case: "a run's record is its own card's top",
      rows: [{ id: "ask-1" }, { id: "record-1", card: "top" }, { id: "end-1", card: "bottom" }],
      index: 1,
      cardTopId: "record-1",
      previousRowId: "ask-1",
    },
    {
      case: "a row inside a card goes back to the card's top",
      rows: [
        { id: "record-1", card: "top" },
        { id: "end-1", card: "bottom" },
        { id: "ask-2" },
        { id: "record-2", card: "top" },
        { id: "working-2", card: "middle" },
        { id: "result-2", card: "middle" },
        { id: "end-2", card: "bottom" },
      ],
      index: 5,
      cardTopId: "record-2",
      previousRowId: "working-2",
    },
    {
      case: "the conversation's first row has nothing above it",
      rows: [{ id: "record-1", card: "top" }],
      index: 0,
      cardTopId: "record-1",
      previousRowId: null,
    },
  ])("$case", ({ rows, index, cardTopId, previousRowId }) => {
    expect(describeTimelineAnchor(rows, index)).toEqual({ cardTopId, previousRowId });
  });

  const inRun: RememberedTimelinePosition = {
    rowId: "record-2",
    offsetWithinRow: 640,
    rowHeight: 900,
    cardTopId: "record-2",
    previousRowId: "ask-2",
    atEnd: false,
  };
  const inResult: RememberedTimelinePosition = {
    rowId: "result-2",
    offsetWithinRow: 30,
    rowHeight: 96,
    cardTopId: "record-2",
    previousRowId: "working-2",
    atEnd: false,
  };
  const inAnswer: RememberedTimelinePosition = {
    rowId: "answer-1",
    offsetWithinRow: 120,
    rowHeight: 400,
    cardTopId: null,
    previousRowId: "end-1",
    atEnd: false,
  };

  // Where the person was is kept by row, not by pixels: a run folded since
  // they left brings them back to its line, never to an offset that points
  // somewhere else now.
  it.each<{
    readonly case: string;
    readonly position: RememberedTimelinePosition;
    readonly rowIds: ReadonlyArray<string>;
    readonly heights: Readonly<Record<string, number>>;
    readonly target: ReturnType<typeof resolveTimelineRestoreTarget>;
  }>([
    {
      case: "following the end stays following the end",
      position: { ...inAnswer, atEnd: true },
      rowIds: ["ask-1", "answer-1"],
      heights: {},
      target: { kind: "end" },
    },
    {
      case: "a row not measured yet is aimed at where it was read",
      position: inAnswer,
      rowIds: ["end-1", "answer-1"],
      heights: {},
      target: { kind: "row", rowId: "answer-1", offsetWithinRow: 120 },
    },
    {
      case: "a row the same height comes back exactly where it was read",
      position: inAnswer,
      rowIds: ["end-1", "answer-1"],
      heights: { "answer-1": 400.5 },
      target: { kind: "row", rowId: "answer-1", offsetWithinRow: 120 },
    },
    {
      case: "a row that grew at its end keeps the line that was read",
      position: inAnswer,
      rowIds: ["end-1", "answer-1"],
      heights: { "answer-1": 760 },
      target: { kind: "row", rowId: "answer-1", offsetWithinRow: 120 },
    },
    {
      case: "a run folded since comes back to its line",
      position: inRun,
      rowIds: ["ask-2", "record-2", "result-2"],
      heights: { "record-2": 212 },
      target: { kind: "line", rowId: "record-2", edge: "top" },
    },
    {
      case: "a row of a run's card that shrank comes back to the run's line",
      position: inResult,
      rowIds: ["ask-2", "record-2", "result-2"],
      heights: { "result-2": 48, "record-2": 212 },
      target: { kind: "line", rowId: "record-2", edge: "top" },
    },
    {
      case: "a row of a run's card still whole is read on, whatever folded above it",
      position: inResult,
      rowIds: ["ask-2", "record-2", "result-2"],
      heights: { "result-2": 96, "record-2": 212 },
      target: { kind: "row", rowId: "result-2", offsetWithinRow: 30 },
    },
    {
      case: "a row outside any card that shrank comes back to its own top",
      position: inAnswer,
      rowIds: ["end-1", "answer-1"],
      heights: { "answer-1": 300 },
      target: { kind: "line", rowId: "answer-1", edge: "top" },
    },
    {
      case: "a row of a run's card since gone comes back to the run's line",
      position: { ...inResult, rowId: "working-2" },
      rowIds: ["ask-2", "record-2", "result-2"],
      heights: {},
      target: { kind: "line", rowId: "record-2", edge: "top" },
    },
    {
      case: "a row since gone comes back to the foot of the row above it",
      position: inAnswer,
      rowIds: ["end-1", "answer-2"],
      heights: {},
      target: { kind: "line", rowId: "end-1", edge: "foot" },
    },
    {
      case: "with nothing of it left, the conversation opens at its end",
      position: inAnswer,
      rowIds: ["ask-9", "answer-9"],
      heights: {},
      target: { kind: "end" },
    },
  ])("$case", ({ position, rowIds, heights, target }) => {
    expect(
      resolveTimelineRestoreTarget({
        position,
        rowIds,
        heightOf: (rowId) => heights[rowId],
      }),
    ).toEqual(target);
  });
});

describe("where a conversation's first line sits", () => {
  // Under the fade the header casts on the list (`topbar-scroll-fade`), read
  // from its custom property as the page declares it.
  it.each([
    { value: "3rem", px: 48 },
    { value: " 2.5rem", px: 40 },
    { value: "12px", px: 12 },
    { value: "", px: 0 },
    { value: "calc(1rem + 2px)", px: 0 },
  ])("$value is $px px", ({ value, px }) => {
    expect(cssLengthToPx(value, 16)).toBe(px);
  });
});

describe("placing a conversation where it stays", () => {
  // From the list's mount until it stands where it stays — a reading position
  // put back, or the end reached — frame by frame, one loop however often its
  // rows change (a Mate streaming its answer changes them every frame), and
  // its measured anchor is applied before it shows.
  it.each<{
    readonly case: string;
    readonly frame: Parameters<typeof judgeTimelinePlacing>[0];
    readonly stableFrames: number;
    readonly verdict: ReturnType<typeof judgeTimelinePlacing>["verdict"];
    readonly next: number;
  }>([
    {
      case: "waits for the list to show its rows",
      frame: { listReady: false, offBy: 0 },
      stableFrames: 1,
      verdict: "wait",
      next: 0,
    },
    {
      case: "waits for the row it lands on to be drawn",
      frame: { listReady: true, offBy: null },
      stableFrames: 1,
      verdict: "wait",
      next: 0,
    },
    {
      case: "puts back a place more than a pixel off",
      frame: { listReady: true, offBy: 74 },
      stableFrames: 1,
      verdict: "correct",
      next: 0,
    },
    {
      case: "counts a frame that stands where it stays",
      frame: { listReady: true, offBy: 0.5 },
      stableFrames: 0,
      verdict: "wait",
      next: 1,
    },
    {
      case: "is placed after two frames standing where it stays",
      frame: { listReady: true, offBy: -1 },
      stableFrames: 1,
      verdict: "placed",
      next: 2,
    },
  ])("$case", ({ frame, stableFrames, verdict, next }) => {
    expect(judgeTimelinePlacing(frame, stableFrames)).toEqual({ verdict, stableFrames: next });
  });
});
