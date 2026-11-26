import { expect, it } from "vite-plus/test";

import {
  slideConfirmNext,
  type SlideConfirmEvent,
  type SlideConfirmValue,
} from "./slide-confirm.logic.ts";

const start: SlideConfirmValue = { position: 0, confirmed: false };
const half: SlideConfirmValue = { position: 0.5, confirmed: false };
const short: SlideConfirmValue = { position: 0.75, confirmed: false };
const atEnd: SlideConfirmValue = { position: 1, confirmed: false };
const confirmed: SlideConfirmValue = { position: 1, confirmed: true };
const key = (name: string): SlideConfirmEvent => ({ type: "key", key: name });

// witness: apps/web/src/components/ui/slide-confirm.logic.ts | return value.position >= 1 ? END : START; → return value.position >= 0.5 ? END : START;
it("UI+1: A slide-to-confirm confirms only when its thumb is let go of at the end, stepped there or sent there by End, goes back to the start when let go of short of it or on Home, Undo or an arrow back once confirmed, and Enter, Space or a locked slide change nothing; breaks: a deletion confirmed by a short drag or by the form's Enter", () => {
  const rows: ReadonlyArray<
    readonly [string, SlideConfirmValue, SlideConfirmEvent, boolean, SlideConfirmValue]
  > = [
    ["dragged to the end, still held", start, { type: "drag", to: 1 }, false, atEnd],
    ["let go of at the end", atEnd, { type: "release" }, false, confirmed],
    ["let go of short", short, { type: "release" }, false, start],
    ["End", start, key("End"), false, confirmed],
    ["an arrow a quarter", half, key("ArrowRight"), false, short],
    ["the fourth arrow", short, key("ArrowRight"), false, confirmed],
    ["Home", half, key("Home"), false, start],
    ["Home once confirmed", confirmed, key("Home"), false, start],
    ["an arrow back once confirmed", confirmed, key("ArrowLeft"), false, start],
    ["Undo", confirmed, { type: "undo" }, false, start],
    ["a drag once confirmed", confirmed, { type: "drag", to: 0.2 }, false, confirmed],
    ["Enter", half, key("Enter"), false, half],
    ["Space", half, key(" "), false, half],
    ["locked, let go of at the end", atEnd, { type: "release" }, true, atEnd],
    ["locked, End", start, key("End"), true, start],
    ["locked, Undo", confirmed, { type: "undo" }, true, confirmed],
  ];
  for (const [what, value, event, locked, next] of rows) {
    expect(slideConfirmNext(value, event, locked), what).toEqual(next);
  }
});
