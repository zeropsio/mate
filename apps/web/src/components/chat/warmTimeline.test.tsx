import { act, createElement as h } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { WARM_AFTER_REST_MS, useWarmIntent, useWarmTimelineAsk } from "./warmTimeline";

// A menu row's intent to open its conversation warms it: the pointer resting
// on the row, focus, a touch. Only the newest is asked for.
let asked: string | null = null;
function Row({ threadKey }: { readonly threadKey: string | undefined }) {
  asked = useWarmTimelineAsk();
  return h("button", useWarmIntent(threadKey));
}

let tree: ReactTestRenderer | undefined;
const row = (threadKey: string | undefined) => {
  act(() => {
    tree = create(h(Row, { threadKey }));
  });
  return tree!.root.findByType("button").props;
};
const pointer = (pointerType: string) => ({ pointerType }) as never;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
afterEach(() => {
  act(() => tree?.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useWarmIntent", () => {
  it("asks once the pointer has rested on the row, not before", () => {
    const handlers = row("env:rest");
    act(() => handlers.onPointerEnter(pointer("mouse")));
    act(() => vi.advanceTimersByTime(WARM_AFTER_REST_MS - 1));
    expect(asked).not.toBe("env:rest");
    act(() => vi.advanceTimersByTime(1));
    expect(asked).toBe("env:rest");
  });

  it("asks nothing for a pointer passing over", () => {
    const handlers = row("env:passing");
    act(() => handlers.onPointerEnter(pointer("mouse")));
    act(() => handlers.onPointerLeave());
    act(() => vi.advanceTimersByTime(WARM_AFTER_REST_MS * 2));
    expect(asked).not.toBe("env:passing");
  });

  it.each([
    { case: "focus", press: (handlers: ReturnType<typeof row>) => handlers.onFocus({}) },
    {
      case: "a touch",
      press: (handlers: ReturnType<typeof row>) => handlers.onPointerDown(pointer("touch")),
    },
  ])("asks at once on $case", ({ case: name, press }) => {
    const key = `env:${name}`;
    const handlers = row(key);
    act(() => press(handlers));
    expect(asked).toBe(key);
  });

  it("asks nothing for a row whose conversation is not known", () => {
    const before = asked;
    const handlers = row(undefined);
    act(() => handlers.onFocus({}));
    expect(asked).toBe(before);
  });
});
