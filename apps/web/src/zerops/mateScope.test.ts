import { describe, expect, it } from "vite-plus/test";

import { shownInScope } from "./mateScope";

describe("shownInScope — whose Mates the menu lists", () => {
  it.each([
    { scope: "everyone", owner: { isViewer: false }, active: false, shown: true },
    { scope: "mine", owner: { isViewer: true }, active: false, shown: true },
    { scope: "mine", owner: { isViewer: false }, active: false, shown: false },
    // Nobody can say it is somebody else's: it stays.
    { scope: "mine", owner: undefined, active: false, shown: true },
    // The conversation open now is never hidden from the menu that opened it.
    { scope: "mine", owner: { isViewer: false }, active: true, shown: true },
  ] as const)("$scope, owner $owner, open $active → $shown", ({ scope, owner, active, shown }) => {
    expect(shownInScope(scope, owner, active)).toBe(shown);
  });
});
