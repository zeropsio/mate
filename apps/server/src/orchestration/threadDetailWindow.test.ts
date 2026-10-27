import { describe, expect, it } from "vite-plus/test";

import { fitTurnWindow, type TurnWindowCandidate } from "./threadDetailWindow.ts";

// Candidates newest first: "U12" is a user turn with 12 steps, "s5" a helper's
// or a fan-out turn (no user message of its own) with 5.
const turns = (...specs: ReadonlyArray<string>): ReadonlyArray<TurnWindowCandidate> =>
  specs.map((spec) => ({ isUserTurn: spec.startsWith("U"), steps: Number(spec.slice(1)) }));

describe("fitTurnWindow", () => {
  it.each([
    ["no turns", turns(), 3, 100, 0],
    ["every turn when they fit", turns("U10", "U10", "U10"), 5, 100, 3],
    ["stops at the user-turn limit", turns("U10", "U10", "U10"), 2, 100, 2],
    [
      "fan-out turns ride along with the user turn that opened them",
      turns("s5", "U5", "U5"),
      1,
      100,
      2,
    ],
    ["the oldest whole turn that fits closes the page", turns("U40", "U40", "U40"), 5, 100, 2],
    ["a turn that fits exactly is whole", turns("U50", "U50", "U1"), 5, 100, 2],
    ["the newest turn is whole even over the budget", turns("U500", "U10"), 5, 100, 1],
    [
      "the newest turn keeps its fan-out even over the budget",
      turns("s300", "s300", "U5", "U5"),
      5,
      100,
      3,
    ],
    [
      "a turn's fan-out never parts from it at the cut",
      turns("U10", "s60", "s60", "U10"),
      5,
      100,
      1,
    ],
    [
      "older fan-out with no user turn rides along when it fits",
      turns("U10", "s10", "s10"),
      5,
      100,
      3,
    ],
    [
      "older fan-out with no user turn stays behind when it doesn't",
      turns("U10", "s95"),
      5,
      100,
      1,
    ],
    ["fan-out alone fills the page turn by turn", turns("s60", "s30", "s30"), 5, 100, 2],
    ["fan-out alone still shows its newest turn", turns("s300", "s30"), 5, 100, 1],
  ])("%s", (_, candidates, userTurnLimit, stepBudget, expected) => {
    expect(fitTurnWindow(candidates, { userTurnLimit, stepBudget })).toBe(expected);
  });
});
