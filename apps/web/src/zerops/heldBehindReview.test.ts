import { describe, expect, it } from "vite-plus/test";

import { behindReview } from "./heldBehindReview";

describe("what stands behind an open review keeps its shape until the review closes", () => {
  it.each([
    ["shown as it is", { value: "strip", last: null, shown: false }, "strip", false],
    ["shown as it is under a review", { value: "strip", last: "old", shown: true }, "strip", false],
    [
      "held in its room while a review is open",
      { value: null, last: "strip", shown: true },
      "strip",
      true,
    ],
    ["gone once the review closes", { value: null, last: "strip", shown: false }, null, false],
    ["nothing held that was never shown", { value: null, last: null, shown: true }, null, false],
  ] as const)("%s", (_case, input, value, held) => {
    const next = behindReview<string>(input);
    expect(next.value).toBe(value);
    expect(next.held).toBe(held);
  });
});
