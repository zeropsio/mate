import { describe, expect, it } from "vite-plus/test";

import { withMuteToggled } from "./mutedMates";

describe("withMuteToggled — one Mate's notifications on or off", () => {
  it.each([
    { case: "mutes one that rang", muted: [], id: "env-a", expected: ["env-a"] },
    {
      case: "unmutes one that was muted",
      muted: ["env-a", "env-b"],
      id: "env-a",
      expected: ["env-b"],
    },
    {
      case: "keeps the others as they were",
      muted: ["env-b"],
      id: "env-a",
      expected: ["env-b", "env-a"],
    },
  ])("$case", ({ muted, id, expected }) => {
    expect(withMuteToggled(muted, id)).toEqual(expected);
  });
});
