import { describe, expect, it } from "vite-plus/test";

import {
  FULL_COMPOSER_GAP,
  FULL_COMPOSER_MIN_HEIGHT,
  fullComposerHeight,
} from "./fullComposer.logic";

describe("fullComposerHeight", () => {
  const column = { top: 100, bottom: 1000 };
  const gap = FULL_COMPOSER_GAP;

  it.each([
    [
      "docked at the foot, it grows up to the column's top",
      { column, stack: { top: 800, bottom: 1000 }, editorHeight: 100, centred: false },
      100 + 800 - 100 - gap,
    ],
    [
      "docked, the space under the composer is not counted",
      { column, stack: { top: 800, bottom: 980 }, editorHeight: 100, centred: false },
      100 + 800 - 100 - gap,
    ],
    [
      "centred on a new draft, it grows both ways",
      { column, stack: { top: 450, bottom: 650 }, editorHeight: 100, centred: true },
      100 + (450 - 100 - gap) + (1000 - 650 - gap),
    ],
    [
      "already filling the column, it stays",
      { column, stack: { top: 100 + gap, bottom: 1000 }, editorHeight: 684, centred: false },
      684,
    ],
    [
      "the window got smaller, it shrinks back inside the column",
      {
        column: { top: 100, bottom: 600 },
        stack: { top: -300, bottom: 600 },
        editorHeight: 784,
        centred: false,
      },
      784 - (100 + gap - -300),
    ],
    [
      "a banner appeared above it in the stack, it gives the banner its room",
      { column, stack: { top: 100 + gap - 48, bottom: 1000 }, editorHeight: 684, centred: false },
      684 - 48,
    ],
    [
      "a strip left the stack, it takes the room back",
      { column, stack: { top: 100 + gap + 48, bottom: 1000 }, editorHeight: 636, centred: false },
      684,
    ],
    [
      "centred and taller than a smaller column, it shrinks both ways",
      {
        column: { top: 0, bottom: 400 },
        stack: { top: -100, bottom: 500 },
        editorHeight: 500,
        centred: true,
      },
      500 - (100 + gap) - (100 + gap),
    ],
    [
      "never below the composer's own resting height",
      {
        column: { top: 100, bottom: 200 },
        stack: { top: -400, bottom: 200 },
        editorHeight: 500,
        centred: false,
      },
      FULL_COMPOSER_MIN_HEIGHT,
    ],
  ])("%s", (_label, input, expected) => {
    expect(fullComposerHeight(input)).toBe(expected);
  });
});
