// @effect-diagnostics nodeBuiltinImport:off - reads the installed JS bundles for synchronous VM tests.
import * as NodeFS from "node:fs";
import * as NodeVM from "node:vm";
import { describe, expect, it, vi } from "vite-plus/test";

// The web viewport's native range, including the room keeping the first message on its line.
function createAnchoredWebList(bundle: string) {
  const source = NodeFS.readFileSync(
    new URL(`../apps/web/node_modules/@legendapp/list/${bundle}`, import.meta.url),
    "utf8",
  );
  const anchoredSpace = source.slice(
    source.indexOf("function maybeUpdateAnchoredEndSpace("),
    source.indexOf("// src/core/updateItemSizes.ts"),
  );
  type Row = { id: string; height?: number };
  const onReady = vi.fn();
  const values = new Map<string, number>([["footerSize", 16]]);
  const state = {
    props: {
      data: [
        { id: "day", height: 16 },
        { id: "person", height: 66.75 },
        { id: "run", height: 119 },
        { id: "working", height: 0 },
        { id: "run-end", height: 16 },
      ] as Row[],
      anchoredEndSpace: { anchorIndex: 1, anchorOffset: 16, onReady },
    },
    scrollLength: 935,
  };
  const ctx = { state, values, scrollAxisGap: 0 };
  const api = NodeVM.runInNewContext(
    `${anchoredSpace}\n({ update: maybeUpdateAnchoredEndSpace })`,
    {
      getId: (_state: unknown, index: number) => state.props.data[index]!.id,
      getKnownOrFixedItemSize: (_ctx: unknown, index: number) => state.props.data[index]!.height,
      getItemSizeAtIndex: (_ctx: unknown, index: number) => state.props.data[index]!.height ?? 90,
      getStylePaddingEnd: () => 0,
      peek$: (_ctx: unknown, key: string) => values.get(key),
      set$: (_ctx: unknown, key: string, value: number) => values.set(key, value),
      updateContentMetricsState: vi.fn(),
      updateScroll: vi.fn(),
    },
  ) as { update: (context: typeof ctx) => void };
  let nativeTop = 48;
  const draw = () => {
    api.update(ctx);
    // The browser clamps against its actual rendered range, independently of the logical target.
    const rowsHeight = state.props.data.reduce((sum, row) => sum + (row.height ?? 90), 0);
    const end = Math.max(0, 48 + rowsHeight + 16 + (values.get("anchoredEndSpaceSize") ?? 0) - 935);
    nativeTop = Math.min(nativeTop, end);
    return nativeTop;
  };
  draw();
  onReady.mockClear();
  return {
    onReady,
    room: () => values.get("anchoredEndSpaceSize"),
    replace: (tail: Row[]) => {
      state.props.data = [...state.props.data.slice(0, 2), ...tail];
      return draw();
    },
  };
}

describe.each(["react.js", "react.mjs"])("web anchor room (%s)", (bundle) => {
  it("the first message stays on its line while unmeasured rows replace the run", () => {
    const list = createAnchoredWebList(bundle);
    for (const tail of [
      [{ id: "work" }],
      [{ id: "work", height: 44 }],
      [{ id: "work", height: 44 }, { id: "answer" }],
      [
        { id: "work", height: 44 },
        { id: "answer", height: 71.75 },
      ],
    ]) {
      expect(
        list.replace(tail),
        "ASSERTION: replacement rows never clamp away the first message's 48 px offset",
      ).toBe(48);
      if (tail.some((row) => row.height === undefined))
        expect(
          list.onReady,
          "ASSERTION: estimated room never proves measured readiness",
        ).not.toHaveBeenCalled();
      list.onReady.mockClear();
    }
  });

  it("reserved room yields to work taller than the conversation viewport", () => {
    const list = createAnchoredWebList(bundle);
    list.replace([{ id: "work", height: 1050 }]);
    expect(list.room(), "ASSERTION: tall work consumes the reserved room").toBe(0);
    expect(list.onReady, "ASSERTION: measured work is ready").toHaveBeenCalledOnce();
  });
});

// Exercise the shipped patch without loading React Native in the Node runner.
// Native scroll delivery and animation frames advance independently here.
function createList(bundle: string) {
  const source = NodeFS.readFileSync(
    new URL(`../apps/mobile/node_modules/@legendapp/list/${bundle}`, import.meta.url),
    "utf8",
  );
  const renderState = source.slice(
    source.indexOf("function setInitialRenderState("),
    source.indexOf("// src/core/finishInitialScroll.ts"),
  );
  const watchdog = source.slice(
    source.indexOf("var INSET_END_SETTLE_WATCHDOG_FRAMES"),
    source.indexOf("function dispatchInitialScroll("),
  );
  const frames: Array<() => void> = [];
  const values = new Map<string, unknown>();
  const scrollTo = vi.fn();
  const onLoad = vi.fn();
  const state = {
    props: { data: ["message"], onLoad, drawDistance: 500 },
    initialScroll: { index: 0, viewPosition: 1 },
    loadStartTime: 0,
    didContainersLayout: true,
    didFinishInitialScroll: true,
    didLoad: false,
    didUserDrag: false,
    scrollLength: 800,
    scroll: 400,
    lastNativeScroll: 200 as number | undefined,
    scrollingTo: undefined as { offset: number } | undefined,
    maintainingScrollAtEnd: false,
    refScroller: { current: { scrollTo } },
  };
  const ctx = { state };
  let contentSize = 1200;
  let inset = 100;
  const api = NodeVM.runInNewContext(
    `${renderState}\n${watchdog}\n({ start: startInsetEndSettleWatchdog, complete: setInitialRenderState })`,
    {
      requestAnimationFrame: (callback: () => void) => frames.push(callback),
      getContentSize: () => contentSize,
      getContentInsetStartAdjustment: () => inset,
      peek$: (_ctx: unknown, key: string) => values.get(key),
      set$: (_ctx: unknown, key: string, value: unknown) => values.set(key, value),
      setAdaptiveRender: vi.fn(),
      scheduleFullDrawDistancePrewarm: vi.fn(),
      INITIAL_DRAW_DISTANCE: 250,
    },
  ) as {
    start: (context: typeof ctx) => void;
    complete: (context: typeof ctx, flags: Record<string, boolean>) => void;
  };
  return {
    state,
    scrollTo,
    onLoad,
    start: () => api.start(ctx),
    complete: () => api.complete(ctx, {}),
    ready: () => values.get("readyToRender") === true,
    resize: (size: number) => {
      contentSize = size;
    },
    setInset: (value: number) => {
      inset = value;
    },
    advance(count: number) {
      for (let index = 0; index < count; index++) {
        const batch = frames.splice(0);
        for (const frame of batch) frame();
      }
    },
  };
}

