import { describe, expect, it } from "vite-plus/test";

import { FULL_COMPOSER_GAP, fullComposerGrowth } from "./fullComposer.logic";

describe("fullComposerGrowth", () => {
  const column = { top: 100, bottom: 1000 };

  it.each([
    ["docked at the foot, it grows up to the column's top", { top: 800, bottom: 1000 }, 684],
    ["centred on a new draft, it grows both ways", { top: 450, bottom: 650 }, 668],
    ["already at the top, no more", { top: 100 + FULL_COMPOSER_GAP, bottom: 1000 }, 0],
    ["taller than the column, never shrinks", { top: 60, bottom: 1000 }, 0],
  ])("%s", (_label, stack, expected) => {
    expect(fullComposerGrowth(column, stack)).toBe(expected);
  });
});
