import { describe, expect, it } from "vite-plus/test";

import { standInCards } from "./overviewCardCount";

// The onboarding run: a one-project account's overview stood in with three cards, then drew one.
describe("the overview's stand-in", () => {
  it.each([
    { case: "one card where this browser drew one", remembered: "1", cards: 1 },
    { case: "no card where it drew none", remembered: "0", cards: 0 },
    { case: "a first screen's cards at most", remembered: "7", cards: 3 },
    { case: "one card where nothing is remembered", remembered: null, cards: 1 },
    { case: "one card where the memory is not a count", remembered: "many", cards: 1 },
  ])("draws $case", ({ remembered, cards }) => {
    expect(standInCards(remembered)).toBe(cards);
  });
});