describe.each(
  Array.from(["react-native.js", "react-native.mjs"], (bundle) => ({
    title: `initial inset end reveal (${bundle})`,
    bundle,
  })),
)("$title", ({ bundle }) => {
  it("waits for the native offset instead of the optimistic scroll target", () => {
    const list = createList(bundle);
    list.start();
    list.advance(8);
    expect(list.ready()).toBe(false);
    expect(list.scrollTo).toHaveBeenCalledWith({ animated: false, x: 0, y: 400 });
    list.state.lastNativeScroll = 400;
    list.advance(7);
    expect(list.ready()).toBe(true);
    expect(list.onLoad).toHaveBeenCalledTimes(1);
  });

  it("gates the seeded contentOffset completion path too", () => {
    const list = createList(bundle);
    list.complete();
    expect(list.ready()).toBe(false);
    list.state.lastNativeScroll = 400;
    list.advance(7);
    expect(list.ready()).toBe(true);
  });

  it("preserves an initial index before the last item", () => {
    const list = createList(bundle);
    list.state.props.data = ["requested message", "later message"];
    list.state.scroll = 200;
    list.complete();
    list.advance(8);
    expect(list.ready()).toBe(true);
    expect(list.scrollTo).not.toHaveBeenCalled();
  });

  it("does not count an in-flight scroll as stability", () => {
    const list = createList(bundle);
    list.state.lastNativeScroll = 400;
    list.state.scrollingTo = { offset: 400 };
    list.start();
    list.advance(8);
    expect(list.ready()).toBe(false);
    list.state.scrollingTo = undefined;
    list.state.maintainingScrollAtEnd = true;
    list.advance(8);
    expect(list.ready()).toBe(false);
    list.state.maintainingScrollAtEnd = false;
    list.advance(7);
    expect(list.ready()).toBe(true);
  });

  it("waits for a stable end target even when native scrolling follows each measurement", () => {
    const list = createList(bundle);
    list.start();
    for (let index = 0; index < 10; index++) {
      list.resize(1200 + index * 10);
      list.state.lastNativeScroll = 400 + index * 10;
      list.advance(1);
    }
    expect(list.ready()).toBe(false);
    list.advance(7);
    expect(list.ready()).toBe(true);
  });

  it("accounts for header insets when content is shorter than the full viewport", () => {
    const list = createList(bundle);
    list.resize(780);
    list.state.scroll = -20;
    list.state.lastNativeScroll = -100;
    list.start();
    list.advance(8);
    expect(list.ready()).toBe(false);
    expect(list.scrollTo).toHaveBeenCalledWith({ animated: false, x: 0, y: -20 });
    list.state.lastNativeScroll = -20;
    list.advance(7);
    expect(list.ready()).toBe(true);
  });

  it("keeps the reveal bounded when native events never arrive", () => {
    const list = createList(bundle);
    list.state.lastNativeScroll = undefined;
    list.start();
    list.advance(8);
    expect(list.ready()).toBe(false);
    expect(list.scrollTo).not.toHaveBeenCalled();
    list.advance(32);
    expect(list.ready()).toBe(true);
  });

  it("releases control on drag and never starts another initial hold", () => {
    const list = createList(bundle);
    list.start();
    list.state.didUserDrag = true;
    list.advance(1);
    expect(list.ready()).toBe(true);
    expect(list.scrollTo).not.toHaveBeenCalled();
    list.complete();
    list.start();
    list.advance(20);
    expect(list.state.didUserDrag).toBe(true);
    expect(list.scrollTo).not.toHaveBeenCalled();
    expect(list.onLoad).toHaveBeenCalledTimes(1);
  });

  it("preserves a drag that started before initial layout completed", () => {
    const list = createList(bundle);
    list.state.didUserDrag = true;
    list.complete();
    list.advance(1);
    expect(list.ready()).toBe(true);
    expect(list.state.didUserDrag).toBe(true);
    expect(list.scrollTo).not.toHaveBeenCalled();
  });

  it("reveals short content at UIKit's resting offset without awaiting a scroll event", () => {
    const list = createList(bundle);
    list.resize(700);
    list.state.lastNativeScroll = undefined;
    list.complete();
    expect(list.ready()).toBe(true);
    list.advance(10);
    expect(list.scrollTo).not.toHaveBeenCalled();
  });

  it("does not gate empty lists or lists without an automatic header inset", () => {
    const list = createList(bundle);
    list.setInset(0);
    list.complete();
    expect(list.ready()).toBe(true);
    const empty = createList(bundle);
    empty.state.props.data = [];
    empty.complete();
    expect(empty.ready()).toBe(true);
  });
});
