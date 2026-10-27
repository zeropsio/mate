import { describe, expect, it } from "vite-plus/test";

import { shownInScope } from "./mateScope";

// Invariant 11: whose a Mate is, HQ computes and says (`mine`); the client reads no member list.
describe("shownInScope — whose Mates the menu lists", () => {
  it.each([
    { scope: "everyone", mine: false, active: false, shown: true },
    { scope: "mine", mine: true, active: false, shown: true },
    { scope: "mine", mine: false, active: false, shown: false },
    // HQ says nothing of it: it stays.
    { scope: "mine", mine: undefined, active: false, shown: true },
    // The conversation open now is never hidden from the menu that opened it.
    { scope: "mine", mine: false, active: true, shown: true },
  ] as const)("$scope, mine $mine, open $active → $shown", ({ scope, mine, active, shown }) => {
    expect(shownInScope(scope, mine, active)).toBe(shown);
  });
});
