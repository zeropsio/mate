import { describe, expect, it } from "vite-plus/test";

import { resettledTop } from "./runScrollResettle.logic";

// Run 11: a message of the person's mid-turn re-made the card's row, the list
// re-inserted the row's node, and the browser put its scroll back at 0 with no
// scroll event. The card read its first two items for 30 minutes.
describe("resettledTop", () => {
  const AT_FOOT = { scrollHeight: 10_846, clientHeight: 440, scrollTop: 10_406 };
  const RESET = { ...AT_FOOT, scrollTop: 0 };

  it.each([
    {
      name: "following, put back at 0 with no move heard: at its foot again",
      follows: true,
      stood: 10_406,
      position: RESET,
      top: 10_406,
    },
    {
      name: "following, and lines joined since: at the foot as it stands now",
      follows: true,
      stood: 10_406,
      position: { ...RESET, scrollHeight: 11_000 },
      top: 10_560,
    },
    {
      name: "following, at its foot: nothing to settle",
      follows: true,
      stood: 10_406,
      position: AT_FOOT,
      top: null,
    },
    {
      name: "following, gliding on to a foot that moved on: where the glide stands is heard",
      follows: true,
      stood: 10_300,
      position: { ...AT_FOOT, scrollTop: 10_300 },
      top: null,
    },
    {
      name: "the person moved it up: theirs, it stays",
      follows: false,
      stood: 2_000,
      position: { ...AT_FOOT, scrollTop: 2_000 },
      top: null,
    },
    {
      name: "not following, put back at 0: the foot is not where they read",
      follows: false,
      stood: 2_000,
      position: RESET,
      top: null,
    },
  ])("$name", ({ follows, stood, position, top }) => {
    expect(resettledTop({ follows, stood, position })).toBe(top);
  });
});
