import { describe, expect, it } from "vite-plus/test";

import { finishSetupContainer } from "./finishSetup.logic";

// Finish setup imports a container only where its project has none and no press may still be
// making one: a key is regenerated for it, which would cut a live container off (pass 28 review).
// Whether a press elsewhere still is, is its hold at HQ (B5), never its project's age.
describe("finishSetupContainer — whether Finish setup imports a container", () => {
  it.each([
    {
      case: "a Mate with its container",
      hasService: true,
      pressStopped: true,
      pressedElsewhere: false,
      want: null,
    },
    {
      case: "a Mate with none, no press holding it",
      hasService: false,
      pressStopped: false,
      pressedElsewhere: false,
      want: { agents: [] },
    },
    {
      case: "a Mate whose press this tab saw stop before its container",
      hasService: false,
      pressStopped: true,
      pressedElsewhere: false,
      want: { agents: [] },
    },
    {
      case: "a Mate a slow press in another browser still holds",
      hasService: false,
      pressStopped: false,
      pressedElsewhere: true,
      want: null,
    },
  ])("$case", ({ want, ...input }) => {
    expect(finishSetupContainer(input)).toEqual(want);
  });
});
